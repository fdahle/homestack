// Server-rendered pages. `html` escapes every interpolated value unless it is
// itself the result of `html` (or wrapped in `raw`).

import { STRATEGIES } from './discover.js';

class Safe {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const render = (v) =>
  v == null || v === false ? '' : Array.isArray(v) ? v.map(render).join('') : v instanceof Safe ? v.s : String(v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const html = (strings, ...values) => new Safe(strings.reduce((out, s, i) => out + render(values[i - 1]) + s));
export const raw = (s) => new Safe(String(s));

// Changes on every restart, so browsers fetch fresh CSS/JS after an update
const ASSET_VERSION = Date.now().toString(36);

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtDate = (iso) => (iso ? dateFmt.format(new Date(iso)) : '');

function timeAgo(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

// Icons are defined once per page as <symbol>s and referenced with <use>,
// which keeps long lists (1000+ rows) small.
const ICON_PATHS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  check: '<path d="M6 12.5l4 4 8-9"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
};
const iconSprite = raw(`<svg hidden>${Object.entries(ICON_PATHS).map(([k, p]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${p}</symbol>`).join('')}</svg>`);
const icon = Object.fromEntries(Object.keys(ICON_PATHS).map((k) => [k, raw(`<svg aria-hidden="true"><use href="#i-${k}"/></svg>`)]));

function layout({ title, header, body, flash }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f6f3ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#18181b" media="(prefers-color-scheme: dark)">
<title>${title ? `${title} · Backlog` : 'Backlog'}</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/static/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="stylesheet" href="/static/app.css?v=${ASSET_VERSION}">
<script src="/static/app.js?v=${ASSET_VERSION}" defer></script>
</head>
<body>
${iconSprite}
<header class="top">${header}</header>
<main>
${flash ? html`<p class="banner">${flash}</p>` : ''}
${body}
</main>
<div id="toast" class="toast" role="status" hidden></div>
<dialog id="sheet" class="sheet"></dialog>
</body>
</html>`;
}

const titleBar = (title, { back, actions } = {}) => html`
  ${back ? html`<a class="icon-btn" href="${back}" aria-label="Back">${icon.back}</a>` : ''}
  <h1>${title}</h1>
  <div class="actions">${actions}</div>`;

export function articleRow(a, { showBlog = false } = {}) {
  return html`<li class="art${a.read_at ? ' is-read' : ''}" data-id="${a.id}" data-read="${a.read_at ? 1 : 0}" data-starred="${a.starred}">
  <button class="check" aria-label="Toggle read">${icon.check}</button>
  <div class="art-body">
    <a class="art-title" href="${a.url}" target="_blank" rel="noopener" data-open="${a.id}">${a.title}</a>
    <div class="meta">${showBlog ? html`<span class="blog-name">${a.blog_name}</span>` : ''}${a.published ? html`<span>${fmtDate(a.published)}</span>` : ''}<span class="star-mark">${icon.star}</span></div>
  </div>
  <button class="icon-btn more" aria-label="More actions">${icon.more}</button>
</li>`;
}

function blogStatus(blog, scanning) {
  if (scanning) return html`<span class="status scanning">Scanning…</span>`;
  if (blog.last_scan_ok === 0) return html`<span class="status error">Last scan failed</span>`;
  return html`<span>checked ${timeAgo(blog.last_scan_at)}</span>`;
}

// --- pages ---

export function homePage({ blogs, fresh, starred, nextByBlog, isScanning, newSuggestions }) {
  const cards = blogs.map((b) => {
    const pct = b.total ? Math.round((b.read_count / b.total) * 100) : 0;
    const next = nextByBlog.get(b.id);
    return html`<section class="blog-card">
  <a class="blog-link" href="/blog/${b.id}">
    <div class="blog-top"><h2>${b.name}</h2><span class="unread">${b.total - b.read_count}<small> unread</small></span></div>
    <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="blog-sub"><span>${b.read_count} of ${b.total} read</span>${blogStatus(b, isScanning(b.id))}</div>
  </a>
  ${next ? html`<a class="continue" href="${next.url}" target="_blank" rel="noopener" data-open="${next.id}" data-title="${next.title}"><span>Continue</span> ${next.title}</a>` : ''}
</section>`;
  });

  const body = blogs.length
    ? html`
${fresh.length ? html`<h2 class="section">New posts</h2><ul class="list">${fresh.map((a) => articleRow(a, { showBlog: true }))}</ul>` : ''}
${starred.length ? html`<h2 class="section">Read later</h2><ul class="list">${starred.map((a) => articleRow(a, { showBlog: true }))}</ul>` : ''}
<h2 class="section">Blogs</h2>
<div class="cards">${cards}</div>`
    : html`<div class="empty">
  <p>Nothing tracked yet.</p>
  <a class="btn primary" href="/add">Add your first blog</a>
</div>`;

  return layout({
    header: titleBar('Backlog', {
      actions: html`<a class="icon-btn badged" href="/discover" aria-label="Discover blogs">${icon.compass}${newSuggestions ? html`<span class="badge">${newSuggestions}</span>` : ''}</a><a class="icon-btn" href="/add" aria-label="Add blog">${icon.plus}</a><a class="icon-btn" href="/tools" aria-label="Tools">${icon.gear}</a>`,
    }),
    body,
  });
}

