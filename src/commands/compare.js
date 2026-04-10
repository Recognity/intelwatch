import chalk from 'chalk';
import Table from 'cli-table3';
import { getTracker, loadLatestSnapshot } from '../storage.js';
import { createTable, header, section, error, warn } from '../utils/display.js';
import { isSirenOrSiret } from '../providers/registry.js';
import { annuaireGetFullDossier } from '../scrapers/annuaire-entreprises.js';
import { pappersGetFullDossier, hasPappersKey } from '../scrapers/pappers.js';
import { isPro } from '../license.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatEuro(val) {
  if (val == null) return null;
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(val);
}

function na() {
  return chalk.gray('—');
}

function cellVal(val, formatter) {
  if (val == null) return na();
  return formatter ? formatter(val) : String(val);
}

function resultatCell(val) {
  if (val == null) return na();
  const fmt = formatEuro(val);
  return val >= 0 ? chalk.green(fmt) : chalk.red(fmt);
}

/**
 * Resolve which provider function to use for fetching a full dossier.
 * Mirrors profile.js logic: Pappers (Pro + key) → Annuaire Entreprises (free).
 */
function resolveDossierFetcher() {
  if (isPro() && hasPappersKey()) {
    return { fetch: pappersGetFullDossier, name: 'pappers' };
  }
  return { fetch: annuaireGetFullDossier, name: 'annuaire-entreprises' };
}

/**
 * Fetch a company dossier with Pappers → Annuaire Entreprises fallback.
 * Returns { data, providerName, fromCache } or throws.
 */
async function fetchDossier(siren) {
  const { fetch: fetchFn, name: providerName } = resolveDossierFetcher();
  const result = await fetchFn(siren);

  if (result.error && providerName === 'pappers' && /401|unauthorized|forbidden/i.test(result.error)) {
    // Fallback to Annuaire Entreprises
    const fallback = await annuaireGetFullDossier(siren);
    if (fallback.error || !fallback.data) {
      throw new Error(`Both providers failed: ${result.error} / ${fallback.error}`);
    }
    return { data: fallback.data, providerName: 'annuaire-entreprises', fromCache: fallback.fromCache };
  }

  if (result.error || !result.data) {
    throw new Error(result.error || `No data returned for SIREN ${siren}`);
  }

  return { data: result.data, providerName, fromCache: result.fromCache };
}

// ── Company Profile Comparison ────────────────────────────────────────────────

/**
 * Compare two FR company profiles side-by-side.
 * @param {string} siren1
 * @param {string} siren2
 */
