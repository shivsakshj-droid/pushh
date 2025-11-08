const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../middleware/auth');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Admin login
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔐 Admin login attempt:', username);

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        // Get admin user from database
        const { rows: users } = await pool.query(
            'SELECT id, username, password_hash, role FROM admin_users WHERE username = $1',
            [username]
        );

        if (users.length === 0) {
            console.log('❌ Admin login failed: user not found');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const adminUser = users[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, adminUser.password_hash);
        if (!validPassword) {
            console.log('❌ Admin login failed: invalid password');
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await pool.query(
            'UPDATE admin_users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
            [adminUser.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { 
                id: adminUser.id, 
                username: adminUser.username, 
                role: adminUser.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`✅ Admin login successful: ${username}`);

        res.json({
            success: true,
            token,
            user: {
                id: adminUser.id,
                username: adminUser.username,
                role: adminUser.role
            }
        });

    } catch (error) {
        console.error('❌ Admin login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get devices with pagination and filters
router.get('/devices', authenticateToken, async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 50, 
            status, 
            search, 
            browser, 
            os, 
            deviceType,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = req.query;

        const offset = (page - 1) * limit;

        let query = `
            SELECT 
                id, endpoint, origin, browser_name, browser_version,
                os_name, os_version, language, timezone, device_type,
                ip_address, geo_data, site_version, environment, status,
                created_at, last_seen_at, last_notification_at, tags,
                unsubscribed_at
            FROM subscriptions
            WHERE 1=1
        `;
        const values = [];
        let paramCount = 0;

        // Apply filters
        if (status) {
            paramCount++;
            query += ` AND status = $${paramCount}`;
            values.push(status);
        }

        if (browser) {
            paramCount++;
            query += ` AND browser_name = $${paramCount}`;
            values.push(browser);
        }

        if (os) {
            paramCount++;
            query += ` AND os_name = $${paramCount}`;
            values.push(os);
        }

        if (deviceType) {
            paramCount++;
            query += ` AND device_type = $${paramCount}`;
            values.push(deviceType);
        }

        if (search) {
            paramCount++;
            query += ` AND (
                endpoint ILIKE $${paramCount} OR 
                browser_name ILIKE $${paramCount} OR 
                os_name ILIKE $${paramCount} OR
                language ILIKE $${paramCount} OR
                timezone ILIKE $${paramCount}
            )`;
            values.push(`%${search}%`);
        }

        // Validate sort column to prevent SQL injection
        const validSortColumns = ['created_at', 'last_seen_at', 'last_notification_at', 'browser_name', 'os_name'];
        const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';
        const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

        query += ` ORDER BY ${sortColumn} ${validSortOrder} LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        values.push(parseInt(limit), offset);

        const { rows: devices } = await pool.query(query, values);

        // Get total count for pagination
        const countQuery = query.replace(/SELECT.*FROM/, 'SELECT COUNT(*) FROM').split('ORDER BY')[0];
        const { rows: countRows } = await pool.query(countQuery, values.slice(0, -2));
        const total = parseInt(countRows[0].count);

        console.log(`📊 Devices query: ${devices.length} results`);

        res.json({
            success: true,
            devices,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        console.error('❌ Get devices error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get device by ID
router.get('/devices/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { rows: devices } = await pool.query(
            `SELECT 
                id, endpoint, origin, browser_name, browser_version,
                os_name, os_version, language, timezone, device_type,
                ip_address, geo_data, site_version, environment, status,
                created_at, last_seen_at, last_notification_at, tags,
                unsubscribed_at, encrypted_keys
             FROM subscriptions WHERE id = $1`,
            [id]
        );

        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        res.json({
            success: true,
            device: devices[0]
        });

    } catch (error) {
        console.error('Get device error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get analytics data
router.get('/analytics', authenticateToken, async (req, res) => {
    try {
        const { period = '7d' } = req.query;
        
        let interval = '7 days';
        if (period === '30d') interval = '30 days';
        if (period === '90d') interval = '90 days';

        const analyticsQuery = `
            SELECT 
                COUNT(*) as total_subscriptions,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_subscriptions,
                COUNT(CASE WHEN status = 'inactive' THEN 1 END) as inactive_subscriptions,
                COUNT(CASE WHEN status = 'unsubscribed' THEN 1 END) as unsubscribed_subscriptions,
                COUNT(DISTINCT browser_name) as unique_browsers,
                COUNT(DISTINCT os_name) as unique_os,
                COUNT(DISTINCT device_type) as unique_device_types,
                COUNT(DISTINCT language) as unique_languages,
                COUNT(DISTINCT timezone) as unique_timezones
            FROM subscriptions
            WHERE created_at >= NOW() - INTERVAL '${interval}'
        `;

        const browserStatsQuery = `
            SELECT 
                browser_name,
                COUNT(*) as count
            FROM subscriptions
            WHERE created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY browser_name
            ORDER BY count DESC
        `;

        const osStatsQuery = `
            SELECT 
                os_name,
                COUNT(*) as count
            FROM subscriptions
            WHERE created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY os_name
            ORDER BY count DESC
        `;

        const deviceTypeStatsQuery = `
            SELECT 
                device_type,
                COUNT(*) as count
            FROM subscriptions
            WHERE created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY device_type
            ORDER BY count DESC
        `;

        const dailyRegistrationsQuery = `
            SELECT 
                DATE(created_at) as date,
                COUNT(*) as registrations
            FROM subscriptions
            WHERE created_at >= NOW() - INTERVAL '${interval}'
            GROUP BY DATE(created_at)
            ORDER BY date
        `;

        const [analytics, browserStats, osStats, deviceTypeStats, dailyRegistrations] = await Promise.all([
            pool.query(analyticsQuery),
            pool.query(browserStatsQuery),
            pool.query(osStatsQuery),
            pool.query(deviceTypeStatsQuery),
            pool.query(dailyRegistrationsQuery)
        ]);

        res.json({
            success: true,
            summary: analytics.rows[0],
            browserStats: browserStats.rows,
            osStats: osStats.rows,
            deviceTypeStats: deviceTypeStats.rows,
            dailyRegistrations: dailyRegistrations.rows
        });

    } catch (error) {
        console.error('❌ Analytics error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete device (GDPR compliance)
router.delete('/devices/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query('DELETE FROM subscriptions WHERE id = $1 RETURNING id', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        // Log the deletion
        await pool.query(
            'INSERT INTO audit_log (admin_user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, 'DELETE', 'subscription', id, { reason: 'GDPR compliance' }]
        );

        console.log(`🗑️ Device deleted: ${id} by ${req.user.username}`);

        res.json({ 
            success: true, 
            message: 'Device data deleted successfully',
            id: result.rows[0].id
        });
    } catch (error) {
        console.error('❌ Delete device error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export and delete device (GDPR compliance)
router.post('/devices/:id/export-delete', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const { rows: devices } = await pool.query(
            `SELECT 
                id, endpoint, origin, browser_name, browser_version,
                os_name, os_version, language, timezone, device_type,
                site_version, environment, status, created_at, last_seen_at
             FROM subscriptions WHERE id = $1`,
            [id]
        );

        if (devices.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const deviceData = devices[0];

        // Delete the device
        await pool.query('DELETE FROM subscriptions WHERE id = $1', [id]);

        // Log the export and deletion
        await pool.query(
            'INSERT INTO audit_log (admin_user_id, action, resource_type, resource_id, details) VALUES ($1, $2, $3, $4, $5)',
            [req.user.id, 'EXPORT_DELETE', 'subscription', id, { exported: true }]
        );

        console.log(`📤 Device exported and deleted: ${id} by ${req.user.username}`);

        res.json({
            success: true,
            message: 'Data exported and deleted successfully',
            exportedData: deviceData
        });

    } catch (error) {
        console.error('❌ Export/delete error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get browser and OS options for filters
router.get('/filters/options', authenticateToken, async (req, res) => {
    try {
        const [browsers, os, deviceTypes] = await Promise.all([
            pool.query('SELECT DISTINCT browser_name FROM subscriptions WHERE browser_name IS NOT NULL ORDER BY browser_name'),
            pool.query('SELECT DISTINCT os_name FROM subscriptions WHERE os_name IS NOT NULL ORDER BY os_name'),
            pool.query('SELECT DISTINCT device_type FROM subscriptions WHERE device_type IS NOT NULL ORDER BY device_type')
        ]);

        res.json({
            success: true,
            browsers: browsers.rows.map(row => row.browser_name),
            os: os.rows.map(row => row.os_name),
            deviceTypes: deviceTypes.rows.map(row => row.device_type)
        });
    } catch (error) {
        console.error('Filters options error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;