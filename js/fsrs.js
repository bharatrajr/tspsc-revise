// FSRS (Free Spaced Repetition Scheduler) — long-term scheduler mode.
// Uses the published FSRS-4.5 default parameters. No short-term (minutes-based)
// learning steps: every rating is scheduled in whole days via stability/difficulty,
// which fits a daily revision workflow better than Anki-style same-day relearn queues.
//
// Reference algorithm: https://github.com/open-spaced-repetition/fsrs4anki (MIT/BSD-style, open spec)

export const Rating = { Again: 1, Hard: 2, Good: 3, Easy: 4 };
export const State = { New: 0, Learning: 1, Review: 2, Relearning: 3 };

export const DEFAULT_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616,
  0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466, 0.5034, 0.6567
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // = 0.9 ** (1 / DECAY) - 1, i.e. R(t=S, retention target 0.9)

const DAY_MS = 24 * 60 * 60 * 1000;

function clampDifficulty(d) {
  return Math.min(Math.max(d, 1), 10);
}

function initDifficulty(w, rating) {
  return clampDifficulty(w[4] - Math.exp(w[5] * (rating - 1)) + 1);
}

function initStability(w, rating) {
  return Math.max(w[rating - 1], 0.1);
}

function meanReversion(w, initD4, currentD) {
  return w[7] * initD4 + (1 - w[7]) * currentD;
}

function nextDifficulty(w, d, rating) {
  const nextD = d - w[6] * (rating - 3);
  return clampDifficulty(meanReversion(w, initDifficulty(w, Rating.Easy), nextD));
}

// Retrievability given elapsed days since last review and stability at that time.
export function forgettingCurve(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

function nextRecallStability(w, d, s, r, rating) {
  const hardPenalty = rating === Rating.Hard ? w[15] : 1;
  const easyBonus = rating === Rating.Easy ? w[16] : 1;
  return (
    s *
    (1 +
      Math.exp(w[8]) *
        (11 - d) *
        Math.pow(s, -w[9]) *
        (Math.exp((1 - r) * w[10]) - 1) *
        hardPenalty *
        easyBonus)
  );
}

function nextForgetStability(w, d, s, r) {
  return w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]);
}

// Days until retrievability decays to `requestRetention`, given current stability.
export function intervalFromStability(stability, requestRetention) {
  const raw = (stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
  return Math.min(Math.max(Math.round(raw), 1), 36500);
}

/**
 * Compute the next card state for a given rating, without mutating the input.
 * card: { state, stability, difficulty, due, lastReview, reps, lapses }
 * Returns a full new card object plus `intervalDays` for convenience.
 */
export function schedule(card, rating, now = Date.now(), opts = {}) {
  const w = opts.weights || DEFAULT_WEIGHTS;
  const requestRetention = opts.requestRetention ?? 0.9;

  let { state, stability, difficulty, lastReview, reps = 0, lapses = 0 } = card;

  let elapsedDays = 0;
  let r = 1;
  if (state !== State.New && lastReview) {
    elapsedDays = Math.max(0, (now - lastReview) / DAY_MS);
    r = forgettingCurve(elapsedDays, stability);
  }

  let newDifficulty, newStability, newState;

  if (state === State.New) {
    newDifficulty = initDifficulty(w, rating);
    newStability = initStability(w, rating);
    newState = rating === Rating.Again ? State.Learning : State.Review;
  } else {
    newDifficulty = nextDifficulty(w, difficulty, rating);
    if (rating === Rating.Again) {
      newStability = nextForgetStability(w, difficulty, stability, r);
      newState = State.Relearning;
      lapses += 1;
    } else {
      newStability = nextRecallStability(w, difficulty, stability, r, rating);
      newState = State.Review;
    }
  }

  const intervalDays = intervalFromStability(newStability, requestRetention);
  const due = now + intervalDays * DAY_MS;

  return {
    ...card,
    state: newState,
    difficulty: newDifficulty,
    stability: newStability,
    due,
    lastReview: now,
    reps: reps + 1,
    lapses,
    elapsedDays,
    scheduledDays: intervalDays
  };
}

/** Returns { 1: days, 2: days, 3: days, 4: days } preview without committing. */
export function previewIntervals(card, now = Date.now(), opts = {}) {
  const out = {};
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    const result = schedule(card, rating, now, opts);
    out[rating] = result.scheduledDays;
  }
  return out;
}

export function formatInterval(days) {
  if (days < 1) return "<1d";
  if (days < 30) return `${days}d`;
  if (days < 365) {
    const months = Math.round(days / 30.437 * 10) / 10;
    return `${months}mo`;
  }
  const years = Math.round((days / 365.25) * 10) / 10;
  return `${years}y`;
}

/** Build a brand-new card record in the New state. */
export function newCardFields() {
  return {
    state: State.New,
    difficulty: 0,
    stability: 0,
    due: Date.now(),
    lastReview: null,
    reps: 0,
    lapses: 0
  };
}
