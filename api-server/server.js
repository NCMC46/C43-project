require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'mydb',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Database connected successfully');
    }
});

const FRIEND_REQUEST_COOLDOWN_MINUTES = 5;
const MAX_REVIEW_LENGTH = 4000;

function getAuthenticatedUsername(req, res) {
    const username = req.headers['x-username'];
    if (!username) {
        res.status(401).json({ success: false, message: 'Authentication required' });
        return null;
    }
    return username;
}

async function getActiveFriendCooldown(requester, target) {
    const result = await pool.query(
        'SELECT cooldown_until FROM friend_request_cooldowns WHERE requester = $1 AND target = $2',
        [requester, target]
    );
    
    if (result.rows.length === 0) {
        return null;
    }
    
    const cooldownUntil = new Date(result.rows[0].cooldown_until);
    const now = new Date();
    if (cooldownUntil <= now) {
        await pool.query(
            'DELETE FROM friend_request_cooldowns WHERE requester = $1 AND target = $2',
            [requester, target]
        );
        return null;
    }
    
    return cooldownUntil;
}

async function setFriendCooldown(requester, target, reason) {
    const cooldownUntil = new Date(Date.now() + FRIEND_REQUEST_COOLDOWN_MINUTES * 60 * 1000);
    await pool.query(`
        INSERT INTO friend_request_cooldowns(requester, target, cooldown_until, reason)
        VALUES($1, $2, $3, $4)
        ON CONFLICT (requester, target)
        DO UPDATE SET 
            cooldown_until = GREATEST(friend_request_cooldowns.cooldown_until, EXCLUDED.cooldown_until),
            reason = EXCLUDED.reason
    `, [requester, target, cooldownUntil, reason]);
}

async function clearFriendCooldownsBetween(userA, userB) {
    await pool.query(
        'DELETE FROM friend_request_cooldowns WHERE (requester = $1 AND target = $2) OR (requester = $2 AND target = $1)',
        [userA, userB]
    );
}

function formatCooldownMessage(cooldownUntil) {
    const remainingMs = cooldownUntil.getTime() - Date.now();
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    
    if (minutes > 0) {
        return `Please wait ${minutes} minute(s) and ${seconds} second(s) before sending another request.`;
    }
    return `Please wait ${seconds} second(s) before sending another request.`;
}

async function getStockListMeta(stockListId) {
    const result = await pool.query(`
        SELECT sl.stock_list_id, sl.visibility, cs.username AS creator
        FROM stock_lists sl
        LEFT JOIN creates_stocklist cs ON sl.stock_list_id = cs.stock_list_id
        WHERE sl.stock_list_id = $1
    `, [stockListId]);
    return result.rows[0] || null;
}

async function isStockListSharedWithUser(stockListId, username) {
    const result = await pool.query(
        'SELECT 1 FROM shares_stocklist WHERE stock_list_id = $1 AND username = $2',
        [stockListId, username]
    );
    return result.rows.length > 0;
}

async function getStockListAccess(username, stockListId) {
    const meta = await getStockListMeta(stockListId);
    if (!meta) {
        return { exists: false };
    }
    
    const isCreator = meta.creator === username;
    let canAccess = false;
    
    if (meta.visibility === 'public' || isCreator) {
        canAccess = true;
    } else if (meta.visibility === 'shared') {
        canAccess = await isStockListSharedWithUser(stockListId, username);
        
        if (!canAccess && meta.creator) {
            const friendCheck = await pool.query(`
                SELECT 1 FROM has_friend 
                WHERE (username = $1 AND friend_username = $2)
                   OR (username = $2 AND friend_username = $1)
                LIMIT 1
            `, [username, meta.creator]);
            canAccess = friendCheck.rows.length > 0;
        }
    }
    
    return { exists: true, meta, isCreator, canAccess };
}

// Statistics Caching Functions

function generateCacheKey(symbols, startDate, endDate) {
    const sortedSymbols = [...symbols].sort().join(',');
    const startStr = startDate || 'null';
    const endStr = endDate || 'null';
    return `${sortedSymbols}|${startStr}|${endStr}`;
}

async function getLatestDataTimestamp(symbols, startDate, endDate) {
    if (!symbols || symbols.length === 0) {
        return null;
    }
    
    const result = await pool.query(`
        SELECT MAX(timestamp) as latest_timestamp
        FROM stocks
        WHERE symbol = ANY($1::VARCHAR[])
          AND ($2::date IS NULL OR timestamp >= $2::date)
          AND ($3::date IS NULL OR timestamp <= $3::date)
    `, [symbols, startDate, endDate]);
    
    return result.rows[0]?.latest_timestamp || null;
}

async function getCachedStatistics(symbols, startDate, endDate) {
    const cacheKey = generateCacheKey(symbols, startDate, endDate);
    
    const cacheResult = await pool.query(`
        SELECT stock_stats, correlation_matrix, latest_data_timestamp
        FROM statistics_cache
        WHERE cache_key = $1
    `, [cacheKey]);
    
    if (cacheResult.rows.length === 0) {
        return null;
    }
    
    const cached = cacheResult.rows[0];
    
    const currentLatestTimestamp = await getLatestDataTimestamp(symbols, startDate, endDate);
    
    if (!currentLatestTimestamp) {
        return {
            stockStats: cached.stock_stats,
            correlationMatrix: cached.correlation_matrix
        };
    }
    
    if (new Date(cached.latest_data_timestamp).getTime() === new Date(currentLatestTimestamp).getTime()) {
        return {
            stockStats: cached.stock_stats,
            correlationMatrix: cached.correlation_matrix
        };
    }
    
    return null;
}

async function storeCachedStatistics(symbols, startDate, endDate, stockStats, correlationMatrix) {
    const cacheKey = generateCacheKey(symbols, startDate, endDate);
    const latestTimestamp = await getLatestDataTimestamp(symbols, startDate, endDate);
    
    if (!latestTimestamp) {
        return;
    }
    
    await pool.query(`
        INSERT INTO statistics_cache (
            cache_key, symbols, start_date, end_date,
            stock_stats, correlation_matrix, latest_data_timestamp
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (cache_key)
        DO UPDATE SET
            stock_stats = EXCLUDED.stock_stats,
            correlation_matrix = EXCLUDED.correlation_matrix,
            computed_at = NOW(),
            latest_data_timestamp = EXCLUDED.latest_data_timestamp
    `, [
        cacheKey,
        symbols,
        startDate,
        endDate,
        JSON.stringify(stockStats),
        JSON.stringify(correlationMatrix),
        latestTimestamp
    ]);
}

async function invalidateStatisticsCache(symbol, timestamp) {
    await pool.query(`
        DELETE FROM statistics_cache
        WHERE $1 = ANY(symbols)
          AND ($2::date IS NULL OR $2::date <= end_date OR end_date IS NULL)
          AND (latest_data_timestamp < $3::timestamp OR latest_data_timestamp IS NULL)
    `, [symbol, timestamp, timestamp]);
}

