/**
 * Main Server Entry Point
 * Express server for Kalshi Parlay Helper API
 */

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { getMarketById, getMarketDetails, getMarketOrderbook } from "./kalshiClient.js";
import { 
  initializeDatabase, 
  getParlayBets, 
  addParlayBet, 
  removeParlayBet, 
  clearParlayBets,
  savePendingPayment,
  getPendingPayment,
  updatePaymentStatus,
  saveCompletedPurchase,
  getCompletedPurchase,
  markHedgeExecuted,
  getUserPurchaseHistory,
  updateParlayBetOutcome,
  updateParlayStatus,
  getActiveParlays,
  claimParlayWinnings,
  getParlayBetOutcomes,
  getUserWallet,
  addUserBalance,
  createWithdrawalRequest,
  updateWithdrawalStatus,
  getWithdrawalRequests,
  saveStripeAccount,
  getUserStripeAccount,
  getLiquidityPoolBalance,
  updateLiquidityPoolBalance
} from "./db.js";
import supabase from "./db.js";
import { createClient } from '@supabase/supabase-js';
import { checkParlayStatus, checkAllActiveParlays, checkMarketOutcome } from "./parlayStatusService.js";
import { generateParlayQuote } from "./aiQuoteService.js";
import { calculateHedgingStrategy } from "./hedgingService.js";
import { executeHedgingStrategy } from "./kalshiTradeClient.js";
import { ENV, validateEnvironment } from "../config/env.js";
import { CONFIG, ERROR_MESSAGES, HTTP_STATUS } from "../config/constants.js";
import { logError, logInfo, logSection, logWarn, logDebug } from "./utils/logger.js";

/**
 * Construct Kalshi market image URL from ticker
 * Format: https://d1lvyva3zy5u58.cloudfront.net/market-images/{TICKER}.jpg
 */
function getMarketImageUrl(ticker) {
  if (!ticker) return null;
  return `https://d1lvyva3zy5u58.cloudfront.net/market-images/${ticker.toUpperCase()}.jpg`;
}

// Validate environment variables on startup
try {
  validateEnvironment();
} catch (err) {
  logError("Environment validation failed", err);
  process.exit(1);
}

const app = express();
const PORT = ENV.PORT || CONFIG.SERVER.DEFAULT_PORT;

// Initialize Stripe (optional - only if API key is provided)
let stripe = null;
if (ENV.STRIPE_API_KEY) {
  stripe = new Stripe(ENV.STRIPE_API_KEY);
} else {
  logWarn("Stripe API key not provided - payment features will be disabled");
}

// Initialize Supabase client for auth verification (using anon key for JWT verification)
let supabaseAuth = null;
if (ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY) {
  supabaseAuth = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
} else {
  logWarn("Supabase auth not configured - authentication will be disabled");
}

app.use(cors()); // For dev: allow all origins (including the extension)
app.use(express.json()); // Parse JSON bodies

// Auth verification middleware
async function verifyAuth(req, res, next) {
  // Skip auth for webhook endpoints and public endpoints
  // Use req.originalUrl or req.url to handle query strings
  const path = req.path || req.originalUrl?.split('?')[0] || req.url?.split('?')[0];
  
  if (path === '/' ||
      path === '/api/webhook' || 
      path === CONFIG.SERVER.HEALTH_CHECK_PATH ||
      path === '/api/webhook/test' ||
      path === '/api/config' ||
      path === '/auth/callback' ||
      path === '/api/auth/callback' ||
      path === '/payment-success' ||
      path === '/payment-cancel' ||
      path.startsWith('/stripe-connect-') ||
      path.startsWith('/api/test/')) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'No authentication token provided' 
    });
  }
  
    const token = authHeader.substring(7);
    req.userToken = token; // Attach token to request for use in route handlers
    
    try {
      if (!supabaseAuth) {
        logWarn("Supabase auth not configured, skipping auth verification");
        return next();
      }
      
      // Verify token with Supabase
      const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
      
      if (error || !user) {
        logError('Auth verification failed', error);
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'Invalid or expired token' 
        });
      }
      
      // CRITICAL: Verify user has an email (user must exist in Supabase)
      if (!user.email) {
        logError('User has no email - account may have been deleted');
        return res.status(401).json({ 
          error: 'Unauthorized', 
          message: 'User account no longer exists' 
        });
      }
      
      // Attach user to request
      req.user = user;
      req.userId = user.id; // UUID from Supabase Auth
    
    // Verify userId in URL matches authenticated user (for routes with :userId param)
    if (req.params.userId && req.params.userId !== user.id) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'User ID mismatch' 
      });
    }
    
    next();
  } catch (err) {
    logError('Auth verification error', err);
    res.status(401).json({ 
      error: 'Unauthorized', 
      message: 'Authentication failed' 
    });
  }
}

// Root route - handles Supabase email confirmation redirects with hash fragments
// Supabase sometimes redirects to the base URL with tokens in the hash fragment
app.get('/', (req, res) => {
  // Simple, plain page that shows email authenticated message
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Email Authenticated.</title>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: white;
    }
    h1 {
      color: #333;
      font-size: 24px;
      font-weight: normal;
      margin: 0;
    }
  </style>
</head>
<body>
  <h1>Email authenticated. You can close this window and use the extension.</h1>
</body>
</html>`;
  
  res.send(html);
});

// Public config endpoint - serves Supabase credentials for frontend
// The anon key is safe to expose publicly (that's its purpose)
app.get('/api/config', (_req, res) => {
  res.json({
    supabaseUrl: ENV.SUPABASE_URL || null,
    supabaseAnonKey: ENV.SUPABASE_ANON_KEY || null
  });
});

// Helper function to generate email confirmation success page HTML
function getEmailConfirmationHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Email Confirmed</title>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
          text-align: center;
          padding: 60px 40px;
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 400px;
        }
        .success {
          color: #00b894;
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 {
          color: #333;
          margin: 0 0 16px 0;
          font-size: 28px;
        }
        p {
          color: #666;
          line-height: 1.6;
          margin: 0 0 32px 0;
        }
        .btn {
          display: inline-block;
          padding: 12px 32px;
          background: #667eea;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: background 0.2s;
          border: none;
          cursor: pointer;
          font-size: 16px;
        }
        .btn:hover {
          background: #5568d3;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success">✅</div>
        <h1>Email Confirmed!</h1>
        <p>Your email has been successfully confirmed. You can now close this window and use the extension.</p>
        <button class="btn" onclick="window.close()">Close Window</button>
      </div>
    </body>
    </html>
  `;
}

// Public auth callback endpoint - handles email confirmation redirects from Supabase
app.get('/auth/callback', (req, res) => {
  logInfo('[Auth Callback] Received callback at /auth/callback', {
    path: req.path,
    originalUrl: req.originalUrl,
    url: req.url,
    query: req.query
  });
  
  // Extract tokens from query params (Supabase includes them in the redirect)
  const { access_token, refresh_token, type } = req.query;
  
  res.send(getEmailConfirmationHTML());
});

// Also handle /api/auth/callback in case Supabase redirects there
app.get('/api/auth/callback', (req, res) => {
  logInfo('[Auth Callback] Received callback at /api/auth/callback', {
    path: req.path,
    originalUrl: req.originalUrl,
    url: req.url,
    query: req.query
  });
  
  // Extract tokens from query params (Supabase includes them in the redirect)
  const { access_token, refresh_token, type } = req.query;
  
  res.send(getEmailConfirmationHTML());
});

// Apply auth middleware to all routes except public ones
app.use(verifyAuth);

/**
 * Enrich hedge bets with tickers from parlay data
 * Matches hedge bets to parlay bets by leg number or market/option
 * 
 * @param {Array} hedgeBets - Array of hedge bet objects from hedging strategy
 * @param {Array} parlayData - Array of parlay bet objects from database
 * @returns {Array} Enriched hedge bets with tickers
 */
function enrichHedgeBetsWithTickers(hedgeBets, parlayData) {
  console.log(`\n🔍 ENRICHING HEDGE BETS WITH TICKERS:`);
  console.log(`   Hedge bets to enrich: ${hedgeBets.length}`);
  console.log(`   Parlay data entries: ${parlayData.length}`);
  
  const enriched = hedgeBets.map((hedgeBet, index) => {
    // If ticker already exists, keep it
    if (hedgeBet.ticker) {
      console.log(`   ✅ Leg ${hedgeBet.leg}: Already has ticker ${hedgeBet.ticker}`);
      return hedgeBet;
    }
    
    // Try to find matching parlay bet by leg number (1-indexed)
    const legIndex = hedgeBet.leg - 1;
    const parlayBet = parlayData[legIndex];
    
    if (parlayBet && parlayBet.ticker) {
      console.log(`   ✅ Leg ${hedgeBet.leg}: Found ticker by index: ${parlayBet.ticker}`);
      return {
        ...hedgeBet,
        ticker: parlayBet.ticker
      };
    }
    
    // Fallback: try to match by market title and option label
    const match = parlayData.find(bet => {
      const marketMatch = bet.marketTitle === hedgeBet.market || 
                         bet.marketTitle?.includes(hedgeBet.market) ||
                         hedgeBet.market?.includes(bet.marketTitle);
      const optionMatch = bet.optionLabel === hedgeBet.option ||
                         bet.optionLabel?.toLowerCase() === hedgeBet.option?.toLowerCase();
      return marketMatch && optionMatch;
    });
    
    if (match && match.ticker) {
      console.log(`   ✅ Leg ${hedgeBet.leg}: Found ticker by matching: ${match.ticker}`);
      return {
        ...hedgeBet,
        ticker: match.ticker
      };
    }
    
    // Last resort: try to match by marketId if available
    if (hedgeBet.marketId) {
      const marketMatch = parlayData.find(bet => bet.marketId === hedgeBet.marketId);
      if (marketMatch && marketMatch.ticker) {
        console.log(`   ✅ Leg ${hedgeBet.leg}: Found ticker by marketId: ${marketMatch.ticker}`);
        return {
          ...hedgeBet,
          ticker: marketMatch.ticker
        };
      }
    }
    
    console.log(`   ❌ Leg ${hedgeBet.leg}: NO TICKER FOUND`);
    console.log(`      Market: ${hedgeBet.market}`);
    console.log(`      Option: ${hedgeBet.option}`);
    console.log(`      MarketId: ${hedgeBet.marketId || 'N/A'}`);
    return hedgeBet;
  });
  
  return enriched;
}

