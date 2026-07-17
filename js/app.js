import * as db from "./db.js";
import * as fsrs from "./fsrs.js";
import * as cloze from "./cloze.js";
import * as ai from "./ai.js";

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

let settings = null;
let reviewQueue = [];
let reviewPos = 0;
let revealed = false;
let pendingSuggestions = []; // AI suggestions not yet inserted

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  settings = await db.getSettings();
  populateProviderSelects();

  wireNav();
  wireReview();
  wireAdd();
  wireBrowse();
  wireSettings();

  await refreshDueBadge();
  await enterView("review");
}

function populateProviderSelects() {
  const providers = ai.listProviders();
  const inline = $("#ai-provider-inline");
  const settingsSelect = $("#set-provider");
  [inline, settingsSelect].forEach((sel) => {
    sel.innerHTML = "";
    providers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    });
  });
  inline.value = settings.provider;
  settingsSelect.value = settings.provider;
  inline.addEventListener("change", async () => {
    settings.provider = inline.value;
    await db.saveSettings(settings);
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function wireNav() {
  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => enterView(btn.dataset.view));
  });
}

async function enterView(view) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${view}`));

  if (view === "review") await startReviewSession();
  if (view === "browse") await loadBrowse();
  if (view === "stats") await loadStats();
  if (view === "settings") loadSettingsForm();
}

async function refreshDueBadge() {
  const due = await db.getDueCards();
  const badge = $("#due-badge");
  badge.textContent = String(due.length);
  badge.dataset.zero = due.length === 0 ? "1" : "0";
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

function wireReview() {
  $("#btn-show").addEventListener("click", showAnswer);
  $$(".btn.rating").forEach((btn) => {
    btn.addEventListener("click", () => rateCurrent(parseInt(btn.dataset.rating, 10)));
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#view-review").classList.contains("active")) return;
    if ($("#review-session").classList.contains("hidden")) return;
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      if (!revealed) showAnswer();
      return;
    }
    if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
      e.preventDefault();
      rateCurrent(parseInt(e.key, 10));
    }
  });
}

async function startReviewSession() {
  const now = Date.now();
  const due = await db.getDueCards(now);

  const newCards = due.filter((c) => c.state === fsrs.State.New);
  const reviewCards = due.filter((c) => c.state !== fsrs.State.New);

  const newLimit = settings.newLimit > 0 ? settings.newLimit : Infinity;
  const reviewLimit = settings.reviewLimit > 0 ? settings.reviewLimit : Infinity;

  reviewQueue = [...reviewCards.slice(0, reviewLimit), ...newCards.slice(0, newLimit)];
  reviewPos = 0;
  revealed = false;

  renderReviewState();
}

function currentCard() {
  return reviewQueue[reviewPos];
}

function renderReviewState() {
  const empty = $("#review-empty");
  const session = $("#review-session");

  if (reviewPos >= reviewQueue.length) {
    empty.classList.remove("hidden");
    session.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  session.classList.remove("hidden");

  const card = currentCard();
  $("#review-progress").textContent = `${reviewPos + 1} / ${reviewQueue.length}`;
  $("#review-tag").textContent = (card.tags && card.tags[0]) || "";
  $("#review-tag").style.visibility = card.tags && card.tags[0] ? "visible" : "hidden";

  revealed = false;
  $("#card-content").innerHTML = cloze.renderForReview(card.html, card.clozeIndex, false);
  $("#show-answer-row").classList.remove("hidden");
  $("#rating-row").classList.add("hidden");
}

function showAnswer() {
  const card = currentCard();
  if (!card) return;
  revealed = true;
  $("#card-content").innerHTML = cloze.renderForReview(card.html, card.clozeIndex, true);
  $("#show-answer-row").classList.add("hidden");
  const rowEl = $("#rating-row");
  rowEl.classList.remove("hidden");

  const preview = fsrs.previewIntervals(card, Date.now(), { requestRetention: settings.requestRetention });
  for (const r of [1, 2, 3, 4]) {
    $(`#int-${r}`).textContent = fsrs.formatInterval(preview[r]);
  }
}

async function rateCurrent(rating) {
  const card = currentCard();
  if (!card || !revealed) return;

  const now = Date.now();
  const before = { state: card.state, stability: card.stability, difficulty: card.difficulty };
  const updated = fsrs.schedule(card, rating, now, { requestRetention: settings.requestRetention });

  await db.saveCard(updated);
  await db.addReviewLog({
    id: db.uid(),
    cardId: card.id,
    rating,
    stateBefore: before.state,
    reviewedAt: now,
    scheduledDays: updated.scheduledDays
  });

  reviewQueue[reviewPos] = updated;
  reviewPos += 1;
  renderReviewState();
  refreshDueBadge();
}

