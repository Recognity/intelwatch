import { Command } from 'commander';
import { trackCompetitor, trackKeyword, trackBrand, trackPerson } from './commands/track.js';
import { runDiscover } from './commands/discover.js';
import { runCheck } from './commands/check.js';
import { runDigest } from './commands/digest.js';
import { runDiff } from './commands/diff.js';
import { runReport } from './commands/report.js';
import { runHistory } from './commands/history.js';
import { runCompare } from './commands/compare.js';
import { setupNotifications } from './commands/notify.js';
import { listTrackers, removeTrackerCmd } from './commands/list.js';
import { runAISummary } from './commands/ai-summary.js';
import { runPitch } from './commands/pitch.js';

const program = new Command();

program
  .name('intelwatch')
  .description('Competitive intelligence CLI — track competitors, keywords, and brand mentions from the terminal')
  .version('1.0.0');

// ─── track ────────────────────────────────────────────────────────────────────

const track = program.command('track')
  .description('Add a new tracker');

track
  .command('competitor <url>')
  .description('Track a competitor website')
  .option('--name <alias>', 'Friendly name for this competitor')
  .action(async (url, options) => {
    await trackCompetitor(url, options);
  });

track
  .command('keyword <keyword>')
  .description('Track keyword rankings in Google SERP')
  .option('--engine <engine>', 'Search engine (google)', 'google')
  .action(async (keyword, options) => {
    await trackKeyword(keyword, options);
  });

track
  .command('brand <name>')
  .description('Track brand mentions across the web')
  .action(async (name, options) => {
    await trackBrand(name, options);
  });

track
  .command('person <name>')
  .description('Track press mentions and social presence for a person or public figure')
  .option('--org <org>', 'Filter results by organization affiliation (for disambiguation)')
  .action(async (name, options) => {
    await trackPerson(name, options);
  });

// ─── list ─────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all active trackers')
  .action(() => {
    listTrackers();
  });

// ─── remove ───────────────────────────────────────────────────────────────────

program
  .command('remove <tracker-id>')
  .description('Remove a tracker')
  .action((id) => {
    removeTrackerCmd(id);
  });

// ─── check ────────────────────────────────────────────────────────────────────

program
  .command('check')
  .description('Run checks for all (or one) tracker(s)')
  .option('--tracker <id>', 'Only check this specific tracker')
  .action(async (options) => {
    await runCheck(options);
  });

// ─── digest ───────────────────────────────────────────────────────────────────

program
  .command('digest')
  .description('Show a summary of all changes across all trackers')
  .action(async () => {
    await runDigest();
  });

// ─── diff ─────────────────────────────────────────────────────────────────────

program
  .command('diff <tracker-id>')
  .description('Show detailed diff for one tracker')
  .option('--days <n>', 'Compare with snapshot from N days ago')
  .action(async (trackerId, options) => {
    await runDiff(trackerId, options);
  });

// ─── report ───────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Generate a full intelligence report')
  .option('--format <format>', 'Output format: md, html, json', 'md')
  .option('--output <file>', 'Write report to file')
  .action(async (options) => {
    await runReport(options);
  });

// ─── history ──────────────────────────────────────────────────────────────────

program
  .command('history <tracker-id>')
  .description('Show historical snapshots for a tracker')
  .option('--limit <n>', 'Number of snapshots to show', '20')
  .action((trackerId, options) => {
    runHistory(trackerId, options);
  });

// ─── compare ──────────────────────────────────────────────────────────────────

program
  .command('compare <tracker1> <tracker2>')
  .description('Side-by-side comparison of two competitor trackers')
  .action((id1, id2) => {
    runCompare(id1, id2);
  });

// ─── ai-summary ───────────────────────────────────────────────────────────────

program
  .command('ai-summary')
  .description('Generate an AI-powered intelligence brief for all competitor trackers')
  .option('--tracker <id>', 'Only summarize this specific tracker')
  .action(async (options) => {
    await runAISummary(options);
  });

// ─── pitch ────────────────────────────────────────────────────────────────────

program
  .command('pitch <tracker-id>')
  .description('Generate a sales-ready competitive pitch document')
  .option('--for <your-site>', 'Your product or site name', 'your product')
  .option('--format <format>', 'Output format: md, html', 'md')
  .option('--output <file>', 'Save pitch to file')
  .action(async (trackerId, options) => {
    await runPitch(trackerId, options);
  });

// ─── discover ─────────────────────────────────────────────────────────────────

program
  .command('discover <url>')
  .description('Discover competitors for a given URL using web search and AI scoring')
  .option('--auto-track', 'Automatically create competitor trackers for top 5 results')
  .option('--ai', 'Use AI for smarter query generation and relevance scoring (requires API key)')
  .action(async (url, options) => {
    await runDiscover(url, options);
  });

// ─── notify ───────────────────────────────────────────────────────────────────

program
  .command('notify')
  .description('Configure notifications')
  .option('--setup', 'Interactive notification setup')
  .action(async (options) => {
    if (options.setup) {
      await setupNotifications(options);
    } else {
      console.log('Use `intelwatch notify --setup` to configure notifications.');
    }
  });

export { program };
