# Revise — State PSC PYQ Answer Retention

A spaced-repetition PWA for retaining answers to previous-year questions (PYQs) from state Public Service Commission Mains exams (TSPSC, APPSC, UPSC, and others). Add a question, generate or write a structured model answer, and review it on an FSRS schedule. Runs entirely in your browser — all data stays in IndexedDB on your device, no backend, no account required.

## Running it

Service workers (needed for offline/installable behavior) require a real HTTP origin — opening `index.html` directly via `file://` won't register the service worker, though the app still mostly works.

Easiest local options:

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000` (or whatever port). To install as an app: open the URL in Chrome/Edge and use "Install app" from the browser menu, or "Add to Home Screen" on Android/iOS Safari.

To actually use it day-to-day, host these files somewhere reachable from your phone/laptop — GitHub Pages, Netlify, Vercel, Cloudflare Pages all work for a static site like this.

## Using it

**Add PYQ** has two modes:

- **Single Question** — type or paste one question, click "✦ Generate Answer with AI" to get a structured model answer (a list of key points: definition/intro, body points with facts and examples, data where relevant, and a conclusion), edit the points freely, then Save. You can also skip AI entirely and type your own points directly into the box.
- **Multiple Questions** — paste a whole list of questions (numbered like "1. ...", or one per paragraph) and click "Parse & Add to List", or upload a photo of a question paper and click "✦ Extract from Image & Add to List" (uses the AI provider's vision capability to read questions straight off the page). Either way, questions land in a shared staging list where you can edit them, generate answers one at a time or all at once ("✦ Generate Answers for All"), and then "Save All Cards".

Set PSC / Year / Paper / extra tags above either mode — they're applied to whatever you save from that batch, and become filters in Browse later.

AI calls go directly from your browser to the provider's API (Claude, OpenAI, or Gemini — pick one in Settings, with per-provider keys and model overrides) — no server in between, which also means CORS restrictions on the provider's side are out of your (and my) control. If a provider ever rejects direct browser calls, switch providers.

**Review** — due cards are queued automatically, question first. Space reveals the model answer's key points, 1–4 rates it (Again/Hard/Good/Easy), same as Anki. Each rating button previews the interval it'll produce before you commit — the point isn't to recognize the answer, it's to actually try recalling the points before you reveal them.

**Browse** — search across questions and answer points, filter by PSC, tag, or review state, delete cards.

**Stats** — due count, retention rate, reviews-per-day chart.

**Settings** — API keys and model overrides per provider, target retention (default 90%), daily new/review limits, sync setup (see below), and JSON export/import for a manual backup.

**Sync across devices** — optional, backed by your own free Firebase project. See `SYNC_SETUP.md` for the 5-minute setup. Once configured, cards/reviews/settings sync in real time between your phone and laptop; conflicts (e.g. edited on both devices while offline) resolve last-write-wins per record. Without sync configured, the app works exactly as before — fully local, fully offline.

## How scheduling works

Uses FSRS (Free Spaced Repetition Scheduler) in its long-term mode — every rating schedules the next review in whole days based on the card's stability and difficulty, rather than Anki's minute-level learning steps. This fits a daily revision routine better than cramming-oriented step queues. It ships with FSRS's published default weights; if you want it tuned to your own memory patterns from accumulated review history, that's a natural next step (FSRS supports per-user weight optimization from review logs) but isn't implemented yet.

## What this does and doesn't do

This keeps the raw material a mains answer needs — facts, dates, scheme details, examples, data points, the shape of the argument — fresh in memory between now and the exam, using retrieval practice (recalling before revealing) and spaced timing (resurfacing right before you'd forget) rather than passive rereading. It does not teach answer-writing structure, synthesis across topics, or exam-time management — those need actual timed answer-writing practice, ideally with feedback, as a separate activity alongside this.

## What's not in v1

Anki `.apkg` import/export (JSON backup covers your own data safety, just not Anki interop), per-question difficulty weighting by marks value, and FSRS parameter optimization from your own review history. All straightforward to add on top of this if useful later.

## File layout

```
index.html            shell + all views
manifest.webmanifest  PWA manifest
sw.js                  service worker (offline app-shell caching)
css/style.css
js/db.js               IndexedDB layer (cards, sources, review logs, settings)
js/fsrs.js              FSRS scheduling algorithm
js/qa.js                sanitization, plain-text helpers, bulk question-list parsing, review rendering
js/ai.js                Claude/OpenAI/Gemini answer generation + image question extraction
js/sync.js              optional Firebase sync (auth, Firestore, last-write-wins merge)
js/app.js               UI wiring for all views
icons/                  app icons
SYNC_SETUP.md          step-by-step guide for enabling cross-device sync
```
