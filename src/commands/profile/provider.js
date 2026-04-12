import chalk from 'chalk';
import { pappersSearchByName, pappersSearchSubsidiaries } from '../../scrapers/pappers.js';
import { annuaireGetFullDossier, annuaireSearchByName } from '../../scrapers/annuaire-entreprises.js';
import { pappersGetFullDossier, hasPappersKey } from '../../scrapers/pappers.js';
import { isPro, printProUpgrade } from '../../license.js';

/**
 * Resolve the FR company data provider.
 * Pappers (Pro) with fallback to Annuaire Entreprises (free).
 */
export function resolveFRProvider() {
  if (isPro() && hasPappersKey()) {
    return { providerName: 'pappers', searchByName: pappersSearchByName, getFullDossier: pappersGetFullDossier, searchSubsidiaries: pappersSearchSubsidiaries };
  }
  return { providerName: 'annuaire-entreprises', searchByName: annuaireSearchByName, getFullDossier: annuaireGetFullDossier, searchSubsidiaries: null };
}

/**
 * Handle license gating and provider info display.
 * Returns true if execution should continue, false if it should stop.
 */
export function handleLicenseGating(frProvider, options) {
  const hasLicense = isPro();
  const isFallbackProvider = frProvider.providerName === 'annuaire-entreprises';
  const isPreview = !!options.preview;

  if (isFallbackProvider) {
    console.log(chalk.cyan('  ℹ Provider: Annuaire Entreprises (data.gouv.fr) — 100% gratuit'));
    console.log(chalk.gray('    Données basiques Sirene (CA, effectifs, dirigeants, adresse, NAF).'));
    console.log(chalk.gray('    UBO, BODACC, procédures collectives, mandats croisés non disponibles.'));
    console.log('');
  }

  if (!isFallbackProvider && !hasLicense && !isPreview) {
    printProUpgrade('Deep Profile Due Diligence');
    console.log(chalk.gray('  Run with --preview for a limited preview (company identity + last year financials only).\n'));
    process.exit(1);
  }

  if (!isFallbackProvider && isPreview && !hasLicense) {
    console.log(chalk.yellow('  ⚡ PREVIEW MODE — Company identity + last year financials only'));
    printProUpgrade('Full company profile');
  }

  return true;
}
