-- Migration: Add RLS policy to allow users to insert their own wallet
-- This fixes the "new row violates row-level security policy" error

-- Allow users to insert their own wallet
CREATE POLICY "Users can insert own wallet"
ON user_wallet
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_uuid);

-- Note: If the policy already exists, you may need to drop it first:
-- DROP POLICY IF EXISTS "Users can insert own wallet" ON user_wallet;


