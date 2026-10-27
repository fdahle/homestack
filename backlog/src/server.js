import express from 'express';
import { fileURLToPath } from 'node:url';
import * as store from './db.js';
import * as views from './views.js';
import { authEnabled, checkPassword, clearSessionCookie, requireLogin, setSessionCookie } from './auth.js';
import { collect, detect, STRATEGIES } from './discover.js';
import { isScanning, queueScan, startHarvester, startScheduler } from './scanner.js';
import { aiEnabled, discoveryRunning, runDiscovery, startDiscoveryScheduler } from './suggest.js';
import { hostOf, normalizeUrl } from './urls.js';

const PORT = Number(process.env.PORT || 3000);
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
  req.body ??= {}; // Express 5 leaves it undefined for body-less requests
  next();
});

app.use('/static', express.static(publicDir, { maxAge: '1d' }));
app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').sendFile('manifest.webmanifest', { root: publicDir }));
app.get('/sw.js', (req, res) => res.sendFile('sw.js', { root: publicDir }));

// --- login ---

const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/');

app.get('/login', (req, res) => res.send(String(views.loginPage({ next: safeNext(req.query.next) }))));
app.post('/login', async (req, res) => {
  if (!(await checkPassword(req.body.password))) {
    return res.status(401).send(String(views.loginPage({ next: safeNext(req.body.next), error: 'Wrong password' })));
  }
  setSessionCookie(req, res);
  res.redirect(safeNext(req.body.next));
});

app.use(requireLogin);

app.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.redirect('/login');
});

// --- pages ---

const page = (res, view) => res.type('html').send(String(view));
const blogOr404 = (req, res) => {
  const blog = store.getBlog(Number(req.params.id));
  if (!blog) res.status(404).send('Blog not found');
  return blog;
};

app.get('/', (req, res) => {
  const blogs = store.listBlogs();
  const nextByBlog = new Map(blogs.map((b) => [b.id, store.nextUnread(b.id)]));
  page(res, views.homePage({
    blogs,
    fresh: store.newArticles(),
    starred: store.starredArticles(),
    nextByBlog,
    isScanning,
    newSuggestions: store.suggestionCounts().new,
  }));
});

app.get('/blog/:id', (req, res) => {
  const blog = blogOr404(req, res);
  if (!blog) return;
  const show = ['unread', 'all', 'starred', 'read'].includes(req.query.show) ? req.query.show : 'unread';
  const sort = req.query.sort === 'desc' ? 'desc' : 'asc';
  page(res, views.blogPage({
    blog,
    articles: store.listArticles(blog.id, { show, sort }),
    show,
    sort,
    scanning: isScanning(blog.id),
    next: store.nextUnread(blog.id),
  }));
});

app.get('/add', (req, res) => page(res, views.addPage({ url: req.query.url })));
// Detects how to read a blog and starts tracking it. Returns the blog id and detection result.
async function addBlog(url) {
  const found = await detect(url);
  store.markSuggestionAdded(hostOf(found.url));
  const duplicate = store.listBlogs().find((b) => normalizeUrl(b.url) === normalizeUrl(found.url));
  if (duplicate) return { id: duplicate.id, found, duplicate: true };
  const id = store.createBlog(found);
  if (found.strategy !== 'archive') queueScan(id);
  return { id, found };
}

app.post('/add', async (req, res) => {
  const input = String(req.body.url || '').trim();
  let added;
  try {
    added = await addBlog(input);
  } catch (err) {
    return page(res.status(400), views.addPage({ url: input, error: `Couldn't load that site: ${err.message}` }));
  }
  const { id, found } = added;
  if (added.duplicate) return res.redirect(`/blog/${id}`);
  if (found.strategy === 'archive') {
    return res.redirect(`/blog/${id}/settings?msg=${encodeURIComponent(found.note)}`);
  }
  res.redirect(found.note ? `/blog/${id}/settings?msg=${encodeURIComponent(`Using ${STRATEGIES[found.strategy]}. ${found.note}`)}` : `/blog/${id}`);
});

app.get('/blog/:id/settings', (req, res) => {
  const blog = blogOr404(req, res);
  if (!blog) return;
  page(res, views.settingsPage({ blog, scanning: isScanning(blog.id), flash: req.query.msg }));
});

const CONFIG_FIELDS = ['apiUrl', 'feedUrl', 'sitemapUrl', 'archiveUrl', 'linkSelector', 'nextSelector', 'order', 'maxPages', 'include', 'exclude'];

app.post('/blog/:id/settings', async (req, res) => {
  const blog = blogOr404(req, res);
  if (!blog) return;
  const edited = {
    name: String(req.body.name || blog.name).trim(),
    url: String(req.body.url || blog.url).trim(),
    strategy: STRATEGIES[req.body.strategy] ? req.body.strategy : blog.strategy,
    config: {},
  };
  for (const key of CONFIG_FIELDS) {
    const value = String(req.body[key] ?? '').trim();
    if (value) edited.config[key] = value;
  }
  for (const key of ['include', 'exclude']) {
    try {
      if (edited.config[key]) new RegExp(edited.config[key]);
    } catch {
      return page(res, views.settingsPage({ blog: { ...blog, ...edited }, scanning: isScanning(blog.id), flash: `The ${key} pattern is not a valid regular expression.` }));
    }
  }

  if (req.body.action === 'test') {
    let test;
    try {
      test = { items: await collect({ ...blog, ...edited }, { full: true }) };
    } catch (err) {
      test = { error: err.message };
    }
    return page(res, views.settingsPage({ blog: { ...blog, ...edited }, scanning: isScanning(blog.id), test, flash: 'Not saved yet. Press Save to keep these settings.' }));
  }

  store.updateBlog(blog.id, edited);
  queueScan(blog.id, { full: true });
  res.redirect(`/blog/${blog.id}`);
});

