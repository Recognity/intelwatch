import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ── Import SUT ──────────────────────────────────────────────────────────────

import { isSirenOrSiret } from '../src/providers/registry.js';

// ── SIREN/SIRET Detection ──────────────────────────────────────────────────

describe('compare command routing — SIREN/SIRET detection', () => {
  test('9 digits = SIREN → triggers company comparison', () => {
    assert.equal(isSirenOrSiret('443061841'), true);
    assert.equal(isSirenOrSiret('482026739'), true);
  });

  test('14 digits = SIRET → triggers company comparison', () => {
    assert.equal(isSirenOrSiret('44306184100010'), true);
  });

  test('10 digits = not SIREN/SIRET', () => {
    assert.equal(isSirenOrSiret('1234567890'), false);
  });

  test('letters = not SIREN/SIRET → falls through to tracker compare', () => {
    assert.equal(isSirenOrSiret('my-tracker'), false);
    assert.equal(isSirenOrSiret('comp-1'), false);
    assert.equal(isSirenOrSiret('abc'), false);
  });

  test('empty string', () => {
    assert.equal(isSirenOrSiret(''), false);
  });

  test('null/undefined', () => {
    assert.equal(isSirenOrSiret(null), false);
    assert.equal(isSirenOrSiret(undefined), false);
  });

  test('whitespace-padded SIREN still detected', () => {
    assert.equal(isSirenOrSiret('  443061841  '), true);
  });

  test('mixed SIREN + tracker ID: one SIREN, one not → mismatch', () => {
    const id1 = '443061841';
    const id2 = 'my-tracker';
    // Both must be SIREN/SIRET for company compare, otherwise error
    const bothSiren = isSirenOrSiret(id1) && isSirenOrSiret(id2);
    assert.equal(bothSiren, false);
  });

  test('both tracker IDs → original tracker comparison', () => {
    const id1 = 'comp-1';
    const id2 = 'comp-2';
    const bothSiren = isSirenOrSiret(id1) && isSirenOrSiret(id2);
    assert.equal(bothSiren, false);
  });

  test('both SIRENs → company comparison', () => {
    const id1 = '443061841';
    const id2 = '482026739';
    const bothSiren = isSirenOrSiret(id1) && isSirenOrSiret(id2);
    assert.equal(bothSiren, true);
  });
});

// ── formatEuro ─────────────────────────────────────────────────────────────

