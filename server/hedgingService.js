import dotenv from 'dotenv';

dotenv.config();

/**
 * Variance Reduction Hedging Strategy
 * 
 * Goals:
 * 1. Reduce variance by hedging high-probability legs
 * 2. Maintain/increase positive EV
 * 3. Offer users 85-90% of AI-determined fair payout
 * 4. Log all reasoning for transparency
 * 
 * @param {Array} bets - Array of bet objects with marketTitle, optionLabel, prob
 * @param {number} userStake - The amount user is betting
 * @param {number} adjustedPayout - AI-determined fair payout (already 85-90% of true fair)
 * @param {number} adjustedProbability - AI-adjusted probability (accounts for correlation)
 * @param {Object} aiAnalysis - Full AI analysis for logging
 * @returns {Object} Hedging strategy details
 */
export function calculateHedgingStrategy(bets, userStake, adjustedPayout, adjustedProbability, aiAnalysis = {}) {
  console.log("\n" + "=".repeat(80));
  console.log("🎯 VARIANCE REDUCTION HEDGING STRATEGY");
  console.log("=".repeat(80));
  
  // Step 1: Log parlay details
  console.log("\n📊 PARLAY DETAILS:");
  console.log(`   Number of legs: ${bets.length}`);
  console.log(`   User stake: $${userStake.toFixed(2)}`);
  
  console.log("\n   Legs:");
  bets.forEach((bet, i) => {
    console.log(`   ${i + 1}. ${bet.marketTitle}`);
    console.log(`      Betting on: ${bet.optionLabel}`);
    console.log(`      Kalshi probability: ${bet.prob}%`);
  });
  
  // Step 2: Calculate naive (independent) probability
  const naiveCombinedProb = bets.reduce((acc, bet) => acc * (bet.prob / 100), 1);
  const naivePayout = userStake / naiveCombinedProb;
  
  console.log("\n💭 FAIR VALUE CALCULATION:");
  console.log(`   Naive combined probability: ${(naiveCombinedProb * 100).toFixed(2)}%`);
  console.log(`   (Assuming independent events)`);
  console.log(`   Naive payout: $${naivePayout.toFixed(2)}`);
  
  // Step 3: Show AI adjustment
  console.log("\n🤖 AI CORRELATION ANALYSIS:");
  if (aiAnalysis.correlationAnalysis) {
    console.log(`   ${aiAnalysis.correlationAnalysis}`);
  }
  console.log(`   AI-adjusted probability: ${(adjustedProbability * 100).toFixed(2)}%`);
  console.log(`   Correlation factor: ${aiAnalysis.correlationFactor || 'N/A'}`);
  
  const fairPayout = userStake / adjustedProbability;
  console.log(`   True fair payout: $${fairPayout.toFixed(2)}`);
  
  if (aiAnalysis.reasoning) {
    console.log(`\n   Reasoning: ${aiAnalysis.reasoning}`);
  }
  
  // Step 4: Show what we're offering the user
  const payoutPercentage = (adjustedPayout / fairPayout) * 100;
  console.log("\n💰 PAYOUT TO USER:");
  console.log(`   Fair payout: $${fairPayout.toFixed(2)}`);
  console.log(`   Offering: $${adjustedPayout.toFixed(2)} (${payoutPercentage.toFixed(1)}% of fair)`);
  console.log(`   House edge: ${(100 - payoutPercentage).toFixed(1)}%`);
  
  // Step 5: Calculate unhedged position
  const userWinProb = adjustedProbability;
  const userLoseProb = 1 - userWinProb;
  const unhedgedEV = (userStake * userLoseProb) - (adjustedPayout * userWinProb);
  const unhedgedEdge = (unhedgedEV / userStake) * 100;
  
  console.log("\n📈 UNHEDGED POSITION:");
  console.log(`   If user WINS (${(userWinProb * 100).toFixed(2)}%): -$${(adjustedPayout - userStake).toFixed(2)}`);
  console.log(`   If user LOSES (${(userLoseProb * 100).toFixed(2)}%): +$${userStake.toFixed(2)}`);
  console.log(`   Expected value: $${unhedgedEV.toFixed(2)}`);
  console.log(`   Edge: ${unhedgedEdge.toFixed(2)}%`);
  
  const unhedgedVariance = Math.pow(adjustedPayout - userStake, 2) * userWinProb + 
                           Math.pow(userStake, 2) * userLoseProb - 
                           Math.pow(unhedgedEV, 2);
  const unhedgedStdDev = Math.sqrt(unhedgedVariance);
  console.log(`   Standard deviation: $${unhedgedStdDev.toFixed(2)}`);
  console.log(`   ⚠️  High variance - outcome range: -$${(adjustedPayout - userStake).toFixed(2)} to +$${userStake.toFixed(2)}`);
  
  // Step 6: Determine which legs to hedge
  console.log("\n🛡️ HEDGING DECISION:");
  console.log("   Strategy: Hedge high-probability legs to reduce variance");
  console.log("   Rule: Hedge legs with probability > 50%");
  
  const hedgingDecisions = [];
  const hedgeBets = [];
  
  bets.forEach((bet, i) => {
    const prob = bet.prob;
    let decision;
    let hedgeAmount = 0;
    let reasoning;
    
    if (prob >= 65) {
      // High probability - definitely hedge
      hedgeAmount = userStake * 0.40; // 40% of stake
      decision = "✅ HEDGE";
      reasoning = `High probability (${prob}%) - aggressive hedge to reduce variance`;
    } else if (prob >= 55) {
      // Medium-high probability - moderate hedge
      hedgeAmount = userStake * 0.25; // 25% of stake
      decision = "✅ HEDGE";
      reasoning = `Medium-high probability (${prob}%) - moderate hedge`;
    } else if (prob >= 50) {
      // Medium probability - light hedge
      hedgeAmount = userStake * 0.15; // 15% of stake
      decision = "✅ HEDGE";
      reasoning = `Medium probability (${prob}%) - light hedge`;
    } else {
      // Low probability - don't hedge
      decision = "❌ NO HEDGE";
      reasoning = `Low probability (${prob}%) - hedging cost exceeds variance benefit`;
    }
    
    hedgingDecisions.push({
      leg: i + 1,
      market: bet.marketTitle,
      option: bet.optionLabel,
      probability: prob,
      decision,
      hedgeAmount,
      reasoning
    });
    
    if (hedgeAmount > 0) {
      const kalshiOdds = 1 / (prob / 100);
      const potentialWin = hedgeAmount * kalshiOdds;
      
      hedgeBets.push({
        leg: i + 1,
        market: bet.marketTitle,
        option: bet.optionLabel,
        probability: prob,
        hedgeAmount,
        potentialWin,
        cost: hedgeAmount,
        ticker: bet.ticker || null, // Kalshi ticker for API
        marketId: bet.marketId || null
      });
    }
    
    console.log(`\n   Leg ${i + 1}: ${bet.marketTitle} - ${bet.optionLabel} (${prob}%)`);
    console.log(`   Decision: ${decision}`);
    console.log(`   ${reasoning}`);
    if (hedgeAmount > 0) {
      const kalshiOdds = 1 / (prob / 100);
      const potentialWin = hedgeAmount * kalshiOdds;
      console.log(`   Hedge: Bet $${hedgeAmount.toFixed(2)} on Kalshi`);
      console.log(`   If wins: Return $${potentialWin.toFixed(2)} (profit: $${(potentialWin - hedgeAmount).toFixed(2)})`);
    }
  });
  
  // Step 7: Calculate all scenarios with hedging
  const totalHedgeCost = hedgeBets.reduce((sum, bet) => sum + bet.cost, 0);
  
  if (hedgeBets.length === 0) {
    console.log("\n📊 NO HEDGING NEEDED:");
    console.log(`   All legs have probability < 50%`);
    console.log(`   Variance is acceptable for this parlay`);
    console.log(`   Maintain unhedged position with ${unhedgedEdge.toFixed(2)}% edge`);
    console.log("\n" + "=".repeat(80) + "\n");
    
    return {
      needsHedging: false,
      unhedgedEV: unhedgedEV,
      unhedgedEdge: unhedgedEdge,
      unhedgedStdDev: unhedgedStdDev,
      reasoning: "No high-probability legs to hedge"
    };
  }
  
  console.log(`\n💸 TOTAL HEDGING COST: $${totalHedgeCost.toFixed(2)}`);
  
  // Calculate all possible outcomes
  console.log("\n🎲 SCENARIO ANALYSIS:");
  console.log("   Calculating all possible outcomes...");
  
  const scenarios = calculateAllScenarios(bets, userStake, adjustedPayout, hedgeBets);
  
  // Show key scenarios
  scenarios.sort((a, b) => b.probability - a.probability);
  
  console.log("\n   Top scenarios by probability:");
  scenarios.slice(0, 5).forEach((scenario, i) => {
    console.log(`\n   ${i + 1}. ${scenario.description} (${(scenario.probability * 100).toFixed(2)}% chance)`);
    console.log(`      Net result: ${scenario.net >= 0 ? '+' : ''}$${scenario.net.toFixed(2)}`);
    scenario.breakdown.forEach(line => console.log(`      ${line}`));
  });
  
  // Calculate hedged EV and variance
  const hedgedEV = scenarios.reduce((sum, s) => sum + (s.net * s.probability), 0);
  const hedgedEdge = (hedgedEV / userStake) * 100;
  
  const hedgedVariance = scenarios.reduce((sum, s) => {
    return sum + (Math.pow(s.net - hedgedEV, 2) * s.probability);
  }, 0);
  const hedgedStdDev = Math.sqrt(hedgedVariance);
  
  console.log("\n📊 HEDGED POSITION:");
  console.log(`   Expected value: $${hedgedEV.toFixed(2)}`);
  console.log(`   Edge: ${hedgedEdge.toFixed(2)}%`);
  console.log(`   Standard deviation: $${hedgedStdDev.toFixed(2)}`);
  
  const varianceReduction = ((unhedgedStdDev - hedgedStdDev) / unhedgedStdDev) * 100;
  const evChange = ((hedgedEV - unhedgedEV) / Math.abs(unhedgedEV)) * 100;
  
  console.log("\n✅ HEDGING IMPACT:");
  console.log(`   Variance reduction: ${varianceReduction.toFixed(1)}%`);
  console.log(`   EV change: ${evChange >= 0 ? '+' : ''}${evChange.toFixed(1)}%`);
  console.log(`   Edge: ${unhedgedEdge.toFixed(2)}% → ${hedgedEdge.toFixed(2)}%`);
  
  if (hedgedEV > unhedgedEV && varianceReduction > 0) {
    console.log(`   🎊 WIN-WIN: Higher EV AND lower variance!`);
  } else if (varianceReduction > 0) {
    console.log(`   ✅ SUCCESS: Reduced variance while maintaining positive EV`);
  } else {
    console.log(`   ⚠️  WARNING: Hedging may not be optimal for this parlay`);
  }
  
  console.log("\n" + "=".repeat(80) + "\n");
  
  return {
    needsHedging: true,
    hedgingDecisions,
    hedgeBets,
    totalHedgeCost,
    scenarios: scenarios.slice(0, 10), // Top 10 scenarios
    unhedged: {
      ev: unhedgedEV,
      edge: unhedgedEdge,
      stdDev: unhedgedStdDev
    },
    hedged: {
      ev: hedgedEV,
      edge: hedgedEdge,
      stdDev: hedgedStdDev
    },
    impact: {
      varianceReduction: varianceReduction,
      evChange: evChange
    }
  };
}

/**
 * Calculate all possible scenarios for a parlay with hedging
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
