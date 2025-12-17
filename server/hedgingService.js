import dotenv from 'dotenv';
import { ENV } from '../config/env.js';

dotenv.config();

/**
 * Simplified Parlay Hedging Algorithm
 * 
 * Goal: Keep EV positive, reduce tail risk/variance, never risk more than margin
 * 
 * Algorithm:
 * 1. Compute margin = S - p_parlay * P_quote
 * 2. Compute delta per leg (contribution to tail risk)
 * 3. Compute raw exposure per leg = delta * P_quote
 * 4. Compute alpha scaling factor (constrained by budget and max)
 * 5. Compute hedges per leg = alpha * raw_exposure
 * 6. Guarantees EV_post_hedge = margin - expected_hedge_cost > 0
 * 
 * @param {Array} bets - Array of bet objects with marketTitle, optionLabel, prob
 * @param {number} userStake - The amount user is betting (S)
 * @param {number} adjustedPayout - Quoted payout to user (P_quote)
 * @param {number} adjustedProbability - AI-adjusted parlay probability (accounts for correlation)
 * @param {Object} aiAnalysis - Full AI analysis for logging
 * @param {number} beta - Fraction of margin to spend on hedging (default 0.6)
 * @param {number} alphaMax - Maximum fraction of raw exposure to hedge (default 0.4)
 * @returns {Object} Hedging strategy details
 */
