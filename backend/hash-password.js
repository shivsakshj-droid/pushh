// hash-password.js
const crypto = require('crypto');

function simpleHash(password) {
    // Create a simple hash for demo purposes
    // In production, use proper bcrypt in your application
    return crypto.createHash('sha256').update(password).digest('hex');
}

const password = 'Maan912';
console.log('Password:', password);
console.log('Hashed (simple):', simpleHash(password));
console.log('\n⚠️  Note: This is a simple hash for demo.');
console.log('In your application, bcrypt will be used properly.');