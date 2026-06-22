const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';

// Generate 32-byte key from JWT_SECRET or ENCRYPTION_KEY
const getSecretKey = () => {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'a_very_secure_default_key_for_codecoach_32_bytes_long!!';
  return crypto.createHash('sha256').update(secret).digest();
};

function encrypt(text) {
  if (!text) return { iv: null, encryptedData: null };
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted,
  };
}

function decrypt(encryptedData, iv) {
  if (!encryptedData || !iv) return null;
  const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), Buffer.from(iv, 'hex'));
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt,
};
