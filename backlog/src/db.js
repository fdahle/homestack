import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { normalizeUrl } from './urls.js';

const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, 'backlog.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS blogs (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    strategy TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    backfilled_at TEXT,
    last_scan_at TEXT,
    last_scan_status TEXT,
    last_scan_ok INTEGER
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY,
    blog_id INTEGER NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    norm_url TEXT NOT NULL,
    title TEXT NOT NULL,
    title_guessed INTEGER NOT NULL DEFAULT 0,
    published TEXT,
    discovered_at TEXT NOT NULL,
    read_at TEXT,
    starred INTEGER NOT NULL DEFAULT 0,
    ignored INTEGER NOT NULL DEFAULT 0,
    UNIQUE (blog_id, norm_url)
  );
  CREATE INDEX IF NOT EXISTS articles_norm ON articles (norm_url);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Outbound links found in posts: one row per (post, linked site)
  CREATE TABLE IF NOT EXISTS article_links (
    article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    host TEXT NOT NULL,
    url TEXT NOT NULL,
    PRIMARY KEY (article_id, host)
  );
  CREATE INDEX IF NOT EXISTS article_links_host ON article_links (host);

  -- Blogs suggested on the Discover page.
  -- status: new | later | dismissed | added | hidden (not a blog, duplicate, already tracked)
  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY,
    host TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    name TEXT,
    description TEXT,
    sources TEXT NOT NULL DEFAULT '{}',
    score REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    probe_ok INTEGER,
    samples TEXT,
    last_post TEXT,
    checked_at TEXT,
    created_at TEXT NOT NULL
  );
