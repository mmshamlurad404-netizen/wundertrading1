import test from 'node:test';
import assert from 'node:assert/strict';
import { llmEnabled, llmConfig, buildMessages, parseDecision, llmDecide } from '../src/aiProvider.js';

test('LLM is disabled without a user-provided key', async () => {
  const saved = process.env.NT_LLM_API_KEY;
  delete process.env.NT_LLM_API_KEY;
  assert.equal(llmEnabled(), false);
  assert.equal(await llmDecide({ symbol: 'BTC/USDT' }), null);
  if (saved !== undefined) process.env.NT_LLM_API_KEY = saved;
});

test('llmConfig reads the NT_LLM_* variables only', () => {
  process.env.NT_LLM_API_KEY = 'user-key';
  process.env.NT_LLM_BASE_URL = 'https://example.test/v1/';
  process.env.NT_LLM_MODEL = 'my-model';
  const cfg = llmConfig();
  assert.equal(cfg.apiKey, 'user-key');
  assert.equal(cfg.baseUrl, 'https://example.test/v1');
  assert.equal(cfg.model, 'my-model');
  delete process.env.NT_LLM_API_KEY;
  delete process.env.NT_LLM_BASE_URL;
  delete process.env.NT_LLM_MODEL;
});

test('buildMessages includes the market summary and a JSON-only instruction', () => {
  const messages = buildMessages({
    symbol: 'ETH/USDT',
    timeframe: '1m',
    indicators: { rsi14: 55, ema9: 101, ema21: 100, trend: 'up' },
    recentCandles: [{ c: 99 }, { c: 100 }, { c: 101 }],
  });
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /JSON/);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.symbol, 'ETH/USDT');
  assert.equal(payload.lastPrice, 101);
  assert.equal(payload.rsi14, 55);
});

test('parseDecision accepts raw and fenced JSON and clamps confidence', () => {
  assert.deepEqual(parseDecision('{"action":"long","confidence":0.7,"reason":"x"}'), {
    action: 'long',
    confidence: 0.7,
    reason: 'x',
  });
  const fenced = parseDecision('```json\n{"action":"SHORT","confidence":5}\n```');
  assert.equal(fenced.action, 'short');
  assert.equal(fenced.confidence, 1);
  assert.equal(parseDecision('not json'), null);
  assert.equal(parseDecision('{"action":"hold"}'), null);
});

test('llmDecide posts to the chat completions endpoint and parses the reply', async () => {
  process.env.NT_LLM_API_KEY = 'user-key';
  process.env.NT_LLM_BASE_URL = 'https://example.test/v1';
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"action":"flat","confidence":0.3,"reason":"chop"}' } }] }),
    };
  };
  const decision = await llmDecide({ symbol: 'BTC/USDT', recentCandles: [{ c: 1 }] }, { fetchImpl: fakeFetch });
  assert.equal(decision.action, 'flat');
  assert.equal(captured.url, 'https://example.test/v1/chat/completions');
  assert.equal(captured.opts.headers.Authorization, 'Bearer user-key');
  delete process.env.NT_LLM_API_KEY;
  delete process.env.NT_LLM_BASE_URL;
});

test('llmDecide returns null when the provider errors', async () => {
  process.env.NT_LLM_API_KEY = 'user-key';
  const decision = await llmDecide({ symbol: 'BTC/USDT' }, { fetchImpl: async () => ({ ok: false, status: 429 }) });
  assert.equal(decision, null);
  delete process.env.NT_LLM_API_KEY;
});
