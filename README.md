# Revise — TSPSC Group 1 Mains SRS

A spaced-repetition PWA for turning pasted articles/notes into cloze-deletion flashcards, scheduled with FSRS. Runs entirely in your browser — all data stays in IndexedDB on your device, no backend, no account.

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

To actually use it day-to-day, host these files somewhere reachable from your phone/laptop — GitHub Pages, Netlify, Vercel, Cloudflare Pages all work for a static site like this (drag-and-drop the folder onto Netlify's deploy page is the fastest option).

## Using it

**Add** — paste an article or notes (HTML formatting is preserved). Select a word/phrase and click "Mark Cloze" (or `Ctrl+Shift+C`) to blank it out; each marked term becomes its own card, with the rest of the pasted context shown around it. "Group With Last" (`Ctrl+Shift+G`) lets two blanks share one card. "Create Cards from Marks" saves them.

**AI-assisted suggestions** — pick a provider in Settings (Claude, OpenAI, or Gemini), paste in an API key, then use "Suggest Cards with AI" in the Add view. The model proposes cloze deletions covering the key facts in the pasted text; review each suggestion and click Add to insert the ones you want, then create cards as usual. Calls go directly from your browser to the provider's API — no server in between, which also means CORS restrictions on the provider's side are out of your (and my) control. If a provider ever rejects direct browser calls, use a different provider or run a small proxy in front of it.

**Review** — due cards are queued automatically. Space reveals the answer, 1–4 rates it (Again/Hard/Good/Easy), same as Anki. Each rating button previews the interval it'll produce before you commit.

**Browse** — search, filter by tag or state, delete cards.

**Stats** — due count, retention rate, reviews-per-day chart.

**Settings** — API keys and model overrides per provider, target retention (default 90%), daily new/review limits, and JSON export/import for backup (this is your only backup mechanism since there's no cloud sync — export periodically).

## How scheduling works

Uses FSRS (Free Spaced Repetition Scheduler) in its long-term mode — every rating schedules the next review in whole days based on the card's stability and difficulty, rather than Anki's minute-level learning steps. This fits a daily revision routine better than cramming-oriented step queues. It ships with FSRS's published default weights; if you want it tuned to your own memory patterns from accumulated review history, that's a natural next step (FSRS supports per-user weight optimization from review logs) but isn't implemented yet.

## What's not in v1

Anki `.apkg` import/export (JSON backup covers your own data safety, just not Anki interop), image occlusion, and a separate answer-writing practice mode for mains-style long-form answers. All straightforward to add on top of this if useful later.

## File layout

```
index.html          shell + all views
manifest.webmanifest PWA manifest
sw.js                service worker (offline app-shell caching)
css/style.css
js/db.js             IndexedDB layer (cards, sources, review logs, settings)
js/fsrs.js            FSRS scheduling algorithm
js/cloze.js           HTML sanitization + cloze marking/parsing/rendering
js/ai.js               Claude/OpenAI/Gemini card-suggestion calls
js/app.js              UI wiring for all views
icons/                 app icons
```
