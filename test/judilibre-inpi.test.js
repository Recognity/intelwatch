import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasJudilibreKey, searchDecisions, searchForTarget } from '../src/scrapers/judilibre.js';
import { hasInpiCredentials, searchMarquesBySiren, searchBrevetsBySiren } from '../src/scrapers/inpi.js';

// Vérifie que les 2 nouveaux scrapers OSINT (JudiLibre + INPI) dégradent
// gracieusement quand aucune clé n'est configurée. Pas de network requis.

describe('judilibre — graceful degradation', () => {
  test('hasJudilibreKey returns false without JUDILIBRE_KEY_ID', () => {
    const orig = process.env.JUDILIBRE_KEY_ID;
    delete process.env.JUDILIBRE_KEY_ID;
    assert.equal(hasJudilibreKey(), false);
    if (orig) process.env.JUDILIBRE_KEY_ID = orig;
  });

  test('searchDecisions returns empty + clear error without key', async () => {
    const orig = process.env.JUDILIBRE_KEY_ID;
    delete process.env.JUDILIBRE_KEY_ID;
    const r = await searchDecisions('ACME', { pageSize: 5 });
    assert.deepEqual(r.decisions, []);
    assert.equal(r.total, 0);
    assert.match(r.error, /JUDILIBRE_KEY_ID not set/);
    if (orig) process.env.JUDILIBRE_KEY_ID = orig;
  });

  test('searchForTarget aggregates errors per query', async () => {
    const orig = process.env.JUDILIBRE_KEY_ID;
    delete process.env.JUDILIBRE_KEY_ID;
    const r = await searchForTarget('ACME', ['Jean Dupont']);
    assert.deepEqual(r.decisions, []);
    assert.ok(r.errors.some(e => /JUDILIBRE_KEY_ID/.test(e)));
    if (orig) process.env.JUDILIBRE_KEY_ID = orig;
  });
});

describe('inpi — graceful degradation', () => {
  test('hasInpiCredentials returns false without USERNAME/PASSWORD', () => {
    const u = process.env.INPI_USERNAME; const p = process.env.INPI_PASSWORD;
    delete process.env.INPI_USERNAME; delete process.env.INPI_PASSWORD;
    assert.equal(hasInpiCredentials(), false);
    if (u) process.env.INPI_USERNAME = u;
    if (p) process.env.INPI_PASSWORD = p;
  });

  test('searchMarquesBySiren returns empty + clear error without creds', async () => {
    const u = process.env.INPI_USERNAME; const p = process.env.INPI_PASSWORD;
    delete process.env.INPI_USERNAME; delete process.env.INPI_PASSWORD;
    const r = await searchMarquesBySiren('814811592');
    assert.deepEqual(r.marques, []);
    assert.match(r.error, /INPI_USERNAME\/INPI_PASSWORD not set/);
    if (u) process.env.INPI_USERNAME = u;
    if (p) process.env.INPI_PASSWORD = p;
  });

  test('searchBrevetsBySiren returns empty + clear error without creds', async () => {
    const u = process.env.INPI_USERNAME; const p = process.env.INPI_PASSWORD;
    delete process.env.INPI_USERNAME; delete process.env.INPI_PASSWORD;
    const r = await searchBrevetsBySiren('814811592');
    assert.deepEqual(r.brevets, []);
    assert.match(r.error, /INPI credentials not set/);
    if (u) process.env.INPI_USERNAME = u;
    if (p) process.env.INPI_PASSWORD = p;
  });
});
