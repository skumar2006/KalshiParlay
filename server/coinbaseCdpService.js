/**
 * Coinbase CDP Service
 * Manages embedded wallets using Coinbase CDP Core SDK
 */

import { CdpClient } from '@coinbase/cdp-sdk';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';
import { ENV } from '../config/env.js';
import { logError, logInfo, logWarn } from './utils/logger.js';
import { serviceRoleClient } from './db.js';

// Initialize CDP client
let cdp = null;
// Note: walletSecret is REQUIRED for server-side wallet operations (creating custodial wallets)
if (ENV.COINBASE_CDP_API_KEY_ID && ENV.COINBASE_CDP_API_KEY_SECRET && ENV.COINBASE_CDP_WALLET_SECRET) {
  try {
    cdp = new CdpClient({
      apiKeyId: ENV.COINBASE_CDP_API_KEY_ID,
      apiKeySecret: ENV.COINBASE_CDP_API_KEY_SECRET,
      walletSecret: ENV.COINBASE_CDP_WALLET_SECRET, // REQUIRED for server-side wallet operations
    });
    logInfo('[CDP] Coinbase CDP client initialized successfully');
  } catch (err) {
    logError('[CDP] Failed to initialize Coinbase CDP client', err);
  }
} else {
  logWarn('[CDP] Coinbase CDP credentials not configured. Wallet features will be disabled.');
  logWarn('[CDP] Required: COINBASE_CDP_API_KEY_ID, COINBASE_CDP_API_KEY_SECRET, COINBASE_CDP_WALLET_SECRET');
  if (!ENV.COINBASE_CDP_WALLET_SECRET) {
    logWarn('[CDP] ⚠️  COINBASE_CDP_WALLET_SECRET is missing - wallet creation will fail!');
  }
}

// Solana network configuration
const NETWORK = 'solana'; // Using Solana mainnet (use 'solana-devnet' for testnet)

/**
 * Get or create user's embedded wallet
 * @param {string} userId - User UUID (from Supabase)
 * @returns {Promise<{walletAddress: string, coinbaseUserId: string, network: string}>}
 */
export async function getOrCreateUserWallet(userId) {
  try {
    if (!cdp) {
      throw new Error('Coinbase CDP client not initialized. Please configure COINBASE_CDP_API_KEY_ID, COINBASE_CDP_API_KEY_SECRET, and COINBASE_CDP_WALLET_SECRET');
    }

    // Check if walletSecret is configured (required for wallet creation)
    if (!ENV.COINBASE_CDP_WALLET_SECRET) {
      throw new Error('COINBASE_CDP_WALLET_SECRET is required for wallet creation. Please set it in your environment variables.');
    }

    // Check if wallet already exists in database
    const { data: existingWallet, error: fetchError } = await serviceRoleClient
      .from('user_wallet')
      .select('crypto_wallet_address, coinbase_user_id')
      .eq('user_uuid', userId)
      .single();

    if (existingWallet?.crypto_wallet_address && existingWallet?.coinbase_user_id) {
      logInfo(`[CDP] Found existing wallet for user ${userId}: ${existingWallet.crypto_wallet_address}`);
      return {
        walletAddress: existingWallet.crypto_wallet_address,
        coinbaseUserId: existingWallet.coinbase_user_id,
        network: NETWORK
      };
    }

    // Create new server account (custodial wallet) for this user
    logInfo(`[CDP] Creating new custodial wallet for user ${userId}`);
    
    // Use getOrCreateAccount with userId as name to ensure one wallet per user
    // This creates a server account (custodial wallet) that we control
    // The name acts as a unique identifier - if account with this name exists, it returns it
    // Note: Account names must be 2-36 characters, UUIDs are exactly 36 characters (perfect fit)
    const accountName = userId; // Use UUID directly (36 chars, within API limit)
    const solanaAccount = await cdp.solana.getOrCreateAccount({
      name: accountName,
    });

    const walletAddress = solanaAccount.address; // Solana addresses are base58 encoded

    logInfo(`[CDP] Created wallet for user ${userId}: ${walletAddress}`);

    // Store in database - check if record exists first, then update or insert
    const { data: existingRecord, error: checkError } = await serviceRoleClient
      .from('user_wallet')
      .select('user_uuid')
      .eq('user_uuid', userId)
      .maybeSingle();

    if (checkError && checkError.code !== 'PGRST116') { // PGRST116 = no rows returned (expected)
      logError('[CDP] Error checking existing wallet in database', checkError);
    }

    const walletData = {
      user_uuid: userId,
      user_id: userId, // Keep for backward compatibility
      crypto_wallet_address: walletAddress,
      crypto_network: NETWORK,
      coinbase_user_id: solanaAccount.name || solanaAccount.address, // Store account name or address as identifier
      balance: 0, // Keep for compatibility, but we'll read from blockchain
      updated_at: new Date().toISOString()
    };

    let upsertError = null;
    if (existingRecord) {
      // Update existing record
      const { error } = await serviceRoleClient
        .from('user_wallet')
        .update(walletData)
        .eq('user_uuid', userId);
      upsertError = error;
    } else {
      // Insert new record
      const { error } = await serviceRoleClient
        .from('user_wallet')
        .insert(walletData);
      upsertError = error;
    }

    if (upsertError) {
      logError('[CDP] Error storing wallet in database', upsertError);
      // Continue anyway - wallet was created successfully
    } else {
      logInfo(`[CDP] Wallet stored in database for user ${userId}`);
    }

    return {
      walletAddress,
      coinbaseUserId: solanaAccount.name || solanaAccount.address, // Use account name or address as identifier
      network: NETWORK
    };
  } catch (err) {
    logError('[CDP] Error getting/creating wallet', err);
    throw err;
  }
}

