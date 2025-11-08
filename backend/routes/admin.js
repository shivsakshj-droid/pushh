router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        console.log('🔐 DEBUG LOGIN - Starting authentication');
        console.log('   Request username:', username);
        console.log('   Request password:', password ? '***' : 'undefined');

        if (!username || !password) {
            console.log('❌ DEBUG: Missing username or password');
            return res.status(400).json({ 
                success: false,
                error: 'Username and password required' 
            });
        }

        // Get expected values from environment
        const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
        const expectedHash = process.env.ADMIN_PASSWORD_HASH;

        console.log('🔐 DEBUG: Environment variables');
        console.log('   Expected username:', expectedUsername);
        console.log('   Expected hash:', expectedHash);
        console.log('   Expected hash length:', expectedHash ? expectedHash.length : 0);

        if (!expectedHash) {
            console.error('❌ DEBUG: ADMIN_PASSWORD_HASH not set');
            return res.status(500).json({
                success: false,
                error: 'Server configuration error'
            });
        }

        // SIMPLE COMPARISON - Just compare plain text
        console.log('🔐 DEBUG: Starting comparison');
        console.log('   Username match:', username === expectedUsername);
        console.log('   Password match:', password === expectedHash);

        if (username === expectedUsername && password === expectedHash) {
            console.log('✅ DEBUG: Credentials matched via plain text');
            
            // Generate JWT token
            const token = jwt.sign(
                { 
                    id: 1, 
                    username: username, 
                    role: 'admin' 
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );

            console.log(`✅ DEBUG: Login successful for user: ${username}`);
            
            res.json({
                success: true,
                token,
                user: {
                    id: 1,
                    username: username,
                    role: 'admin'
                }
            });
        } else {
            console.log('❌ DEBUG: Credentials did not match');
            console.log('   Expected username:', expectedUsername);
            console.log('   Received username:', username);
            console.log('   Expected password (hash):', expectedHash);
            console.log('   Received password:', password);
            
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid credentials' 
            });
        }

    } catch (error) {
        console.error('❌ DEBUG: Login error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});