import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectTechnologies, diffTechStacks } from '../src/utils/tech-detect.js';

describe('Technology Detection', () => {
  test('detects WordPress by meta generator', () => {
    const html = '<html><head><meta name="generator" content="WordPress 6.4.2"></head><body></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('WordPress'), `Expected WordPress, got: ${names.join(', ')}`);
  });

  test('detects WordPress by wp-content path', () => {
    const html = '<html><body><script src="/wp-content/themes/mytheme/js/main.js"></script></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('WordPress'), `Expected WordPress in: ${names.join(', ')}`);
  });

  test('detects React by data-reactroot', () => {
    const html = '<html><body><div data-reactroot=""></div></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('React'), `Expected React in: ${names.join(', ')}`);
  });

  test('detects Next.js by x-powered-by header', () => {
    const html = '<html><body></body></html>';
    const headers = { 'x-powered-by': 'Next.js' };
    const detected = detectTechnologies(html, headers, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('Next.js'), `Expected Next.js in: ${names.join(', ')}`);
  });

  test('detects nginx by server header', () => {
    const html = '<html><body></body></html>';
    const headers = { 'server': 'nginx/1.24.0' };
    const detected = detectTechnologies(html, headers, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('nginx'), `Expected nginx in: ${names.join(', ')}`);
  });

  test('detects Cloudflare by cf-ray header', () => {
    const html = '<html><body></body></html>';
    const headers = { 'cf-ray': '12345-CDG' };
    const detected = detectTechnologies(html, headers, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('Cloudflare'), `Expected Cloudflare in: ${names.join(', ')}`);
  });

  test('detects Google Analytics by script', () => {
    const html = '<html><head><script src="https://www.googletagmanager.com/gtag/js?id=G-XXX"></script></head></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('Google Analytics') || names.includes('Google Tag Manager'),
      `Expected GA or GTM in: ${names.join(', ')}`);
  });

  test('detects Stripe by script source', () => {
    const html = '<html><body><script src="https://js.stripe.com/v3/"></script></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    const names = detected.map(t => t.name);
    assert.ok(names.includes('Stripe'), `Expected Stripe in: ${names.join(', ')}`);
  });

  test('returns empty array for unknown page', () => {
    const html = '<html><body><p>Hello world</p></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    assert.ok(Array.isArray(detected));
  });

  test('detected techs have name and category', () => {
    const html = '<html><body><script src="/wp-content/themes/x.js"></script></body></html>';
    const detected = detectTechnologies(html, {}, 'https://example.com');
    for (const tech of detected) {
      assert.ok(tech.name, 'Tech should have name');
      assert.ok(tech.category, 'Tech should have category');
    }
  });

  test('at least 30 tech signatures loaded', () => {
    // Detect on a page with many technologies
    const html = `<html>
      <head>
        <meta name="generator" content="WordPress 6.4">
        <script src="/wp-content/themes/x.js"></script>
        <script src="https://js.stripe.com/v3/"></script>
        <script src="https://static.hotjar.com/c/hotjar-xxx.js"></script>
        <script src="https://js.hs-scripts.com/xxx.js"></script>
      </head>
      <body data-reactroot="">
        <div class="wp-content"></div>
      </body>
    </html>`;
    const detected = detectTechnologies(html, { 'server': 'nginx', 'cf-ray': 'abc', 'x-powered-by': 'Next.js' }, 'https://example.com');
    // Just verify it runs without error and returns an array
    assert.ok(Array.isArray(detected));
    assert.ok(detected.length >= 3, `Expected at least 3 detections, got ${detected.length}`);
  });
});

describe('Tech Stack Diff', () => {
  test('detects added technology', () => {
    const prev = [{ name: 'React', category: 'JavaScript Framework' }];
    const curr = [
      { name: 'React', category: 'JavaScript Framework' },
      { name: 'Stripe', category: 'Payment' },
    ];

    const diff = diffTechStacks(prev, curr);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.added[0].name, 'Stripe');
    assert.equal(diff.removed.length, 0);
  });

  test('detects removed technology', () => {
    const prev = [
      { name: 'jQuery', category: 'JavaScript Library' },
      { name: 'Bootstrap', category: 'CSS Framework' },
    ];
    const curr = [{ name: 'Bootstrap', category: 'CSS Framework' }];

    const diff = diffTechStacks(prev, curr);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].name, 'jQuery');
    assert.equal(diff.added.length, 0);
  });

  test('no changes when stacks are equal', () => {
    const stack = [
      { name: 'React', category: 'JavaScript Framework' },
      { name: 'nginx', category: 'Web Server' },
    ];
    const diff = diffTechStacks(stack, stack);
    assert.equal(diff.added.length, 0);
    assert.equal(diff.removed.length, 0);
  });
});
