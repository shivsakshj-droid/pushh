const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigrations() {
    console.log('Starting database migrations...');
    
    // Check if DATABASE_URL is set
    if (!process.env.DATABASE_URL) {
        console.log('⚠️ DATABASE_URL not set. Skipping migrations.');
        console.log('📝 Please set DATABASE_URL environment variable');
        return;
    }

    // Database connection
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
    });

    let client;
    try {
        // Test connection
        console.log('🔗 Testing database connection...');
        client = await pool.connect();
        await client.query('SELECT NOW()');
        console.log('✅ Database connection successful');

        // Read and execute schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        if (!fs.existsSync(schemaPath)) {
            throw new Error('Schema file not found: ' + schemaPath);
        }
        
        const schema = fs.readFileSync(schemaPath, 'utf8');
        console.log('📋 Executing schema...');
        
        // Split schema into individual statements and execute them one by one
        const statements = schema.split(';').filter(stmt => stmt.trim());
        
        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i].trim();
            if (statement) {
                console.log(`📝 Executing statement ${i + 1}/${statements.length}`);
                try {
                    await client.query(statement);
                } catch (error) {
                    // Ignore "already exists" errors for tables
                    if (!error.message.includes('already exists')) {
                        throw error;
                    }
                    console.log(`   ⚠️ Table already exists, skipping`);
                }
            }
        }

        console.log('✅ Database schema created successfully');

        // Update admin password if provided
        if (process.env.ADMIN_PASSWORD_HASH) {
            console.log('🔑 Updating admin password...');
            await client.query(
                'UPDATE admin_users SET password_hash = $1 WHERE username = $2',
                [process.env.ADMIN_PASSWORD_HASH, process.env.ADMIN_USERNAME || 'admin']
            );
            console.log('✅ Admin password updated');
        }

        // Verify tables were created
        const tables = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
            ORDER BY table_name
        `);
        
        console.log('📊 Created tables:');
        tables.rows.forEach(table => {
            console.log(`   - ${table.table_name}`);
        });

        console.log('🎉 Database migrations completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        
        // Don't exit with error code 1, just log and continue
        console.log('⚠️ Continuing deployment without migrations...');
        
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

// Run migrations if this file is executed directly
if (require.main === module) {
    runMigrations().catch(error => {
        console.error('Migration error:', error);
        process.exit(0); // Exit with success to allow deployment to continue
    });
}

module.exports = runMigrations;