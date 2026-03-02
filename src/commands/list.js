import chalk from 'chalk';
import { loadTrackers, removeTracker } from '../storage.js';
import { createTable, formatDate, statusBadge, trackerTypeIcon, success, error, warn } from '../utils/display.js';

export function listTrackers() {
  const trackers = loadTrackers();

  if (trackers.length === 0) {
    warn('No trackers configured.');
    console.log(chalk.gray('  Use `intelwatch track competitor <url>` to add your first tracker.'));
    return;
  }

  const table = createTable(['ID', 'Type', 'Target', 'Status', 'Last Check', 'Checks']);

  for (const t of trackers) {
    const target = t.type === 'competitor' ? (t.name || t.url)
      : t.type === 'keyword' ? `"${t.keyword}"`
      : `"${t.brandName}"`;

    table.push([
      chalk.cyan(t.id.slice(0, 30)),
      trackerTypeIcon(t.type) + ' ' + t.type,
      target.slice(0, 40),
      statusBadge(t.status || 'active'),
      formatDate(t.lastCheckedAt),
      String(t.checkCount || 0),
    ]);
  }

  console.log(table.toString());
  console.log(chalk.gray(`\n${trackers.length} tracker(s) total.`));
}

export function removeTrackerCmd(id) {
  try {
    const removed = removeTracker(id);
    success(`Tracker removed: ${removed.id}`);
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}
