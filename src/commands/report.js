import chalk from 'chalk';
import { loadTrackers, listSnapshots, loadSnapshot, saveReport } from '../storage.js';
import { generateMarkdownReport } from '../report/markdown.js';
import { generateHtmlReport } from '../report/html.js';
import { generateJsonReport } from '../report/json.js';
import { error, success, warn } from '../utils/display.js';
import { writeFileSync } from 'fs';
import { diffCompetitorSnapshots } from '../trackers/competitor.js';
import { diffKeywordSnapshots } from '../trackers/keyword.js';
import { diffBrandSnapshots } from '../trackers/brand.js';
import { computeThreatScore } from '../trackers/competitor.js';
import { exportToJSON, exportToCSV, formatForExport } from '../utils/export.js';
import { setLanguage, getLanguage } from '../utils/i18n.js';

export async function runReport(options = {}) {
  // Set language from global option
  if (options.parent?.opts()?.lang) {
    setLanguage(options.parent.opts().lang);
  }

  const format = options.format || 'md';
  const trackers = loadTrackers();

  if (trackers.length === 0) {
    warn('No trackers configured. Use `intelwatch track` to add one.');
    return;
  }

  // Build report data
  const reportData = {
    generatedAt: new Date().toISOString(),
    competitors: [],
    keywords: [],
    brands: [],
  };

  for (const tracker of trackers) {
    const snapshots = listSnapshots(tracker.id);
    if (snapshots.length === 0) continue;

    const latest = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    const prev = snapshots.length > 1 ? loadSnapshot(snapshots[snapshots.length - 2].filepath) : null;

    let changes = [];
    if (tracker.type === 'competitor') {
      changes = diffCompetitorSnapshots(prev, latest);
      const threatScore = computeThreatScore(tracker, changes);
      reportData.competitors.push({
        tracker,
        snapshot: latest,
        changes,
        threatScore,
        prevSnapshot: prev,
      });
    } else if (tracker.type === 'keyword') {
      changes = diffKeywordSnapshots(prev, latest);
      reportData.keywords.push({ tracker, snapshot: latest, changes });
    } else if (tracker.type === 'brand') {
      changes = diffBrandSnapshots(prev, latest);
      reportData.brands.push({ tracker, snapshot: latest, changes });
    }
  }

  let content;
  let ext;

  if (format === 'html') {
    content = generateHtmlReport(reportData);
    ext = 'html';
  } else if (format === 'json') {
    content = generateJsonReport(reportData);
    ext = 'json';
  } else {
    content = generateMarkdownReport(reportData);
    ext = 'md';
  }

  if (options.output) {
    writeFileSync(options.output, content, 'utf8');
    success(`Report saved to: ${options.output}`);
  } else if (format === 'html') {
    const filename = `report-${new Date().toISOString().slice(0, 10)}.html`;
    const filepath = saveReport(filename, content);
    success(`HTML report saved to: ${filepath}`);
    console.log(chalk.gray('Open in your browser to view.'));
  } else {
    console.log(content);
  }

  // ── Export raw data ────────────────────────────────────────────────────────
  if (options.export) {
    try {
      const formatted = formatForExport(reportData, 'report');
      
      if (options.export.toLowerCase() === 'json') {
        const result = exportToJSON(formatted, options.output ? options.output.replace(/\.[^.]+$/, '-data.json') : null);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else if (options.export.toLowerCase() === 'csv') {
        const result = exportToCSV(formatted, options.output ? options.output.replace(/\.[^.]+$/, '-data.csv') : null);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else {
        console.log(chalk.yellow(`\n  ⚠️  Unsupported export format: ${options.export}. Use 'json' or 'csv'.\n`));
      }
    } catch (e) {
      console.error(chalk.red(`\n  ❌ Export failed: ${e.message}\n`));
    }
  }
}
