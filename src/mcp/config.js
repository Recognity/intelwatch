/**
 * MCP Server Configuration.
 *
 * Reads MCP server endpoints from environment variables or
 * ~/.intelwatch/mcp.json config file.
 *
 * Supported servers:
 *   - pappers:   French corporate registry (SIREN, financials, BODACC, M&A)
 *   - annuaire:  Annuaire Entreprises / data.gouv.fr (free, no API key)
 *
 * Transport: Streamable HTTP (default) or stdio.
 *
 * Environment variables (override config file):
 *   MCP_PAPPERS_URL     — Streamable HTTP URL for Pappers MCP server
 *   MCP_ANNUAIRE_URL    — Streamable HTTP URL for Annuaire MCP server
 *   MCP_PAPPERS_COMMAND — stdio command for Pappers MCP server (alternative)
 *   MCP_ANNUAIRE_COMMAND — stdio command for Annuaire MCP server (alternative)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

function configPath() {
  return process.env.INTELWATCH_MCP_CONFIG_PATH || join(homedir(), '.intelwatch', 'mcp.json');
}

let _config = null;

/**
 * Load MCP configuration from disk + env overrides.
 * @returns {{ pappers: { url?: string, command?: string }, annuaire: { url?: string, command?: string } }}
 */
export function loadMcpConfig() {
  if (_config) return _config;

  // Defaults
  _config = {
    pappers: {},
    annuaire: {},
  };

  // Load from config file
  const path = configPath();
  if (existsSync(path)) {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      if (raw.pappers) _config.pappers = { ...raw.pappers };
      if (raw.annuaire) _config.annuaire = { ...raw.annuaire };
    } catch (err) {
      console.error(`[mcp] Failed to load ${path}: ${err.message}`);
    }
  }

  // Env overrides take precedence
  if (process.env.MCP_PAPPERS_URL) _config.pappers.url = process.env.MCP_PAPPERS_URL;
  if (process.env.MCP_PAPPERS_COMMAND) _config.pappers.command = process.env.MCP_PAPPERS_COMMAND;
  if (process.env.MCP_ANNUAIRE_URL) _config.annuaire.url = process.env.MCP_ANNUAIRE_URL;
  if (process.env.MCP_ANNUAIRE_COMMAND) _config.annuaire.command = process.env.MCP_ANNUAIRE_COMMAND;

  return _config;
}

/**
 * Check if a given MCP server is configured (has url or command).
 * @param {'pappers'|'annuaire'} serverName
 * @returns {boolean}
 */
export function isMcpConfigured(serverName) {
  const cfg = loadMcpConfig();
  const entry = cfg[serverName];
  return !!(entry?.url || entry?.command);
}

/**
 * Reset config cache (for testing).
 */
export function _resetConfig() {
  _config = null;
}
