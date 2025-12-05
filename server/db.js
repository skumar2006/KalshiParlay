/**
 * Database Module
 * Handles all Supabase database operations for the Kalshi Parlay Helper
 */

import { createClient } from '@supabase/supabase-js';
import { ENV } from '../config/env.js';
import { logError, logInfo, logWarn } from './utils/logger.js';

/**
 * Create a Supabase client with user's JWT token
 * This respects RLS policies - users can only access their own data
 * @param {string} userToken - JWT token from authenticated user
 * @returns {SupabaseClient} Supabase client configured with user's token
 */
function getSupabaseClient(userToken) {
  if (!userToken) {
    throw new Error('User token is required to create Supabase client');
  }
  
  return createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_ANON_KEY, // Use anon key, not service role
    {
      global: {
        headers: {
          Authorization: `Bearer ${userToken}`
        }
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

// Service role client only for initialization/health checks
// Should NOT be used for user operations - use getSupabaseClient(userToken) instead
let serviceRoleClient = null;
if (ENV.SUPABASE_SERVICE_ROLE_KEY) {
  serviceRoleClient = createClient(
    ENV.SUPABASE_URL,
    ENV.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

/**
 * Initialize database connection
 * Note: Tables should be created manually in Supabase dashboard
 * This function just verifies the connection
 * @throws {Error} If database connection fails
 */
export async function initializeDatabase() {
  try {
    logInfo('Verifying Supabase connection...');
    
    // Check if Supabase credentials are configured
    if (!ENV.SUPABASE_URL) {
      throw new Error('SUPABASE_URL is not set in environment variables');
    }
    
    if (!ENV.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in environment variables');
    }
    
    // Use service role client for health checks only
    const client = serviceRoleClient;
    if (!client) {
      throw new Error('Service role client not initialized. SUPABASE_SERVICE_ROLE_KEY is required for initialization.');
    }
    
    // Test connection by querying a simple table
    // If tables don't exist yet, this will fail gracefully
    const { error } = await client
      .from('users')
      .select('id')
      .limit(1);
    
    if (error && error.code !== 'PGRST116') { // PGRST116 = table doesn't exist
      logError('Supabase connection error', error);
      logError('Supabase URL:', ENV.SUPABASE_URL);
      logError('Error details:', JSON.stringify(error, null, 2));
      throw error;
    }
    
    logInfo('Supabase connection verified successfully');
    } catch (err) {
    logError('Error verifying Supabase connection', err);
    logError('Please verify:');
    logError('  - SUPABASE_URL is correct (should be https://your-project.supabase.co)');
    logError('  - SUPABASE_SERVICE_ROLE_KEY is set correctly');
    logError('  - Network connectivity to Supabase (check firewall/VPN)');
    throw err;
  }
}

/**
 * Get or create a user in the database
 * @param {string} userId - UUID from Supabase Auth
 * @param {string} userToken - JWT token from authenticated user
 * @returns {Promise<Object>} User object
 */
export async function getOrCreateUser(userId, userToken) {
  try {
    // userId should now be UUID from Supabase Auth
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);
    
    if (!isUUID) {
      throw new Error('Invalid user ID format. Expected UUID from Supabase Auth.');
    }
    
    if (!userToken) {
      throw new Error('User token is required');
    }
    
    const supabase = getSupabaseClient(userToken);
    
    // Check if user exists by UUID (id column)
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (existingUser) {
      return existingUser;
    }
    
    // User doesn't exist, create it
    // Note: RLS policy should allow users to insert their own record
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        id: userId, // UUID from auth.users
        user_id: userId // Keep for backward compatibility
      })
      .select()
      .single();
    
    if (insertError) {
      // If it's a unique constraint error, try to fetch again
      if (insertError.code === '23505') {
        const { data: user } = await supabase
          .from('users')
          .select('*')
          .eq('id', userId)
          .single();
        return user || { id: userId, user_id: userId };
      }
      logError('Error creating user', insertError);
      throw insertError;
    }
    
    return newUser || { id: userId, user_id: userId };
  } catch (err) {
    logError('Error in getOrCreateUser', err);
    throw err;
  }
}

/**
 * Get all parlay bets for a user (optionally filtered by environment)
 * @param {string} userId - User identifier
 * @param {string} environment - Optional environment filter ('demo' or 'production')
 * @param {string} userToken - JWT token from authenticated user
 * @returns {Promise<Array>} Array of parlay bet objects
 */
export async function getParlayBets(userId, environment = null, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    // Try to select with market_image_url first, fallback if column doesn't exist
    let selectFields = 'id, market_id, market_title, market_url, image_url, market_image_url, option_id, option_label, prob, ticker, side, environment, created_at';
    let query = supabase
      .from('parlay_bets')
      .select(selectFields)
      .eq('user_uuid', userId)
      .order('created_at', { ascending: true });
    
    if (environment) {
      query = query.eq('environment', environment);
    }
    
    let { data, error } = await query;
    
    // If error is about missing column, retry without it
    if (error && error.code === '42703' && error.message?.includes('market_image_url')) {
      logWarn('market_image_url column does not exist, selecting without it. Please run migration.');
      selectFields = 'id, market_id, market_title, market_url, image_url, option_id, option_label, prob, ticker, side, environment, created_at';
      query = supabase
        .from('parlay_bets')
        .select(selectFields)
        .eq('user_uuid', userId)
        .order('created_at', { ascending: true });
      
      if (environment) {
        query = query.eq('environment', environment);
      }
      
      const retryResult = await query;
      data = retryResult.data;
      error = retryResult.error;
    }
    
    if (error) {
      logError('Error fetching parlay bets', error);
      throw error;
    }
    
    return (data || []).map(row => ({
      id: row.id,
      marketId: row.market_id,
      marketTitle: row.market_title,
      marketUrl: row.market_url,
      imageUrl: row.image_url,
      marketImageUrl: row.market_image_url || null, // Will be null if column doesn't exist
      optionId: row.option_id,
      optionLabel: row.option_label,
      side: row.side || null,
      prob: parseFloat(row.prob || 0),
      ticker: row.ticker,
      environment: row.environment || 'production'
    }));
  } catch (err) {
    logError('Error in getParlayBets', err);
    throw err;
  }
}

/**
 * Add a bet to the user's parlay
 * @param {string} userId - User identifier
 * @param {Object} bet - Bet object with market and option details
 * @param {string} userToken - JWT token from authenticated user
 * @returns {Promise<Object>} Created bet object with database ID
 */
export async function addParlayBet(userId, bet, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    
    // Ensure user exists
    await getOrCreateUser(userId, userToken);
    
    // Validate environment - prevent mixing demo and production bets
    const environment = bet.environment || 'production';
    
    // Check if user has bets from different environment
    const existingBets = await getParlayBets(userId, null, userToken);
    if (existingBets.length > 0) {
      const existingEnv = existingBets[0].environment || 'production';
      if (existingEnv !== environment) {
        throw new Error(`Cannot mix bets from different environments. You have bets from ${existingEnv} environment.`);
      }
    }
    
    // Try to insert with market_image_url first, fallback if column doesn't exist
    let insertData = {
      user_uuid: userId,
      user_id: userId, // Keep for backward compatibility
      market_id: bet.marketId,
      market_title: bet.marketTitle,
      market_url: bet.marketUrl || null,
      image_url: bet.imageUrl || null,
      option_id: bet.optionId,
      option_label: bet.optionLabel,
      prob: bet.prob,
      ticker: bet.ticker || null,
      side: bet.side || null,
      environment: environment
    };
    
    // Try with market_image_url first
    if (bet.marketImageUrl) {
      insertData.market_image_url = bet.marketImageUrl;
    }
    
    let { data, error } = await supabase
      .from('parlay_bets')
      .insert(insertData)
      .select()
      .single();
    
    // If error is about missing column, retry without it
    if (error && error.code === '42703' && error.message?.includes('market_image_url')) {
      logWarn('market_image_url column does not exist, inserting without it. Please run migration.');
      delete insertData.market_image_url;
      const retryResult = await supabase
        .from('parlay_bets')
        .insert(insertData)
        .select()
        .single();
      data = retryResult.data;
      error = retryResult.error;
    }
    
    if (error) {
      logError('Error adding parlay bet', error);
      throw error;
    }
    
    return {
      id: data.id,
      marketId: data.market_id,
      marketTitle: data.market_title,
      marketUrl: data.market_url,
      imageUrl: data.image_url,
      marketImageUrl: data.market_image_url || null,
      optionId: data.option_id,
      optionLabel: data.option_label,
      prob: parseFloat(data.prob || 0),
      ticker: data.ticker,
      side: data.side || null,
      environment: data.environment || 'production'
    };
  } catch (err) {
    logError('Error in addParlayBet', err);
    throw err;
  }
}

