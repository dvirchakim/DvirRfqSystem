// Unified LLM client supporting Anthropic, OpenAI-compatible, and Ollama.
// Returns trimmed string on success, or { error: string } on failure.

function stripFences(text) {
  return (text || "").replace(/```json|```/g, "").trim();
}

async function callAnthropic({ apiKey, model, prompt, system, imageData, imageMimeType }) {
  if (!apiKey) return { error: "missing_key" };
  const userContent = imageData
    ? [{ type: "image", source: { type: "base64", media_type: imageMimeType || "image/jpeg", data: imageData } }, { type: "text", text: prompt }]
    : prompt;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: 2000,
      system: system || "You are a helpful assistant.",
      messages: [{ role: "user", content: userContent }],
    }),
  });
  const data = await res.json();
  if (data.error) return { error: data.error.message || "api_error", detail: data };
  const text = (data.content || []).map(b => b.text || "").join("\n");
  return stripFences(text);
}

async function callOpenAI({ baseUrl, apiKey, model, prompt, system, imageData, imageMimeType }) {
  if (!baseUrl) return { error: "missing_base_url" };
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  const userContent = imageData
    ? [{ type: "image_url", image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageData}` } }, { type: "text", text: prompt }]
    : prompt;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: model || "gpt-4o-mini",
      max_tokens: 2000,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: userContent },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) return { error: data.error.message || "api_error", detail: data };
  const text = data?.choices?.[0]?.message?.content || "";
  return stripFences(text);
}

async function callOpenRouter({ apiKey, model, prompt, system, imageData, imageMimeType }) {
  if (!apiKey) return { error: "missing_key" };
  const userContent = imageData
    ? [{ type: "image_url", image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageData}` } }, { type: "text", text: prompt }]
    : prompt;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "app://rfq-dashboard",
      "X-Title": "RFQ Dashboard",
    },
    body: JSON.stringify({
      model: model || "anthropic/claude-3.5-sonnet",
      max_tokens: 2000,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        { role: "user", content: userContent },
      ],
    }),
  });
  const data = await res.json();
  if (data.error) return { error: data.error.message || "api_error", detail: data };
  const text = data?.choices?.[0]?.message?.content || "";
  return stripFences(text);
}

async function callOllama({ baseUrl, model, prompt, system, imageData }) {
  const url = (baseUrl || "http://localhost:11434").replace(/\/$/, "") + "/api/chat";
  const userMsg = imageData
    ? { role: "user", content: prompt, images: [imageData] }
    : { role: "user", content: prompt };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "llama3.1",
      stream: false,
      messages: [
        ...(system ? [{ role: "system", content: system }] : []),
        userMsg,
      ],
    }),
  });
  if (!res.ok) return { error: `HTTP ${res.status}: ${await res.text().catch(() => "")}` };
  const data = await res.json();
  if (data.error) return { error: data.error, detail: data };
  const text = data?.message?.content || "";
  return stripFences(text);
}

export async function callLLM(prompt, system, config, imageData, imageMimeType) {
  const { provider } = config || {};
  try {
    if (provider === "openai") {
      return await callOpenAI({
        baseUrl: config.openaiBaseUrl, apiKey: config.openaiApiKey,
        model: config.openaiModel, prompt, system, imageData, imageMimeType,
      });
    }
    if (provider === "ollama") {
      return await callOllama({
        baseUrl: config.ollamaBaseUrl, model: config.ollamaModel, prompt, system, imageData,
      });
    }
    if (provider === "openrouter") {
      return await callOpenRouter({
        apiKey: config.openrouterApiKey, model: config.openrouterModel, prompt, system, imageData, imageMimeType,
      });
    }
    return await callAnthropic({
      apiKey: config.anthropicApiKey, model: config.anthropicModel,
      prompt, system, imageData, imageMimeType,
    });
  } catch (e) {
    return { error: e.message || String(e), detail: e };
  }
}

