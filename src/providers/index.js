/**
 * Provider auto-registration.
 *
 * Import this module once at CLI startup to register all company data providers.
 *
 * Usage:
 *   import './providers/index.js';              // registers all
 *   import { resolveProvider } from './providers/registry.js';  // use
 */

import { registerProvider } from './registry.js';
import pappersProvider from './pappers.js';
import annuaireEntreprisesProvider from './annuaire-entreprises.js';
import opencorporatesProvider from './opencorporates.js';
import clearbitProvider from './clearbit.js';
import apolloProvider from './apollo.js';

registerProvider('pappers', pappersProvider);
registerProvider('annuaire-entreprises', annuaireEntreprisesProvider);
registerProvider('opencorporates', opencorporatesProvider);
registerProvider('clearbit', clearbitProvider);
registerProvider('apollo', apolloProvider);

export {
  detectCountry,
  resolveProvider,
  searchCompany,
  getCompanyProfile,
  getSubsidiaries,
  lookupCompany,
  listProviders,
} from './registry.js';
