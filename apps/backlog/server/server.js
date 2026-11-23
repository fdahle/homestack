import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import { checkBlogSettings, collect, detect, STRATEGIES } from './discover.js';
import { createAuth } from './kit/auth.js';
import { BadRequest, bigJson, createApp, errorHandler, mountAccount, route, serveFrontend, toId } from './kit/http.js';
import { isScanning, queueScan, startHarvester, startScheduler } from './scanner.js';
import { aiEnabled, discoveryRunning, runDiscovery, startDiscoveryScheduler } from './suggest.js';
import { hostOf, normalizeUrl } from './urls.js';

const PORT = Number(process.env.PORT || 3066);
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
// The old name of the password setting still works
process.env.ADMIN_PASSWORD ||= process.env.APP_PASSWORD || '';

// A backup to restore may be big: up to 50 MB, read only after the login check
const app = createApp({ bigBodies: ['/api/import'] });
const auth = createAuth({ users: store.users, cookie: 'backlog_session' });

// Login, logout, /api/me; everything under /api after this needs a login
mountAccount(app, { auth, users: store.users });

const blogOr404 = (id) => {
  const blog = store.getBlog(toId(id));
  if (!blog) throw new NotFound();
  return blog;
};
class NotFound extends Error {}

// --- overview ---

app.get('/api/home', (req, res) => {
  const blogs = store.listBlogs().map((b) => ({ ...b, next: store.nextUnread(b.id), scanning: isScanning(b.id) }));
  res.json({ blogs, fresh: store.newArticles(), starred: store.starredArticles(), newSuggestions: store.suggestionCounts().new });
});

app.get('/api/settings', (req, res) => res.json({ aiEnabled, strategies: STRATEGIES }));

// --- blogs ---

// Detects how to read a blog and starts tracking it
async function addBlog(url) {
  const found = await detect(url);
  store.markSuggestionAdded(hostOf(found.url));
  const duplicate = store.listBlogs().find((b) => normalizeUrl(b.url) === normalizeUrl(found.url));
  if (duplicate) return { id: duplicate.id, found, duplicate: true };
  const id = store.createBlog(found);
  if (found.strategy !== 'archive') queueScan(id);
  return { id, found };
}

// → { id, duplicate, strategy, note }: with a note (or the archive strategy), the blog's settings need a look
app.post('/api/blogs', route(async (req, res) => {
  const url = String(req.body.url || '').trim();
  if (!url) throw new BadRequest('url_required');
  let added;
  try {
    added = await addBlog(url);
  } catch (err) {
    return res.status(400).json({ error: 'site_failed', message: err.message });
  }
  res.json({ id: added.id, duplicate: Boolean(added.duplicate), strategy: added.found.strategy, note: added.found.note || null });
}));

app.get('/api/blogs/:id', (req, res) => {
  const blog = blogOr404(req.params.id);
  const show = ['unread', 'all', 'starred', 'read'].includes(req.query.show) ? req.query.show : 'unread';
  const sort = req.query.sort === 'desc' ? 'desc' : 'asc';
  res.json({ blog, articles: store.listArticles(blog.id, { show, sort }), scanning: isScanning(blog.id), next: store.nextUnread(blog.id) });
});

app.get('/api/blogs/:id/status', (req, res) => {
  const blog = blogOr404(req.params.id);
  res.json({ scanning: isScanning(blog.id), total: blog.total, status: blog.last_scan_status });
});

// The blog's settings as sent, checked (not saved)
function editedBlog(blog, body) {
  return checkBlogSettings({
    name: body.name || blog.name,
    url: body.url || blog.url,
    strategy: Object.hasOwn(STRATEGIES, body.strategy) ? body.strategy : blog.strategy,
    config: body.config,
  });
}

app.patch('/api/blogs/:id', (req, res) => {
  const blog = blogOr404(req.params.id);
  store.updateBlog(blog.id, editedBlog(blog, req.body));
  queueScan(blog.id, { full: true });
  res.json({ blog: store.getBlog(blog.id) });
});

// Tries the settings without saving them: what would be found
app.post('/api/blogs/:id/test', route(async (req, res) => {
  const blog = blogOr404(req.params.id);
  const edited = editedBlog(blog, req.body);
  try {
    const items = await collect({ ...blog, ...edited }, { full: true });
    res.json({ count: items.length, items: items.slice(0, 15) });
  } catch (err) {
    res.json({ error: err.message });
  }
}));

app.post('/api/blogs/:id/scan', (req, res) => {
  const blog = blogOr404(req.params.id);
  queueScan(blog.id, { full: Boolean(req.body.full) });
  res.json({ ok: true });
});

app.delete('/api/blogs/:id', (req, res) => {
  store.deleteBlog(blogOr404(req.params.id).id);
  res.json({ ok: true });
});