/**
 * Stripe webhook endpoint
 * Handles payment completion events and executes hedging strategies
 * Note: Uses raw body parser for webhook signature verification
 */
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  if (!stripe) {
    logError("Stripe webhook received but Stripe is not initialized");
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }

  logSection("WEBHOOK RECEIVED");
  logInfo(`Timestamp: ${new Date().toISOString()}`);
  logInfo(`Method: ${req.method}`);
  logInfo(`Path: ${req.path}`);
  
  const sig = req.headers['stripe-signature'];
  
  let event;
  
  try {
    // Verify webhook signature (in production, use STRIPE_WEBHOOK_SECRET)
    if (ENV.STRIPE_WEBHOOK_SECRET) {
      logInfo("Using webhook secret verification");
      event = stripe.webhooks.constructEvent(req.body, sig, ENV.STRIPE_WEBHOOK_SECRET);
    } else {
      // For development without webhook signing
      logWarn("No webhook secret - parsing JSON directly (dev mode)");
      event = JSON.parse(req.body.toString());
    }
    
    logInfo(`Event parsed successfully - Type: ${event.type}, ID: ${event.id}`);
  } catch (err) {
    logError("Webhook error", err);
    return res.status(HTTP_STATUS.BAD_REQUEST).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const stripeAmount = session.amount_total / 100;
      
      logSection("STRIPE PAYMENT CONFIRMED");
      logInfo(`Session ID: ${session.id}`);
      logInfo(`Amount paid: $${stripeAmount.toFixed(2)}`);
      logInfo(`Customer email: ${session.customer_details?.email || 'N/A'}`);
      
      // Get payment details from database
      try {
        const payment = await getPendingPayment(session.id);
        
        if (!payment) {
          logError(`Payment record not found in database - Session ID: ${session.id}`);
          break;
        }
        
        // Check if this is a credit purchase or parlay purchase
        const paymentType = payment.payment_type || (session.metadata?.paymentType || 'parlay');
        logInfo(`Payment type detected: ${paymentType}`);
        logInfo(`Payment record:`, JSON.stringify({
          payment_type: payment.payment_type,
          user_id: payment.user_id,
          stake: payment.stake
        }, null, 2));
        
        if (paymentType === 'credits') {
          // Handle credit purchase - add credits to wallet
          logSection("CREDIT PURCHASE CONFIRMED");
          logInfo(`User ID: ${payment.user_id}`);
          logInfo(`Credits purchased: $${stripeAmount.toFixed(2)}`);
          
          // Get current wallet balance before adding (use service role for webhook)
          const walletBefore = await getUserWallet(payment.user_id, null);
          logInfo(`Wallet balance before: $${parseFloat(walletBefore.balance || 0).toFixed(2)}`);
          
          // Add credits to user's wallet (use service role for webhook)
          await addUserBalance(payment.user_id, stripeAmount, null);
          logInfo(`Added $${stripeAmount.toFixed(2)} to user wallet`);
          
          // Verify wallet balance after adding (use service role for webhook)
          const walletAfter = await getUserWallet(payment.user_id, null);
          logInfo(`Wallet balance after: $${parseFloat(walletAfter.balance || 0).toFixed(2)}`);
          
          // Update pending payment status
          await updatePaymentStatus(session.id, 'completed');
          logInfo("Credit purchase completed successfully");
          
          break; // Exit early, don't process as parlay
        }
        
        // Handle parlay purchase (existing logic)
        logInfo(`Purchase Details - User ID: ${payment.user_id}, Stake: $${payment.stake}, Legs: ${payment.parlay_data?.length || 0}`);
        
        // Extract quote data (only for parlay purchases)
        const quoteData = payment.quote_data ? (typeof payment.quote_data === 'string' ? JSON.parse(payment.quote_data) : payment.quote_data) : {};
        const payout = quoteData.payout ? parseFloat(quoteData.payout.adjustedPayout) : 0;
        
        logInfo(`Payout Info - Promised payout: $${payout.toFixed(2)}, Potential profit: $${(payout - payment.stake).toFixed(2)}`);
        
        // Update pending payment status
        await updatePaymentStatus(session.id, 'completed');
        logInfo("Updated pending payment status to 'completed'");
        
        // Parse parlay_data if it's a string
        const parlayData = payment.parlay_data 
          ? (typeof payment.parlay_data === 'string' ? JSON.parse(payment.parlay_data) : payment.parlay_data)
          : [];
        
        // Save to completed purchases
        const completedPurchase = await saveCompletedPurchase(
          session.id,
          payment.user_id,
          payment.stake,
          payout,
          parlayData,
          quoteData,
          quoteData.hedgingStrategy || null,
          stripeAmount
        );
        
        logInfo(`Saved to completed_purchases (ID: ${completedPurchase.id})`);
        
        // Execute hedging strategy
        const hedgingStrategy = quoteData.hedgingStrategy;
        
        // Debug: Log parlay probabilities to understand hedging decision
        if (parlayData && parlayData.length > 0) {
          logInfo("Parlay leg probabilities:");
          parlayData.forEach((bet, i) => {
            logInfo(`  Leg ${i + 1}: ${bet.marketTitle} - ${bet.optionLabel} (${bet.prob}%)`);
          });
        }
        
        if (hedgingStrategy) {
          logInfo(`Hedging strategy decision: needsHedging=${hedgingStrategy.needsHedging}`);
          logInfo(`Hedging reasoning: ${hedgingStrategy.reasoning || 'N/A'}`);
          if (hedgingStrategy.hedgeBets) {
            logInfo(`Number of hedge bets: ${hedgingStrategy.hedgeBets.length}`);
          }
        } else {
          logWarn("No hedging strategy found in quote data");
        }
        
        if (hedgingStrategy && hedgingStrategy.needsHedging) {
          logSection("EXECUTING HEDGING STRATEGY");
          logInfo(`Strategy: ${hedgingStrategy.strategy || 'variance_reduction'}`);
          
          if (hedgingStrategy.hedgeBets && hedgingStrategy.hedgeBets.length > 0) {
            logInfo(`Number of hedge bets: ${hedgingStrategy.hedgeBets.length}`);
            logInfo(`Total hedge cost: $${hedgingStrategy.totalHedgeCost.toFixed(2)}`);
            
            // Enrich hedge bets with tickers from parlay_data
            logInfo("Enriching hedge bets with tickers...");
            const enrichedHedgeBets = enrichHedgeBetsWithTickers(
              hedgingStrategy.hedgeBets,
              parlayData
            );
            
            // Validate all tickers are present
            const missingTickers = enrichedHedgeBets.filter(bet => !bet.ticker);
            
            if (missingTickers.length > 0) {
              logError(`${missingTickers.length} hedge bets missing tickers`, missingTickers);
              logWarn(`Proceeding with partial hedging (${enrichedHedgeBets.length - missingTickers.length}/${enrichedHedgeBets.length} bets)`);
            } else {
              logInfo(`All ${enrichedHedgeBets.length} hedge bets have tickers`);
            }
            
            // Execute hedging strategy through Kalshi API
            logInfo(`Executing orders on Kalshi demo environment...`);
            logInfo(`DRY_RUN: ${ENV.KALSHI_DRY_RUN ? 'ENABLED (TESTING)' : 'DISABLED (REAL ORDERS)'}`);
            
            const hedgeResult = await executeHedgingStrategy(
              enrichedHedgeBets,
              {
                userId: payment.user_id,
                sessionId: session.id,
                stake: payment.stake,
                payout: payout
              }
            );
            
            logInfo(`Hedging execution results - Total: ${hedgeResult.totalOrders}, Successful: ${hedgeResult.successful}, Failed: ${hedgeResult.failed}`);
            
            if (hedgeResult.success) {
              logInfo(`Hedging execution completed successfully!`);
              await markHedgeExecuted(session.id);
            } else {
              logWarn(`Hedging execution had issues - ${hedgeResult.successful}/${hedgeResult.totalOrders} succeeded`);
              await markHedgeExecuted(session.id);
            }
          } else {
            logInfo("No individual hedge bets needed");
          }
        } else {
          logInfo(`NO HEDGING NEEDED - Reason: ${hedgingStrategy?.reasoning || 'Low-probability parlay, acceptable variance'}`);
        }
        
        // Clear user's parlay (they've placed their bet)
        await clearParlayBets(payment.user_id);
        logInfo("Cleared user's parlay bets from active parlays");
        
        logInfo("PAYMENT PROCESSING COMPLETE");
        
      } catch (err) {
        logError("Error processing payment", err);
      }
      
      break;
    }
    case 'checkout.session.expired':
      logInfo(`Checkout session expired: ${event.data.object.id}`);
      break;
    case 'payment_intent.succeeded':
      logInfo(`PaymentIntent succeeded: ${event.data.object.id}`);
      break;
    case 'payment_intent.payment_failed':
      logError(`Payment failed: ${event.data.object.id}`);
      break;
    default:
      logWarn(`Unhandled event type: ${event.type}`);
  }
  
  // Return a response to acknowledge receipt of the event
  res.json({received: true});
});

