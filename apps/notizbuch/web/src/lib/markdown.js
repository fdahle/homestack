// A note's Markdown as a short preview for the list: lines with their kind, the syntax taken
// out. Rendered by Vue as text (no HTML from the note ever reaches the page).

const CHECK = /^(\s*)[-*+] \[( |x|X)\]\s?(.*)$/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^#{1,6}\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^\s*(```|~~~)/;

// **bold**, _italic_, `code`, [text](url), ![alt](url), <url>, \escapes → their text.
// A \ at the end of the line is a line break (an odd number of them: an escaped \ isn't).
export function inlineText(text) {
  return text
    .replace(/(^|[^\\])((?:\\\\)*)\\$/, '$1$2')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*\\])[*_](?!\s)(.+?)(?<!\\)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!>~|=&])/g, '$1')
    .trim();
}

// → [{ kind: 'text' | 'heading' | 'bullet' | 'check' | 'quote' | 'code', text, checked?, depth? }]
// Empty lines are kept once (as paragraph breaks), never at the start or end.
export function previewLines(markdown, max = 12) {
  const out = [];
  let inFence = false;
  for (const raw of (markdown || '').split('\n')) {
    if (out.length >= max) break;
    if (FENCE.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push({ kind: 'code', text: raw });
      continue;
    }
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) {
      if (out.length && out.at(-1).kind !== 'gap') out.push({ kind: 'gap', text: '' });
    } else if (/^(\s*[-*_]){3,}$/.test(line)) {
      continue;
    } else if ((m = line.match(CHECK))) {
      out.push({ kind: 'check', checked: m[2] !== ' ', text: inlineText(m[3]), depth: Math.floor(m[1].length / 2) });
    } else if ((m = line.match(BULLET))) {
      out.push({ kind: 'bullet', text: inlineText(m[2]), depth: Math.floor(m[1].length / 2) });
    } else if ((m = line.match(HEADING))) {
      out.push({ kind: 'heading', text: inlineText(m[1]) });
    } else if ((m = line.match(QUOTE))) {
      out.push({ kind: 'quote', text: inlineText(m[1]) });
    } else {
      out.push({ kind: 'text', text: inlineText(line) });
    }
  }
  while (out.at(-1)?.kind === 'gap') out.pop();
  return out;
}

// Checklist items: { done, total } (null without any)
export function checklistCount(markdown) {
  let done = 0;
  let total = 0;
  for (const line of (markdown || '').split('\n')) {
    const m = line.match(CHECK);
    if (!m) continue;
    total++;
    if (m[2] !== ' ') done++;
  }
  return total ? { done, total } : null;
}

// The note's text without Markdown, for the search
export function plainText(markdown) {
  return (markdown || '')
    .split('\n')
    .map((line) => inlineText(line.replace(CHECK, '$3').replace(BULLET, '$2').replace(HEADING, '$1').replace(QUOTE, '$1')))
    .join('\n');
}

// What a note is called in a list when it has no title: its first line
export function firstLine(markdown) {
  return previewLines(markdown, 3).find((l) => l.text)?.text || '';
}