/**
 * Get wallet balance from Solana blockchain (USDC SPL token)
 * Uses Solana Web3.js to query the blockchain directly
 * @param {string} walletAddress - Solana wallet address (base58)
 * @returns {Promise<number>} Balance in USDC (as a number)
 */
export async function getWalletBalance(walletAddress) {
  try {
    if (!walletAddress) {
      return 0;
    }

    // USDC on Solana is an SPL token with mint address: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
    const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    
    // Use Solana Web3.js to query the blockchain directly
    try {
      // Dynamic import to avoid requiring it if not installed
      const { Connection, PublicKey } = await import('@solana/web3.js');
      
      // Connect to Solana mainnet (use 'devnet' for testnet)
      const connection = new Connection('https://api.mainnet-beta.solana.com', 'confirmed');
      
      const publicKey = new PublicKey(walletAddress);
      
      // Get all token accounts for this wallet filtered by USDC mint
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey(USDC_MINT_ADDRESS),
      });

      if (tokenAccounts.value.length > 0) {
        // Get the USDC balance from the first token account
        const tokenAccount = tokenAccounts.value[0];
        const balance = tokenAccount.account.data.parsed.info.tokenAmount.uiAmount;
        
        logInfo(`[CDP] Found USDC balance: ${balance} for wallet ${walletAddress}`);
        return parseFloat(balance || 0);
      }

      // If no USDC token account found, return 0
      logInfo(`[CDP] No USDC token account found for wallet ${walletAddress}`);
      return 0;
    } catch (balanceError) {
      logWarn('[CDP] Error fetching Solana USDC balance via Web3.js', balanceError);
      // Return 0 on error to prevent breaking the app
      return 0;
    }
  } catch (err) {
    logError('[CDP] Error fetching Solana balance', err);
    // Return 0 on error to prevent breaking the app
    return 0;
  }
}

/**
 * Get user wallet with blockchain balance
 * @param {string} userId - User UUID
 * @returns {Promise<{address: string, balance: number, coinbaseUserId: string}>}
 */
export async function getUserWalletWithBalance(userId) {
  try {
    const { walletAddress, coinbaseUserId } = await getOrCreateUserWallet(userId);
    const balance = await getWalletBalance(walletAddress);

    return {
      address: walletAddress,
      balance,
      coinbaseUserId
    };
  } catch (err) {
    logError('[CDP] Error getting wallet with balance', err);
    throw err;
  }
}

/**
 * Generate JWT token for CDP API authentication using CDP SDK
 * @param {string} requestMethod - HTTP method (e.g., 'POST')
 * @param {string} requestPath - API path (e.g., '/platform/v2/onramp/sessions')
 * @returns {Promise<string>} JWT token
 */
async function generateCdpJwt(requestMethod = 'POST', requestPath = '/platform/v2/onramp/sessions') {
  if (!ENV.COINBASE_CDP_API_KEY_ID || !ENV.COINBASE_CDP_API_KEY_SECRET) {
    throw new Error('Coinbase CDP API credentials not configured');
  }

  try {
    const jwtToken = await generateJwt({
      apiKeyId: ENV.COINBASE_CDP_API_KEY_ID,
      apiKeySecret: ENV.COINBASE_CDP_API_KEY_SECRET,
      requestMethod: requestMethod,
      requestHost: 'api.cdp.coinbase.com',
      requestPath: requestPath,
      expiresIn: 120, // 2 minutes
    });

    logInfo(`[CDP] Generated JWT using CDP SDK (first 50 chars): ${jwtToken.substring(0, 50)}...`);
    return jwtToken;
  } catch (err) {
    logError('[CDP] Error generating JWT with CDP SDK', err);
    throw new Error(`Failed to generate JWT: ${err.message}`);
  }
}

