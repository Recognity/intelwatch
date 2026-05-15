#!/usr/bin/env node

// Charge ~/.intelwatch/.env AVANT tout import qui lit process.env.
// Sans ça, les clés sauvegardées par `intelwatch setup` ne sont jamais lues
// au runtime (cause #1 des "Press 0 résultats / EXA absent").
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function loadIntelwatchEnv() {
  const envFile = join(homedir(), '.intelwatch', '.env');
  if (!existsSync(envFile)) return;
  try {
    const raw = readFileSync(envFile, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      // Shell-defined vars win over file (override-friendly)
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (err) {
    console.error(`[intelwatch] Failed to load ~/.intelwatch/.env: ${err.message}`);
  }
}
loadIntelwatchEnv();

const { program } = await import('../src/index.js');
const { setupGlobalErrorHandler, handleError } = await import('../src/utils/error-handler.js');

// Setup global error handling
setupGlobalErrorHandler();

// Parse CLI arguments with error handling
program.parseAsync(process.argv).catch(err => {
  handleError(err, 'CLI');
  process.exit(1);
});
