#!/usr/bin/env node

import { program } from '../src/index.js';

program.parseAsync(process.argv).catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
