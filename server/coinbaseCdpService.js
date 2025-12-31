/**
 * Coinbase CDP Service
 * Handles wallet creation and balance fetching via Coinbase Developer Platform
 */

import { CdpClient } from '@coinbase/cdp-sdk';
import { ENV } from '../config/env.js';
import { logError, logInfo, logWarn } from './utils/logger.js';

let serviceRoleClient = null;

// Lazy initialization of CDP client
let cdpClient = null;

/**
 * Initialize CDP client if credentials are available
 */
function getCdpClient() {
  if (cdpClient) {
    return cdpClient;
  }

  // Check if CDP credentials are configured
  const apiKeyId = ENV.COINBASE_CDP_API_KEY_ID || process.env.CDP_API_KEY_ID;
  const apiKeySecret = ENV.COINBASE_CDP_API_KEY_SECRET || process.env.CDP_API_KEY_SECRET;
  const walletSecret = ENV.COINBASE_CDP_WALLET_SECRET || process.env.CDP_WALLET_SECRET;

  if (!apiKeyId || !apiKeySecret || !walletSecret) {
    logWarn('[Coinbase CDP] CDP credentials not configured. Wallet creation will be skipped.', {
      hasApiKeyId: !!apiKeyId,
      hasApiKeySecret: !!apiKeySecret,
      hasWalletSecret: !!walletSecret,
      envVars: {
        COINBASE_CDP_API_KEY_ID: !!ENV.COINBASE_CDP_API_KEY_ID,
        COINBASE_CDP_API_KEY_SECRET: !!ENV.COINBASE_CDP_API_KEY_SECRET,
        COINBASE_CDP_WALLET_SECRET: !!ENV.COINBASE_CDP_WALLET_SECRET,
        CDP_API_KEY_ID: !!process.env.CDP_API_KEY_ID,
        CDP_API_KEY_SECRET: !!process.env.CDP_API_KEY_SECRET,
        CDP_WALLET_SECRET: !!process.env.CDP_WALLET_SECRET
      }
    });
    return null;
  }

  try {
    logInfo('[Coinbase CDP] Initializing CDP client...');
    cdpClient = new CdpClient({
      apiKeyId,
      apiKeySecret,
      walletSecret,
    });
    logInfo('[Coinbase CDP] CDP client initialized successfully');
    return cdpClient;
  } catch (err) {
    logError('[Coinbase CDP] Failed to initialize CDP client', {
      error: err.message,
      stack: err.stack,
      errorType: err.constructor?.name
    });
    return null;
  }
}

/**
 * Get or create a Solana wallet for a user
 * @param {string} userId - User UUID
 * @returns {Promise<{address: string}>} Wallet address
 */