app.post('/blog/:id/scan', (req, res) => {
  const blog = blogOr404(req, res);
  if (!blog) return;
  queueScan(blog.id, { full: req.body.full === '1' });
  res.redirect(`/blog/${blog.id}`);
});

app.post('/blog/:id/delete', (req, res) => {
  store.deleteBlog(Number(req.params.id));
  res.redirect('/');
});

app.get('/tools', (req, res) => page(res, views.toolsPage({ origin: `${req.protocol}://${req.get('host')}`, authEnabled })));
app.post('/scan-all', (req, res) => {
  for (const b of store.listBlogs()) queueScan(b.id);
  res.redirect('/');
});

// --- discover ---

app.get('/discover', (req, res) => {
  const show = req.query.show === 'later' ? 'later' : 'new';
  const addedBlog = req.query.added ? store.getBlog(Number(req.query.added)) : null;
  page(res, views.discoverPage({
    show,
    suggestions: store.listSuggestions(show),
    counts: store.suggestionCounts(),
    progress: store.harvestProgress(),
    status: store.readJsonSetting('discover_status'),
    running: discoveryRunning(),
    aiEnabled,
    flash: addedBlog ? `Added ${addedBlog.name}. Its posts are being imported in the background.` : req.query.msg,
  }));
});

app.post('/discover/run', (req, res) => {
  runDiscovery({ ai: req.body.ai === '1', wish: String(req.body.wish || '').slice(0, 300) });
  res.redirect('/discover');
});

app.get('/api/discover/status', (req, res) => res.json({ running: discoveryRunning() }));

app.post('/discover/:id', async (req, res) => {
  const suggestion = store.getSuggestion(Number(req.params.id));
  if (!suggestion) return res.status(404).send('Suggestion not found');
  const wantsJson = req.get('accept')?.includes('application/json');

  if (req.body.action === 'add') {
    try {
      const { id, found } = await addBlog(suggestion.url);
      store.setSuggestionStatus(suggestion.id, 'added');
      if (found.strategy === 'archive') return res.redirect(`/blog/${id}/settings?msg=${encodeURIComponent(found.note)}`);
      return res.redirect(`/discover?added=${id}`);
    } catch (err) {
      return res.redirect(`/discover?msg=${encodeURIComponent(`Couldn't add ${suggestion.host}: ${err.message}`)}`);
    }
  }

  if (['later', 'dismissed', 'new'].includes(req.body.action)) store.setSuggestionStatus(suggestion.id, req.body.action);
  if (wantsJson) return res.json({ ok: true });
  res.redirect('/discover');
});

// --- bookmarklet & share target ---

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

function markResult(res, url) {
  const matches = url ? store.findArticlesByUrl(url) : [];
  for (const m of matches) store.setArticleFlags(m.id, { read: true });
  const guessBlog = !matches.length && url ? store.listBlogs().find((b) => hostOf(b.url) === hostOf(url)) : null;
  const next = matches.length ? store.nextUnread(matches[0].blog_id) : null;
  page(res, views.markPage({ url, matches, next, guessBlog }));
}

app.get('/mark', (req, res) => markResult(res, sharedUrl(req.query.url)));
app.get('/share', (req, res) => markResult(res, sharedUrl(req.query.url, req.query.text, req.query.title)));

app.post('/mark/add', (req, res) => {
  const blogId = Number(req.body.blogId);
  const url = sharedUrl(req.body.url);
  if (!url || !store.getBlog(blogId)) return res.redirect('/');
  store.upsertArticles(blogId, [{ url, title: url, titleGuessed: true }]);
  res.redirect(`/mark?url=${encodeURIComponent(url)}`);
});

// --- JSON API used by app.js ---

app.get('/api/articles/:id', (req, res) => {
  const article = store.getArticle(Number(req.params.id));
  if (!article) return res.status(404).json({ error: 'Not found' });
  res.json(article);
});

app.post('/api/articles/:id', (req, res) => {
  const { read, starred, ignored } = req.body;
  const article = store.setArticleFlags(Number(req.params.id), { read, starred, ignored });
  if (!article) return res.status(404).json({ error: 'Not found' });
  res.json(article);
});

app.post('/api/articles/:id/read-older', (req, res) => res.json({ ids: store.markOlderRead(Number(req.params.id)) }));

app.post('/api/read-many', (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger);
  store.setReadMany(ids, Boolean(req.body.read));
  res.json({ ok: true });
});

app.get('/api/blogs/:id/status', (req, res) => {
  const blog = store.getBlog(Number(req.params.id));
  if (!blog) return res.status(404).json({ error: 'Not found' });
  res.json({ scanning: isScanning(blog.id), total: blog.total, status: blog.last_scan_status });
});

app.get('/export.json', (req, res) => {
  res.attachment(`backlog-${new Date().toISOString().slice(0, 10)}.json`).json(store.exportAll());
});

app.post('/api/import', (req, res) => {
  try {
    res.json(store.importAll(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Check the server logs.');
});

app.listen(PORT, () => {
  console.log(`Backlog listening on :${PORT}${authEnabled ? '' : ' (no APP_PASSWORD set, login disabled)'}`);
  startScheduler();
  startHarvester();
  startDiscoveryScheduler();
});