export function blogPage({ blog, articles, show, sort, scanning, next }) {
  const tab = (value, label, count) =>
    html`<a class="tab${show === value ? ' active' : ''}" href="?show=${value}&sort=${sort}">${label}${count != null ? html` <small>${count}</small>` : ''}</a>`;
  const otherSort = sort === 'asc' ? 'desc' : 'asc';
  const unread = blog.total - blog.read_count;
  const pct = blog.total ? Math.round((blog.read_count / blog.total) * 100) : 0;

  const emptyText = scanning
    ? 'Looking for posts… the first import can take a few minutes.'
    : { unread: blog.total ? 'All caught up. 🎉' : 'No posts found yet.', starred: 'Nothing starred.', read: 'Nothing read yet.', all: 'No posts found yet.' }[show];

  return layout({
    title: blog.name,
    header: titleBar(blog.name, { back: '/', actions: html`<a class="icon-btn" href="/blog/${blog.id}/settings" aria-label="Blog settings">${icon.gear}</a>` }),
    body: html`
<div class="progress-line">
  <div class="bar"><span style="width:${pct}%"></span></div>
  <span>${blog.read_count} / ${blog.total} read · ${pct}%</span>
</div>
${scanning ? html`<p class="banner" data-poll="${blog.id}">Scanning for posts… this page refreshes when done.</p>` : ''}
${!scanning && blog.last_scan_ok === 0 ? html`<p class="banner error">Last scan failed: ${blog.last_scan_status} <a href="/blog/${blog.id}/settings">Settings</a></p>` : ''}
${next ? html`<a class="btn primary wide continue-btn" href="${next.url}" target="_blank" rel="noopener" data-open="${next.id}" data-title="${next.title}">Continue: ${next.title}</a>` : ''}
<nav class="toolbar">
  <div class="tabs">${tab('unread', 'Unread', unread)}${tab('all', 'All', blog.total)}${tab('starred', '★')}${tab('read', 'Read')}</div>
  <a class="icon-btn" href="?show=${show}&sort=${otherSort}" aria-label="Sort" title="${sort === 'asc' ? 'Oldest first' : 'Newest first'}">${icon.sort}</a>
</nav>
<div class="list-head">
  <input type="search" class="filter" placeholder="Filter titles…" aria-label="Filter titles">
  <span class="sort-label">${sort === 'asc' ? 'Oldest first' : 'Newest first'}</span>
</div>
${articles.length ? html`<ul class="list" data-show="${show}">${articles.map((a) => articleRow(a))}</ul>` : html`<p class="empty">${emptyText}</p>`}`,
  });
}

export function addPage({ url = '', error } = {}) {
  return layout({
    title: 'Add blog',
    header: titleBar('Add blog', { back: '/' }),
    body: html`
<form method="post" action="/add" class="form" data-busy="Looking at the site… this takes a few seconds">
  <label>Blog address
    <input name="url" type="url" inputmode="url" required placeholder="https://acoup.blog" value="${url}" autofocus>
  </label>
  ${error ? html`<p class="banner error">${error}</p>` : ''}
  <button class="btn primary wide">Add</button>
  <p class="hint">Backlog checks for a WordPress or Substack API, a sitemap and a feed, and picks whatever gives the full post history. You can change this afterwards in the blog's settings.</p>
</form>`,
  });
}