export async function getOrCreateUserWallet(userId) {
  logInfo(`[Coinbase CDP] getOrCreateUserWallet called for user ${userId}`);
  
  const cdp = getCdpClient();
  if (!cdp) {
    const error = new Error('Coinbase CDP is not configured. Please set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET environment variables.');
    logError('[Coinbase CDP] CDP client not available', {
      userId,
      hasApiKeyId: !!ENV.COINBASE_CDP_API_KEY_ID,
      hasApiKeySecret: !!ENV.COINBASE_CDP_API_KEY_SECRET,
      hasWalletSecret: !!ENV.COINBASE_CDP_WALLET_SECRET
    });
    throw error;
  }

  try {
    // Use userId as account name (must be alphanumeric with hyphens, 2-36 chars)
    // UUIDs are 36 chars, so we can use it directly
    const accountName = userId.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 36);
    
    logInfo(`[Coinbase CDP] Getting or creating Solana wallet for user ${userId} (account name: ${accountName})`);
    
    let account;
    
    // Try to create the account first
    try {
      console.log(`[Coinbase CDP] Attempting to create account with name: ${accountName}`);
      account = await cdp.solana.createAccount({
        name: accountName,
      });
      console.log(`[Coinbase CDP] ✅ Successfully created new wallet: ${account.address}`);
      logInfo(`[Coinbase CDP] Successfully created new wallet`);
    } catch (createError) {
      // If account already exists (409), fetch it instead
      if (createError.statusCode === 409 || createError.errorType === 'already_exists') {
        console.log(`[Coinbase CDP] Account already exists (409), fetching existing account...`);
        logInfo(`[Coinbase CDP] Account with name ${accountName} already exists, fetching...`);
        account = await cdp.solana.getAccount({
          name: accountName,
        });
        console.log(`[Coinbase CDP] ✅ Successfully retrieved existing wallet: ${account.address}`);
        logInfo(`[Coinbase CDP] Successfully retrieved existing wallet`);
      } else {
        // Re-throw if it's a different error
        console.error(`[Coinbase CDP] Unexpected error creating account:`, createError);
        throw createError;
      }
    }

    if (!account || !account.address) {
      throw new Error('CDP account operation returned invalid response - no address');
    }

    logInfo(`[Coinbase CDP] Successfully created/retrieved wallet`, {
      address: account.address,
      userId,
      accountName
    });
    
    return {
      address: account.address,
    };
  } catch (err) {
    logError('[Coinbase CDP] Error getting or creating wallet', {
      error: err.message,
      stack: err.stack,
      userId,
      errorType: err.constructor?.name,
      errorCode: err.code,
      statusCode: err.statusCode,
      errorDetails: err.details || err.body
    });
    throw err;
  }
}

/**
 * Get wallet address and balance for a user
 * @param {string} userId - User UUID
 * @param {string} userToken - Optional user token for database access
 * @returns {Promise<{crypto_wallet_address: string, balance: number}>}
 */