/**
 * Generate Coinbase Onramp session using Sessions API v2
 * Uses CDP SDK for JWT generation and Sessions API v2 endpoint
 * @param {string} walletAddress - Destination wallet address
 * @param {string} userId - User ID for partnerUserRef
 * @param {string} email - User email (optional)
 * @param {number} presetFiatAmount - Optional preset fiat amount (USD)
 * @param {string} clientIp - Client IP address (required)
 * @param {boolean} useSandbox - Use sandbox URL (default: false, uses production)
 * @returns {Promise<{onrampUrl: string, paymentLinkUrl: string, session: object}>}
 */
export async function generateCoinbaseOnrampOrder(walletAddress, userId, email = null, presetFiatAmount = null, clientIp = null, useSandbox = false) {
  try {
    if (!ENV.COINBASE_CDP_API_KEY_ID || !ENV.COINBASE_CDP_API_KEY_SECRET) {
      throw new Error('Coinbase CDP API credentials not configured. Please set COINBASE_CDP_API_KEY_ID and COINBASE_CDP_API_KEY_SECRET');
    }

    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    if (!clientIp) {
      throw new Error('Client IP address is required for security validation');
    }

    // Generate JWT using CDP SDK
    const API_PATH = '/platform/v2/onramp/sessions';
    const jwtToken = await generateCdpJwt('POST', API_PATH);

    // Prepare request body for Sessions API v2
    const requestBody = {
      destinationAddress: walletAddress,
      purchaseCurrency: 'USDC', // USDC on Solana
      destinationNetwork: 'solana', // Solana network
      ...(presetFiatAmount && {
        paymentAmount: presetFiatAmount.toString(),
        paymentCurrency: 'USD',
      }),
      clientIp: clientIp,
      ...(userId && { partnerUserRef: userId }),
    };

    logInfo(`[CDP] Creating Onramp session v2 for wallet ${walletAddress}, user ${userId}, Sandbox: ${useSandbox}`);
    logInfo(`[CDP] Request body:`, JSON.stringify(requestBody, null, 2));

    // Call CDP v2 Onramp Sessions API
    const response = await fetch('https://api.cdp.coinbase.com/platform/v2/onramp/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorJson = null;
      try {
        errorJson = JSON.parse(errorText);
      } catch (e) {
        // Not JSON, use text as-is
      }
      
      logError('[CDP] Onramp Sessions API v2 error', { 
        status: response.status, 
        statusText: response.statusText,
        error: errorText,
        errorJson: errorJson,
        jwtPrefix: jwtToken.substring(0, 50) + '...',
        requestUrl: 'https://api.cdp.coinbase.com/platform/v2/onramp/sessions',
        requestBody: requestBody
      });
      throw new Error(`Failed to create onramp session: ${response.status} ${errorJson?.errorMessage || errorText}`);
    }

    const data = await response.json();
    
    if (!data.session?.onrampUrl) {
      logError('[CDP] Unexpected response format', data);
      throw new Error('Onramp URL not found in API response');
    }

    logInfo(`[CDP] Successfully created Onramp session v2`);
    logInfo(`[CDP] Onramp URL: ${data.session.onrampUrl}`);

    return {
      onrampUrl: data.session.onrampUrl,
      paymentLinkUrl: data.session.onrampUrl, // Alias for compatibility
      session: data.session,
      quote: data.quote, // May be undefined for basic sessions
      sessionToken: null, // Not used with Sessions API v2
    };
  } catch (err) {
    logError('[CDP] Error creating onramp session v2', err);
    throw err;
  }
}

/**
 * Generate Coinbase Onramp session token and URL (DEPRECATED - using Orders API v2 instead)
 * Uses Session Token API (required for secure initialization)
 * @deprecated Use generateCoinbaseOnrampOrder instead
 * @param {string} walletAddress - Destination wallet address
 * @param {string} clientIp - Client IP address (required for security)
 * @param {number} presetFiatAmount - Optional preset fiat amount (USD)
 * @returns {Promise<{onrampUrl: string, sessionToken: string}>}
 */
