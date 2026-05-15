import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildMaHistoryFromCode } from '../src/commands/profile/helpers.js';

// Bug 3 (cascade Bug 2) : la timeline M&A doit ingérer BODACC en plus
// des articles scrappés + filiales off-brand, pour atteindre ≥10 entries
// sur une holding active (NOVARES type).

describe('buildMaHistoryFromCode — BODACC capital increases', () => {
  test('extracts chronological capital increases, dedupes re-filings', () => {
    const bodacc = [
      { date: '2015-12-08', description: 'Capital social', capital: 1000, type: 'Création' },
      { date: '2016-06-14', description: 'modification capital augmentation', capital: 46759000, type: 'Modification du capital' },
      { date: '2016-12-31', description: 'Modification du capital', capital: 75987000, type: 'Modification du capital' },
      // Re-filing same year, no real change → should be skipped
      { date: '2017-08-23', description: 'Capital re-dépôt', capital: 75987000, type: 'Avis' },
      { date: '2020-10-11', description: 'Modification du capital', capital: 189409000, type: 'Modification du capital' },
      { date: '2025-04-29', description: 'Modification du capital', capital: 454300000, type: 'Modification du capital' },
    ];
    const entries = buildMaHistoryFromCode([], [], bodacc);
    const capital = entries.filter(e => e.type === 'capital_increase');
    assert.ok(capital.length >= 4, `expected ≥4 capital events, got ${capital.length}`);
    // chronologique
    const dates = capital.map(e => e.date);
    const sorted = [...dates].sort();
    assert.deepEqual(dates, sorted, 'capital events must be chrono');
    // pas de doublon (75M re-filing)
    const amounts = capital.map(e => e.target);
    const unique = new Set(amounts);
    assert.equal(unique.size, amounts.length, 'no duplicate capital amounts');
  });

  test('captures dénomination change as restructuration', () => {
    const bodacc = [
      { date: '2017-10-10', description: 'Modification de la dénomination', type: 'Modification' },
    ];
    const entries = buildMaHistoryFromCode([], [], bodacc);
    assert.ok(entries.some(e => e.type === 'restructuration' && e.target.includes('dénomination')));
  });

  test('captures distress signals from BODACC', () => {
    const bodacc = [
      { date: '2024-09-12', description: 'Procédure de conciliation', type: 'Procédure collective', isDistress: true, distressType: 'conciliation' },
    ];
    const entries = buildMaHistoryFromCode([], [], bodacc);
    assert.ok(entries.some(e => e.type === 'restructuration' && e.target.toLowerCase().includes('conciliation')));
  });

  test('combines BODACC + off-brand subs for total ≥3 entries on a realistic holding', () => {
    const bodacc = [
      { date: '2016-06-14', description: 'capital augmentation', capital: 46759000, type: 'Modification du capital' },
      { date: '2017-10-10', description: 'Modification de la dénomination', type: 'Modification' },
    ];
    const offBrandSubs = [
      { name: 'DELERAT LAURENT', siren: '331004862', dateCreation: '2022-02-15', ca: 0 },
    ];
    const entries = buildMaHistoryFromCode([], offBrandSubs, bodacc);
    assert.ok(entries.length >= 3, `expected ≥3 entries, got ${entries.length}`);
  });

  test('backward compat: no bodacc arg works', () => {
    const offBrandSubs = [{ name: 'ACME', siren: '999', dateCreation: '2020-01-01' }];
    const entries = buildMaHistoryFromCode([], offBrandSubs);
    assert.equal(entries.length, 1);
  });
});
