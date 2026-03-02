import { fetch } from '../utils/fetcher.js';
import { load } from '../utils/parser.js';
import { analyzeSentiment, categorizeMention } from '../utils/sentiment.js';

const GOOGLE_NEWS_BASE = 'https://www.google.com/search';
const GOOGLE_SEARCH_BASE = 'https://www.google.com/search';

export async function scrapeNewsMentions(brandName, options = {}) {
  const mentions = [];

  // Search Google News
  try {
    const newsParams = new URLSearchParams({
      q: brandName,
      tbm: 'nws',
      num: '20',
      hl: 'en',
    });
    const newsUrl = `${GOOGLE_NEWS_BASE}?${newsParams}`;
    const response = await fetch(newsUrl, { retries: 3, delay: 2000 });

    if (response.status === 200) {
      const $ = load(response.data);

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href.startsWith('http') || href.includes('google.com')) return;

        const title = $(el).text().trim();
        if (title.length < 10) return;

        try {
          const url = new URL(href);
          const domain = url.hostname.replace('www.', '');
          const snippet = $(el).parent().text().replace(title, '').trim().slice(0, 200);
          const sentiment = analyzeSentiment(title + ' ' + snippet);
          const category = categorizeMention(href, title, snippet);

          mentions.push({
            source: 'google_news',
            url: href,
            domain,
            title: title.slice(0, 200),
            snippet: snippet.slice(0, 300),
            sentiment: sentiment.label,
            sentimentScore: sentiment.score,
            category,
            foundAt: new Date().toISOString(),
          });
        } catch {}
      });
    }
  } catch (err) {
    // Graceful degradation
  }

  // Also search recent web results (last 24h)
  try {
    await new Promise(r => setTimeout(r, 2000));
    const webParams = new URLSearchParams({
      q: brandName,
      tbs: 'qdr:d',
      num: '20',
      hl: 'en',
    });
    const webUrl = `${GOOGLE_SEARCH_BASE}?${webParams}`;
    const response = await fetch(webUrl, { retries: 3, delay: 2000 });

    if (response.status === 200) {
      const $ = load(response.data);

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href.startsWith('http') || href.includes('google.com')) return;

        const title = $(el).find('h3').text().trim() || $(el).text().trim().slice(0, 100);
        if (title.length < 10) return;

        // Skip duplicates
        if (mentions.some(m => m.url === href)) return;

        try {
          const url = new URL(href);
          const domain = url.hostname.replace('www.', '');
          const snippet = $(el).parent().text().replace(title, '').trim().slice(0, 200);
          const sentiment = analyzeSentiment(title + ' ' + snippet);
          const category = categorizeMention(href, title, snippet);

          mentions.push({
            source: 'google_web_24h',
            url: href,
            domain,
            title: title.slice(0, 200),
            snippet: snippet.slice(0, 300),
            sentiment: sentiment.label,
            sentimentScore: sentiment.score,
            category,
            foundAt: new Date().toISOString(),
          });
        } catch {}
      });
    }
  } catch {}

  return {
    brandName,
    checkedAt: new Date().toISOString(),
    mentions: mentions.slice(0, 40),
    mentionCount: mentions.length,
  };
}