// ---------------------------------------------------------------------------
// Add
// ---------------------------------------------------------------------------

function wireAdd() {
  const pasteArea = $("#paste-area");

  pasteArea.addEventListener("paste", (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const insertHtml = html ? cloze.sanitizeHtml(html) : escapeHtml(text).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, insertHtml);
  });

  $("#btn-mark-cloze").addEventListener("click", () => markCloze(false));
  $("#btn-mark-cloze-same").addEventListener("click", () => markCloze(true));
  $("#btn-clear-marks").addEventListener("click", () => {
    cloze.clearAllClozeMarks(pasteArea);
    updateClozeHint();
  });

  document.addEventListener("keydown", (e) => {
    if (!$("#view-add").classList.contains("active")) return;
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      markCloze(false);
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
      e.preventDefault();
      markCloze(true);
    }
  });

  pasteArea.addEventListener("input", updateClozeHint);

  $("#btn-create-cards").addEventListener("click", createCardsFromPaste);
  $("#btn-ai-suggest").addEventListener("click", runAiSuggest);
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function markCloze(sameAsLast) {
  const pasteArea = $("#paste-area");
  const n = sameAsLast ? cloze.getLastClozeNumber(pasteArea) : cloze.getNextClozeNumber(pasteArea);
  const ok = cloze.wrapSelectionAsCloze(pasteArea, n);
  if (!ok) {
    $("#cloze-count-hint").textContent = "Select some text inside the paste area first.";
  }
  updateClozeHint();
}

function updateClozeHint() {
  const pasteArea = $("#paste-area");
  const nums = cloze.extractClozeNumbers(pasteArea.innerHTML);
  $("#cloze-count-hint").textContent = nums.length
    ? `${nums.length} cloze blank${nums.length > 1 ? "s" : ""} marked → will create ${nums.length} card${nums.length > 1 ? "s" : ""}.`
    : "";
}

async function createCardsFromPaste() {
  const pasteArea = $("#paste-area");
  const html = cloze.sanitizeHtml(pasteArea.innerHTML);
  const nums = cloze.extractClozeNumbers(html);

  if (nums.length === 0) {
    $("#cloze-count-hint").textContent = "Mark at least one cloze blank before creating cards.";
    return;
  }

  const title = $("#source-title").value.trim() || "Untitled";
  const tags = $("#source-tags").value.split(",").map((t) => t.trim()).filter(Boolean);

  const sourceId = db.uid();
  await db.saveSource({ id: sourceId, title, html, tags, createdAt: Date.now() });

  const rawCards = cloze.buildCardsFromHtml(html, { sourceId, tags });
  const now = Date.now();
  const fullCards = rawCards.map((c) => ({
    id: db.uid(),
    ...fsrs.newCardFields(),
    due: now,
    html: c.html,
    clozeIndex: c.clozeIndex,
    sourceId: c.sourceId,
    sourceTitle: title,
    tags: c.tags
  }));

  await db.saveCards(fullCards);

  pasteArea.innerHTML = "";
  $("#source-title").value = "";
  $("#source-tags").value = "";
  $("#cloze-count-hint").textContent = `Created ${fullCards.length} card${fullCards.length > 1 ? "s" : ""}.`;
  pendingSuggestions = [];
  $("#ai-suggestions").innerHTML = "";

  await refreshDueBadge();
}

async function runAiSuggest() {
  const pasteArea = $("#paste-area");
  const text = cloze.plainText(cloze.stripClozeMarks(pasteArea.innerHTML));
  const statusEl = $("#ai-status");
  const providerId = $("#ai-provider-inline").value;
  const apiKey = settings.apiKeys[providerId];
  const model = settings.models[providerId];

  statusEl.textContent = "Asking the model for card suggestions…";
  $("#btn-ai-suggest").disabled = true;

  try {
    const suggestions = await ai.suggestCards(providerId, apiKey, text, model);
    pendingSuggestions = suggestions;
    renderSuggestions();
    statusEl.textContent = suggestions.length
      ? `${suggestions.length} suggestion${suggestions.length > 1 ? "s" : ""}. Add the ones you want.`
      : "No suggestions returned — try pasting more content.";
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    $("#btn-ai-suggest").disabled = false;
  }
}

