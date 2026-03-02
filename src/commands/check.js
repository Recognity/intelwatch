import chalk from 'chalk';
import {
  loadTrackers, updateTracker, saveSnapshot, loadLatestSnapshot
} from '../storage.js';
import { runCompetitorCheck, diffCompetitorSnapshots } from '../trackers/competitor.js';
import { runKeywordCheck, diffKeywordSnapshots } from '../trackers/keyword.js';
import { runBrandCheck, diffBrandSnapshots } from '../trackers/brand.js';
import { header, section, diffLine, success, warn, error, trackerTypeIcon } from '../utils/display.js';

export async function runCheck(options) {
  const trackers = loadTrackers();

  if (trackers.length === 0) {
    warn('No trackers configured. Use `intelwatch track` to add one.');
    return;
  }

  const toCheck = options.tracker
    ? trackers.filter(t => t.id === options.tracker)
    : trackers;

  if (options.tracker && toCheck.length === 0) {
    error(`Tracker not found: ${options.tracker}`);
    process.exit(1);
  }

  let totalChanges = 0;

  for (const tracker of toCheck) {
    header(`${trackerTypeIcon(tracker.type)} ${tracker.name || tracker.keyword || tracker.brandName} [${tracker.id}]`);

    try {
      const prevSnapshot = loadLatestSnapshot(tracker.id);

      let snapshot;
      let changes = [];

      console.log(chalk.gray(`  Checking ${tracker.url || tracker.keyword || tracker.brandName}...`));

      if (tracker.type === 'competitor') {
        snapshot = await runCompetitorCheck(tracker);
        changes = diffCompetitorSnapshots(prevSnapshot, snapshot);
      } else if (tracker.type === 'keyword') {
        snapshot = await runKeywordCheck(tracker);
        changes = diffKeywordSnapshots(prevSnapshot, snapshot);
      } else if (tracker.type === 'brand') {
        snapshot = await runBrandCheck(tracker);
        changes = diffBrandSnapshots(prevSnapshot, snapshot);
      }

      // Save snapshot
      snapshot.changes = changes;
      const filepath = saveSnapshot(tracker.id, snapshot);

      updateTracker(tracker.id, {
        lastCheckedAt: new Date().toISOString(),
        lastSnapshotPath: filepath,
        status: snapshot.error ? 'error' : 'active',
        checkCount: (tracker.checkCount || 0) + 1,
      });

      if (snapshot.error) {
        warn(`  Error: ${snapshot.error}`);
      } else {
        success(`  Check complete`);
      }

      if (changes.length === 0) {
        console.log(chalk.gray('  No changes detected.'));
      } else {
        section('  Changes:');
        for (const change of changes) {
          console.log('  ' + diffLine(change.type, change.field, change.value));
        }
        totalChanges += changes.length;
      }

      // Show brief summary for keyword/brand
      if (tracker.type === 'keyword' && snapshot.results?.length > 0) {
        section('  Top 5 results:');
        for (const r of snapshot.results.slice(0, 5)) {
          const star = r.isFeaturedSnippet ? chalk.yellow(' ⭐') : '';
          console.log(chalk.gray(`  #${r.position}`), chalk.white(r.domain) + star);
        }
      }

      if (tracker.type === 'brand') {
        console.log(chalk.gray(`  ${snapshot.mentionCount} mentions found`));
      }

      if (tracker.type === 'competitor') {
        const techNames = (snapshot.techStack || []).map(t => t.name).join(', ') || 'none detected';
        console.log(chalk.gray(`  Tech: ${techNames}`));
        console.log(chalk.gray(`  Pages: ${snapshot.pageCount}`));
      }

    } catch (err) {
      error(`  Failed: ${err.message}`);
      updateTracker(tracker.id, { status: 'error', lastError: err.message });
    }
  }

  console.log('');
  if (totalChanges > 0) {
    success(`${totalChanges} total change(s) detected across ${toCheck.length} tracker(s).`);
  } else {
    console.log(chalk.gray('No changes detected.'));
  }
}
