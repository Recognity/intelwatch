import axios from 'axios';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
];

function randomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetch(url, options = {}) {
  const {
    retries = 3,
    delay = 1500,
    timeout = 15000,
    headers = {},
  } = options;

  const config = {
    url,
    method: options.method || 'GET',
    timeout,
    headers: {
      'User-Agent': randomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      ...headers,
    },
    maxRedirects: 5,
    validateStatus: status => status < 500,
  };

  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (attempt > 1) {
        const backoff = delay * Math.pow(2, attempt - 2);
        await sleep(backoff);
      }

      const response = await axios(config);

      if (response.status === 429) {
        const retryAfter = parseInt(response.headers['retry-after'] || '60', 10);
        if (attempt < retries) {
          await sleep(retryAfter * 1000);
          continue;
        }
        throw new Error(`Rate limited (429) after ${retries} attempts`);
      }

      return response;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

export async function fetchWithDelay(url, options = {}) {
  const minDelay = options.minDelay ?? 1000;
  const maxDelay = options.maxDelay ?? 2000;
  const jitter = Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;
  await sleep(jitter);
  return fetch(url, options);
}

export { sleep };
