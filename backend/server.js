require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const webPush = require('web-push');

// Import routes
const subscriptionRoutes = require('./routes/subscriptions');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');

const app = express();
const port = process.env.PORT || 3000;

// FIX: Add trust proxy for Render (REQUIRED for rate limiting)
app.set('trust proxy', 1);

// Validate environment variables
console.log('🔧 Checking environment configuration...');

const requiredEnvVars = [
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_CONTACT_EMAIL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'DATABASE_URL'
];

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(envVar => {
    console.error(`   - ${envVar}`);
  });
  
  if (process.env.NODE_ENV === 'production') {
    console.error('🚨 Cannot start in production without required environment variables');
    process.exit(1);
  } else {
    console.warn('⚠️  Starting in development mode with missing variables');
  }
} else {
  console.log('✅ All required environment variables are set');
}

// VAPID keys setup
console.log('Initializing VAPID with public key:', process.env.VAPID_PUBLIC_KEY ? process.env.VAPID_PUBLIC_KEY.substring(0, 20) + '...' : 'Not set');

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  const vapidKeys = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY
  };

  webPush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT_EMAIL}`,
    vapidKeys.publicKey,
    vapidKeys.privateKey
  );
  console.log('✅ VAPID initialized successfully');
} else {
  console.warn('⚠️ VAPID keys not set - push notifications will not work');
}

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false
}));

// CORS configuration
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = process.env.ALLOWED_ORIGINS ? 
            process.env.ALLOWED_ORIGINS.split(',') : [];
        
        // Add your frontend domain
        if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('newpal.sbs')) {
            callback(null, true);
        } else {
            console.log('CORS blocked for origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// FIX: Database auto-initialization
const initializeDatabase = require('./database/init');

// Initialize database on first API call (except health check)
app.use(async (req, res, next) => {
    if (process.env.DATABASE_URL && !req.path.includes('/health')) {
        await initializeDatabase();
    }
    next();
});

// Rate limiting (now works with trust proxy)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false
});

const subscribeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // limit each IP to 10 subscribe requests per hour
    message: {
        error: 'Too many subscription attempts, please try again later.'
    }
});

const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 50 requests per windowMs
    message: {
        error: 'Too many admin requests, please try again later.'
    }
});

// Apply rate limiting
app.use('/api/', apiLimiter);
app.use('/api/subscribe', subscribeLimiter);
app.use('/api/admin', adminLimiter);

// Routes
app.use('/api', subscriptionRoutes);
app.use('/api', notificationRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint (no database initialization to avoid blocking)
app.get('/health', async (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Web Push Backend',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        database: process.env.DATABASE_URL ? 'configured' : 'not_configured',
        vapid: process.env.VAPID_PUBLIC_KEY ? 'configured' : 'not_configured'
    };

    res.json(health);
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({ 
        message: 'Web Push Notification Backend API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            subscribe: '/api/subscribe',
            unsubscribe: '/api/unsubscribe',
            admin: '/api/admin/*'
        },
        status: 'running'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// Global error handler
app.use((error, req, res, next) => {
    console.error('Global error handler:', error);
    
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({
            error: 'Invalid JSON in request body'
        });
    }
    
    res.status(500).json({
        error: process.env.NODE_ENV === 'production' 
            ? 'Internal server error' 
            : error.message
    });
});

// Add this route to check current environment settings
app.get('/debug-settings', (req, res) => {
    res.json({
        admin_username: process.env.ADMIN_USERNAME,
        admin_password_hash: process.env.ADMIN_PASSWORD_HASH,
        admin_password_hash_length: process.env.ADMIN_PASSWORD_HASH ? process.env.ADMIN_PASSWORD_HASH.length : 0,
        jwt_secret_set: !!process.env.JWT_SECRET,
        environment: process.env.NODE_ENV
    });
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Web Push Backend running on port ${port}`);
    console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🌐 CORS allowed origins: ${process.env.ALLOWED_ORIGINS || 'None'}`);
    console.log(`📊 Health check: http://localhost:${port}/health`);
    console.log(`🗄️ Database: ${process.env.DATABASE_URL ? 'Configured' : 'Not configured'}`);
    console.log(`📱 VAPID: ${process.env.VAPID_PUBLIC_KEY ? 'Configured' : 'Not configured'}`);
    console.log(`🔒 Trust proxy: Enabled`);
});

module.exports = app;