/**
 * Remove a bet from the user's parlay
 * @param {string} userId - User identifier
 * @param {number} betId - Bet ID to remove
 * @param {string} userToken - JWT token from authenticated user
 * @returns {Promise<void>}
 */
export async function removeParlayBet(userId, betId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { error } = await supabase
      .from('parlay_bets')
      .delete()
      .eq('id', betId)
      .eq('user_uuid', userId);
    
    if (error) {
      logError('Error removing parlay bet', error);
      throw error;
    }
  } catch (err) {
    logError('Error in removeParlayBet', err);
    throw err;
  }
}

/**
 * Clear all parlay bets for a user
 * @param {string} userId - User identifier
 * @param {string} userToken - JWT token from authenticated user
 * @returns {Promise<void>}
 */
export async function clearParlayBets(userId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { error } = await supabase
      .from('parlay_bets')
      .delete()
      .eq('user_uuid', userId);
    
    if (error) {
      logError('Error clearing parlay bets', error);
      throw error;
    }
  } catch (err) {
    logError('Error in clearParlayBets', err);
    throw err;
  }
}

/**
 * Save pending payment to database
 * @param {string} sessionId - Stripe checkout session ID
 * @param {string} userId - User identifier
 * @param {number} stake - Stake amount
 * @param {Array|null} parlayData - Array of parlay bet objects (null for credit purchases)
 * @param {Object|null} quoteData - Quote data from AI service (null for credit purchases)
 * @param {string} paymentType - Payment type: 'parlay' or 'credits'
 * @returns {Promise<Object>} Saved payment record
 */
