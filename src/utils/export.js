import { writeFileSync } from 'fs';
import { resolve } from 'path';
import * as XLSX from 'xlsx';
import { isPro, requirePro, getLimits, applyFreeLimit, printPaywallAndExit } from '../license.js';

// ── JSON Export ──────────────────────────────────────────────────────────────

/**
 * Export data to JSON format.
 * @param {any} data
 * @param {string|null} outputPath
 * @returns {string} Status message
 */
export function exportToJSON(data, outputPath = null) {
  const jsonStr = JSON.stringify(data, null, 2);

  if (outputPath) {
    writeFileSync(resolve(outputPath), jsonStr, 'utf8');
    return `Exported to ${outputPath}`;
  }

  console.log(jsonStr);
  return 'JSON output printed to console';
}

// ── CSV Export ────────────────────────────────────────────────────────────────

/**
 * Escape a value for CSV (RFC 4180 compliant).
 * @param {any} value
 * @returns {string}
 */
function escapeCSV(value) {
  if (value == null) return '';
  let str = typeof value === 'object'
    ? (Array.isArray(value) ? value.join('; ') : JSON.stringify(value))
    : String(value);
  // Always quote if contains comma, double-quote, newline, or leading/trailing whitespace
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str !== str.trim()) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Export an array of objects to CSV.
 * @param {Array<object>} data
 * @param {string|null} outputPath
 * @param {{ headers?: string[], separator?: string }} options
 * @returns {string} Status message
 */
export function exportToCSV(data, outputPath = null, options = {}) {
  if (!Array.isArray(data)) {
    throw new Error('CSV export requires an array of objects');
  }

  const sep = options.separator || ',';

  if (data.length === 0) {
    const empty = options.headers ? options.headers.join(sep) + '\n' : '';
    if (outputPath) {
      writeFileSync(resolve(outputPath), empty, 'utf8');
      return `Empty CSV exported to ${outputPath}`;
    }
    console.log(empty);
    return 'Empty CSV output';
  }

  const headers = options.headers || Object.keys(data[0]);
  const rows = [headers.join(sep)];

  for (const item of data) {
    const row = headers.map(h => escapeCSV(item[h]));
    rows.push(row.join(sep));
  }

  const csvStr = rows.join('\n') + '\n';

  if (outputPath) {
    writeFileSync(resolve(outputPath), csvStr, 'utf8');
    return `CSV exported to ${outputPath}`;
  }

  console.log(csvStr);
  return 'CSV output printed to console';
}

// ── XLS Export (xlsx format) ─────────────────────────────────────────────────

/**
 * Export data to XLSX (Excel) format.
 * @param {Array<object>} data — rows to export
 * @param {string} outputPath — output file (.xlsx)
 * @param {{ sheetName?: string, headers?: string[] }} options
 * @returns {string} Status message
 */
export function exportToXLS(data, outputPath, options = {}) {
  if (!outputPath) throw new Error('XLS export requires an output path');
  if (!Array.isArray(data)) throw new Error('XLS export requires an array of objects');

  const sheetName = options.sheetName || 'Data';
  const headers = options.headers || (data.length > 0 ? Object.keys(data[0]) : []);

  // Build worksheet from array of arrays (header row + data rows)
  const aoa = [headers];
  for (const item of data) {
    aoa.push(headers.map(h => {
      const v = item[h];
      if (v == null) return '';
      if (Array.isArray(v)) return v.join('; ');
      if (typeof v === 'object') return JSON.stringify(v);
      return v;
    }));
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Auto-size columns (approximate)
  ws['!cols'] = headers.map((h, i) => {
    let maxLen = h.length;
    for (const row of aoa.slice(1)) {
      const cellLen = String(row[i] || '').length;
      if (cellLen > maxLen) maxLen = cellLen;
    }
    return { wch: Math.min(maxLen + 2, 60) };
  });

  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, resolve(outputPath));
  return `XLS exported to ${outputPath}`;
}

// ── PDF Export (via @recognity/pdf-report) ────────────────────────────────────

/**
 * Export data to a PDF report.
 * @param {object} data — structured report data
 * @param {string} outputPath — output file (.pdf)
 * @param {{ type?: string, title?: string, branding?: object }} options
 * @returns {Promise<string>} Status message
 */
export async function exportToPDF(data, outputPath, options = {}) {
  if (!outputPath) throw new Error('PDF export requires an output path');

  const { generatePDF } = await import('@recognity/pdf-report');
  await generatePDF({
    type: options.type || 'intel-report',
    title: options.title || 'IntelWatch Report',
    data,
    output: resolve(outputPath),
    branding: options.branding,
  });

  return `PDF exported to ${outputPath}`;
}

// ── Flatten Object ───────────────────────────────────────────────────────────

/**
 * Flatten nested objects for tabular export.
 * { user: { name: 'Jo' } } → { 'user.name': 'Jo' }
 */
export function flattenObject(obj, prefix = '', result = {}) {
  for (const key of Object.keys(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    const val = obj[key];
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      flattenObject(val, newKey, result);
    } else {
      result[newKey] = val;
    }
  }
  return result;
}

// ── Format for Export ────────────────────────────────────────────────────────

/**
 * Format data for export based on command type.
 * @param {any} data
 * @param {string} commandType
 * @returns {Array<object>}
 */