// JSON parsing for all other routes
app.use(express.json());

// Initialize database on startup
initializeDatabase().catch(err => {
  logError("Failed to initialize database", err);
  process.exit(1);
});

/**
 * Health check endpoint
 * @route GET /api/health
 */
app.get(CONFIG.SERVER.HEALTH_CHECK_PATH, (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

/**
 * Test webhook endpoint (for debugging)
 */
app.get("/api/webhook/test", (_req, res) => {
  console.log("✅ Webhook endpoint is accessible");
  res.json({ message: "Webhook endpoint is working", timestamp: new Date().toISOString() });
});

/**
 * Get market data from Kalshi API
 * @route GET /api/kalshi/market/:id
 * @param {string} id - Market identifier/ticker
 * @returns {Object} Market data with title, contracts, and options
 */
app.get("/api/kalshi/market/:id", async (req, res) => {
  const marketId = req.params.id;

  try {
    const data = await getMarketById(marketId);
    
    // The API returns { markets: [{...}] }
    const markets = data.markets || [];
    
    if (markets.length === 0) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ 
        error: ERROR_MESSAGES.KALSHI.MARKET_NOT_FOUND 
      });
    }

    // Use the first market's title (they're all the same event)
    const firstMarket = markets[0];
    const title = firstMarket.title || firstMarket.ticker || `Market ${marketId}`;
    // Construct image URL from the first market's ticker (fallback for when option images aren't available)
    const imageUrl = firstMarket.ticker ? getMarketImageUrl(firstMarket.ticker) : null;

    // Build contracts from all markets in this event
    // Each market represents one option with YES/NO contracts
    // Fetch full details for each market to get complete information
    const contracts = [];
    
    // Fetch full details for each market in parallel
    const marketDetailsPromises = markets.map(market => 
      getMarketDetails(market.ticker).catch(err => {
        logDebug(`Failed to fetch details for ${market.ticker}, using basic data:`, err.message);
        return null; // Return null if fetch fails, we'll use basic market data
      })
    );
    
    const marketDetailsArray = await Promise.all(marketDetailsPromises);
    
    markets.forEach((market, index) => {
      if (market.market_type === "binary") {
        // Get full market details if available
        const fullDetails = marketDetailsArray[index];
        const marketData = fullDetails || market; // Use full details if available, otherwise use basic data
        
        // Log market data for debugging (only in dev)
        if (process.env.NODE_ENV !== 'production') {
          logDebug("Market data:", {
            ticker: market.ticker,
            title: marketData.title,
            subtitle: marketData.subtitle,
            subtitle_long: marketData.subtitle_long,
            yes_sub_title: marketData.yes_sub_title,
            no_sub_title: marketData.no_sub_title,
            hasFullDetails: !!fullDetails
          });
        }
        
        // Try multiple strategies to get the full candidate/option name
        // Priority: yes_sub_title/no_sub_title > subtitle_long > subtitle > title parsing > ticker
        let optionLabel = null;
        
        // Strategy 1: Use yes_sub_title or no_sub_title (these often contain the full candidate name)
        if (marketData.yes_sub_title && 
            !marketData.yes_sub_title.match(/^(YES|Democratic|Republican|Democrat)$/i)) {
          optionLabel = marketData.yes_sub_title.trim();
        } else if (marketData.no_sub_title && 
                   !marketData.no_sub_title.match(/^(NO|Democratic|Republican|Democrat)$/i)) {
          optionLabel = marketData.no_sub_title.trim();
        }
        
        // Strategy 2: Use subtitle_long if available (often contains full name)
        if (!optionLabel && marketData.subtitle_long) {
          optionLabel = marketData.subtitle_long.trim();
        }
        
        // Strategy 3: Use subtitle if it's not a generic party name
        if (!optionLabel && marketData.subtitle && 
            !marketData.subtitle.match(/^(Democratic|Republican|Democrat|::\s*(Democratic|Republican|Democrat))$/i)) {
          optionLabel = marketData.subtitle.trim();
        }
        
        // Strategy 4: Check if title contains the option name (for multi-option markets)
        if (!optionLabel && marketData.title && marketData.title !== title) {
          // Extract option name from title (e.g., "Will Donald Trump win?" -> "Donald Trump")
          const titleMatch = marketData.title.match(/Will\s+(.+?)\s+win/i) || 
                           marketData.title.match(/^(.+?)\s+will/i) ||
                           marketData.title.match(/^(.+?)\?/);
          if (titleMatch && titleMatch[1]) {
            optionLabel = titleMatch[1].trim();
          } else if (marketData.title.length < 100) {
            // If title is short and different, use it directly
            optionLabel = marketData.title.trim();
          }
        }
        
        // Strategy 5: Check for option_name field
        if (!optionLabel && marketData.option_name) {
          optionLabel = marketData.option_name.trim();
        }
        
        // Strategy 6: Extract from ticker as last resort
        if (!optionLabel) {
          const tickerParts = market.ticker.split('-');
          optionLabel = tickerParts[tickerParts.length - 1];
        }
        
        // Use prices from full details if available, otherwise use basic market data
        const yesBid = marketData.yes_bid || market.yes_bid || 0;
        const yesAsk = marketData.yes_ask || market.yes_ask || 0;
        const noBid = marketData.no_bid || market.no_bid || 0;
        const noAsk = marketData.no_ask || market.no_ask || 0;
        
        const yesMid = (yesBid && yesAsk) ? (yesBid + yesAsk) / 2 : (yesBid || yesAsk || 0);
        const noMid = (noBid && noAsk) ? (noBid + noAsk) / 2 : (noBid || noAsk || 0);
        
        // Create option with YES/NO contracts
        // Use the full market ticker (e.g., "KXPRESPERSON-28-JVAN")
        const fullTicker = market.ticker || marketId;
        
        const option = {
          label: optionLabel,
          ticker: fullTicker, // Full ticker like "KXPRESPERSON-28-JVAN"
          tickerCode: fullTicker.split('-').pop(), // Last part like "JVAN" for matching
          imageUrl: getMarketImageUrl(fullTicker), // Individual option image URL
          yes: {
            id: `${fullTicker}-YES`,
            ticker: fullTicker, // Kalshi ticker for API trading
            label: optionLabel,
            side: 'YES',
            price: yesMid,
            prob: Math.round(yesMid),
            bid: yesBid,
            ask: yesAsk
          },
          no: {
            id: `${fullTicker}-NO`,
            ticker: fullTicker, // Kalshi ticker for API trading
            label: optionLabel,
            side: 'NO',
            price: noMid,
            prob: Math.round(noMid),
            bid: noBid,
            ask: noAsk
          }
        };
        
        contracts.push(option);
      }
    });

    res.json({
      id: marketId,
      title,
      imageUrl,
      contracts,
      raw: { markets },
    });
  } catch (err) {
    logError("Error fetching market data from Kalshi", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: ERROR_MESSAGES.KALSHI.MARKET_NOT_FOUND, 
      details: err.message 
    });
  }
});

/**
 * Get all parlay bets for a user (optionally filtered by environment)
 * @route GET /api/parlay/:userId
 * @param {string} userId - User identifier
 * @param {string} environment - Optional query parameter to filter by environment ('demo' or 'production')
 * @returns {Object} Object containing array of bets
 */
app.get("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  const { environment } = req.query; // Get environment from query params
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const bets = await getParlayBets(userId, environment || null, token);
    res.json({ bets });
  } catch (err) {
    logError("Error fetching parlay bets", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch parlay bets", 
      details: err.message 
    });
  }
});

/**
 * Add a bet to the user's parlay
 * @route POST /api/parlay/:userId
 * @param {string} userId - User identifier
 * @param {Object} bet - Bet object with marketId, marketTitle, imageUrl, optionId, optionLabel, prob
 * @returns {Object} Created bet object
 */
app.post("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  const bet = req.body;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  logDebug(`Received bet for user ${userId}`, bet);
  
  try {
    const newBet = await addParlayBet(userId, bet, token);
    logInfo(`Successfully added bet: ${newBet.id}`);
    res.json({ bet: newBet });
  } catch (err) {
    logError("Error adding bet to parlay", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to add bet to parlay", 
      details: err.message 
    });
  }
});