export async function savePendingPayment(sessionId, userId, stake, parlayData, quoteData, paymentType = 'parlay', userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    await getOrCreateUser(userId, userToken);
    
    const { data, error } = await supabase
      .from('pending_payments')
      .insert({
        session_id: sessionId,
        user_uuid: userId,
        user_id: userId, // Keep for backward compatibility
        stake: stake,
        parlay_data: parlayData ? parlayData : null,
        quote_data: quoteData ? quoteData : null,
        payment_type: paymentType
      })
      .select()
      .single();
    
    if (error) {
      logError('Error saving pending payment', error);
      throw error;
    }
    
    return data;
  } catch (err) {
    logError('Error in savePendingPayment', err);
    throw err;
  }
}

/**
 * Get pending payment by session ID
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<Object|null>} Payment record or null if not found
 */
export async function getPendingPayment(sessionId, userToken = null) {
  try {
    // For webhooks, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { data, error } = await supabase
      .from('pending_payments')
      .select('*')
      .eq('session_id', sessionId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
      return null;
      }
      logError('Error fetching pending payment', error);
      throw error;
    }
    
    return data;
  } catch (err) {
    logError('Error in getPendingPayment', err);
    throw err;
  }
}

/**
 * Update pending payment status
 * @param {string} sessionId - Stripe checkout session ID
 * @param {string} status - New status ('pending', 'completed', etc.)
 * @returns {Promise<void>}
 */
export async function updatePaymentStatus(sessionId, status, userToken = null) {
  try {
    // For webhooks, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { error } = await supabase
      .from('pending_payments')
      .update({
        status: status,
        updated_at: new Date().toISOString()
      })
      .eq('session_id', sessionId);
    
    if (error) {
      logError('Error updating payment status', error);
      throw error;
    }
  } catch (err) {
    logError('Error in updatePaymentStatus', err);
    throw err;
  }
}

/**
 * Save completed purchase to database
 * @param {string} sessionId - Stripe checkout session ID
 * @param {string} userId - User identifier
 * @param {number} stake - Stake amount
 * @param {number} payout - Payout amount
 * @param {Array} parlayData - Array of parlay bet objects
 * @param {Object} quoteData - Quote data from AI service
 * @param {Object|null} hedgingStrategy - Hedging strategy data
 * @param {number} stripeAmount - Amount charged by Stripe
 * @returns {Promise<Object>} Saved purchase record
 */