function renderSuggestions() {
  const list = $("#ai-suggestions");
  list.innerHTML = "";
  pendingSuggestions.forEach((s, idx) => {
    const item = document.createElement("div");
    item.className = "suggestion-item";
    const displayHtml = escapeHtml(s.text).replace(/\{\{(.+?)\}\}/g, "<b>$1</b>");
    item.innerHTML = `
      <div class="sugg-text">${displayHtml}${s.tag ? ` <span class="hint">(${escapeHtml(s.tag)})</span>` : ""}</div>
      <div class="sugg-actions">
        <button class="btn small primary" data-action="add">Add</button>
        <button class="btn small ghost" data-action="dismiss">Dismiss</button>
      </div>`;
    item.querySelector('[data-action="add"]').addEventListener("click", () => {
      insertSuggestion(s);
      pendingSuggestions.splice(idx, 1, null);
      item.remove();
    });
    item.querySelector('[data-action="dismiss"]').addEventListener("click", () => {
      pendingSuggestions.splice(idx, 1, null);
      item.remove();
    });
    list.appendChild(item);
  });
}

function insertSuggestion(suggestion) {
  const pasteArea = $("#paste-area");
  const n = cloze.getNextClozeNumber(pasteArea);
  const html = ai.suggestionToClozeHtml(suggestion.text, n);
  const p = document.createElement("p");
  p.innerHTML = html;
  pasteArea.appendChild(p);
  if (suggestion.tag) {
    const tagsInput = $("#source-tags");
    const existing = tagsInput.value.split(",").map((t) => t.trim()).filter(Boolean);
    if (!existing.includes(suggestion.tag)) {
      existing.push(suggestion.tag);
      tagsInput.value = existing.join(", ");
    }
  }
  updateClozeHint();
}

// ---------------------------------------------------------------------------
// Browse
// ---------------------------------------------------------------------------

function wireBrowse() {
  $("#browse-search").addEventListener("input", renderBrowseList);
  $("#browse-tag-filter").addEventListener("change", renderBrowseList);
  $("#browse-state-filter").addEventListener("change", renderBrowseList);
}

let browseCards = [];

async function loadBrowse() {
  browseCards = await db.getAllCards();
  browseCards.sort((a, b) => b.due - a.due);

  const tagSet = new Set();
  browseCards.forEach((c) => (c.tags || []).forEach((t) => tagSet.add(t)));
  const tagFilter = $("#browse-tag-filter");
  const currentVal = tagFilter.value;
  tagFilter.innerHTML = '<option value="">All tags</option>';
  Array.from(tagSet).sort().forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    tagFilter.appendChild(opt);
  });
  tagFilter.value = currentVal;

  renderBrowseList();
}

function stateLabel(state) {
  if (state === fsrs.State.New) return { text: "New", cls: "state-new" };
  if (state === fsrs.State.Relearning) return { text: "Relearning", cls: "state-relearn" };
  return { text: "Review", cls: "state-review" };
}