/**
 * Remove a bet from the user's parlay
 * @route DELETE /api/parlay/:userId/:betId
 * @param {string} userId - User identifier
 * @param {string} betId - Bet ID to remove
 * @returns {Object} Success status
 */
app.delete("/api/parlay/:userId/:betId", async (req, res) => {
  const { userId, betId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    await removeParlayBet(userId, betId, token);
    res.json({ success: true });
  } catch (err) {
    logError("Error removing bet from parlay", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to remove bet from parlay", 
      details: err.message 
    });
  }
});

/**
 * Clear all bets from the user's parlay
 * @route DELETE /api/parlay/:userId
 * @param {string} userId - User identifier
 * @returns {Object} Success status
 */
app.delete("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    await clearParlayBets(userId, token);
    res.json({ success: true });
  } catch (err) {
    logError("Error clearing parlay", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to clear parlay", 
      details: err.message 
    });
  }
});

/**
 * Get completed purchase history for a user
 * @route GET /api/purchase-history/:userId
 * @param {string} userId - User identifier
 * @returns {Object} Object containing array of purchases
 */
app.get("/api/purchase-history/:userId", async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const purchases = await getUserPurchaseHistory(userId, token);
    res.json({ success: true, purchases });
  } catch (err) {
    logError("Error fetching purchase history", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch purchase history", 
      details: err.message 
    });
  }
});

/**
 * Check status of a specific parlay
 * @route GET /api/parlay-status/:sessionId
 */
app.get("/api/parlay-status/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  
  try {
    const status = await checkParlayStatus(sessionId);
    res.json({ success: true, ...status });
  } catch (err) {
    logError("Error checking parlay status", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to check parlay status", 
      details: err.message 
    });
  }
});

/**
 * Claim winnings for a won parlay (adds to wallet balance)
 * @route POST /api/claim-winnings/:sessionId
 */
app.post("/api/claim-winnings/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }
  
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const purchase = await getCompletedPurchase(sessionId, token);
    
    if (!purchase) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ 
        error: "Parlay not found" 
      });
    }
    
    if (purchase.parlay_status !== 'won') {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "Parlay has not won or is not yet settled" 
      });
    }
    
    if (purchase.claimed_at) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "Winnings already claimed" 
      });
    }
    
    // Mark as claimed first (idempotent)
    await claimParlayWinnings(sessionId, token);
    
    const winningsAmount = purchase.claimable_amount;
    
    // Add winnings to user's wallet balance (money stays in platform account)
    await addUserBalance(purchase.user_id, winningsAmount, token);
    
    // Deduct from liquidity pool (platform pays winnings from pool)
    await updateLiquidityPoolBalance(-winningsAmount);
    
    // Get updated balances for logging
    const walletAfter = await getUserWallet(purchase.user_id, token);
    const poolData = await getLiquidityPoolBalance();
    
    logInfo(`Winnings claimed: User ${purchase.user_id}, Amount: $${winningsAmount.toFixed(2)}, Session: ${sessionId}`);
    logInfo(`User wallet balance: $${parseFloat(walletAfter.balance || 0).toFixed(2)}`);
    logInfo(`Liquidity pool balance: $${parseFloat(poolData.balance || 0).toFixed(2)}`);
    logInfo(`Note: Winnings added to wallet, deducted from liquidity pool. Money stays in platform account.`);
    
    res.json({ 
      success: true, 
      message: "Winnings added to your wallet balance",
      amount: winningsAmount,
      newBalance: parseFloat(walletAfter.balance || 0)
    });
  } catch (err) {
    logError("Error claiming winnings", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to claim winnings", 
      details: err.message 
    });
  }
});

/**
 * Get user's parlay history with status
 * @route GET /api/parlay-history/:userId
 */
app.get("/api/parlay-history/:userId", async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const purchases = await getUserPurchaseHistory(userId, token);
    
    // Enrich with leg outcomes
    const enriched = await Promise.all(purchases.map(async (purchase) => {
      const outcomes = await getParlayBetOutcomes(purchase.id, token);
      const parlayData = typeof purchase.parlay_data === 'string' 
        ? JSON.parse(purchase.parlay_data) 
        : purchase.parlay_data || [];
      
      return {
        ...purchase,
        parlay_data: parlayData,
        parlay_status: purchase.parlay_status || 'pending',
        claimable_amount: parseFloat(purchase.claimable_amount || 0),
        claimed_at: purchase.claimed_at,
        legOutcomes: outcomes
      };
    }));
    
    res.json({ success: true, parlays: enriched });
  } catch (err) {
    logError("Error fetching parlay history", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch parlay history", 
      details: err.message 
    });
  }
});

/**
 * Get user wallet balance
 * @route GET /api/wallet/:userId
 */
app.get("/api/wallet/:userId", async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const wallet = await getUserWallet(userId, token);
    res.json({ 
      success: true, 
      balance: parseFloat(wallet.balance || 0) 
    });
  } catch (err) {
    logError("Error fetching wallet", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch wallet", 
      details: err.message 
    });
  }
});

/**
 * Create Stripe Connect Express account and get onboarding link
 * @route GET /api/stripe-connect/onboard/:userId
 */
app.get("/api/stripe-connect/onboard/:userId", async (req, res) => {
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Stripe not configured" 
    });
  }
  
  const { userId } = req.params;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const returnUrl = `${baseUrl}/stripe-connect-return?userId=${userId}`;
  const refreshUrl = `${baseUrl}/stripe-connect-refresh?userId=${userId}`;
  
  try {
    const token = req.headers.authorization?.substring(7); // Extract JWT token
    
    // Get authenticated user's email from req.user (set by verifyAuth middleware)
    const userEmail = req.user?.email;
    if (!userEmail) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "User email not available. Please ensure you are authenticated." 
      });
    }
    
    // Check if user already has a Stripe account
    const existingAccount = await getUserStripeAccount(userId, token);
    
    let accountId = existingAccount?.stripe_account_id;
    
    // Create Express account if doesn't exist
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: userEmail, // Use authenticated user's email from Supabase
        business_type: 'individual', // Pre-fill as individual (not business)
        business_profile: {
          product_description: 'Receiving payouts from parlay betting winnings', // Use product description instead of website
        },
        capabilities: {
          transfers: { requested: true },
        },
      });
      accountId = account.id;
      await saveStripeAccount(userId, accountId, 'pending', token);
    } else {
      // Update existing account email if it's still using placeholder
      try {
        const account = await stripe.accounts.retrieve(accountId);
        // Check if account has placeholder email or different email
        if (account.email && (
          account.email.includes('@kalshi-parlay.com') || 
          account.email !== userEmail
        )) {
          // Update account with user's real email
          await stripe.accounts.update(accountId, {
            email: userEmail
          });
          logInfo(`Updated Stripe account ${accountId} email to ${userEmail}`);
        }
      } catch (updateErr) {
        logWarn(`Could not update account email for ${accountId}:`, updateErr);
        // Continue anyway - email update is not critical
      }
    }
    
    // Always ensure product_description is set (for both new and existing accounts)
    // This removes the website requirement from onboarding
    try {
      const account = await stripe.accounts.retrieve(accountId);
      
      // Check if account needs product_description
      const hasProductDescription = account.business_profile?.product_description;
      const hasUrl = account.business_profile?.url;
      
      // If account doesn't have product_description, or has URL but no product_description, update it
      if (!hasProductDescription || (hasUrl && !hasProductDescription)) {
        const updateData = {
          business_profile: {
            product_description: 'Receiving payouts from parlay betting winnings',
          },
        };
        
        // Try to remove URL by omitting it (Stripe will use product_description instead)
        // Note: We can't directly delete URL, but setting product_description should make it optional
        
        await stripe.accounts.update(accountId, updateData);
        logInfo(`Updated account ${accountId} with product_description`);
        logInfo(`Account business_profile:`, JSON.stringify(account.business_profile, null, 2));
      } else {
        logInfo(`Account ${accountId} already has product_description set`);
      }
    } catch (updateErr) {
      logError(`Could not update account ${accountId}:`, updateErr);
      // Continue anyway - account link creation might still work
    }
    
    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });
    
    res.json({ 
      success: true, 
      url: accountLink.url,
      accountId: accountId
    });
  } catch (err) {
    logError("Error creating Stripe Connect account", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to create account", 
      details: err.message 
    });
  }
});

/**
 * Check Stripe Connect account status
 * @route GET /api/stripe-connect/status/:userId
 */
app.get("/api/stripe-connect/status/:userId", async (req, res) => {
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Stripe not configured" 
    });
  }
  
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const accountData = await getUserStripeAccount(userId, token);
    
    if (!accountData || !accountData.stripe_account_id) {
      return res.json({ 
        connected: false, 
        message: "No Stripe account connected" 
      });
    }
    
    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(accountData.stripe_account_id);
    
    res.json({
      connected: true,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      email: account.email
    });
  } catch (err) {
    logError("Error checking Stripe Connect status", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to check status", 
      details: err.message 
    });
  }
});