export async function saveCompletedPurchase(sessionId, userId, stake, payout, parlayData, quoteData, hedgingStrategy, stripeAmount, userToken = null) {
  try {
    // For webhooks, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { data, error } = await supabase
      .from('completed_purchases')
      .insert({
        session_id: sessionId,
        user_uuid: userId,
        user_id: userId, // Keep for backward compatibility
        stake: stake,
        payout: payout,
        parlay_data: parlayData,
        quote_data: quoteData,
        hedging_strategy: hedgingStrategy,
        stripe_amount: stripeAmount
      })
      .select()
      .single();
    
    if (error) {
      logError('Error saving completed purchase', error);
      throw error;
    }
    
    return data;
  } catch (err) {
    logError('Error in saveCompletedPurchase', err);
    throw err;
  }
}

/**
 * Get completed purchase by session ID
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<Object|null>} Purchase record or null if not found
 */
export async function getCompletedPurchase(sessionId, userToken = null) {
  try {
    // For webhooks, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { data, error } = await supabase
      .from('completed_purchases')
      .select('*')
      .eq('session_id', sessionId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') { // No rows returned
        return null;
      }
      logError('Error fetching completed purchase', error);
      throw error;
    }
    
    return data;
  } catch (err) {
    logError('Error in getCompletedPurchase', err);
    throw err;
  }
}

/**
 * Mark hedge as executed for a completed purchase
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<void>}
 */
export async function markHedgeExecuted(sessionId, userToken = null) {
  try {
    // For webhooks, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { error } = await supabase
      .from('completed_purchases')
      .update({ hedge_executed: true })
      .eq('session_id', sessionId);
    
    if (error) {
      logError('Error marking hedge as executed', error);
      throw error;
    }
  } catch (err) {
    logError('Error in markHedgeExecuted', err);
    throw err;
  }
}

/**
 * Get all completed purchases for a user
 * @param {string} userId - User identifier
 * @returns {Promise<Array>} Array of completed purchase records
 */
export async function getUserPurchaseHistory(userId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { data, error } = await supabase
      .from('completed_purchases')
      .select('id, session_id, stake, payout, parlay_data, completed_at, hedge_executed, parlay_status, claimable_amount, claimed_at')
      .eq('user_uuid', userId)
      .order('completed_at', { ascending: false });
    
    if (error) {
      logError('Error fetching user purchase history', error);
      throw error;
    }
    
    return data || [];
  } catch (err) {
    logError('Error in getUserPurchaseHistory', err);
    throw err;
  }
}

/**
 * Update outcome for a specific leg of a parlay
 */
export async function updateParlayBetOutcome(purchaseId, legNumber, ticker, optionId, marketStatus, outcome, settlementPrice, userToken = null) {
  try {
    // For background jobs, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const updateData = {
      purchase_id: purchaseId,
      leg_number: legNumber,
      ticker: ticker,
      option_id: optionId,
      market_status: marketStatus,
      outcome: outcome,
      settlement_price: settlementPrice,
      checked_at: new Date().toISOString()
    };
    
    if (marketStatus === 'settled') {
      updateData.settled_at = new Date().toISOString();
    }
    
    const { error } = await supabase
      .from('parlay_bet_outcomes')
      .upsert(updateData, {
        onConflict: 'purchase_id,leg_number',
        ignoreDuplicates: false
      });
    
    if (error) {
      logError('Error updating parlay bet outcome', error);
      throw error;
    }
  } catch (err) {
    logError('Error in updateParlayBetOutcome', err);
    throw err;
  }
}

/**
 * Update overall parlay status
 */
export async function updateParlayStatus(sessionId, status, claimableAmount, userToken = null) {
  try {
    // For background jobs, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { error } = await supabase
      .from('completed_purchases')
      .update({
        parlay_status: status,
        claimable_amount: claimableAmount,
        last_status_check: new Date().toISOString()
      })
      .eq('session_id', sessionId);
    
    if (error) {
      logError('Error updating parlay status', error);
      throw error;
    }
  } catch (err) {
    logError('Error in updateParlayStatus', err);
    throw err;
  }
}

/**
 * Get active parlays (not fully settled)
 * Note: This is a background job function, uses service role
 */
export async function getActiveParlays() {
  try {
    if (!serviceRoleClient) {
      throw new Error('Service role client is required for getActiveParlays');
    }
    const { data, error } = await serviceRoleClient
      .from('completed_purchases')
      .select('*')
      .in('parlay_status', ['pending', 'won'])
      .order('completed_at', { ascending: false });
    
    if (error) {
      logError('Error fetching active parlays', error);
      throw error;
    }
    
    return data || [];
  } catch (err) {
    logError('Error in getActiveParlays', err);
    throw err;
  }
}

/**
 * Mark parlay as claimed
 */