export async function getUserWalletWithBalance(userId, userToken = null) {
  console.log(`[Coinbase CDP] ===== getUserWalletWithBalance START ===== User: ${userId}, Has Token: ${!!userToken}`);
  
  // Dynamically import to avoid circular dependency
  const { createClient } = await import('@supabase/supabase-js');
  const { ENV } = await import('../config/env.js');
  
  let supabase;
  if (userToken) {
    supabase = createClient(
      ENV.SUPABASE_URL,
      ENV.SUPABASE_ANON_KEY,
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
  } else {
    // Use service role client
    if (!serviceRoleClient) {
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
    supabase = serviceRoleClient;
  }
  if (!supabase) {
    throw new Error('Either user token or service role key is required');
  }

  try {
    console.log(`[Coinbase CDP] Getting wallet from database for user ${userId}...`);
    logInfo(`[Coinbase CDP] Getting wallet from database for user ${userId}...`);
    
    // Get wallet from database
    console.log(`[Coinbase CDP] Querying user_wallet table...`);
    const { data: wallet, error } = await supabase
      .from('user_wallet')
      .select('*')
      .eq('user_uuid', userId)
      .single();

    console.log(`[Coinbase CDP] Database query result:`, {
      walletExists: !!wallet,
      hasAddress: !!wallet?.crypto_wallet_address,
      address: wallet?.crypto_wallet_address,
      error: error ? { message: error.message, code: error.code } : null,
      walletKeys: wallet ? Object.keys(wallet) : null
    });

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error(`[Coinbase CDP] ===== DATABASE ERROR =====`, error);
      logError('[Coinbase CDP] Error querying wallet from database', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
        userId
      });
      throw error;
    }

    logInfo(`[Coinbase CDP] Database query result:`, {
      walletExists: !!wallet,
      hasAddress: !!wallet?.crypto_wallet_address,
      address: wallet?.crypto_wallet_address
    });

    let cryptoWalletAddress = wallet?.crypto_wallet_address;

    // If no wallet address exists, create one via Coinbase CDP
    if (!cryptoWalletAddress) {
      logInfo(`[Coinbase CDP] No wallet address found for user ${userId}, creating via CDP...`);
      try {
        const cdpWallet = await getOrCreateUserWallet(userId);
        
        if (!cdpWallet || !cdpWallet.address) {
          throw new Error('CDP wallet creation returned invalid data');
        }
        
        cryptoWalletAddress = cdpWallet.address;
        logInfo(`[Coinbase CDP] Successfully created wallet via CDP: ${cryptoWalletAddress}`);

        // Update database with wallet address
        logInfo(`[Coinbase CDP] Updating database with wallet address...`);
        console.log(`[Coinbase CDP] Updating database with wallet address...`);
        
        let updateError = null;
        let updatedWallet = null;
        
        if (wallet) {
          // Wallet exists, update it
          console.log(`[Coinbase CDP] Wallet exists, updating...`);
          const { error: updateErr, data: updatedData } = await supabase
            .from('user_wallet')
            .update({
              crypto_wallet_address: cryptoWalletAddress,
              crypto_network: 'solana',
            })
            .eq('user_uuid', userId)
            .select();
          
          updateError = updateErr;
          updatedWallet = updatedData;
        } else {
          // Wallet doesn't exist, insert it
          console.log(`[Coinbase CDP] Wallet doesn't exist, inserting...`);
          const { error: insertErr, data: insertedData } = await supabase
            .from('user_wallet')
            .insert({
              user_uuid: userId,
              user_id: userId,
              crypto_wallet_address: cryptoWalletAddress,
              crypto_network: 'solana',
              balance: 0,
            })
            .select();
          
          updateError = insertErr;
          updatedWallet = insertedData;
        }

        console.log(`[Coinbase CDP] Database update result:`, {
          error: updateError ? { message: updateError.message, code: updateError.code } : null,
          updatedData: updatedWallet
        });

        if (updateError) {
          console.error(`[Coinbase CDP] ===== DATABASE UPDATE ERROR =====`, updateError);
          logError('[Coinbase CDP] Error updating wallet address in database', {
            error: updateError.message,
            code: updateError.code,
            details: updateError.details,
            hint: updateError.hint,
            userId,
            address: cryptoWalletAddress
          });
          throw updateError;
        }
        
        console.log(`[Coinbase CDP] ✅ Successfully updated database with wallet address`);
        logInfo(`[Coinbase CDP] Successfully updated database with wallet address`, {
          userId,
          address: cryptoWalletAddress,
          updatedData: updatedWallet
        });
      } catch (cdpError) {
        logError('[Coinbase CDP] Failed to create wallet via CDP', {
          error: cdpError.message,
          stack: cdpError.stack,
          userId
        });
        throw cdpError;
      }
    } else {
      logInfo(`[Coinbase CDP] Wallet address already exists: ${cryptoWalletAddress}`);
    }

    // Fetch balance from Solana blockchain
    let balance = 0;
    try {
      const { Connection, PublicKey } = await import('@solana/web3.js');
      const connection = new Connection('https://api.mainnet-beta.solana.com');
      const publicKey = new PublicKey(cryptoWalletAddress);
      
      // Get USDC SPL token balance
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC mint
      });

      if (tokenAccounts.value.length > 0) {
        const usdcAccount = tokenAccounts.value[0];
        const amount = usdcAccount.account.data.parsed.info.tokenAmount.uiAmount;
        balance = amount || 0;
      }
    } catch (balanceError) {
      logWarn('[Coinbase CDP] Error fetching balance from Solana', balanceError);
      // Use database balance as fallback
      balance = wallet?.balance || 0;
    }

    console.log(`[Coinbase CDP] ===== getUserWalletWithBalance SUCCESS =====`, {
      address: cryptoWalletAddress,
      balance
    });
    
    return {
      crypto_wallet_address: cryptoWalletAddress,
      balance,
    };
  } catch (err) {
    console.error(`[Coinbase CDP] ===== getUserWalletWithBalance ERROR =====`, err);
    console.error(`[Coinbase CDP] Error message:`, err.message);
    console.error(`[Coinbase CDP] Error stack:`, err.stack);
    logError('[Coinbase CDP] Error in getUserWalletWithBalance', err);
    throw err;
  }
}

// We'll import getSupabaseClient dynamically to avoid circular dependency
