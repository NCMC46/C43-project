require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'mydb',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
});

async function loadCSVData() {
    const csvPath = path.join(__dirname, '..', 'SP500History.csv');
    
    if (!fs.existsSync(csvPath)) {
        console.error(`CSV file not found at: ${csvPath}`);
        process.exit(1);
    }
    
    console.log('Reading CSV file...');
    const csvContent = fs.readFileSync(csvPath, 'utf-8');
    const lines = csvContent.split('\n').filter(line => line.trim());
    
    console.log(`Found ${lines.length - 1} data rows (excluding header)`);
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let inserted = 0;
        let skipped = 0;
        let symbols = new Set();
        
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const columns = line.split(',');
            if (columns.length < 7) {
                console.log(`Skipping malformed line ${i + 1}`);
                skipped++;
                continue;
            }
            
            const timestamp = columns[0].trim();
            const open = parseFloat(columns[1].trim());
            const high = parseFloat(columns[2].trim());
            const low = parseFloat(columns[3].trim());
            const close = parseFloat(columns[4].trim());
            const volume = parseInt(columns[5].trim());
            const symbol = columns[6].trim().toUpperCase();
            
            if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(volume) || !symbol) {
                skipped++;
                continue;
            }
            
            symbols.add(symbol);
            
            try {
                await client.query(`
                    INSERT INTO stocks(symbol, timestamp, open, high, low, close, volume)
                    VALUES($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (symbol, timestamp) DO NOTHING
                `, [symbol, timestamp, open, high, low, close, volume]);
                
                inserted++;
                
                if (inserted % 10000 === 0) {
                    console.log(`Processed ${inserted} rows...`);
                }
            } catch (error) {
                if (error.code !== '23505') {
                    console.error(`Error inserting row ${i + 1}:`, error.message);
                }
                skipped++;
            }
        }
        
        console.log('\nInserting stock symbols into stock_symbols table...');
        for (const symbol of symbols) {
            await client.query(
                'INSERT INTO stock_symbols(symbol) VALUES($1) ON CONFLICT DO NOTHING',
                [symbol]
            );
        }
        
        await client.query('COMMIT');
        
        console.log('\n=== Load Complete ===');
        console.log(`Total rows inserted: ${inserted}`);
        console.log(`Rows skipped: ${skipped}`);
        console.log(`Unique symbols: ${symbols.size}`);
        console.log('CSV data loaded successfully!');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error loading CSV:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

loadCSVData().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

