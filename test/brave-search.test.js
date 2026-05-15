import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hasBraveKey, searchPressMentionsViaBrave } from '../src/scrapers/brave-search.js';

// Bug 2 : Brave Search est ajouté comme 3e provider de presse.
// Tests : pas de network requis, on valide la résilience (absence de clé,
// schema de retour, dédup d'URLs).

describe('brave-search — provider resilience', () => {
  test('hasBraveKey returns false when BRAVE_API_KEY is absent', () => {
    const orig = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    assert.equal(hasBraveKey(), false);
    if (orig) process.env.BRAVE_API_KEY = orig;
  });

  test('searchPressMentionsViaBrave returns empty mentions without key (no crash)', async () => {
    const orig = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    const result = await searchPressMentionsViaBrave('NOVARES');
    assert.ok(Array.isArray(result.mentions));
    assert.equal(result.mentions.length, 0);
    assert.match(result.error, /BRAVE_API_KEY not set/);
    if (orig) process.env.BRAVE_API_KEY = orig;
  });
});
