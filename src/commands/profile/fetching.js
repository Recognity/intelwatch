import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { annuaireGetFullDossier } from '../../scrapers/annuaire-entreprises.js';
import { setCache } from '../../scrapers/pappers.js';
import { error, warn } from '../../utils/display.js';
import { formatEuro } from './helpers.js';

/**
 * Resolve SIREN from name if needed, then fetch full dossier.
 * Falls back to Annuaire Entreprises on Pappers 401.
 */
export async function fetchCompanyDossier(sirenOrName, frProvider, options) {
  const isFallbackProvider = frProvider.providerName === 'annuaire-entreprises';
  let siren = sirenOrName;

  if (!/^\d{9}$/.test(sirenOrName)) {
    console.log(chalk.gray(`  Searching for: "${sirenOrName}"...`));
    const { results, error: searchErr } = await frProvider.searchByName(sirenOrName, { count: 1 });
    if (searchErr || !results.length) {
      error(`Company not found: ${searchErr || 'No results'}`);
      process.exit(1);
    }
    siren = results[0].siren;
    const foundName = results[0].nom_entreprise || results[0].denomination;
    console.log(chalk.gray(`  Found: ${foundName} (SIREN: ${siren})`));
  }

  console.log(chalk.gray('  Loading company data...'));
  const { data, error: dossierErr, fromCache } = await frProvider.getFullDossier(siren);
  if (fromCache) console.log(chalk.gray('  ✓ Loaded from cache (0 API credits)'));

  if (dossierErr || !data) {
    if (!isFallbackProvider && dossierErr && /401|unauthorized|forbidden/i.test(dossierErr)) {
      console.log(chalk.yellow('  ⚠ Pappers 401 — fallback vers l\'Annuaire Entreprises (data.gouv.fr)'));
      const fallbackResult = await annuaireGetFullDossier(siren);
      if (fallbackResult.error || !fallbackResult.data) {
        error(`Failed to fetch dossier from both providers: ${dossierErr} / ${fallbackResult.error}`);
        process.exit(1);
      }
      return { data: fallbackResult.data, siren, isFallback: true };
    }
    error(`Failed to fetch dossier: ${dossierErr || 'Unknown error'}`);
    process.exit(1);
  }

  return { data, siren, isFallback: false };
}

/**
 * Fetch press mentions + deep press content (company blog, LinkedIn, M&A articles).
 * P1 FIX: Blog paths and articles are fetched in parallel instead of sequentially.
 */