export function calculateHedgingStrategy(
  bets, 
  userStake, 
  adjustedPayout, 
  adjustedProbability, 
  aiAnalysis = {},
  beta = ENV.HEDGE_BETA,
  alphaMax = ENV.HEDGE_ALPHA_MAX
) {
  const verboseLogging = ENV.VERBOSE_HEDGING;
  
  if (verboseLogging) {
    console.log("\n" + "=".repeat(80));
    console.log("🎯 SIMPLIFIED PARLAY HEDGING ALGORITHM");
    console.log("=".repeat(80));
  }
  
  const n = bets.length;
  const S = userStake;
  const P_quote = adjustedPayout;
  const p_parlay = adjustedProbability; // Already adjusted for correlation
  
  // Extract leg probabilities
  const p = bets.map(bet => bet.prob / 100); // Convert percentages to decimals
  
  if (verboseLogging) {
    console.log("\n📊 PARLAY DETAILS:");
    console.log(`   Number of legs: ${n}`);
    console.log(`   User stake: $${S.toFixed(2)}`);
    console.log(`   Quoted payout: $${P_quote.toFixed(2)}`);
    console.log(`   Parlay probability: ${(p_parlay * 100).toFixed(2)}%`);
    console.log("\n   Legs:");
    bets.forEach((bet, i) => {
      console.log(`   ${i + 1}. ${bet.marketTitle} - ${bet.optionLabel} (${(p[i] * 100).toFixed(1)}%)`);
    });
  }
  
  // Step 0: Compute parlay probability & margin
  // Note: We use adjustedProbability (already accounts for correlation) instead of naive product
  const margin = S - p_parlay * P_quote;
  const hedgeBudget = beta * margin;
  
  if (verboseLogging) {
    console.log("\n💰 MARGIN CALCULATION:");
    console.log(`   Margin extracted: $${margin.toFixed(2)}`);
    console.log(`   Hedge budget (β=${beta}): $${hedgeBudget.toFixed(2)}`);
    console.log(`   Max hedge fraction (α_max=${alphaMax}): ${(alphaMax * 100).toFixed(0)}%`);
  }
  
  // If margin is negative or zero, no hedging makes sense
  if (margin <= 0) {
    const unhedgedStdDev = Math.sqrt(
      p_parlay * Math.pow(P_quote - S, 2) + 
      (1 - p_parlay) * Math.pow(S, 2) - 
      Math.pow(margin, 2)
    );
    
    console.log("\n⚠️  WARNING: Negative or zero margin - no hedging possible");
    console.log(`   Margin: $${margin.toFixed(2)}`);
    console.log(`   This means quoted payout is too high relative to probability`);
    
    return {
      needsHedging: false,
      unhedgedEV: margin,
      unhedgedEdge: (margin / S) * 100,
      unhedgedStdDev: unhedgedStdDev,
      reasoning: "Negative margin - quoted payout exceeds expected value"
    };
  }
  
  // Step 1: Compute delta per leg
  // Delta = contribution of each leg to parlay tail risk
  const deltas = [];
  for (let j = 0; j < n; j++) {
    let delta = 1;
    for (let k = 0; k < n; k++) {
      if (k !== j) {
        delta *= p[k];
      }
    }
    deltas.push(delta);
  }
  
  if (verboseLogging) {
    console.log("\n📐 DELTA CALCULATION (tail risk contribution per leg):");
    bets.forEach((bet, i) => {
      console.log(`   Leg ${i + 1}: Δ = ${deltas[i].toFixed(4)} (${(deltas[i] * 100).toFixed(2)}% contribution)`);
    });
  }
  
  // Step 2: Compute raw exposure per leg
  const E = deltas.map(delta => delta * P_quote);
  
  if (verboseLogging) {
    console.log("\n💵 RAW EXPOSURE PER LEG:");
    bets.forEach((bet, i) => {
      console.log(`   Leg ${i + 1}: E = $${E[i].toFixed(2)}`);
    });
  }
  
  // Step 3: Compute alpha (hedge scaling factor)
  const rawCost = E.reduce((sum, E_j, j) => sum + E_j * p[j], 0);
  const alpha = Math.min(hedgeBudget / rawCost, alphaMax);
  
  if (verboseLogging) {
    console.log("\n⚖️  ALPHA CALCULATION:");
    console.log(`   Raw expected hedge cost: $${rawCost.toFixed(2)}`);
    console.log(`   Hedge budget: $${hedgeBudget.toFixed(2)}`);
    console.log(`   Alpha (scaling factor): ${alpha.toFixed(4)} (${(alpha * 100).toFixed(2)}%)`);
    if (alpha >= alphaMax) {
      console.log(`   ⚠️  Alpha capped at α_max = ${alphaMax}`);
    }
  }
  
  // Step 4: Compute hedges per leg
  let hedges = E.map(E_j => alpha * E_j);
  
  // Ensure minimum hedge amount per leg (guarantees every leg gets hedged)
  // This prevents zero or near-zero hedge amounts that might get filtered out
  const MIN_HEDGE_AMOUNT = 0.01; // Minimum $0.01 per leg
  
  // Find the smallest non-zero hedge amount
  const nonZeroHedges = hedges.filter(h => h > 0);
  const minNonZeroHedge = nonZeroHedges.length > 0 ? Math.min(...nonZeroHedges) : MIN_HEDGE_AMOUNT;
  
  // Apply minimum hedge amount to all legs
  // If a hedge is zero or very small, use a proportional minimum
  hedges = hedges.map((h, i) => {
    if (h === 0) {
      // If exactly zero, use 10% of smallest non-zero hedge or minimum
      return Math.max(MIN_HEDGE_AMOUNT, minNonZeroHedge * 0.1);
    }
    if (h < MIN_HEDGE_AMOUNT) {
      // If very small but non-zero, use minimum
      return MIN_HEDGE_AMOUNT;
    }
    return h;
  });
  
  // Recalculate total hedge cost with minimums applied
  let totalHedgeCost = hedges.reduce((sum, h) => sum + h, 0);
  
  // Adjust alpha if total cost exceeds budget (shouldn't happen often, but safety check)
  if (totalHedgeCost > hedgeBudget * 1.1) {
    // Scale down proportionally if we're over budget
    const scaleFactor = (hedgeBudget * 1.0) / totalHedgeCost; // Use 100% of budget
    hedges = hedges.map(h => h * scaleFactor);
    totalHedgeCost = hedges.reduce((sum, h) => sum + h, 0);
  }
  
  if (verboseLogging) {
    console.log("\n🛡️  HEDGE SIZES PER LEG:");
    bets.forEach((bet, i) => {
      const hedgeAmount = hedges[i];
      const kalshiOdds = 1 / p[i];
      const potentialWin = hedgeAmount * kalshiOdds;
      console.log(`   Leg ${i + 1}: $${hedgeAmount.toFixed(2)}`);
      console.log(`      If wins: Return $${potentialWin.toFixed(2)} (profit: $${(potentialWin - hedgeAmount).toFixed(2)})`);
    });
    console.log(`   Total hedge cost: $${hedges.reduce((sum, h) => sum + h, 0).toFixed(2)}`);
  }
  
  // Step 5: Compute post-hedge EV
  const expectedHedgeCost = hedges.reduce((sum, h, j) => sum + h * p[j], 0);
  const EV_post_hedge = margin - expectedHedgeCost;
  const postHedgeEdge = (EV_post_hedge / S) * 100;
  
  if (verboseLogging) {
    console.log("\n📊 POST-HEDGE EV:");
    console.log(`   Expected hedge cost: $${expectedHedgeCost.toFixed(2)}`);
    console.log(`   Post-hedge EV: $${EV_post_hedge.toFixed(2)}`);
    console.log(`   Post-hedge edge: ${postHedgeEdge.toFixed(2)}%`);
    console.log(`   ✅ EV remains positive: ${EV_post_hedge > 0 ? 'YES' : 'NO'}`);
  }
  
  // Build hedge bets array (for compatibility with existing code)
  // IMPORTANT: Create hedge bets for ALL legs, ensuring every leg is hedged
  const hedgeBets = [];
  const hedgingDecisions = [];
  
  console.log(`\n📊 CREATING HEDGE BETS FOR ${n} LEGS:`);
  
  for (let i = 0; i < n; i++) {
    const hedgeAmount = hedges[i];
    const prob = bets[i].prob;
    const kalshiOdds = 1 / (prob / 100);
    const potentialWin = hedgeAmount * kalshiOdds;
    
    console.log(`   Leg ${i + 1}/${n}: ${bets[i].marketTitle} - $${hedgeAmount.toFixed(2)}`);
    
    hedgingDecisions.push({
      leg: i + 1,
      market: bets[i].marketTitle,
      option: bets[i].optionLabel,
      probability: prob,
      decision: "✅ HEDGE",
      hedgeAmount,
      reasoning: `Delta-based hedge: Δ=${deltas[i].toFixed(4)}, α=${alpha.toFixed(4)}`
    });
    
    hedgeBets.push({
      leg: i + 1,
      market: bets[i].marketTitle,
      option: bets[i].optionLabel,
      probability: prob,
      hedgeAmount,
      potentialWin,
      cost: hedgeAmount,
      ticker: bets[i].ticker || null,
      marketId: bets[i].marketId || null,
      delta: deltas[i],
      rawExposure: E[i]
    });
  }
  
  console.log(`✅ Created ${hedgeBets.length} hedge bets for ${n} legs (should match!)`);
  
  // Calculate variance reduction
  const unhedgedStdDev = Math.sqrt(
    p_parlay * Math.pow(P_quote - S, 2) + 
    (1 - p_parlay) * Math.pow(S, 2) - 
    Math.pow(margin, 2)
  );
  
  // Estimate hedged variance (simplified - assumes hedges reduce tail risk)
  // This is an approximation; full calculation would require scenario analysis
  const hedgedStdDev = unhedgedStdDev * (1 - alpha * 0.5); // Rough estimate
  const varianceReduction = ((unhedgedStdDev - hedgedStdDev) / unhedgedStdDev) * 100;
  
  // Always log summary
  console.log(`\n🛡️ Hedging: ${hedgeBets.length} bets, $${totalHedgeCost.toFixed(2)} cost, ${varianceReduction.toFixed(1)}% variance reduction, EV: $${EV_post_hedge.toFixed(2)}`);
  
  if (verboseLogging) {
    console.log("\n✅ HEDGING SUMMARY:");
    console.log(`   Strategy: Delta-based with alpha scaling`);
    console.log(`   Margin: $${margin.toFixed(2)}`);
    console.log(`   Hedge budget: $${hedgeBudget.toFixed(2)}`);
    console.log(`   Alpha: ${alpha.toFixed(4)}`);
    console.log(`   Post-hedge EV: $${EV_post_hedge.toFixed(2)}`);
    console.log(`   Variance reduction: ${varianceReduction.toFixed(1)}%`);
    console.log("\n" + "=".repeat(80) + "\n");
  }
  
  return {
    needsHedging: true,
    strategy: 'delta_based',
    hedgingDecisions,
    hedgeBets,
    totalHedgeCost,
    alpha,
    margin,
    hedgeBudget,
    unhedged: {
      ev: margin,
      edge: (margin / S) * 100,
      stdDev: unhedgedStdDev
    },
    hedged: {
      ev: EV_post_hedge,
      edge: postHedgeEdge,
      stdDev: hedgedStdDev
    },
    impact: {
      varianceReduction: varianceReduction,
      evChange: ((EV_post_hedge - margin) / Math.abs(margin)) * 100
    },
    parameters: {
      beta,
      alphaMax,
      deltas,
      rawExposures: E
    }
  };
}