async function computeStatisticsForSymbols(symbols, startDate, endDate) {
    if (!symbols || symbols.length === 0) {
        return { stockStats: [], correlationMatrix: [] };
    }
    
    const cached = await getCachedStatistics(symbols, startDate, endDate);
    if (cached) {
        return cached;
    }

    const stockStats = [];
    
    const statsQuery = await pool.query(`
        SELECT 
            symbol,
            COUNT(*) as data_points,
            AVG(close) as mean,
            STDDEV_POP(close) as std_dev,
            CASE 
                WHEN AVG(close) != 0 THEN STDDEV_POP(close) / AVG(close)
                ELSE NULL
            END as coefficient_of_variation
        FROM stocks
        WHERE symbol = ANY($1::VARCHAR[])
          AND ($2::date IS NULL OR timestamp >= $2::date)
          AND ($3::date IS NULL OR timestamp <= $3::date)
        GROUP BY symbol
        HAVING COUNT(*) >= 2
    `, [symbols, startDate, endDate]);
    
    for (const row of statsQuery.rows) {
        const symbol = row.symbol;
        const mean = parseFloat(row.mean);
        const stdDev = parseFloat(row.std_dev);
        const cov = parseFloat(row.coefficient_of_variation);
        const dataPoints = parseInt(row.data_points);
        
        let beta = null;
        const betaResult = await pool.query(`
            WITH stock_prices AS (
                SELECT timestamp, close as stock_close
                FROM stocks
                WHERE symbol = $1
                  AND ($2::date IS NULL OR timestamp >= $2::date)
                  AND ($3::date IS NULL OR timestamp <= $3::date)
            ),
            market_prices AS (
                SELECT timestamp, AVG(close) as market_close
                FROM stocks
                WHERE timestamp IN (SELECT timestamp FROM stock_prices)
                  AND ($2::date IS NULL OR timestamp >= $2::date)
                  AND ($3::date IS NULL OR timestamp <= $3::date)
                GROUP BY timestamp
            ),
            aligned_data AS (
                SELECT 
                    sp.stock_close,
                    mp.market_close
                FROM stock_prices sp
                JOIN market_prices mp ON sp.timestamp = mp.timestamp
            )
            SELECT 
                COVAR_POP(stock_close, market_close) / NULLIF(VAR_POP(market_close), 0) as beta
            FROM aligned_data
            HAVING COUNT(*) >= 2
        `, [symbol, startDate, endDate]);
        
        if (betaResult.rows.length > 0 && betaResult.rows[0].beta !== null) {
            beta = parseFloat(betaResult.rows[0].beta);
        }
        
        stockStats.push({
            symbol,
            coefficient_of_variation: cov,
            beta: beta,
            mean: mean,
            std_dev: stdDev,
            data_points: dataPoints,
            message: null
        });
    }
    
    for (const symbol of symbols) {
        if (!stockStats.find(s => s.symbol === symbol)) {
            stockStats.push({
                symbol,
                coefficient_of_variation: null,
                beta: null,
                mean: null,
                std_dev: null,
                data_points: 0,
                message: 'Insufficient data (need at least 2 data points)'
            });
        }
    }
    
    const correlationMatrix = [];
    for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        const row = [];
        
        for (let j = 0; j < symbols.length; j++) {
            if (i === j) {
                row.push(1.0);
                continue;
            }
            
            const symbol2 = symbols[j];
            
            const corrResult = await pool.query(`
                WITH stock1_prices AS (
                    SELECT timestamp, close as price1
                    FROM stocks
                    WHERE symbol = $1
                      AND ($3::date IS NULL OR timestamp >= $3::date)
                      AND ($4::date IS NULL OR timestamp <= $4::date)
                ),
                stock2_prices AS (
                    SELECT timestamp, close as price2
                    FROM stocks
                    WHERE symbol = $2
                      AND ($3::date IS NULL OR timestamp >= $3::date)
                      AND ($4::date IS NULL OR timestamp <= $4::date)
                ),
                aligned_prices AS (
                    SELECT s1.price1, s2.price2
                    FROM stock1_prices s1
                    INNER JOIN stock2_prices s2 ON s1.timestamp = s2.timestamp
                )
                SELECT CORR(price1, price2) as correlation
                FROM aligned_prices
                HAVING COUNT(*) >= 2
            `, [symbol, symbol2, startDate, endDate]);
            
            if (corrResult.rows.length > 0 && corrResult.rows[0].correlation !== null) {
                row.push(parseFloat(corrResult.rows[0].correlation));
            } else {
                row.push(null);
            }
        }
        
        correlationMatrix.push({
            symbol,
            correlations: row
        });
    }

    const result = { stockStats, correlationMatrix };
    
    await storeCachedStatistics(symbols, startDate, endDate, stockStats, correlationMatrix);
    
    return result;
}

