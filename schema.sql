DROP TABLE IF EXISTS statistics_cache CASCADE;
DROP TABLE IF EXISTS has_transaction CASCADE;
DROP TABLE IF EXISTS transaction_history CASCADE;
DROP TABLE IF EXISTS stock_holding CASCADE;
DROP TABLE IF EXISTS has_holding CASCADE;
DROP TABLE IF EXISTS owns CASCADE;
DROP TABLE IF EXISTS portfolios CASCADE;
DROP TABLE IF EXISTS creates_portfolio CASCADE;
DROP TABLE IF EXISTS stocklist_items CASCADE;
DROP TABLE IF EXISTS has_item CASCADE;
DROP TABLE IF EXISTS shares_stocklist CASCADE;
DROP TABLE IF EXISTS stock_lists CASCADE;
DROP TABLE IF EXISTS creates_stocklist CASCADE;
DROP TABLE IF EXISTS writes CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS receives CASCADE;
DROP TABLE IF EXISTS friend_request_cooldowns CASCADE;
DROP TABLE IF EXISTS friend_requests CASCADE;
DROP TABLE IF EXISTS has_friend CASCADE;
DROP TABLE IF EXISTS stocks CASCADE;
DROP TABLE IF EXISTS stock_symbols CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Entity: users
CREATE TABLE users (
    username VARCHAR(50) PRIMARY KEY,
    password VARCHAR(255) NOT NULL
);

-- Entity: stocks
CREATE TABLE stocks (
    symbol VARCHAR(5),
    timestamp DATE,
    open REAL,
    high REAL,
    low REAL,
    close REAL,
    volume INT,
    PRIMARY KEY (symbol, timestamp)
);

-- Reference table for distinct stock symbols
CREATE TABLE stock_symbols (
    symbol VARCHAR(5) PRIMARY KEY
);

-- Entity: portfolios
CREATE TABLE portfolios (
    portfolio_id SERIAL PRIMARY KEY,
    cash_account REAL DEFAULT 0.0 NOT NULL
);