`);

// Columns added after the first version
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('articles', 'harvested_at')) db.exec('ALTER TABLE articles ADD COLUMN harvested_at TEXT');

const now = () => new Date().toISOString();

// Chronological order: dated posts by date, undated ones by discovery order.
const CHRONO = 'published IS NULL, published, id';

export function getSetting(key, init) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (row) return row.value;
  const value = init();
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

export const sessionSecret = () => getSetting('session_secret', () => randomBytes(32).toString('hex'));

export function readJsonSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function writeJsonSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

// --- blogs ---

function parseBlog(row) {
  return row && { ...row, config: JSON.parse(row.config) };
}

const BLOG_STATS = `
  SELECT b.*,
    COUNT(a.id) AS total,
    COUNT(a.read_at) AS read_count,
    SUM(a.starred AND a.read_at IS NULL) AS starred_unread
  FROM blogs b LEFT JOIN articles a ON a.blog_id = b.id AND a.ignored = 0`;

export function listBlogs() {
  return db.prepare(`${BLOG_STATS} GROUP BY b.id ORDER BY b.name COLLATE NOCASE`).all().map(parseBlog);
}

export function getBlog(id) {
  return parseBlog(db.prepare(`${BLOG_STATS} WHERE b.id = ? GROUP BY b.id`).get(id));
}

export function createBlog({ name, url, strategy, config }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO blogs (name, url, strategy, config, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, url, strategy, JSON.stringify(config), now());
  return Number(lastInsertRowid);
}

export function updateBlog(id, { name, url, strategy, config }) {
  db.prepare('UPDATE blogs SET name = ?, url = ?, strategy = ?, config = ? WHERE id = ?')
    .run(name, url, strategy, JSON.stringify(config), id);
}

export function deleteBlog(id) {
  db.prepare('DELETE FROM blogs WHERE id = ?').run(id);
}

export function recordScan(id, ok, status) {
  const ts = now();
  db.prepare(`UPDATE blogs SET last_scan_at = ?, last_scan_ok = ?, last_scan_status = ?,
      backfilled_at = CASE WHEN ? AND backfilled_at IS NULL THEN ? ELSE backfilled_at END
    WHERE id = ?`).run(ts, ok ? 1 : 0, status, ok ? 1 : 0, ts, id);
}

// --- articles ---

export function listArticles(blogId, { show = 'unread', sort = 'asc' } = {}) {
  const filter = { unread: 'AND read_at IS NULL', read: 'AND read_at IS NOT NULL', starred: 'AND starred = 1', all: '' }[show] ?? '';
  const rows = db.prepare(`SELECT * FROM articles WHERE blog_id = ? AND ignored = 0 ${filter} ORDER BY ${CHRONO}`).all(blogId);
  return sort === 'desc' ? rows.reverse() : rows;
}

export function getArticle(id) {
  return db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
}

export function nextUnread(blogId) {
  return db.prepare(`SELECT * FROM articles WHERE blog_id = ? AND ignored = 0 AND read_at IS NULL ORDER BY ${CHRONO} LIMIT 1`).get(blogId);
}

export function findArticlesByUrl(url) {
  const norm = normalizeUrl(url);
  if (!norm) return [];
  // http vs https and www are already folded into norm_url
  return db.prepare('SELECT a.*, b.name AS blog_name FROM articles a JOIN blogs b ON b.id = a.blog_id WHERE a.norm_url = ?').all(norm);
}

// Unread posts that appeared after the blog's history was first imported.
export function newArticles(limit = 30) {
  return db.prepare(`SELECT a.*, b.name AS blog_name FROM articles a JOIN blogs b ON b.id = a.blog_id
    WHERE a.ignored = 0 AND a.read_at IS NULL AND b.backfilled_at IS NOT NULL AND a.discovered_at > b.backfilled_at
    ORDER BY COALESCE(a.published, a.discovered_at) DESC LIMIT ?`).all(limit);
}

export function starredArticles(limit = 50) {
  return db.prepare(`SELECT a.*, b.name AS blog_name FROM articles a JOIN blogs b ON b.id = a.blog_id
    WHERE a.ignored = 0 AND a.starred = 1 AND a.read_at IS NULL ORDER BY ${CHRONO.replace(/\b(published|id)\b/g, 'a.$1')} LIMIT ?`).all(limit);
}

export function setArticleFlags(id, { read, starred, ignored }) {
  if (read !== undefined) db.prepare('UPDATE articles SET read_at = ? WHERE id = ?').run(read ? now() : null, id);
  if (starred !== undefined) db.prepare('UPDATE articles SET starred = ? WHERE id = ?').run(starred ? 1 : 0, id);
  if (ignored !== undefined) db.prepare('UPDATE articles SET ignored = ? WHERE id = ?').run(ignored ? 1 : 0, id);
  return getArticle(id);
}

export function setReadMany(ids, read) {
  const mark = db.prepare('UPDATE articles SET read_at = ? WHERE id = ?');
  const ts = read ? now() : null;
  db.exec('BEGIN');
  for (const id of ids) mark.run(ts, id);
  db.exec('COMMIT');
}

// Marks the given article and everything chronologically before it as read.
// Returns the ids that changed (for undo).
export function markOlderRead(id) {
  const target = getArticle(id);
  if (!target) return [];
  const rows = db.prepare(`SELECT id, read_at FROM articles WHERE blog_id = ? AND ignored = 0 ORDER BY ${CHRONO}`).all(target.blog_id);
  const upTo = rows.findIndex((r) => r.id === target.id);
  const changed = rows.slice(0, upTo + 1).filter((r) => !r.read_at).map((r) => r.id);
  setReadMany(changed, true);
  return changed;
}

export function knownUrls(blogId) {
  return new Set(db.prepare('SELECT norm_url FROM articles WHERE blog_id = ?').all(blogId).map((r) => r.norm_url));
}

// Inserts new articles (in the given order, so undated posts keep their sequence)
// and fills in better titles/dates for existing ones. Returns the number added.
export function upsertArticles(blogId, items) {
  const find = db.prepare('SELECT id, title_guessed, published FROM articles WHERE blog_id = ? AND norm_url = ?');
  const insert = db.prepare(`INSERT INTO articles (blog_id, url, norm_url, title, title_guessed, published, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const setTitle = db.prepare('UPDATE articles SET title = ?, title_guessed = 0 WHERE id = ?');
  const setPublished = db.prepare('UPDATE articles SET published = ? WHERE id = ?');
  const ts = now();
  let added = 0;
  db.exec('BEGIN');
  try {
    for (const item of items) {
      const norm = normalizeUrl(item.url);
      if (!norm) continue;
      const existing = find.get(blogId, norm);
      if (!existing) {
        insert.run(blogId, item.url, norm, item.title || item.url, item.titleGuessed ? 1 : 0, item.published || null, ts);
        added++;
        continue;
      }
      if (existing.title_guessed && !item.titleGuessed && item.title) setTitle.run(item.title, existing.id);
      if (!existing.published && item.published) setPublished.run(item.published, existing.id);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return added;
}

// After the include/exclude patterns change, hide posts that no longer match.
export function hideNonMatching(blogId, matches) {
  const hide = db.prepare('UPDATE articles SET ignored = 1 WHERE id = ?');
  const rows = db.prepare('SELECT id, url FROM articles WHERE blog_id = ? AND ignored = 0').all(blogId);
  const hidden = rows.filter((r) => !matches(r.url));
  db.exec('BEGIN');
  for (const r of hidden) hide.run(r.id);
  db.exec('COMMIT');
  return hidden.length;
}

// --- harvesting: visiting each post once for its real title (sitemap posts) and its outbound links ---

// Guessed titles first (visible in the lists), then posts you read (they say most about your taste).
export function articlesToHarvest(limit, { links }) {
  return db.prepare(`SELECT id, url, title_guessed FROM articles
    WHERE ignored = 0 AND (title_guessed = 1 OR (? AND harvested_at IS NULL))
    ORDER BY title_guessed DESC, read_at IS NULL, id DESC LIMIT ?`).all(links ? 1 : 0, limit);
}

// Only sitemap entries have guessed titles, so a date from the page itself beats the sitemap's lastmod.
export function saveHarvest(id, { title, published, links = [] }, { enrich }) {
  const insertLink = db.prepare('INSERT OR IGNORE INTO article_links (article_id, host, url) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  if (enrich) {
    db.prepare(`UPDATE articles SET title = COALESCE(?, title), title_guessed = 0,
      published = COALESCE(?, published) WHERE id = ?`).run(title || null, published || null, id);
  }
  db.prepare('DELETE FROM article_links WHERE article_id = ?').run(id);
  for (const link of links) insertLink.run(id, link.host, link.url);
  db.prepare('UPDATE articles SET harvested_at = ? WHERE id = ?').run(now(), id);
  db.exec('COMMIT');
}

export function harvestProgress() {
  const { total, done } = db.prepare('SELECT COUNT(*) AS total, COUNT(harvested_at) AS done FROM articles WHERE ignored = 0').get();
  const { links } = db.prepare('SELECT COUNT(*) AS links FROM article_links').get();
  return { total, done, links };
}

// How often each blog links to each other site, split by posts you have read.
export function linkStats() {
  return db.prepare(`SELECT l.host, a.blog_id, b.name AS blog_name, COUNT(*) AS n,
      SUM(a.read_at IS NOT NULL) AS n_read, MIN(l.url) AS url
    FROM article_links l JOIN articles a ON a.id = l.article_id JOIN blogs b ON b.id = a.blog_id
    WHERE a.ignored = 0 GROUP BY l.host, a.blog_id`).all();
}

export function recentlyRead(limit) {
  return db.prepare(`SELECT a.title, b.name AS blog_name FROM articles a JOIN blogs b ON b.id = a.blog_id
    WHERE a.read_at IS NOT NULL ORDER BY a.read_at DESC LIMIT ?`).all(limit);
}

// --- suggestions ---

function parseSuggestion(row) {
  return row && { ...row, sources: JSON.parse(row.sources), samples: row.samples ? JSON.parse(row.samples) : [] };
}

// Score = links from your blogs + Substack recommendations + Claude's pick.
const scoreOf = (s) => (s.links?.score ?? 0) + 3 * (s.substack?.length ?? 0) + (s.ai ? 4 : 0);

// Adds a suggestion or merges new evidence into an existing one; never touches its status.
export function upsertSuggestion({ host, url, name, description, sources }) {
  const existing = db.prepare('SELECT id, sources FROM suggestions WHERE host = ?').get(host);
  if (!existing) {
    db.prepare(`INSERT INTO suggestions (host, url, name, description, sources, score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(host, url, name || null, description || null, JSON.stringify(sources), scoreOf(sources), now());
    return;
  }
  const merged = { ...JSON.parse(existing.sources), ...sources };
  db.prepare(`UPDATE suggestions SET sources = ?, score = ?, name = COALESCE(name, ?), description = COALESCE(description, ?)
    WHERE id = ?`).run(JSON.stringify(merged), scoreOf(merged), name || null, description || null, existing.id);
}

export function listSuggestions(status) {
  return db.prepare('SELECT * FROM suggestions WHERE status = ? AND probe_ok = 1 ORDER BY score DESC').all(status).map(parseSuggestion);
}

export function suggestionCounts() {
  const count = (where) => db.prepare(`SELECT COUNT(*) AS n FROM suggestions WHERE ${where}`).get().n;
  return {
    new: count("status = 'new' AND probe_ok = 1"),
    later: count("status = 'later' AND probe_ok = 1"),
    unchecked: count("status IN ('new', 'later') AND probe_ok IS NULL"),
  };
}

export function getSuggestion(id) {
  return parseSuggestion(db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id));
}

export function getSuggestionByHost(host) {
  return parseSuggestion(db.prepare('SELECT * FROM suggestions WHERE host = ?').get(host));
}

export function suggestionHosts() {
  return db.prepare('SELECT host FROM suggestions').all().map((r) => r.host);
}

export function suggestionsToProbe(limit) {
  return db.prepare(`SELECT * FROM suggestions WHERE probe_ok IS NULL AND status IN ('new', 'later')
    ORDER BY score DESC LIMIT ?`).all(limit).map(parseSuggestion);
}

export function saveProbe(id, { ok, url, name, description, samples, lastPost }) {
  db.prepare(`UPDATE suggestions SET probe_ok = ?, url = COALESCE(?, url), name = COALESCE(name, ?),
      description = COALESCE(description, ?), samples = ?, last_post = ?, checked_at = ? WHERE id = ?`)
    .run(ok ? 1 : 0, url || null, name || null, description || null, JSON.stringify(samples || []), lastPost || null, now(), id);
}

export function setSuggestionStatus(id, status) {
  db.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run(status, id);
}

export function markSuggestionAdded(host) {
  db.prepare("UPDATE suggestions SET status = 'added' WHERE host = ?").run(host);
}

// --- backup ---

export function exportAll() {
  const blogs = db.prepare('SELECT * FROM blogs ORDER BY id').all().map(parseBlog);
  const articles = db.prepare('SELECT blog_id, url, title, published, read_at, starred, ignored FROM articles ORDER BY id').all();
  return {
    app: 'backlog',
    version: 1,
    exported_at: now(),
    blogs: blogs.map((b) => ({
      name: b.name,
      url: b.url,
      strategy: b.strategy,
      config: b.config,
      articles: articles.filter((a) => a.blog_id === b.id).map(({ blog_id, ...a }) => a),
    })),
  };
}

// Restores blogs and read/star state. Existing blogs are matched by URL;
// articles are added if missing, and read/starred flags are merged in.
export function importAll(data) {
  if (data?.app !== 'backlog' || !Array.isArray(data.blogs)) throw new Error('Not a Backlog export file');
  const findBlog = db.prepare('SELECT id, url FROM blogs');
  const update = db.prepare(`UPDATE articles SET
      read_at = COALESCE(read_at, ?), starred = MAX(starred, ?), ignored = MAX(ignored, ?)
    WHERE blog_id = ? AND norm_url = ?`);
  let blogsAdded = 0;
  for (const blog of data.blogs) {
    const existing = findBlog.all().find((b) => normalizeUrl(b.url) === normalizeUrl(blog.url));
    let blogId = existing?.id;
    if (!blogId) {
      blogId = createBlog({ name: blog.name, url: blog.url, strategy: blog.strategy, config: blog.config || {} });
      db.prepare('UPDATE blogs SET backfilled_at = ? WHERE id = ?').run(now(), blogId);
      blogsAdded++;
    }
    const articles = blog.articles || [];
    upsertArticles(blogId, articles.map((a) => ({ url: a.url, title: a.title, published: a.published })));
    db.exec('BEGIN');
    for (const a of articles) {
      update.run(a.read_at || null, a.starred ? 1 : 0, a.ignored ? 1 : 0, blogId, normalizeUrl(a.url));
    }
    db.exec('COMMIT');
  }
  return { blogsAdded };
}
