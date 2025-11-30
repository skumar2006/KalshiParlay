/**
 * Parlay Status Service
 * Checks Kalshi markets for settlement status and updates parlay outcomes
 */

import { getMarketById } from './kalshiClient.js';
import { 
  getCompletedPurchase, 
  updateParlayBetOutcome,
  updateParlayStatus,
  getActiveParlays
} from './db.js';
import { logError, logInfo, logWarn } from './utils/logger.js';

/**
 * Determine if user's bet won based on settlement price
 * For binary markets: settlement_price >= 50 means YES won, < 50 means NO won
 * Since each ticker represents a YES bet on that specific outcome, if settlement_price >= 50, YES won
 * @param {string} ticker - The ticker the user bet on
 * @param {number} settlementPrice - Settlement price (0-100)
 * @returns {string} 'win' or 'loss'
 */
function determineBetOutcome(ticker, settlementPrice) {
  // In Kalshi binary markets, each ticker represents a YES bet on that specific outcome
  // If settlement_price >= 50, YES won (the ticker won)
  // If settlement_price < 50, NO won (the ticker lost)
  return settlementPrice >= 50 ? 'win' : 'loss';
}

/**
 * Check if a market is settled and get the outcome
 * @param {string} ticker - Kalshi market ticker
 * @param {string} optionId - The ticker/option the user bet on (same as ticker for binary markets)
 * @returns {Object} { settled: boolean, outcome: 'win'|'loss'|'pending', settlementPrice: number }
 */
export async function checkMarketOutcome(ticker, optionId) {
  try {
    const marketData = await getMarketById(ticker);
    const markets = marketData.markets || [];
    
    if (markets.length === 0) {
      return { settled: false, outcome: 'pending', error: 'Market not found' };
    }
    
    // Find the specific market
    const market = markets.find(m => m.ticker === ticker.toUpperCase());
    if (!market) {
      return { settled: false, outcome: 'pending', error: 'Market not found' };
    }
    
    // Check market status
    // Kalshi API fields: status, settlement_price
    const status = market.status || market.market_status;
    const isSettled = status === 'settled' || status === 'closed';
    
    if (!isSettled) {
      return { settled: false, outcome: 'pending' };
    }
    
    // Get settlement price (0-100, where 100 = YES won, 0 = NO won)
    const settlementPrice = market.settlement_price || market.settlementPrice;
    
    if (settlementPrice === null || settlementPrice === undefined) {
      return { settled: false, outcome: 'pending', error: 'Settlement price not available' };
    }
    
    const outcome = determineBetOutcome(ticker, settlementPrice);
    
    return {
      settled: true,
      outcome,
      settlementPrice: parseFloat(settlementPrice)
    };
  } catch (error) {
    logError(`Error checking market outcome for ${ticker}`, error);
    return { settled: false, outcome: 'pending', error: error.message };
  }
}

/**
 * Check all legs of a parlay and update status
 * @param {string} sessionId - Purchase session ID
 * @returns {Object} Updated parlay status
 */
export async function checkParlayStatus(sessionId) {
  const purchase = await getCompletedPurchase(sessionId);
  if (!purchase) {
    throw new Error('Purchase not found');
  }
  
  const parlayData = typeof purchase.parlay_data === 'string' 
    ? JSON.parse(purchase.parlay_data) 
    : purchase.parlay_data || [];
  
  const outcomes = [];
  
  // Check each leg
  for (let i = 0; i < parlayData.length; i++) {
    const leg = parlayData[i];
    const legNumber = i + 1;
    
    if (!leg.ticker) {
      logWarn(`Leg ${legNumber} missing ticker for parlay ${sessionId}`);
      outcomes.push({
        legNumber,
        outcome: 'pending',
        error: 'No ticker available'
      });
      continue;
    }
    
    const result = await checkMarketOutcome(leg.ticker, leg.optionId || leg.ticker);
    
    // Update database
    await updateParlayBetOutcome(
      purchase.id,
      legNumber,
      leg.ticker,
      leg.optionId || leg.ticker,
      result.settled ? 'settled' : 'open',
      result.outcome,
      result.settlementPrice
    );
    
    outcomes.push({
      legNumber,
      ...result
    });
  }
  
  // Determine overall parlay status
  const allSettled = outcomes.every(o => o.settled);
  const anyLost = outcomes.some(o => o.outcome === 'loss');
  const allWon = outcomes.every(o => o.outcome === 'win');
  
  let parlayStatus = 'pending';
  let claimableAmount = 0;
  
  if (allSettled) {
    if (allWon) {
      parlayStatus = 'won';
      claimableAmount = parseFloat(purchase.payout);
    } else {
      parlayStatus = 'lost';
      claimableAmount = 0;
    }
  }
  
  // Update parlay status
  await updateParlayStatus(
    sessionId,
    parlayStatus,
    claimableAmount
  );
  
  return {
    status: parlayStatus,
    claimableAmount,
    outcomes,
    allSettled
  };
}

/**
 * Batch check all active parlays
 * Should be run periodically (cron job or scheduled task)
 */
export async function checkAllActiveParlays() {
  const activeParlays = await getActiveParlays();
  
  logInfo(`Checking ${activeParlays.length} active parlays...`);
  
  for (const parlay of activeParlays) {
    try {
      await checkParlayStatus(parlay.session_id);
    } catch (error) {
      logError(`Error checking parlay ${parlay.session_id}`, error);
    }
  }
  
  logInfo(`Finished checking ${activeParlays.length} parlays`);
}

