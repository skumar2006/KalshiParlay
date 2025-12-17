/**
 * Environment Variable Validation and Configuration
 * Ensures all required environment variables are present and valid
 */

import dotenv from 'dotenv';

dotenv.config();

/**
 * Validates that required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
export function validateEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      'Please check your .env file and ensure all required variables are set.'
    );
  }

  // Warn about optional but recommended variables
  const recommended = [
    'DATABASE_URL', // Optional - can use Supabase connection string
    'SUPABASE_ANON_KEY', // Optional - for frontend use
    'KALSHI_API_KEY',
    'KALSHI_DEMO_API_KEY',
    'KALSHI_DEMO_PRIVATE_KEY',
    'STRIPE_API_KEY',
    'STRIPE_DEMO_API_KEY',
    'OPENAI_API_KEY',
  ];

  const missingRecommended = recommended.filter(key => !process.env[key]);

  if (missingRecommended.length > 0) {
    console.warn(
      `⚠️  Optional environment variables not set: ${missingRecommended.join(', ')}\n` +
      'Some features may not work without these variables.'
    );
  }
}

/**
 * Get environment variable with optional default value
 * @param {string} key - Environment variable key
 * @param {any} defaultValue - Default value if not set
 * @returns {string|any} Environment variable value or default
 */
export function getEnv(key, defaultValue = undefined) {
  return process.env[key] ?? defaultValue;
}

/**
 * Get boolean environment variable
 * @param {string} key - Environment variable key
 * @param {boolean} defaultValue - Default value if not set
 * @returns {boolean} Boolean value
 */
export function getEnvBool(key, defaultValue = false) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  return value === 'true' || value === '1';
}

/**
 * Get integer environment variable
 * @param {string} key - Environment variable key
 * @param {number} defaultValue - Default value if not set
 * @returns {number} Integer value
 */
export function getEnvInt(key, defaultValue = undefined) {
  const value = process.env[key];
  if (value === undefined) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

// Export commonly used environment variables
export const ENV = {
  NODE_ENV: getEnv('NODE_ENV', 'development'),
  PORT: getEnvInt('PORT', 4000),
  
  // Environment mode: 'demo' or 'production' (defaults to 'demo' for safety)
  ENVIRONMENT: getEnv('ENVIRONMENT', 'demo').toLowerCase(),
  
  // Environment flags (derived from ENVIRONMENT)
  IS_PRODUCTION: getEnv('ENVIRONMENT', 'demo').toLowerCase() === 'production',
  IS_DEMO: getEnv('ENVIRONMENT', 'demo').toLowerCase() === 'demo',
  
  // Supabase configuration
  SUPABASE_URL: getEnv('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_ANON_KEY: getEnv('SUPABASE_ANON_KEY'),
  DATABASE_URL: getEnv('DATABASE_URL'), // Optional - can use Supabase connection string
  
  // Kalshi API configuration
  KALSHI_API_KEY: getEnv('KALSHI_API_KEY'),
  KALSHI_DEMO_API_KEY: getEnv('KALSHI_DEMO_API_KEY'),
  KALSHI_DEMO_PRIVATE_KEY: getEnv('KALSHI_DEMO_PRIVATE_KEY'),
  KALSHI_PRIVATE_KEY: getEnv('KALSHI_PRIVATE_KEY'),
  KALSHI_API_BASE_URL: getEnv('KALSHI_API_BASE_URL'), // Will be set based on environment if not provided
  
  // Stripe configuration
  STRIPE_API_KEY: getEnv('STRIPE_API_KEY'), // Production key (sk_live_...)
  STRIPE_DEMO_API_KEY: getEnv('STRIPE_DEMO_API_KEY'), // Demo/test key (sk_test_...)
  STRIPE_WEBHOOK_SECRET: getEnv('STRIPE_WEBHOOK_SECRET'), // Production webhook secret
  STRIPE_DEMO_WEBHOOK_SECRET: getEnv('STRIPE_DEMO_WEBHOOK_SECRET'), // Demo/test webhook secret
  
  // Backend URL (for production checkout redirects)
  BACKEND_BASE_URL: getEnv('BACKEND_BASE_URL'),
  
  // OpenAI configuration
  OPENAI_API_KEY: getEnv('OPENAI_API_KEY'),
  
  // Feature flags
  KALSHI_DRY_RUN: getEnvBool('KALSHI_DRY_RUN', true),
  VERBOSE_HEDGING: getEnvBool('VERBOSE_HEDGING', false),
  
  // Hedging parameters
  HEDGE_BETA: parseFloat(getEnv('HEDGE_BETA', '0.6')), // Fraction of margin to spend (default 0.6 = 60%)
  HEDGE_ALPHA_MAX: parseFloat(getEnv('HEDGE_ALPHA_MAX', '0.4')), // Max hedge fraction (default 0.4 = 40%)
};

// Set Kalshi API base URL based on environment if not explicitly set
if (!ENV.KALSHI_API_BASE_URL) {
  ENV.KALSHI_API_BASE_URL = ENV.IS_PRODUCTION
    ? 'https://api.elections.kalshi.com/trade-api/v2'
    : 'https://demo-api.kalshi.co/trade-api/v2';
}

// Select Stripe API key based on environment (similar to Kalshi)
ENV.STRIPE_API_KEY_SELECTED = ENV.IS_PRODUCTION
  ? ENV.STRIPE_API_KEY
  : (ENV.STRIPE_DEMO_API_KEY || ENV.STRIPE_API_KEY); // Fallback to production key if demo not set

// Select Stripe webhook secret based on environment
ENV.STRIPE_WEBHOOK_SECRET_SELECTED = ENV.IS_PRODUCTION
  ? ENV.STRIPE_WEBHOOK_SECRET
  : (ENV.STRIPE_DEMO_WEBHOOK_SECRET || ENV.STRIPE_WEBHOOK_SECRET); // Fallback to production secret if demo not set

// Detect Stripe environment from selected API key (if starts with sk_live_ it's production)
ENV.STRIPE_IS_PRODUCTION = ENV.STRIPE_API_KEY_SELECTED?.startsWith('sk_live_') || false;


