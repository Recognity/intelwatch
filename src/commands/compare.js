import chalk from 'chalk';
import { getTracker, loadLatestSnapshot } from '../storage.js';
import { createTable, header, section, error, warn } from '../utils/display.js';

export function runCompare(id1, id2) {
  const tracker1 = getTracker(id1);
  const tracker2 = getTracker(id2);

  if (!tracker1) { error(`Tracker not found: ${id1}`); process.exit(1); }
  if (!tracker2) { error(`Tracker not found: ${id2}`); process.exit(1); }

  if (tracker1.type !== 'competitor' || tracker2.type !== 'competitor') {
    error('compare only works with competitor trackers.');
    process.exit(1);
  }

  const snap1 = loadLatestSnapshot(id1);
  const snap2 = loadLatestSnapshot(id2);

  if (!snap1) { warn(`No snapshot for ${id1}. Run check first.`); return; }
  if (!snap2) { warn(`No snapshot for ${id2}. Run check first.`); return; }

  const name1 = tracker1.name || tracker1.url;
  const name2 = tracker2.name || tracker2.url;

  header(`🔄 Compare: ${name1} vs ${name2}`);

  // Overview table
  section('\nOverview:');
  const overviewTable = createTable(['Metric', name1.slice(0, 25), name2.slice(0, 25)]);

  overviewTable.push([
    'Pages found',
    String(snap1.pageCount || 0),
    String(snap2.pageCount || 0),
  ]);
  overviewTable.push([
    'Tech stack',
    String((snap1.techStack || []).length),
    String((snap2.techStack || []).length),
  ]);
  overviewTable.push([
    'Social links',
    String(Object.keys(snap1.socialLinks || {}).length),
    String(Object.keys(snap2.socialLinks || {}).length),
  ]);
  overviewTable.push([
    'Open jobs',
    snap1.jobs ? String(snap1.jobs.estimatedOpenings) : chalk.gray('?'),
    snap2.jobs ? String(snap2.jobs.estimatedOpenings) : chalk.gray('?'),
  ]);
  overviewTable.push([
    'Pricing detected',
    snap1.pricing ? chalk.green('yes') : chalk.gray('no'),
    snap2.pricing ? chalk.green('yes') : chalk.gray('no'),
  ]);
  overviewTable.push([
    'Last checked',
    snap1.checkedAt ? new Date(snap1.checkedAt).toLocaleDateString() : chalk.gray('?'),
    snap2.checkedAt ? new Date(snap2.checkedAt).toLocaleDateString() : chalk.gray('?'),
  ]);

  console.log(overviewTable.toString());

  // Tech stack diff
  section('\nTech Stack:');
  const techTable = createTable(['Technology', 'Category', name1.slice(0, 20), name2.slice(0, 20)]);

  const tech1Names = new Set((snap1.techStack || []).map(t => t.name));
  const tech2Names = new Set((snap2.techStack || []).map(t => t.name));
  const allTechs = [...new Set([...(snap1.techStack || []), ...(snap2.techStack || [])].map(t => JSON.stringify(t)))].map(t => JSON.parse(t));

  for (const tech of allTechs) {
    techTable.push([
      tech.name,
      chalk.gray(tech.category),
      tech1Names.has(tech.name) ? chalk.green('✓') : chalk.gray('—'),
      tech2Names.has(tech.name) ? chalk.green('✓') : chalk.gray('—'),
    ]);
  }

  if (allTechs.length === 0) {
    console.log(chalk.gray('  No tech detected for either tracker yet.'));
  } else {
    console.log(techTable.toString());
  }

  // Social links diff
  section('\nSocial Links:');
  const allPlatforms = new Set([
    ...Object.keys(snap1.socialLinks || {}),
    ...Object.keys(snap2.socialLinks || {}),
  ]);

  if (allPlatforms.size > 0) {
    const socialTable = createTable(['Platform', name1.slice(0, 25), name2.slice(0, 25)]);
    for (const platform of allPlatforms) {
      socialTable.push([
        platform,
        snap1.socialLinks?.[platform] ? chalk.green('✓') : chalk.gray('—'),
        snap2.socialLinks?.[platform] ? chalk.green('✓') : chalk.gray('—'),
      ]);
    }
    console.log(socialTable.toString());
  } else {
    console.log(chalk.gray('  No social links detected.'));
  }

  // Pricing comparison
  section('\nPricing:');
  if (snap1.pricing?.prices?.length || snap2.pricing?.prices?.length) {
    console.log(chalk.bold(`  ${name1}:`), (snap1.pricing?.prices || []).slice(0, 5).join(', ') || chalk.gray('none'));
    console.log(chalk.bold(`  ${name2}:`), (snap2.pricing?.prices || []).slice(0, 5).join(', ') || chalk.gray('none'));
  } else {
    console.log(chalk.gray('  No pricing data detected.'));
  }

  // Homepage meta
  section('\nHomepage Meta:');
  const meta1 = snap1.keyPages?.['/'];
  const meta2 = snap2.keyPages?.['/'];
  console.log(chalk.bold(`  ${name1}: `) + chalk.gray((meta1?.title || '').slice(0, 70)));
  console.log(chalk.bold(`  ${name2}: `) + chalk.gray((meta2?.title || '').slice(0, 70)));
}
