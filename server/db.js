/**
 * Database Module
 * Handles all PostgreSQL database operations for the Kalshi Parlay Helper
 */

import pkg from 'pg';
const { Pool } = pkg;
import { ENV, getEnvBool } from '../config/env.js';
import { CONFIG } from '../config/constants.js';
import { logError, logInfo } from './utils/logger.js';

const pool = new Pool({
  connectionString: ENV.DATABASE_URL,
  ssl: ENV.NODE_ENV === 'production' 
    ? { rejectUnauthorized: false } 
    : false  // Disable SSL for local development
});

/**
 * Initialize database tables and indexes
 * Creates all required tables if they don't exist
 * @throws {Error} If database initialization fails
 */
export async function initializeDatabase() {
  const client = await pool.connect();
  
  try {
    logInfo('Initializing database tables...');
    
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create parlay_bets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS parlay_bets (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        market_id VARCHAR(255) NOT NULL,
        market_title TEXT NOT NULL,
        market_url TEXT,
        image_url TEXT,
        option_id VARCHAR(255) NOT NULL,
        option_label VARCHAR(255) NOT NULL,
        prob DECIMAL(5, 2),
        ticker VARCHAR(255),
        environment VARCHAR(20) DEFAULT 'production',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);
    
    // Add environment column if it doesn't exist (migration for existing databases)
    try {
      await client.query(`
        ALTER TABLE parlay_bets ADD COLUMN IF NOT EXISTS environment VARCHAR(20) DEFAULT 'production';
      `);
      logInfo('Environment column added/verified');
    } catch (err) {
      if (!err.message.includes('already exists')) {
        logError('Warning adding environment column', err);
      }
    }
    
    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_parlay_bets_user_id ON parlay_bets(user_id);
    `);
    
    // Add ticker column if it doesn't exist (migration for existing databases)
    try {
      await client.query(`
        ALTER TABLE parlay_bets ADD COLUMN IF NOT EXISTS ticker VARCHAR(255);
      `);
      logInfo('Ticker column added/verified');
    } catch (err) {
      // Column might already exist, that's okay
      if (!err.message.includes('already exists')) {
        logError('Warning adding ticker column', err);
      }
    }
    
    // Create pending_payments table for Stripe sessions
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_payments (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        stake DECIMAL(10, 2) NOT NULL,
        parlay_data JSONB NOT NULL,
        quote_data JSONB,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_payments_session_id ON pending_payments(session_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_payments_user_id ON pending_payments(user_id);
    `);
    
    // Create completed_purchases table for confirmed payments
    await client.query(`
      CREATE TABLE IF NOT EXISTS completed_purchases (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        stake DECIMAL(10, 2) NOT NULL,
        payout DECIMAL(10, 2) NOT NULL,
        parlay_data JSONB NOT NULL,
        quote_data JSONB,
        hedging_strategy JSONB,
        stripe_amount DECIMAL(10, 2) NOT NULL,
        payment_status VARCHAR(50) DEFAULT 'completed',
        hedge_executed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_completed_purchases_user_id ON completed_purchases(user_id);
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_completed_purchases_session_id ON completed_purchases(session_id);
    `);
    
    logInfo('Database initialized successfully');
  } catch (err) {
    logError('Error initializing database', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get or create a user in the database
 * @param {string} userId - Unique user identifier
 * @returns {Promise<Object>} User object
 */
export async function getOrCreateUser(userId) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'INSERT INTO users (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING *',
      [userId]
    );
    return result.rows[0] || { user_id: userId };
  } finally {
    client.release();
  }
}

/**
 * Get all parlay bets for a user (optionally filtered by environment)
 * @param {string} userId - User identifier
 * @param {string} environment - Optional environment filter ('demo' or 'production')
 * @returns {Promise<Array>} Array of parlay bet objects
 */
export async function getParlayBets(userId, environment = null) {
  const client = await pool.connect();
  
  try {
    let query = `SELECT id, market_id, market_title, market_url, image_url, option_id, option_label, prob, ticker, environment, created_at
       FROM parlay_bets
       WHERE user_id = $1`;
    const params = [userId];
    
    if (environment) {
      query += ` AND environment = $2`;
      params.push(environment);
    }
    
    query += ` ORDER BY created_at ASC`;
    
    const result = await client.query(query, params);
    
    return result.rows.map(row => ({
      id: row.id,
      marketId: row.market_id,
      marketTitle: row.market_title,
      marketUrl: row.market_url,
      imageUrl: row.image_url,
      optionId: row.option_id,
      optionLabel: row.option_label,
      prob: parseFloat(row.prob),
      ticker: row.ticker,
      environment: row.environment || 'production'
    }));
  } finally {
    client.release();
  }
}

/**
 * Add a bet to the user's parlay
 * @param {string} userId - User identifier
 * @param {Object} bet - Bet object with market and option details
 * @returns {Promise<Object>} Created bet object with database ID
 */
