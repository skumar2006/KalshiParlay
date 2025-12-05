import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { ENV } from '../config/env.js';

dotenv.config();

/**
 * Kalshi Trading API Client
 * 
 * Handles order placement and portfolio management
 * Currently in DRY-RUN mode - logs what would happen without placing actual orders
 */

const KALSHI_DEMO_API_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const KALSHI_PROD_API_BASE = 'https://trading-api.kalshi.com/trade-api/v2';

// Use environment from config instead of hardcoded flag
const USE_DEMO = !ENV.IS_PRODUCTION;
const API_BASE = USE_DEMO ? KALSHI_DEMO_API_BASE : KALSHI_PROD_API_BASE;

// DRY RUN MODE - Set to true to log orders without placing them
// Can be overridden via environment variable KALSHI_DRY_RUN=false
const DRY_RUN = ENV.KALSHI_DRY_RUN !== false;

/**
 * Normalize private key format (add PEM headers if missing)
 * 
 * @param {string} key - Private key string
 * @returns {string} Normalized PEM-formatted key
 */
function normalizePrivateKey(key) {
  if (!key) return key;
  
  // If key already has PEM headers, return as-is
  if (key.includes('-----BEGIN')) {
    return key;
  }
  
  // Otherwise, wrap it with PEM headers
  // Remove any existing whitespace/newlines
  const cleanKey = key.replace(/\s+/g, '');
  
  // Add PEM headers
  return `-----BEGIN PRIVATE KEY-----\n${cleanKey}\n-----END PRIVATE KEY-----`;
}

/**
 * Generate RSA-PSS signature for Kalshi API authentication
 * 
 * @param {string} timestamp - Current timestamp in milliseconds
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - API endpoint path (e.g., "/portfolio/orders")
 * @param {Object|null} body - Request body (for POST requests)
 * @returns {string} Base64-encoded signature (URL-safe)
 */
function generateKalshiSignature(timestamp, method, path, body = null) {
  // Kalshi API signature format: timestamp + method + FULL_PATH (NO BODY)
  // Path must be the full API path like "/trade-api/v2/portfolio/orders"
  // Do NOT include request body in signature
  const message = timestamp + method + path;
  
  // Get private key from environment
  let privateKey = USE_DEMO 
    ? ENV.KALSHI_DEMO_PRIVATE_KEY 
    : ENV.KALSHI_PRIVATE_KEY;
  
  if (!privateKey) {
    const envVar = USE_DEMO ? 'KALSHI_DEMO_PRIVATE_KEY' : 'KALSHI_PRIVATE_KEY';
    throw new Error(`${envVar} not found in environment variables`);
  }
  
  // Normalize key format (add PEM headers if needed)
  privateKey = normalizePrivateKey(privateKey);
  
  // Validate private key format
  if (!privateKey.includes('BEGIN PRIVATE KEY') && !privateKey.includes('BEGIN RSA PRIVATE KEY')) {
    console.error(`   ⚠️  WARNING: Private key might not be in correct format`);
    console.error(`      Key preview: ${privateKey.substring(0, 50)}...`);
  }
  
  try {
    // Debug logging
    console.log(`\n   🔐 SIGNATURE GENERATION:`);
    console.log(`      Timestamp: ${timestamp}`);
    console.log(`      Method: ${method}`);
    console.log(`      Path: ${path}`);
    console.log(`      Message to sign: ${message}`);
    console.log(`      Message length: ${message.length} chars`);
    console.log(`      Body included: NO (Kalshi doesn't include body in signature)`);
    
    // Create signature using RSA-SHA256 with PSS padding
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message, 'utf8');
    sign.end();
    
    const signature = sign.sign({
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    }, 'base64');
    
    // Try regular base64 first (Kalshi might use this)
    // If that doesn't work, we can try URL-safe base64
    console.log(`      Signature (first 50 chars): ${signature.substring(0, 50)}...`);
    console.log(`      Signature length: ${signature.length} chars`);
    
    return signature;
  } catch (err) {
    console.error('   ❌ Error generating signature:', err.message);
    console.error('   Stack:', err.stack);
    throw new Error(`Failed to generate Kalshi signature: ${err.message}`);
  }
}

/**
 * Place an order on Kalshi
 * 
 * @param {Object} orderParams
 * @param {string} orderParams.ticker - Market ticker (e.g., "KXNFLGAME-25NOV16SEALA")
 * @param {string} orderParams.side - "yes" or "no"
 * @param {string} orderParams.action - "buy" or "sell"
 * @param {number} orderParams.count - Number of contracts
 * @param {string} orderParams.type - "market" or "limit"
 * @param {number} orderParams.yes_price - Price in cents (1-99)
 * @param {number} orderParams.no_price - Price in cents (1-99)
 * @returns {Object} Order result or dry-run log
 */
