const express = require('express');
const router = express.Router();

// Test route
router.get('/test', (req, res) => {
    res.json({ message: 'Test route working!' });
});

// Test login
router.post('/login', (req, res) => {
    console.log('Login attempt:', req.body);
    res.json({ 
        success: true, 
        message: 'Login test successful',
        received: req.body 
    });
});

module.exports = router;