export function formatForExport(data, commandType) {
  switch (commandType) {
    case 'check':     return formatCheckData(data);
    case 'digest':    return formatDigestData(data);
    case 'report':    return formatReportData(data);
    case 'profile':   return formatProfileData(data);
    case 'discover':  return formatDiscoverData(data);
    default:          return Array.isArray(data) ? data : [data];
  }
}

function formatCheckData(data) {
  if (!Array.isArray(data)) return [data];
  return data.map(item => ({
    trackerId: item.id || item.trackerId,
    name: item.name,
    url: item.url,
    type: item.type,
    status: item.status || 'unknown',
    lastCheck: item.lastCheck,
    changes: Array.isArray(item.changes) ? item.changes.length : 0,
    techStack: Array.isArray(item.techStack) ? item.techStack.join('; ') : '',
    seoScore: item.seoScore || null,
    sentiment: item.sentiment || null,
  }));
}

function formatDigestData(data) {
  if (!Array.isArray(data)) return [data];
  return data.map(item => flattenObject({
    tracker: { id: item.trackerId, name: item.name, type: item.type },
    changes: {
      total: item.changes?.length || 0,
      critical: item.changes?.filter(c => c.severity === 'critical').length || 0,
      major: item.changes?.filter(c => c.severity === 'major').length || 0,
      minor: item.changes?.filter(c => c.severity === 'minor').length || 0,
    },
    summary: item.summary || '',
  }));
}

function formatReportData(data) {
  return Array.isArray(data) ? data : [data];
}

function formatProfileData(data) {
  if (!data) return [];
  const profile = Array.isArray(data) ? data[0] : data;
  return [{
    siren: profile.siren,
    name: profile.name || profile.identity?.name,
    legalForm: profile.identity?.formeJuridique,
    nafCode: profile.identity?.nafCode,
    nafLabel: profile.identity?.nafLabel,
    creationDate: profile.identity?.dateCreation,
    address: profile.identity?.adresse,
    revenue: profile.financialHistory?.[0]?.revenue,
    netIncome: profile.financialHistory?.[0]?.netIncome,
    employees: profile.financialHistory?.[0]?.employees,
    year: profile.financialHistory?.[0]?.year,
    executiveSummary: profile.executiveSummary,
    healthScore: profile.healthScore?.score,
    riskLevel: profile.riskAssessment?.overall,
    strengths: profile.strengths?.map(s => s.text || s).join('; ') || '',
    weaknesses: profile.weaknesses?.map(w => w.text || w).join('; ') || '',
    competitors: profile.competitors?.map(c => c.name).join('; ') || '',
    subsidiariesCount: profile.subsidiaries?.length || 0,
    groupRevenue: profile.groupStructure?.consolidatedRevenue,
  }];
}

function formatDiscoverData(data) {
  if (!Array.isArray(data)) return [data];
  return data.map(item => ({
    name: item.name || item.domain,
    domain: item.domain,
    url: item.url,
    relevanceScore: item.relevanceScore || item.score,
    description: item.description || item.snippet || '',
    category: item.category || '',
  }));
}

// ── Unified Export Handler ───────────────────────────────────────────────────

/**
 * Handle --export flag for any command.
 *
 * Free tier:  json, csv (capped at 50 rows)
 * Pro tier:   json, csv (unlimited), xls, pdf
 *
 * @param {string} format — 'json' | 'csv' | 'xls' | 'pdf'
 * @param {any} data — data to export
 * @param {{ output?: string, commandType?: string, pdfOptions?: object }} options
 * @returns {Promise<string>} Status message
 */
export async function handleExport(format, data, options = {}) {
  const fmt = format.toLowerCase();
  const limits = getLimits();

  // Gate Pro-only formats — clean paywall exit
  if (['xls', 'xlsx', 'excel', 'pdf'].includes(fmt)) {
    if (!isPro()) {
      printPaywallAndExit(`Export to ${fmt.toUpperCase()}`);
    }
  }

  let formatted = options.commandType
    ? formatForExport(data, options.commandType)
    : (Array.isArray(data) ? data : [data]);

  // Apply Free-tier row cap on CSV
  if (fmt === 'csv' && Array.isArray(formatted)) {
    formatted = applyFreeLimit(formatted, limits.csvMaxRows, 'CSV export rows');
  }

  switch (fmt) {
    case 'json': {
      const outPath = options.output?.replace(/\.[^.]+$/, '.json') || null;
      return exportToJSON(formatted, outPath);
    }
    case 'csv': {
      const outPath = options.output?.replace(/\.[^.]+$/, '.csv') || null;
      return exportToCSV(formatted, outPath);
    }
    case 'xls':
    case 'xlsx':
    case 'excel': {
      const outPath = options.output?.replace(/\.[^.]+$/, '.xlsx') || 'export.xlsx';
      return exportToXLS(formatted, outPath);
    }
    case 'pdf': {
      const outPath = options.output?.replace(/\.[^.]+$/, '.pdf') || 'export.pdf';
      return exportToPDF(options.pdfData || data, outPath, options.pdfOptions || {});
    }
    default:
      throw new Error(`Unsupported export format: ${format}. Use json, csv, xls, or pdf.`);
  }
}
