-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT UNIQUE NOT NULL,
    encrypted_keys JSONB NOT NULL,
    origin TEXT,
    
    -- Browser information
    browser_name VARCHAR(100),
    browser_version VARCHAR(50),
    
    -- OS information
    os_name VARCHAR(100),
    os_version VARCHAR(50),
    
    -- Device information
    user_agent TEXT,
    language VARCHAR(10),
    timezone VARCHAR(50),
    screen_width INTEGER,
    screen_height INTEGER,
    pixel_ratio DECIMAL(3,2),
    device_type VARCHAR(20) CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
    
    -- Location information (coarse only for privacy)
    ip_address INET,
    geo_data JSONB,
    
    -- Application context
    site_version VARCHAR(20),
    environment VARCHAR(20),
    
    -- Tags for segmentation
    tags TEXT[] DEFAULT '{}',
    
    -- Status tracking
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unsubscribed', 'blocked')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_notification_at TIMESTAMP WITH TIME ZONE,
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    
    -- Indexes for performance
    CONSTRAINT unique_endpoint UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at ON subscriptions(created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_browser ON subscriptions(browser_name);
CREATE INDEX IF NOT EXISTS idx_subscriptions_os ON subscriptions(os_name);
CREATE INDEX IF NOT EXISTS idx_subscriptions_device_type ON subscriptions(device_type);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tags ON subscriptions USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_subscriptions_last_seen ON subscriptions(last_seen_at);

-- Notification clicks tracking
CREATE TABLE IF NOT EXISTS notification_clicks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    endpoint TEXT NOT NULL,
    notification_id VARCHAR(100),
    action VARCHAR(50) DEFAULT 'click',
    clicked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_notification_clicks_endpoint (endpoint),
    INDEX idx_notification_clicks_clicked_at (clicked_at)
);

-- Notification sends tracking
CREATE TABLE IF NOT EXISTS notification_sends (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id VARCHAR(100) NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    sent_to_count INTEGER DEFAULT 0,
    successful_sends INTEGER DEFAULT 0,
    failed_sends INTEGER DEFAULT 0,
    sent_by VARCHAR(100),
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_notification_sends_sent_at (sent_at),
    INDEX idx_notification_sends_notification_id (notification_id)
);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- Indexes
    INDEX idx_admin_users_username (username)
);

-- Audit log for admin actions
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Indexes
    INDEX idx_audit_log_created_at (created_at),
    INDEX idx_audit_log_admin_user (admin_user_id)
);

-- Insert default admin user (password will be set via environment variable)
INSERT INTO admin_users (username, password_hash, role) 
VALUES (
    'admin', 
    '$2a$12$LQv3c1yqBzwL0UY2Iz5MZuYlMLsrfHFYLKZf7xXFzU7RqR9S7pzOa', -- default: admin123
    'admin'
) ON CONFLICT (username) DO NOTHING;

-- Create function to update last_seen_at
CREATE OR REPLACE FUNCTION update_last_seen_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_seen_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update last_seen_at
CREATE OR REPLACE TRIGGER trigger_update_last_seen_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_last_seen_at();

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_subscriptions_composite ON subscriptions (status, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_geo ON subscriptions USING gin(geo_data);