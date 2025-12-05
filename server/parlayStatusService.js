/**
 * Parlay Status Service
 * Checks Kalshi markets for settlement status and updates parlay outcomes
 */

import { getMarketById, getMarketDetails } from './kalshiClient.js';
import { 
  getCompletedPurchase, 
  updateParlayBetOutcome,
  updateParlayStatus,
  getActiveParlays,
  getParlayBetOutcomes
} from './db.js';
import { logError, logInfo, logWarn, logDebug } from './utils/logger.js';

/**
 * Determine if user's bet won based on settlement price
 * For binary markets: settlement_price of 100 means YES won, 0 means NO won
 * Since each ticker represents a YES bet on that specific outcome, if settlement_price is 100 (or > 0), YES won
 * @param {string} ticker - The ticker the user bet on
 * @param {number} settlementPrice - Settlement price (0-100)
 * @returns {string} 'win' or 'loss'
 */
function determineBetOutcome(ticker, settlementPrice) {
  // In Kalshi binary markets, each ticker represents a YES bet on that specific outcome
  // Settlement price of 100 = YES won (the ticker won)
  // Settlement price of 0 = NO won (the ticker lost)
  // Kalshi typically settles at exactly 0 or 100, but we check > 0 to be safe
  
  // Convert to number if it's a string
  const price = typeof settlementPrice === 'string' ? parseFloat(settlementPrice) : settlementPrice;
  
  // If settlement price is > 0, YES won (bet won)
  // If settlement price is 0, NO won (bet lost)
  const outcome = price > 0 ? 'win' : 'loss';
  
  // Only log when market is actually settled (not for every check)
  // logInfo(`Outcome for ${ticker}: ${outcome} (settlement price: ${price})`);
  return outcome;
}

/**
 * Check if a market is settled and get the outcome
 * @param {string} ticker - Kalshi market ticker
 * @param {string} optionId - The ticker/option the user bet on (same as ticker for binary markets)
 * @returns {Object} { settled: boolean, outcome: 'win'|'loss'|'pending', settlementPrice: number }
 */
