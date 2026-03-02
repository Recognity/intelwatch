import chalk from 'chalk';
import Table from 'cli-table3';
import { pappersGetFullDossier, pappersSearchByName } from '../scrapers/pappers.js';
import { searchPressMentions } from '../scrapers/brave-search.js';
import { analyzeSite } from '../scrapers/site-analyzer.js';
import { callAI, hasAIKey } from '../ai/client.js';
import { header, section, warn, error } from '../utils/display.js';
import { generatePDF } from '@recognity/pdf-report';

const LICENSE_URL = 'https://recognity.fr/tools/intelwatch';

export async function runMA(sirenOrName, options) {
  const hasLicense = !!process.env.INTELWATCH_LICENSE_KEY;
  const isPreview = !!options.preview;

  // ── License gate ───────────────────────────────────────────────────────────
  if (!hasLicense && !isPreview) {
    console.log(chalk.yellow.bold('\n  ⚡ Deep Profile Due Diligence — Module Premium\n'));
    console.log(chalk.red('  The Deep Profile requires an Intelwatch Deep Profile license.'));
    console.log(chalk.gray(`  Get yours at ${LICENSE_URL}\n`));
    console.log(chalk.gray('  Run with --preview for a limited preview (company identity + last year financials only).'));
    console.log('');
    process.exit(1);
  }

  if (isPreview && !hasLicense) {
    console.log(chalk.yellow('  ⚡ PREVIEW MODE — Company identity + last year financials only'));
    console.log(chalk.gray(`  Upgrade to Intelwatch Deep Profile for full due diligence: ${LICENSE_URL}\n`));
  }

  // ── SIREN or name lookup ───────────────────────────────────────────────────
  let siren = sirenOrName;

  if (!/^\d{9}$/.test(sirenOrName)) {
    console.log(chalk.gray(`  Searching for: "${sirenOrName}"...`));
    const { results, error: searchErr } = await pappersSearchByName(sirenOrName, { count: 1 });
    if (searchErr || !results.length) {
      error(`Company not found: ${searchErr || 'No results'}`);
      process.exit(1);
    }
    siren = results[0].siren;
    const foundName = results[0].nom_entreprise || results[0].denomination;
    console.log(chalk.gray(`  Found: ${foundName} (SIREN: ${siren})`));
  }

  // ── Fetch full dossier ─────────────────────────────────────────────────────
  console.log(chalk.gray('  Fetching dossier from Pappers...'));
  const { data, error: dossierErr } = await pappersGetFullDossier(siren);

  if (dossierErr || !data) {
    error(`Failed to fetch dossier: ${dossierErr || 'Unknown error'}`);
    process.exit(1);
  }

  const { identity, financialHistory, ubo, bodacc, dirigeants, proceduresCollectives } = data;

  // ── Header ─────────────────────────────────────────────────────────────────
  header(`🏢 Due Diligence Deep Profile — ${identity.name || siren}`);

  // ── Company Identity ───────────────────────────────────────────────────────
  section('  📋 Identité');
  const statusColor = identity.status === 'Actif' ? chalk.green : chalk.red;
  printRow('Nom', identity.name);
  printRow('SIREN', identity.siren);
  printRow('SIRET siège', identity.siret);
  printRow('Forme juridique', identity.formeJuridique);
  printRow('Capital', identity.capital != null ? `${formatEuro(identity.capital)} ${identity.capitalMonnaie}` : null);
  printRow('NAF', identity.nafCode ? `${identity.nafCode} — ${identity.nafLabel}` : null);
  printRow('Création', identity.dateCreation);
  printRow('Statut', identity.status, statusColor(identity.status));
  printRow('Effectifs', identity.effectifs);
  printRow('Adresse', [identity.adresse, identity.codePostal, identity.ville].filter(Boolean).join(' ') || null);
  if (identity.website) printRow('Site web', identity.website);

  // ── Preview mode stops here (one year of financials) ──────────────────────
  if (isPreview) {
    const lastFin = financialHistory[0];
    section('  💶 Derniers résultats financiers (preview)');
    if (lastFin) {
      printRow('Année', String(lastFin.annee));
      printRow('Chiffre d\'affaires', lastFin.ca != null ? formatEuro(lastFin.ca) : null);
      printRow('Résultat net', lastFin.resultat != null ? formatEuro(lastFin.resultat) : null);
      printRow('Capitaux propres', lastFin.capitauxPropres != null ? formatEuro(lastFin.capitauxPropres) : null);
    } else {
      console.log(chalk.gray('     Données financières non disponibles.'));
    }
    console.log('');
    console.log(chalk.yellow(`  ⚡ Accédez au rapport complet avec Intelwatch Deep Profile : ${LICENSE_URL}`));
    console.log('');
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //   FULL MODE (licensed users)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Procédures collectives (alert at top if any) ──────────────────────────
  if (proceduresCollectives.length > 0) {
    section('  🚨 Procédures collectives');
    for (const p of proceduresCollectives) {
      const label = [p.type, p.jugement].filter(Boolean).join(' — ');
      const loc = p.tribunal ? ` (${p.tribunal})` : '';
      console.log(chalk.red(`     [${p.date || '?'}] ${label}${loc}`));
    }
  }

  // ── Dirigeants & mandats ───────────────────────────────────────────────────
  if (dirigeants.length > 0) {
    section(`  👔 Dirigeants (${dirigeants.length})`);
    for (const d of dirigeants) {
      const name = [d.prenom, d.nom].filter(Boolean).join(' ');
      console.log('');
      console.log('  ' + chalk.white.bold(name) + chalk.gray(` — ${d.role || '?'}`));
      if (d.dateNomination) console.log(chalk.gray(`     Nommé le    : ${d.dateNomination}`));
      if (d.nationalite) console.log(chalk.gray(`     Nationalité : ${d.nationalite}`));
      if (d.mandats.length > 0) {
        console.log(chalk.gray(`     Mandats (${d.mandats.length}) :`));
        for (const m of d.mandats.slice(0, 6)) {
          const dot = m.etat === 'actif' ? chalk.green('●') : chalk.gray('○');
          const denom = m.denomination || m.siren || '?';
          console.log(chalk.gray(`       ${dot} ${denom} — ${m.role || '?'}`));
        }
        if (d.mandats.length > 6) {
          console.log(chalk.gray(`       ... et ${d.mandats.length - 6} autre(s)`));
        }
      }
    }
    console.log('');
  }

  // ── UBO ───────────────────────────────────────────────────────────────────
  section(`  🔑 Bénéficiaires effectifs — UBO (${ubo.length})`);
  if (ubo.length > 0) {
    for (const b of ubo) {
      const name = [b.prenom, b.nom].filter(Boolean).join(' ');
      const stakes = [];
      if (b.pourcentageParts != null) stakes.push(`${b.pourcentageParts}% parts`);
      if (b.pourcentageVotes != null) stakes.push(`${b.pourcentageVotes}% votes`);
      const stakeStr = stakes.length ? chalk.yellow(` — ${stakes.join(', ')}`) : '';
      console.log('  ' + chalk.white(name) + stakeStr);
      if (b.nationalite) console.log(chalk.gray(`     Nationalité : ${b.nationalite}`));
      if (b.dateNaissance) console.log(chalk.gray(`     Né(e) le    : ${b.dateNaissance}`));
    }
  } else {
    console.log(chalk.gray('     Non disponible ou non déclaré.'));
  }

  // ── Financial history table ────────────────────────────────────────────────
  section('  💶 Historique financier');
  if (financialHistory.length > 0) {
    const table = new Table({
      head: ['Année', 'Chiffre d\'affaires', 'Résultat net', 'Capitaux propres'].map(h => chalk.cyan.bold(h)),
      style: { head: [], border: ['grey'] },
      colAligns: ['left', 'right', 'right', 'right'],
    });
    for (const f of financialHistory) {
      table.push([
        chalk.white(f.annee ?? '—'),
        f.ca != null ? chalk.white(formatEuro(f.ca)) : chalk.gray('—'),
        f.resultat != null
          ? (f.resultat >= 0 ? chalk.green(formatEuro(f.resultat)) : chalk.red(formatEuro(f.resultat)))
          : chalk.gray('—'),
        f.capitauxPropres != null
          ? (f.capitauxPropres >= 0 ? chalk.white(formatEuro(f.capitauxPropres)) : chalk.red(formatEuro(f.capitauxPropres)))
          : chalk.gray('—'),
      ]);
    }
    console.log(table.toString());
  } else {
    console.log(chalk.gray('     Aucune donnée financière disponible.'));
  }

  // ── BODACC publications ────────────────────────────────────────────────────
  if (bodacc.length > 0) {
    section(`  📰 Publications BODACC (${bodacc.length} dernières)`);
    for (const pub of bodacc) {
      const label = pub.description || pub.type || '?';
      const trib = pub.tribunal ? chalk.gray(` — ${pub.tribunal}`) : '';
      console.log(chalk.gray(`     [${pub.date || '?'}] `) + chalk.white(label) + trib);
    }
  }

  // ── Digital footprint ─────────────────────────────────────────────────────
  const websiteUrl = identity.website
    ? (identity.website.startsWith('http') ? identity.website : `https://${identity.website}`)
    : null;

  if (websiteUrl) {
    section('  🌐 Empreinte numérique');
    console.log(chalk.gray(`  Analyzing ${websiteUrl}...`));
    try {
      const siteData = await analyzeSite(websiteUrl);
      if (siteData.error) {
        warn(`     Site non accessible: ${siteData.error}`);
      } else {
        const techNames = (siteData.techStack || []).map(t => t.name).join(', ') || 'aucune détectée';
        printRow('Technologies', techNames);
        if (siteData.performance) {
          printRow('Performance', `${siteData.performance.responseTimeMs}ms, ${siteData.performance.htmlSizeKB} KB`);
        }
        if (siteData.security) {
          const s = siteData.security;
          const score = [s.https, s.hsts, s.xFrameOptions, s.csp, s.xContentType].filter(Boolean).length;
          printRow('Sécurité', `${score}/5 (HTTPS:${s.https ? '✓' : '✗'} HSTS:${s.hsts ? '✓' : '✗'} CSP:${s.csp ? '✓' : '✗'})`);
        }
        if (siteData.socialLinks && Object.keys(siteData.socialLinks).length > 0) {
          printRow('Réseaux sociaux', Object.keys(siteData.socialLinks).join(', '));
        }
        if (siteData.contentStats?.recentArticles?.length > 0) {
          printRow('Blog', `${siteData.contentStats.articleCount} articles récents`);
        }
      }
    } catch (e) {
      warn(`     Impossible d'analyser le site: ${e.message}`);
    }
  }

  // ── Press & mentions ───────────────────────────────────────────────────────
  let pressResults = [];
  if (identity.name) {
    section('  📣 Presse & réputation');
    console.log(chalk.gray(`  Searching mentions for "${identity.name}"...`));
    try {
      const press = await searchPressMentions(identity.name);
      pressResults = press.mentions || [];
      if (press.mentionCount > 0) {
        const bd = press.mentions.reduce((acc, m) => {
          const k = /positive/.test(m.sentiment) ? 'positive'
            : /negative/.test(m.sentiment) ? 'negative' : 'neutral';
          acc[k] = (acc[k] || 0) + 1;
          return acc;
        }, {});
        console.log(chalk.magenta(`     ${press.mentionCount} mentions | 👍${bd.positive || 0} 😐${bd.neutral || 0} 👎${bd.negative || 0}`));
        for (const m of press.mentions.slice(0, 8)) {
          const emoji = /positive/.test(m.sentiment) ? '👍' : /negative/.test(m.sentiment) ? '👎' : '😐';
          console.log(chalk.gray(`     ${emoji} [${m.category}] ${(m.title || '').substring(0, 80)} (${m.domain})`));
        }
      } else {
        console.log(chalk.gray('     Aucune mention récente trouvée.'));
      }
    } catch (e) {
      warn(`     Press search failed: ${e.message}`);
    }
  }

  // ── AI Summary ────────────────────────────────────────────────────────────
  if (options.ai) {
    section('  🤖 Synthèse IA — Due Diligence');
    if (!hasAIKey()) {
      warn('     No AI API key. Set OPENAI_API_KEY or ANTHROPIC_API_KEY.');
    } else {
      console.log(chalk.gray('  Generating AI due diligence summary...'));
      try {
        const finSummary = financialHistory
          .map(f => `${f.annee}: CA=${f.ca != null ? formatEuro(f.ca) : 'N/A'}, Résultat=${f.resultat != null ? formatEuro(f.resultat) : 'N/A'}, CP=${f.capitauxPropres != null ? formatEuro(f.capitauxPropres) : 'N/A'}`)
          .join('\n') || 'Non disponible';

        const dirStr = dirigeants
          .map(d => `${d.prenom || ''} ${d.nom || ''} (${d.role || '?'}): ${d.mandats.length} mandats`)
          .join(', ') || 'Non disponible';

        const uboStr = ubo
          .map(b => `${b.prenom || ''} ${b.nom || ''}: ${b.pourcentageParts ?? '?'}% parts`)
          .join(', ') || 'Non déclaré';

        const procStr = proceduresCollectives.length
          ? proceduresCollectives.map(p => `${p.date || '?'}: ${p.type || '?'}`).join(', ')
          : 'Aucune';

        const systemPrompt = 'Tu es un analyste Deep Profile expert. Rédige une synthèse de due diligence concise et professionnelle en français.';
        const userPrompt = `Synthèse due diligence pour ${identity.name} (SIREN: ${identity.siren})

**Identité**
- Forme: ${identity.formeJuridique || '?'}
- Création: ${identity.dateCreation || '?'}
- Effectifs: ${identity.effectifs || '?'}
- NAF: ${identity.nafCode} — ${identity.nafLabel}
- Capital: ${identity.capital != null ? formatEuro(identity.capital) : '?'}

**Dirigeants**
${dirStr}

**UBO (${ubo.length})**
${uboStr}

**Historique financier**
${finSummary}

**Procédures collectives**
${procStr}

**Publications BODACC récentes**
${bodacc.slice(0, 5).map(b => `${b.date || '?'}: ${b.type || '?'}`).join(', ') || 'Aucune'}

Rédige une synthèse en 5 points : 1) Profil, 2) Gouvernance & actionnariat, 3) Situation financière, 4) Risques identifiés, 5) Points d'attention pour l'acquéreur. Sois factuel, max 400 mots.`;

        const summary = await callAI(systemPrompt, userPrompt, { maxTokens: 600 });
        console.log('\n' + chalk.white(summary) + '\n');
      } catch (e) {
        warn(`     AI summary failed: ${e.message}`);
      }
    }
  }

  // ── PDF export ──────────────────────────────────────────────────────────────
  if (options.format === 'pdf') {
    const outputPath = options.output || `profile-${siren}.pdf`;
    const fmtEuro = (n) => {
      if (n == null) return '—';
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1e9) return `${sign}${(abs/1e9).toFixed(2)}B€`;
      if (abs >= 1e6) return `${sign}${(abs/1e6).toFixed(1)}M€`;
      if (abs >= 1e3) return `${sign}${Math.round(abs/1e3)}K€`;
      return `${sign}${abs}€`;
    };

    const pressMentions = [];
    if (pressResults?.length) {
      pressResults.forEach(m => {
        pressMentions.push({ title: m.title || '', source: m.source || '', sentiment: m.sentiment || 'neutral' });
      });
    }

    const pdfData = {
      aiSummary: null, // filled below if AI was used
      competitors: [{
        name: identity.name || siren,
        url: identity.website || 'N/A',
        tech: [identity.formeJuridique, identity.nafLabel, identity.nafCode].filter(Boolean),
        social: {},
        pappers: {
          siren: identity.siren,
          forme: identity.formeJuridique,
          creation: identity.dateCreation,
          naf: identity.nafCode ? identity.nafCode + ' — ' + identity.nafLabel : null,
          ca: financialHistory?.[0]?.ca != null ? fmtEuro(financialHistory[0].ca) : 'N/A',
          effectifs: identity.effectifs || 'N/A',
          dirigeants: dirigeants?.map(d => d.nom || d.denomination || '?').slice(0, 5) || [],
        },
        press: pressMentions.length ? {
          total: pressMentions.length,
          positive: pressMentions.filter(m => m.sentiment === 'positive').length,
          neutral: pressMentions.filter(m => m.sentiment === 'neutral').length,
          negative: pressMentions.filter(m => m.sentiment === 'negative').length,
          mentions: pressMentions.slice(0, 15),
        } : undefined,
        strengths: [],
        weaknesses: [],
        summary: `${identity.name || siren} — ${identity.formeJuridique || ''}, ${identity.nafLabel || ''}. Created ${identity.dateCreation || '?'}. ${financialHistory?.length ? `Financial history: ${financialHistory.length} years available.` : 'No financial data available.'}`,
      }]
    };

    try {
      await generatePDF({
        type: 'intel-report',
        title: `Deep Profile — ${identity.name || siren}`,
        subtitle: `Company due diligence report · ${new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}`,
        output: outputPath,
        branding: {
          company: 'Recognity',
          footer: 'Powered by Recognity · recognity.fr',
          colors: { primary: '#0a0a0a', accent: '#c8a961' },
        },
        data: pdfData,
      });
      console.log(chalk.green(`\n  ✅ PDF report saved to ${outputPath}\n`));
    } catch (e) {
      warn(`  PDF generation failed: ${e.message}`);
    }
  }

  // ── Footer ─────────────────────────────────────────────────────────────────
  console.log('');
  const today = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
  console.log(chalk.gray(`  Source : Pappers.fr — ${today}`));
  console.log('');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function printRow(label, value, coloredValue) {
  const padded = label.padEnd(16);
  const display = coloredValue ?? (value != null ? chalk.white(value) : chalk.gray('—'));
  console.log(chalk.gray(`     ${padded}: `) + display);
}

function formatNum(n) {
  return Number(n).toLocaleString('fr-FR');
}

function formatEuro(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2).replace('.', ',')} Md€`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',')} M€`;
  if (abs >= 1_000) return `${sign}${formatNum(Math.round(abs / 1_000))} K€`;
  return `${sign}${formatNum(abs)} €`;
}
