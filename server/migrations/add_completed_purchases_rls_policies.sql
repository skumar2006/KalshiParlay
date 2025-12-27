-- Migration: Add RLS policies for completed_purchases table
-- This fixes the "new row violates row-level security policy" error when placing parlays

-- Drop existing policies if they exist (to allow re-running this migration)
DROP POLICY IF EXISTS "Users can insert own completed purchases" ON completed_purchases;
DROP POLICY IF EXISTS "Users can view own completed purchases" ON completed_purchases;

-- Allow users to INSERT their own completed purchases
CREATE POLICY "Users can insert own completed purchases"
ON completed_purchases
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_uuid);

-- Allow users to SELECT their own completed purchases
CREATE POLICY "Users can view own completed purchases"
ON completed_purchases
FOR SELECT
TO authenticated
USING (auth.uid() = user_uuid);




