import chalk from 'chalk';
import { getTracker, listSnapshots, loadSnapshot } from '../storage.js';
import { createTable, header, error, warn, trackerTypeIcon } from '../utils/display.js';

export function runHistory(trackerId, options) {
  const tracker = getTracker(trackerId);

  if (!tracker) {
    error(`Tracker not found: ${trackerId}`);
    process.exit(1);
  }

  const limit = parseInt(options.limit || '20');
  const snapshots = listSnapshots(trackerId, limit);

  if (snapshots.length === 0) {
    warn(`No snapshots for tracker: ${trackerId}`);
    console.log(chalk.gray('Run `intelwatch check` first.'));
    return;
  }

  const target = tracker.name || tracker.keyword || tracker.brandName || trackerId;
  header(`${trackerTypeIcon(tracker.type)} History: ${target}`);
  console.log(chalk.gray(`  Showing last ${snapshots.length} snapshot(s)\n`));

  const table = createTable(['Date', 'Time', 'Changes', 'Summary']);

  for (const snap of snapshots.reverse()) {
    const snapshot = loadSnapshot(snap.filepath);
    if (!snapshot) continue;

    const date = new Date(snapshot.checkedAt);
    const dateStr = date.toLocaleDateString();
    const timeStr = date.toLocaleTimeString();

    const changes = snapshot.changes || [];
    const changeCount = changes.length > 0 ? chalk.yellow(String(changes.length)) : chalk.gray('0');
    const summary = changes.length > 0
      ? changes[0].value?.slice(0, 50) || changes[0].field
      : chalk.gray('—');

    let extra = '';
    if (tracker.type === 'competitor') {
      extra = `${snapshot.pageCount || 0} pages`;
    } else if (tracker.type === 'keyword') {
      extra = `${snapshot.resultCount || 0} results`;
    } else if (tracker.type === 'brand') {
      extra = `${snapshot.mentionCount || 0} mentions`;
    }

    table.push([
      dateStr,
      timeStr,
      changeCount,
      (extra ? chalk.gray(extra + ' | ') : '') + summary.slice(0, 45),
    ]);
  }

  console.log(table.toString());
}