export function settingsPage({ blog, scanning, flash, test }) {
  const c = blog.config;
  const field = (name, label, hint, value = c[name]) => html`<label>${label}
    <input name="${name}" value="${value ?? ''}" autocomplete="off" spellcheck="false">
    ${hint ? html`<small>${hint}</small>` : ''}</label>`;
  return layout({
    title: `${blog.name} settings`,
    header: titleBar('Settings', { back: `/blog/${blog.id}` }),
    flash,
    body: html`
<form method="post" action="/blog/${blog.id}/settings" class="form">
  ${field('name', 'Name', '', blog.name)}
  ${field('url', 'Address', '', blog.url)}
  <label>How to find posts
    <select name="strategy">${Object.entries(STRATEGIES).map(([k, label]) => html`<option value="${k}"${k === blog.strategy ? raw(' selected') : ''}>${label}</option>`)}</select>
  </label>
  <details${['archive', 'sitemap'].includes(blog.strategy) ? raw(' open') : ''}>
    <summary>Advanced</summary>
    ${field('apiUrl', 'API URL', 'For WordPress/Substack, detected automatically.')}
    ${field('feedUrl', 'Feed URL', 'Also used on every scan to pick up new posts with proper titles.')}
    ${field('sitemapUrl', 'Sitemap URL', 'Leave empty to look in robots.txt and the usual places.')}
    ${field('archiveUrl', 'Archive page URL', 'Page that lists the posts (archive strategy).')}
    ${field('linkSelector', 'Post link selector', 'CSS selector for the post links, e.g. "h2.entry-title a" or "font a".')}
    ${field('nextSelector', 'Next page selector', 'CSS selector for the link to older posts, e.g. "a.next". Leave empty for single-page archives.')}
    <label>Archive order
      <select name="order"><option value="newest-first">Newest first</option><option value="oldest-first"${c.order === 'oldest-first' ? raw(' selected') : ''}>Oldest first</option></select>
    </label>
    ${field('maxPages', 'Max archive pages', '', c.maxPages || 100)}
    ${field('include', 'Only URLs matching (regex)', 'e.g. "/\\d{4}/\\d{2}/" to keep only dated post URLs.')}
    ${field('exclude', 'Skip URLs matching (regex)', 'e.g. "/(tag|about|shop)/"')}
  </details>
  <div class="row">
    <button class="btn primary" name="action" value="save">Save</button>
    <button class="btn" name="action" value="test" data-busy="Testing… this can take a while for big sites">Test without saving</button>
  </div>
</form>

${test ? html`<section class="test-result">
  <h2 class="section">Test: ${test.error ? 'failed' : `${test.items.length} posts found`}</h2>
  ${test.error ? html`<p class="banner error">${test.error}</p>` : html`<ol class="test-list">${test.items.slice(0, 15).map((it) => html`<li><a href="${it.url}" target="_blank" rel="noopener">${it.title}</a> <small>${fmtDate(it.published)}</small></li>`)}</ol>
  ${test.items.length > 15 ? html`<p class="hint">… and ${test.items.length - 15} more (the oldest are shown first).</p>` : ''}`}
</section>` : ''}

<h2 class="section">Scanning</h2>
<div class="card-plain">
  <p>Last scan: ${timeAgo(blog.last_scan_at)}${blog.last_scan_status ? html` — <span class="${blog.last_scan_ok === 0 ? 'error-text' : ''}">${blog.last_scan_status}</span>` : ''}${scanning ? html` <span class="status scanning">Scanning…</span>` : ''}</p>
  <form method="post" action="/blog/${blog.id}/scan" class="row">
    <button class="btn" name="full" value="0">Scan now</button>
    <button class="btn" name="full" value="1">Full rescan</button>
  </form>
  <p class="hint">A normal scan stops once it only sees known posts. A full rescan walks the whole archive again (useful after changing the settings).</p>
</div>

<h2 class="section">Danger zone</h2>
<form method="post" action="/blog/${blog.id}/delete" data-confirm="Delete ${blog.name} and its reading history?">
  <button class="btn danger">Delete blog</button>
</form>`,
  });
}