export async function fetchPressData(identity, siren, brandName) {
  const { searchPressMentions } = await import('../../scrapers/searxng-search.js');
  let pressResults = [];
  let companyArticles = [];

  const press = await searchPressMentions(brandName);
  pressResults = press.mentions || [];

  // M&A-focused search (parallel with company blog crawl below)
  const maSearchPromise = fetchMaSearchResults(brandName, pressResults);

  // Deep press: company website + LinkedIn
  const pressCache = join(homedir(), '.intelwatch', 'cache', 'press');
  const pressCacheFile = join(pressCache, `${siren}.json`);
  const PRESS_CACHE_TTL = 3 * 24 * 60 * 60 * 1000; // 3 days

  let cacheHit = false;
  if (existsSync(pressCacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(pressCacheFile, 'utf8'));
      if (Date.now() - cached.ts < PRESS_CACHE_TTL) {
        companyArticles = cached.articles || [];
        cacheHit = true;
        console.log(chalk.gray(`  Deep scan: loaded ${companyArticles.length} articles from cache`));
      }
    } catch (_) { /* corrupt cache, re-scrape */ }
  }

  if (!cacheHit) {
    const companyDomain = (identity.website
      ? identity.website.replace(/\/$/, '')
      : `https://www.${brandName.toLowerCase().replace(/\s+/g, '')}.com`);

    // P1 FIX: Crawl blog paths in parallel
    companyArticles = await crawlCompanyBlogParallel(companyDomain);
    console.log(chalk.gray(`    Found ${companyArticles.length} company articles`));

    // P1 FIX: Site search + LinkedIn in parallel
    const [siteArticles, linkedinArticles] = await Promise.allSettled([
      fetchSiteSearchArticles(companyDomain, brandName),
      fetchLinkedInMentions(brandName),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

    for (const art of siteArticles) {
      if (!companyArticles.some(a => a.url === art.url)) {
        companyArticles.push(art);
      }
    }
    console.log(chalk.gray(`    + ${siteArticles.length} site search results`));

    for (const art of linkedinArticles) {
      companyArticles.push(art);
    }
    console.log(chalk.gray(`    + ${linkedinArticles.length} LinkedIn results`));

    // Persist cache
    try {
      if (!existsSync(pressCache)) mkdirSync(pressCache, { recursive: true });
      writeFileSync(pressCacheFile, JSON.stringify({ ts: Date.now(), articles: companyArticles }), 'utf8');
    } catch (_) {}
  }

  // Wait for M&A search to complete and merge results
  const maResults = await maSearchPromise;
  pressResults.push(...maResults);

  // Add company blog articles to pressResults
  const { analyzeSentiment } = await import('../../utils/sentiment.js');
  for (const art of companyArticles.filter(a => a.source === 'company-website')) {
    const sent = analyzeSentiment(art.title + ' ' + (art.content || '').substring(0, 500));
    pressResults.push({
      source: 'company-blog',
      url: art.url,
      domain: (() => { try { return new URL(art.url).hostname; } catch (_) { return ''; } })(),
      title: art.title,
      snippet: (art.content || '').substring(0, 300),
      sentiment: sent.label,
      category: 'company',
    });
  }

  return { pressResults, companyArticles, press };
}

/**
 * P1 FIX: Crawl blog paths in parallel with a concurrency limit.
 * Previously each path was awaited sequentially in a for loop.
 */
async function crawlCompanyBlogParallel(companyDomain) {
  const blogPaths = ['/blog', '/actualites', '/news', '/communiques', '/presse', '/press', '/media'];
  const articles = [];

  // Fetch all blog index pages in parallel
  const indexResults = await Promise.allSettled(
    blogPaths.map(async (blogPath) => {
      const resp = await fetch(`${companyDomain}${blogPath}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; intelwatch/1.1)' },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      if (!resp.ok) return null;
      return { path: blogPath, html: await resp.text() };
    })
  );

  // Find the first path that has content
  for (const result of indexResults) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { html } = result.value;

    const links = extractArticleLinks(html, companyDomain);
    if (links.length === 0) continue;

    // P1 FIX: Scrape articles in parallel (max 10, batches of 5)
    const articleLinks = links.slice(0, 10);
    const scraped = await scrapeArticlesBatch(articleLinks);
    articles.push(...scraped);
    if (articles.length > 0) break; // found a working section
  }

  return articles;
}

function extractArticleLinks(html, companyDomain) {
  const links = new Set();
  const absRegex = /href="(https?:\/\/[^"]*(?:blog|actualit|news|communiqu|press|article)[^"]*)"/gi;
  let m;
  while ((m = absRegex.exec(html)) !== null) {
    try {
      const u = new URL(m[1]);
      if (u.hostname === new URL(companyDomain).hostname) links.add(m[1]);
    } catch (_) {}
    if (links.size >= 15) break;
  }
  const relRegex = /href="(\/(?:blog|actualit|news|communiqu|press|article)[^"]*)"/gi;
  while ((m = relRegex.exec(html)) !== null) {
    try { links.add(new URL(m[1], companyDomain).href); } catch (_) {}
    if (links.size >= 15) break;
  }
  return [...links];
}

/**
 * P1 FIX: Scrape multiple articles in parallel with concurrency limit.
 */
async function scrapeArticlesBatch(urls, concurrency = 5) {
  const articles = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(url => scrapeArticle(url))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) articles.push(r.value);
    }
  }
  return articles;
}

async function scrapeArticle(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; intelwatch/1.1)' },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) return null;
  const html = await resp.text();
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 2000);
  return { url, title, content: text, source: 'company-website' };
}

async function fetchMaSearchResults(brandName, existingPressResults) {
  const MA_SITE_DORKS = '(site:fusacq.com OR site:cfnews.net OR site:lesechos.fr OR site:maddyness.com OR site:agefi.fr)';
  const results = [];
  try {
    const { webSearch } = await import('../../scrapers/searxng-search.js');
    await new Promise(r => setTimeout(r, 600));
    const maSearch = await webSearch(`"${brandName}" (acquisition OR LBO OR rachat OR "levée de fonds" OR "entrée au capital" OR "prise de participation") ${MA_SITE_DORKS}`, { count: 10 });
    const { analyzeSentiment } = await import('../../utils/sentiment.js');
    for (const r of (maSearch.results || [])) {
      const text = ((r.title || '') + ' ' + (r.snippet || '')).toLowerCase();
      if (!text.includes(brandName.toLowerCase())) continue;
      if (existingPressResults.some(m => m.url === r.url)) continue;
      const sent = analyzeSentiment(r.title + ' ' + r.snippet);
      results.push({ source: 'ma-search', url: r.url, domain: r.domain, title: r.title, snippet: r.snippet?.substring(0, 300), sentiment: sent.label, category: 'ma' });
    }
  } catch (_) { /* silent */ }
  return results;
}

async function fetchSiteSearchArticles(companyDomain, brandName) {
  const articles = [];
  try {
    const { webSearch } = await import('../../scrapers/searxng-search.js');
    const domain = (() => { try { return new URL(companyDomain).hostname; } catch { return ''; } })();
    if (!domain) return articles;
    await new Promise(r => setTimeout(r, 600));
    const siteSearch = await webSearch(
      `site:${domain} acquisition OR rapprochement OR capital OR croissance OR partenariat OR intègre`,
      { count: 10 },
    );
    // P1 FIX: Scrape site search articles in parallel
    const urls = (siteSearch.results || []).map(r => r.url).filter(Boolean);
    const titleMap = new Map((siteSearch.results || []).map(r => [r.url, r.title]));
    const scraped = await scrapeArticlesBatch(urls, 5);
    for (const art of scraped) {
      if (!art) continue;
      art.title = art.title || titleMap.get(art.url) || art.url;
      articles.push(art);
    }
  } catch (_) {}
  return articles;
}

async function fetchLinkedInMentions(brandName) {
  const articles = [];
  try {
    const { webSearch } = await import('../../scrapers/searxng-search.js');
    await new Promise(r => setTimeout(r, 600));
    const linkedinSearch = await webSearch(
      `site:linkedin.com "${brandName}" acquisition OR croissance OR chiffre OR recrutement OR partenariat`,
      { count: 10 },
    );
    for (const r of (linkedinSearch.results || [])) {
      articles.push({ url: r.url, title: r.title, content: r.snippet || '', source: 'linkedin' });
    }
  } catch (_) {}
  return articles;
}

/**
 * P1 FIX: Scrape top M&A articles for deeper analysis — in parallel.
 * Previously each article was fetched sequentially with await in a for loop.
 */
export async function scrapeDeepMaContent(pressResults) {
  const allMaSources = pressResults.filter(m =>
    m.category === 'ma' ||
    /acquisition|rachat|rapprochement|capital|cession|intègre|accueille|rejoint|fusionne|clôture|progression|croissance/i.test(m.title || '')
  );

  const seenUrls = new Set();
  const maArticles = allMaSources.filter(a => {
    if (!a.url || seenUrls.has(a.url)) return false;
    seenUrls.add(a.url);
    if (/pappers\.fr|linkedin\.com\/company|linkedin\.com\/in/i.test(a.url)) return false;
    return true;
  });

  // P1 FIX: Parallel scraping with concurrency limit of 4
  const urls = maArticles.slice(0, 8).map(a => ({ url: a.url, title: a.title }));
  const results = await scrapeArticlesBatch(urls.map(a => a.url), 4);

  return results.map(art => art ? { ...art, source: 'press' } : null).filter(Boolean);
}

/**
 * P1 FIX: Refresh stale subsidiary financials in parallel.
 * Previously each subsidiary was refreshed sequentially with await in a for loop.
 */
export async function refreshStaleSubsidiaries(subsidiariesData, consolidatedFinances) {
  const currentYear = new Date().getFullYear();
  const staleThreshold = currentYear - 2;
  const staleSubs = subsidiariesData.filter(s => {
    const caYear = s.annee || s.caYear;
    return s.ca && caYear && caYear < staleThreshold;
  });

  if (staleSubs.length === 0) return;

  const apiKey = process.env.PAPPERS_API_KEY;
  if (!apiKey) return;

  console.log(chalk.gray(`  🔄 ${staleSubs.length} subsidiaries with stale financials (< ${staleThreshold}), refreshing from Pappers...`));

  // P1 FIX: Refresh up to 5 stale subsidiaries in parallel
  const toRefresh = staleSubs.slice(0, 5).filter(s => s.siren);
  const results = await Promise.allSettled(
    toRefresh.map(stale => refreshOneSubsidiary(stale, apiKey))
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const stale = toRefresh[i];
    if (result.status === 'fulfilled' && result.value) {
      const { latestFin, apiData } = result.value;
      if (latestFin?.annee && latestFin.annee > (stale.annee || 0)) {
        const oldYear = stale.annee;
        stale.ca = latestFin.chiffre_affaires ?? stale.ca;
        stale.resultat = latestFin.resultat ?? stale.resultat;
        stale.annee = latestFin.annee;
        console.log(chalk.gray(`    ✓ ${stale.name}: ${oldYear} → ${latestFin.annee}, CA ${latestFin.chiffre_affaires ? (latestFin.chiffre_affaires / 1e6).toFixed(1) + 'M€' : 'unchanged'}`));
        setCache(stale.siren, {
          identity: { name: apiData.nom_entreprise, nafCode: apiData.code_naf, nafLabel: apiData.libelle_code_naf, ville: apiData.siege?.ville, effectifTexte: apiData.effectif, dateCreation: apiData.date_creation },
          financialHistory: (apiData.finances || []).map(f => ({ ca: f.chiffre_affaires, resultat: f.resultat, annee: f.annee, ebitda: f.excedent_brut_exploitation, margeEbitda: f.taux_marge_EBITDA, dettesFinancieres: f.dettes_financieres, tresorerie: f.tresorerie, fondsPropres: f.fonds_propres, bfr: f.BFR, ratioEndettement: f.ratio_endettement, autonomieFinanciere: f.autonomie_financiere, rentabiliteFP: f.rentabilite_fonds_propres, margeNette: f.marge_nette, capaciteAutofinancement: f.capacite_autofinancement })),
          _subCache: true,
        });
      } else {
        console.log(chalk.gray(`    — ${stale.name}: no newer data (latest: ${latestFin?.annee || 'none'})`));
      }
    } else if (result.status === 'fulfilled' && result.value === 'credits_exhausted') {
      console.log(chalk.yellow(`    ⚠ Pappers credits exhausted, skipping refresh`));
      break;
    }
  }
}

async function refreshOneSubsidiary(stale, apiKey) {
  const resp = await fetch(`https://api.pappers.fr/v1/entreprise?api_token=${apiKey}&siren=${stale.siren}`, {
    headers: { 'User-Agent': 'intelwatch/1.1' },
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) {
    if (resp.status === 402) return 'credits_exhausted';
    return null;
  }
  const d = await resp.json();
  const latestFin = (d.finances || [])[0];
  return { latestFin, apiData: d };
}