app.post('/api/scan-all', (req, res) => {
  for (const b of store.listBlogs()) queueScan(b.id);
  res.json({ ok: true });
});

// --- posts ---

app.get('/api/articles/:id', (req, res) => {
  const article = store.getArticle(toId(req.params.id));
  if (!article) throw new NotFound();
  res.json(article);
});

app.patch('/api/articles/:id', (req, res) => {
  const { read, starred, ignored } = req.body;
  const article = store.setArticleFlags(toId(req.params.id), { read, starred, ignored });
  if (!article) throw new NotFound();
  res.json(article);
});

app.post('/api/articles/:id/read-older', (req, res) => res.json({ ids: store.markOlderRead(toId(req.params.id)) }));

app.post('/api/read-many', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
  store.setReadMany(ids, Boolean(req.body.read));
  res.json({ ok: true });
});

// --- discover ---

app.get('/api/discover', (req, res) => {
  const show = req.query.show === 'later' ? 'later' : 'new';
  res.json({
    suggestions: store.listSuggestions(show),
    counts: store.suggestionCounts(),
    progress: store.harvestProgress(),
    status: store.readJsonSetting('discover_status'),
    running: discoveryRunning(),
    aiEnabled,
  });
});

app.post('/api/discover/run', (req, res) => {
  runDiscovery({ ai: Boolean(req.body.ai), wish: String(req.body.wish || '').slice(0, 300) });
  res.json({ running: true });
});

app.get('/api/discover/status', (req, res) => res.json({ running: discoveryRunning() }));

// action: add (→ { id, strategy, note }), later, dismissed, new (back to the suggestions)
app.post('/api/discover/:id', route(async (req, res) => {
  const suggestion = store.getSuggestion(toId(req.params.id));
  if (!suggestion) throw new NotFound();
  const { action } = req.body;
  if (action === 'add') {
    try {
      const { id, found } = await addBlog(suggestion.url);
      store.setSuggestionStatus(suggestion.id, 'added');
      return res.json({ id, strategy: found.strategy, note: found.note || null });
    } catch (err) {
      return res.status(400).json({ error: 'site_failed', message: err.message });
    }
  }
  if (!['later', 'dismissed', 'new'].includes(action)) throw new BadRequest('bad_action');
  store.setSuggestionStatus(suggestion.id, action);
  res.json({ ok: true });
}));

// --- marking from the blog itself (bookmarklet, share target) ---

// The first web address in what was shared
function sharedUrl(...candidates) {
  for (const c of candidates) {
    const m = /https?:\/\/\S+/i.exec(String(c || ''));
    if (m) {
      try {
        return new URL(m[0]).href;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

function markInfo(url) {
  const matches = url ? store.findArticlesByUrl(url) : [];
  const guessBlog = !matches.length && url ? store.listBlogs().find((b) => hostOf(b.url) === hostOf(url)) || null : null;
  return { url, matches, guessBlog };
}

// Only looks: the page /mark?url=… shows it with a button that marks (POST), because any
// website can send a logged-in browser to a GET address
app.get('/api/mark', (req, res) => res.json(markInfo(sharedUrl(req.query.url, req.query.text, req.query.title))));

app.post('/api/mark', (req, res) => {
  const info = markInfo(sharedUrl(req.body.url));
  for (const m of info.matches) store.setArticleFlags(m.id, { read: true });
  res.json({ ...markInfo(info.url), next: info.matches.length ? store.nextUnread(info.matches[0].blog_id) : null });
});

// A page of a tracked blog that isn't in its list yet: add it, as read
app.post('/api/mark/add', (req, res) => {
  const url = sharedUrl(req.body.url);
  const blog = store.getBlog(toId(req.body.blogId));
  if (!url || !blog) throw new BadRequest('bad_request');
  store.upsertArticles(blog.id, [{ url, title: url, titleGuessed: true }]);
  const info = markInfo(url);
  for (const m of info.matches) store.setArticleFlags(m.id, { read: true });
  res.json({ ...markInfo(url), next: store.nextUnread(blog.id) });
});

// --- backup ---

app.get('/api/export.json', (req, res) => {
  res.attachment(`backlog-${new Date().toISOString().slice(0, 10)}.json`).json(store.exportAll());
});

app.post('/api/import', bigJson('50mb'), (req, res) => {
  try {
    res.json(store.importAll(req.body));
  } catch (err) {
    res.status(400).json({ error: 'import_failed', message: err.message });
  }
});

serveFrontend(app, distDir);

app.use(errorHandler((err, req, res) => {
  if (err instanceof NotFound) {
    res.status(404).json({ error: 'not_found' });
    return true;
  }
  return false;
}));

await auth.ensureAdmin();
app.listen(PORT, () => {
  console.log(`Backlog listening on :${PORT}`);
  startScheduler();
  startHarvester();
  startDiscoveryScheduler();
});