function suggestionCard(s) {
  const reasons = [];
  if (s.sources.links) {
    const blogs = [...s.sources.links.blogs].sort((a, b) => b.n - a.n);
    reasons.push(`Linked from ${s.sources.links.posts} posts: ${blogs.map((b) => `${b.name} (${b.n})`).join(', ')}`);
  }
  if (s.sources.substack?.length) reasons.push(`Recommended by ${s.sources.substack.join(', ')}`);
  if (s.sources.ai) reasons.push(`Claude: ${s.sources.ai}`);

  return html`<article class="sugg" id="s-${s.id}">
  <div class="sugg-head">
    <h2><a href="${s.url}" target="_blank" rel="noopener">${s.name || s.host}</a></h2>
    <span class="muted">${s.host}${s.last_post ? html` · last post ${fmtDate(s.last_post)}` : ''}</span>
  </div>
  ${s.description ? html`<p class="sugg-desc">${s.description}</p>` : ''}
  <ul class="why">${reasons.map((r) => html`<li>${r}</li>`)}</ul>
  ${s.samples.length ? html`<ul class="samples">${s.samples.map((p) => html`<li><a href="${p.url}" target="_blank" rel="noopener">${p.title}</a></li>`)}</ul>` : ''}
  <form method="post" action="/discover/${s.id}" class="row" data-ajax-remove="#s-${s.id}">
    <button class="btn primary" name="action" value="add" data-busy="Adding…">Add</button>
    ${s.status === 'later' ? '' : html`<button class="btn" name="action" value="later">Later</button>`}
    <button class="btn" name="action" value="dismissed">Not interested</button>
  </form>
</article>`;
}

export function discoverPage({ show, suggestions, counts, progress, status, running, aiEnabled, flash }) {
  const tab = (value, label, count) => html`<a class="tab${show === value ? ' active' : ''}" href="?show=${value}">${label} <small>${count}</small></a>`;
  const harvesting = progress.done < progress.total;
  const emptyText = show === 'later'
    ? 'Nothing saved for later.'
    : progress.done === 0
      ? 'Backlog is still reading through your blogs’ posts to see what they link to. Suggestions appear once it has gone through a good part of them.'
      : 'No suggestions right now. Try Refresh, or ask Claude.';

  return layout({
    title: 'Discover',
    header: titleBar('Discover', { back: '/' }),
    flash,
    body: html`
${running ? html`<p class="banner" data-poll-discover>Looking for blogs… this page refreshes when done.</p>` : ''}
${!running && status && !status.ok ? html`<p class="banner error">Last update failed: ${status.message}</p>` : ''}
${aiEnabled ? html`<form method="post" action="/discover/run" class="ai-box">
  <input type="hidden" name="ai" value="1">
  <input name="wish" placeholder="Optional: what are you in the mood for?" aria-label="What are you in the mood for?" maxlength="300">
  <button class="btn" data-busy="Asking…">Ask Claude</button>
</form>` : ''}
<nav class="toolbar">
  <div class="tabs">${tab('new', 'Suggestions', counts.new)}${tab('later', 'Later', counts.later)}</div>
</nav>
${suggestions.length ? html`<div class="suggs">${suggestions.map(suggestionCard)}</div>` : html`<p class="empty">${emptyText}</p>`}

<h2 class="section">How suggestions are found</h2>
<div class="card-plain">
  <p>From what your blogs link to: ${progress.links.toLocaleString('en')} links found in ${progress.done.toLocaleString('en')} of ${progress.total.toLocaleString('en')} posts${harvesting ? ' (still reading the rest in the background)' : ''}. Posts you have read count double. Plus the Substack recommendations of the Substacks you follow${aiEnabled ? ', and Claude when you ask' : ''}.</p>
  <p>Every suggestion is visited once to check it is a blog with posts.${counts.unchecked ? ` ${counts.unchecked} more are waiting to be checked.` : ''}</p>
  <p class="muted">Last update: ${status ? html`${timeAgo(status.at)} — ${status.message}` : 'never'}</p>
  <form method="post" action="/discover/run" class="row"><button class="btn" ${running ? raw('disabled') : ''}>Refresh now</button></form>
  ${aiEnabled ? '' : html`<p class="hint">Set <code>ANTHROPIC_API_KEY</code> to also get suggestions from Claude based on what you read.</p>`}
</div>

<h2 class="section">Browse by hand</h2>
<div class="card-plain links">
  <p><a href="https://ooh.directory/" target="_blank" rel="noopener">ooh.directory</a> — hand-curated directory of blogs, sorted by topic</p>
  <p><a href="https://kagi.com/smallweb" target="_blank" rel="noopener">Kagi Small Web</a> — random posts from independent personal blogs</p>
  <p><a href="https://blogroll.org/" target="_blank" rel="noopener">blogroll.org</a> — a curated list of personal blogs</p>
  <p><a href="https://hn.algolia.com/?query=favorite%20blogs&type=story" target="_blank" rel="noopener">Hacker News: “favourite blogs” threads</a></p>
</div>`,
  });
}

