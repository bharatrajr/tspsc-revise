// Cloze marking, HTML sanitization, and card rendering.

const ALLOWED_TAGS = new Set([
  "P", "DIV", "SPAN", "BR", "HR", "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP",
  "MARK", "CODE", "PRE", "BLOCKQUOTE", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY",
  "TR", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6", "A", "IMG"
]);

const ALLOWED_ATTRS = {
  A: ["href", "title"],
  IMG: ["src", "alt"],
  MARK: ["class", "data-c"],
  TD: ["colspan", "rowspan"],
  TH: ["colspan", "rowspan"]
};

function isSafeUrl(url) {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  return !trimmed.startsWith("javascript:") && !trimmed.startsWith("data:text/html");
}

/** Whitelist-based sanitizer. Strips scripts/styles/event handlers/unsafe URLs. */
export function sanitizeHtml(rawHtml) {
  const container = document.createElement("div");
  container.innerHTML = rawHtml;

  const walk = (node) => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.COMMENT_NODE) {
        node.removeChild(child);
        continue;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName;
        if (!ALLOWED_TAGS.has(tag)) {
          // Unwrap disallowed tags (keep their text/children) rather than deleting content outright,
          // except fully-remove genuinely dangerous containers.
          if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "SVG", "LINK", "META"].includes(tag)) {
            node.removeChild(child);
            continue;
          }
          walk(child);
          while (child.firstChild) node.insertBefore(child.firstChild, child);
          node.removeChild(child);
          continue;
        }

        // Strip all attributes except whitelisted ones for this tag.
        const allowed = ALLOWED_ATTRS[tag] || [];
        Array.from(child.attributes).forEach((attr) => {
          if (!allowed.includes(attr.name)) child.removeAttribute(attr.name);
        });
        if (tag === "A" && child.hasAttribute("href") && !isSafeUrl(child.getAttribute("href"))) {
          child.removeAttribute("href");
        }
        if (tag === "IMG" && child.hasAttribute("src") && !isSafeUrl(child.getAttribute("src"))) {
          child.removeAttribute("src");
        }
        walk(child);
      }
    }
  };

  walk(container);
  return container.innerHTML;
}

// ---------- Cloze marking (editing) ----------

export function getNextClozeNumber(containerEl) {
  const marks = containerEl.querySelectorAll("mark.cloze-mark[data-c]");
  let max = 0;
  marks.forEach((m) => {
    const n = parseInt(m.getAttribute("data-c"), 10);
    if (n > max) max = n;
  });
  return max + 1;
}

export function getLastClozeNumber(containerEl) {
  const marks = containerEl.querySelectorAll("mark.cloze-mark[data-c]");
  let max = 0;
  marks.forEach((m) => {
    const n = parseInt(m.getAttribute("data-c"), 10);
    if (n > max) max = n;
  });
  return max || 1;
}

/** Wraps the current window selection (must be inside containerEl) in a cloze mark. Returns true on success. */
export function wrapSelectionAsCloze(containerEl, clozeNumber) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!containerEl.contains(range.commonAncestorContainer)) return false;

  const mark = document.createElement("mark");
  mark.className = "cloze-mark";
  mark.setAttribute("data-c", String(clozeNumber));

  try {
    range.surroundContents(mark);
  } catch (e) {
    // Selection spans multiple elements — fall back to extract + wrap.
    const frag = range.extractContents();
    mark.appendChild(frag);
    range.insertNode(mark);
  }
  sel.removeAllRanges();
  return true;
}

export function clearAllClozeMarks(containerEl) {
  containerEl.querySelectorAll("mark.cloze-mark").forEach((m) => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
}

export function extractClozeNumbers(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  const nums = new Set();
  container.querySelectorAll("mark.cloze-mark[data-c]").forEach((m) => {
    nums.add(parseInt(m.getAttribute("data-c"), 10));
  });
  return Array.from(nums).sort((a, b) => a - b);
}

export function stripClozeMarks(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.querySelectorAll("mark.cloze-mark").forEach((m) => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
  });
  return container.innerHTML;
}

export function plainText(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.textContent.trim();
}

// ---------- Rendering for review ----------

/**
 * Render stored cloze HTML for review.
 * activeN: which cloze number is being tested on this card.
 * revealed: false => show blank, true => show answer.
 */
export function renderForReview(html, activeN, revealed) {
  const container = document.createElement("div");
  container.innerHTML = html;

  container.querySelectorAll("mark.cloze-mark[data-c]").forEach((m) => {
    const n = parseInt(m.getAttribute("data-c"), 10);
    if (n === activeN) {
      m.className = revealed ? "cloze-reveal" : "cloze-blank";
      if (!revealed) {
        const text = m.textContent;
        m.textContent = "[" + "...".padEnd(Math.min(Math.max(text.length, 3), 10), ".") + "]";
      }
    } else {
      m.className = "cloze-other";
    }
  });

  return container.innerHTML;
}

/** Builds card records from marked-up contenteditable HTML. One card per distinct cloze number. */
export function buildCardsFromHtml(html, { sourceId, tags }) {
  const nums = extractClozeNumbers(html);
  return nums.map((n) => ({
    html,
    clozeIndex: n,
    sourceId,
    tags: tags || []
  }));
}