-- Relationship: creates_portfolio
CREATE TABLE creates_portfolio (
    username VARCHAR(50),
    portfolio_id INT,
    PRIMARY KEY (username, portfolio_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE
);

-- Relationship: owns
CREATE TABLE owns (
    username VARCHAR(50),
    portfolio_id INT,
    symbol VARCHAR(5),
    PRIMARY KEY (username, portfolio_id, symbol),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
    FOREIGN KEY (symbol) REFERENCES stock_symbols(symbol) ON DELETE CASCADE
);

-- Relationship: has_friend
CREATE TABLE has_friend (
    username VARCHAR(50),
    friend_username VARCHAR(50),
    PRIMARY KEY (username, friend_username),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (friend_username) REFERENCES users(username) ON DELETE CASCADE,
    CHECK (username != friend_username)
);

-- Entity: friend_requests
CREATE TABLE friend_requests (
    pending_user VARCHAR(50),
    sent_user VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (pending_user, sent_user),
    FOREIGN KEY (pending_user) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (sent_user) REFERENCES users(username) ON DELETE CASCADE
);

-- Relationship: receives
CREATE TABLE receives (
    username VARCHAR(50),
    pending_user VARCHAR(50),
    sent_user VARCHAR(50),
    PRIMARY KEY (username, pending_user, sent_user),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (pending_user, sent_user) REFERENCES friend_requests(pending_user, sent_user) ON DELETE CASCADE
);

-- Friend request cooldowns
CREATE TABLE friend_request_cooldowns (
    requester VARCHAR(50) NOT NULL,
    target VARCHAR(50) NOT NULL,
    cooldown_until TIMESTAMP NOT NULL,
    reason VARCHAR(20) NOT NULL,
    PRIMARY KEY (requester, target),
    FOREIGN KEY (requester) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES users(username) ON DELETE CASCADE
);

CREATE TABLE reviews (
    review_id SERIAL PRIMARY KEY,
    content VARCHAR(4000) NOT NULL,
    stock_list_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CHECK (char_length(content) <= 4000)
);

-- Relationship: writes
CREATE TABLE writes (
    review_id INT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (review_id) REFERENCES reviews(review_id) ON DELETE CASCADE
);


-- Relationship: has_holding
CREATE TABLE has_holding (
    portfolio_id INT,
    stock_symbol VARCHAR(5),
    PRIMARY KEY (portfolio_id, stock_symbol),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
    FOREIGN KEY (stock_symbol) REFERENCES stock_symbols(symbol) ON DELETE CASCADE
);

-- Entity: stock_holding (with shares attribute)
CREATE TABLE stock_holding (
    portfolio_id INT,
    stock_symbol VARCHAR(5),
    shares REAL NOT NULL CHECK (shares >= 0),
    PRIMARY KEY (portfolio_id, stock_symbol),
    FOREIGN KEY (portfolio_id, stock_symbol) REFERENCES has_holding(portfolio_id, stock_symbol) ON DELETE CASCADE
);

-- Entity: transaction_history
CREATE TABLE transaction_history (
    transaction_id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    portfolio_id INT NOT NULL,
    stock_symbol VARCHAR(5),
    transaction_type VARCHAR(10) NOT NULL CHECK (transaction_type IN ('BUY', 'SELL', 'DEPOSIT', 'WITHDRAW')),
    shares REAL,
    price REAL,
    timestamp TIMESTAMP NOT NULL,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
    FOREIGN KEY (stock_symbol) REFERENCES stock_symbols(symbol) ON DELETE SET NULL
);

-- Relationship: has_transaction
CREATE TABLE has_transaction (
    portfolio_id INT,
    transaction_id INT,
    PRIMARY KEY (portfolio_id, transaction_id),
    FOREIGN KEY (portfolio_id) REFERENCES portfolios(portfolio_id) ON DELETE CASCADE,
    FOREIGN KEY (transaction_id) REFERENCES transaction_history(transaction_id) ON DELETE CASCADE
);

-- Entity: stock_lists
CREATE TABLE stock_lists (
    stock_list_id SERIAL PRIMARY KEY,
    visibility VARCHAR(10) NOT NULL CHECK (visibility IN ('private', 'shared', 'public'))
);

-- Relationship: creates_stocklist
CREATE TABLE creates_stocklist (
    username VARCHAR(50),
    stock_list_id INT,
    PRIMARY KEY (username, stock_list_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (stock_list_id) REFERENCES stock_lists(stock_list_id) ON DELETE CASCADE
);

-- Relationship: shares_stocklist
CREATE TABLE shares_stocklist (
    username VARCHAR(50),
    stock_list_id INT,
    PRIMARY KEY (username, stock_list_id),
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE,
    FOREIGN KEY (stock_list_id) REFERENCES stock_lists(stock_list_id) ON DELETE CASCADE
);

-- Relationship: has_item
CREATE TABLE has_item (
    stock_list_id INT,
    stock_symbol VARCHAR(5),
    PRIMARY KEY (stock_list_id, stock_symbol),
    FOREIGN KEY (stock_list_id) REFERENCES stock_lists(stock_list_id) ON DELETE CASCADE,
    FOREIGN KEY (stock_symbol) REFERENCES stock_symbols(symbol) ON DELETE CASCADE
);

-- Entity: stocklist_items (with shares attribute)
CREATE TABLE stocklist_items (
    stock_list_id INT,
    stock_symbol VARCHAR(5),
    shares REAL NOT NULL CHECK (shares >= 0),
    PRIMARY KEY (stock_list_id, stock_symbol),
    FOREIGN KEY (stock_list_id, stock_symbol) REFERENCES has_item(stock_list_id, stock_symbol) ON DELETE CASCADE
);

-- Add foreign key constraint for reviews to stock_lists
ALTER TABLE reviews ADD CONSTRAINT fk_reviews_stock_list 
    FOREIGN KEY (stock_list_id) REFERENCES stock_lists(stock_list_id) ON DELETE CASCADE;

-- Create indexes
CREATE INDEX idx_stocks_symbol ON stocks(symbol);
CREATE INDEX idx_stocks_timestamp ON stocks(timestamp);
CREATE INDEX idx_stocks_symbol_timestamp ON stocks(symbol, timestamp);
CREATE INDEX idx_transaction_history_username ON transaction_history(username);
CREATE INDEX idx_transaction_history_portfolio_id ON transaction_history(portfolio_id);
CREATE INDEX idx_transaction_history_timestamp ON transaction_history(timestamp);
CREATE INDEX idx_reviews_stock_list_id ON reviews(stock_list_id);
CREATE INDEX idx_stock_holding_portfolio_id ON stock_holding(portfolio_id);
CREATE INDEX idx_stocklist_items_stock_list_id ON stocklist_items(stock_list_id);

-- Cache table for portfolio/stocklist statistics
CREATE TABLE statistics_cache (
    cache_key VARCHAR(255) PRIMARY KEY,
    symbols TEXT[] NOT NULL,
    start_date DATE,
    end_date DATE,
    stock_stats JSONB NOT NULL,
    correlation_matrix JSONB NOT NULL,
    computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
    latest_data_timestamp TIMESTAMP NOT NULL
);

CREATE INDEX idx_statistics_cache_computed_at ON statistics_cache(computed_at);
CREATE INDEX idx_statistics_cache_latest_data ON statistics_cache(latest_data_timestamp);