export async function generateCoinbaseOnrampSession(walletAddress, clientIp, presetFiatAmount = null) {
  try {
    if (!ENV.COINBASE_CDP_API_KEY_ID || !ENV.COINBASE_CDP_API_KEY_SECRET) {
      throw new Error('Coinbase CDP API credentials not configured. Please set COINBASE_CDP_API_KEY_ID and COINBASE_CDP_API_KEY_SECRET');
    }

    if (!walletAddress) {
      throw new Error('Wallet address is required');
    }

    if (!clientIp) {
      throw new Error('Client IP address is required for security validation');
    }

    // Generate JWT for authentication
    const jwtToken = await generateCdpJwt();

    // Prepare addresses array for Session Token API
    // Use the new format: addresses with blockchains (not destinationWallets)
    const addresses = [
      {
        address: walletAddress,
        blockchains: ['solana'] // Solana for USDC
      }
    ];

    // Only USDC and SOL available
    const assets = ['USDC', 'SOL'];

    const requestBody = {
      addresses: addresses,
      assets: assets,
      clientIp: clientIp,
    };

    logInfo(`[CDP] Calling Session Token API for wallet ${walletAddress}, IP: ${clientIp}`);
    logInfo(`[CDP] Request body:`, JSON.stringify(requestBody, null, 2));
    logInfo(`[CDP] Authorization header: Bearer ${jwtToken.substring(0, 50)}...`);

    // Call Session Token API
    const response = await fetch('https://api.developer.coinbase.com/onramp/v1/token', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logError('[CDP] Session Token API error', { 
        status: response.status, 
        statusText: response.statusText,
        error: errorText,
        apiKeyIdPrefix: ENV.COINBASE_CDP_API_KEY_ID?.substring(0, 10) || 'missing',
        hasSecret: !!ENV.COINBASE_CDP_API_KEY_SECRET
      });
      throw new Error(`Failed to generate session token: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    // Response format: {"data": {"token": "...", "channel_id": ""}}
    const sessionToken = data.data?.token || data.token;

    if (!sessionToken) {
      logError('[CDP] Unexpected response format', data);
      throw new Error('Session token not found in API response');
    }

    logInfo(`[CDP] Successfully generated session token for wallet ${walletAddress}`);

    // Build onramp URL with session token (required)
    const baseUrl = 'https://pay.coinbase.com/buy/select-asset';
    const params = new URLSearchParams({
      sessionToken: sessionToken, // Required for secure initialization
      defaultNetwork: 'base', // Default to Base for USDC
      defaultAsset: 'USDC', // Default to USDC
    });

    if (presetFiatAmount) {
      params.append('presetFiatAmount', presetFiatAmount.toString());
    }

    const onrampUrl = `${baseUrl}?${params.toString()}`;

    return {
      onrampUrl,
      sessionToken,
    };
  } catch (err) {
    logError('[CDP] Error generating onramp session', err);
    throw err;
  }
}

/**
 * Generate Coinbase onramp link (deprecated - use generateCoinbaseOnrampSession instead)
 * @deprecated Use generateCoinbaseOnrampSession instead for secure session token-based URLs
 * @param {string} walletAddress - Destination wallet address
 * @param {string} amount - Optional preset amount (USD)
 * @returns {string} Coinbase onramp URL
 */
export function generateCoinbaseOnrampLink(walletAddress, amount = null) {
  logWarn('[CDP] generateCoinbaseOnrampLink is deprecated. Use generateCoinbaseOnrampSession instead.');
  const baseUrl = 'https://pay.coinbase.com/buy/select-asset';
  const params = new URLSearchParams({
    'destinationWallets[0][address]': walletAddress,
    'destinationWallets[0][assets][]': 'BASE',
    'destinationWallets[0][network]': 'solana',
  });

  if (amount) {
    params.append('defaultAmount', amount);
  }

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Send transaction from user's wallet
 * @param {string} userId - User UUID
 * @param {object} transaction - Transaction object {to, value, data}
 * @returns {Promise<string>} Transaction hash
 */
export async function sendTransaction(userId, transaction) {
  try {
    if (!cdp) {
      throw new Error('Coinbase CDP client not initialized');
    }

    const { walletAddress } = await getOrCreateUserWallet(userId);

    // Build transaction as EIP-1559 transaction request
    const tx = {
      to: transaction.to,
      value: transaction.value || '0',
      data: transaction.data || '0x',
      type: 'eip1559',
    };

    // Sign and send transaction using CDP
    const result = await cdp.evm.sendTransaction({
      address: walletAddress,
      transaction: tx,
      network: NETWORK,
    });

    logInfo(`[CDP] Transaction sent: ${result.transactionHash}`);
    return result.transactionHash;
  } catch (err) {
    logError('[CDP] Error sending transaction', err);
    throw err;
  }
}