export const PROVIDERS = [
  { id: "anthropic",   label: "Anthropic (Claude)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "openai",     label: "OpenAI-compatible" },
  { id: "ollama",     label: "Ollama (Local)" },
];

export const OPENROUTER_MODELS = [
  { id: "anthropic/claude-3.5-sonnet",          label: "Claude 3.5 Sonnet" },
  { id: "anthropic/claude-3-haiku",             label: "Claude 3 Haiku (fast)" },
  { id: "openai/gpt-4o",                        label: "GPT-4o" },
  { id: "openai/gpt-4o-mini",                   label: "GPT-4o Mini (cheap)" },
  { id: "google/gemini-flash-1.5",              label: "Gemini Flash 1.5" },
  { id: "google/gemini-pro-1.5",                label: "Gemini Pro 1.5" },
  { id: "meta-llama/llama-3.1-70b-instruct",   label: "Llama 3.1 70B" },
  { id: "mistralai/mistral-large",              label: "Mistral Large" },
  { id: "deepseek/deepseek-r1",                 label: "DeepSeek R1" },
  { id: "qwen/qwen-2.5-72b-instruct",           label: "Qwen 2.5 72B (multilingual)" },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", label: "NVIDIA Nemotron 3 Super 120B (FREE)" },
];

// ─── Supplier response scoring ───────────────────────────────────────────────
// Returns 0-100. Breakdown: price savings 40pts, lead time 40pts, availability 20pts.
export function scoreSupplierResponse(resp, rfq) {
  let score = 0;
  const hasTarget = rfq?.targetPrice != null && rfq.targetPrice > 0;

  // Price savings (40 pts)
  if (hasTarget && resp.quotedPrice != null) {
    const savings = (rfq.targetPrice - resp.quotedPrice) / rfq.targetPrice;
    if (savings >= 0.20)      score += 40;
    else if (savings >= 0.10) score += 30;
    else if (savings >= 0.00) score += 18;
    // below 0 means over target → 0 pts
  } else {
    score += 20; // neutral when no target price to compare
  }

  // Lead time (40 pts)
  if (resp.leadTimeDays != null) {
    if (resp.leadTimeDays === 0)       score += 40; // in stock
    else if (resp.leadTimeDays <= 7)   score += 35;
    else if (resp.leadTimeDays <= 21)  score += 28;
    else if (resp.leadTimeDays <= 45)  score += 18;
    else if (resp.leadTimeDays <= 90)  score += 8;
    // >90 days → 0 pts
  } else if (resp.inStock) {
    score += 40;
  }

  // Availability (20 pts)
  if (resp.availableQty != null && rfq?.quantity > 0) {
    const ratio = resp.availableQty / rfq.quantity;
    if (ratio >= 1.0)      score += 20;
    else if (ratio >= 0.5) score += 12;
    else if (ratio > 0)    score += 6;
  } else if (resp.inStock) {
    score += 15;
  }

  return Math.min(100, Math.round(score));
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

export const SUPPLIER_PARSE_PROMPT = `You are a supplier response parser for an electronic components distributor.
Parse this supplier response email and extract pricing and availability. Respond ONLY in valid JSON (no markdown, no backticks, no extra text).

{
  "supplierName": "string - company name of the supplier sending this email",
  "partNumber": "string or null - part number mentioned in the response (helps match to RFQ)",
  "quotedPrice": "number or null - unit price in USD. Parse from '$1.50', '1.500 USD', '0.78$'. Return just the number.",
  "currency": "string - currency code: USD, EUR, ILS. Default USD.",
  "leadTimeDays": "number or null - lead time in calendar days. Convert: '2 weeks'=14, '4-6 weeks'=35, 'in stock'/'ex stock'=0, 'ARO' = After Receipt of Order. Return midpoint for ranges.",
  "availableQty": "number or null - stock / available quantity mentioned",
  "moq": "number or null - minimum order quantity",
  "inStock": "boolean - true if supplier explicitly states in stock / ex-stock / immediate availability",
  "notes": "string or null - date codes, warranty, packaging, conditions, country of origin, any other relevant info"
}

RULES:
- If multiple parts quoted, return data for the primary/first part.
- quotedPrice is per unit, not total. If given in non-USD, note currency and still parse the number.
- Never invent data. Use null if not mentioned.
- leadTimeDays: if no lead time stated but inStock=true, use 0.`;
