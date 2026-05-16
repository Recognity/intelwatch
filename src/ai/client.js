import chalk from 'chalk';
import { loadConfig } from '../config.js';

// Local Ollama fallback — zero-cost inference when no cloud key is set.
// Standard Ollama convention: http://localhost:11434.
// Override via OLLAMA_HOST / OLLAMA_MODEL env vars or ~/.intelwatch/config.yml.
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

/**
 * Resolve AI provider config: env vars take priority, then config file, then local Ollama.
 * Returns null ONLY if explicitly no provider.
 */
export function getAIConfig() {
  const envGoogle = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  const envOpenAI = process.env.OPENAI_API_KEY;
  const envAnthropic = process.env.ANTHROPIC_API_KEY;

  if (envGoogle) {
    return { provider: 'google', apiKey: envGoogle, model: 'gemini-2.5-flash' };
  }
  if (envOpenAI) {
    return { provider: 'openai', apiKey: envOpenAI, model: 'gpt-4o-mini' };
  }
  if (envAnthropic) {
    return { provider: 'anthropic', apiKey: envAnthropic, model: 'claude-haiku-4-5-20251001' };
  }

  // Fall back to ~/.intelwatch/config.yml ai section
  try {
    const config = loadConfig();
    const ai = config.ai;
    if (ai?.api_key) {
      const provider = ai.provider || 'openai';
      const defaultModel = provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini';
      return {
        provider,
        apiKey: ai.api_key,
        model: ai.model || defaultModel,
      };
    }
  } catch {
    // config load failure — fall through to local Ollama
  }

  // Default: local Ollama (zero cost, requires `ollama serve` running)
  return { provider: 'ollama', host: OLLAMA_HOST, model: OLLAMA_DEFAULT_MODEL };
}

export function hasAIKey() {
  return getAIConfig() !== null;
}

/**
 * Strip markdown fences and attempt to parse a string as JSON.
 * Returns true if the (stripped) text parses cleanly.
 */
function looksLikeValidJSON(text) {
  if (!text || typeof text !== 'string') return false;
  let stripped = text.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  try {
    JSON.parse(stripped);
    return true;
  } catch {
    return false;
  }
}

async function dispatchAI(systemPrompt, userPrompt, options, aiConfig) {
  const maxTokens = options.maxTokens || 1000;
  const json = !!options.json;

  // Force Ollama when --uncensored flag is used
  if (options.uncensored) {
    return callOllama(OLLAMA_HOST, OLLAMA_DEFAULT_MODEL, systemPrompt, userPrompt, maxTokens, json);
  }

  const { provider } = aiConfig;

  if (provider === 'ollama') {
    return callOllama(aiConfig.host, aiConfig.model, systemPrompt, userPrompt, maxTokens, json);
  }
  if (provider === 'google') {
    return callGoogle(aiConfig.apiKey, aiConfig.model, systemPrompt, userPrompt, maxTokens, json);
  }
  if (provider === 'anthropic') {
    return callAnthropic(aiConfig.apiKey, aiConfig.model, systemPrompt, userPrompt, maxTokens, json);
  }
  return callOpenAI(aiConfig.apiKey, aiConfig.model, systemPrompt, userPrompt, maxTokens, json);
}

/**
 * Call the AI with a system + user prompt. Returns the response text.
 * Throws on API errors.
 *
 * options.json (boolean): enable provider-native JSON mode + a single retry
 * with a strict instruction if the first response fails to parse.
 */
export async function callAI(systemPrompt, userPrompt, options = {}) {
  const aiConfig = getAIConfig();

  if (!aiConfig) {
    throw new Error(
      'No AI provider configured. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY, ' +
      'or add ai.api_key to ~/.intelwatch/config.yml. Local Ollama is the default fallback.'
    );
  }

  const firstResponse = await dispatchAI(systemPrompt, userPrompt, options, aiConfig);

  // No JSON contract requested → return raw response.
  if (!options.json) return firstResponse;

  if (looksLikeValidJSON(firstResponse)) return firstResponse;

  // One retry with aggressive system prompt suffix.
  console.log(chalk.gray('  ⚠ AI returned malformed JSON, retrying with strict instruction...'));
  const strictSystem =
    'You must return ONLY a single valid JSON object. No prose, no markdown, no fences. ' +
    'Start with { and end with }.\n\n' + systemPrompt;
  try {
    const retryResponse = await dispatchAI(strictSystem, userPrompt, options, aiConfig);
    return retryResponse;
  } catch (e) {
    // Retry network/API error → fall back to the original (possibly malformed) response;
    // the downstream extractor will run its 3 fallback strategies.
    console.error(chalk.gray(`  ⚠ JSON retry failed (${e.message}); returning original response.`));
    return firstResponse;
  }
}

async function callOpenAI(apiKey, model, systemPrompt, userPrompt, maxTokens, json = false) {
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (json) {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callAnthropic(apiKey, model, systemPrompt, userPrompt, maxTokens, json = false) {
  // Anthropic has no native JSON mode — append a strict instruction to the system prompt.
  const finalSystem = json
    ? `${systemPrompt} Return ONLY a single JSON object, no markdown fences, no prose before/after.`
    : systemPrompt;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: finalSystem,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.content[0].text.trim();
}

/**
 * Rough cost estimate for display (assumes 4 chars ≈ 1 token).
 */
export function estimateCost(inputChars, outputChars, provider = 'ollama') {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);

  if (provider === 'ollama') {
    return { inputTokens, outputTokens, cost: '0.00000 (local)' };
  }

  // gpt-4o-mini: $0.15/1M in, $0.60/1M out
  // claude-haiku: $0.25/1M in, $1.25/1M out
  const rates = provider === 'anthropic'
    ? { in: 0.25 / 1_000_000, out: 1.25 / 1_000_000 }
    : { in: 0.15 / 1_000_000, out: 0.60 / 1_000_000 };

  const cost = inputTokens * rates.in + outputTokens * rates.out;
  return { inputTokens, outputTokens, cost: cost.toFixed(5) };
}


async function callGoogle(apiKey, model, systemPrompt, userPrompt, maxTokens, json = false) {
  // Use v1beta for Gemini 2.5
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const generationConfig = {
    maxOutputTokens: maxTokens,
    temperature: 0.2,
  };
  if (json) {
    // See https://ai.google.dev/api/generate-content#GenerationConfig
    generationConfig.responseMimeType = 'application/json';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.candidates || !data.candidates[0].content) {
    throw new Error('Invalid Google API response');
  }
  return data.candidates[0].content.parts[0].text.trim();
}

async function callOllama(host, model, systemPrompt, userPrompt, maxTokens, json = false) {
  const url = `${host.replace(/\/$/, '')}/api/chat`;
  const body = {
    model: model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    stream: false,
    options: {
      num_ctx: 16384,
      num_predict: maxTokens
    }
  };
  if (json) {
    // Ollama native JSON mode — constrains output to valid JSON.
    body.format = 'json';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  if (!data.message || !data.message.content) {
    throw new Error('Invalid Ollama API response');
  }
  return data.message.content.trim();
}

/**
 * Check Ollama health and return available models.
 */
export async function checkOllamaHealth(host = OLLAMA_HOST) {
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { healthy: false, models: [], error: `HTTP ${res.status}` };
    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return { healthy: true, models, defaultModel: OLLAMA_DEFAULT_MODEL };
  } catch (err) {
    return { healthy: false, models: [], error: err.message };
  }
}
