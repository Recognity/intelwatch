import { loadConfig } from '../config.js';

/**
 * Resolve AI provider config: env vars take priority, then config file.
 * Returns null if no key is configured.
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
    // config load failure — no AI
  }

  return null;
}

export function hasAIKey() {
  return getAIConfig() !== null;
}

/**
 * Call the AI with a system + user prompt. Returns the response text.
 * Throws on API errors.
 */
export async function callAI(systemPrompt, userPrompt, options = {}) {
  const aiConfig = getAIConfig();
  if (!aiConfig) {
    throw new Error(
      'No AI API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY, ' +
      'or add ai.api_key to ~/.intelwatch/config.yml'
    );
  }

  const { provider, apiKey, model } = aiConfig;
  const maxTokens = options.maxTokens || 1000;

  if (provider === 'google') {
    return callGoogle(apiKey, model, systemPrompt, userPrompt, maxTokens);
  }
  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, systemPrompt, userPrompt, maxTokens);
  }
  return callOpenAI(apiKey, model, systemPrompt, userPrompt, maxTokens);
}

async function callOpenAI(apiKey, model, systemPrompt, userPrompt, maxTokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callAnthropic(apiKey, model, systemPrompt, userPrompt, maxTokens) {
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
      system: systemPrompt,
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
export function estimateCost(inputChars, outputChars, provider = 'openai') {
  const inputTokens = Math.ceil(inputChars / 4);
  const outputTokens = Math.ceil(outputChars / 4);

  // gpt-4o-mini: $0.15/1M in, $0.60/1M out
  // claude-haiku: $0.25/1M in, $1.25/1M out
  const rates = provider === 'anthropic'
    ? { in: 0.25 / 1_000_000, out: 1.25 / 1_000_000 }
    : { in: 0.15 / 1_000_000, out: 0.60 / 1_000_000 };

  const cost = inputTokens * rates.in + outputTokens * rates.out;
  return { inputTokens, outputTokens, cost: cost.toFixed(5) };
}


async function callGoogle(apiKey, model, systemPrompt, userPrompt, maxTokens) {
  // Use v1beta for Gemini 2.5
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.2
      }
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