/**
 * Return page after Stripe onboarding
 * @route GET /stripe-connect-return
 */
app.get("/stripe-connect-return", async (req, res) => {
  const { userId } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Account Connected</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f9ff; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .success { color: #00b894; font-size: 48px; margin-bottom: 20px; }
        h1 { color: #333; }
        p { color: #666; line-height: 1.6; }
        .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #00b894; color: white; text-decoration: none; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success">✅</div>
        <h1>Bank Account Connected!</h1>
        <p>Your bank account has been successfully connected. You can now withdraw your winnings.</p>
        <p><small>You can close this window and return to the extension.</small></p>
        <a href="#" onclick="window.close()" class="btn">Close Window</a>
      </div>
      <script>
        setTimeout(() => { window.close(); }, 3000);
      </script>
    </body>
    </html>
  `);
});

/**
 * Refresh page for Stripe onboarding
 * @route GET /stripe-connect-refresh
 */
app.get("/stripe-connect-refresh", async (req, res) => {
  const { userId } = req.query;
  
  // Redirect back to onboarding
  res.redirect(`/api/stripe-connect/onboard/${userId}`);
});

/**
 * Request withdrawal (Transfer to Stripe Connect account)
 * @route POST /api/withdraw/:userId
 */
app.post("/api/withdraw/:userId", async (req, res) => {
  const { userId } = req.params;
  const { amount } = req.body;
  
  logSection("WITHDRAWAL REQUEST");
  logInfo(`User ID: ${userId}`);
  logInfo(`Requested Amount: $${amount}`);
  
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }
  
  if (!amount || amount <= 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: "Invalid withdrawal amount" 
    });
  }
  
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    // Verify user exists and get wallet
    const wallet = await getUserWallet(userId, token);
    const balance = parseFloat(wallet.balance || 0);
    
    logInfo(`User wallet balance: $${balance.toFixed(2)}`);
    
    if (amount > balance) {
      logWarn(`Insufficient wallet balance: $${balance.toFixed(2)} < $${amount.toFixed(2)}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: `Insufficient balance. You have $${balance.toFixed(2)}, need $${amount.toFixed(2)}` 
      });
    }
    
    // Get user's Stripe Connect account
    const accountData = await getUserStripeAccount(userId, token);
    
    if (!accountData || !accountData.stripe_account_id) {
      logWarn(`User ${userId} does not have Stripe Connect account`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "Please connect your bank account first" 
      });
    }
    
    logInfo(`Stripe Connect Account: ${accountData.stripe_account_id}`);
    
    // Verify account is ready for transfers
    const account = await stripe.accounts.retrieve(accountData.stripe_account_id);
    
    if (!account.details_submitted || !account.payouts_enabled) {
      logWarn(`Account not ready: details_submitted=${account.details_submitted}, payouts_enabled=${account.payouts_enabled}`);
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "Account not ready. Please complete onboarding." 
      });
    }
    
    // Check platform Stripe account balance before attempting transfer
    let platformBalance = null;
    try {
      const balanceObj = await stripe.balance.retrieve();
      platformBalance = balanceObj.available[0]?.amount || 0; // Amount in cents
      logInfo(`Platform Stripe account balance: $${(platformBalance / 100).toFixed(2)}`);
      
      if (platformBalance < Math.round(amount * 100)) {
        logError(`Platform account has insufficient funds: $${(platformBalance / 100).toFixed(2)} < $${amount.toFixed(2)}`);
        return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
          error: `Insufficient funds in platform account. Platform has $${(platformBalance / 100).toFixed(2)}, need $${amount.toFixed(2)}. This is a test mode limitation. In production, funds from credit purchases will be available.`,
          details: `Platform balance: $${(platformBalance / 100).toFixed(2)}, Required: $${amount.toFixed(2)}`
        });
      }
    } catch (balanceErr) {
      logError("Error checking platform balance", balanceErr);
      // Continue anyway - might be a permissions issue
    }
    
    // Step 1: Transfer from platform account to Connect account
    let transferId = null;
    let payoutId = null;
    
    try {
      logInfo(`Attempting to transfer $${amount.toFixed(2)} from platform to Connect account...`);
      const transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100), // cents
        currency: 'usd',
        destination: accountData.stripe_account_id,
        metadata: {
          user_id: userId,
          type: 'withdrawal',
        },
      });
      
      transferId = transfer.id;
      logInfo(`✅ Transferred $${amount.toFixed(2)} from platform to Connect account: ${transfer.id}`);
      
      // Step 2: Create payout from Connect account to user's bank account
      logInfo(`Creating payout from Connect account to bank...`);
      const payout = await stripe.payouts.create(
        {
          amount: Math.round(amount * 100), // cents
          currency: 'usd',
        },
        {
          stripeAccount: accountData.stripe_account_id, // Create payout ON their Connect account
        }
      );
      
      payoutId = payout.id;
      logInfo(`✅ Created payout from Connect account to bank: ${payout.id}`);
      
    } catch (transferErr) {
      logError("Error processing withdrawal transfer/payout", transferErr);
      logError("Transfer error details:", {
        message: transferErr.message,
        type: transferErr.type,
        code: transferErr.code
      });
      
      // Check if it's a Stripe error about insufficient funds
      let errorMessage = "Failed to process withdrawal";
      if (transferErr.message && transferErr.message.includes("insufficient available funds")) {
        errorMessage = `Insufficient funds in platform account. Platform has $${platformBalance ? (platformBalance / 100).toFixed(2) : 'unknown'}, need $${amount.toFixed(2)}. This is a test mode limitation.`;
      } else if (transferErr.message) {
        errorMessage = transferErr.message;
      }
      
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: errorMessage,
        details: transferErr.message 
      });
    }
    
    // Step 3: Deduct from user wallet balance
    await addUserBalance(userId, -amount, token);
    
    // Step 4: Create withdrawal request record
    const withdrawal = await createWithdrawalRequest(
      userId,
      amount,
      'stripe_connect',
      payoutId,
      transferId,
      token
    );
    
    logInfo(`Withdrawal processed: User ${userId}, Amount: $${amount}, Transfer: ${transferId}, Payout: ${payoutId}`);
    
    res.json({ 
      success: true, 
      withdrawal_id: withdrawal.id,
      transfer_id: transferId,
      payout_id: payoutId,
      amount: amount,
      message: "Withdrawal processed successfully. Funds will arrive in your bank account within 3-5 business days."
    });
  } catch (err) {
    logError("Error processing withdrawal", err);
    
    // Check if it's a Stripe error about insufficient funds
    let errorMessage = "Failed to process withdrawal";
    if (err.message && err.message.includes("insufficient available funds")) {
      errorMessage = "Insufficient funds in platform account. This is a test mode limitation. In production, funds from credit purchases will be available for withdrawals.";
    } else if (err.message) {
      errorMessage = err.message;
    }
    
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: errorMessage,
      details: err.message 
    });
  }
});

/**
 * Get withdrawal history
 * @route GET /api/withdrawals/:userId
 */
app.get("/api/withdrawals/:userId", async (req, res) => {
  const { userId } = req.params;
  const token = req.headers.authorization?.substring(7); // Extract JWT token
  
  try {
    const withdrawals = await getWithdrawalRequests(userId, token);
    res.json({ success: true, withdrawals });
  } catch (err) {
    logError("Error fetching withdrawals", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch withdrawals", 
      details: err.message 
    });
  }
});

/**
 * Check platform Stripe account balance
 * @route GET /api/platform-balance
 */
app.get("/api/platform-balance", async (req, res) => {
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }
  
  try {
    const balance = await stripe.balance.retrieve();
    const available = balance.available[0]?.amount || 0; // Amount in cents
    const pending = balance.pending[0]?.amount || 0;
    
    res.json({
      success: true,
      available: available / 100, // Convert to dollars
      pending: pending / 100,
      currency: balance.available[0]?.currency || 'usd'
    });
  } catch (err) {
    logError("Error fetching platform balance", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch platform balance", 
      details: err.message 
    });
  }
});

// ============================================================================
// TESTING ENDPOINTS (Development Only)
// ============================================================================

/**
 * TESTING ENDPOINT: Manually set parlay status (for testing only)
 * @route POST /api/test/set-parlay-status/:sessionId
 * WARNING: Only enable in development!
 */
