// MH7 — Provenance Footer block (PDF dernière page / footer récurrent)
//
// Pure in→out builder. Aucun appel réseau, aucun side-effect. Pas de
// console.log : c'est un builder, pas du CLI. Si on swallow une erreur,
// on log avec contexte (convention Recognity).
//
// Contrat de sortie :
//   {
//     sources: [{name, count, url}],
//     badge: '100% public sources · TDM-compliant',
//     generatedAt: ISO8601
//   }
//
// Sources attendues (ordre canonique) :
//   BODACC · Pappers · INPI · Judilibre · Presse publique
//
// Pappers est le backbone : tout le dossier (identity/bodacc/dirigeants/finances)
// transite par son API. On l'expose en label "backbone" plutôt qu'en count
// numérique, qui était sémantiquement faux (count=0 sur PME mono-entité alors
// que TOUT vient de Pappers). Voir A4.
//
// Pour les autres sources, count=0 explicite reste affiché : c'est plus honnête
// qu'un footer tronqué.

const SOURCE_DEFS = [
  {
    key: 'bodacc',
    name: 'BODACC',
    url: 'https://www.bodacc.fr/',
  },
  {
    key: 'pappers',
    name: 'Pappers',
    url: 'https://www.pappers.fr/',
  },
  {
    key: 'inpi',
    name: 'INPI',
    url: 'https://data.inpi.fr/',
  },
  {
    key: 'judilibre',
    name: 'Judilibre',
    url: 'https://www.courdecassation.fr/recherche-judilibre',
  },
  {
    key: 'press',
    name: 'Presse publique',
    url: null, // multi-domaines, l'URL est portée par chaque mention
  },
];

const BADGE = '100% public sources · TDM-compliant';

/**
 * Coerce une entrée vers un count (length pour Array, count si object {count}).
 * Renvoie 0 si non parseable plutôt que de planter le footer.
 */
function safeCount(input, debugLabel) {
  if (input == null) return 0;
  if (Array.isArray(input)) return input.length;
  if (typeof input === 'number' && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  if (typeof input === 'object') {
    if (typeof input.count === 'number' && Number.isFinite(input.count)) return Math.max(0, input.count);
    if (typeof input.total === 'number' && Number.isFinite(input.total)) return Math.max(0, input.total);
    // {marques:[], brevets:[]} pour INPI
    if (Array.isArray(input.marques) || Array.isArray(input.brevets)) {
      return (input.marques?.length || 0) + (input.brevets?.length || 0);
    }
    if (Array.isArray(input.decisions)) return input.decisions.length;
    if (Array.isArray(input.mentions)) return input.mentions.length;
  }
  // Logue le format inattendu pour faciliter le debug aval (convention Recognity)
  console.error('[provenance-footer] unexpected source shape — falling back to 0', { source: debugLabel, type: typeof input });
  return 0;
}

/**
 * Pour la presse, on préfère une URL "lead" si on en a une (premier domaine),
 * sinon null — l'URL canonique presse n'existe pas (par définition multi-source).
 */
function pickPressUrl(pressMentions) {
  if (!Array.isArray(pressMentions) || pressMentions.length === 0) return null;
  const first = pressMentions.find((m) => m && (m.url || m.source));
  if (!first) return null;
  return first.url || null;
}

export function buildProvenanceFooterBlock({
  pressMentions,
  bodacc,
  judilibre,
  inpi,
  consolidatedFinances,
  dirigeants,
} = {}) {
  const counts = {
    bodacc: safeCount(bodacc, 'bodacc'),
    inpi: safeCount(inpi, 'inpi'),
    judilibre: safeCount(judilibre, 'judilibre'),
    press: safeCount(pressMentions, 'press'),
  };

  // Pappers = backbone : présence "active" dès qu'au moins une feature dérivée
  // (bodacc, dirigeants, finances) est non vide. On l'expose en label, pas en
  // count numérique (count=0 sur PME mono-entité était trompeur).
  const pappersActive = (
    safeCount(bodacc, 'bodacc') > 0
    || safeCount(dirigeants, 'dirigeants') > 0
    || safeCount(consolidatedFinances, 'pappers') > 0
  );

  const sources = [];
  for (const def of SOURCE_DEFS) {
    if (def.key === 'pappers') {
      if (!pappersActive) continue; // skip Pappers si réellement aucune trace
      sources.push({
        name: 'Pappers',
        label: 'backbone',
        count: null,
        url: def.url,
      });
      continue;
    }
    sources.push({
      name: def.name,
      count: counts[def.key] || 0,
      url: def.key === 'press' ? (pickPressUrl(pressMentions) || def.url) : def.url,
    });
  }

  return {
    sources,
    badge: BADGE,
    generatedAt: new Date().toISOString(),
  };
}