export function toolsPage({ origin, authEnabled }) {
  const bookmarklet = `javascript:location.href='${origin}/mark?url='+encodeURIComponent(location.href)`;
  return layout({
    title: 'Tools',
    header: titleBar('Tools', { back: '/' }),
    body: html`
<h2 class="section">Mark from the blog itself</h2>
<div class="card-plain">
  <p><strong>Android:</strong> install Backlog (browser menu → “Add to home screen” / “Install app”). Then, while reading a post, tap <em>Share → Backlog</em> and it's marked as read.</p>
  <p><strong>Desktop:</strong> drag this to your bookmarks bar and click it on any post: <a class="btn bookmarklet" href="${bookmarklet}">✓ Mark read</a></p>
  <p><strong>iPhone:</strong> create a Shortcut that accepts URLs from the share sheet and opens <code>${origin}/mark?url=</code> followed by the shared URL. Or add the bookmarklet above as a Safari bookmark.</p>
</div>

<h2 class="section">Scan</h2>
<form method="post" action="/scan-all"><button class="btn">Scan all blogs now</button></form>

<h2 class="section">Backup</h2>
<div class="card-plain">
  <p>Export everything (blogs, read and starred posts) as JSON, or restore an export. Importing merges and never un-reads anything.</p>
  <div class="row">
    <a class="btn" href="/export.json" download>Export</a>
    <label class="btn">Import<input type="file" accept="application/json,.json" id="import-file" hidden></label>
  </div>
</div>

${authEnabled ? html`<h2 class="section">Session</h2><form method="post" action="/logout"><button class="btn">Log out</button></form>` : ''}`,
  });
}

export function loginPage({ next = '/', error } = {}) {
  return layout({
    title: 'Log in',
    header: titleBar('Backlog'),
    body: html`
<form method="post" action="/login" class="form narrow">
  <input type="hidden" name="next" value="${next}">
  <label>Password <input name="password" type="password" autocomplete="current-password" required autofocus></label>
  ${error ? html`<p class="banner error">${error}</p>` : ''}
  <button class="btn primary wide">Log in</button>
</form>`,
  });
}

// Result of the bookmarklet / share target
export function markPage({ url, matches, next, guessBlog }) {
  let body;
  if (matches.length) {
    const a = matches[0];
    body = html`
<div class="mark-result">
  <div class="big-check">${icon.check}</div>
  <p>Marked as read</p>
  <h2>${a.title}</h2>
  <p class="muted">${a.blog_name}</p>
  <div class="row center">
    <button class="btn" data-undo="${matches.map((m) => m.id).join(',')}">Undo</button>
    <a class="btn" href="/blog/${a.blog_id}">Open list</a>
  </div>
  ${next ? html`<a class="btn primary wide" href="${next.url}" data-open="${next.id}" data-title="${next.title}">Next: ${next.title}</a>` : html`<p class="muted">That was the last unread post. 🎉</p>`}
</div>`;
  } else if (guessBlog) {
    body = html`
<div class="mark-result">
  <p>This page isn't in <strong>${guessBlog.name}</strong>'s list yet.</p>
  <p class="muted break">${url}</p>
  <form method="post" action="/mark/add" class="row center">
    <input type="hidden" name="url" value="${url}"><input type="hidden" name="blogId" value="${guessBlog.id}">
    <button class="btn primary">Add it as read</button>
    <a class="btn" href="/blog/${guessBlog.id}/settings">Check settings</a>
  </form>
</div>`;
  } else {
    body = html`
<div class="mark-result">
  <p>${url ? 'This site isn’t tracked yet.' : 'No URL was shared.'}</p>
  ${url ? html`<p class="muted break">${url}</p><a class="btn primary" href="/add?url=${encodeURIComponent(new URL(url).origin)}">Track this blog</a>` : ''}
</div>`;
  }
  return layout({ title: 'Mark as read', header: titleBar('Backlog', { back: '/' }), body });
}
