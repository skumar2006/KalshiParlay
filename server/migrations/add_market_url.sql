-- Migration: Add market_url column to parlay_bets table
-- Run this if you have an existing database

-- Add the market_url column (if it doesn't exist)
ALTER TABLE parlay_bets 
ADD COLUMN IF NOT EXISTS market_url TEXT;

-- Add a comment to the column
COMMENT ON COLUMN parlay_bets.market_url IS 'Full URL to the market page on Kalshi';


