import { fetch } from '../utils/fetcher.js';
import { load } from '../utils/parser.js';

const GOOGLE_BASE = 'https://www.google.com/search';

export async function scrapeSerp(keyword, options = {}) {
  const { num = 20, lang = 'en' } = options;

  const params = new URLSearchParams({
    q: keyword,
    num: String(num),
    hl: lang,
    gl: 'us',
  });

  const url = `${GOOGLE_BASE}?${params}`;

  let response;
  try {
    response = await fetch(url, {
      retries: 3,
      delay: 2000,
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
      },
    });
  } catch (err) {
    throw new Error(`Google SERP fetch failed: ${err.message}`);
  }

  if (response.status === 429) {
    throw new Error('Google rate limited (429). Try again later.');
  }

  if (response.status !== 200) {
    throw new Error(`Google returned status ${response.status}`);
  }

  const $ = load(response.data);
  const results = [];

  // Parse organic results
  $('div.g, div[data-sokoban-container]').each((i, el) => {
    const titleEl = $(el).find('h3').first();
    const linkEl = $(el).find('a[href]').first();
    const snippetEl = $(el).find('[data-sncf], .VwiC3b, .s3v9rd, span[data-ved]').first();

    const title = titleEl.text().trim();
    const href = linkEl.attr('href') || '';
    const snippet = snippetEl.text().trim();

    if (!title || !href) return;

    let cleanUrl = href;
    if (href.startsWith('/url?')) {
      const parsed = new URLSearchParams(href.slice(5));
      cleanUrl = parsed.get('q') || href;
    }

    try {
      const parsedUrl = new URL(cleanUrl);
      results.push({
        position: results.length + 1,
        title,
        url: cleanUrl,
        domain: parsedUrl.hostname.replace('www.', ''),
        snippet,
        isFeaturedSnippet: false,
      });
    } catch {}
  });

  // Try alternate selectors if main ones didn't work
  if (results.length === 0) {
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!href.startsWith('http') || href.includes('google.com')) return;

      const title = $(el).find('h3').text().trim() || $(el).text().trim().slice(0, 100);
      if (!title) return;

      try {
        const parsedUrl = new URL(href);
        if (results.length < num) {
          results.push({
            position: results.length + 1,
            title,
            url: href,
            domain: parsedUrl.hostname.replace('www.', ''),
            snippet: '',
            isFeaturedSnippet: false,
          });
        }
      } catch {}
    });
  }

  // Check for featured snippet
  const featuredSnippet = $('[data-attrid="wa:/description"], .xpdopen, .g-blk').first();
  if (featuredSnippet.length && results.length > 0) {
    results[0].isFeaturedSnippet = true;
  }

  return {
    keyword,
    checkedAt: new Date().toISOString(),
    results: results.slice(0, num),
    resultCount: results.length,
    error: results.length === 0 ? 'No results parsed (Google may have changed layout or rate-limited)' : null,
  };
}
