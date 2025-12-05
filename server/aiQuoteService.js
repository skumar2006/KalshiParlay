import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Analyzes a parlay for event correlation and generates a smart payout percentage
 * @param {Array} bets - Array of bet objects with marketTitle, optionLabel, prob
 * @param {number} stake - The stake amount in dollars
 * @returns {Object} Quote with analysis and recommended payout percentage
 */
export async function generateParlayQuote(bets, stake) {
  if (!bets || bets.length === 0) {
    throw new Error('No bets provided');
  }

  // Calculate naive combined probability (assuming independence)
  const naiveCombinedProb = bets.reduce((acc, bet) => {
    return acc * (bet.prob / 100);
  }, 1);
  
  const naivePayout = stake / naiveCombinedProb;

  // Prepare comprehensive bet descriptions for AI analysis
  // Include all available information for better correlation assessment
  const betDescriptions = bets.map((bet, idx) => {
    let description = `${idx + 1}. Market: ${bet.marketTitle || 'Unknown'}`;
    
    if (bet.optionLabel) {
      description += `\n   Option: ${bet.optionLabel}`;
    }
    
    if (bet.ticker) {
      description += `\n   Ticker: ${bet.ticker}`;
    }
    
    if (bet.marketId) {
      description += `\n   Market ID: ${bet.marketId}`;
    }
    
    if (bet.side) {
      description += `\n   Side: ${bet.side}`;
    }
    
    if (bet.prob !== undefined && bet.prob !== null) {
      description += `\n   Probability: ${bet.prob}%`;
    }
    
    if (bet.marketUrl) {
      description += `\n   URL: ${bet.marketUrl}`;
    }
    
    return description;
  }).join('\n\n');

  // Create comprehensive prompt for OpenAI with all available context
  const prompt = `You are an expert in probability theory and prediction market correlations. Analyze this parlay bet for event correlation and provide a fair payout percentage.

PARLAY DETAILS:
${betDescriptions}

Stake Amount: $${stake}
Naive Combined Probability (assuming independence): ${(naiveCombinedProb * 100).toFixed(2)}%
Naive Payout: $${naivePayout.toFixed(2)}

ADDITIONAL CONTEXT:
- Market tickers can help identify if bets are from the same event/series (e.g., "KXPRESPERSON-28-*" indicates same election event)
- Market IDs and URLs provide context about the specific markets
- Option labels show the specific outcomes being bet on
- Use all available information to assess correlation more accurately

ANALYSIS REQUIRED:
1. Determine if these events are correlated (positively, negatively, or independent)
2. Assess how the correlation affects the true combined probability
3. Consider common factors: same sport/league, timing, related outcomes, causal relationships
4. Calculate a correlation-adjusted probability
5. Recommend a fair payout percentage that accounts for correlation

RESPONSE FORMAT (JSON):
{
  "correlationAnalysis": "Brief analysis of how these events relate to each other and any correlation present",
  "correlationFactor": 0.95,
  "adjustedProbability": 0.XX,
  "recommendedPayoutPercentage": XX,
  "reasoning": "Explanation of the adjusted probability and payout recommendation",
  "riskAssessment": "low/medium/high",
  "confidenceLevel": "Description of confidence in this analysis"
}

CRITICAL CONSTRAINTS:
- The adjusted probability must ALWAYS be >= naive probability (never lower)
- The true fair payout must ALWAYS be <= naive payout (never higher)
- We never offer better odds than the independent assumption
- This ensures conservative, house-favorable pricing

Notes:
- correlationFactor: 
  * 1.0 = independent events (no correlation)
  * >1.0 = positive correlation (events likely to occur together, INCREASES combined probability)
  * NEVER use <1.0 (would decrease probability and increase payout - NOT ALLOWED)
- adjustedProbability: Must be >= naive probability. If events are correlated, this should be HIGHER than naive.
- recommendedPayoutPercentage: What percentage of the naive payout to offer (typically 85-95%)
- Positive correlation → Higher adjusted probability → Lower fair payout → Good for house
- Independent → Keep at naive probability → Offer 85-95% of naive payout
- NEVER suggest negative correlation or correlation factor < 1.0

EXAMPLE:
If naive probability is 10% (naive payout $100):
- Independent: adjustedProbability = 0.10, correlationFactor = 1.0, recommend 90% payout ($90) ✅
- Positively correlated: adjustedProbability = 0.12, correlationFactor = 1.2, recommend 85% payout ($85) ✅
- WRONG: adjustedProbability = 0.08, correlationFactor = 0.8, payout would be $112 ❌ NEVER DO THIS`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are an expert probability analyst specializing in correlation analysis for prediction markets. Provide precise, mathematically sound analysis in JSON format."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3, // Lower temperature for more consistent analysis
    });

    const aiResponse = JSON.parse(completion.choices[0].message.content);

    // Calculate adjusted payout
    const adjustedPayout = naivePayout * (aiResponse.recommendedPayoutPercentage / 100);
    const potentialProfit = adjustedPayout - stake;
    const effectiveOdds = adjustedPayout / stake;

    return {
      success: true,
      quote: {
        stake: stake,
        bets: bets.map(b => ({
          market: b.marketTitle,
          option: b.optionLabel,
          probability: b.prob,
          ticker: b.ticker || null,
          marketId: b.marketId || null,
          side: b.side || null,
          marketUrl: b.marketUrl || null,
          imageUrl: b.imageUrl || null
        })),
        analysis: {
          naiveCombinedProbability: (naiveCombinedProb * 100).toFixed(2) + '%',
          adjustedProbability: (aiResponse.adjustedProbability * 100).toFixed(2) + '%',
          correlationFactor: aiResponse.correlationFactor,
          correlationAnalysis: aiResponse.correlationAnalysis,
          reasoning: aiResponse.reasoning,
          riskAssessment: aiResponse.riskAssessment,
          confidenceLevel: aiResponse.confidenceLevel
        },
        payout: {
          naivePayout: naivePayout.toFixed(2),
          recommendedPayoutPercentage: aiResponse.recommendedPayoutPercentage,
          adjustedPayout: adjustedPayout.toFixed(2),
          potentialProfit: potentialProfit.toFixed(2),
          effectiveOdds: effectiveOdds.toFixed(2)
        },
        timestamp: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 minutes
      }
    };
  } catch (error) {
    console.error('OpenAI API Error:', error);
    throw new Error(`Failed to generate AI quote: ${error.message}`);
  }
}


