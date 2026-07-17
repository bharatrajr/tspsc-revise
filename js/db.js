// IndexedDB data layer. Single DB, four object stores: cards, sources, reviewLogs, settings.

const DB_NAME = "revise-srs";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains("cards")) {
        const cards = db.createObjectStore("cards", { keyPath: "id" });
        cards.createIndex("due", "due");
        cards.createIndex("state", "state");
        cards.createIndex("sourceId", "sourceId");
        cards.createIndex("tags", "tags", { multiEntry: true });
      }

      if (!db.objectStoreNames.contains("sources")) {
        db.createObjectStore("sources", { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains("reviewLogs")) {
        const logs = db.createObjectStore("reviewLogs", { keyPath: "id" });
        logs.createIndex("cardId", "cardId");
        logs.createIndex("reviewedAt", "reviewedAt");
      }

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeNames, mode) {
  return openDb().then((db) => db.transaction(storeNames, mode));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid() {
  return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

// ---------- Generic helpers ----------

export async function putRecord(store, record) {
  const t = await tx([store], "readwrite");
  const p = reqToPromise(t.objectStore(store).put(record));
  return p;
}

export async function deleteRecord(store, id) {
  const t = await tx([store], "readwrite");
  return reqToPromise(t.objectStore(store).delete(id));
}

export async function getRecord(store, id) {
  const t = await tx([store], "readonly");
  return reqToPromise(t.objectStore(store).get(id));
}

export async function getAll(store) {
  const t = await tx([store], "readonly");
  return reqToPromise(t.objectStore(store).getAll());
}

// ---------- Cards ----------

export async function getAllCards() {
  return getAll("cards");
}

export async function getCard(id) {
  return getRecord("cards", id);
}

export async function saveCard(card) {
  return putRecord("cards", card);
}

export async function saveCards(cards) {
  const db = await openDb();
  const t = db.transaction(["cards"], "readwrite");
  const store = t.objectStore("cards");
  cards.forEach((c) => store.put(c));
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export async function deleteCard(id) {
  return deleteRecord("cards", id);
}

export async function getDueCards(now = Date.now()) {
  const all = await getAllCards();
  return all.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}

// ---------- Sources ----------

export async function saveSource(source) {
  return putRecord("sources", source);
}

export async function getAllSources() {
  return getAll("sources");
}

// ---------- Review logs ----------

export async function addReviewLog(log) {
  return putRecord("reviewLogs", log);
}

export async function getAllReviewLogs() {
  return getAll("reviewLogs");
}

// ---------- Settings ----------

const DEFAULT_SETTINGS = {
  id: "settings",
  provider: "anthropic",
  apiKeys: { anthropic: "", openai: "", gemini: "" },
  models: { anthropic: "claude-sonnet-5", openai: "gpt-4.1", gemini: "gemini-2.0-flash" },
  requestRetention: 0.9,
  newLimit: 20,
  reviewLimit: 0
};

export async function getSettings() {
  const s = await getRecord("settings", "settings");
  return s
    ? {
        ...DEFAULT_SETTINGS,
        ...s,
        apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(s.apiKeys || {}) },
        models: { ...DEFAULT_SETTINGS.models, ...(s.models || {}) }
      }
    : { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings) {
  return putRecord("settings", { ...settings, id: "settings" });
}

// ---------- Backup ----------

export async function exportAll() {
  const [cards, sources, reviewLogs, settings] = await Promise.all([
    getAllCards(),
    getAllSources(),
    getAllReviewLogs(),
    getSettings()
  ]);
  return {
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    cards,
    sources,
    reviewLogs,
    settings
  };
}

export async function importAll(data, { merge = false } = {}) {
  const db = await openDb();
  const storeNames = ["cards", "sources", "reviewLogs", "settings"];
  const t = db.transaction(storeNames, "readwrite");

  if (!merge) {
    storeNames.forEach((s) => t.objectStore(s).clear());
  }

  (data.cards || []).forEach((c) => t.objectStore("cards").put(c));
  (data.sources || []).forEach((s) => t.objectStore("sources").put(s));
  (data.reviewLogs || []).forEach((l) => t.objectStore("reviewLogs").put(l));
  if (data.settings) t.objectStore("settings").put({ ...data.settings, id: "settings" });

  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}