if (ENV.NODE_ENV === 'development' || ENV.NODE_ENV !== 'production') {
  app.post("/api/test/set-parlay-status/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const { status, claimableAmount } = req.body; // status: 'pending'|'won'|'lost', claimableAmount: number
    
    try {
      await updateParlayStatus(sessionId, status, claimableAmount || 0);
      logInfo(`[TEST] Set parlay ${sessionId} status to ${status}`);
      res.json({ success: true, message: `Parlay status set to ${status}` });
    } catch (err) {
      logError("Error setting parlay status", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to set parlay status", 
        details: err.message 
      });
    }
  });

  /**
   * TESTING ENDPOINT: Manually set leg outcome (for testing only)
   * @route POST /api/test/set-leg-outcome/:sessionId/:legNumber
   */
  app.post("/api/test/set-leg-outcome/:sessionId/:legNumber", async (req, res) => {
    const { sessionId, legNumber } = req.params;
    const { outcome, settlementPrice } = req.body; // outcome: 'win'|'loss', settlementPrice: 0-100
    
    try {
      const purchase = await getCompletedPurchase(sessionId);
      if (!purchase) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Parlay not found" });
      }
      
      const parlayData = typeof purchase.parlay_data === 'string' 
        ? JSON.parse(purchase.parlay_data) 
        : purchase.parlay_data || [];
      
      const leg = parlayData[parseInt(legNumber) - 1];
      if (!leg) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: "Leg not found" });
      }
      
      await updateParlayBetOutcome(
        purchase.id,
        parseInt(legNumber),
        leg.ticker,
        leg.optionId || leg.ticker,
        'settled',
        outcome,
        settlementPrice || (outcome === 'win' ? 100 : 0)
      );
      
      // Recheck parlay status after updating leg
      await checkParlayStatus(sessionId);
      
      logInfo(`[TEST] Set leg ${legNumber} of parlay ${sessionId} to ${outcome}`);
      res.json({ success: true, message: `Leg ${legNumber} set to ${outcome}` });
    } catch (err) {
      logError("Error setting leg outcome", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to set leg outcome", 
        details: err.message 
      });
    }
  });

  /**
   * TESTING ENDPOINT: Set all legs to won (for testing)
   * @route POST /api/test/set-all-legs-won/:sessionId
   */
  app.post("/api/test/set-all-legs-won/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    
    try {
      const purchase = await getCompletedPurchase(sessionId);
      if (!purchase) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Parlay not found" });
      }
      
      const parlayData = typeof purchase.parlay_data === 'string' 
        ? JSON.parse(purchase.parlay_data) 
        : purchase.parlay_data || [];
      
      // Set all legs to won
      for (let i = 0; i < parlayData.length; i++) {
        const leg = parlayData[i];
        await updateParlayBetOutcome(
          purchase.id,
          i + 1,
          leg.ticker,
          leg.optionId || leg.ticker,
          'settled',
          'win',
          100
        );
      }
      
      // Recheck parlay status
      await checkParlayStatus(sessionId);
      
      logInfo(`[TEST] Set all legs of parlay ${sessionId} to won`);
      res.json({ success: true, message: "All legs set to won" });
    } catch (err) {
      logError("Error setting all legs won", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to set legs", 
        details: err.message 
      });
    }
  });

  /**
   * TESTING ENDPOINT: Set all legs to lost (for testing)
   * @route POST /api/test/set-all-legs-lost/:sessionId
   */
  app.post("/api/test/set-all-legs-lost/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    
    try {
      const purchase = await getCompletedPurchase(sessionId);
      if (!purchase) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ error: "Parlay not found" });
      }
      
      const parlayData = typeof purchase.parlay_data === 'string' 
        ? JSON.parse(purchase.parlay_data) 
        : purchase.parlay_data || [];
      
      // Set first leg to lost (parlay loses)
      if (parlayData.length > 0) {
        const leg = parlayData[0];
        await updateParlayBetOutcome(
          purchase.id,
          1,
          leg.ticker,
          leg.optionId || leg.ticker,
          'settled',
          'loss',
          0
        );
      }
      
      // Recheck parlay status
      await checkParlayStatus(sessionId);
      
      logInfo(`[TEST] Set first leg of parlay ${sessionId} to lost`);
      res.json({ success: true, message: "Parlay set to lost" });
    } catch (err) {
      logError("Error setting parlay lost", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to set parlay lost", 
        details: err.message 
      });
    }
  });

  /**
   * TESTING ENDPOINT: List all session IDs (for testing)
   * @route GET /api/test/list-sessions
   */
  app.get("/api/test/list-sessions", async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('completed_purchases')
        .select('session_id, user_id, stake, payout, parlay_status, claimable_amount, completed_at')
        .order('completed_at', { ascending: false })
        .limit(50);
      
      if (error) {
        throw error;
      }
      
      res.json({ success: true, sessions: data || [] });
    } catch (err) {
      logError("Error listing sessions", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to list sessions", 
        details: err.message 
      });
    }
  });

  /**
   * DEBUG ENDPOINT: Check market status for a specific ticker
   * @route GET /api/test/check-market/:ticker
   */
  app.get("/api/test/check-market/:ticker", async (req, res) => {
    const { ticker } = req.params;
    try {
      const result = await checkMarketOutcome(ticker, ticker);
      res.json({ success: true, ticker, result });
    } catch (err) {
      logError("Error checking market", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to check market", 
        details: err.message 
      });
    }
  });

  /**
   * TEST ENDPOINT: Force re-check and update parlay status (no auth required for testing)
   * @route GET /api/test/recheck-parlay/:sessionId
   */
  app.get("/api/test/recheck-parlay/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const status = await checkParlayStatus(sessionId);
      res.json({ success: true, message: "Parlay status re-checked and updated", ...status });
    } catch (err) {
      logError("Error re-checking parlay status", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to re-check parlay status", 
        details: err.message,
        stack: err.stack
      });
    }
  });

  /**
   * DEBUG ENDPOINT: Detailed parlay status check with full market data
   * @route GET /api/test/debug-parlay/:sessionId
   */
  app.get("/api/test/debug-parlay/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    try {
      const purchase = await getCompletedPurchase(sessionId);
      if (!purchase) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({ 
          error: "Parlay not found",
          sessionId 
        });
      }

      const parlayData = typeof purchase.parlay_data === 'string' 
        ? JSON.parse(purchase.parlay_data) 
        : purchase.parlay_data || [];

      const legDetails = [];
      
      for (let i = 0; i < parlayData.length; i++) {
        const leg = parlayData[i];
        const legNumber = i + 1;
        
        if (!leg.ticker) {
          legDetails.push({
            legNumber,
            error: 'No ticker available',
            legData: leg
          });
          continue;
        }

        // Get detailed market outcome
        const marketResult = await checkMarketOutcome(leg.ticker, leg.optionId || leg.ticker);
        
        // Also get raw market data for inspection
        let rawMarketData = null;
        try {
          const { getMarketDetails } = await import('./kalshiClient.js');
          rawMarketData = await getMarketDetails(leg.ticker);
        } catch (err) {
          logWarn(`Could not fetch raw market data for ${leg.ticker}`, err);
        }

        legDetails.push({
          legNumber,
          ticker: leg.ticker,
          optionId: leg.optionId || leg.ticker,
          marketResult,
          rawMarketData,
          legData: leg
        });
      }

      // Get existing outcomes from database
      const existingOutcomes = await getParlayBetOutcomes(purchase.id);

      res.json({
        success: true,
        sessionId,
        parlayStatus: purchase.parlay_status,
        claimableAmount: purchase.claimable_amount,
        legDetails,
        existingOutcomes,
        purchaseData: {
          id: purchase.id,
          stake: purchase.stake,
          payout: purchase.payout,
          completedAt: purchase.completed_at
        }
      });
    } catch (err) {
      logError("Error debugging parlay", err);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
        error: "Failed to debug parlay", 
        details: err.message,
        stack: err.stack
      });
    }
  });

  logInfo("🧪 Testing endpoints enabled (development mode)");
}

/**
 * Generate AI-powered quote for a parlay
 * @route POST /api/quote
 * @param {Array} bets - Array of bet objects
 * @param {number} stake - Stake amount in dollars
 * @returns {Object} Quote with analysis and payout information
 */
app.post("/api/quote", async (req, res) => {
  const { bets, stake } = req.body;
  
  if (!bets || !Array.isArray(bets) || bets.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_BETS 
    });
  }
  
  if (!stake || stake <= 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_STAKE 
    });
  }
  
  try {
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logInfo(`Generating AI quote for ${bets.length} bets with $${stake} stake (Request ID: ${requestId})`);
    
    const result = await generateParlayQuote(bets, stake);
    
    // Calculate hedging strategy (logged to console only)
    if (result.success && result.quote) {
      const adjustedProb = parseFloat(result.quote.analysis.adjustedProbability) / 100;
      const adjustedPayout = parseFloat(result.quote.payout.adjustedPayout);
      
      // Pass full AI analysis to hedging service for detailed logging
      const hedgingStrategy = calculateHedgingStrategy(
        bets,
        stake,
        adjustedPayout,
        adjustedProb,
        result.quote.analysis // Include AI analysis for logging
      );
      
      // Store hedging strategy in the quote for later use
      result.quote.hedgingStrategy = hedgingStrategy;
    }
    
    res.json(result);
  } catch (err) {
    logError("Error generating quote", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: ERROR_MESSAGES.PAYMENT.QUOTE_FAILED, 
      details: err.message 
    });
  }
});

/**
 * Create a Stripe Checkout session for payment
 * @route POST /api/create-checkout-session
 * @param {string} userId - User identifier
 * @param {number} stake - Stake amount
 * @param {Array} parlayBets - Array of parlay bet objects
 * @param {Object} quote - Quote data from AI service
 * @returns {Object} Checkout session ID and URL
 */
