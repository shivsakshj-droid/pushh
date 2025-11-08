// database/init.js
const { Pool } = require('pg');

let isInitialized = false;

const initSchema = `
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT UNIQUE NOT NULL,
    encrypted_keys JSONB NOT NULL,
    origin TEXT,
    browser_name VARCHAR(100),
    browser_version VARCHAR(50),
    os_name VARCHAR(100),
    os_version VARCHAR(50),
    user_agent TEXT,
    language VARCHAR(10),
    timezone VARCHAR(50),
    screen_width INTEGER,
    screen_height INTEGER,
    pixel_ratio DECIMAL(3,2),
    device_type VARCHAR(20),
    ip_address INET,
    geo_data JSONB,
    site_version VARCHAR(20),
    environment VARCHAR(20),
    tags TEXT[] DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_notification_at TIMESTAMP WITH TIME ZONE,
    unsubscribed_at TIMESTAMP WITH TIME ZONE
);

-- Create admin_users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE
);

-- Create notification_clicks table
CREATE TABLE IF NOT EXISTS notification_clicks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT NOT NULL,
    notification_id VARCHAR(100),
    action VARCHAR(50) DEFAULT 'click',
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create notification_sends table
CREATE TABLE IF NOT EXISTS notification_sends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id VARCHAR(100) NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    sent_to_count INTEGER DEFAULT 0,
    successful_sends INTEGER DEFAULT 0,
    failed_sends INTEGER DEFAULT 0,
    sent_by VARCHAR(100),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert admin user (will be updated later to match environment variable)
INSERT INTO admin_users (username, password_hash, role) 
VALUES ('admin', 'admin123', 'admin')
ON CONFLICT (username) DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions(created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_endpoint ON subscriptions(endpoint);
CREATE INDEX IF NOT EXISTS idx_admin_users_username ON admin_users(username);
CREATE INDEX IF NOT EXISTS idx_notification_clicks_endpoint ON notification_clicks(endpoint);
CREATE INDEX IF NOT EXISTS idx_notification_sends_sent_at ON notification_sends(sent_at);
`;

async function initializeDatabase() {
    if (isInitialized || !process.env.DATABASE_URL) {
        return true;
    }

    console.log('🔄 Checking database initialization...');

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
    });

    let client;
    try {
        client = await pool.connect();
        
        // Check if admin_users table exists
        const tableCheck = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'admin_users'
            );
        `);

        const tablesExist = tableCheck.rows[0].exists;

        if (!tablesExist) {
            console.log('📋 Creating database tables...');
            
            // Split schema into individual statements
            const statements = initSchema.split(';').filter(stmt => stmt.trim());
            
            for (let i = 0; i < statements.length; i++) {
                const statement = statements[i].trim();
                if (statement) {
                    try {
                        await client.query(statement);
                    } catch (error) {
                        // Ignore "already exists" errors
                        if (!error.message.includes('already exists') && 
                            !error.message.includes('duplicate key') &&
                            !error.message.includes('extension "uuid-ossp" already exists')) {
                            console.error(`❌ Error executing statement ${i + 1}:`, error.message);
                            throw error;
                        }
                    }
                }
            }
            console.log('✅ Database tables created successfully');
        } else {
            console.log('✅ Database tables already exist');
        }

        // 🔥 CRITICAL FIX: Update admin password to match environment variable
        if (process.env.ADMIN_PASSWORD_HASH) {
            console.log('🔄 Syncing admin password with environment variable...');
            const result = await client.query(
                'UPDATE admin_users SET password_hash = $1 WHERE username = $2 RETURNING username',
                [process.env.ADMIN_PASSWORD_HASH, process.env.ADMIN_USERNAME || 'admin']
            );
            
            if (result.rows.length > 0) {
                console.log('✅ Admin password synced with environment variable');
            } else {
                console.log('⚠️ No admin user found to update');
            }
        }

        isInitialized = true;
        return true;
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        return false;
    } finally {
        if (client) {
            client.release();
        }
        await pool.end();
    }
}

module.exports = initializeDatabase;