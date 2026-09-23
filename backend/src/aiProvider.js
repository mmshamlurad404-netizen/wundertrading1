// Optional LLM-backed decision provider for the AI bot.
//
// Disabled unless the operator supplies their own OpenAI-compatible endpoint
// via NT_LLM_* environment variables. Keys are never read from any other
// source, and any failure silently falls back to the rule-based model.

export function llmConfig() {
  return {
    apiKey: process.env.NT_LLM_API_KEY || '',
    baseUrl: (process.env.NT_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.NT_LLM_MODEL || 'gpt-4o-mini',
    timeoutMs: Number(process.env.NT_LLM_TIMEOUT_MS || 15000),
  };
}

export function llmEnabled() {
  return Boolean(process.env.NT_LLM_API_KEY);
}

export function buildMessages({ symbol, timeframe, indicators = {}, recentCandles = [], baseSignal = null }) {
  const closes = recentCandles.slice(-20).map((c) => c.c);
  const summary = {
    symbol,
    timeframe,
    lastPrice: closes[closes.length - 1] ?? null,
    rsi14: indicators.rsi14 ?? null,
    ema9: indicators.ema9 ?? null,
    ema21: indicators.ema21 ?? null,
    trend: indicators.trend ?? null,
    ruleSignal: baseSignal,
    recentCloses: closes,
  };
  return [
    {
      role: 'system',
      content:
        'You are a disciplined crypto futures trading assistant. ' +
        'Reply with ONLY a JSON object: {"action":"long"|"short"|"flat","confidence":0-1,"reason":"short text"}. ' +
        'Prefer "flat" when the setup is unclear. Never invent prices.',
    },
    { role: 'user', content: JSON.stringify(summary) },
  ];
}

export function parseDecision(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  const action = String(obj?.action || '').toLowerCase();
  if (!['long', 'short', 'flat'].includes(action)) return null;
  const confidence = Number(obj?.confidence);
  return {
    action,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    reason: typeof obj?.reason === 'string' ? obj.reason.slice(0, 300) : '',
  };
}

// Ask the LLM for a decision. Returns null when disabled or on any error.
export async function llmDecide(input, { fetchImpl = fetch } = {}) {
  if (!llmEnabled()) return null;
  const cfg = llmConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: buildMessages(input),
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM status ${res.status}`);
    const data = await res.json();
    return parseDecision(data?.choices?.[0]?.message?.content);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
