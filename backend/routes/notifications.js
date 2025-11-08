const express = require('express');
const router = express.Router();
const webPush = require('web-push');
const { Pool } = require('pg');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Decryption function
function decrypt(encryptedData) {
    try {
        const algorithm = 'aes-256-gcm';
        const key = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'salt', 32);
        const iv = Buffer.from(encryptedData.iv, 'hex');
        
        const decipher = crypto.createDecipher(algorithm, key);
        decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        throw new Error('Failed to decrypt subscription keys');
    }
}

// Send notification to multiple devices
router.post('/notify', authenticateToken, async (req, res) => {
    try {
        const { 
            title, 
            body, 
            icon = '/icon-192.png', 
            badge = '/icon-192.png', 
            url = '/', 
            ttl = 2419200, 
            actions = [], 
            tag = 'general', 
            requireInteraction = false, 
            deviceIds = [], 
            tags = [] 
        } = req.body;

        console.log('📤 Sending notification:', title);

        if (!title) {
            return res.status(400).json({ error: 'Notification title is required' });
        }

        // Build query based on filters
        let query = 'SELECT id, endpoint, encrypted_keys FROM subscriptions WHERE status = $1';
        const values = ['active'];
        let paramCount = 1;

        if (deviceIds && deviceIds.length > 0) {
            paramCount++;
            query += ` AND id = ANY($${paramCount})`;
            values.push(deviceIds);
        }

        if (tags && tags.length > 0) {
            paramCount++;
            query += ` AND tags && $${paramCount}`;
            values.push(tags);
        }

        const { rows: subscriptions } = await pool.query(query, values);

        if (subscriptions.length === 0) {
            return res.status(404).json({ error: 'No active subscriptions found' });
        }

        console.log(`📱 Sending to ${subscriptions.length} devices`);

        const notificationId = crypto.randomUUID();
        const notificationPayload = {
            title,
            body: body || '',
            icon: icon,
            badge: badge,
            data: {
                url: url,
                id: notificationId,
                timestamp: new Date().toISOString()
            },
            actions: actions,
            tag: tag,
            requireInteraction: requireInteraction
        };

        const results = {
            sent: 0,
            failed: 0,
            errors: []
        };

        // Send notifications in batches to avoid overwhelming the server
        const BATCH_SIZE = 10;
        const batches = [];
        
        for (let i = 0; i < subscriptions.length; i += BATCH_SIZE) {
            batches.push(subscriptions.slice(i, i + BATCH_SIZE));
        }

        for (const batch of batches) {
            const batchPromises = batch.map(async (sub) => {
                try {
                    const decryptedKeys = JSON.parse(decrypt(sub.encrypted_keys));
                    
                    const pushSubscription = {
                        endpoint: sub.endpoint,
                        keys: decryptedKeys
                    };

                    await webPush.sendNotification(
                        pushSubscription,
                        JSON.stringify(notificationPayload),
                        { 
                            TTL: ttl,
                            urgency: 'normal'
                        }
                    );

                    // Update last notification time
                    await pool.query(
                        'UPDATE subscriptions SET last_notification_at = CURRENT_TIMESTAMP WHERE id = $1',
                        [sub.id]
                    );

                    results.sent++;
                    
                } catch (error) {
                    console.error(`❌ Failed to send to ${sub.endpoint}:`, error.message);
                    
                    results.failed++;
                    results.errors.push({
                        deviceId: sub.id,
                        endpoint: sub.endpoint.substring(0, 50) + '...',
                        error: error.message
                    });

                    // If subscription is invalid, mark as inactive
                    if (error.statusCode === 410 || error.statusCode === 404) {
                        await pool.query(
                            'UPDATE subscriptions SET status = $1 WHERE id = $2',
                            ['inactive', sub.id]
                        );
                        console.log(`🔄 Marked subscription as inactive: ${sub.id}`);
                    }
                }
            });

            await Promise.allSettled(batchPromises);
            
            // Small delay between batches to avoid rate limiting
            if (batches.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Log the send operation
        await pool.query(
            `INSERT INTO notification_sends (notification_id, title, body, sent_to_count, successful_sends, failed_sends, sent_by) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [notificationId, title, body, subscriptions.length, results.sent, results.failed, req.user.username]
        );

        console.log(`✅ Notification sent: ${results.sent} successful, ${results.failed} failed`);

        res.json({
            success: true,
            message: `Notifications sent: ${results.sent} successful, ${results.failed} failed`,
            notificationId,
            results
        });

    } catch (error) {
        console.error('❌ Notification send error:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Send test notification to single device
router.post('/notify/test', authenticateToken, async (req, res) => {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID is required' });
        }

        // Get device subscription
        const { rows: devices } = await pool.query(
            'SELECT id, endpoint, encrypted_keys FROM subscriptions WHERE id = $1 AND status = $2',
            [deviceId, 'active']
        );

        if (devices.length === 0) {
            return res.status(404).json({ error: 'Active device not found' });
        }

        const device = devices[0];
        const notificationId = crypto.randomUUID();

        const notificationPayload = {
            title: 'Test Notification',
            body: 'This is a test notification from your dashboard',
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            data: {
                url: '/',
                id: notificationId,
                timestamp: new Date().toISOString()
            },
            tag: 'test'
        };

        try {
            const decryptedKeys = JSON.parse(decrypt(device.encrypted_keys));
            const pushSubscription = {
                endpoint: device.endpoint,
                keys: decryptedKeys
            };

            await webPush.sendNotification(pushSubscription, JSON.stringify(notificationPayload));
            
            // Update last notification time
            await pool.query(
                'UPDATE subscriptions SET last_notification_at = CURRENT_TIMESTAMP WHERE id = $1',
                [deviceId]
            );

            console.log(`✅ Test notification sent to: ${deviceId}`);

            res.json({
                success: true,
                message: 'Test notification sent successfully',
                notificationId
            });

        } catch (error) {
            console.error(`❌ Test notification failed:`, error);
            
            // Mark as inactive if invalid
            if (error.statusCode === 410 || error.statusCode === 404) {
                await pool.query(
                    'UPDATE subscriptions SET status = $1 WHERE id = $2',
                    ['inactive', deviceId]
                );
            }

            res.status(500).json({
                error: 'Failed to send test notification',
                details: error.message
            });
        }

    } catch (error) {
        console.error('Test notification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Track notification clicks
router.post('/notification-click', async (req, res) => {
    try {
        const { endpoint, notificationId, action = 'click' } = req.body;

        if (!endpoint) {
            return res.status(400).json({ error: 'Endpoint is required' });
        }

        await pool.query(
            `INSERT INTO notification_clicks (endpoint, notification_id, action, clicked_at) 
             VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
            [endpoint, notificationId, action]
        );

        console.log(`📊 Notification click tracked: ${notificationId}`);

        res.json({ 
            success: true, 
            message: 'Click tracked successfully' 
        });
    } catch (error) {
        console.error('❌ Click tracking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;