const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const KEY_DIR = path.join(DATA_DIR, 'keys');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'public.pem');

// Generates (once) or loads the organization's signing key pair.
// In a production deployment this would be an HSM-backed key or a
// certificate issued by a recognized Certificate Authority.
function getOrCreateKeys() {
  if (!fs.existsSync(KEY_DIR)) fs.mkdirSync(KEY_DIR, { recursive: true });

  if (!fs.existsSync(PRIVATE_KEY_PATH) || !fs.existsSync(PUBLIC_KEY_PATH)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });
  }

  return {
    privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf-8'),
    publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf-8')
  };
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Signs a document hash with the organization's private key.
// The signature binds the exact byte content of the file to this
// system at this point in time -- any later modification of the file
// will change its hash and invalidate the signature check.
function signHash(hashHex) {
  const { privateKey } = getOrCreateKeys();
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(hashHex);
  signer.end();
  return signer.sign(privateKey, 'base64');
}

function verifySignature(hashHex, signatureBase64) {
  const { publicKey } = getOrCreateKeys();
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(hashHex);
  verifier.end();
  try {
    return verifier.verify(publicKey, signatureBase64, 'base64');
  } catch (e) {
    return false;
  }
}

module.exports = { getOrCreateKeys, hashBuffer, signHash, verifySignature };