/**
 * Calculate all possible scenarios for a parlay with hedging
 * (Kept for backward compatibility and detailed scenario analysis)
 */
function calculateAllScenarios(bets, userStake, userPayout, hedgeBets) {
  const scenarios = [];
  const numLegs = bets.length;
  const numOutcomes = Math.pow(2, numLegs);
  
  // Generate all possible combinations of wins/losses
  for (let i = 0; i < numOutcomes; i++) {
    const outcome = i.toString(2).padStart(numLegs, '0');
    const legResults = outcome.split('').map(bit => bit === '1');
    
    // Check if parlay wins (all legs must win)
    const parlayWins = legResults.every(result => result);
    
    // Calculate probability of this outcome
    let probability = 1;
    legResults.forEach((wins, idx) => {
      const legProb = bets[idx].prob / 100;
      probability *= wins ? legProb : (1 - legProb);
    });
    
    // Calculate net result
    let net = userStake; // Start with user's stake
    
    // User's parlay result
    if (parlayWins) {
      net -= userPayout; // Pay out user
    }
    
    // Hedge bet results
    const breakdown = [];
    breakdown.push(`Collect from user: +$${userStake.toFixed(2)}`);
    
    if (parlayWins) {
      breakdown.push(`Pay user (parlay won): -$${userPayout.toFixed(2)}`);
    } else {
      breakdown.push(`User's parlay failed: $0`);
    }
    
    hedgeBets.forEach((hedge) => {
      const hedgeLegIdx = hedge.leg - 1;
      if (legResults[hedgeLegIdx]) {
        // Hedge bet wins
        net += hedge.potentialWin;
        breakdown.push(`Win ${hedge.market} hedge: +$${hedge.potentialWin.toFixed(2)}`);
      } else {
        // Hedge bet loses
        net -= hedge.cost;
        breakdown.push(`Lose ${hedge.market} hedge: -$${hedge.cost.toFixed(2)}`);
      }
    });
    
    // Generate description
    const winningLegs = bets.filter((_, idx) => legResults[idx]).map(b => b.option);
    const description = parlayWins 
      ? "User's parlay WINS (all legs hit)"
      : winningLegs.length > 0
        ? `Partial: ${winningLegs.join(', ')} win`
        : "All legs lose";
    
    scenarios.push({
      outcome,
      description,
      parlayWins,
      legResults,
      probability,
      net,
      breakdown
    });
  }
  
  return scenarios;
}