export async function checkMarketOutcome(ticker, optionId) {
  try {
    // Try to get detailed market info first (more reliable for settlement status)
    let market = await getMarketDetails(ticker);
    
    // Fallback to getMarketById if getMarketDetails doesn't work
    if (!market) {
      const marketData = await getMarketById(ticker);
      const markets = marketData.markets || [];
      
      if (markets.length === 0) {
        logWarn(`Market ${ticker} not found`);
        return { settled: false, outcome: 'pending', error: 'Market not found' };
      }
      
      // Find the specific market
      market = markets.find(m => m.ticker === ticker.toUpperCase());
      if (!market) {
        logWarn(`Market ${ticker} not found in results`);
        return { settled: false, outcome: 'pending', error: 'Market not found' };
      }
    }
    
    // Check market status - try multiple possible field names
    const status = market.status || market.market_status || market.state || market.market_state;
    
    // Check for settlement indicators - Kalshi uses various status values
    // Common values: 'open', 'closed', 'settled', 'resolved', 'cancelled'
    const isSettled = status === 'settled' || 
                      status === 'closed' || 
                      status === 'resolved' ||
                      status === 'finalized' ||
                      (status && status.toLowerCase().includes('settle')) ||
                      (status && status.toLowerCase().includes('close'));
    
    // Also check if settlement_price exists (even if status doesn't indicate settled)
    // Try multiple possible field names for settlement price
    // IMPORTANT: Use !== undefined checks because 0 is a valid settlement price (means NO won)
    // Kalshi uses different field names: settlement_price, settlement_value, result ("yes"/"no")
    let settlementPrice = null;
    
    // First check numeric settlement fields
    if (market.settlement_price !== undefined && market.settlement_price !== null) {
      settlementPrice = market.settlement_price;
    } else if (market.settlementPrice !== undefined && market.settlementPrice !== null) {
      settlementPrice = market.settlementPrice;
    } else if (market.settlement_value !== undefined && market.settlement_value !== null) {
      settlementPrice = market.settlement_value;
    } else if (market.settlement !== undefined && market.settlement !== null) {
      settlementPrice = market.settlement;
    }
    
    // If no numeric settlement price found, check result field
    // result: "yes" means YES won (settlement = 100), "no" means NO won (settlement = 0)
    if (settlementPrice === null && market.result !== undefined && market.result !== null) {
      if (market.result === 'yes' || market.result === true) {
        settlementPrice = 100;
      } else if (market.result === 'no' || market.result === false) {
        settlementPrice = 0;
      }
    }
    
    // If we have a settlement price, the market is settled regardless of status
    const hasSettlementPrice = settlementPrice !== null && 
                               settlementPrice !== undefined && 
                               settlementPrice !== '';
    
    // Market is considered settled if either status indicates settled OR settlement price exists
    if (!isSettled && !hasSettlementPrice) {
      // Market is still active/pending - no need to log
      return { settled: false, outcome: 'pending', status };
    }
    
    // Only log when market is actually settled or when there's an issue
    if (isSettled || hasSettlementPrice) {
      logInfo(`Market ${ticker} settled - status: ${status}, settlementPrice: ${settlementPrice}, result: ${market.result || 'N/A'}`);
    }
    
    // If status says settled but no settlement price, log warning but still try to determine outcome
    if (isSettled && !hasSettlementPrice) {
      logWarn(`Market ${ticker} status is ${status} but no settlement price available. Checking other fields...`);
      
      // Check if there are other indicators of outcome (e.g., yes_bid/no_bid being null/0)
      // Or check if there's a result field
      if (market.result !== null && market.result !== undefined) {
        logInfo(`Market ${ticker} has result field: ${market.result}`);
        // If result exists, treat as settled
        const outcome = market.result === 'yes' || market.result === true ? 'win' : 'loss';
        return {
          settled: true,
          outcome,
          settlementPrice: market.result === 'yes' || market.result === true ? 100 : 0,
          status
        };
      }
      
      return { settled: false, outcome: 'pending', error: 'Settlement price not available', status };
    }
    
    // If we have settlement price, use it to determine outcome
    const finalSettlementPrice = parseFloat(settlementPrice);
    const outcome = determineBetOutcome(ticker, finalSettlementPrice);
    
    // Log outcome when market is settled
    logInfo(`Market ${ticker} settled: ${outcome} (settlement price: ${finalSettlementPrice})`);
    
    return {
      settled: true,
      outcome,
      settlementPrice: finalSettlementPrice,
      status: status || 'settled'
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
  
  // Get existing outcomes from database first
  const existingOutcomes = await getParlayBetOutcomes(purchase.id);
  
  const outcomes = [];
  
  // Check each leg
  for (let i = 0; i < parlayData.length; i++) {
    const leg = parlayData[i];
    const legNumber = i + 1;
    
    // Check if this leg is already settled in database
    const existingOutcome = existingOutcomes.find(o => o.leg_number === legNumber);
    
    // Only use existing outcome if it's settled AND has a valid settlement price
    // If settlement_price is null, we need to re-check Kalshi to get the correct value
    if (existingOutcome && 
        existingOutcome.market_status === 'settled' && 
        existingOutcome.settlement_price !== null && 
        existingOutcome.settlement_price !== undefined) {
      // Use existing settled outcome from database (don't check Kalshi)
      outcomes.push({
        legNumber,
        settled: true,
        outcome: existingOutcome.outcome,
        settlementPrice: parseFloat(existingOutcome.settlement_price)
      });
      continue;
    }
    
    // If existing outcome exists but has null settlement_price, log it
    if (existingOutcome && existingOutcome.market_status === 'settled' && 
        (existingOutcome.settlement_price === null || existingOutcome.settlement_price === undefined)) {
      logWarn(`Leg ${legNumber} (${leg.ticker}) is marked as settled but has null settlement_price. Re-checking from Kalshi...`);
    }
    
    // Only check Kalshi API if leg is not already settled
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

