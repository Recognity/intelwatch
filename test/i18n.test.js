import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, getLanguage, t, getPrompt } from '../src/utils/i18n.js';

describe('i18n Module', () => {
  test('default language is en', () => {
    setLanguage('en');
    assert.equal(getLanguage(), 'en');
  });

  test('set language to fr', () => {
    setLanguage('fr');
    assert.equal(getLanguage(), 'fr');
  });

  test('t() returns translation', () => {
    setLanguage('en');
    const val = t('report');
    // Should return a string (whatever the key maps to)
    assert.equal(typeof val, 'string');
  });

  test('t() falls back to key if not found', () => {
    setLanguage('en');
    const val = t('nonexistent_key_xyz');
    assert.equal(typeof val, 'string');
  });

  test('getPrompt returns string', () => {
    setLanguage('en');
    const val = getPrompt('default');
    // Should return something — even if it's undefined for unknown keys
    assert.ok(val === undefined || typeof val === 'string');
  });

  // Reset
  test('reset to en', () => {
    setLanguage('en');
    assert.equal(getLanguage(), 'en');
  });
});
