// Multi-provider AI card suggestion. Calls go directly from the browser to each
// provider's API using a user-supplied key. No backend involved.
//
// NOTE ON CORS: Anthropic's Messages API requires the
// "anthropic-dangerous-direct-browser-access" header to accept direct browser calls.
// OpenAI and Gemini generally accept browser-origin requests with just the API key.
// If a provider ever changes its CORS policy and blocks the request, the fetch will
// reject with a network error — surface that clearly rather than failing silently.

const SYSTEM_PROMPT = `You are helping a student preparing for the TSPSC Group 1 Mains exam (Telangana state civil service) turn study material into spaced-repetition flashcards.

Given a passage of text, produce a JSON array of cloze-deletion flashcard suggestions covering the important, testable facts (names, dates, numbers, definitions, causes/effects, scheme details, constitutional articles, etc.). Skip filler and editorializing.

Rules:
- Each item is one atomic fact.
- Return the ORIGINAL sentence (or a trimmed version of it) with the key term(s) wrapped in double curly braces cloze syntax: {{term}}.
- Only wrap the single most important term/phrase per sentence — keep clozes short (a word, number, date, or short phrase), not whole clauses.
- Prefer 5-15 cards for a typical paragraph; fewer for short text.
- Do not invent facts not present in the source text.

Respond with ONLY a JSON array, no prose, no markdown fences. Each item: {"text": "sentence with {{term}} marked", "tag": "short topic tag"}`;

function buildUserPrompt(sourceText) {
  return `Source text:\n\n${sourceText}\n\nReturn the JSON array now.`;
}

function extractJsonArray(raw) {
  let text = raw.trim();
  // Strip markdown code fences if the model added them despite instructions.
  text = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Model response did not contain a JSON array");
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}

async function callAnthropic(apiKey, sourceText, model) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(sourceText) }]
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.content?.map((b) => b.text).join("") || "";
  return extractJsonArray(text);
}

async function callOpenAI(apiKey, sourceText, model) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(sourceText) }
      ],
      temperature: 0.3
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  return extractJsonArray(text);
}

async function callGemini(apiKey, sourceText, model) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.0-flash")}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(sourceText) }] }],
        generationConfig: { temperature: 0.3 }
      })
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return extractJsonArray(text);
}

const PROVIDERS = {
  anthropic: { label: "Claude (Anthropic)", call: callAnthropic, defaultModel: "claude-sonnet-5" },
  openai: { label: "OpenAI", call: callOpenAI, defaultModel: "gpt-4.1" },
  gemini: { label: "Gemini (Google)", call: callGemini, defaultModel: "gemini-2.0-flash" }
};

export function listProviders() {
  return Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, defaultModel: p.defaultModel }));
}

/**
 * suggestions: [{ text: "... {{term}} ...", tag: "..." }]
 */
export async function suggestCards(providerId, apiKey, sourceText, model) {
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  if (!apiKey) throw new Error(`No API key set for ${provider.label}. Add one in Settings.`);
  if (!sourceText || sourceText.trim().length < 20) throw new Error("Paste more content before requesting AI suggestions.");

  const raw = await provider.call(apiKey, sourceText, model || provider.defaultModel);
  if (!Array.isArray(raw)) throw new Error("Unexpected response shape from model");

  return raw
    .filter((item) => item && typeof item.text === "string" && item.text.includes("{{"))
    .map((item) => ({
      text: item.text.trim(),
      tag: (item.tag || "").trim()
    }));
}

/** Converts {{term}} syntax from an AI suggestion into the app's <mark class="cloze-mark" data-c="N"> HTML. */
export function suggestionToClozeHtml(text, clozeNumber) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\{\{(.+?)\}\}/g, (_, term) => `<mark class="cloze-mark" data-c="${clozeNumber}">${term}</mark>`);
}
