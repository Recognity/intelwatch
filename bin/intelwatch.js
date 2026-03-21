#!/usr/bin/env node

import { program } from '../src/index.js';
import { setupGlobalErrorHandler, handleError } from '../src/utils/error-handler.js';

// Setup global error handling
setupGlobalErrorHandler();

// Parse CLI arguments with error handling
program.parseAsync(process.argv).catch(err => {
  handleError(err, 'CLI');
  process.exit(1);
});
