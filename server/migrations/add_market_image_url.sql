-- Add market_image_url column to parlay_bets table
-- This stores the market-level image URL as a fallback when option-specific images are not available

ALTER TABLE parlay_bets
ADD COLUMN IF NOT EXISTS market_image_url TEXT;

-- Add comment to document the column
COMMENT ON COLUMN parlay_bets.market_image_url IS 'Market-level image URL used as fallback when option-specific image is not available or fails to load';

