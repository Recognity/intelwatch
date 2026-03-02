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
        
        // Performance
        if (snapshot.performance) {
          const p = snapshot.performance;
          console.log(chalk.gray(`  Response: ${p.responseTimeMs}ms | HTML: ${p.htmlSizeKB}KB | Compressed: ${p.compressed ? 'yes' : 'no'}`));
        }

        // Security summary
        if (snapshot.security) {
          const s = snapshot.security;
          const secScore = [s.https, s.hsts, s.xFrameOptions, s.csp, s.xContentType].filter(Boolean).length;
          console.log(chalk.gray(`  Security: ${secScore}/5 (HTTPS:${s.https ? '✓' : '✗'} HSTS:${s.hsts ? '✓' : '✗'} XFO:${s.xFrameOptions ? '✓' : '✗'} CSP:${s.csp ? '✓' : '✗'})`));
        }

        // SEO signals
        if (snapshot.seoSignals) {
          const seo = snapshot.seoSignals;
          console.log(chalk.gray(`  SEO: title=${seo.titleLength}ch | desc=${seo.descriptionLength}ch | H1:${seo.h1Count} H2:${seo.h2Count} | ${seo.imgCount} imgs (${seo.imgWithoutAlt} no alt) | ${seo.wordCount} words`));
        }

        // Key pages found
        if (snapshot.keyPages && Object.keys(snapshot.keyPages).length > 0) {
          const pageLabels = Object.keys(snapshot.keyPages).join(', ');
          console.log(chalk.gray(`  Key pages: ${pageLabels}`));
        }

        // Pricing
        if (snapshot.pricing && snapshot.pricing.prices?.length > 0) {
          console.log(chalk.cyan(`  💰 Pricing detected: ${snapshot.pricing.prices.slice(0, 5).join(', ')}`));
          if (snapshot.pricing.plans?.length > 0) {
            console.log(chalk.gray(`  Plans: ${snapshot.pricing.plans.slice(0, 3).join(' | ')}`));
          }
        }

        // Jobs
        if (snapshot.jobs && snapshot.jobs.estimatedOpenings > 0) {
          console.log(chalk.yellow(`  👥 Jobs: ~${snapshot.jobs.estimatedOpenings} openings detected`));
          if (snapshot.jobs.titles?.length > 0) {
            for (const t of snapshot.jobs.titles.slice(0, 5)) {
              console.log(chalk.gray(`    - ${t}`));
            }
          }
        }

        // Content/blog activity
        if (snapshot.contentStats && snapshot.contentStats.recentArticles?.length > 0) {
          console.log(chalk.green(`  📝 Blog: ${snapshot.contentStats.articleCount} recent articles`));
          for (const a of snapshot.contentStats.recentArticles.slice(0, 3)) {
            const dateStr = a.date ? ` (${a.date})` : '';
            console.log(chalk.gray(`    - ${a.title}${dateStr}`));
          }
        }

        // Social links
        if (snapshot.socialLinks && Object.keys(snapshot.socialLinks).length > 0) {
          const socials = Object.entries(snapshot.socialLinks).map(([k, v]) => k).join(', ');
          console.log(chalk.gray(`  Social: ${socials}`));
        }

        // Press & mentions
        if (snapshot.press && snapshot.press.totalCount > 0) {
          const p = snapshot.press;
          const sentStr = `👍${p.sentimentBreakdown?.positive || 0} 😐${p.sentimentBreakdown?.neutral || 0} 👎${p.sentimentBreakdown?.negative || 0}`;
          console.log(chalk.magenta(`  📰 Press: ${p.totalCount} mentions (${p.pressCount || 0} press, ${p.forumCount || 0} forum/social) | ${sentStr}`));
          for (const a of (p.articles || []).slice(0, 5)) {
            const sentEmoji = a.sentiment === 'positive' || a.sentiment === 'slightly_positive' ? '👍' 
              : a.sentiment === 'negative' || a.sentiment === 'slightly_negative' ? '👎' : '😐';
            console.log(chalk.gray(`    ${sentEmoji} [${a.category}] ${a.title.substring(0, 80)} (${a.domain})`));
          }
        } else if (snapshot.press) {
          console.log(chalk.gray(`  📰 Press: no recent mentions found`));
        }

        // Reputation / reviews
        if (snapshot.reputation) {
          const r = snapshot.reputation;
          if (r.platforms?.length > 0) {
            for (const plat of r.platforms) {
              const ratingStr = plat.rating ? `${plat.rating}/5` : 'n/a';
              const countStr = plat.reviewCount ? `(${plat.reviewCount} avis)` : '';
              console.log(chalk.yellow(`  ⭐ ${plat.name}: ${ratingStr} ${countStr}`));
            }
          }
          if (r.reviews?.length > 0) {
            for (const rev of r.reviews.slice(0, 3)) {
              const sentEmoji = rev.sentiment === 'positive' || rev.sentiment === 'slightly_positive' ? '👍' : '👎';
              console.log(chalk.gray(`    ${sentEmoji} ${rev.title.substring(0, 80)}`));
            }
          }
          if (!r.platforms?.length && !r.reviews?.length) {
            console.log(chalk.gray(`  ⭐ Reputation: no reviews found`));
          }
        }
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
