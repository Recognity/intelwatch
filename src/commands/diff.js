import chalk from 'chalk';
import { getTracker, listSnapshots, loadSnapshot } from '../storage.js';
import { diffCompetitorSnapshots } from '../trackers/competitor.js';
import { diffKeywordSnapshots } from '../trackers/keyword.js';
import { diffBrandSnapshots } from '../trackers/brand.js';
import { header, section, diffLine, warn, error, trackerTypeIcon } from '../utils/display.js';

export async function runDiff(trackerId, options) {
  const tracker = getTracker(trackerId);

  if (!tracker) {
    error(`Tracker not found: ${trackerId}`);
    console.log(chalk.gray('Use `intelwatch list` to see all tracker IDs.'));
    process.exit(1);
  }

  const snapshots = listSnapshots(trackerId);

  if (snapshots.length === 0) {
    warn(`No snapshots for tracker: ${trackerId}`);
    console.log(chalk.gray('Run `intelwatch check` first.'));
    return;
  }

  let prevSnapshot, currSnapshot;

  if (options.days) {
    const daysMs = parseInt(options.days) * 24 * 60 * 60 * 1000;
    const targetTime = Date.now() - daysMs;

    // Find snapshot closest to targetTime
    const targetSnap = snapshots.reduce((best, snap) => {
      return Math.abs(snap.timestamp - targetTime) < Math.abs(best.timestamp - targetTime) ? snap : best;
    });

    prevSnapshot = loadSnapshot(targetSnap.filepath);
    currSnapshot = loadSnapshot(snapshots[snapshots.length - 1].filepath);
  } else {
    currSnapshot = loadSnapshot(snapshots[snapshots.length - 1].filepath);
    prevSnapshot = snapshots.length > 1
      ? loadSnapshot(snapshots[snapshots.length - 2].filepath)
      : null;
  }

  const target = tracker.name || tracker.keyword || tracker.brandName || trackerId;
  header(`${trackerTypeIcon(tracker.type)} Diff: ${target}`);

  if (options.days) {
    console.log(chalk.gray(`  Comparing with snapshot from ${options.days} day(s) ago`));
  } else {
    console.log(chalk.gray(`  Comparing last 2 snapshots`));
  }

  const prevDate = prevSnapshot ? new Date(prevSnapshot.checkedAt).toLocaleString() : 'N/A';
  const currDate = new Date(currSnapshot.checkedAt).toLocaleString();
  console.log(chalk.gray(`  Before: ${prevDate}`));
  console.log(chalk.gray(`  After:  ${currDate}`));
  console.log('');

  let changes = [];
  if (tracker.type === 'competitor') {
    changes = diffCompetitorSnapshots(prevSnapshot, currSnapshot);
  } else if (tracker.type === 'keyword') {
    changes = diffKeywordSnapshots(prevSnapshot, currSnapshot);
  } else if (tracker.type === 'brand') {
    changes = diffBrandSnapshots(prevSnapshot, currSnapshot);
  }

  if (changes.length === 0) {
    console.log(chalk.green('✓ No changes between these snapshots.'));
    return;
  }

  // Group changes by type
  const newChanges = changes.filter(c => c.type === 'new');
  const changedChanges = changes.filter(c => c.type === 'changed');
  const removedChanges = changes.filter(c => c.type === 'removed');

  if (newChanges.length > 0) {
    section('  New:');
    for (const c of newChanges) {
      console.log('  ' + diffLine('new', c.field, c.value));
    }
  }

  if (changedChanges.length > 0) {
    section('  Changed:');
    for (const c of changedChanges) {
      console.log('  ' + diffLine('changed', c.field, c.value));
    }
  }

  if (removedChanges.length > 0) {
    section('  Removed:');
    for (const c of removedChanges) {
      console.log('  ' + diffLine('removed', c.field, c.value));
    }
  }

  console.log('');
  console.log(chalk.gray(`Total: ${changes.length} change(s)`));

  // Detailed output for specific types
  if (tracker.type === 'keyword' && currSnapshot.results?.length > 0) {
    section('\n  Current Rankings:');
    for (const r of currSnapshot.results.slice(0, 10)) {
      const star = r.isFeaturedSnippet ? chalk.yellow(' ⭐ Featured') : '';
      console.log(chalk.gray(`  #${String(r.position).padEnd(3)}`), chalk.white(r.domain.padEnd(30)), chalk.gray(r.title?.slice(0, 40) || '') + star);
    }
  }

  if (tracker.type === 'competitor' && currSnapshot.techStack?.length > 0) {
    section('\n  Current Tech Stack:');
    for (const tech of currSnapshot.techStack) {
      console.log(chalk.gray(`  • ${tech.name}`), chalk.gray(`[${tech.category}]`));
    }
  }
}
