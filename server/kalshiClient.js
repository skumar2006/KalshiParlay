import fetch from "node-fetch";
import dotenv from "dotenv";

// Ensure .env is loaded before we read process.env in this module.
dotenv.config();

// Use demo environment for market data fetching
const USE_DEMO = true;
const KALSHI_DEMO_API_BASE = "https://demo-api.kalshi.co/trade-api/v2";
const KALSHI_PROD_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

const KALSHI_API_BASE_URL =
  process.env.KALSHI_API_BASE_URL || (USE_DEMO ? KALSHI_DEMO_API_BASE : KALSHI_PROD_API_BASE);

// Use demo API key for demo environment
const API_KEY = USE_DEMO 
  ? process.env.KALSHI_DEMO_API_KEY || process.env.KALSHI_API_KEY
  : process.env.KALSHI_API_KEY;

if (!API_KEY) {
  const envVar = USE_DEMO ? 'KALSHI_DEMO_API_KEY' : 'KALSHI_API_KEY';
  // eslint-disable-next-line no-console
  console.warn(
    `[kalshiClient] ${envVar} is not set. Requests to Kalshi will fail.`
  );
}

async function kalshiRequest(path) {
  const url = `${KALSHI_API_BASE_URL}${path}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY || ""}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Kalshi API error ${res.status} ${res.statusText}: ${text}`
    );
  }

  return res.json();
}

/**
 * Fetch metadata for a single market or event by ticker.
 * The URL might contain either a market ticker or an event ticker.
 * Uses the series_ticker filter to narrow results, then finds matches.
 */
export async function getMarketById(marketId) {
  const upperTicker = marketId.toUpperCase();
  
  // Extract series from ticker (e.g., "KXNFLGAME" from "KXNFLGAME-25NOV16SEALA")
  const seriesMatch = upperTicker.match(/^([A-Z]+)/);
  const series = seriesMatch ? seriesMatch[1] : null;
  
  if (series) {
    try {
      // Fetch markets for this series
      const data = await kalshiRequest(`/markets?series_ticker=${series}&limit=500`);
      
      if (data.markets) {
        // First, try exact ticker match
        let market = data.markets.find(m => m.ticker === upperTicker);
        if (market) {
          return { markets: [market] };
        }
        
        // If not found, the URL might be an event ticker
        // Find all markets that belong to this event
        // For event tickers like "KXPRESPERSON-28", markets are like "KXPRESPERSON-28-JVAN"
        const eventMarkets = data.markets.filter(m => {
          // Match by event_ticker field if it exists
          if (m.event_ticker && m.event_ticker.toUpperCase() === upperTicker) {
            return true;
          }
          // Match by ticker prefix (e.g., "KXPRESPERSON-28-JVAN" starts with "KXPRESPERSON-28-")
          if (m.ticker && m.ticker.toUpperCase().startsWith(upperTicker + '-')) {
            return true;
          }
          return false;
        });
        
        if (eventMarkets.length > 0) {
          console.log(`[kalshiClient] Found ${eventMarkets.length} markets for event ${upperTicker}`);
          // Return all markets for this event
          return { markets: eventMarkets };
        }
        
        // If still no match and the ticker looks like an event ticker (contains numbers after series)
        // Try to match by series and event number pattern
        // For example, "KXPRESPERSON-28" should match markets like "KXPRESPERSON-28-*"
        const tickerParts = upperTicker.split('-');
        if (tickerParts.length >= 2) {
          const eventPattern = tickerParts.slice(0, 2).join('-'); // e.g., "KXPRESPERSON-28"
          const patternMarkets = data.markets.filter(m => 
            m.ticker && m.ticker.toUpperCase().startsWith(eventPattern + '-')
          );
          
          if (patternMarkets.length > 0) {
            console.log(`[kalshiClient] Found ${patternMarkets.length} markets matching pattern ${eventPattern}-*`);
            return { markets: patternMarkets };
          }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch markets for series ${series}:`, err);
    }
  }
  
  // Fallback: return empty if not found
  return { markets: [] };
}

/**
 * Fetch full details for a specific market ticker.
 * Uses the /markets/{ticker} endpoint to get complete market information.
 * This includes fields like subtitle, yes_sub_title, no_sub_title which contain full option names.
 */
export async function getMarketDetails(ticker) {
  const upperTicker = ticker.toUpperCase();
  try {
    const data = await kalshiRequest(`/markets/${upperTicker}`);
    return data.market || null;
  } catch (err) {
    console.error(`Failed to fetch market details for ${upperTicker}:`, err);
    return null;
  }
}

/**
 * Fetch orderbook for a specific market ticker.
 * Uses the /markets/{ticker}/orderbook endpoint per Kalshi docs.
 */
export async function getMarketOrderbook(marketId) {
  const upperTicker = marketId.toUpperCase();
  try {
    return await kalshiRequest(`/markets/${upperTicker}/orderbook`);
  } catch (err) {
    console.error(`Failed to fetch orderbook for ${upperTicker}:`, err);
    return {};
  }
}


