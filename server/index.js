import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import { getMarketById, getMarketOrderbook } from "./kalshiClient.js";
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
  getUserPurchaseHistory
} from "./db.js";
import { generateParlayQuote } from "./aiQuoteService.js";
import { calculateHedgingStrategy } from "./hedgingService.js";
import { executeHedgingStrategy } from "./kalshiTradeClient.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Initialize Stripe
const stripe = new Stripe(process.env.STRIPE_API_KEY);

app.use(cors()); // For dev: allow all origins (including the extension)

// Stripe webhook needs raw body, so we'll handle it separately
app.post('/api/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  let event;
  
  try {
    // Verify webhook signature (in production, use STRIPE_WEBHOOK_SECRET)
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      // For development without webhook signing
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error(`⚠️  Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const stripeAmount = session.amount_total / 100;
      
      console.log("\n" + "=".repeat(80));
      console.log("💳 STRIPE PAYMENT CONFIRMED");
      console.log("=".repeat(80));
      console.log(`\n✅ Session ID: ${session.id}`);
      console.log(`💰 Amount paid: $${stripeAmount.toFixed(2)}`);
      console.log(`📧 Customer email: ${session.customer_details?.email || 'N/A'}`);
      
      // Get payment details from database
      try {
        const payment = await getPendingPayment(session.id);
        
        if (!payment) {
          console.error(`\n❌ ERROR: Payment record not found in database`);
          console.error(`   Session ID: ${session.id}`);
          console.log("\n" + "=".repeat(80) + "\n");
          break;
        }
        
        console.log(`\n📊 PURCHASE DETAILS:`);
        console.log(`   User ID: ${payment.user_id}`);
        console.log(`   Stake: $${payment.stake}`);
        console.log(`   Number of legs: ${payment.parlay_data.length}`);
        
        console.log(`\n🎯 PARLAY BETS:`);
        payment.parlay_data.forEach((bet, i) => {
          console.log(`   ${i + 1}. ${bet.marketTitle}`);
          console.log(`      Option: ${bet.optionLabel} (${bet.prob}%)`);
        });
        
        // Extract quote data
        const quoteData = payment.quote_data || {};
        const payout = quoteData.payout ? parseFloat(quoteData.payout.adjustedPayout) : 0;
        
        console.log(`\n💵 PAYOUT INFO:`);
        console.log(`   Promised payout if wins: $${payout.toFixed(2)}`);
        console.log(`   Potential profit: $${(payout - payment.stake).toFixed(2)}`);
        
        // Update pending payment status
        await updatePaymentStatus(session.id, 'completed');
        console.log(`\n✅ Updated pending payment status to 'completed'`);
        
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
        
        console.log(`\n✅ Saved to completed_purchases (ID: ${completedPurchase.id})`);
        
        // Execute hedging strategy
        const hedgingStrategy = quoteData.hedgingStrategy;
        
        if (hedgingStrategy && hedgingStrategy.needsHedging) {
          console.log(`\n🛡️ EXECUTING HEDGING STRATEGY:`);
          console.log(`   Strategy: ${hedgingStrategy.strategy || 'variance_reduction'}`);
          
          if (hedgingStrategy.hedgeBets && hedgingStrategy.hedgeBets.length > 0) {
            console.log(`   Number of hedge bets: ${hedgingStrategy.hedgeBets.length}`);
            console.log(`   Total hedge cost: $${hedgingStrategy.totalHedgeCost.toFixed(2)}`);
            
            // Execute hedging strategy through Kalshi API
            const hedgeResult = await executeHedgingStrategy(
              hedgingStrategy.hedgeBets,
              {
                userId: payment.user_id,
                sessionId: session.id,
                stake: payment.stake,
                payout: payout
              }
            );
            
            if (hedgeResult.success) {
              console.log(`\n   ✅ Hedging execution completed!`);
              console.log(`   ${hedgeResult.successful}/${hedgeResult.totalOrders} orders placed successfully`);
              
              // Mark as executed in database
              await markHedgeExecuted(session.id);
              console.log(`   ✅ Marked hedge as executed in database`);
            } else {
              console.log(`\n   ⚠️  Hedging execution had issues:`);
              console.log(`   ${hedgeResult.successful}/${hedgeResult.totalOrders} orders succeeded`);
              console.log(`   ${hedgeResult.failed}/${hedgeResult.totalOrders} orders failed`);
              
              // Still mark as attempted
              await markHedgeExecuted(session.id);
              console.log(`   ℹ️  Marked hedge attempt in database`);
            }
          } else {
            console.log(`   ℹ️  No individual hedge bets needed`);
          }
        } else {
          console.log(`\n✅ NO HEDGING NEEDED`);
          console.log(`   Reason: ${hedgingStrategy?.reasoning || 'Low-probability parlay, acceptable variance'}`);
        }
        
        // Clear user's parlay (they've placed their bet)
        await clearParlayBets(payment.user_id);
        console.log(`\n✅ Cleared user's parlay bets from active parlays`);
        
        console.log(`\n🎉 PAYMENT PROCESSING COMPLETE`);
        console.log(`   User can now track their bet`);
        console.log(`   Hedging strategy logged and ready for execution`);
        
      } catch (err) {
        console.error(`\n❌ ERROR PROCESSING PAYMENT:`);
        console.error(`   ${err.message}`);
        console.error(err.stack);
      }
      
      console.log("\n" + "=".repeat(80) + "\n");
      break;
    }
    case 'checkout.session.expired':
      console.log(`⏱️  Checkout session expired: ${event.data.object.id}`);
      break;
    case 'payment_intent.succeeded':
      console.log(`💰 PaymentIntent succeeded: ${event.data.object.id}`);
      break;
    case 'payment_intent.payment_failed':
      console.log(`❌ Payment failed: ${event.data.object.id}`);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  // Return a response to acknowledge receipt of the event
  res.json({received: true});
});

