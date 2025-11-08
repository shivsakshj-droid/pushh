const crypto = require('crypto');
const bcrypt = require('bcryptjs');

console.log('🔑 Generating Required Keys and Passwords\n');

// Generate VAPID keys (you'll still need to run web-push command)
console.log('1. 📧 VAPID Keys (Run this command in terminal):');
console.log('   web-push generate-vapid-keys --json');
console.log('');

// Generate JWT Secret
const jwtSecret = crypto.randomBytes(32).toString('hex');
console.log('2. 🔐 JWT Secret:');
console.log('   ' + jwtSecret);
console.log('');

// Generate Encryption Key
const encryptionKey = crypto.randomBytes(32).toString('hex');
console.log('3. 🗝️  Encryption Key:');
console.log('   ' + encryptionKey);
console.log('');

// Generate Admin Password Hash
const password = 'Maan912'; // Change this to your desired password
const passwordHash = bcrypt.hashSync(password, 12);
console.log('4. 👤 Admin Credentials:');
console.log('   Username: admin');
console.log('   Password: ' + password);
console.log('   Password Hash: ' + passwordHash);
console.log('');

console.log('📋 Copy these values to your environment variables:');
console.log('==================================================');
console.log('VAPID_PUBLIC_KEY=your_vapid_public_key_here');
console.log('VAPID_PRIVATE_KEY=your_vapid_private_key_here');
console.log('VAPID_CONTACT_EMAIL=your-email@example.com');
console.log('JWT_SECRET=' + jwtSecret);
console.log('ENCRYPTION_KEY=' + encryptionKey);
console.log('ADMIN_USERNAME=admin');
console.log('ADMIN_PASSWORD_HASH=' + passwordHash);