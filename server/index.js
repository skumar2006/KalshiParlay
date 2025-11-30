/**
 * Main Server Entry Point
 * Express server for Kalshi Parlay Helper API
 */

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import { getMarketById } from "./kalshiClient.js";
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
  getWithdrawalRequests
} from "./db.js";
import { checkParlayStatus, checkAllActiveParlays } from "./parlayStatusService.js";
import { generateParlayQuote } from "./aiQuoteService.js";
import { calculateHedgingStrategy } from "./hedgingService.js";
import { executeHedgingStrategy } from "./kalshiTradeClient.js";
import { ENV, validateEnvironment } from "../config/env.js";
import { CONFIG, ERROR_MESSAGES, HTTP_STATUS } from "../config/constants.js";
import { logError, logInfo, logSection, logWarn, logDebug } from "./utils/logger.js";

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

app.use(cors()); // For dev: allow all origins (including the extension)

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
        
        logInfo(`Purchase Details - User ID: ${payment.user_id}, Stake: $${payment.stake}, Legs: ${payment.parlay_data.length}`);
        
        // Extract quote data
        const quoteData = payment.quote_data || {};
        const payout = quoteData.payout ? parseFloat(quoteData.payout.adjustedPayout) : 0;
        
        logInfo(`Payout Info - Promised payout: $${payout.toFixed(2)}, Potential profit: $${(payout - payment.stake).toFixed(2)}`);
        
        // Update pending payment status
        await updatePaymentStatus(session.id, 'completed');
        logInfo("Updated pending payment status to 'completed'");
        
        // Save to completed purchases
        const completedPurchase = await saveCompletedPurchase(
          session.id,
          payment.user_id,
          payment.stake,
          payout,
          payment.parlay_data,
          quoteData,
          quoteData.hedgingStrategy || null,
          stripeAmount
        );
        
        logInfo(`Saved to completed_purchases (ID: ${completedPurchase.id})`);
        
        // Execute hedging strategy
        const hedgingStrategy = quoteData.hedgingStrategy;
        
        // Debug: Log parlay probabilities to understand hedging decision
        if (payment.parlay_data && payment.parlay_data.length > 0) {
          logInfo("Parlay leg probabilities:");
          payment.parlay_data.forEach((bet, i) => {
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
              payment.parlay_data
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
    const imageUrl = null; // v2 API doesn't include images in /markets

    // Build contracts from all markets in this event
    const contracts = [];
    
    markets.forEach(market => {
      if (market.market_type === "binary") {
        // Extract the team/option from the ticker (e.g., "SEA" or "LA")
        const tickerParts = market.ticker.split('-');
        const optionLabel = tickerParts[tickerParts.length - 1];
        
        // Calculate midpoint prices from bid/ask if available
        const yesBid = market.yes_bid || 0;
        const yesAsk = market.yes_ask || 0;
        
        const yesMid = (yesBid && yesAsk) ? (yesBid + yesAsk) / 2 : (yesBid || yesAsk || 0);
        
        contracts.push({
          id: market.ticker,
          ticker: market.ticker, // Kalshi ticker for API trading
          label: optionLabel,
          price: yesMid,
          prob: Math.round(yesMid)
        });
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
  
  try {
    const bets = await getParlayBets(userId, environment || null);
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
  
  logDebug(`Received bet for user ${userId}`, bet);
  
  try {
    const newBet = await addParlayBet(userId, bet);
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
  
  try {
    await removeParlayBet(userId, betId);
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
  
  try {
    await clearParlayBets(userId);
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
  
  try {
    const purchases = await getUserPurchaseHistory(userId);
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
  
  try {
    const purchase = await getCompletedPurchase(sessionId);
    
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
    await claimParlayWinnings(sessionId);
    
    // Add to user's wallet balance
    await addUserBalance(purchase.user_id, purchase.claimable_amount);
    
    logInfo(`Winnings claimed: User ${purchase.user_id}, Amount: $${purchase.claimable_amount}, Session: ${sessionId}`);
    
    res.json({ 
      success: true, 
      message: "Winnings added to your account balance",
      amount: purchase.claimable_amount
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
  
  try {
    const purchases = await getUserPurchaseHistory(userId);
    
    // Enrich with leg outcomes
    const enriched = await Promise.all(purchases.map(async (purchase) => {
      const outcomes = await getParlayBetOutcomes(purchase.id);
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
  
  try {
    const wallet = await getUserWallet(userId);
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
 * Request withdrawal (Stripe payout)
 * @route POST /api/withdraw/:userId
 */
app.post("/api/withdraw/:userId", async (req, res) => {
  const { userId } = req.params;
  const { amount, bankAccountId } = req.body; // bankAccountId from Stripe Customer
  
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
  
  if (!bankAccountId) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
      error: "Bank account ID required" 
    });
  }
  
  try {
    const wallet = await getUserWallet(userId);
    const balance = parseFloat(wallet.balance || 0);
    
    if (amount > balance) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ 
        error: "Insufficient balance" 
      });
    }
    
    // Create Stripe payout
    const payout = await stripe.payouts.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: 'usd',
      method: 'standard', // or 'instant' (fees apply)
      destination: bankAccountId,
      metadata: {
        user_id: userId,
        type: 'parlay_winnings'
      }
    });
    
    // Create withdrawal request record
    const withdrawal = await createWithdrawalRequest(
      userId,
      amount,
      'stripe',
      payout.id
    );
    
    // Deduct from wallet balance
    await addUserBalance(userId, -amount);
    
    logInfo(`Withdrawal requested: User ${userId}, Amount: $${amount}, Payout ID: ${payout.id}`);
    
    res.json({ 
      success: true, 
      withdrawal_id: withdrawal.id,
      payout_id: payout.id,
      amount: amount,
      estimated_arrival: payout.arrival_date,
      message: `Withdrawal initiated. Funds will arrive by ${new Date(payout.arrival_date * 1000).toLocaleDateString()}`
    });
  } catch (err) {
    logError("Error processing withdrawal", err);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ 
      error: "Failed to process withdrawal", 
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
  
  try {
    const withdrawals = await getWithdrawalRequests(userId);
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
    
    // Save full payment details to database (avoids 500-char metadata limit)
    await savePendingPayment(session.id, userId, stake, parlayBets, quote);
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
 * GET /payment-success
 * 
 * Success page after payment
 */
app.get("/payment-success", async (req, res) => {
  const sessionId = req.query.session_id;
  
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
    const metadata = session.metadata;
    
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
              <span class="value">$${(session.amount_total / 100).toFixed(2)}</span>
            </div>
            <div class="details-row">
              <span class="label">Stake:</span>
              <span class="value">$${metadata.stake}</span>
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
    console.error("Error retrieving session:", err);
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
});


