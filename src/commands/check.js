import chalk from 'chalk';
import {
  loadTrackers, updateTracker, saveSnapshot, loadLatestSnapshot
} from '../storage.js';
import { runCompetitorCheck, diffCompetitorSnapshots } from '../trackers/competitor.js';
import { runKeywordCheck, diffKeywordSnapshots } from '../trackers/keyword.js';
import { runBrandCheck, diffBrandSnapshots } from '../trackers/brand.js';
import { runPersonCheck, diffPersonSnapshots } from '../trackers/person.js';
import { header, section, diffLine, success, warn, error, trackerTypeIcon } from '../utils/display.js';
import { exportToJSON, exportToCSV, formatForExport } from '../utils/export.js';
import { setLanguage, getLanguage } from '../utils/i18n.js';

export async function runCheck(options = {}) {
  // Set language from global option
  if (options.parent?.opts()?.lang) {
    setLanguage(options.parent.opts().lang);
  }

  const trackers = loadTrackers();
  const results = []; // Pour l'export

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
    const result = {
      trackerId: tracker.id,
      name: tracker.name || tracker.url,
      url: tracker.url,
      type: tracker.type,
      status: 'unknown',
      changes: [],
      snapshot: null,
      error: null,
      checkedAt: new Date().toISOString()
    };
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
      } else if (tracker.type === 'person') {
        snapshot = await runPersonCheck(tracker);
        changes = diffPersonSnapshots(prevSnapshot, snapshot);
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

      // Update result data
      result.status = snapshot.error ? 'error' : 'success';
      result.changes = changes;
      result.snapshot = snapshot;
      result.techStack = snapshot.techStack;
      result.seoScore = snapshot.seoSignals?.score;
      result.sentiment = snapshot.sentiment;

      if (snapshot.error) {
        warn(`  Error: ${snapshot.error}`);
        result.error = snapshot.error;
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
        if (snapshot.socialMentions && Object.keys(snapshot.socialMentions).length > 0) {
          const socialParts = Object.entries(snapshot.socialMentions)
            .filter(([, arr]) => arr.length > 0)
            .map(([platform, arr]) => {
              const icon = platform === 'twitter' ? 'X' : platform === 'reddit' ? 'Reddit' : 'LinkedIn';
              return `${icon}(${arr.length})`;
            });
          if (socialParts.length > 0) {
            console.log(chalk.cyan(`  📱 Social: ${socialParts.join(' ')}`));
          }
        }
      }

      if (tracker.type === 'person') {
        const s = snapshot;
        const sent = s.sentimentBreakdown || {};
        const sentStr = `👍${sent.positive || 0} 😐${sent.neutral || 0} 👎${sent.negative || 0}`;
        console.log(chalk.magenta(`  👤 ${s.personName}: ${s.mentionCount} mentions | ${sentStr}`));
        if (s.org) console.log(chalk.gray(`  Org filter: ${s.org}`));

        // Social mentions summary
        if (s.socialMentions && Object.keys(s.socialMentions).length > 0) {
          const socialParts = Object.entries(s.socialMentions)
            .filter(([, arr]) => arr.length > 0)
            .map(([platform, arr]) => {
              const icon = platform === 'twitter' ? 'X' : platform === 'reddit' ? 'Reddit' : 'LinkedIn';
              return `${icon}(${arr.length})`;
            });
          if (socialParts.length > 0) {
            console.log(chalk.cyan(`  📱 Social: ${socialParts.join(' ')}`));
          }
        }

        // Top mentions
        for (const m of (s.mentions || []).slice(0, 5)) {
          const sentEmoji = m.sentiment === 'positive' || m.sentiment === 'slightly_positive' ? '👍'
            : m.sentiment === 'negative' || m.sentiment === 'slightly_negative' ? '👎' : '😐';
          console.log(chalk.gray(`    ${sentEmoji} [${m.category}] ${m.title?.substring(0, 80)} (${m.domain})`));
        }
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
          const validPlatforms = (r.platforms || []).filter(p => p.rating);
          if (validPlatforms.length > 0) {
            const platStr = validPlatforms.map(p => {
              const countStr = p.reviewCount ? ` (${p.reviewCount} avis)` : '';
              return `${p.name}: ${p.rating}/5${countStr}`;
            }).join(' | ');
            console.log(chalk.yellow(`  ⭐ ${platStr}`));
          }
          const validReviews = (r.reviews || []).filter(rev => rev.title && rev.title.length > 10);
          if (validReviews.length > 0) {
            for (const rev of validReviews.slice(0, 3)) {
              const sentEmoji = rev.sentiment === 'positive' || rev.sentiment === 'slightly_positive' ? '👍' : '👎';
              console.log(chalk.gray(`    ${sentEmoji} ${rev.title.substring(0, 80)}`));
            }
          }
          if (!validPlatforms.length && !validReviews.length) {
            console.log(chalk.gray(`  ⭐ Reputation: no ratings found`));
          }
        }

        // Pappers (French company data)
        if (snapshot.pappers) {
          const p = snapshot.pappers;
          const parts = [`SIREN: ${p.siren || '?'}`];
          if (p.formeJuridique) parts.push(p.formeJuridique);
          if (p.dateCreation) parts.push(`créée ${p.dateCreation}`);
          if (p.city) parts.push(p.city);
          console.log(chalk.blue(`  🏛  Pappers: ${parts.join(' · ')}`));
          if (p.effectifs) console.log(chalk.gray(`     Effectifs: ${p.effectifs}`));
          if (p.ca) {
            const caStr = p.ca >= 1_000_000 ? `${(p.ca / 1_000_000).toFixed(1)}M€` : `${(p.ca / 1000).toFixed(0)}K€`;
            console.log(chalk.gray(`     CA: ${caStr}${p.caYear ? ` (${p.caYear})` : ''}`));
          }
          if (p.nafCode) console.log(chalk.gray(`     NAF: ${p.nafCode}${p.nafLabel ? ` — ${p.nafLabel}` : ''}`));
          if (p.dirigeants?.length > 0) {
            const dirs = p.dirigeants.slice(0, 3).map(d => `${d.prenom || ''} ${d.nom || ''} (${d.role || '?'})`).join(', ');
            console.log(chalk.gray(`     Dirigeants: ${dirs}`));
          }
        }
      }

    } catch (err) {
      error(`  Failed: ${err.message}`);
      updateTracker(tracker.id, { status: 'error', lastError: err.message });
      result.status = 'error';
      result.error = err.message;
    }
    
    results.push(result);
  }

  console.log('');
  if (totalChanges > 0) {
    success(`${totalChanges} total change(s) detected across ${toCheck.length} tracker(s).`);
  } else {
    console.log(chalk.gray('No changes detected.'));
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  if (options.export) {
    try {
      const formatted = formatForExport(results, 'check');
      
      if (options.export.toLowerCase() === 'json') {
        const result = exportToJSON(formatted, options.output);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else if (options.export.toLowerCase() === 'csv') {
        const result = exportToCSV(formatted, options.output);
        console.log(chalk.green(`\n  ✅ ${result}\n`));
      } else {
        console.log(chalk.yellow(`\n  ⚠️  Unsupported export format: ${options.export}. Use 'json' or 'csv'.\n`));
      }
    } catch (e) {
      console.error(chalk.red(`\n  ❌ Export failed: ${e.message}\n`));
    }
  }
}
