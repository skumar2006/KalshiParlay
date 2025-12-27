/**
 * Centralized Logging Utility
 * Provides consistent logging format across the application
 */

const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

const LOG_LABELS = {
  [LOG_LEVELS.ERROR]: '❌ ERROR',
  [LOG_LEVELS.WARN]: '⚠️  WARN',
  [LOG_LEVELS.INFO]: 'ℹ️  INFO',
  [LOG_LEVELS.DEBUG]: '🔍 DEBUG',
};

const currentLogLevel = process.env.LOG_LEVEL === 'debug' 
  ? LOG_LEVELS.DEBUG 
  : LOG_LEVELS.INFO;

/**
 * Format log message with timestamp and level
 * @param {number} level - Log level
 * @param {string} message - Log message
 * @param {any} data - Optional data to log
 * @returns {string} Formatted log message
 */
function formatLog(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const label = LOG_LABELS[level];
  const prefix = `[${timestamp}] ${label}`;
  
  if (data !== null) {
    return `${prefix} ${message}\n${JSON.stringify(data, null, 2)}`;
  }
  
  return `${prefix} ${message}`;
}

/**
 * Log error message
 * @param {string} message - Error message
 * @param {Error|any} error - Error object or data
 */
export function logError(message, error = null) {
  if (LOG_LEVELS.ERROR <= currentLogLevel) {
    if (error instanceof Error) {
      console.error(formatLog(LOG_LEVELS.ERROR, message, {
        message: error.message,
        stack: error.stack,
      }));
    } else {
      console.error(formatLog(LOG_LEVELS.ERROR, message, error));
    }
  }
}

/**
 * Log warning message
 * @param {string} message - Warning message
 * @param {any} data - Optional data
 */
export function logWarn(message, data = null) {
  if (LOG_LEVELS.WARN <= currentLogLevel) {
    console.warn(formatLog(LOG_LEVELS.WARN, message, data));
  }
}

/**
 * Log info message
 * @param {string} message - Info message
 * @param {any} data - Optional data
 */
export function logInfo(message, data = null) {
  if (LOG_LEVELS.INFO <= currentLogLevel) {
    console.log(formatLog(LOG_LEVELS.INFO, message, data));
  }
}

/**
 * Log debug message
 * @param {string} message - Debug message
 * @param {any} data - Optional data
 */
export function logDebug(message, data = null) {
  if (LOG_LEVELS.DEBUG <= currentLogLevel) {
    console.log(formatLog(LOG_LEVELS.DEBUG, message, data));
  }
}

/**
 * Log section header (for better readability)
 * @param {string} title - Section title
 * @param {number} width - Width of separator line
 */
export function logSection(title, width = 80) {
  const separator = '='.repeat(width);
  console.log(`\n${separator}`);
  console.log(title);
  console.log(separator);
}

/**
 * Log subsection header
 * @param {string} title - Subsection title
 */
export function logSubsection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(Math.min(title.length, 60)));
}





