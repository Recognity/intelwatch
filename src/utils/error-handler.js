import chalk from 'chalk';

/**
 * Global error handler for CLI
 */
export function setupGlobalErrorHandler() {
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error(chalk.red('\n❌ Fatal error occurred:'));
    if (process.env.DEBUG_ERRORS) {
      console.error(error.stack);
    } else {
      console.error(chalk.red(`   ${error.message}`));
      console.error(chalk.gray('   Run with DEBUG_ERRORS=1 for full stack trace'));
    }
    process.exit(1);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('\n❌ Unhandled promise rejection:'));
    if (process.env.DEBUG_ERRORS) {
      console.error(reason);
    } else {
      console.error(chalk.red(`   ${reason?.message || reason}`));
      console.error(chalk.gray('   Run with DEBUG_ERRORS=1 for full details'));
    }
    process.exit(1);
  });
}

/**
 * Wrap async functions with error handling
 */
export function withErrorHandling(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      handleError(error);
      process.exit(1);
    }
  };
}

/**
 * Handle and format errors appropriately
 */
export function handleError(error, context = '') {
  // Guard against null/undefined/non-object errors
  if (error == null) {
    console.error(chalk.red(`\n❌ Unknown error${context ? ` in ${context}` : ''}`));
    return;
  }
  if (typeof error === 'string') {
    console.error(chalk.red(`\n❌ ${error}`));
    return;
  }

  if (process.env.NODE_ENV === 'development' || process.env.DEBUG_ERRORS) {
    console.error(chalk.red(`\n❌ Error${context ? ` in ${context}` : ''}:`));
    console.error(error.stack || error);
    return;
  }

  // Production error handling - user-friendly messages
  const message = formatUserFriendlyError(error);
  console.error(chalk.red(`\n❌ ${message}`));
  
  if (error.code || error.status) {
    console.error(chalk.gray(`   Error code: ${error.code || error.status}`));
  }
  
  console.error(chalk.gray('   Run with DEBUG_ERRORS=1 for technical details'));
}

/**
 * Convert technical errors to user-friendly messages
 */
function formatUserFriendlyError(error) {
  // Network errors
  if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    return 'Network error: Unable to connect. Check your internet connection.';
  }
  
  if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
    return 'Request timed out. The server took too long to respond.';
  }

  // HTTP errors
  if (error.response?.status === 401) {
    return 'Authentication failed. Check your API keys or credentials.';
  }
  
  if (error.response?.status === 403) {
    return 'Access denied. You may not have permission for this resource.';
  }
  
  if (error.response?.status === 404) {
    return 'Resource not found. The requested data may no longer exist.';
  }
  
  if (error.response?.status === 429) {
    return 'Rate limited. Too many requests - please wait before trying again.';
  }
  
  if (error.response?.status >= 500) {
    return 'Server error. The remote service is experiencing issues.';
  }

  // File system errors
  if (error.code === 'ENOENT') {
    return `File not found: ${error.path || 'unknown file'}`;
  }
  
  if (error.code === 'EACCES' || error.code === 'EPERM') {
    return `Permission denied: ${error.path || 'access denied'}`;
  }

  // JSON parsing errors
  if (error.name === 'SyntaxError' && error.message?.includes('JSON')) {
    return 'Invalid JSON response. The server returned malformed data.';
  }

  // AI API errors
  if (error.message?.includes('OpenAI') || error.message?.includes('Anthropic')) {
    return `AI service error: ${error.message}`;
  }

  // Generic fallback
  return error.message || 'An unexpected error occurred';
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(required = []) {
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error(chalk.red('\n❌ Missing required environment variables:'));
    for (const key of missing) {
      console.error(chalk.red(`   - ${key}`));
    }
    console.error(chalk.gray('\nPlease set these variables and try again.'));
    process.exit(1);
  }
}

/**
 * Retry function with exponential backoff
 */
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
    onRetry = () => {}
  } = options;

  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxAttempts) {
        break;
      }

      // Don't retry on certain errors
      if (error.response?.status === 401 || error.response?.status === 403) {
        break;
      }

      const delay = Math.min(
        baseDelay * Math.pow(backoffFactor, attempt - 1),
        maxDelay
      );
      
      onRetry(error, attempt, delay);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}