// Authentication Endpoints

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const result = await pool.query(
            'SELECT username, password FROM users WHERE username = $1',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        
        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password).catch(() => user.password === password);
        
        if (passwordMatch) {
            const token = `token_${user.username}_${Date.now()}`;
            res.json({
                username: user.username,
                token: token
            });
        } else {
            res.status(401).json({ message: 'Invalid username or password' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        const checkResult = await pool.query(
            'SELECT username FROM users WHERE username = $1',
            [username]
        );
        
        if (checkResult.rows.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        await pool.query(
            'INSERT INTO users(username, password) VALUES($1, $2)',
            [username, hashedPassword]
        );
        
        const token = `token_${username}_${Date.now()}`;
        res.json({
            username: username,
            token: token
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Portfolio Endpoints

app.get('/api/portfolios', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.query.username;
        if (!username) {
            return res.json({ success: false, message: 'Username required' });
        }
        
        const result = await pool.query(`
            SELECT p.portfolio_id, p.cash_account
            FROM portfolios p
            JOIN creates_portfolio cp ON p.portfolio_id = cp.portfolio_id
            WHERE cp.username = $1
            ORDER BY p.portfolio_id
        `, [username]);
        
        const portfolios = result.rows.map(row => ({
            portfolio_id: row.portfolio_id,
            cash_account: parseFloat(row.cash_account),
            username: username,
            holdings: [] 
        }));
        
        res.json(portfolios);
    } catch (error) {
        console.error('Get portfolios error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/portfolios', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.body.username;
        const initialCash = parseFloat(req.body.initial_cash || 0);
        
        if (!username) {
            return res.json({ success: false, message: 'Username required' });
        }
        
        const portfolioResult = await pool.query(
            'INSERT INTO portfolios(cash_account) VALUES($1) RETURNING portfolio_id',
            [initialCash]
        );
        
        const portfolioId = portfolioResult.rows[0].portfolio_id;
        
        await pool.query(
            'INSERT INTO creates_portfolio(username, portfolio_id) VALUES($1, $2)',
            [username, portfolioId]
        );
        
        res.json({
            portfolio_id: portfolioId,
            cash_account: initialCash,
            username: username,
            holdings: []
        });
    } catch (error) {
        console.error('Create portfolio error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/portfolios/:id/deposit', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const amount = parseFloat(req.body.amount);
        const username = req.headers['x-username'];
        
        if (!username) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount must be positive' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const ownershipCheck = await client.query(`
                SELECT COUNT(*) FROM creates_portfolio
                WHERE username = $1 AND portfolio_id = $2
            `, [username, portfolioId]);
            
            if (ownershipCheck.rows[0].count === '0') {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Portfolio not found or access denied' });
            }
            
            await client.query(`
                UPDATE portfolios 
                SET cash_account = cash_account + $1 
                WHERE portfolio_id = $2
            `, [amount, portfolioId]);
            
            const transResult = await client.query(`
                INSERT INTO transaction_history(username, portfolio_id, stock_symbol, transaction_type, shares, price, timestamp)
                VALUES($1, $2, NULL, 'DEPOSIT', NULL, $3, NOW())
                RETURNING transaction_id
            `, [username, portfolioId, amount]);
            
            const transactionId = transResult.rows[0].transaction_id;
            
            await client.query(`
                INSERT INTO has_transaction(portfolio_id, transaction_id)
                VALUES($1, $2)
                ON CONFLICT DO NOTHING
            `, [portfolioId, transactionId]);
            
            await client.query('COMMIT');
            
            const portfolioResult = await client.query(
                'SELECT portfolio_id, cash_account FROM portfolios WHERE portfolio_id = $1',
                [portfolioId]
            );
            
            res.json({
                success: true,
                message: 'Cash deposited successfully',
                portfolio: {
                    portfolio_id: portfolioResult.rows[0].portfolio_id,
                    cash_account: parseFloat(portfolioResult.rows[0].cash_account)
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Deposit cash error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.post('/api/portfolios/:id/withdraw', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const amount = parseFloat(req.body.amount);
        const username = req.headers['x-username'];
        
        if (!username) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Amount must be positive' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const balanceCheck = await client.query(`
                SELECT p.cash_account 
                FROM portfolios p
                JOIN creates_portfolio cp ON p.portfolio_id = cp.portfolio_id
                WHERE cp.username = $1 AND p.portfolio_id = $2
            `, [username, portfolioId]);
            
            if (balanceCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Portfolio not found or access denied' });
            }
            
            const currentCash = parseFloat(balanceCheck.rows[0].cash_account);
            
            if (currentCash < amount) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Insufficient funds. Available: $${currentCash.toFixed(2)}`
                });
            }
            
            await client.query(`
                UPDATE portfolios 
                SET cash_account = cash_account - $1 
                WHERE portfolio_id = $2
            `, [amount, portfolioId]);
            
            const transResult = await client.query(`
                INSERT INTO transaction_history(username, portfolio_id, stock_symbol, transaction_type, shares, price, timestamp)
                VALUES($1, $2, NULL, 'WITHDRAW', NULL, $3, NOW())
                RETURNING transaction_id
            `, [username, portfolioId, amount]);
            
            const transactionId = transResult.rows[0].transaction_id;
            
            await client.query(`
                INSERT INTO has_transaction(portfolio_id, transaction_id)
                VALUES($1, $2)
                ON CONFLICT DO NOTHING
            `, [portfolioId, transactionId]);
            
            await client.query('COMMIT');
            
            const portfolioResult = await client.query(
                'SELECT portfolio_id, cash_account FROM portfolios WHERE portfolio_id = $1',
                [portfolioId]
            );
            
            res.json({
                success: true,
                message: 'Cash withdrawn successfully',
                portfolio: {
                    portfolio_id: portfolioResult.rows[0].portfolio_id,
                    cash_account: parseFloat(portfolioResult.rows[0].cash_account)
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Withdraw cash error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.post('/api/portfolios/:id/buy', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const { symbol, shares, price } = req.body;
        const username = req.headers['x-username'] || req.query.username;
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM creates_portfolio
            WHERE portfolio_id = $1 AND username = $2
        `, [portfolioId, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Portfolio not found or access denied' });
        }
        
        const totalCost = shares * price;
        const portfolioResult = await pool.query(
            'SELECT cash_account FROM portfolios WHERE portfolio_id = $1',
            [portfolioId]
        );
        
        const cashAccount = parseFloat(portfolioResult.rows[0].cash_account);
        if (cashAccount < totalCost) {
            return res.json({ success: false, message: 'Insufficient funds' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query(
                'UPDATE portfolios SET cash_account = cash_account - $1 WHERE portfolio_id = $2',
                [totalCost, portfolioId]
            );
            
            const holdingCheck = await client.query(`
                SELECT COUNT(*) FROM stock_holding
                WHERE portfolio_id = $1 AND stock_symbol = $2
            `, [portfolioId, symbol]);
            
            if (holdingCheck.rows[0].count === '0') {
                await client.query(
                    'INSERT INTO has_holding(portfolio_id, stock_symbol) VALUES($1, $2) ON CONFLICT DO NOTHING',
                    [portfolioId, symbol]
                );
                await client.query(
                    'INSERT INTO stock_holding(portfolio_id, stock_symbol, shares) VALUES($1, $2, $3)',
                    [portfolioId, symbol, shares]
                );
            } else {
                await client.query(
                    'UPDATE stock_holding SET shares = shares + $1 WHERE portfolio_id = $2 AND stock_symbol = $3',
                    [shares, portfolioId, symbol]
                );
            }
            
            await client.query(`
                INSERT INTO transaction_history(username, portfolio_id, stock_symbol, transaction_type, shares, price, timestamp)
                VALUES($1, $2, $3, 'BUY', $4, $5, NOW())
            `, [username, portfolioId, symbol, shares, price]);
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Stock purchased successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Buy stock error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/portfolios/:id/sell', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const { symbol, shares, price } = req.body;
        const username = req.headers['x-username'] || req.query.username;
        
        if (!username) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        
        if (!symbol || !shares || !price) {
            return res.status(400).json({ success: false, message: 'Symbol, shares, and price are required' });
        }
        
        if (shares <= 0) {
            return res.status(400).json({ success: false, message: 'Shares must be positive' });
        }
        
        const totalRevenue = shares * price;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const ownershipResult = await client.query(`
                SELECT COUNT(*) FROM creates_portfolio
                WHERE portfolio_id = $1 AND username = $2
            `, [portfolioId, username]);
            
            if (ownershipResult.rows[0].count === '0') {
                await client.query('ROLLBACK');
                return res.status(403).json({ success: false, message: 'Portfolio not found or access denied' });
            }
            
            const holdingCheck = await client.query(`
                SELECT shares FROM stock_holding
                WHERE portfolio_id = $1 AND stock_symbol = $2
            `, [portfolioId, symbol]);
            
            if (holdingCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({ success: false, message: 'You don\'t own this stock in this portfolio' });
            }
            
            const currentShares = parseFloat(holdingCheck.rows[0].shares);
            
            if (currentShares < shares) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: `Insufficient shares. You own: ${currentShares.toFixed(2)} shares`
                });
            }
            
            await client.query(
                'UPDATE portfolios SET cash_account = cash_account + $1 WHERE portfolio_id = $2',
                [totalRevenue, portfolioId]
            );
            
            await client.query(
                'UPDATE stock_holding SET shares = shares - $1 WHERE portfolio_id = $2 AND stock_symbol = $3',
                [shares, portfolioId, symbol]
            );
            
            const remainingCheck = await client.query(`
                SELECT shares FROM stock_holding WHERE portfolio_id = $1 AND stock_symbol = $2
            `, [portfolioId, symbol]);
            
            if (remainingCheck.rows.length > 0 && parseFloat(remainingCheck.rows[0].shares) <= 0) {
                await client.query(
                    'DELETE FROM has_holding WHERE portfolio_id = $1 AND stock_symbol = $2',
                    [portfolioId, symbol]
                );
                await client.query(
                    'DELETE FROM stock_holding WHERE portfolio_id = $1 AND stock_symbol = $2',
                    [portfolioId, symbol]
                );
            }
            
            await client.query(`
                INSERT INTO transaction_history(username, portfolio_id, stock_symbol, transaction_type, shares, price, timestamp)
                VALUES($1, $2, $3, 'SELL', $4, $5, NOW())
            `, [username, portfolioId, symbol, shares, price]);
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Stock sold successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Sell stock error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/portfolios/:id', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const username = req.headers['x-username'] || req.query.username;
        
        const portfolioResult = await pool.query(
            'SELECT portfolio_id, cash_account FROM portfolios WHERE portfolio_id = $1',
            [portfolioId]
        );
        
        if (portfolioResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Portfolio not found' });
        }
        
        const portfolio = portfolioResult.rows[0];
        const cashAccount = parseFloat(portfolio.cash_account);
        
        const holdingsResult = await pool.query(`
            SELECT sh.stock_symbol, sh.shares
            FROM stock_holding sh
            WHERE sh.portfolio_id = $1
        `, [portfolioId]);
        
        const holdings = await Promise.all(holdingsResult.rows.map(async (row) => {
            const symbol = row.stock_symbol;
            const shares = parseFloat(row.shares);
            
            const priceResult = await pool.query(`
                SELECT close FROM stocks 
                WHERE symbol = $1 
                ORDER BY timestamp DESC 
                LIMIT 1
            `, [symbol]);
            
            const latestPrice = priceResult.rows.length > 0 ? parseFloat(priceResult.rows[0].close) : 0;
            const value = shares * latestPrice;
            return {
                symbol: symbol,
                shares: shares,
                latest_price: latestPrice,
                value: value
            };
        }));
        
        const totalStockValue = holdings.reduce((sum, h) => sum + h.value, 0);
        const totalPortfolioValue = cashAccount + totalStockValue;
        
        res.json({
            portfolio_id: portfolio.portfolio_id,
            cash_account: cashAccount,
            holdings: holdings,
            total_stock_value: totalStockValue,
            total_portfolio_value: totalPortfolioValue
        });
    } catch (error) {
        console.error('Get portfolio details error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Stock List Endpoints

app.get('/api/stocklists', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.query.username;
        if (!username) {
            return res.json({ success: false, message: 'Username required' });
        }
        
        const result = await pool.query(`
            SELECT sl.stock_list_id, sl.visibility
            FROM stock_lists sl
            JOIN creates_stocklist cs ON sl.stock_list_id = cs.stock_list_id
            WHERE cs.username = $1
            ORDER BY sl.stock_list_id
        `, [username]);
        
        const stockLists = await Promise.all(result.rows.map(async (row) => {
            const itemsResult = await pool.query(`
                SELECT stock_symbol, shares FROM stocklist_items
                WHERE stock_list_id = $1
            `, [row.stock_list_id]);
            
            return {
                stock_list_id: row.stock_list_id,
                visibility: row.visibility,
                username: username,
                items: itemsResult.rows.map(item => ({
                    symbol: item.stock_symbol,
                    shares: parseFloat(item.shares)
                }))
            };
        }));
        
        res.json(stockLists);
    } catch (error) {
        console.error('Get stock lists error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/stocklists', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.body.username;
        const visibility = req.body.visibility || 'private';
        
        if (!username) {
            return res.json({ success: false, message: 'Username required' });
        }
        
        const listResult = await pool.query(
            'INSERT INTO stock_lists(visibility) VALUES($1) RETURNING stock_list_id',
            [visibility]
        );
        
        const stockListId = listResult.rows[0].stock_list_id;
        
        await pool.query(
            'INSERT INTO creates_stocklist(username, stock_list_id) VALUES($1, $2)',
            [username, stockListId]
        );
        
        res.json({
            stock_list_id: stockListId,
            visibility: visibility,
            username: username,
            items: []
        });
    } catch (error) {
        console.error('Create stock list error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocklists/accessible', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.query.username;
        
        const result = await pool.query(`
            SELECT DISTINCT sl.stock_list_id, sl.visibility, cs.username as creator
            FROM stock_lists sl
            LEFT JOIN creates_stocklist cs ON sl.stock_list_id = cs.stock_list_id
            WHERE sl.visibility = 'public'
            OR cs.username = $1
            OR EXISTS (SELECT 1 FROM shares_stocklist ss WHERE ss.stock_list_id = sl.stock_list_id AND ss.username = $1)
            OR (sl.visibility = 'shared' AND cs.username IS NOT NULL 
                AND EXISTS (SELECT 1 FROM has_friend hf 
                            WHERE (hf.username = $1 AND hf.friend_username = cs.username)
                               OR (hf.username = cs.username AND hf.friend_username = $1)))
            ORDER BY sl.stock_list_id
        `, [username]);
        
        res.json(result.rows);
    } catch (error) {
        console.error('Get accessible stock lists error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocklists/:id', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.query.username;
        const stockListId = parseInt(req.params.id);
        
        const { exists, canAccess, meta } = await getStockListAccess(username, stockListId);
        
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Stock list not found' });
        }
        
        if (!canAccess) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        
        const itemsResult = await pool.query(`
            SELECT stock_symbol, shares FROM stocklist_items
            WHERE stock_list_id = $1
        `, [stockListId]);
        
        const items = await Promise.all(itemsResult.rows.map(async (row) => {
            const symbol = row.stock_symbol;
            const shares = parseFloat(row.shares);
            
            const priceResult = await pool.query(`
                SELECT close FROM stocks 
                WHERE symbol = $1 
                ORDER BY timestamp DESC 
                LIMIT 1
            `, [symbol]);
            
            const latestPrice = priceResult.rows.length > 0 ? parseFloat(priceResult.rows[0].close) : 0;
            const value = shares * latestPrice;
            return {
                symbol: symbol,
                shares: shares,
                latest_price: latestPrice,
                value: value
            };
        }));
        
        const totalValue = items.reduce((sum, item) => sum + item.value, 0);
        
        res.json({
            stock_list_id: stockListId,
            visibility: meta.visibility,
            username: meta.creator || null,
            items: items,
            total_value: totalValue
        });
    } catch (error) {
        console.error('Get stock list details error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/stocklists/:id/add-stock', async (req, res) => {
    try {
        const stockListId = parseInt(req.params.id);
        const { symbol, shares } = req.body;
        const username = req.headers['x-username'] || req.query.username;
        const stockSymbol = (symbol || '').toUpperCase().trim();
        
        if (!stockSymbol) {
            return res.status(400).json({ success: false, message: 'Stock symbol is required' });
        }
        
        if (!shares || shares <= 0) {
            return res.status(400).json({ success: false, message: 'Shares must be a positive number' });
        }
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM creates_stocklist
            WHERE stock_list_id = $1 AND username = $2
        `, [stockListId, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Stock list not found or access denied' });
        }
        
        await pool.query(
            'INSERT INTO stock_symbols(symbol) VALUES($1) ON CONFLICT DO NOTHING',
            [stockSymbol]
        );
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const checkResult = await client.query(`
                SELECT COUNT(*) FROM has_item
                WHERE stock_list_id = $1 AND stock_symbol = $2
            `, [stockListId, stockSymbol]);
            
            if (checkResult.rows[0].count === '0') {
                await client.query(
                    'INSERT INTO has_item(stock_list_id, stock_symbol) VALUES($1, $2)',
                    [stockListId, stockSymbol]
                );
                await client.query(
                    'INSERT INTO stocklist_items(stock_list_id, stock_symbol, shares) VALUES($1, $2, $3)',
                    [stockListId, stockSymbol, shares]
                );
            } else {
                await client.query(
                    'UPDATE stocklist_items SET shares = shares + $1 WHERE stock_list_id = $2 AND stock_symbol = $3',
                    [shares, stockListId, stockSymbol]
                );
            }
            
            await client.query('COMMIT');
            res.json({ success: true, message: 'Stock added to list successfully' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Add stock to list error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/stocklists/:id', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const stockListId = parseInt(req.params.id);
        if (isNaN(stockListId)) {
            return res.status(400).json({ success: false, message: 'Invalid stock list id' });
        }
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM creates_stocklist
            WHERE stock_list_id = $1 AND username = $2
        `, [stockListId, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Stock list not found or you do not have permission to delete it' });
        }
        
        await pool.query('DELETE FROM stock_lists WHERE stock_list_id = $1', [stockListId]);
        
        
        res.json({ success: true, message: 'Stock list deleted successfully' });
    } catch (error) {
        console.error('Delete stock list error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/stocklists/:id/statistics', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const stockListId = parseInt(req.params.id);
        if (isNaN(stockListId)) {
            return res.status(400).json({ success: false, message: 'Invalid stock list id' });
        }
        
        const startDate = req.query.start_date || null;
        const endDate = req.query.end_date || null;
        
        const access = await getStockListAccess(username, stockListId);
        if (!access.exists) {
            return res.status(404).json({ success: false, message: 'Stock list not found' });
        }
        if (!access.canAccess) {
            return res.status(403).json({ success: false, message: 'Access denied for this stock list' });
        }
        
        const itemsResult = await pool.query(`
            SELECT DISTINCT stock_symbol FROM stocklist_items WHERE stock_list_id = $1
        `, [stockListId]);
        
        if (itemsResult.rows.length === 0) {
            return res.json({
                stock_list_id: stockListId,
                visibility: access.meta.visibility,
                creator: access.meta.creator,
                stocks: [],
                correlation_matrix: [],
                symbols: [],
                message: 'No stocks in this stock list'
            });
        }
        
        const symbols = itemsResult.rows.map(row => row.stock_symbol);
        const { stockStats, correlationMatrix } = await computeStatisticsForSymbols(symbols, startDate, endDate);
        
        res.json({
            stock_list_id: stockListId,
            visibility: access.meta.visibility,
            creator: access.meta.creator,
            is_creator: access.isCreator,
            symbols: symbols,
            stocks: stockStats,
            correlation_matrix: correlationMatrix
        });
    } catch (error) {
        console.error('Get stock list statistics error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

// Friends Endpoints

app.get('/api/friends', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const result = await pool.query(
            'SELECT friend_username FROM has_friend WHERE username = $1 ORDER BY friend_username',
            [username]
        );
        
        res.json(result.rows.map(row => row.friend_username));
    } catch (error) {
        console.error('Get friends error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/friends/request', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const targetUsername = (req.body?.target || req.body?.username || '').trim();
        
        if (!targetUsername) {
            return res.status(400).json({ success: false, message: 'Target username is required' });
        }
        
        if (targetUsername === username) {
            return res.status(400).json({ success: false, message: 'You cannot send a friend request to yourself' });
        }
        
        const userExists = await pool.query(
            'SELECT 1 FROM users WHERE username = $1',
            [targetUsername]
        );
        
        if (userExists.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        const friendCheck = await pool.query(
            'SELECT 1 FROM has_friend WHERE username = $1 AND friend_username = $2',
            [username, targetUsername]
        );
        
        if (friendCheck.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'You are already friends' });
        }
        
        const pendingCheck = await pool.query(`
            SELECT pending_user, sent_user 
            FROM friend_requests 
            WHERE (pending_user = $1 AND sent_user = $2)
               OR (pending_user = $2 AND sent_user = $1)
        `, [targetUsername, username]);
        
        if (pendingCheck.rows.length > 0) {
            const existing = pendingCheck.rows[0];
            if (existing.sent_user === username) {
                return res.status(400).json({ success: false, message: 'Friend request already sent and awaiting approval' });
            }
            return res.status(400).json({ success: false, message: `${targetUsername} already sent you a friend request. Please accept or reject it.` });
        }
        
        const cooldownUntil = await getActiveFriendCooldown(username, targetUsername);
        if (cooldownUntil) {
            return res.status(429).json({ success: false, message: formatCooldownMessage(cooldownUntil) });
        }
        
        const insertResult = await pool.query(
            'INSERT INTO friend_requests(pending_user, sent_user) VALUES($1, $2) ON CONFLICT DO NOTHING RETURNING pending_user',
            [targetUsername, username]
        );
        
        if (insertResult.rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Friend request already pending' });
        }
        
        await pool.query(
            'INSERT INTO receives(username, pending_user, sent_user) VALUES($1, $2, $3) ON CONFLICT DO NOTHING',
            [targetUsername, targetUsername, username]
        );
        
        res.json({ success: true, message: `Friend request sent to ${targetUsername}` });
    } catch (error) {
        console.error('Send friend request error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/friends/requests/incoming', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const result = await pool.query(`
            SELECT sent_user FROM receives
            WHERE username = $1 AND pending_user = $1
            ORDER BY sent_user
        `, [username]);
        
        res.json(result.rows.map(row => row.sent_user));
    } catch (error) {
        console.error('Get incoming requests error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/friends/requests/outgoing', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const result = await pool.query(
            'SELECT pending_user FROM friend_requests WHERE sent_user = $1 ORDER BY pending_user',
            [username]
        );
        
        res.json(result.rows.map(row => row.pending_user));
    } catch (error) {
        console.error('Get outgoing requests error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/friends/accept', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const fromUsername = (req.body?.from || '').trim();
        
        if (!fromUsername) {
            return res.status(400).json({ success: false, message: 'Sender username is required' });
        }
        
        if (fromUsername === username) {
            return res.status(400).json({ success: false, message: 'Invalid friend request' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const requestExists = await client.query(
                'SELECT 1 FROM friend_requests WHERE pending_user = $1 AND sent_user = $2',
                [username, fromUsername]
            );
            
            if (requestExists.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Friend request not found' });
            }
            
            await client.query(
                'INSERT INTO has_friend(username, friend_username) VALUES($1, $2) ON CONFLICT DO NOTHING',
                [username, fromUsername]
            );
            await client.query(
                'INSERT INTO has_friend(username, friend_username) VALUES($1, $2) ON CONFLICT DO NOTHING',
                [fromUsername, username]
            );
            
            await client.query(
                'DELETE FROM friend_requests WHERE pending_user = $1 AND sent_user = $2',
                [username, fromUsername]
            );
            await client.query(
                'DELETE FROM receives WHERE username = $1 AND pending_user = $1 AND sent_user = $2',
                [username, fromUsername]
            );
            
            await client.query('COMMIT');
            await clearFriendCooldownsBetween(username, fromUsername);
            res.json({ success: true, message: 'Friend request accepted' });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Accept friend request error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/friends/reject', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const fromUsername = (req.body?.from || '').trim();
        if (!fromUsername) {
            return res.status(400).json({ success: false, message: 'Sender username is required' });
        }
        
        const deleteResult = await pool.query(
            'DELETE FROM friend_requests WHERE pending_user = $1 AND sent_user = $2 RETURNING 1',
            [username, fromUsername]
        );
        
        if (deleteResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Friend request not found' });
        }
        
        await pool.query(
            'DELETE FROM receives WHERE username = $1 AND pending_user = $1 AND sent_user = $2',
            [username, fromUsername]
        );
        
        await setFriendCooldown(fromUsername, username, 'rejected');
        
        res.json({ success: true, message: `Friend request from ${fromUsername} rejected. They must wait 5 minutes before sending another request.` });
    } catch (error) {
        console.error('Reject friend request error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/friends/:friendUsername', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;
        
        const friendUsername = req.params.friendUsername;
        if (!friendUsername) {
            return res.status(400).json({ success: false, message: 'Friend username is required' });
        }
        
        if (friendUsername === username) {
            return res.status(400).json({ success: false, message: 'Cannot remove yourself' });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            const deleteResult = await client.query(
                'DELETE FROM has_friend WHERE username = $1 AND friend_username = $2 RETURNING 1',
                [username, friendUsername]
            );
            const deleteMirror = await client.query(
                'DELETE FROM has_friend WHERE username = $1 AND friend_username = $2 RETURNING 1',
                [friendUsername, username]
            );
            
            if (deleteResult.rows.length === 0 && deleteMirror.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Friendship not found' });
            }
            
            await client.query(
                'DELETE FROM friend_requests WHERE (pending_user = $1 AND sent_user = $2) OR (pending_user = $2 AND sent_user = $1)',
                [username, friendUsername]
            );
            
            await client.query(
                'DELETE FROM receives WHERE (username = $1 AND pending_user = $1 AND sent_user = $2) OR (username = $2 AND pending_user = $2 AND sent_user = $1)',
                [username, friendUsername]
            );
            
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
        await setFriendCooldown(friendUsername, username, 'removed');
        res.json({ success: true, message: `${friendUsername} removed. They must wait 5 minutes before sending another request.` });
    } catch (error) {
        console.error('Remove friend error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Reviews Endpoints

app.get('/api/stocklists/:id/reviews', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;

        const stockListId = parseInt(req.params.id);
        if (isNaN(stockListId)) {
            return res.status(400).json({ success: false, message: 'Invalid stock list id' });
        }

        const { exists, meta, isCreator, canAccess } = await getStockListAccess(username, stockListId);
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Stock list not found' });
        }

        if (!canAccess) {
            return res.status(403).json({ success: false, message: 'Access denied for this stock list' });
        }

        let query = `
            SELECT r.review_id, r.content, r.stock_list_id, r.created_at, r.updated_at, w.username
            FROM reviews r
            JOIN writes w ON r.review_id = w.review_id
            WHERE r.stock_list_id = $1
            ORDER BY r.updated_at DESC
        `;
        const params = [stockListId];

        if (meta.visibility !== 'public' && !isCreator) {
            query += ' AND w.username = $2';
            params.push(username);
        }

        const result = await pool.query(query, params);

        res.json({
            stock_list_id: stockListId,
            visibility: meta.visibility,
            creator: meta.creator,
            is_creator: isCreator,
            reviews: result.rows.map(row => ({
                review_id: row.review_id,
                stock_list_id: row.stock_list_id,
                content: row.content,
                username: row.username,
                created_at: row.created_at,
                updated_at: row.updated_at,
                can_edit: row.username === username,
                can_delete: row.username === username || isCreator
            })),
            note: (meta.visibility !== 'public' && !isCreator)
                ? 'Only your own review is visible for this stock list.'
                : null
        });
    } catch (error) {
        console.error('Get stock list reviews error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/stocklists/:id/reviews', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;

        const stockListId = parseInt(req.params.id);
        if (isNaN(stockListId)) {
            return res.status(400).json({ success: false, message: 'Invalid stock list id' });
        }

        const content = (req.body?.content || '').trim();
        if (!content) {
            return res.status(400).json({ success: false, message: 'Review content is required' });
        }
        if (content.length > MAX_REVIEW_LENGTH) {
            return res.status(400).json({ success: false, message: `Review content must be ${MAX_REVIEW_LENGTH} characters or less` });
        }

        const { exists, canAccess } = await getStockListAccess(username, stockListId);
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Stock list not found' });
        }
        if (!canAccess) {
            return res.status(403).json({ success: false, message: 'You do not have access to this stock list' });
        }

        const existingReviewResult = await pool.query(`
            SELECT r.review_id
            FROM reviews r
            JOIN writes w ON r.review_id = w.review_id
            WHERE r.stock_list_id = $1 AND w.username = $2
        `, [stockListId, username]);

        if (existingReviewResult.rows.length > 0) {
            const reviewId = existingReviewResult.rows[0].review_id;
            const updateResult = await pool.query(`
                UPDATE reviews
                SET content = $1, updated_at = NOW()
                WHERE review_id = $2
                RETURNING review_id, content, stock_list_id, created_at, updated_at
            `, [content, reviewId]);

            const review = updateResult.rows[0];
            return res.json({
                review_id: review.review_id,
                stock_list_id: review.stock_list_id,
                content: review.content,
                username,
                created_at: review.created_at,
                updated_at: review.updated_at,
                message: 'Review updated successfully'
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const insertResult = await client.query(`
                INSERT INTO reviews(content, stock_list_id)
                VALUES($1, $2)
                RETURNING review_id, content, stock_list_id, created_at, updated_at
            `, [content, stockListId]);

            const review = insertResult.rows[0];

            await client.query(
                'INSERT INTO writes(review_id, username) VALUES($1, $2)',
                [review.review_id, username]
            );

            await client.query('COMMIT');

            res.json({
                review_id: review.review_id,
                stock_list_id: review.stock_list_id,
                content: review.content,
                username,
                created_at: review.created_at,
                updated_at: review.updated_at,
                message: 'Review created successfully'
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Create/Update review error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/stocklists/:stockListId/reviews/:reviewId', async (req, res) => {
    try {
        const username = getAuthenticatedUsername(req, res);
        if (!username) return;

        const stockListId = parseInt(req.params.stockListId);
        const reviewId = parseInt(req.params.reviewId);

        if (isNaN(stockListId) || isNaN(reviewId)) {
            return res.status(400).json({ success: false, message: 'Invalid identifiers' });
        }

        const { exists, isCreator } = await getStockListAccess(username, stockListId);
        if (!exists) {
            return res.status(404).json({ success: false, message: 'Stock list not found' });
        }

        const reviewResult = await pool.query(`
            SELECT r.review_id, w.username
            FROM reviews r
            JOIN writes w ON r.review_id = w.review_id
            WHERE r.review_id = $1 AND r.stock_list_id = $2
        `, [reviewId, stockListId]);

        if (reviewResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Review not found' });
        }

        const reviewOwner = reviewResult.rows[0].username;
        const canDelete = (reviewOwner === username) || isCreator;
        if (!canDelete) {
            return res.status(403).json({ success: false, message: 'You do not have permission to delete this review' });
        }

        await pool.query('DELETE FROM reviews WHERE review_id = $1', [reviewId]);

        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Delete review error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Dashboard Endpoints

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const username = req.headers['x-username'] || req.query.username;
        if (!username) {
            return res.json({ success: false, message: 'Username required' });
        }
        
        const portfolioResult = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(cash_account), 0) as total
            FROM portfolios p
            JOIN creates_portfolio cp ON p.portfolio_id = cp.portfolio_id
            WHERE cp.username = $1
        `, [username]);
        
        const stockListResult = await pool.query(`
            SELECT COUNT(*) as count FROM creates_stocklist WHERE username = $1
        `, [username]);
        
        const sharedResult = await pool.query(`
            SELECT COUNT(*) as count FROM stock_lists
            WHERE visibility = 'shared' OR visibility = 'public'
        `);
        
        const friendsResult = await pool.query(
            'SELECT COUNT(*) as count FROM has_friend WHERE username = $1',
            [username]
        );
        
        const requestsResult = await pool.query(`
            SELECT COUNT(*) as count FROM receives
            WHERE username = $1 AND pending_user = $1
        `, [username]);
        
        res.json({
            portfolio_count: parseInt(portfolioResult.rows[0].count),
            portfolio_value: parseFloat(portfolioResult.rows[0].total),
            stocklist_count: parseInt(stockListResult.rows[0].count),
            shared_list_count: parseInt(sharedResult.rows[0].count),
            friends_count: parseInt(friendsResult.rows[0].count),
            pending_requests: parseInt(requestsResult.rows[0].count)
        });
    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Stock Data Endpoints

app.post('/api/stocks', async (req, res) => {
    try {
        const { symbol, timestamp, open, high, low, close, volume } = req.body;
        
        if (!symbol || !timestamp || open === undefined || high === undefined || 
            low === undefined || close === undefined || volume === undefined) {
            return res.status(400).json({ 
                success: false, 
                message: 'All fields are required: symbol, timestamp, open, high, low, close, volume' 
            });
        }
        
        const stockSymbol = symbol.toUpperCase().trim();
        
        const openPrice = parseFloat(open);
        const highPrice = parseFloat(high);
        const lowPrice = parseFloat(low);
        const closePrice = parseFloat(close);
        const stockVolume = parseInt(volume);
        
        if (isNaN(openPrice) || isNaN(highPrice) || isNaN(lowPrice) || 
            isNaN(closePrice) || isNaN(stockVolume)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Open, high, low, close must be numbers, and volume must be an integer' 
            });
        }
        
        if (lowPrice > highPrice || openPrice < 0 || closePrice < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid price values: low must be <= high, prices must be non-negative' 
            });
        }
        
        if (stockVolume < 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Volume must be non-negative' 
            });
        }
        
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(timestamp)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Timestamp must be in YYYY-MM-DD format' 
            });
        }
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            
            await client.query(`
                INSERT INTO stocks(symbol, timestamp, open, high, low, close, volume)
                VALUES($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (symbol, timestamp) 
                DO UPDATE SET
                    open = EXCLUDED.open,
                    high = EXCLUDED.high,
                    low = EXCLUDED.low,
                    close = EXCLUDED.close,
                    volume = EXCLUDED.volume
            `, [stockSymbol, timestamp, openPrice, highPrice, lowPrice, closePrice, stockVolume]);
            
            await client.query(`
                INSERT INTO stock_symbols(symbol)
                VALUES($1)
                ON CONFLICT (symbol) DO NOTHING
            `, [stockSymbol]);
            
            await client.query('COMMIT');
            
            await invalidateStatisticsCache(stockSymbol, timestamp);
            
            res.json({
                success: true,
                message: 'Stock data recorded successfully',
                data: {
                    symbol: stockSymbol,
                    timestamp: timestamp,
                    open: openPrice,
                    high: highPrice,
                    low: lowPrice,
                    close: closePrice,
                    volume: stockVolume
                }
            });
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Record stock data error:', error);
        
        if (error.code === '23505') {
            return res.status(400).json({ 
                success: false, 
                message: 'Stock data for this symbol and date already exists' 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            message: 'Server error: ' + error.message 
        });
    }
});

app.get('/api/stocks/symbols', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT symbol FROM stock_symbols ORDER BY symbol'
        );
        
        res.json(result.rows.map(row => row.symbol));
    } catch (error) {
        console.error('Get stock symbols error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocks/:symbol/price', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        
        const result = await pool.query(`
            SELECT close, timestamp 
            FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC 
            LIMIT 1
        `, [symbol]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Stock symbol not found' });
        }
        
        res.json({
            symbol: symbol,
            price: parseFloat(result.rows[0].close),
            timestamp: result.rows[0].timestamp
        });
    } catch (error) {
        console.error('Get stock price error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocks/:symbol/history', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const limit = parseInt(req.query.limit) || 100; 
        const startDate = req.query.start_date || null;
        const endDate = req.query.end_date || null;
        
        let query = `
            SELECT timestamp, open, high, low, close, volume 
            FROM stocks 
            WHERE symbol = $1
        `;
        const params = [symbol];
        
        if (startDate) {
            query += ` AND timestamp >= $${params.length + 1}`;
            params.push(startDate);
        }
        if (endDate) {
            query += ` AND timestamp <= $${params.length + 1}`;
            params.push(endDate);
        }
        
        query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(query, params);
        
        res.json({
            symbol: symbol,
            data: result.rows.map(row => ({
                timestamp: row.timestamp,
                open: parseFloat(row.open),
                high: parseFloat(row.high),
                low: parseFloat(row.low),
                close: parseFloat(row.close),
                volume: parseInt(row.volume)
            }))
        });
    } catch (error) {
        console.error('Get stock history error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocks/search', async (req, res) => {
    try {
        const pattern = req.query.q || '';
        const limit = parseInt(req.query.limit) || 20;
        
        if (!pattern) {
            return res.json([]);
        }
        
        const result = await pool.query(`
            SELECT DISTINCT symbol 
            FROM stock_symbols 
            WHERE symbol ILIKE $1 
            ORDER BY symbol 
            LIMIT $2
        `, [`%${pattern}%`, limit]);
        
        res.json(result.rows.map(row => row.symbol));
    } catch (error) {
        console.error('Search stocks error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stocks/:symbol/date/:date', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const date = req.params.date; 
        
        const result = await pool.query(`
            SELECT timestamp, open, high, low, close, volume 
            FROM stocks 
            WHERE symbol = $1 AND timestamp = $2
        `, [symbol, date]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Stock data not found for this date' });
        }
        
        const row = result.rows[0];
        res.json({
            symbol: symbol,
            timestamp: row.timestamp,
            open: parseFloat(row.open),
            high: parseFloat(row.high),
            low: parseFloat(row.low),
            close: parseFloat(row.close),
            volume: parseInt(row.volume)
        });
    } catch (error) {
        console.error('Get stock by date error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/portfolios/:id/statistics', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const username = req.headers['x-username'] || req.query.username;
        const startDate = req.query.start_date || null;
        const endDate = req.query.end_date || null;
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM creates_portfolio
            WHERE portfolio_id = $1 AND username = $2
        `, [portfolioId, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Portfolio not found or access denied' });
        }
        
        const holdingsResult = await pool.query(`
            SELECT DISTINCT stock_symbol FROM stock_holding
            WHERE portfolio_id = $1
        `, [portfolioId]);
        
        if (holdingsResult.rows.length === 0) {
            return res.json({
                stocks: [],
                correlation_matrix: [],
                message: 'No holdings in portfolio'
            });
        }
        
        const symbols = holdingsResult.rows.map(row => row.stock_symbol);
        
        const { stockStats, correlationMatrix } = await computeStatisticsForSymbols(symbols, startDate, endDate);
        
        res.json({
            stocks: stockStats,
            correlation_matrix: correlationMatrix,
            symbols: symbols
        });
    } catch (error) {
        console.error('Get portfolio statistics error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

app.get('/api/portfolios/:id/holdings/:symbol/history', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const symbol = req.params.symbol.toUpperCase();
        const username = req.headers['x-username'] || req.query.username;
        const interval = req.query.interval || 'all'; 
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM stock_holding sh
            JOIN creates_portfolio cp ON sh.portfolio_id = cp.portfolio_id
            WHERE sh.portfolio_id = $1 AND sh.stock_symbol = $2 AND cp.username = $3
        `, [portfolioId, symbol, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Stock not found in portfolio or access denied' });
        }
        
        let startDate = null;
        if (interval !== 'all') {
            const now = new Date();
            let date = new Date();
            
            switch (interval) {
                case 'week':
                    date.setDate(now.getDate() - 7);
                    break;
                case 'month':
                    date.setMonth(now.getMonth() - 1);
                    break;
                case 'quarter':
                    date.setMonth(now.getMonth() - 3);
                    break;
                case 'year':
                    date.setFullYear(now.getFullYear() - 1);
                    break;
                case '5years':
                    date.setFullYear(now.getFullYear() - 5);
                    break;
            }
            
            startDate = date.toISOString().split('T')[0];
        }
        
        let query = `
            SELECT timestamp, open, high, low, close, volume 
            FROM stocks 
            WHERE symbol = $1
        `;
        const queryParams = [symbol];
        
        if (startDate) {
            query += ` AND timestamp >= $2`;
            queryParams.push(startDate);
        }
        
        query += ` ORDER BY timestamp ASC`;
        
        const result = await pool.query(query, queryParams);
        
        res.json({
            symbol: symbol,
            interval: interval,
            data: result.rows.map(row => ({
                timestamp: row.timestamp,
                open: parseFloat(row.open),
                high: parseFloat(row.high),
                low: parseFloat(row.low),
                close: parseFloat(row.close),
                volume: parseInt(row.volume)
            }))
        });
    } catch (error) {
        console.error('Get stock history error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/portfolios/:id/holdings/:symbol/predictions', async (req, res) => {
    try {
        const portfolioId = parseInt(req.params.id);
        const symbol = req.params.symbol.toUpperCase();
        const username = req.headers['x-username'] || req.query.username;
        const days = parseInt(req.query.days) || 30; 
        
        const ownershipResult = await pool.query(`
            SELECT COUNT(*) FROM stock_holding sh
            JOIN creates_portfolio cp ON sh.portfolio_id = cp.portfolio_id
            WHERE sh.portfolio_id = $1 AND sh.stock_symbol = $2 AND cp.username = $3
        `, [portfolioId, symbol, username]);
        
        if (ownershipResult.rows[0].count === '0') {
            return res.status(403).json({ success: false, message: 'Stock not found in portfolio or access denied' });
        }
        
        const historyResult = await pool.query(`
            SELECT close, timestamp 
            FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC 
            LIMIT 60
        `, [symbol]);
        
        if (historyResult.rows.length < 2) {
            return res.status(400).json({ success: false, message: 'Insufficient historical data for prediction' });
        }
        
        const prices = historyResult.rows.reverse().map(row => parseFloat(row.close));
        const lastDate = new Date(historyResult.rows[historyResult.rows.length - 1].timestamp);
        
        const n = prices.length;
        const x = Array.from({ length: n }, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = prices.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * prices[i], 0);
        const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        const predictions = [];
        const lastPrice = prices[prices.length - 1];
        
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        const historicalVolatilityPercent = calculateVolatility(prices);
        const meanReversionFactor = 0.1;
        const confidenceMultiplier = 2.0;
        
        for (let i = 1; i <= days; i++) {
            const futureDate = new Date(lastDate);
            futureDate.setDate(futureDate.getDate() + i);
            
            const futureTimeIndex = n + i - 1;
            const trendPrediction = intercept + slope * futureTimeIndex;
            const meanReversionAdjustment = meanReversionFactor * (mean - trendPrediction);
            const predictedPrice = trendPrediction + meanReversionAdjustment;
            
            const confidenceRange = Math.abs(predictedPrice * historicalVolatilityPercent * confidenceMultiplier);
            
            predictions.push({
                date: futureDate.toISOString().split('T')[0],
                predicted_price: Math.max(0, predictedPrice), 
                confidence_interval_low: Math.max(0, predictedPrice - confidenceRange),
                confidence_interval_high: predictedPrice + confidenceRange
            });
        }
        
        res.json({
            symbol: symbol,
            days: days,
            last_known_price: lastPrice,
            last_known_date: lastDate.toISOString().split('T')[0],
            predictions: predictions,
            method: 'linear_regression_with_mean_reversion'
        });
    } catch (error) {
        console.error('Get stock predictions error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    }
});

function calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        if (prices[i - 1] !== 0) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }
    }
    
    if (returns.length === 0) return 0;
    
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
    
    return Math.sqrt(variance);
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`API Server running on http://0.0.0.0:${PORT}`);
    console.log(`Endpoints available at http://0.0.0.0:${PORT}/api`);
    console.log(`External access: http://34.42.29.160:${PORT}/api`);
});