app.post("/api/create-checkout-session", async (req, res) => {
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }

  const { userId, stake, parlayBets, quote } = req.body;
  
  if (!userId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PAYMENT.USER_ID_REQUIRED 
    });
  }
  
  if (!stake || stake <= 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_STAKE 
    });
  }
  
  if (!parlayBets || !Array.isArray(parlayBets) || parlayBets.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_BETS 
    });
  }
  
  try {
    // Create a description of the parlay
    const parlayDescription = parlayBets.map(bet => 
      `${bet.marketTitle} - ${bet.optionLabel} @ ${bet.prob}%`
    ).join(', ');
    
    const truncatedDescription = parlayDescription.length > 500 
      ? parlayDescription.substring(0, 497) + '...'
      : parlayDescription;
    
    logInfo(`Creating checkout session for user ${userId}, stake: $${stake}`);
    
    // Create Stripe Checkout Session with minimal metadata
    const session = await stripe.checkout.sessions.create({
      payment_method_types: CONFIG.STRIPE.PAYMENT_METHOD_TYPES,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Kalshi Parlay Bet (${parlayBets.length} markets)`,
              description: truncatedDescription,
              images: parlayBets.filter(b => b.imageUrl).slice(0, 1).map(b => b.imageUrl), // First image
            },
            unit_amount: Math.round(stake * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: CONFIG.STRIPE.PAYMENT_MODE,
      success_url: `http://localhost:${PORT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:${PORT}/payment-cancel`,
      metadata: {
        userId,
        stake: stake.toString(),
        betCount: parlayBets.length.toString(),
      },
    });
    
    logInfo(`Checkout session created: ${session.id}`);
    
    const token = req.headers.authorization?.substring(7); // Extract JWT token
    // Save full payment details to database (avoids 500-char metadata limit)
    await savePendingPayment(session.id, userId, stake, parlayBets, quote, 'parlay', token);
    logInfo("Payment details saved to database");
    
    res.json({ 
      sessionId: session.id,
      checkoutUrl: session.url 
    });
  } catch (err) {
    logError("Error creating checkout session", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: ERROR_MESSAGES.PAYMENT.CHECKOUT_FAILED, 
      details: err.message 
    });
  }
});

/**
 * Create a Stripe Checkout session for buying credits
 * @route POST /api/buy-credits
 * @param {string} userId - User identifier
 * @param {number} amount - Amount of credits to purchase (in dollars)
 * @returns {Object} Checkout session ID and URL
 */
app.post("/api/buy-credits", async (req, res) => {
  if (!stripe) {
    return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Payment processing not available" 
    });
  }

  const { userId, amount } = req.body;
  
  if (!userId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PAYMENT.USER_ID_REQUIRED 
    });
  }
  
  if (!amount || amount <= 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: "Invalid credit amount" 
    });
  }
  
  // Set minimum and maximum limits
  const minAmount = 5; // $5 minimum
  const maxAmount = 1000; // $1000 maximum
  
  if (amount < minAmount) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: `Minimum purchase is $${minAmount}` 
    });
  }
  
  if (amount > maxAmount) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: `Maximum purchase is $${maxAmount}` 
    });
  }
  
  try {
    logInfo(`Creating credit purchase checkout session for user ${userId}, amount: $${amount}`);
    
    // Create Stripe Checkout Session - money goes to platform account
    // User wallet balance will be updated via webhook
    const session = await stripe.checkout.sessions.create({
      payment_method_types: CONFIG.STRIPE.PAYMENT_METHOD_TYPES,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Kalshi Parlay Credits - $${amount}`,
              description: 'Add credits to your wallet for placing parlay bets',
            },
            unit_amount: Math.round(amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: CONFIG.STRIPE.PAYMENT_MODE,
      success_url: `http://localhost:${PORT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:${PORT}/payment-cancel`,
      metadata: {
        userId,
        amount: amount.toString(),
        paymentType: 'credits',
      },
    });
    
    logInfo(`Credit purchase checkout session created: ${session.id}`);
    
    const token = req.headers.authorization?.substring(7); // Extract JWT token
    // Save credit purchase to database
    await savePendingPayment(session.id, userId, amount, null, null, 'credits', token);
    logInfo("Credit purchase details saved to database");
    
    res.json({ 
      sessionId: session.id,
      checkoutUrl: session.url 
    });
  } catch (err) {
    logError("Error creating credit purchase checkout session", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to create checkout session", 
      details: err.message 
    });
  }
});

/**
 * Place parlay bet using credits from wallet
 * @route POST /api/place-parlay
 * @param {string} userId - User identifier
 * @param {number} stake - Stake amount
 * @param {Array} parlayBets - Array of parlay bet objects
 * @param {Object} quote - Quote data from AI service
 * @returns {Object} Success status and purchase details
 */
