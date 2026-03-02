import chalk from 'chalk';
import { loadTrackers, loadLatestSnapshot, listSnapshots, loadSnapshot } from '../storage.js';
import { diffCompetitorSnapshots } from '../trackers/competitor.js';
import { diffKeywordSnapshots } from '../trackers/keyword.js';
import { diffBrandSnapshots } from '../trackers/brand.js';
import { createTable, header, trackerTypeIcon, warn } from '../utils/display.js';

export async function runDigest() {
  const trackers = loadTrackers();

  if (trackers.length === 0) {
    warn('No trackers configured. Use `intelwatch track` to add one.');
    return;
  }

  header('📊 Intelligence Digest');
  console.log(chalk.gray(`Generated: ${new Date().toLocaleString()}\n`));

  const table = createTable(['Tracker', 'Type', 'Changes', 'Summary']);
  let totalChanges = 0;

  for (const tracker of trackers) {
    const snapshots = listSnapshots(tracker.id);

    if (snapshots.length === 0) {
      table.push([
        chalk.cyan(tracker.id.slice(0, 25)),
        trackerTypeIcon(tracker.type),
        chalk.gray('—'),
        chalk.gray('No snapshots yet'),
      ]);
      continue;
    }

    const latest = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    const prev = snapshots.length > 1 ? loadSnapshot(snapshots[snapshots.length - 2].filepath) : null;

    let changes = [];
    if (tracker.type === 'competitor') changes = diffCompetitorSnapshots(prev, latest);
    else if (tracker.type === 'keyword') changes = diffKeywordSnapshots(prev, latest);
    else if (tracker.type === 'brand') changes = diffBrandSnapshots(prev, latest);

    // Use stored changes if available and no prev
    if (!prev && latest.changes) {
      changes = latest.changes;
    }

    const target = tracker.name || tracker.keyword || tracker.brandName || tracker.id;
    const changeStr = changes.length > 0
      ? chalk.yellow(String(changes.length))
      : chalk.gray('0');

    const summary = changes.length > 0
      ? changes.slice(0, 2).map(c => c.value?.slice(0, 40) || c.field).join('; ')
      : chalk.gray('no changes');

    table.push([
      chalk.cyan(target.slice(0, 25)),
      trackerTypeIcon(tracker.type) + ' ' + tracker.type,
      changeStr,
      summary.slice(0, 50),
    ]);

    totalChanges += changes.length;
  }

  console.log(table.toString());
  console.log('');

  if (totalChanges > 0) {
    console.log(chalk.yellow(`⚡ ${totalChanges} total change(s) across all trackers.`));
    console.log(chalk.gray('Run `intelwatch diff <tracker-id>` for details on any tracker.'));
  } else {
    console.log(chalk.green('✓ No significant changes detected across all trackers.'));
  }

  console.log(chalk.gray('\nRun `intelwatch report --format html` for a full report.'));
}
