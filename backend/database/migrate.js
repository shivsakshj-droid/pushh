const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigrations() {
    console.log('Starting database migrations...');
    
    // Database connection
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        // Test connection
        await pool.query('SELECT NOW()');
        console.log('✅ Database connection successful');

        // Read and execute schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📋 Executing schema...');
        await pool.query(schema);
        console.log('✅ Database schema created successfully');

        // Update admin password if provided
        if (process.env.ADMIN_PASSWORD_HASH) {
            console.log('🔑 Updating admin password...');
            await pool.query(
                'UPDATE admin_users SET password_hash = $1 WHERE username = $2',
                [process.env.ADMIN_PASSWORD_HASH, process.env.ADMIN_USERNAME || 'admin']
            );
            console.log('✅ Admin password updated');
        }

        // Verify tables were created
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        
        console.log('📊 Created tables:');
        tables.rows.forEach(table => {
            console.log(`   - ${table.table_name}`);
        });

        // Count subscriptions for verification
        const countResult = await pool.query('SELECT COUNT(*) as count FROM subscriptions');
        console.log(`📱 Total subscriptions: ${countResult.rows[0].count}`);

        console.log('🎉 Database migrations completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Run migrations if this file is executed directly
if (require.main === module) {
    runMigrations().catch(console.error);
}

module.exports = runMigrations;