function renderBrowseList() {
  const query = $("#browse-search").value.trim().toLowerCase();
  const tagFilterVal = $("#browse-tag-filter").value;
  const stateFilterVal = $("#browse-state-filter").value;

  const filtered = browseCards.filter((c) => {
    if (tagFilterVal && !(c.tags || []).includes(tagFilterVal)) return false;
    if (stateFilterVal !== "" && String(c.state) !== stateFilterVal) return false;
    if (query) {
      const text = cloze.plainText(c.html).toLowerCase();
      if (!text.includes(query)) return false;
    }
    return true;
  });

  $("#browse-count").textContent = `${filtered.length} card${filtered.length === 1 ? "" : "s"}`;

  const list = $("#browse-list");
  list.innerHTML = "";

  filtered.slice(0, 300).forEach((card) => {
    const el = document.createElement("div");
    el.className = "browse-item";
    const st = stateLabel(card.state);
    const dueStr = new Date(card.due).toLocaleDateString();
    const previewHtml = cloze.renderForReview(card.html, card.clozeIndex, true);
    el.innerHTML = `
      <div class="bi-text">${previewHtml}
        <div class="bi-meta">
          <span class="state-pill ${st.cls}">${st.text}</span>
          <span>due ${dueStr}</span>
          <span>reps ${card.reps}</span>
          <span>lapses ${card.lapses}</span>
          ${(card.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join("")}
        </div>
      </div>
      <div class="bi-actions">
        <button class="btn small ghost" data-action="delete">Delete</button>
      </div>`;
    el.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      await db.deleteCard(card.id);
      browseCards = browseCards.filter((c) => c.id !== card.id);
      renderBrowseList();
      refreshDueBadge();
    });
    list.appendChild(el);
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

async function loadStats() {
  const [cards, logs] = await Promise.all([db.getAllCards(), db.getAllReviewLogs()]);
  const now = Date.now();
  const dueToday = cards.filter((c) => c.due <= now).length;
  const totalCards = cards.length;
  const newCount = cards.filter((c) => c.state === fsrs.State.New).length;
  const matureCount = cards.filter((c) => c.state === fsrs.State.Review && c.stability >= 21).length;

  const last30 = logs.filter((l) => now - l.reviewedAt <= 30 * 24 * 60 * 60 * 1000);
  const successCount = last30.filter((l) => l.rating > 1).length;
  const retention = last30.length ? Math.round((successCount / last30.length) * 100) : null;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const reviewedToday = logs.filter((l) => l.reviewedAt >= startOfDay.getTime()).length;

  const grid = $("#stats-grid");
  const stats = [
    { label: "Due now", val: dueToday },
    { label: "Reviewed today", val: reviewedToday },
    { label: "Total cards", val: totalCards },
    { label: "New", val: newCount },
    { label: "Mature (21d+)", val: matureCount },
    { label: "30-day retention", val: retention === null ? "—" : `${retention}%` }
  ];
  grid.innerHTML = stats
    .map((s) => `<div class="stat-box"><div class="stat-val">${s.val}</div><div class="stat-label">${s.label}</div></div>`)
    .join("");

  drawReviewsChart(logs);
}

function drawReviewsChart(logs) {
  const canvas = $("#stats-chart");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const days = 14;
  const counts = new Array(days).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  logs.forEach((l) => {
    const d = new Date(l.reviewedAt);
    d.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays >= 0 && diffDays < days) {
      counts[days - 1 - diffDays] += 1;
    }
  });

  const max = Math.max(...counts, 1);
  const padding = 24;
  const chartW = W - padding * 2;
  const chartH = H - padding * 2;
  const barGap = 6;
  const barW = chartW / days - barGap;

  ctx.strokeStyle = "#2a3a5c";
  ctx.beginPath();
  ctx.moveTo(padding, H - padding);
  ctx.lineTo(W - padding, H - padding);
  ctx.stroke();

  counts.forEach((c, i) => {
    const barH = (c / max) * (chartH - 10);
    const x = padding + i * (barW + barGap);
    const y = H - padding - barH;
    ctx.fillStyle = "#6d8dff";
    ctx.fillRect(x, y, barW, barH);
    if (c > 0) {
      ctx.fillStyle = "#8b96b3";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(c), x + barW / 2, y - 4);
    }
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function wireSettings() {
  $("#set-retention").addEventListener("input", () => {
    $("#retention-val").textContent = `${Math.round($("#set-retention").value * 100)}%`;
  });

  $("#btn-save-settings").addEventListener("click", saveSettingsForm);

  $("#btn-export").addEventListener("click", async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `revise-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("#btn-import").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      await db.importAll(data);
      settings = await db.getSettings();
      loadSettingsForm();
      await refreshDueBadge();
      $("#settings-saved-hint").textContent = "Backup imported.";
    } catch (err) {
      $("#settings-saved-hint").textContent = `Import failed: ${err.message}`;
    }
    e.target.value = "";
  });
}

function loadSettingsForm() {
  $("#set-provider").value = settings.provider;
  $("#key-anthropic").value = settings.apiKeys.anthropic || "";
  $("#key-openai").value = settings.apiKeys.openai || "";
  $("#key-gemini").value = settings.apiKeys.gemini || "";
  $("#model-anthropic").value = settings.models.anthropic || "";
  $("#model-openai").value = settings.models.openai || "";
  $("#model-gemini").value = settings.models.gemini || "";
  $("#set-retention").value = settings.requestRetention;
  $("#retention-val").textContent = `${Math.round(settings.requestRetention * 100)}%`;
  $("#set-new-limit").value = settings.newLimit;
  $("#set-review-limit").value = settings.reviewLimit;
  $("#settings-saved-hint").textContent = "";
}

async function saveSettingsForm() {
  settings.provider = $("#set-provider").value;
  settings.apiKeys = {
    anthropic: $("#key-anthropic").value.trim(),
    openai: $("#key-openai").value.trim(),
    gemini: $("#key-gemini").value.trim()
  };
  settings.models = {
    anthropic: $("#model-anthropic").value.trim() || "claude-sonnet-5",
    openai: $("#model-openai").value.trim() || "gpt-4.1",
    gemini: $("#model-gemini").value.trim() || "gemini-2.0-flash"
  };
  settings.requestRetention = parseFloat($("#set-retention").value);
  settings.newLimit = parseInt($("#set-new-limit").value, 10) || 0;
  settings.reviewLimit = parseInt($("#set-review-limit").value, 10) || 0;

  await db.saveSettings(settings);
  $("#ai-provider-inline").value = settings.provider;
  $("#settings-saved-hint").textContent = "Saved.";
}

// ---------------------------------------------------------------------------

init();