// JSON parsing for all other routes
app.use(express.json());

// Initialize database on startup
initializeDatabase().catch(err => {
  console.error('[Server] Failed to initialize database:', err);
});

/**
 * Health check
 */
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

/**
 * GET /api/kalshi/market/:id
 *
 * Returns a simplified view of a Kalshi market for the extension:
 * - title
 * - image URL (if available)
 * - list of contracts/options with prices and approximate probabilities
 */
app.get("/api/kalshi/market/:id", async (req, res) => {
  const marketId = req.params.id;

  try {
    const data = await getMarketById(marketId);
    
    // The API returns { markets: [{...}] }
    const markets = data.markets || [];
    
    if (markets.length === 0) {
      return res.status(404).json({ error: "Market not found" });
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
    console.error("Error in /api/kalshi/market/:id", err);
    res
      .status(500)
      .json({ error: "Failed to fetch market data from Kalshi", details: `${err}` });
  }
});

/**
 * GET /api/parlay/:userId
 * 
 * Get all parlay bets for a user
 */
app.get("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    const bets = await getParlayBets(userId);
    res.json({ bets });
  } catch (err) {
    console.error("Error in GET /api/parlay/:userId", err);
    res.status(500).json({ error: "Failed to fetch parlay bets", details: `${err}` });
  }
});

/**
 * POST /api/parlay/:userId
 * 
 * Add a bet to the user's parlay
 * Body: { marketId, marketTitle, imageUrl, optionId, optionLabel, prob }
 */
app.post("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  const bet = req.body;
  
  console.log('[POST /api/parlay] Received bet:', JSON.stringify(bet, null, 2));
  
  try {
    const newBet = await addParlayBet(userId, bet);
    console.log('[POST /api/parlay] Successfully added bet:', newBet.id);
    res.json({ bet: newBet });
  } catch (err) {
    console.error("[POST /api/parlay] Error adding bet:", err);
    console.error("[POST /api/parlay] Error stack:", err.stack);
    res.status(500).json({ error: "Failed to add bet to parlay", details: err.message });
  }
});

