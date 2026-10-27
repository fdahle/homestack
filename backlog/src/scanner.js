// Runs scans one blog at a time (gentle on the sites, simple for SQLite),
// rescans every blog periodically, and visits each post once in the background.

import * as store from './db.js';
import { collect, feed, fetchArticleDetails, sleep, urlFilter } from './discover.js';

const SCAN_INTERVAL_HOURS = Number(process.env.SCAN_INTERVAL_HOURS || 12);
const HARVEST_LINKS = process.env.HARVEST_LINKS !== '0';
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1000);

const queue = [];
const queued = new Set();
let current = null;

export const isScanning = (blogId) => current === blogId || queued.has(blogId);

export function queueScan(blogId, { full = false } = {}) {
  if (queued.has(blogId)) {
    if (full) queue.find((job) => job.blogId === blogId).full = true;
    return;
  }
  // A blog that is scanning right now gets queued again: its settings may have changed
  queued.add(blogId);
  queue.push({ blogId, full });
  if (current === null) drain();
}

async function drain() {
  while (queue.length) {
    const { blogId, full } = queue.shift();
    queued.delete(blogId);
    current = blogId;
    try {
      await scanBlog(blogId, { full });
    } catch (err) {
      console.error(`scan of blog ${blogId} crashed:`, err);
    }
    current = null;
  }
}

async function scanBlog(blogId, { full }) {
  const blog = store.getBlog(blogId);
  if (!blog) return;
  const started = Date.now();
  try {
    const known = store.knownUrls(blogId);
    const items = await collect(blog, { known, full: full || !blog.backfilled_at });
    let added = store.upsertArticles(blogId, items);

    // The feed has proper titles and dates, so use it to fill gaps from other strategies
    if (blog.strategy !== 'feed' && blog.config.feedUrl) {
      try {
        added += store.upsertArticles(blogId, await feed(blog));
      } catch {
        // the main strategy already worked; a broken feed is not worth failing over
      }
    }
    if (blog.config.include || blog.config.exclude) store.hideNonMatching(blogId, urlFilter(blog.config));

    const secs = Math.round((Date.now() - started) / 1000);
    store.recordScan(blogId, true, `${added} new, ${items.length} found (${secs}s)`);
    console.log(`scanned "${blog.name}": ${added} new`);
  } catch (err) {
    store.recordScan(blogId, false, err.message);
    console.warn(`scan of "${blog.name}" failed: ${err.message}`);
  }
}

// Visits every post once: sitemap posts get their real title and date, and the
// outbound links feed the Discover page. Runs alongside scans, one request at a time.
const failures = new Map();

async function harvestBatch() {
  const batch = store.articlesToHarvest(20, { links: HARVEST_LINKS });
  let failed = 0;
  for (const article of batch) {
    const enrich = article.title_guessed === 1;
    try {
      const details = await fetchArticleDetails(article.url);
      store.saveHarvest(article.id, { ...details, links: HARVEST_LINKS ? details.links : [] }, { enrich });
    } catch (err) {
      failed++;
      // Gone pages and repeated network trouble: give up, keeping the guessed title
      const attempts = (failures.get(article.id) || 0) + 1;
      failures.set(article.id, attempts);
      if (/HTTP 4dd/.test(err.message) || attempts >= 3) {
        store.saveHarvest(article.id, {}, { enrich });
        failures.delete(article.id);
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return { size: batch.length, failed };
}

export function startHarvester() {
  const loop = async () => {
    let wait = 10 * 60_000;
    try {
      const { size, failed } = await harvestBatch();
      if (size && failed < size) wait = 0; // more to do; back off when everything fails
    } catch (err) {
      console.error('harvest failed:', err);
    }
    setTimeout(loop, wait);
  };
  setTimeout(loop, 20_000);
}

export function startScheduler() {
  const tick = () => {
    const cutoff = Date.now() - SCAN_INTERVAL_HOURS * 3600_000;
    for (const blog of store.listBlogs()) {
      if (!blog.last_scan_at || Date.parse(blog.last_scan_at) < cutoff) queueScan(blog.id);
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 15 * 60_000);
}
