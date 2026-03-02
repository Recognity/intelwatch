import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const signaturesPath = join(__dirname, '../../data/tech-signatures.json');

let signatures = null;

function loadSignatures() {
  if (signatures) return signatures;
  signatures = JSON.parse(readFileSync(signaturesPath, 'utf8')).technologies;
  return signatures;
}

export function detectTechnologies(html, headers = {}, url = '') {
  const techs = loadSignatures();
  const detected = [];

  const lowerHtml = html.toLowerCase();
  const lowerHeaders = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), (Array.isArray(v) ? v.join(', ') : String(v || '')).toLowerCase()])
  );

  for (const tech of techs) {
    let found = false;

    // Check headers
    for (const hCheck of (tech.checks.headers || [])) {
      const headerVal = lowerHeaders[hCheck.name.toLowerCase()] || '';
      if (headerVal && new RegExp(hCheck.pattern, 'i').test(headerVal)) {
        found = true;
        break;
      }
    }

    // Check meta tags (generator etc)
    if (!found) {
      for (const mCheck of (tech.checks.meta || [])) {
        const pattern = new RegExp(mCheck.pattern, 'i');
        if (pattern.test(lowerHtml)) {
          found = true;
          break;
        }
      }
    }

    // Check script sources
    if (!found) {
      for (const scriptPattern of (tech.checks.scripts || [])) {
        if (lowerHtml.includes(scriptPattern.toLowerCase())) {
          found = true;
          break;
        }
      }
    }

    // Check HTML patterns
    if (!found) {
      for (const htmlPattern of (tech.checks.html || [])) {
        if (lowerHtml.includes(htmlPattern.toLowerCase())) {
          found = true;
          break;
        }
      }
    }

    // Check known paths in URL
    if (!found && url) {
      for (const pathPattern of (tech.checks.paths || [])) {
        if (url.includes(pathPattern)) {
          found = true;
          break;
        }
      }
    }

    if (found) {
      detected.push({ name: tech.name, category: tech.category });
    }
  }

  return detected;
}

export function diffTechStacks(prev, curr) {
  const prevNames = new Set(prev.map(t => t.name));
  const currNames = new Set(curr.map(t => t.name));

  const added = curr.filter(t => !prevNames.has(t.name));
  const removed = prev.filter(t => !currNames.has(t.name));

  return { added, removed };
}
