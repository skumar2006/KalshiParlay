/**
 * Application Constants
 * Centralized configuration constants for the Kalshi Parlay Helper
 */

export const CONFIG = {
  SERVER: {
    DEFAULT_PORT: 4000,
    HEALTH_CHECK_PATH: '/health'
  },
  STRIPE: {
    PAYMENT_METHOD_TYPES: ['card'],
    PAYMENT_MODE: 'payment'
  },
  DATABASE: {
    SSL_ENABLED_IN_PRODUCTION: true
  }
};

export const ERROR_MESSAGES = {
  KALSHI: {
    MARKET_NOT_FOUND: 'Market not found'
  }
};

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};





