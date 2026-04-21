import chalk from 'chalk';
import Table from 'cli-table3';
import { header, section, warn } from '../../utils/display.js';
import { t } from '../../utils/i18n.js';
import { printRow, formatEuro } from './helpers.js';

/**
 * Render the preview/fallback mode (identity + last year financials).
 */
export function renderPreview(data, { isFallbackProvider }) {
  const { identity, financialHistory, dirigeants } = data;
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
  if (isFallbackProvider) {
    console.log(chalk.cyan('  ℹ Profil issu de l\'Annuaire Entreprises (data.gouv.fr) — données gratuites.'));
    console.log(chalk.gray('    Pour les données complètes (UBO, BODACC, procédures, mandats), configurez le serveur MCP Pappers.'));
  } else {
    console.log(chalk.yellow(`  ⚡ Accédez au rapport complet avec Intelwatch Deep Profile`));
  }
  console.log('');

  if (isFallbackProvider && dirigeants.length > 0) {
    section(`  👔 Dirigeants (${dirigeants.length})`);
    for (const d of dirigeants) {
      const name = [d.prenom, d.nom].filter(Boolean).join(' ');
      console.log('');
      console.log('  ' + chalk.white.bold(name) + chalk.gray(` — ${d.role || '?'}`));
    }
    console.log('');
    console.log(chalk.gray('  Sections non disponibles via Annuaire Entreprises: UBO, BODACC, procédures collectives, mandats croisés, filiales.'));
  }
}

/**
 * Render company identity section.
 */
export function renderIdentity(identity, siren, isFallbackProvider) {
  const providerTag = isFallbackProvider ? chalk.cyan(' [Annuaire Entreprises]') : '';
  header(`🏢 Due Diligence Deep Profile — ${identity.name || siren}${providerTag}`);

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
}

/**
 * Render full mode sections: procedures, dirigeants, UBO, financials, etc.
 */
export function renderFullSections(data) {
  const { identity, financialHistory, consolidatedFinances, ubo, bodacc, dirigeants, representants, etablissements, proceduresCollectives } = data;

  // Procédures collectives — with severity badges
  if (proceduresCollectives.length > 0) {
    section('  🚨 Procédures collectives');
    for (const p of proceduresCollectives) {
      const label = [p.type, p.jugement].filter(Boolean).join(' — ');
      const loc = p.tribunal ? ` (${p.tribunal})` : '';
      const sevColor = p.severity === 'critical' ? chalk.red.bold
        : p.severity === 'high' ? chalk.red
        : p.severity === 'medium' ? chalk.yellow
        : chalk.gray;
      const badge = p.procedureCategory && p.procedureCategory !== 'other'
        ? sevColor(`[${p.procedureCategory.toUpperCase()}] `)
        : '';
      const admin = p.administrateur ? chalk.gray(` | Admin: ${p.administrateur}`) : '';
      const mandataire = p.mandataire ? chalk.gray(` | Mandataire: ${p.mandataire}`) : '';
      console.log(sevColor(`     [${p.date || '?'}] `) + badge + sevColor(label + loc) + admin + mandataire);
    }
  }

  // Dirigeants & mandats
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

  // UBO
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

  // Financial history table
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

  // Consolidated finances
  if (consolidatedFinances?.length > 0) {
    section('  💶 Finances consolidées (groupe)');
    const cTable = new Table({
      head: ['Année', 'CA consolidé', 'Résultat consolidé'].map(h => chalk.cyan.bold(h)),
      style: { head: [], border: ['grey'] },
      colAligns: ['left', 'right', 'right'],
    });
    for (const f of consolidatedFinances) {
      cTable.push([
        chalk.white(f.annee ?? '—'),
        f.ca != null ? chalk.white(formatEuro(f.ca)) : chalk.gray('—'),
        f.resultat != null
          ? (f.resultat >= 0 ? chalk.green(formatEuro(f.resultat)) : chalk.red(formatEuro(f.resultat)))
          : chalk.gray('—'),
      ]);
    }
    console.log(cTable.toString());
  }

  // Representants
  if (representants?.length > 0) {
    section(`  👥 Représentants (${representants.length})`);
    for (const r of representants) {
      const type = r.personneMorale ? chalk.blue('[PM]') : chalk.gray('[PP]');
      console.log(chalk.gray(`     ${type} ${chalk.white(r.nom)} — ${r.qualite}`));
    }
  }

  // Etablissements
  if (etablissements?.length > 1) {
    section(`  🏢 Établissements (${etablissements.length})`);
    for (const e of etablissements) {
      const status = e.actif ? chalk.green('●') : chalk.red('○');
      console.log(chalk.gray(`     ${status} ${e.siret} — ${e.type || '?'} — ${e.adresse || '?'}`));
    }
  }

  // BODACC — with distress classification for M&A intelligence
  if (bodacc.length > 0) {
    const distressCount = bodacc.filter(b => b.isDistress).length;
    const distressTag = distressCount > 0 ? chalk.red(` — ${distressCount} signaux de difficulté`) : '';
    section(`  📰 Publications BODACC (${bodacc.length} dernières${distressTag})`);
    for (const pub of bodacc) {
      const label = pub.description || pub.type || '?';
      const trib = pub.tribunal ? chalk.gray(` — ${pub.tribunal}`) : '';

      if (pub.isDistress) {
        const sevColor = pub.severity === 'critical' ? chalk.red.bold
          : pub.severity === 'high' ? chalk.red
          : pub.severity === 'medium' ? chalk.yellow
          : chalk.gray;
        const distressLabel = pub.distressType ? pub.distressType.replace(/_/g, ' ').toUpperCase() : '';
        console.log(sevColor(`  !! [${pub.date || '?'}] [${distressLabel}] `) + chalk.white(label) + trib);
      } else {
        const catBadge = pub.category !== 'other' ? chalk.blue(`[${pub.category}] `) : '';
        console.log(chalk.gray(`     [${pub.date || '?'}] `) + catBadge + chalk.white(label) + trib);
      }
    }
  }
}