export async function addParlayBet(userId, bet) {
  const client = await pool.connect();
  
  try {
    // Ensure user exists
    await getOrCreateUser(userId);
    
    // Validate environment - prevent mixing demo and production bets
    const environment = bet.environment || 'production';
    
    // Check if user has bets from different environment
    const existingBets = await getParlayBets(userId);
    if (existingBets.length > 0) {
      const existingEnv = existingBets[0].environment || 'production';
      if (existingEnv !== environment) {
        throw new Error(`Cannot mix bets from different environments. You have bets from ${existingEnv} environment.`);
      }
    }
    
    const result = await client.query(
      `INSERT INTO parlay_bets (user_id, market_id, market_title, market_url, image_url, option_id, option_label, prob, ticker, environment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [userId, bet.marketId, bet.marketTitle, bet.marketUrl, bet.imageUrl, bet.optionId, bet.optionLabel, bet.prob, bet.ticker, environment]
    );
    
    return {
      id: result.rows[0].id,
      marketId: result.rows[0].market_id,
      marketTitle: result.rows[0].market_title,
      marketUrl: result.rows[0].market_url,
      imageUrl: result.rows[0].image_url,
      optionId: result.rows[0].option_id,
      optionLabel: result.rows[0].option_label,
      prob: parseFloat(result.rows[0].prob),
      ticker: result.rows[0].ticker,
      environment: result.rows[0].environment || 'production'
    };
  } finally {
    client.release();
  }
}

/**
 * Remove a bet from the user's parlay
 * @param {string} userId - User identifier
 * @param {number} betId - Bet ID to remove
 * @returns {Promise<void>}
 */
export async function removeParlayBet(userId, betId) {
  const client = await pool.connect();
  
  try {
    await client.query(
      'DELETE FROM parlay_bets WHERE id = $1 AND user_id = $2',
      [betId, userId]
    );
  } finally {
    client.release();
  }
}

/**
 * Clear all parlay bets for a user
 * @param {string} userId - User identifier
 * @returns {Promise<void>}
 */
export async function clearParlayBets(userId) {
  const client = await pool.connect();
  
  try {
    await client.query(
      'DELETE FROM parlay_bets WHERE user_id = $1',
      [userId]
    );
  } finally {
    client.release();
  }
}

/**
 * Save pending payment to database
 * @param {string} sessionId - Stripe checkout session ID
 * @param {string} userId - User identifier
 * @param {number} stake - Stake amount
 * @param {Array} parlayData - Array of parlay bet objects
 * @param {Object} quoteData - Quote data from AI service
 * @returns {Promise<Object>} Saved payment record
 */
export async function savePendingPayment(sessionId, userId, stake, parlayData, quoteData) {
  const client = await pool.connect();
  
  try {
    await getOrCreateUser(userId);
    
    const result = await client.query(
      `INSERT INTO pending_payments (session_id, user_id, stake, parlay_data, quote_data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [sessionId, userId, stake, JSON.stringify(parlayData), JSON.stringify(quoteData)]
    );
    
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get pending payment by session ID
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<Object|null>} Payment record or null if not found
 */
export async function getPendingPayment(sessionId) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM pending_payments WHERE session_id = $1',
      [sessionId]
    );
    
    if (result.rows.length === 0) {
      return null;
    }
    
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Update pending payment status
 * @param {string} sessionId - Stripe checkout session ID
 * @param {string} status - New status ('pending', 'completed', etc.)
 * @returns {Promise<void>}
 */
export async function updatePaymentStatus(sessionId, status) {
  const client = await pool.connect();
  
  try {
    await client.query(
      'UPDATE pending_payments SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2',
      [status, sessionId]
    );
  } finally {
    client.release();
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
export async function saveCompletedPurchase(sessionId, userId, stake, payout, parlayData, quoteData, hedgingStrategy, stripeAmount) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      `INSERT INTO completed_purchases 
       (session_id, user_id, stake, payout, parlay_data, quote_data, hedging_strategy, stripe_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        sessionId,
        userId,
        stake,
        payout,
        JSON.stringify(parlayData),
        JSON.stringify(quoteData),
        JSON.stringify(hedgingStrategy),
        stripeAmount
      ]
    );
    
    return result.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Get completed purchase by session ID
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<Object|null>} Purchase record or null if not found
 */
export async function getCompletedPurchase(sessionId) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      'SELECT * FROM completed_purchases WHERE session_id = $1',
      [sessionId]
    );
    
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

/**
 * Mark hedge as executed for a completed purchase
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<void>}
 */
export async function markHedgeExecuted(sessionId) {
  const client = await pool.connect();
  
  try {
    await client.query(
      'UPDATE completed_purchases SET hedge_executed = TRUE WHERE session_id = $1',
      [sessionId]
    );
  } finally {
    client.release();
  }
}

/**
 * Get all completed purchases for a user
 * @param {string} userId - User identifier
 * @returns {Promise<Array>} Array of completed purchase records
 */
export async function getUserPurchaseHistory(userId) {
  const client = await pool.connect();
  
  try {
    const result = await client.query(
      `SELECT id, session_id, stake, payout, parlay_data, completed_at, hedge_executed
       FROM completed_purchases
       WHERE user_id = $1
       ORDER BY completed_at DESC`,
      [userId]
    );
    
    return result.rows;
  } finally {
    client.release();
  }
}

export default pool;

