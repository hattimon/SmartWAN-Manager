import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './configStore.js';

const AI_CONFIG_FILE = path.join(DATA_DIR, 'ai-routing-provider.json');
const providerDefaults = {
  openai: {
    model: 'gpt-5.6-luna',
    baseUrl: 'https://api.openai.com',
  },
  gemini: {
    model: 'gemini-3.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com',
  },
  openai_compatible: {
    model: '',
    baseUrl: '',
  },
  ollama: {
    model: 'llama3.1',
    baseUrl: 'http://127.0.0.1:11434',
  },
};

function normalizeProvider(value) {
  return ['openai', 'gemini', 'openai_compatible', 'ollama'].includes(value) ? value : 'openai';
}

function normalizeBaseUrl(value, provider) {
  const fallback = providerDefaults[provider].baseUrl;
  const text = String(value || fallback).trim().replace(/\/+$/, '');
  if (!text) return '';
  const parsed = new URL(text);
  if (provider === 'ollama') {
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Ollama endpoint must use HTTP or HTTPS.');
    return text;
  }
  if (parsed.protocol !== 'https:') throw new Error('AI endpoint must use HTTPS.');
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || /^10\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new Error('Private and local AI endpoints are blocked.');
  }
  return text;
}

async function readRawConfig() {
  try {
    return JSON.parse(await fs.readFile(AI_CONFIG_FILE, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {};
  }
}

export async function loadAiProviderConfig({ includeSecret = false } = {}) {
  const raw = await readRawConfig();
  const provider = normalizeProvider(raw.provider);
  const normalized = {
    provider,
    model: String(raw.model || providerDefaults[provider].model).trim(),
    baseUrl: normalizeBaseUrl(raw.baseUrl, provider),
    apiKey: String(raw.apiKey || ''),
    configured: provider === 'ollama'
      ? Boolean(raw.model || providerDefaults.ollama.model)
      : Boolean(raw.apiKey),
    updatedAt: String(raw.updatedAt || ''),
  };
  if (!includeSecret) normalized.apiKey = '';
  return normalized;
}

export async function saveAiProviderConfig(input = {}) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const current = await readRawConfig();
  const provider = normalizeProvider(input.provider);
  const clearApiKey = input.clearApiKey === true;
  const keepCurrentKey = normalizeProvider(current.provider) === provider;
  const apiKey = clearApiKey
    ? ''
    : String(input.apiKey || (keepCurrentKey ? current.apiKey : '') || '').trim();
  const payload = {
    provider,
    model: String(input.model || providerDefaults[provider].model).trim(),
    baseUrl: normalizeBaseUrl(input.baseUrl, provider),
    apiKey,
    updatedAt: new Date().toISOString(),
  };
  if (!payload.model) throw new Error('AI model name is required.');
  const temporary = `${AI_CONFIG_FILE}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, AI_CONFIG_FILE);
  return loadAiProviderConfig();
}

function extractOpenAiResponseText(data) {
  if (typeof data.output_text === 'string') return data.output_text;
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data?.error?.message || data?.error || data?.message || `AI request failed: ${response.status}`;
      throw new Error(String(message));
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateRoutingRulesWithAi(prompt) {
  const text = String(prompt || '').trim();
  if (!text || text.length > 60_000) throw new Error('Routing prompt is empty or too long.');
  const config = await loadAiProviderConfig({ includeSecret: true });
  if (config.provider !== 'ollama' && !config.apiKey) throw new Error('AI API key is not configured.');

  if (config.provider === 'ollama') {
    const data = await fetchJson(`${config.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        prompt: text,
        stream: false,
        format: 'json',
      }),
    });
    const output = data.response || '';
    if (!output) throw new Error('Ollama returned an empty response.');
    return { provider: config.provider, model: config.model, output };
  }

  if (config.provider === 'gemini') {
    const model = encodeURIComponent(config.model);
    const data = await fetchJson(`${config.baseUrl}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
    if (!output) throw new Error('Gemini returned an empty response.');
    return { provider: config.provider, model: config.model, output };
  }

  if (config.provider === 'openai_compatible') {
    const data = await fetchJson(`${config.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: text }],
        response_format: { type: 'json_object' },
      }),
    });
    const output = data.choices?.[0]?.message?.content || '';
    if (!output) throw new Error('The AI provider returned an empty response.');
    return { provider: config.provider, model: config.model, output };
  }

  const data = await fetchJson(`${config.baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      input: text,
      tools: [{ type: 'web_search' }],
    }),
  });
  const output = extractOpenAiResponseText(data);
  if (!output) throw new Error('OpenAI returned an empty response.');
  return { provider: config.provider, model: config.model, output };
}
