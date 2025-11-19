import fetch from "node-fetch";
import dotenv from "dotenv";

// Ensure .env is loaded before we read process.env in this module.
dotenv.config();

const KALSHI_API_BASE_URL =
  process.env.KALSHI_API_BASE_URL || "https://api.elections.kalshi.com/trade-api/v2";

if (!process.env.KALSHI_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    "[kalshiClient] KALSHI_API_KEY is not set. Requests to Kalshi will fail."
  );
}

async function kalshiRequest(path) {
  const url = `${KALSHI_API_BASE_URL}${path}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.KALSHI_API_KEY || ""}`,
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
        const eventMarkets = data.markets.filter(m => 
          m.event_ticker === upperTicker || m.ticker.startsWith(upperTicker + '-')
        );
        
        if (eventMarkets.length > 0) {
          // Return all markets for this event (e.g., both SEA and LA options)
          return { markets: eventMarkets };
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


