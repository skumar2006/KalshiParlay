import dotenv from 'dotenv';
import fetch from 'node-fetch';
import crypto from 'crypto';

dotenv.config();

const TICKER = 'KXSENATEMED-26-GRA';
const API_KEY = process.env.KALSHI_DEMO_API_KEY;
const PRIVATE_KEY = process.env.KALSHI_DEMO_PRIVATE_KEY;
const API_BASE = 'https://demo-api.kalshi.co/trade-api/v2';

console.log('🔍 Testing with real ticker:', TICKER);
console.log('');

// Normalize private key
function normalizePrivateKey(key) {
  if (!key) return key;
  if (key.includes('BEGIN')) {
    return key;
  }
  const cleanKey = key.replace(/\s+/g, '');
  return `-----BEGIN PRIVATE KEY-----\n${cleanKey}\n-----END PRIVATE KEY-----`;
}

// Generate signature
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

// Test 1: Fetch market data
console.log('📊 TEST 1: Fetching market data...');
fetch(`${API_BASE}/markets?series_ticker=KXSENATEMED&limit=500`, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API_KEY}`
  }
})
.then(res => res.json())
.then(data => {
  console.log(`   Found ${data.markets?.length || 0} markets in series`);
  
  const exactMatch = data.markets?.find(m => m.ticker === TICKER.toUpperCase());
  if (exactMatch) {
    console.log('✅ Found exact ticker match!');
    console.log('   Ticker:', exactMatch.ticker);
    console.log('   Title:', exactMatch.title);
    console.log('   Market Type:', exactMatch.market_type);
    console.log('   Status:', exactMatch.status);
    console.log('   Yes Bid:', exactMatch.yes_bid);
    console.log('   Yes Ask:', exactMatch.yes_ask);
    
    // Test 2: Place order with this ticker
    console.log('\n📝 TEST 2: Testing order placement...');
    
    const timestamp = Date.now().toString();
    const method = 'POST';
    const path = '/trade-api/v2/portfolio/orders';
    const signature = generateSignature(timestamp, method, path);
    
    const orderPayload = {
      ticker: exactMatch.ticker,
      side: 'yes',
      action: 'buy',
      count: 1,
      type: 'limit',
      yes_price: Math.round(exactMatch.yes_ask || 50),
      cancel_order_on_pause: true
    };
    
    console.log('   Order Payload:', JSON.stringify(orderPayload, null, 2));
    console.log('   Timestamp:', timestamp);
    console.log('   Signature (first 50 chars):', signature.substring(0, 50) + '...');
    
    return fetch(`${API_BASE}/portfolio/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'KALSHI-ACCESS-KEY': API_KEY,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp
      },
      body: JSON.stringify(orderPayload)
    });
  } else {
    console.log('❌ Exact ticker not found');
    if (data.markets && data.markets.length > 0) {
      console.log('   Available tickers (first 10):');
      data.markets.slice(0, 10).forEach(m => {
        console.log(`      - ${m.ticker}`);
      });
    }
  }
})
.then(res => {
  if (!res) return;
  return res.json().then(data => {
    console.log('\n📋 Order Placement Response:');
    console.log('   Status:', res.status, res.statusText);
    console.log('   Response:', JSON.stringify(data, null, 2));
    
    if (res.ok) {
      console.log('\n✅ Order placed successfully!');
    } else {
      console.log('\n❌ Order placement failed');
      if (data.error) {
        console.log('   Error Code:', data.error.code);
        console.log('   Error Message:', data.error.message);
      }
    }
  });
})
.catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
});