/**
 * Render digital footprint section.
 */
export async function renderDigitalFootprint(identity) {
  const { analyzeSite } = await import('../../scrapers/site-analyzer.js');
  const websiteUrl = identity.website
    ? (identity.website.startsWith('http') ? identity.website : `https://${identity.website}`)
    : null;

  if (!websiteUrl) return;

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

/**
 * Render subsidiaries table.
 */
export function renderSubsidiaries(subsidiaries, subsFromCache) {
  if (subsFromCache) console.log(chalk.gray('  ✓ Subsidiaries loaded from cache (0 API credits)'));
  if (subsidiaries.length > 0) {
    const subTable = new Table({
      head: ['Entité', 'Ville', 'CA', 'Résultat', 'Effectif'].map(h => chalk.cyan.bold(h)),
      style: { head: [], border: ['grey'] },
      colAligns: ['left', 'left', 'right', 'right', 'left'],
    });
    for (const s of subsidiaries) {
      subTable.push([
        chalk.white(s.name),
        chalk.gray(s.ville || '—'),
        s.ca != null ? chalk.white(formatEuro(s.ca)) : chalk.gray('—'),
        s.resultat != null
          ? (s.resultat >= 0 ? chalk.green(formatEuro(s.resultat)) : chalk.red(formatEuro(s.resultat)))
          : chalk.gray('—'),
        chalk.gray(s.effectif || '—'),
      ]);
    }
    console.log(subTable.toString());
  } else {
    console.log(chalk.gray('     Aucune filiale trouvée.'));
  }
}

/**
 * Render press mentions summary.
 */
export function renderPressSummary(press, pressResults) {
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
}

/**
 * Render AI analysis results.
 */
export function renderAIAnalysis(aiAnalysis) {
  if (!aiAnalysis) return;

  if (aiAnalysis.executiveSummary) {
    console.log('\n' + chalk.white(aiAnalysis.executiveSummary) + '\n');
  }

  if (aiAnalysis.strengths?.length) {
    console.log(chalk.green.bold(`  💪 ${t('forces')} :`));
    for (const s of aiAnalysis.strengths.slice(0, 4)) {
      console.log(chalk.green(`     + ${s.text || s}`));
    }
  }

  if (aiAnalysis.weaknesses?.length) {
    console.log(chalk.red.bold(`  ⚠️  ${t('faiblesses')} :`));
    for (const w of aiAnalysis.weaknesses.slice(0, 4)) {
      console.log(chalk.red(`     - ${w.text || w}`));
    }
  }

  if (aiAnalysis.riskAssessment) {
    const riskColor = { low: chalk.green, medium: chalk.yellow, high: chalk.red, critical: chalk.red.bold }[aiAnalysis.riskAssessment.overall] || chalk.gray;
    console.log('\n  ' + riskColor(`🎯 ${t('riskLevel')} : ${t(`risk.${aiAnalysis.riskAssessment.overall}`) || (aiAnalysis.riskAssessment.overall || '?').toUpperCase()}`));
    for (const f of (aiAnalysis.riskAssessment.flags || []).slice(0, 3)) {
      const sevColor = { low: chalk.gray, medium: chalk.yellow, high: chalk.red, critical: chalk.red.bold }[f.severity] || chalk.gray;
      console.log(sevColor(`     [${f.severity || '?'}] ${f.text || ''}`));
    }
  }

  if (aiAnalysis.healthScore) {
    const hs = aiAnalysis.healthScore;
    const scoreColor = hs.score >= 70 ? chalk.green : hs.score >= 50 ? chalk.yellow : chalk.red;
    console.log('\n  ' + scoreColor(`📊 ${t('healthScore')} : ${hs.score}/100`));
    if (hs.breakdown) {
      for (const [key, val] of Object.entries(hs.breakdown)) {
        const c = val.score >= 70 ? chalk.green : val.score >= 50 ? chalk.yellow : chalk.red;
        const label = { growth: 'Croissance', profitability: 'Rentabilité', stability: 'Stabilité', diversification: 'Diversification', governance: 'Gouvernance' }[key] || key;
        console.log(c(`     ${label}: ${val.score}/100 — ${val.comment || ''}`));
      }
    }
  }

  if (aiAnalysis.competitors?.length) {
    console.log(chalk.cyan.bold(`\n  🏁 ${t('competitors')} :`));
    for (const c of aiAnalysis.competitors) {
      console.log(chalk.cyan(`     • ${c.name}${c.estimatedRevenue ? ' — ' + c.estimatedRevenue : ''}`));
    }
  }

  if (aiAnalysis.growthAnalysis) {
    const ga = aiAnalysis.growthAnalysis;
    console.log(chalk.magenta.bold('\n  📈 Growth Analysis :'));
    if (ga.consolidatedGrowth?.length) {
      for (const g of ga.consolidatedGrowth) {
        console.log(chalk.magenta(`     ${g.period}: ${g.fromRevenue} → ${g.toRevenue} (${g.growthPct}) | Organic: ${g.organic || 'N/A'} | External: ${g.external || 'N/A'}`));
      }
    }
    console.log(chalk.magenta(`     Quality: ${ga.growthQuality || '?'}`));
  }

  if (aiAnalysis.forwardLooking) {
    const fl = aiAnalysis.forwardLooking;
    const hasData = fl.announcedRevenue || fl.announcedHeadcount || fl.announcedAcquisitions?.length;
    if (hasData) {
      console.log(chalk.yellow.bold('\n  🔮 Forward-Looking :'));
      if (fl.announcedRevenue) {
        console.log(chalk.yellow(`     Revenue: ${fl.announcedRevenue.amount} (${fl.announcedRevenue.year}) [${fl.announcedRevenue.confidence}]`));
      }
      if (fl.projectedGrowth) {
        const pgStr = typeof fl.projectedGrowth === 'object' ? JSON.stringify(fl.projectedGrowth) : fl.projectedGrowth;
        console.log(chalk.yellow(`     Projected growth: ${pgStr}`));
      }
      if (fl.announcedAcquisitions?.length) {
        for (const acq of fl.announcedAcquisitions) {
          console.log(chalk.yellow(`     Acquisition: ${acq.target} (${acq.status})`));
        }
      }
    }
  }

  console.log('');
}
