import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Kalshi Trading API Client
 * 
 * Handles order placement and portfolio management
 * Currently in DRY-RUN mode - logs what would happen without placing actual orders
 */

const KALSHI_DEMO_API_BASE = 'https://demo-api.kalshi.co/trade-api/v2';
const KALSHI_PROD_API_BASE = 'https://trading-api.kalshi.com/trade-api/v2';

// Use demo environment for testing
const USE_DEMO = true;
const API_BASE = USE_DEMO ? KALSHI_DEMO_API_BASE : KALSHI_PROD_API_BASE;

// DRY RUN MODE - Set to true to log orders without placing them
const DRY_RUN = true;

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
  
  console.log(`\nOrder Details:`);
  console.log(`   Ticker: ${ticker}`);
  console.log(`   Side: ${side.toUpperCase()}`);
  console.log(`   Action: ${action}`);
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
    action,
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
    console.log(`   1. Set DRY_RUN = false in kalshiTradeClient.js`);
    console.log(`   2. Set up Kalshi API credentials`);
    console.log(`   3. Implement authentication signing`);
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
    
    // Note: Real implementation requires RSA-PSS signature
    // You'll need to:
    // 1. Generate timestamp
    // 2. Create signature string
    // 3. Sign with private key
    // 4. Include headers: KALSHI-ACCESS-KEY, KALSHI-ACCESS-SIGNATURE, KALSHI-ACCESS-TIMESTAMP
    
    const response = await fetch(`${API_BASE}/portfolio/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'KALSHI-ACCESS-KEY': process.env.KALSHI_DEMO_API_KEY || '',
        // TODO: Implement signature generation
        // 'KALSHI-ACCESS-SIGNATURE': signature,
        // 'KALSHI-ACCESS-TIMESTAMP': timestamp,
      },
      body: JSON.stringify(orderPayload)
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log(`\n✅ Order placed successfully!`);
      console.log(`   Order ID: ${result.order?.order_id || 'N/A'}`);
      console.log("\n" + "-".repeat(60) + "\n");
      
      return {
        success: true,
        dryRun: false,
        order: result.order,
        message: "Order placed on Kalshi"
      };
    } else {
      console.error(`\n❌ Order placement failed:`);
      console.error(`   Status: ${response.status}`);
      console.error(`   Error:`, result);
      console.log("\n" + "-".repeat(60) + "\n");
      
      return {
        success: false,
        error: result,
        message: "Order placement failed"
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
      results.push({
        hedgeBet: i + 1,
        success: false,
        error: "Missing ticker symbol",
        hedge
      });
      continue;
    }
    
    // Calculate order parameters
    // For a hedge bet, we're buying the same side the user bet on
    const side = hedge.option.toLowerCase(); // "yes" or "no"
    const probabilityDecimal = hedge.probability / 100;
    
    // Calculate how many contracts to buy
    // Cost per contract = probability (in cents)
    // Total cost = hedge amount
    // Contracts = hedge amount / (probability as decimal)
    const contractCost = probabilityDecimal; // Cost per contract in dollars
    const numContracts = Math.floor(hedge.hedgeAmount / contractCost);
    
    // Price in cents (Kalshi uses 1-99 cents)
    const priceInCents = Math.round(hedge.probability);
    
    console.log(`\n   📊 Order Calculation:`);
    console.log(`      Cost per contract: $${contractCost.toFixed(2)}`);
    console.log(`      Number of contracts: ${numContracts}`);
    console.log(`      Price: ${priceInCents}¢`);
    console.log(`      Total cost: $${(numContracts * contractCost).toFixed(2)}`);
    
    // Place the order
    const orderParams = {
      ticker: hedge.ticker,
      side: side,
      action: 'buy',
      count: numContracts,
      type: 'market', // Use market orders for quick execution
      // For limit orders, you'd set:
      // yes_price: side === 'yes' ? priceInCents : undefined,
      // no_price: side === 'no' ? priceInCents : undefined,
      clientOrderId: `hedge_${metadata.sessionId}_${i + 1}_${Date.now()}`
    };
    
    const result = await placeKalshiOrder(orderParams);
    
    results.push({
      hedgeBet: i + 1,
      ...result,
      hedge
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
  
  console.log(`\nTotal hedge bets: ${results.length}`);
  console.log(`✅ Successful: ${successful}`);
  if (failed > 0) {
    console.log(`❌ Failed: ${failed}`);
  }
  
  if (DRY_RUN) {
    console.log(`\n🔸 DRY RUN MODE - All orders logged but not placed`);
    console.log(`\n💡 To execute real orders:`);
    console.log(`   1. Set DRY_RUN = false in kalshiTradeClient.js`);
    console.log(`   2. Ensure Kalshi API credentials are configured`);
    console.log(`   3. Implement RSA-PSS signature authentication`);
    console.log(`   4. Test in demo environment first`);
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

