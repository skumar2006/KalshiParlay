import fetch from "node-fetch";
import { ENV } from "../config/env.js";

// Use environment from config instead of hardcoded flag
const USE_DEMO = !ENV.IS_PRODUCTION;
const KALSHI_DEMO_API_BASE = "https://demo-api.kalshi.co/trade-api/v2";
const KALSHI_PROD_API_BASE = "https://api.elections.kalshi.com/trade-api/v2";

const KALSHI_API_BASE_URL =
  ENV.KALSHI_API_BASE_URL || (USE_DEMO ? KALSHI_DEMO_API_BASE : KALSHI_PROD_API_BASE);

// Use appropriate API key based on environment
const API_KEY = USE_DEMO 
  ? ENV.KALSHI_DEMO_API_KEY || ENV.KALSHI_API_KEY
  : ENV.KALSHI_API_KEY;

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
  
  // First, try direct market lookup (faster and more reliable for single markets)
  // This handles cases where markets might not appear in series queries
  try {
    const directData = await kalshiRequest(`/markets/${upperTicker}`);
    if (directData.market) {
      console.log(`[kalshiClient] Found market via direct lookup: ${upperTicker}`);
      return { markets: [directData.market] };
    }
  } catch (err) {
    // Direct lookup failed - log the actual error details
    console.error(`[kalshiClient] Direct lookup failed for ${upperTicker}:`, err.message);
    console.error(`[kalshiClient] Error stack:`, err.stack);
    // Continue to series-based search
    console.log(`[kalshiClient] Trying series search...`);
  }
  
  // Extract series from ticker (e.g., "KXNFLGAME" from "KXNFLGAME-25NOV16SEALA")
  const seriesMatch = upperTicker.match(/^([A-Z]+)/);
  const series = seriesMatch ? seriesMatch[1] : null;
  
  console.log(`[kalshiClient] Extracted series: ${series} from ticker: ${upperTicker}`);
  
  if (series) {
    try {
      // Fetch markets for this series - try with higher limit first
      let data = await kalshiRequest(`/markets?series_ticker=${series}&limit=1000`);
      
      // If still not found, try searching all markets for this series without limit
      if (!data.markets || data.markets.length === 0) {
        console.log(`[kalshiClient] Trying without limit parameter...`);
        data = await kalshiRequest(`/markets?series_ticker=${series}`);
      }
      
      console.log(`[kalshiClient] Series query returned ${data.markets?.length || 0} markets`);
      
      // Also try searching by the full ticker as event_ticker
      if ((!data.markets || data.markets.length === 0) && upperTicker.includes('-')) {
        console.log(`[kalshiClient] Trying event_ticker search for ${upperTicker}`);
        try {
          const eventData = await kalshiRequest(`/markets?event_ticker=${upperTicker}&limit=500`);
          if (eventData.markets && eventData.markets.length > 0) {
            console.log(`[kalshiClient] Found ${eventData.markets.length} markets via event_ticker`);
            return { markets: eventData.markets };
          }
        } catch (eventErr) {
          console.log(`[kalshiClient] event_ticker search failed:`, eventErr.message);
        }
      }
      
      if (data.markets) {
        // First, try exact ticker match
        let market = data.markets.find(m => m.ticker === upperTicker);
        if (market) {
          console.log(`[kalshiClient] Found exact match in series: ${upperTicker}`);
          return { markets: [market] };
        }
        
        // Log first few tickers for debugging
        if (data.markets.length > 0) {
          console.log(`[kalshiClient] Sample tickers from series:`, data.markets.slice(0, 5).map(m => m.ticker));
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
          // For markets like KXINXU-25DEC05H1400, try matching without requiring trailing dash
          // The API might have markets like KXINXU-25DEC05H1400-T... (with price threshold)
          if (m.ticker && m.ticker.toUpperCase().startsWith(upperTicker)) {
            return true;
          }
          return false;
        });
        
        if (eventMarkets.length > 0) {
          console.log(`[kalshiClient] Found ${eventMarkets.length} markets for event ${upperTicker}`);
          // Return all markets for this event
          return { markets: eventMarkets };
        }
        
        // If still no match, try matching by date/time pattern for markets like KXINXU-25DEC05H1400
        // Extract date/time part (e.g., "25DEC05H1400" from "KXINXU-25DEC05H1400")
        const tickerParts = upperTicker.split('-');
        if (tickerParts.length >= 2) {
          const dateTimePart = tickerParts.slice(1).join('-'); // Everything after series
          console.log(`[kalshiClient] Trying to match by date/time pattern: ${dateTimePart}`);
          
          // Try to find markets that contain this date/time pattern
          const dateTimeMarkets = data.markets.filter(m => {
            if (!m.ticker) return false;
            // Check if ticker contains the date/time pattern
            const marketParts = m.ticker.split('-');
            if (marketParts.length >= 2) {
              const marketDateTime = marketParts.slice(1).join('-');
              // Match if the date/time part starts with our pattern (handles price suffixes like -T7574.9999)
              return marketDateTime.toUpperCase().startsWith(dateTimePart.toUpperCase());
            }
            return false;
          });
          
          if (dateTimeMarkets.length > 0) {
            console.log(`[kalshiClient] Found ${dateTimeMarkets.length} markets matching date/time pattern ${dateTimePart}`);
            return { markets: dateTimeMarkets };
          }
          
          // Original pattern matching (for events like KXPRESPERSON-28)
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
      console.error(`[kalshiClient] Failed to fetch markets for series ${series}:`, err.message);
      console.error(`[kalshiClient] Series error details:`, err);
    }
  }
  
  // Fallback: Try orderbook endpoint - sometimes markets are accessible here even if not in listings
  console.log(`[kalshiClient] Trying orderbook endpoint as fallback for ${upperTicker}`);
  try {
    const orderbookData = await kalshiRequest(`/markets/${upperTicker}/orderbook`);
    if (orderbookData.market) {
      console.log(`[kalshiClient] Found market via orderbook endpoint: ${upperTicker}`);
      return { markets: [orderbookData.market] };
    }
  } catch (orderbookErr) {
    console.log(`[kalshiClient] Orderbook endpoint also failed:`, orderbookErr.message);
  }
  
  // Fallback: return empty if not found
  console.warn(`[kalshiClient] Market ${upperTicker} not found via any method`);
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


