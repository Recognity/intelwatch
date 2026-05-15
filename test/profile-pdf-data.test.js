import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfData } from '../src/commands/profile/pdf-data.js';

// Couvre les 4 bugs Recognity/intelwatch fixés en 1.7.1 :
//   Bug 1 : capital/CA doivent prendre le consolidé quand dispo (holding)
//   Bug 1b: capital/CA fallback entité quand pas de consolidé (PME pure)
//   Bug 4 : aiCompetitors ne doit pas inclure la cible elle-même
//   Bug 4b: aiCompetitors doit être complété par competitorCandidates.registry si l'IA renvoie une liste vide

const baseIdentity = {
  siren: '814811592',
  siret: '81481159200034',
  name: 'NOVARES GROUP',
  formeJuridique: 'SAS',
  dateCreation: '2015-12-08',
  nafCode: '7022Z',
  nafLabel: 'Conseil pour les affaires et autres conseils de gestion',
  capital: 454300000,
  website: 'https://novaresteam.com',
  adresse: '1 Av Newton',
  codePostal: '78180',
  ville: 'Montigny-le-Bretonneux',
};

function baseInput(overrides = {}) {
  return {
    identity: baseIdentity,
    financialHistory: [{ annee: 2024, ca: 68500000 }],
    consolidatedFinances: [],
    ubo: [],
    bodacc: [],
    dirigeants: [],
    representants: [],
    etablissements: [],
    proceduresCollectives: [],
    subsidiariesData: [],
    pressResults: [],
    aiAnalysis: null,
    codeBuiltMaHistory: [],
    scrapedMaContent: [],
    siren: '814811592',
    competitorCandidates: { registry: [], press: [] },
    ...overrides,
  };
}

describe('buildPdfData — Bug 1: Group Structure prefers consolidated finances', () => {
  test('uses consolidated CA + capitauxPropres when available (holding case)', () => {
    const out = buildPdfData(baseInput({
      consolidatedFinances: [{ annee: 2024, ca: 1120000000, capitauxPropres: 188500000 }],
    }));
    const card = out.competitors[0].pappers;
    assert.match(card.ca, /1\.12B€.*2024.*consolidé/);
    assert.match(card.capital, /188\.5M€.*CP consolidés/);
  });

  test('falls back to entity capital + entity CA when no consolidated (PME pure)', () => {
    const out = buildPdfData(baseInput({
      identity: { ...baseIdentity, capital: 2000000 },
      financialHistory: [{ annee: 2023, ca: 21900000 }],
    }));
    const card = out.competitors[0].pappers;
    assert.equal(card.capital, '2.0M€');
    assert.match(card.ca, /21\.9M€.*2023/);
    assert.doesNotMatch(card.ca, /consolidé/);
  });
});

describe('buildPdfData — Bug 4: aiCompetitors never lists the target itself', () => {
  test('filters out AI competitor matching target SIREN', () => {
    const out = buildPdfData(baseInput({
      aiAnalysis: {
        competitors: [
          { name: 'NOVARES GROUP', siren: '814811592', summary: 'self', reason: 'hallu' },
          { name: 'Plastivaloire', siren: '111222333', summary: 'real peer', reason: 'plastique auto' },
        ],
      },
      competitorCandidates: {
        registry: Array.from({ length: 8 }, (_, i) => ({
          name: `Plastik${i}`,
          siren: `40000000${i}`,
          ca: (10 - i) * 1e7,
          caYear: 2023,
          naf: '2229A',
          ville: 'Lyon',
        })),
        press: [],
      },
    }));
    const aiCompetitors = out.aiCompetitors;
    assert.ok(!aiCompetitors.some(c => String(c.siren) === '814811592'), 'must not include target SIREN');
    assert.ok(!aiCompetitors.some(c => String(c.name || '').toLowerCase() === 'novares group'), 'must not include target name');
    assert.ok(aiCompetitors.length >= 5, `expected ≥5 competitors after fallback, got ${aiCompetitors.length}`);
  });

  test('builds fallback from registry when AI returns empty list', () => {
    const out = buildPdfData(baseInput({
      aiAnalysis: { competitors: [] },
      competitorCandidates: {
        registry: [
          { name: 'Plastivaloire', siren: '383980281', ca: 2.1e8, caYear: 2023, naf: '2229A', ville: 'Langeais' },
          { name: 'Polyplas', siren: '423456789', ca: 1.5e8, caYear: 2023, naf: '2229A', ville: 'Lyon' },
        ],
        press: [],
      },
    }));
    assert.equal(out.aiCompetitors.length, 2);
    assert.equal(out.aiCompetitors[0].name, 'Plastivaloire');
    assert.equal(out.aiCompetitors[0].source, 'pappers_registry');
  });

  test('keeps AI competitors when they alone are ≥5 (no fallback needed)', () => {
    const aiList = Array.from({ length: 6 }, (_, i) => ({
      name: `RealPeer${i}`, siren: `90000000${i}`, summary: 's', reason: 'r',
    }));
    const out = buildPdfData(baseInput({
      aiAnalysis: { competitors: aiList },
      competitorCandidates: {
        registry: [{ name: 'IgnoreMe', siren: '999999999', ca: 1, naf: '2229A' }],
        press: [],
      },
    }));
    assert.equal(out.aiCompetitors.length, 6);
    assert.ok(!out.aiCompetitors.some(c => c.name === 'IgnoreMe'));
  });
});