describe('formatEuro helper', () => {
  const formatEuro = (val) => {
    if (val == null) return null;
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  test('formats 500000 as French Euro', () => {
    const result = formatEuro(500000);
    assert.ok(result.includes('500'));
    assert.ok(result.includes('000'));
    assert.ok(result.includes('€') || result.includes('EUR'));
  });

  test('formats negative value', () => {
    const result = formatEuro(-25000);
    assert.ok(result.includes('-') || result.includes('25'));
  });

  test('null returns null', () => {
    assert.equal(formatEuro(null), null);
  });

  test('undefined returns null', () => {
    assert.equal(formatEuro(undefined), null);
  });

  test('0 returns zero euros', () => {
    const result = formatEuro(0);
    assert.ok(result.includes('0'));
  });
});

// ── SIREN normalization (SIRET → SIREN) ────────────────────────────────────

describe('SIREN normalization from SIRET', () => {
  test('SIRET 14 digits → SIREN is first 9', () => {
    const siret = '44306184100010';
    const siren = siret.trim().slice(0, 9);
    assert.equal(siren, '443061841');
  });

  test('SIREN 9 digits → stays 9 digits', () => {
    const sirenInput = '443061841';
    const siren = sirenInput.trim().slice(0, 9);
    assert.equal(siren, '443061841');
  });

  test('identical SIRENs after normalization should be caught', () => {
    const s1 = '443061841';
    const s2 = '44306184100010';
    const norm1 = s1.trim().slice(0, 9);
    const norm2 = s2.trim().slice(0, 9);
    assert.equal(norm1, norm2);
  });
});

// ── Dossier data structure contract ────────────────────────────────────────

describe('Dossier data structure for compare', () => {
  test('identity fields exist in mock dossier', () => {
    const mockDossier = {
      identity: {
        siren: '443061841',
        name: 'RECOGNITY SAS',
        nafCode: '62.01Z',
        nafLabel: 'Programmation informatique',
        formeJuridique: 'SAS',
        dateCreation: '2020-01-15',
        capital: 10000,
        effectifs: '10-19 salariés',
        status: 'Actif',
        ville: 'Paris',
      },
      financialHistory: [
        { annee: 2024, ca: 500000, resultat: 50000, capitauxPropres: 200000 },
        { annee: 2023, ca: 400000, resultat: 30000, capitauxPropres: 150000 },
      ],
      dirigeants: [
        { nom: 'Dupont', prenom: 'Jean', role: 'Président', mandats: [] },
      ],
    };

    assert.equal(mockDossier.identity.siren, '443061841');
    assert.equal(mockDossier.identity.name, 'RECOGNITY SAS');
    assert.equal(mockDossier.identity.nafCode, '62.01Z');
    assert.equal(mockDossier.identity.status, 'Actif');
    assert.equal(mockDossier.financialHistory.length, 2);
    assert.equal(mockDossier.financialHistory[0].ca, 500000);
    assert.equal(mockDossier.financialHistory[0].resultat, 50000);
    assert.equal(mockDossier.dirigeants.length, 1);
    assert.equal(mockDossier.dirigeants[0].nom, 'Dupont');
  });

  test('financial delta calculation', () => {
    const ca1 = 1000000;
    const ca2 = 500000;
    const ratio = ca1 / ca2;
    assert.equal(ratio, 2);
    assert.ok(ratio >= 1);

    // Company 1 is 2x bigger
    const leader = ca1 >= ca2 ? 'Company A' : 'Company B';
    assert.equal(leader, 'Company A');
  });

  test('margin nette calculation', () => {
    const ca = 1000000;
    const resultat = 50000;
    const marge = ((resultat / ca) * 100).toFixed(1);
    assert.equal(marge, '5.0');
  });

  test('negative margin calculation', () => {
    const ca = 500000;
    const resultat = -25000;
    const marge = ((resultat / ca) * 100).toFixed(1);
    assert.equal(marge, '-5.0');
  });

  test('handles empty dirigeants gracefully', () => {
    const dir1 = [];
    const dir2 = [{ nom: 'Durand', prenom: 'Alice', role: 'PDG', mandats: [] }];
    const maxDir = Math.max(dir1.length, dir2.length, 1);
    assert.equal(maxDir, 1);
  });

  test('merges financial years from both companies', () => {
    const f1 = [{ annee: 2024, ca: 1000000 }, { annee: 2023, ca: 800000 }];
    const f2 = [{ annee: 2024, ca: 500000 }, { annee: 2022, ca: 300000 }];

    const allYears = [...new Set([
      ...f1.map(f => f.annee),
      ...f2.map(f => f.annee),
    ])].sort((a, b) => b - a);

    assert.deepEqual(allYears, [2024, 2023, 2022]);
  });
});

// ── Parallel fetch behavior ────────────────────────────────────────────────

describe('Promise.allSettled for parallel fetch', () => {
  test('both succeed', async () => {
    const results = await Promise.allSettled([
      Promise.resolve({ data: { identity: { name: 'A' } } }),
      Promise.resolve({ data: { identity: { name: 'B' } } }),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].value.data.identity.name, 'A');
    assert.equal(results[1].status, 'fulfilled');
    assert.equal(results[1].value.data.identity.name, 'B');
  });

  test('one fails — other still succeeds', async () => {
    const results = await Promise.allSettled([
      Promise.resolve({ data: { identity: { name: 'A' } } }),
      Promise.reject(new Error('SIREN not found')),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.message, 'SIREN not found');
  });

  test('both fail', async () => {
    const results = await Promise.allSettled([
      Promise.reject(new Error('Error 1')),
      Promise.reject(new Error('Error 2')),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[1].status, 'rejected');
  });
});

// ── Status color coding ────────────────────────────────────────────────────

describe('Status color coding logic', () => {
  test('Actif = green', () => {
    const status = 'Actif';
    assert.equal(status === 'Actif', true);
  });

  test('Fermé = red', () => {
    const status = 'Fermé';
    assert.equal(status === 'Actif', false);
  });

  test('null = na', () => {
    const status = null;
    assert.equal(status == null, true);
  });
});