/**
 * DELETE /api/parlay/:userId/:betId
 * 
 * Remove a bet from the user's parlay
 */
app.delete("/api/parlay/:userId/:betId", async (req, res) => {
  const { userId, betId } = req.params;
  
  try {
    await removeParlayBet(userId, betId);
    res.json({ success: true });
  } catch (err) {
    console.error("Error in DELETE /api/parlay/:userId/:betId", err);
    res.status(500).json({ error: "Failed to remove bet from parlay", details: `${err}` });
  }
});

/**
 * DELETE /api/parlay/:userId
 * 
 * Clear all bets from the user's parlay
 */
app.delete("/api/parlay/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    await clearParlayBets(userId);
    res.json({ success: true });
  } catch (err) {
    console.error("Error in DELETE /api/parlay/:userId", err);
    res.status(500).json({ error: "Failed to clear parlay", details: `${err}` });
  }
});

/**
 * GET /api/purchase-history/:userId
 * 
 * Get completed purchase history for a user
 */
app.get("/api/purchase-history/:userId", async (req, res) => {
  const { userId } = req.params;
  
  try {
    const purchases = await getUserPurchaseHistory(userId);
    res.json({ success: true, purchases });
  } catch (err) {
    console.error("Error fetching purchase history:", err);
    res.status(500).json({ error: "Failed to fetch purchase history", details: err.message });
  }
});

/**
 * POST /api/quote
 * 
 * Generate AI-powered quote for a parlay
 * Body: { bets: [...], stake: number }
 */
app.post("/api/quote", async (req, res) => {
  const { bets, stake } = req.body;
  
  if (!bets || !Array.isArray(bets) || bets.length === 0) {
    return res.status(400).json({ error: "Bets array is required" });
  }
  
  if (!stake || stake <= 0) {
    return res.status(400).json({ error: "Valid stake amount is required" });
  }
  
  try {
    console.log(`[Quote] Generating AI quote for ${bets.length} bets with $${stake} stake`);
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
    console.error("Error generating quote:", err);
    res.status(500).json({ 
      error: "Failed to generate quote", 
      details: err.message 
    });
  }
});

/**
 * POST /api/create-checkout-session
 * 
 * Create a Stripe Checkout session for payment
 * Body: { userId, stake, parlayBets, quote }
 */
app.post("/api/create-checkout-session", async (req, res) => {
  const { userId, stake, parlayBets, quote } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: "User ID is required" });
  }
  
  if (!stake || stake <= 0) {
    return res.status(400).json({ error: "Valid stake amount is required" });
  }
  
  if (!parlayBets || !Array.isArray(parlayBets) || parlayBets.length === 0) {
    return res.status(400).json({ error: "Parlay bets are required" });
  }
  
  try {
    // Create a description of the parlay
    const parlayDescription = parlayBets.map(bet => 
      `${bet.marketTitle} - ${bet.optionLabel} @ ${bet.prob}%`
    ).join(', ');
    
    const truncatedDescription = parlayDescription.length > 500 
      ? parlayDescription.substring(0, 497) + '...'
      : parlayDescription;
    
    console.log(`[Stripe] Creating checkout session for user ${userId}, stake: $${stake}`);
    
    // Create Stripe Checkout Session with minimal metadata
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
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
      mode: 'payment',
      success_url: `http://localhost:${PORT}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:${PORT}/payment-cancel`,
      metadata: {
        userId,
        stake: stake.toString(),
        betCount: parlayBets.length.toString(),
      },
    });
    
    console.log(`✅ Checkout session created: ${session.id}`);
    
    // Save full payment details to database (avoids 500-char metadata limit)
    await savePendingPayment(session.id, userId, stake, parlayBets, quote);
    console.log(`✅ Payment details saved to database`);
    
    res.json({ 
      sessionId: session.id,
      checkoutUrl: session.url 
    });
  } catch (err) {
    console.error("Error creating checkout session:", err);
    res.status(500).json({ 
      error: "Failed to create checkout session", 
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Kalshi backend listening on http://localhost:${PORT}`);
});