export async function runCompareCompanies(siren1, siren2) {
  // Validate SIREN format
  for (const s of [siren1, siren2]) {
    const cleaned = s.trim();
    if (!/^\d{9}(\d{5})?$/.test(cleaned)) {
      error(`Invalid SIREN/SIRET: ${s}. Expected 9 digits (SIREN) or 14 digits (SIRET).`);
      process.exit(1);
    }
  }

  // Normalize to 9-digit SIREN (strip SIRET establishment digits)
  const s1 = siren1.trim().slice(0, 9);
  const s2 = siren2.trim().slice(0, 9);

  if (s1 === s2) {
    error('Both SIRENs are identical — nothing to compare.');
    process.exit(1);
  }

  header(`📊 Company Comparison: ${s1} vs ${s2}`);

  // ── Fetch both dossiers in parallel ──────────────────────────────────────
  console.log(chalk.gray('  Fetching company profiles...'));

  const [res1, res2] = await Promise.allSettled([
    fetchDossier(s1),
    fetchDossier(s2),
  ]);

  if (res1.status === 'rejected') {
    error(`Failed to fetch ${s1}: ${res1.reason.message}`);
    process.exit(1);
  }
  if (res2.status === 'rejected') {
    error(`Failed to fetch ${s2}: ${res2.reason.message}`);
    process.exit(1);
  }

  const { data: d1, providerName: p1, fromCache: c1 } = res1.value;
  const { data: d2, providerName: p2, fromCache: c2 } = res2.value;

  // Provider info
  const providerLabel = (name, cached) =>
    name === 'annuaire-entreprises'
      ? chalk.cyan('Annuaire Entreprises (data.gouv.fr)')
      : chalk.magenta('Pappers') + (cached ? chalk.gray(' (cache)') : '');

  console.log(chalk.gray(`  Provider 1: ${p1}${c1 ? ' (cache)' : ''}`));
  console.log(chalk.gray(`  Provider 2: ${p2}${c2 ? ' (cache)' : ''}`));

  // ── Identity comparison table ─────────────────────────────────────────────
  const i1 = d1.identity || {};
  const i2 = d2.identity || {};
  const name1 = i1.name || s1;
  const name2 = i2.name || s2;

  // Truncate long names for column headers
  const col1 = name1.length > 30 ? name1.slice(0, 27) + '...' : name1;
  const col2 = name2.length > 30 ? name2.slice(0, 27) + '...' : name2;

  section('\n📋 Identité');
  const identityTable = new Table({
    head: ['Critère', chalk.bold.white(col1), chalk.bold.white(col2)].map(h =>
      typeof h === 'string' && h !== 'Critère' ? h : chalk.cyan.bold(h)
    ),
    style: { head: [], border: ['grey'] },
    colAligns: ['left', 'left', 'left'],
    colWidths: [20, 40, 40],
  });

  const identityRows = [
    ['Nom', i1.name, i2.name],
    ['SIREN', i1.siren, i2.siren],
    ['NAF', i1.nafCode ? `${i1.nafCode} — ${i1.nafLabel || ''}`.trim() : null,
              i2.nafCode ? `${i2.nafCode} — ${i2.nafLabel || ''}`.trim() : null],
    ['Forme juridique', i1.formeJuridique, i2.formeJuridique],
    ['Date création', i1.dateCreation, i2.dateCreation],
    ['Capital', i1.capital != null ? formatEuro(i1.capital) : null,
               i2.capital != null ? formatEuro(i2.capital) : null],
    ['Effectifs', i1.effectifs, i2.effectifs],
    ['Statut', i1.status, i2.status],
    ['Ville', i1.ville, i2.ville],
  ];

  for (const [label, v1, v2] of identityRows) {
    // Color-code status
    let c1 = cellVal(v1);
    let c2 = cellVal(v2);
    if (label === 'Statut') {
      c1 = v1 === 'Actif' ? chalk.green(v1) : (v1 ? chalk.red(v1) : na());
      c2 = v2 === 'Actif' ? chalk.green(v2) : (v2 ? chalk.red(v2) : na());
    }
    identityTable.push([chalk.white(label), c1, c2]);
  }
  console.log(identityTable.toString());

  // ── Financial comparison table ─────────────────────────────────────────────
  const f1 = (d1.financialHistory || []).slice(0, 5);
  const f2 = (d2.financialHistory || []).slice(0, 5);

  if (f1.length > 0 || f2.length > 0) {
    section('\n💶 Historique financier');
    const finTable = new Table({
      head: ['Année', chalk.bold.white(col1), '', chalk.bold.white(col2), ''].map((h, i) =>
        i === 0 ? chalk.cyan.bold(h) : h
      ),
      style: { head: [], border: ['grey'] },
      colAligns: ['left', 'right', 'right', 'right', 'right'],
    });

    // Merge years from both companies
    const allYears = [...new Set([
      ...f1.map(f => f.annee),
      ...f2.map(f => f.annee),
    ])].sort((a, b) => b - a);

    const f1Map = Object.fromEntries(f1.map(f => [f.annee, f]));
    const f2Map = Object.fromEntries(f2.map(f => [f.annee, f]));

    for (const year of allYears) {
      const a = f1Map[year] || {};
      const b = f2Map[year] || {};

      finTable.push([
        chalk.white(year),
        a.ca != null ? chalk.white(formatEuro(a.ca)) : na(),
        a.resultat != null ? resultatCell(a.resultat) : na(),
        b.ca != null ? chalk.white(formatEuro(b.ca)) : na(),
        b.resultat != null ? resultatCell(b.resultat) : na(),
      ]);
    }

    console.log(finTable.toString());
    console.log(chalk.gray('  (CA | Résultat net) par année — vert = positif, rouge = négatif'));
  }

  // ── Latest financials snapshot (clean side-by-side) ────────────────────────
  const last1 = f1[0] || {};
  const last2 = f2[0] || {};

  section('\n💶 Dernier exercice');
  const lastFinTable = new Table({
    head: ['Indicateur', chalk.bold.white(col1), chalk.bold.white(col2)].map(h =>
      typeof h === 'string' && !['Chiffre d\'affaires', 'Résultat net', 'Capitaux propres', 'Indicateur'].includes(h)
        ? h : chalk.cyan.bold(h)
    ),
    style: { head: [], border: ['grey'] },
    colAligns: ['left', 'right', 'right'],
  });

  lastFinTable.push([
    chalk.white('Année'),
    cellVal(last1.annee),
    cellVal(last2.annee),
  ]);
  lastFinTable.push([
    chalk.white('Chiffre d\'affaires'),
    cellVal(last1.ca, formatEuro),
    cellVal(last2.ca, formatEuro),
  ]);
  lastFinTable.push([
    chalk.white('Résultat net'),
    resultatCell(last1.resultat),
    resultatCell(last2.resultat),
  ]);
  lastFinTable.push([
    chalk.white('Capitaux propres'),
    last1.capitauxPropres != null ? (last1.capitauxPropres >= 0 ? chalk.white(formatEuro(last1.capitauxPropres)) : chalk.red(formatEuro(last1.capitauxPropres))) : na(),
    last2.capitauxPropres != null ? (last2.capitauxPropres >= 0 ? chalk.white(formatEuro(last2.capitauxPropres)) : chalk.red(formatEuro(last2.capitauxPropres))) : na(),
  ]);
  console.log(lastFinTable.toString());

  // ── Dirigeants comparison ─────────────────────────────────────────────────
  const dir1 = d1.dirigeants || [];
  const dir2 = d2.dirigeants || [];

  section('\n👔 Dirigeants');
  const dirTable = new Table({
    head: [chalk.cyan.bold('Rôle'), chalk.bold.white(col1), chalk.bold.white(col2)],
    style: { head: [], border: ['grey'] },
    colAligns: ['left', 'left', 'left'],
    colWidths: [20, 40, 40],
  });

  // Show all dirigeants with their roles
  const maxDir = Math.max(dir1.length, dir2.length, 1);
  for (let i = 0; i < maxDir; i++) {
    const d1p = dir1[i] || {};
    const d2p = dir2[i] || {};
    const role1 = d1p.role || '';
    const role2 = d2p.role || '';
    const name1str = d1p.nom ? [d1p.prenom, d1p.nom].filter(Boolean).join(' ') : '';
    const name2str = d2p.nom ? [d2p.prenom, d2p.nom].filter(Boolean).join(' ') : '';

    if (!name1str && !name2str) continue;

    dirTable.push([
      chalk.white(role1 || role2 || `Dirigeant ${i + 1}`),
      name1str ? chalk.white(name1str) : na(),
      name2str ? chalk.white(name2str) : na(),
    ]);
  }

  if (dir1.length === 0 && dir2.length === 0) {
    console.log(chalk.gray('  Aucun dirigeant connu pour les deux entreprises.'));
  } else {
    console.log(dirTable.toString());
  }

  // ── Delta indicators ───────────────────────────────────────────────────────
  if (last1.ca != null && last2.ca != null && last1.ca !== 0 && last2.ca !== 0) {
    section('\n📈 Indicateurs différentiels');
    const ratio = (last1.ca / last2.ca);
    const leader = last1.ca >= last2.ca ? name1 : name2;
    const ratioStr = ratio >= 1
      ? `${(ratio).toFixed(2)}x plus grand`
      : `${(1/ratio).toFixed(2)}x plus petit`;

    console.log(chalk.white(`  CA: ${leader} est ${ratioStr} en chiffre d'affaires.`));

    if (last1.resultat != null && last2.resultat != null) {
      const marge1 = last1.ca !== 0 ? ((last1.resultat / last1.ca) * 100).toFixed(1) : null;
      const marge2 = last2.ca !== 0 ? ((last2.resultat / last2.ca) * 100).toFixed(1) : null;
      if (marge1 && marge2) {
        const m1Color = parseFloat(marge1) >= 0 ? chalk.green : chalk.red;
        const m2Color = parseFloat(marge2) >= 0 ? chalk.green : chalk.red;
        console.log(chalk.white(`  Marge nette: ${name1} ${m1Color(marge1 + '%')} | ${name2} ${m2Color(marge2 + '%')}`));
      }
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  console.log('');
  const providerNote = p1 === 'annuaire-entreprises' || p2 === 'annuaire-entreprises'
    ? chalk.gray('  Données issues de l\'Annuaire Entreprises (data.gouv.fr) — gratuites mais limitées.\n  Configurez PAPPERS_API_KEY pour des données complètes (UBO, BODACC, mandats).')
    : '';
  if (providerNote) console.log(providerNote);
  console.log('');
}

// ── Tracker Comparison (original) ────────────────────────────────────────────

export function runCompare(id1, id2) {
  // Detect SIREN/SIRET arguments → company comparison
  if (isSirenOrSiret(id1) && isSirenOrSiret(id2)) {
    return runCompareCompanies(id1, id2);
  }

  // If one is SIREN and the other is not → error
  if (isSirenOrSiret(id1) || isSirenOrSiret(id2)) {
    error('Both arguments must be SIREN/SIRET for company comparison, or tracker IDs for web tracker comparison.');
    process.exit(1);
  }

  // ── Original tracker comparison ──────────────────────────────────────────
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