export async function claimParlayWinnings(sessionId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { error } = await supabase
      .from('completed_purchases')
      .update({ claimed_at: new Date().toISOString() })
      .eq('session_id', sessionId)
      .eq('parlay_status', 'won')
      .is('claimed_at', null);
    
    if (error) {
      logError('Error claiming parlay winnings', error);
      throw error;
    }
  } catch (err) {
    logError('Error in claimParlayWinnings', err);
    throw err;
  }
}

/**
 * Get leg outcomes for a parlay
 */
export async function getParlayBetOutcomes(purchaseId, userToken = null) {
  try {
    // For background jobs, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const { data, error } = await supabase
      .from('parlay_bet_outcomes')
      .select('*')
      .eq('purchase_id', purchaseId)
      .order('leg_number', { ascending: true });
    
    if (error) {
      logError('Error fetching parlay bet outcomes', error);
      throw error;
    }
    
    return data || [];
  } catch (err) {
    logError('Error in getParlayBetOutcomes', err);
    throw err;
  }
}

/**
 * Get or create user wallet
 */
export async function getUserWallet(userId, userToken = null) {
  try {
    // For webhooks/payment redirects, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    
    // Try to get existing wallet
    const { data: existingWallet, error: selectError } = await supabase
      .from('user_wallet')
      .select('*')
      .eq('user_uuid', userId)
      .single();
    
    if (existingWallet) {
      return existingWallet;
    }
    
    // Create wallet if it doesn't exist
    // Note: If using service role, RLS policies are bypassed
    // If using user token, RLS policy must allow INSERT
    const { data: newWallet, error: insertError } = await supabase
      .from('user_wallet')
      .insert({
        user_uuid: userId,
        user_id: userId, // Keep for backward compatibility
        balance: 0
      })
      .select()
      .single();
    
    if (insertError) {
      // If it's a unique constraint error, try to fetch again
      if (insertError.code === '23505') {
        const { data: wallet } = await supabase
          .from('user_wallet')
          .select('*')
          .eq('user_uuid', userId)
          .single();
        return wallet || { user_uuid: userId, user_id: userId, balance: 0 };
      }
      logError('Error creating user wallet', insertError);
      throw insertError;
    }
    
    return newWallet || { user_uuid: userId, user_id: userId, balance: 0 };
  } catch (err) {
    logError('Error in getUserWallet', err);
    throw err;
  }
}

/**
 * Add balance to user wallet
 */
export async function addUserBalance(userId, amount, userToken = null) {
  try {
    // For webhooks/payment redirects, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    
    // First ensure wallet exists
    await getUserWallet(userId, userToken);
    
    // Use RPC function or raw SQL for atomic update
    // Since Supabase doesn't have a direct way to do UPDATE ... SET balance = balance + amount
    // We'll fetch, update, and save
    const { data: wallet, error: fetchError } = await supabase
      .from('user_wallet')
      .select('balance')
      .eq('user_uuid', userId)
      .single();
    
    if (fetchError) {
      logError('Error fetching wallet for balance update', fetchError);
      throw fetchError;
    }
    
    const newBalance = parseFloat(wallet.balance || 0) + parseFloat(amount);
    
    const { error: updateError } = await supabase
      .from('user_wallet')
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString()
      })
      .eq('user_uuid', userId);
    
    if (updateError) {
      logError('Error updating user balance', updateError);
      throw updateError;
    }
  } catch (err) {
    logError('Error in addUserBalance', err);
    throw err;
  }
}

/**
 * Get platform liquidity pool balance
 * Note: This is an admin function, uses service role
 */
export async function getLiquidityPoolBalance() {
  try {
    if (!serviceRoleClient) {
      throw new Error('Service role client is required for getLiquidityPoolBalance');
    }
    const { data, error } = await serviceRoleClient
      .from('platform_liquidity_pool')
      .select('balance')
      .eq('id', 1)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
      // Initialize if doesn't exist
        const { data: newPool, error: insertError } = await serviceRoleClient
          .from('platform_liquidity_pool')
          .insert({
            id: 1,
            balance: 0.00
          })
          .select()
          .single();
        
        if (insertError) {
          logError('Error initializing liquidity pool', insertError);
          throw insertError;
        }
        
      return { balance: 0 };
      }
      logError('Error fetching liquidity pool balance', error);
      throw error;
    }
    
    return data || { balance: 0 };
  } catch (err) {
    logError('Error in getLiquidityPoolBalance', err);
    throw err;
  }
}

