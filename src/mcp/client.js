/**
 * MCP Client Manager.
 *
 * Manages connections to MCP servers (Pappers, Annuaire Entreprises)
 * via Streamable HTTP or stdio transport.
 *
 * Usage:
 *   const client = await getMcpClient('pappers');
 *   const result = await callMcpTool('pappers', 'pappers_get_entreprise', { siren: '123456789' });
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpConfig, isMcpConfigured } from './config.js';

/** @type {Map<string, Client>} */
const clients = new Map();

/** @type {Map<string, Promise<Client>>} */
const connecting = new Map();

/**
 * Get or create an MCP client for a given server.
 * Connections are cached and reused.
 * @param {'pappers'|'annuaire'} serverName
 * @returns {Promise<Client>}
 */
export async function getMcpClient(serverName) {
  // Return existing connected client
  if (clients.has(serverName)) return clients.get(serverName);

  // Deduplicate concurrent connection attempts
  if (connecting.has(serverName)) return connecting.get(serverName);

  const promise = _connect(serverName);
  connecting.set(serverName, promise);

  try {
    const client = await promise;
    clients.set(serverName, client);
    return client;
  } finally {
    connecting.delete(serverName);
  }
}

/**
 * Internal: establish connection to an MCP server.
 */
async function _connect(serverName) {
  const cfg = loadMcpConfig();
  const entry = cfg[serverName];

  if (!entry?.url && !entry?.command) {
    throw new Error(`[mcp] Server "${serverName}" not configured. Set MCP_${serverName.toUpperCase()}_URL or MCP_${serverName.toUpperCase()}_COMMAND.`);
  }

  const client = new Client(
    { name: 'intelwatch', version: '1.6.0' },
    { capabilities: {} },
  );

  let transport;

  if (entry.url) {
    // Streamable HTTP transport
    transport = new StreamableHTTPClientTransport(new URL(entry.url));
  } else {
    // stdio transport
    const parts = entry.command.split(/\s+/);
    transport = new StdioClientTransport({
      command: parts[0],
      args: parts.slice(1),
    });
  }

  await client.connect(transport);
  return client;
}

/**
 * Call a tool on an MCP server.
 *
 * @param {'pappers'|'annuaire'} serverName
 * @param {string} toolName — e.g. 'pappers_get_entreprise', 'annuaire_search'
 * @param {object} args — tool arguments
 * @returns {Promise<object>} — parsed JSON result from the tool
 * @throws {Error} if server not configured, tool call fails, or result is an error
 */
export async function callMcpTool(serverName, toolName, args = {}) {
  const client = await getMcpClient(serverName);

  const result = await client.callTool({ name: toolName, arguments: args });

  // MCP tool results contain content array; extract the text content
  if (result.isError) {
    const errText = result.content?.map(c => c.text).join(' ') || 'Unknown MCP tool error';
    throw new Error(`[mcp:${serverName}] ${toolName} error: ${errText}`);
  }

  const textContent = result.content?.find(c => c.type === 'text');
  if (!textContent?.text) {
    return null;
  }

  try {
    return JSON.parse(textContent.text);
  } catch {
    // Return raw text if not JSON
    return textContent.text;
  }
}

/**
 * Check if an MCP server is available (configured + connectable).
 * Caches the result for 60s to avoid repeated connection probes.
 * @param {'pappers'|'annuaire'} serverName
 * @returns {Promise<boolean>}
 */
const _healthCache = new Map();
const HEALTH_TTL = 60_000;

export async function isMcpAvailable(serverName) {
  if (!isMcpConfigured(serverName)) return false;

  const cached = _healthCache.get(serverName);
  if (cached && Date.now() - cached.ts < HEALTH_TTL) return cached.ok;

  try {
    await getMcpClient(serverName);
    _healthCache.set(serverName, { ok: true, ts: Date.now() });
    return true;
  } catch (err) {
    console.error(`[mcp] Health check failed for ${serverName}: ${err.message}`);
    _healthCache.set(serverName, { ok: false, ts: Date.now() });
    return false;
  }
}

/**
 * Disconnect all MCP clients. Call on process exit.
 */
export async function disconnectAll() {
  for (const [name, client] of clients) {
    try {
      await client.close();
    } catch (err) {
      console.error(`[mcp] Error closing ${name}: ${err.message}`);
    }
  }
  clients.clear();
  _healthCache.clear();
}

/**
 * Reset all state (for testing).
 */
export function _resetClients() {
  clients.clear();
  connecting.clear();
  _healthCache.clear();
}

// Re-export config helpers
export { isMcpConfigured } from './config.js';
