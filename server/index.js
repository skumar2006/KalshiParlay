/**
 * Main Server Entry Point
 * Express server for Kalshi Parlay Helper API
 */

import express from "express";
import cors from "cors";
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
      path === '/api/health' ||
      path === '/health' ||
      path === '/api/webhook/test' ||
      path === '/api/config' ||
      path === '/auth/callback' ||
      path === '/api/auth/callback' ||
      path.startsWith('/api/zkp2p-') ||
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

// Public config endpoint - serves Supabase credentials and backend URL for frontend
// The anon key is safe to expose publicly (that's its purpose)
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: ENV.SUPABASE_URL || null,
    supabaseAnonKey: ENV.SUPABASE_ANON_KEY || null,
    backendUrl: ENV.BACKEND_BASE_URL || `${req.protocol}://${req.get('host')}`,
    environment: ENV.ENVIRONMENT
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

// JSON parsing for all routes
app.use(express.json());

// Initialize database on startup (non-blocking)
// Don't crash if Supabase is temporarily unavailable - the app can still serve other endpoints
initializeDatabase().catch(err => {
  logError("Failed to initialize database", err);
  logWarn("Server will continue running, but database operations may fail until Supabase is available");
  logWarn("Please check your SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables");
  // Don't exit - allow server to start and retry later
});

/**
 * Health check endpoint
 * @route GET /api/health or /health
 */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

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
        
        // Calculate mid price for internal calculations (average of bid and ask)
        const yesMid = (yesBid && yesAsk) ? (yesBid + yesAsk) / 2 : (yesBid || yesAsk || 0);
        const noMid = (noBid && noAsk) ? (noBid + noAsk) / 2 : (noBid || noAsk || 0);
        
        // Use ask price for displayed probability (what users see when buying on Kalshi)
        // Show one decimal place to match Kalshi's frontend precision
        const yesProb = yesAsk || yesBid || 0;
        const noProb = noAsk || noBid || 0;
        
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
            price: yesMid, // Keep mid price for internal calculations
            prob: Math.round(yesProb * 10) / 10, // One decimal place, using ask price
            bid: yesBid,
            ask: yesAsk
          },
          no: {
            id: `${fullTicker}-NO`,
            ticker: fullTicker, // Kalshi ticker for API trading
            label: optionLabel,
            side: 'NO',
            price: noMid, // Keep mid price for internal calculations
            prob: Math.round(noProb * 10) / 10, // One decimal place, using ask price
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
  
  // Add this at the very start
  console.log(`[Wallet API] ===== ENDPOINT HIT ===== User: ${userId}, Has Token: ${!!token}`);
  
  try {
    console.log(`[Wallet API] Calling getUserWallet for ${userId}...`);
    const wallet = await getUserWallet(userId, token);
    console.log(`[Wallet API] getUserWallet returned:`, JSON.stringify(wallet, null, 2));
    
    logInfo(`[Wallet API] Fetched wallet for user ${userId}:`, {
      hasAddress: !!wallet.crypto_wallet_address,
      address: wallet.crypto_wallet_address,
      balance: wallet.balance,
      keys: Object.keys(wallet)
    });
    
    const walletAddress = wallet.crypto_wallet_address || null;
    
    if (!walletAddress) {
      console.warn(`[Wallet API] ⚠️ NO WALLET ADDRESS FOUND for user ${userId}`);
      logWarn(`[Wallet API] No wallet address found for user ${userId}. Wallet data:`, wallet);
    }
    
    res.json({ 
      success: true, 
      balance: parseFloat(wallet.balance || 0),
      walletAddress: walletAddress
    });
  } catch (err) {
    console.error(`[Wallet API] ===== ERROR CAUGHT =====`, err);
    console.error(`[Wallet API] Error message:`, err.message);
    console.error(`[Wallet API] Error stack:`, err.stack);
    logError("Error fetching wallet", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to fetch wallet", 
      details: err.message 
    });
  }
});

/**
 * Get ZKP2P onramp URL for user
 * @route GET /api/zkp2p-onramp/:userId
 */
app.get("/api/zkp2p-onramp/:userId", async (req, res) => {
  try {
  const { userId } = req.params;
    const { amount } = req.query; // Optional preset amount in USD
    const token = req.headers.authorization?.substring(7);
    
    logInfo(`[ZKP2P] Request received for user ${userId}, amount: ${amount || 'none'}`);
    
    // Verify auth (but don't block if token is missing - route handles it)
    if (token && supabaseAuth) {
      try {
        const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
        if (authError || !user || user.id !== userId) {
          logWarn(`[ZKP2P] Auth check failed for user ${userId}:`, authError?.message || 'User mismatch');
          return res.status(403).json({ error: "Unauthorized", details: authError?.message });
        }
        logInfo(`[ZKP2P] Auth verified for user ${userId}`);
      } catch (authErr) {
        logWarn("[ZKP2P] Auth verification failed, proceeding anyway", authErr);
      }
      } else {
      logWarn("[ZKP2P] No token provided, proceeding without auth verification");
    }
    
    // Get user's Solana wallet address
    const wallet = await getUserWallet(userId, token);
    const walletAddress = wallet.crypto_wallet_address;
    
    if (!walletAddress) {
      return res.status(400).json({ 
        error: "Wallet address not found. Please ensure your wallet is set up." 
      });
    }
    
    // Build ZKP2P URL (format: https://zkp2p.xyz/swap?referrer=...&callbackUrl=...&amountUsdc=...&recipientAddress=...)
    const baseUrl = ENV.BACKEND_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const params = new URLSearchParams({
      referrer: 'Kalshi Parlay Helper',
      callbackUrl: `${baseUrl}/api/zkp2p-callback`,
      recipientAddress: walletAddress, // Solana wallet address (base58)
    });
    
    // Add optional amount (convert to USDC with 6 decimals if provided)
    if (amount) {
      const amountUsdc = (parseFloat(amount) * 1000000).toString(); // Convert to USDC (6 decimals)
      params.append('amountUsdc', amountUsdc);
    }
    
    const zkp2pUrl = `https://zkp2p.xyz/swap?${params.toString()}`;
    
    logInfo(`[ZKP2P] Generated onramp URL for user ${userId}, wallet: ${walletAddress}`);
    
    res.json({ 
      success: true, 
      onrampUrl: zkp2pUrl,
      walletAddress,
      network: 'solana',
      message: "Use this link to deposit USDC to your Solana wallet"
    });
  } catch (err) {
    logError("Error generating ZKP2P onramp link", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to generate onramp link",
      details: err.message 
    });
  }
});

/**
 * ZKP2P callback endpoint (for redirect after successful onramp)
 * @route GET /api/zkp2p-callback
 */
app.get("/api/zkp2p-callback", async (req, res) => {
  // This endpoint can be used to handle successful onramp redirects
  // For now, just redirect to a success page or return success
  logInfo("[ZKP2P] Callback received", req.query);
  res.json({ success: true, message: "Onramp completed successfully" });
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
        logInfo(`Executing orders on Kalshi ${ENV.IS_PRODUCTION ? 'production' : 'demo'} environment...`);
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


