const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Encryption functions
function encrypt(text) {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    return {
        iv: iv.toString('hex'),
        data: encrypted,
        authTag: authTag.toString('hex')
    };
}

function getGeoFromIp(ip) {
    try {
        const cleanIp = ip.replace(/^::ffff:/, '').split(':')[0];
        const geo = geoip.lookup(cleanIp);
        
        if (!geo) return null;
        
        // Only return coarse location data for privacy
        return {
            country: geo.country,
            region: geo.region,
            city: geo.city,
            timezone: geo.timezone,
            ll: geo.ll // latitude/longitude (approximate)
        };
    } catch (error) {
        console.error('GeoIP lookup error:', error);
        return null;
    }
}

// Subscribe endpoint
router.post('/subscribe', async (req, res) => {
    try {
        const { subscription, device, siteVersion, environment } = req.body;
        
        console.log('📝 New subscription request');
        
        // Validation
        if (!subscription || !subscription.endpoint) {
            return res.status(400).json({ error: 'Invalid subscription data: endpoint required' });
        }

        if (!subscription.keys || !subscription.keys.p256dh || !subscription.keys.auth) {
            return res.status(400).json({ error: 'Invalid subscription data: keys required' });
        }

        // Parse user agent for additional details
        const parser = new UAParser(device?.userAgent || '');
        const uaResult = parser.getResult();

        // Get geo information from IP (storing only coarse data)
        const clientIp = req.headers['x-forwarded-for'] || 
                        req.headers['x-real-ip'] || 
                        req.connection.remoteAddress || 
                        req.socket.remoteAddress;
        const geo = getGeoFromIp(clientIp);

        console.log(`📍 IP: ${clientIp}, Geo:`, geo ? `${geo.country}, ${geo.city}` : 'Unknown');

        // Encrypt subscription keys
        const encryptedKeys = encrypt(JSON.stringify({
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth
        }));

        // Store subscription in database
        const query = `
            INSERT INTO subscriptions (
                endpoint, encrypted_keys, origin, browser_name, browser_version,
                os_name, os_version, user_agent, language, timezone,
                screen_width, screen_height, pixel_ratio, device_type,
                ip_address, geo_data, site_version, environment, status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            ON CONFLICT (endpoint) 
            DO UPDATE SET 
                encrypted_keys = EXCLUDED.encrypted_keys,
                last_seen_at = CURRENT_TIMESTAMP,
                status = 'active',
                browser_name = EXCLUDED.browser_name,
                browser_version = EXCLUDED.browser_version,
                os_name = EXCLUDED.os_name,
                os_version = EXCLUDED.os_version,
                user_agent = EXCLUDED.user_agent,
                language = EXCLUDED.language,
                timezone = EXCLUDED.timezone,
                screen_width = EXCLUDED.screen_width,
                screen_height = EXCLUDED.screen_height,
                pixel_ratio = EXCLUDED.pixel_ratio,
                device_type = EXCLUDED.device_type,
                ip_address = EXCLUDED.ip_address,
                geo_data = EXCLUDED.geo_data
            RETURNING id, created_at
        `;

        const values = [
            subscription.endpoint,
            encryptedKeys,
            req.get('origin') || 'unknown',
            uaResult.browser.name || 'unknown',
            uaResult.browser.version || 'unknown',
            uaResult.os.name || 'unknown',
            uaResult.os.version || 'unknown',
            device?.userAgent || 'unknown',
            device?.language || 'unknown',
            device?.timezone || 'unknown',
            device?.screen?.width || 0,
            device?.screen?.height || 0,
            device?.screen?.pixelRatio || 1.0,
            device?.type || 'desktop',
            clientIp,
            geo ? JSON.stringify(geo) : null,
            siteVersion || '1.0.0',
            environment || 'production',
            'active'
        ];

        const result = await pool.query(query, values);
        const subscriptionId = result.rows[0].id;

        console.log(`✅ Subscription saved: ${subscriptionId}`);

        res.status(201).json({ 
            success: true, 
            message: 'Subscription saved successfully',
            id: subscriptionId
        });

    } catch (error) {
        console.error('❌ Subscription error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Unsubscribe endpoint
router.post('/unsubscribe', async (req, res) => {
    try {
        const { endpoint } = req.body;

        console.log('📝 Unsubscribe request:', endpoint?.substring(0, 50) + '...');

        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint required' });
        }

        const result = await pool.query(
            'UPDATE subscriptions SET status = $1, unsubscribed_at = CURRENT_TIMESTAMP WHERE endpoint = $2 RETURNING id',
            ['unsubscribed', endpoint]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        console.log(`✅ Unsubscribed: ${result.rows[0].id}`);

        res.json({ 
            success: true, 
            message: 'Unsubscribed successfully',
            id: result.rows[0].id
        });
    } catch (error) {
        console.error('❌ Unsubscribe error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get subscription status (optional)
router.get('/subscription/:endpoint', async (req, res) => {
    try {
        const { endpoint } = req.params;

        const result = await pool.query(
            'SELECT id, status, created_at, last_seen_at FROM subscriptions WHERE endpoint = $1',
            [decodeURIComponent(endpoint)]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Subscription not found' });
        }

        res.json({
            success: true,
            subscription: result.rows[0]
        });
    } catch (error) {
        console.error('Subscription status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Add a simple test route
router.get('/test', (req, res) => {
    res.json({ message: 'Subscriptions route working' });
});

module.exports = router;