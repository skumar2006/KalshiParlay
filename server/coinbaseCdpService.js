/**
 * Coinbase CDP Service
 * Handles wallet creation and balance fetching via Coinbase Developer Platform
 */

import { CdpClient } from '@coinbase/cdp-sdk';
import { ENV } from '../config/env.js';
import { logError, logInfo, logWarn } from './utils/logger.js';
import { 
  PublicKey, 
  Transaction, 
  Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Buffer } from "buffer";

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
      const networkConfig = getSolanaNetworkConfig();
      console.log(`[Coinbase CDP] 🔍 Fetching balance from ${networkConfig.network}`);
      console.log(`[Coinbase CDP] RPC URL: ${networkConfig.rpcUrl}`);
      console.log(`[Coinbase CDP] USDC Mint: ${networkConfig.usdcMint}`);
      console.log(`[Coinbase CDP] Wallet Address: ${cryptoWalletAddress}`);
      
      const connection = new Connection(networkConfig.rpcUrl);
      const publicKey = new PublicKey(cryptoWalletAddress);
      
      // First, check if wallet has SOL (to verify connection works)
      try {
        const solBalance = await connection.getBalance(publicKey);
        console.log(`[Coinbase CDP] ✅ SOL balance: ${solBalance / 1e9} SOL`);
      } catch (solError) {
        console.error(`[Coinbase CDP] ❌ Error fetching SOL balance:`, solError.message);
      }
      
      // Get USDC SPL token balance
      console.log(`[Coinbase CDP] 🔍 Fetching USDC token accounts...`);
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey(networkConfig.usdcMint),
      });

      console.log(`[Coinbase CDP] Found ${tokenAccounts.value.length} USDC token account(s)`);

      if (tokenAccounts.value.length > 0) {
        tokenAccounts.value.forEach((account, index) => {
          const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
          console.log(`[Coinbase CDP] Token account ${index + 1}: ${amount} USDC`);
        });
        
        const usdcAccount = tokenAccounts.value[0];
        const amount = usdcAccount.account.data.parsed.info.tokenAmount.uiAmount;
        balance = amount || 0;
        console.log(`[Coinbase CDP] ✅ USDC balance: ${balance} USDC`);
      } else {
        console.log(`[Coinbase CDP] ⚠️ No USDC token account found - wallet may need to receive USDC first to create token account`);
        balance = 0;
      }
    } catch (balanceError) {
      console.error(`[Coinbase CDP] ===== BALANCE FETCH ERROR =====`);
      console.error(`[Coinbase CDP] Error message:`, balanceError.message);
      console.error(`[Coinbase CDP] Error stack:`, balanceError.stack);
      logError('[Coinbase CDP] Error fetching balance from Solana', {
        error: balanceError.message,
        stack: balanceError.stack,
        network: networkConfig?.network,
        address: cryptoWalletAddress,
        errorType: balanceError.constructor?.name
      });
      // Use database balance as fallback
      balance = wallet?.balance || 0;
      console.log(`[Coinbase CDP] Using database fallback balance: ${balance}`);
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

// Platform wallet account name (constant)
const PLATFORM_WALLET_NAME = 'platform-main-wallet';

// Solana network configuration
function getSolanaNetworkConfig() {
  const isProduction = ENV.IS_PRODUCTION;
  
  const config = {
    rpcUrl: isProduction 
      ? 'https://api.mainnet-beta.solana.com' 
      : 'https://api.devnet.solana.com',
    network: isProduction ? 'solana-mainnet' : 'solana-devnet',
    usdcMint: isProduction
      ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // Mainnet USDC
      : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' // Devnet USDC
  };
  
  // Log network configuration on first call (for debugging)
  if (!getSolanaNetworkConfig._logged) {
    logInfo(`[Solana Network] Using ${config.network} - RPC: ${config.rpcUrl}, USDC Mint: ${config.usdcMint}`);
    getSolanaNetworkConfig._logged = true;
  }
  
  return config;
}

/**
 * Get or create platform CDP wallet
 * @returns {Promise<{address: string, accountName: string}>} Platform wallet address
 */
export async function getOrCreatePlatformWallet() {
  const cdp = getCdpClient();
  if (!cdp) {
    throw new Error('Coinbase CDP is not configured');
  }

  try {
    let account;
    try {
      account = await cdp.solana.createAccount({
        name: PLATFORM_WALLET_NAME,
      });
      logInfo(`[Platform Wallet] Created new platform wallet: ${account.address}`);
    } catch (createError) {
      if (createError.statusCode === 409 || createError.errorType === 'already_exists') {
        account = await cdp.solana.getAccount({
          name: PLATFORM_WALLET_NAME,
        });
        logInfo(`[Platform Wallet] Retrieved existing platform wallet: ${account.address}`);
      } else {
        throw createError;
      }
    }
    
    return { 
      address: account.address,
      accountName: PLATFORM_WALLET_NAME
    };
  } catch (err) {
    logError('[Platform Wallet] Error getting/creating platform wallet', err);
    throw err;
  }
}

/**
 * Build and encode USDC transfer transaction (following CDP pattern)
 * @param {string} fromAddress - Sender's Solana address
 * @param {string} toAddress - Recipient's Solana address  
 * @param {number} amountUsd - Amount in USD
 * @returns {Promise<string>} Base64-encoded transaction
 */
export async function createAndEncodeUsdcTransaction(fromAddress, toAddress, amountUsd) {
  const networkConfig = getSolanaNetworkConfig();
  const connection = new Connection(networkConfig.rpcUrl);
  const usdcMint = new PublicKey(networkConfig.usdcMint);
  
  // Convert USD to USDC (6 decimals)
  const amountUsdc = Math.floor(amountUsd * 1000000);
  
  const fromPubkey = new PublicKey(fromAddress);
  const toPubkey = new PublicKey(toAddress);
  
  // Get associated token accounts for USDC
  const fromTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    fromPubkey
  );
  
  const toTokenAccount = await getAssociatedTokenAddress(
    usdcMint,
    toPubkey
  );
  
  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  
  // Create transaction with USDC transfer instruction
  const transaction = new Transaction().add(
    createTransferInstruction(
      fromTokenAccount, // source
      toTokenAccount,   // destination
      fromPubkey,       // owner
      amountUsdc,       // amount in smallest unit (6 decimals for USDC)
      [],               // multiSigners
      TOKEN_PROGRAM_ID
    )
  );
  
  // Set required fields (following CDP pattern)
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = fromPubkey;
  
  // Serialize and encode to base64
  const serialized = transaction.serialize({
    requireAllSignatures: false,
  });
  
  return Buffer.from(serialized).toString('base64');
}