export async function placeKalshiOrder(orderParams) {
  const {
    ticker,
    side,
    action = 'buy',
    count,
    type = 'market',
    yes_price,
    no_price,
    clientOrderId
  } = orderParams;
  
  console.log("\n" + "-".repeat(60));
  console.log("📍 KALSHI ORDER PLACEMENT");
  console.log("-".repeat(60));
  
  if (DRY_RUN) {
    console.log("🔸 DRY RUN MODE - No actual order will be placed");
  }
  
  // Ensure action is always set (defaults to 'buy' if not provided)
  const orderAction = action || 'buy';
  
  console.log(`\nOrder Details:`);
  console.log(`   Ticker: ${ticker}`);
  console.log(`   Side: ${side.toUpperCase()}`);
  console.log(`   Action: ${orderAction.toUpperCase()} ⚠️ REQUIRED FIELD`);
  console.log(`   Count: ${count} contracts`);
  console.log(`   Type: ${type}`);
  
  if (yes_price) {
    console.log(`   Yes Price: ${yes_price}¢ ($${(yes_price / 100).toFixed(2)})`);
  }
  if (no_price) {
    console.log(`   No Price: ${no_price}¢ ($${(no_price / 100).toFixed(2)})`);
  }
  
  // Prepare order payload
  
  const orderPayload = {
    ticker,
    side,
    action: orderAction, // Explicitly set action (required by Kalshi API)
    count,
    type,
    ...(yes_price && { yes_price }),
    ...(no_price && { no_price }),
    ...(clientOrderId && { client_order_id: clientOrderId }),
    // Add cancel_order_on_pause for safety
    cancel_order_on_pause: true
  };
  
  console.log(`\n📦 Order Payload:`);
  console.log(JSON.stringify(orderPayload, null, 2));
  
  if (DRY_RUN) {
    console.log(`\n✅ DRY RUN: Order would be sent to:`);
    console.log(`   ${API_BASE}/portfolio/orders`);
    console.log(`\n💡 To execute real orders:`);
    console.log(`   1. Set KALSHI_DRY_RUN=false in your .env file`);
    console.log(`   2. Ensure ${USE_DEMO ? 'KALSHI_DEMO_PRIVATE_KEY' : 'KALSHI_PRIVATE_KEY'} is set in .env`);
    console.log(`   3. Ensure ${USE_DEMO ? 'KALSHI_DEMO_API_KEY' : 'KALSHI_API_KEY'} is set in .env`);
    console.log("\n" + "-".repeat(60) + "\n");
    
    return {
      success: true,
      dryRun: true,
      orderPayload,
      message: "DRY RUN - Order logged but not placed"
    };
  }
  
  // Real order placement (when DRY_RUN = false)
  try {
    console.log(`\n🚀 Placing order on Kalshi...`);
    console.log(`   Environment: ${USE_DEMO ? 'DEMO' : 'PRODUCTION'}`);
    console.log(`   Endpoint: ${API_BASE}/portfolio/orders`);
    
    // Generate authentication headers
    const timestamp = Date.now().toString();
    const method = 'POST';
    
    // For the actual request URL, use relative path (API_BASE already includes /trade-api/v2)
    const requestPath = '/portfolio/orders';
    
    // For signature, use FULL path including /trade-api/v2 prefix
    const signaturePath = '/trade-api/v2/portfolio/orders';
    
    // Get API key
    const apiKey = USE_DEMO 
      ? ENV.KALSHI_DEMO_API_KEY 
      : ENV.KALSHI_API_KEY;
    
    if (!apiKey) {
      const envVar = USE_DEMO ? 'KALSHI_DEMO_API_KEY' : 'KALSHI_API_KEY';
      throw new Error(`${envVar} not found in environment variables`);
    }
    
    // Generate signature (Kalshi doesn't include body, uses full path)
    const signature = generateKalshiSignature(timestamp, method, signaturePath);
    
    console.log(`   Timestamp: ${timestamp}`);
    console.log(`   Method: ${method}`);
    console.log(`   Request path: ${requestPath}`);
    console.log(`   Signature path: ${signaturePath}`);
    console.log(`   API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`   Signature format: timestamp + method + full_path (no body)`);
    
    // Log exact header values for debugging
    console.log(`\n   📋 REQUEST HEADERS (exact values):`);
    console.log(`   KALSHI-ACCESS-KEY: ${apiKey}`);
    console.log(`   KALSHI-ACCESS-SIGNATURE: ${signature}`);
    console.log(`   KALSHI-ACCESS-TIMESTAMP: ${timestamp}`);
    console.log(`   Content-Type: application/json`);
    
    // Log exact request body being sent
    const requestBody = JSON.stringify(orderPayload);
    console.log(`\n   📦 REQUEST BODY (exact JSON being sent):`);
    console.log(`   ${requestBody}`);
    console.log(`\n   🔍 Action field check: ${orderPayload.action ? `✅ action="${orderPayload.action}"` : '❌ MISSING!'}`);
    
    const response = await fetch(`${API_BASE}${requestPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'KALSHI-ACCESS-KEY': apiKey,
        'KALSHI-ACCESS-SIGNATURE': signature,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
      body: requestBody
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log(`\n✅ Order placed successfully!`);
      console.log(`   Order ID: ${result.order?.order_id || 'N/A'}`);
      console.log(`   Status: ${result.order?.status || 'N/A'}`);
      console.log(`   Ticker: ${orderPayload.ticker}`);
      console.log(`   Side: ${orderPayload.side.toUpperCase()}`);
      console.log(`   Contracts: ${orderPayload.count}`);
      console.log(`   Type: ${orderPayload.type}`);
      if (result.order) {
        console.log(`   Full order response:`, JSON.stringify(result.order, null, 2));
      }
      console.log("\n" + "-".repeat(60) + "\n");
      
      return {
        success: true,
        dryRun: false,
        order: result.order,
        message: "Order placed on Kalshi"
      };
    } else {
      console.error(`\n❌ Order placement failed:`);
      console.error(`   Status: ${response.status} ${response.statusText}`);
      console.error(`   Ticker: ${orderPayload.ticker}`);
      console.error(`   Side: ${orderPayload.side.toUpperCase()}`);
      console.error(`   Contracts: ${orderPayload.count}`);
      
      // Log full error details
      const errorCode = result?.error?.code || 'unknown';
      const errorMessage = result?.error?.message || result?.message || 'Unknown error';
      const errorService = result?.error?.service || '';
      
      console.error(`   Error Code: ${errorCode}`);
      console.error(`   Error Message: ${errorMessage}`);
      if (errorService) {
        console.error(`   Service: ${errorService}`);
      }
      console.error(`   Full Error Response:`, JSON.stringify(result, null, 2));
      
      // Special handling for common errors
      if (errorCode === 'insufficient_balance' && USE_DEMO) {
        console.error(`\n   💡 NOTE: Demo account may not have sufficient balance for this order.`);
        console.error(`      This is expected in the demo environment.`);
      }
      
      console.log("\n" + "-".repeat(60) + "\n");
      
      return {
        success: false,
        error: result,
        errorCode: errorCode,
        message: `Order placement failed: ${errorMessage} (${errorCode})`,
        statusCode: response.status
      };
    }
  } catch (err) {
    console.error(`\n❌ Error placing order:`);
    console.error(`   ${err.message}`);
    console.log("\n" + "-".repeat(60) + "\n");
    
    return {
      success: false,
      error: err.message,
      message: "Error communicating with Kalshi API"
    };
  }
}

/**
 * Execute hedging strategy by placing orders for each hedge bet
 * 
 * @param {Array} hedgeBets - Array of hedge bet objects from hedging strategy
 * @param {Object} metadata - Additional context (user_id, session_id, etc.)
 * @returns {Object} Results of all hedge orders
 */
export async function executeHedgingStrategy(hedgeBets, metadata = {}) {
  console.log("\n" + "=".repeat(80));
  console.log("🛡️ EXECUTING HEDGING STRATEGY ON KALSHI");
  console.log("=".repeat(80));
  
  if (DRY_RUN) {
    console.log("\n⚠️  DRY RUN MODE ACTIVE - No actual orders will be placed\n");
  }
  
  console.log(`\nMetadata:`);
  if (metadata.userId) console.log(`   User ID: ${metadata.userId}`);
  if (metadata.sessionId) console.log(`   Session ID: ${metadata.sessionId}`);
  if (metadata.stake) console.log(`   User Stake: $${metadata.stake}`);
  
  console.log(`\nNumber of hedge bets to place: ${hedgeBets.length}`);
  console.log(`Total hedge cost: $${hedgeBets.reduce((sum, bet) => sum + (bet.hedgeAmount || 0), 0).toFixed(2)}`);
  
  const results = [];
  
  for (let i = 0; i < hedgeBets.length; i++) {
    const hedge = hedgeBets[i];
    
    console.log(`\n📍 Hedge Bet ${i + 1}/${hedgeBets.length}:`);
    console.log(`   Market: ${hedge.market}`);
    console.log(`   Option: ${hedge.option}`);
    console.log(`   Probability: ${hedge.probability}%`);
    console.log(`   Hedge Amount: $${hedge.hedgeAmount.toFixed(2)}`);
    console.log(`   Expected Win: $${hedge.potentialWin.toFixed(2)}`);
    
    // Check if we have the ticker (required for API)
    if (!hedge.ticker) {
      console.log(`   ❌ ERROR: No ticker provided for this market`);
      console.log(`   ℹ️  Cannot place order without ticker symbol`);
      console.log(`   📋 Hedge bet details:`);
      console.log(`      Leg: ${hedge.leg}`);
      console.log(`      Market: ${hedge.market}`);
      console.log(`      Option: ${hedge.option}`);
      console.log(`      MarketId: ${hedge.marketId || 'N/A'}`);
      console.log(`      Probability: ${hedge.probability}%`);
      console.log(`      Hedge Amount: $${hedge.hedgeAmount.toFixed(2)}`);
      
      results.push({
        hedgeBet: i + 1,
        success: false,
        error: "Missing ticker symbol",
        hedge,
        message: `Cannot place order: ticker required for ${hedge.market}`
      });
      continue;
    }
    
    // Calculate order parameters
    // For a hedge bet, we're buying the same outcome the user bet on
    // Kalshi binary markets use "yes" or "no" for the side parameter
    // The ticker already specifies which outcome (e.g., KXNFLGAME-25NOV27GBDET-DET)
    // To bet on that outcome, we use side: "yes"
    // Note: hedge.option might be "DET", "OKC", etc. (team abbreviations), but Kalshi needs "yes"/"no"
    const side = 'yes'; // Always "yes" - betting on the outcome specified in the ticker
    const probabilityDecimal = hedge.probability / 100;
    
    console.log(`   📝 Side mapping:`);
    console.log(`      User bet on: ${hedge.option} (option label)`);
    console.log(`      Ticker: ${hedge.ticker}`);
    console.log(`      Kalshi side: ${side} (betting "yes" on outcome in ticker)`);
    
    // Calculate how many contracts to buy
    // Cost per contract = probability (in cents)
    // Total cost = hedge amount
    // Contracts = hedge amount / (probability as decimal)
    const contractCost = probabilityDecimal; // Cost per contract in dollars
    let numContracts = Math.floor(hedge.hedgeAmount / contractCost);
    
    // Price in cents (Kalshi uses 1-99 cents)
    const priceInCents = Math.round(hedge.probability);
    
    console.log(`\n   📊 Order Calculation:`);
    console.log(`      Cost per contract: $${contractCost.toFixed(2)}`);
    console.log(`      Number of contracts (before validation): ${numContracts}`);
    console.log(`      Price: ${priceInCents}¢`);
    console.log(`      Total cost: $${(numContracts * contractCost).toFixed(2)}`);
    
    // Validate order parameters before placing
    if (numContracts < 1) {
      console.log(`   ⚠️  SKIPPING HEDGE: numContracts would be ${numContracts} (hedgeAmount: $${hedge.hedgeAmount.toFixed(2)}, contractCost: $${contractCost.toFixed(2)})`);
      console.log(`      Minimum 1 contract required. Using minimum of 1 contract.`);
      numContracts = 1; // Use minimum 1 contract
    }
    
    if (priceInCents < 1 || priceInCents > 99) {
      console.log(`   ❌ INVALID PRICE: ${priceInCents}¢ (must be 1-99 cents)`);
      console.log(`      Probability: ${hedge.probability}%`);
      results.push({
        hedgeBet: i + 1,
        success: false,
        error: `Invalid price: ${priceInCents}¢ (must be 1-99 cents). Probability: ${hedge.probability}%`,
        hedge,
        message: `Cannot place order: price out of valid range`
      });
      continue; // Skip this hedge
    }
    
    console.log(`   ✅ Validated: ${numContracts} contracts at ${priceInCents}¢`);
    
    // Place the order
    // Use limit order at current market price - executes quickly if price matches
    // Generate a shorter client_order_id (Kalshi has length limits)
    // Use first 8 chars of sessionId + leg + timestamp to keep it short but unique
    const shortSessionId = metadata.sessionId ? metadata.sessionId.substring(0, 8) : 'unknown';
    const clientOrderId = `h_${shortSessionId}_${i + 1}_${Date.now()}`;
    
    const orderParams = {
      ticker: hedge.ticker,
      side: side,
      action: 'buy',
      count: numContracts,
      type: 'limit', // Limit order at market price - executes quickly
      // Include price - required for limit orders
      ...(side === 'yes' ? { yes_price: priceInCents } : { no_price: priceInCents }),
      clientOrderId: clientOrderId,
      cancel_order_on_pause: true
    };
    
    console.log(`   💰 Order type: LIMIT at ${priceInCents}¢ (should execute quickly at market price)`);
    
    const result = await placeKalshiOrder(orderParams);
    
    // Enhanced result logging
    if (result.success) {
      if (result.dryRun) {
        console.log(`   ✅ DRY RUN: Order would be placed successfully`);
        console.log(`      Ticker: ${orderParams.ticker}`);
        console.log(`      Side: ${orderParams.side.toUpperCase()}`);
        console.log(`      Contracts: ${orderParams.count}`);
      } else {
        console.log(`   ✅ REAL ORDER PLACED SUCCESSFULLY`);
        console.log(`      Order ID: ${result.order?.order_id || 'N/A'}`);
        console.log(`      Ticker: ${orderParams.ticker}`);
        console.log(`      Side: ${orderParams.side.toUpperCase()}`);
        console.log(`      Contracts: ${orderParams.count}`);
        console.log(`      Status: ${result.order?.status || 'N/A'}`);
      }
    } else {
      console.log(`   ❌ ORDER FAILED`);
      console.log(`      Error: ${result.error?.message || result.message || 'Unknown error'}`);
      console.log(`      Ticker: ${orderParams.ticker}`);
      if (result.error) {
        console.log(`      Details:`, JSON.stringify(result.error, null, 2));
      }
    }
    
    results.push({
      hedgeBet: i + 1,
      ...result,
      hedge,
      orderParams // Include order params for debugging
    });
    
    // Small delay between orders to avoid rate limits
    if (i < hedgeBets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  // Summary
  console.log("\n" + "=".repeat(80));
  console.log("📊 HEDGING EXECUTION SUMMARY");
  console.log("=".repeat(80));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const dryRunCount = results.filter(r => r.dryRun).length;
  const realOrdersCount = results.filter(r => r.success && !r.dryRun).length;
  
  console.log(`\nTotal hedge bets: ${results.length}`);
  console.log(`✅ Successful: ${successful}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`);
  }
  
  if (DRY_RUN) {
    console.log(`\n🔸 DRY RUN MODE - All orders logged but not placed`);
    console.log(`   ${dryRunCount} orders simulated`);
    console.log(`\n💡 To execute real orders:`);
    console.log(`   1. Set KALSHI_DRY_RUN=false in your .env file`);
    console.log(`   2. Ensure ${USE_DEMO ? 'KALSHI_DEMO_PRIVATE_KEY' : 'KALSHI_PRIVATE_KEY'} is set in .env`);
    console.log(`   3. Ensure ${USE_DEMO ? 'KALSHI_DEMO_API_KEY' : 'KALSHI_API_KEY'} is set in .env`);
    if (USE_DEMO) {
    console.log(`   4. Test in demo environment first`);
    }
  } else {
    console.log(`\n🚀 REAL ORDERS MODE - Orders placed on Kalshi ${USE_DEMO ? 'demo' : 'production'}`);
    console.log(`   ${realOrdersCount} real orders placed successfully`);
    if (failed > 0) {
      console.log(`   ⚠️  ${failed} orders failed - check logs above for details`);
    }
  }
  
  // Log failed orders details
  if (failed > 0) {
    console.log(`\n❌ FAILED ORDERS DETAILS:`);
    results.forEach((result, i) => {
      if (!result.success) {
        console.log(`\n   Order ${i + 1}:`);
        console.log(`      Market: ${result.hedge?.market || 'N/A'}`);
        console.log(`      Ticker: ${result.hedge?.ticker || 'MISSING'}`);
        console.log(`      Error: ${result.error?.message || result.message || result.error || 'Unknown error'}`);
        if (result.error && typeof result.error === 'object') {
          console.log(`      Error details:`, JSON.stringify(result.error, null, 2));
        }
      }
    });
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
  
  return {
    success: successful === results.length,
    dryRun: DRY_RUN,
    totalOrders: results.length,
    successful,
    failed,
    results
  };
}