/**
 * Update platform liquidity pool balance
 * @param {number} amount - Amount to add (positive) or subtract (negative)
 * Note: This is an admin function, uses service role
 */
export async function updateLiquidityPoolBalance(amount) {
  try {
    if (!serviceRoleClient) {
      throw new Error('Service role client is required for updateLiquidityPoolBalance');
    }
    // Fetch current balance
    const { data: pool, error: fetchError } = await serviceRoleClient
      .from('platform_liquidity_pool')
      .select('balance')
      .eq('id', 1)
      .single();
    
    if (fetchError && fetchError.code !== 'PGRST116') {
      logError('Error fetching liquidity pool for update', fetchError);
      throw fetchError;
    }
    
    const currentBalance = pool ? parseFloat(pool.balance || 0) : 0;
    const newBalance = currentBalance + parseFloat(amount);
    
    const { error: upsertError } = await serviceRoleClient
      .from('platform_liquidity_pool')
      .upsert({
        id: 1,
        balance: newBalance,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'id'
      });
    
    if (upsertError) {
      logError('Error updating liquidity pool balance', upsertError);
      throw upsertError;
    }
  } catch (err) {
    logError('Error in updateLiquidityPoolBalance', err);
    throw err;
  }
}

/**
 * Create withdrawal request
 */
export async function createWithdrawalRequest(userId, amount, paymentMethod, stripePayoutId = null, stripeTransferId = null, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .insert({
        user_uuid: userId,
        user_id: userId, // Keep for backward compatibility
        amount: amount,
        payment_method: paymentMethod,
        stripe_payout_id: stripePayoutId,
        stripe_transfer_id: stripeTransferId,
        status: 'pending'
      })
      .select()
      .single();
    
    if (error) {
      logError('Error creating withdrawal request', error);
      throw error;
    }
    
    return data;
  } catch (err) {
    logError('Error in createWithdrawalRequest', err);
    throw err;
  }
}

/**
 * Update withdrawal request status
 */
export async function updateWithdrawalStatus(withdrawalId, status, stripePayoutId = null, userToken = null) {
  try {
    // For admin operations, we might not have userToken - use service role in that case
    const supabase = userToken ? getSupabaseClient(userToken) : serviceRoleClient;
    if (!supabase) {
      throw new Error('Either user token or service role key is required');
    }
    const updateData = {
      status: status
    };
    
    if (stripePayoutId) {
      updateData.stripe_payout_id = stripePayoutId;
    }
    
    if (status === 'completed') {
      updateData.completed_at = new Date().toISOString();
    }
    
    const { error } = await supabase
      .from('withdrawal_requests')
      .update(updateData)
      .eq('id', withdrawalId);
    
    if (error) {
      logError('Error updating withdrawal status', error);
      throw error;
    }
  } catch (err) {
    logError('Error in updateWithdrawalStatus', err);
    throw err;
  }
}

/**
 * Get withdrawal requests for a user
 */
export async function getWithdrawalRequests(userId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('user_uuid', userId)
      .order('created_at', { ascending: false });
    
    if (error) {
      logError('Error fetching withdrawal requests', error);
      throw error;
    }
    
    return data || [];
  } catch (err) {
    logError('Error in getWithdrawalRequests', err);
    throw err;
  }
}

/**
 * Save Stripe Connect account ID for user
 */
export async function saveStripeAccount(userId, stripeAccountId, status = 'pending', userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { error } = await supabase
      .from('users')
      .update({
        stripe_account_id: stripeAccountId,
        stripe_account_status: status
      })
      .eq('id', userId);
    
    if (error) {
      logError('Error saving Stripe account', error);
      throw error;
    }
  } catch (err) {
    logError('Error in saveStripeAccount', err);
    throw err;
  }
}

/**
 * Get user's Stripe Connect account
 */
export async function getUserStripeAccount(userId, userToken) {
  try {
    if (!userToken) {
      throw new Error('User token is required');
    }
    const supabase = getSupabaseClient(userToken);
    const { data, error } = await supabase
      .from('users')
      .select('stripe_account_id, stripe_account_status')
      .eq('id', userId)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      logError('Error fetching Stripe account', error);
      throw error;
    }
    
    return data || null;
  } catch (err) {
    logError('Error in getUserStripeAccount', err);
    throw err;
  }
}

// Export service role client for direct access if needed (admin operations only)
export default serviceRoleClient;