app.post("/api/place-parlay", async (req, res) => {
  const { userId, stake, parlayBets, quote } = req.body;
  
  if (!userId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PAYMENT.USER_ID_REQUIRED 
    });
  }
  
  if (!stake || stake <= 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_STAKE 
    });
  }
  
  if (!parlayBets || !Array.isArray(parlayBets) || parlayBets.length === 0) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: ERROR_MESSAGES.PARLAY.INVALID_BETS 
    });
  }
  
  let balanceBefore = 0;
  let creditsDeducted = false;
  
  // Extract token from request (set by verifyAuth middleware) - MUST be outside try block for catch block access
  const token = req.userToken || req.headers.authorization?.substring(7);
  
  try {
    // Check wallet balance
    const wallet = await getUserWallet(userId, token);
    balanceBefore = parseFloat(wallet.balance || 0);
    
    if (balanceBefore < stake) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: `Insufficient credits. You have $${balanceBefore.toFixed(2)}, need $${stake.toFixed(2)}` 
      });
    }
    
    logSection("PLACING PARLAY WITH CREDITS");
    logInfo(`User ID: ${userId}`);
    logInfo(`Stake: $${stake.toFixed(2)}`);
    logInfo(`Wallet balance before: $${balanceBefore.toFixed(2)}`);
    
    // Deduct credits from user wallet (money stays in platform account)
    await addUserBalance(userId, -stake, token);
    creditsDeducted = true;
    
    // Add stake to liquidity pool (money from losing parlays stays in platform)
    await updateLiquidityPoolBalance(stake);
    
    // Get liquidity pool balance for logging
    const poolData = await getLiquidityPoolBalance();
    const poolBalance = parseFloat(poolData.balance || 0);
    
    // Verify deduction
    const walletAfter = await getUserWallet(userId, token);
    const newBalance = parseFloat(walletAfter.balance || 0);
    logInfo(`Wallet balance after: $${newBalance.toFixed(2)}`);
    logInfo(`Liquidity pool balance: $${poolBalance.toFixed(2)}`);
    logInfo(`Stake $${stake.toFixed(2)} deducted from wallet and added to liquidity pool`);
    
    // Generate a session ID for this purchase (not a Stripe session, just an internal ID)
    const sessionId = `parlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Extract quote data
    const quoteData = quote || {};
    const payout = quoteData.payout ? parseFloat(quoteData.payout.adjustedPayout) : 0;
    
    logInfo(`Payout Info - Promised payout: $${payout.toFixed(2)}, Potential profit: $${(payout - stake).toFixed(2)}`);
    
    // Save to completed purchases (using credits, not Stripe)
    const completedPurchase = await saveCompletedPurchase(
      sessionId,
      userId,
      stake,
      payout,
      parlayBets,
      quoteData,
      quoteData.hedgingStrategy || null,
      stake, // stripeAmount = stake since paid with credits
      token
    );
    
    logInfo(`Saved to completed_purchases (ID: ${completedPurchase.id})`);
    
    // Execute hedging strategy
    const hedgingStrategy = quoteData.hedgingStrategy;
    
    if (parlayBets && parlayBets.length > 0) {
      logInfo("Parlay leg probabilities:");
      parlayBets.forEach((bet, i) => {
        logInfo(`  Leg ${i + 1}: ${bet.marketTitle} - ${bet.optionLabel} (${bet.prob}%)`);
      });
    }
    
    if (hedgingStrategy && hedgingStrategy.needsHedging) {
      logSection("EXECUTING HEDGING STRATEGY");
      logInfo(`Strategy: ${hedgingStrategy.strategy || 'variance_reduction'}`);
      
      if (hedgingStrategy.hedgeBets && hedgingStrategy.hedgeBets.length > 0) {
        logInfo(`Number of hedge bets: ${hedgingStrategy.hedgeBets.length}`);
        logInfo(`Total hedge cost: $${hedgingStrategy.totalHedgeCost.toFixed(2)}`);
        
        // Enrich hedge bets with tickers
        const enrichedHedgeBets = enrichHedgeBetsWithTickers(
          hedgingStrategy.hedgeBets,
          parlayBets
        );
        
        // Execute hedging strategy
        logInfo(`Executing orders on Kalshi demo environment...`);
        logInfo(`DRY_RUN: ${ENV.KALSHI_DRY_RUN ? 'ENABLED (TESTING)' : 'DISABLED (REAL ORDERS)'}`);
        
        const hedgeResult = await executeHedgingStrategy(
          enrichedHedgeBets,
          {
            userId: userId,
            sessionId: sessionId,
            stake: stake,
            payout: payout
          }
        );
        
        logInfo(`Hedging execution results - Total: ${hedgeResult.totalOrders}, Successful: ${hedgeResult.successful}, Failed: ${hedgeResult.failed}`);
        
        if (hedgeResult.success) {
          logInfo(`Hedging execution completed successfully!`);
          await markHedgeExecuted(sessionId, token);
        } else {
          logWarn(`Hedging execution had issues - ${hedgeResult.successful}/${hedgeResult.totalOrders} succeeded`);
          await markHedgeExecuted(sessionId, token);
        }
      }
    } else {
      logInfo(`NO HEDGING NEEDED - Reason: ${hedgingStrategy?.reasoning || 'Low-probability parlay, acceptable variance'}`);
    }
    
    // Clear user's parlay bets
    await clearParlayBets(userId, token);
    logInfo("Cleared user's parlay bets");
    
    res.json({ 
      success: true,
      sessionId: sessionId,
      purchaseId: completedPurchase.id,
      stake: stake,
      payout: payout,
      newBalance: newBalance,
      message: "Parlay bet placed successfully!"
    });
    
  } catch (err) {
    logError("Error placing parlay bet", err);
    
    // If error occurred after deducting credits, refund them
    if (creditsDeducted) {
      try {
        logWarn("Refunding credits due to error");
        await addUserBalance(userId, stake, token);
        logInfo(`Refunded $${stake.toFixed(2)} to user wallet`);
      } catch (refundErr) {
        logError("Error refunding credits", refundErr);
      }
    }
    
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to place parlay bet", 
      details: err.message 
    });
  }
});

/**
 * GET /payment-success
 * 
 * Success page after payment
 */
app.get("/payment-success", async (req, res) => {
  const sessionId = req.query.session_id;
  
  // Check if this was a credit purchase
  let isCreditPurchase = false;
  let creditAmount = 0;
  let userId = null;
  
  if (sessionId) {
    try {
      const payment = await getPendingPayment(sessionId);
      if (payment) {
        const paymentType = payment.payment_type || 'parlay';
        isCreditPurchase = paymentType === 'credits';
        creditAmount = parseFloat(payment.stake || 0);
        userId = payment.user_id;
        
        // If credit purchase and webhook hasn't fired yet, try to add credits now
        if (isCreditPurchase) {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.payment_status === 'paid') {
            // Double-check wallet balance (use service role since no user token on redirect)
            const wallet = await getUserWallet(userId, null);
            logInfo(`Payment success page - Wallet balance: $${parseFloat(wallet.balance || 0).toFixed(2)}`);
            
            // If credits weren't added by webhook, add them now (fallback)
            const stripeAmount = session.amount_total / 100;
            const expectedBalance = parseFloat(wallet.balance || 0) + stripeAmount;
            logInfo(`Expected balance after credit purchase: $${expectedBalance.toFixed(2)}`);
          }
        }
      }
    } catch (err) {
      logError("Error checking payment in success page", err);
    }
  }
  
  if (!sessionId) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Success</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f9ff; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .success { color: #00b894; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
          .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #00b894; color: white; text-decoration: none; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your parlay bet has been placed successfully.</p>
          <a href="#" onclick="window.close()" class="btn">Close Window</a>
        </div>
      </body>
      </html>
    `);
  }
  
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const metadata = session.metadata || {};
    const paymentType = metadata.paymentType || 'parlay';
    const stripeAmount = session.amount_total / 100;
    
    // If this is a credit purchase, check if credits were added (webhook might not have fired)
    if (paymentType === 'credits' && session.payment_status === 'paid') {
      try {
        const payment = await getPendingPayment(sessionId);
        if (payment && payment.user_id) {
          const wallet = await getUserWallet(payment.user_id, null);
          const currentBalance = parseFloat(wallet.balance || 0);
          
          // If credits weren't added yet (webhook didn't fire), add them now as fallback
          if (currentBalance < stripeAmount) {
            logWarn(`Credits not yet added via webhook, adding via fallback for session ${sessionId}`);
            await addUserBalance(payment.user_id, stripeAmount, null);
            await updatePaymentStatus(sessionId, 'completed', null);
            logInfo(`Fallback: Added $${stripeAmount.toFixed(2)} credits to wallet`);
          }
          
          // Get updated balance
          const updatedWallet = await getUserWallet(payment.user_id, null);
          const newBalance = parseFloat(updatedWallet.balance || 0);
          
          res.send(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Credits Purchased</title>
              <style>
                body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f9ff; }
                .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                .success { color: #00b894; font-size: 48px; margin-bottom: 20px; }
                h1 { color: #333; }
                p { color: #666; line-height: 1.6; }
                .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
                .details-row { display: flex; justify-content: space-between; margin: 10px 0; }
                .label { font-weight: 600; color: #333; }
                .value { color: #00b894; font-weight: 600; font-size: 18px; }
                .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #00b894; color: white; text-decoration: none; border-radius: 8px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="success">✅</div>
                <h1>Credits Added Successfully!</h1>
                <p>Your credits have been added to your wallet.</p>
                
                <div class="details">
                  <div class="details-row">
                    <span class="label">Credits Purchased:</span>
                    <span class="value">$${stripeAmount.toFixed(2)}</span>
                  </div>
                  <div class="details-row">
                    <span class="label">New Wallet Balance:</span>
                    <span class="value">$${newBalance.toFixed(2)}</span>
                  </div>
                </div>
                
                <p><small>You can now close this window and return to your extension. Refresh the extension to see your updated balance.</small></p>
                <a href="#" onclick="window.close()" class="btn">Close Window</a>
              </div>
              
              <script>
                // Auto-close after 5 seconds
                setTimeout(() => {
                  window.close();
                }, 5000);
              </script>
            </body>
            </html>
          `);
          return;
        }
      } catch (creditErr) {
        logError("Error processing credit purchase in success page", creditErr);
      }
    }
    
    // Regular parlay purchase success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Payment Success</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f0f9ff; }
          .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .success { color: #00b894; font-size: 48px; margin-bottom: 20px; }
          h1 { color: #333; }
          p { color: #666; line-height: 1.6; }
          .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
          .details-row { display: flex; justify-content: space-between; margin: 10px 0; }
          .label { font-weight: 600; color: #333; }
          .value { color: #00b894; font-weight: 600; }
          .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #00b894; color: white; text-decoration: none; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">✅</div>
          <h1>Payment Successful!</h1>
          <p>Your parlay bet has been placed successfully.</p>
          
          <div class="details">
            <div class="details-row">
              <span class="label">Amount Paid:</span>
              <span class="value">$${stripeAmount.toFixed(2)}</span>
            </div>
            <div class="details-row">
              <span class="label">Stake:</span>
              <span class="value">$${metadata.stake || stripeAmount.toFixed(2)}</span>
            </div>
            <div class="details-row">
              <span class="label">Session ID:</span>
              <span class="value">${sessionId.substring(0, 20)}...</span>
            </div>
          </div>
          
          <p><small>You can now close this window and return to your extension.</small></p>
          <a href="#" onclick="window.close()" class="btn">Close Window</a>
        </div>
        
        <script>
          // Auto-close after 5 seconds
          setTimeout(() => {
            window.close();
          }, 5000);
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    logError("Error retrieving session:", err);
    res.status(500).send("Error retrieving payment details");
  }
});

/**
 * GET /payment-cancel
 * 
 * Cancel page when user cancels payment
 */
app.get("/payment-cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled</title>
      <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #fff5f5; }
        .container { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .cancel { color: #e74c3c; font-size: 48px; margin-bottom: 20px; }
        h1 { color: #333; }
        p { color: #666; line-height: 1.6; }
        .btn { display: inline-block; margin-top: 20px; padding: 12px 24px; background: #3498db; color: white; text-decoration: none; border-radius: 8px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="cancel">❌</div>
        <h1>Payment Cancelled</h1>
        <p>Your payment was cancelled. No charges were made.</p>
        <p>You can return to the extension and try again.</p>
        <a href="#" onclick="window.close()" class="btn">Close Window</a>
      </div>
      
      <script>
        // Auto-close after 3 seconds
        setTimeout(() => {
          window.close();
        }, 3000);
      </script>
    </body>
    </html>
  `);
});

// Start parlay status checker (runs every 15 minutes)
const STATUS_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

// Run immediately on startup
checkAllActiveParlays().catch(err => {
  logError("Error in initial parlay status check", err);
});

// Then run periodically
setInterval(() => {
  logInfo("Running scheduled parlay status check...");
  checkAllActiveParlays().catch(err => {
    logError("Error in scheduled parlay status check", err);
  });
}, STATUS_CHECK_INTERVAL);

logInfo(`Parlay status checker started (interval: ${STATUS_CHECK_INTERVAL / 1000}s)`);

app.listen(PORT, () => {
  logInfo(`Kalshi backend listening on http://localhost:${PORT}`);
  logInfo(`Environment: ${ENV.NODE_ENV}`);
  if (ENV.KALSHI_DRY_RUN) {
    logWarn("KALSHI_DRY_RUN is enabled - no real orders will be placed");
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logError(`Port ${PORT} is already in use. Please stop the process using this port or use a different port.`);
    logError(`To find and kill the process: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  } else {
    logError("Server startup error", err);
    process.exit(1);
  }
});


