import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSentiment, sentimentEmoji, categorizeMention } from '../src/utils/sentiment.js';

describe('Sentiment Analysis', () => {
  test('identifies clearly positive text (English)', () => {
    const text = 'This product is excellent, amazing, and the best in the industry with outstanding performance.';
    const result = analyzeSentiment(text, 'en');
    assert.ok(result.score > 0, `Expected positive score, got ${result.score}`);
    assert.ok(['positive', 'slightly_positive'].includes(result.label),
      `Expected positive label, got ${result.label}`);
  });

  test('identifies clearly negative text (English)', () => {
    const text = 'Terrible product, the worst failure I have ever seen. Broken, useless and a complete scam.';
    const result = analyzeSentiment(text, 'en');
    assert.ok(result.score < 0, `Expected negative score, got ${result.score}`);
    assert.ok(['negative', 'slightly_negative'].includes(result.label),
      `Expected negative label, got ${result.label}`);
  });

  test('identifies neutral text', () => {
    const text = 'The company released their quarterly earnings report today.';
    const result = analyzeSentiment(text, 'en');
    assert.equal(result.label, 'neutral');
  });

  test('identifies positive text in French', () => {
    const text = 'Ce produit est excellent et fantastique, le meilleur service disponible.';
    const result = analyzeSentiment(text, 'fr');
    assert.ok(result.score > 0, `Expected positive score for French, got ${result.score}`);
  });

  test('identifies negative text in French', () => {
    const text = 'Ce produit est mauvais et terrible. Un échec complet, arnaque totale.';
    const result = analyzeSentiment(text, 'fr');
    assert.ok(result.score < 0, `Expected negative score for French, got ${result.score}`);
  });

  test('auto-detects language from context', () => {
    const enText = 'This is the best product ever, excellent service';
    const result = analyzeSentiment(enText, 'auto');
    assert.ok(result.label !== 'neutral' || result.score >= 0);
    assert.ok(['positive', 'slightly_positive', 'neutral'].includes(result.label));
  });

  test('returns arrays of matched words', () => {
    const text = 'Excellent product but had some terrible issues and errors.';
    const result = analyzeSentiment(text, 'en');
    assert.ok(Array.isArray(result.positiveHits));
    assert.ok(Array.isArray(result.negativeHits));
    assert.ok(result.positiveHits.length > 0 || result.negativeHits.length > 0);
  });

  test('handles empty text gracefully', () => {
    const result = analyzeSentiment('', 'en');
    assert.equal(result.score, 0);
    assert.equal(result.label, 'neutral');
  });

  test('handles null text gracefully', () => {
    const result = analyzeSentiment(null, 'en');
    assert.equal(result.score, 0);
    assert.equal(result.label, 'neutral');
  });

  test('score reflects word counts', () => {
    const manyPositive = 'excellent amazing fantastic outstanding perfect wonderful';
    const r = analyzeSentiment(manyPositive, 'en');
    assert.ok(r.score > 2, `Expected high positive score, got ${r.score}`);
  });
});

describe('Sentiment Emoji', () => {
  test('positive returns happy emoji', () => {
    assert.equal(sentimentEmoji('positive'), '😊');
  });

  test('negative returns sad emoji', () => {
    assert.equal(sentimentEmoji('negative'), '😞');
  });

  test('neutral returns neutral emoji', () => {
    assert.equal(sentimentEmoji('neutral'), '😐');
  });

  test('slightly positive', () => {
    assert.equal(sentimentEmoji('slightly_positive'), '🙂');
  });

  test('slightly negative', () => {
    assert.equal(sentimentEmoji('slightly_negative'), '😕');
  });
});

describe('Mention Categorization', () => {
  test('classifies press from major news domain', () => {
    const category = categorizeMention('https://techcrunch.com/article/123', 'TechCrunch article', '');
    assert.equal(category, 'press');
  });

  test('classifies forum from reddit URL', () => {
    const category = categorizeMention('https://reddit.com/r/startups/post', 'Discussion', '');
    assert.equal(category, 'forum');
  });

  test('classifies review from trustpilot', () => {
    const category = categorizeMention('https://trustpilot.com/review/company', 'Review', '');
    assert.equal(category, 'review');
  });

  test('classifies social from twitter', () => {
    const category = categorizeMention('https://twitter.com/user/status/123', 'Tweet', '');
    assert.equal(category, 'social');
  });

  test('defaults to blog for unknown source', () => {
    const category = categorizeMention('https://randomblog.example.com/post', 'Blog post', '');
    assert.equal(category, 'blog');
  });
});
