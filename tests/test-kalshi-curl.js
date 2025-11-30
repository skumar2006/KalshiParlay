import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

/**
 * Test script to generate curl command for Kalshi API
 */

const API_KEY = process.env.KALSHI_DEMO_API_KEY;
const PRIVATE_KEY = process.env.KALSHI_DEMO_PRIVATE_KEY;
const API_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

if (!API_KEY || !PRIVATE_KEY) {
  console.error('❌ Missing KALSHI_DEMO_API_KEY or KALSHI_DEMO_PRIVATE_KEY in .env');
  process.exit(1);
}

function normalizePrivateKey(key) {
  // If key already has PEM headers, return as-is
  if (key.includes('BEGIN')) {
    return key;
  }
  
  // Remove any existing whitespace/newlines
  const cleanKey = key.replace(/\s+/g, '');
  
  // Add PEM headers
  return `-----BEGIN PRIVATE KEY-----\n${cleanKey}\n-----END PRIVATE KEY-----`;
}

function generateSignature(timestamp, method, path) {
  const message = timestamp + method + path;
  const privateKey = normalizePrivateKey(PRIVATE_KEY);
  
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message, 'utf8');
  sign.end();
  
  const signature = sign.sign({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }, 'base64');
  
  return signature;
}

// Test order payload - Using real ticker from demo environment
const orderPayload = {
  ticker: "KXSENATEMED-26-GRA",
  side: "yes",
  action: "buy",
  count: 1,
  type: "limit",
  yes_price: 63,
  cancel_order_on_pause: true
};

const timestamp = Date.now().toString();
const method = 'POST';
const path = '/trade-api/v2/portfolio/orders';
const signature = generateSignature(timestamp, method, path);

console.log('\n🔐 Generated Signature:');
console.log(`   Timestamp: ${timestamp}`);
console.log(`   Method: ${method}`);
console.log(`   Path: ${path}`);
console.log(`   Message: ${timestamp}${method}${path}`);
console.log(`   Signature: ${signature.substring(0, 50)}...`);

console.log('\n📦 Order Payload:');
console.log(JSON.stringify(orderPayload, null, 2));

console.log('\n📋 CURL COMMAND:');
console.log('curl --request POST \\');
console.log(`  --url ${API_BASE}/portfolio/orders \\`);
console.log(`  --header 'Content-Type: application/json' \\`);
console.log(`  --header 'KALSHI-ACCESS-KEY: ${API_KEY}' \\`);
console.log(`  --header 'KALSHI-ACCESS-SIGNATURE: ${signature}' \\`);
console.log(`  --header 'KALSHI-ACCESS-TIMESTAMP: ${timestamp}' \\`);
console.log(`  --data '${JSON.stringify(orderPayload)}'`);

console.log('\n💡 Try running this curl command to test!');