/**
 * Transfer USDC from platform wallet to user's CDP wallet (server-side)
 * Uses CDP SDK to sign and send transaction
 * @param {string} userId - User UUID
 * @param {number} amountUsd - Amount in USD
 * @returns {Promise<{transactionSignature: string, success: boolean}>}
 */
export async function transferUsdcFromPlatform(userId, amountUsd) {
  const cdp = getCdpClient();
  if (!cdp) {
    throw new Error('Coinbase CDP is not configured');
  }

  try {
    // Get user wallet
    const userWallet = await getOrCreateUserWallet(userId);
    
    // Get platform wallet
    const platformWallet = await getOrCreatePlatformWallet();
    
    const networkConfig = getSolanaNetworkConfig();
    logInfo(`[Transfer] Transferring ${amountUsd} USD from platform wallet to user ${userId} on ${networkConfig.network}`);
    
    // Build the transaction (following CDP pattern)
    const transaction = await createAndEncodeUsdcTransaction(
      platformWallet.address,
      userWallet.address,
      amountUsd
    );
    
    // Send transaction using CDP SDK (server-side equivalent of useSendSolanaTransaction)
    const result = await cdp.solana.sendTransaction({
      transaction,
      solanaAccount: platformWallet.accountName, // Use account name, not address
      network: networkConfig.network,
    });
    
    logInfo(`[Transfer] Transfer successful on ${networkConfig.network}: ${result.transactionSignature}`);
    
    return {
      transactionSignature: result.transactionSignature,
      success: true
    };
  } catch (err) {
    logError('[Transfer] Error transferring USDC from platform', err);
    throw err;
  }
}

/**
 * Get transaction for user to sign (for parlay placement)
 * Returns the base64 transaction that frontend will sign via CDP hooks
 * @param {string} userId - User UUID
 * @param {number} amountUsd - Amount in USD
 * @returns {Promise<{transaction: string, fromAddress: string, toAddress: string, amountUsd: number}>}
 */
export async function getUsdcTransferTransactionForUser(userId, amountUsd) {
  try {
    // Get user wallet
    const userWallet = await getOrCreateUserWallet(userId);
    
    // Get platform wallet
    const platformWallet = await getOrCreatePlatformWallet();
    
    // Build the transaction (following CDP pattern)
    const transaction = await createAndEncodeUsdcTransaction(
      userWallet.address,
      platformWallet.address,
      amountUsd
    );
    
    return {
      transaction: transaction,
      fromAddress: userWallet.address,
      toAddress: platformWallet.address,
      amountUsd: amountUsd
    };
  } catch (err) {
    logError('[Transfer] Error building transfer transaction for user', err);
    throw err;
  }
}

// We'll import getSupabaseClient dynamically to avoid circular dependency
