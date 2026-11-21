// Finding every post of a blog. Each strategy returns items oldest-first:
//   { url, title, published, titleGuessed }
// Strategies (best first): wordpress API, substack API, sitemap.xml, RSS/Atom feed,
// and scraping archive pages with CSS selectors as the fallback.

import * as cheerio from 'cheerio';
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';
import { createBrotliDecompress, createGunzip, createInflate, gunzip } from 'node:zlib';
import { absoluteUrl, dateFromUrl, hostOf, isHttpUrl, normalizeUrl, titleFromSlug, toIsoDate } from './urls.js';

const USER_AGENT = process.env.USER_AGENT || 'Mozilla/5.0 (compatible; Backlog/1.0; personal reading tracker)';
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1000);
const TIMEOUT_MS = 30_000; // per request, body included
const MAX_BYTES = 50 * 1024 * 1024; // after decompression; the sitemap protocol's own limit
const gunzipAsync = promisify(gunzip);

export const STRATEGIES = {
  wordpress: 'WordPress API',
  substack: 'Substack API',
  sitemap: 'Sitemap',
  feed: 'RSS/Atom feed (recent posts only)',
  archive: 'Archive pages (CSS selectors)',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Only ever talk to the public internet ---
// URLs come from blog posts and suggestions, so a hostile page could point Backlog at
// internal addresses (the server's Docker networks, localhost). Every request and every
// redirect hop is checked, and the check happens in the DNS lookup the connection itself
// uses, so a rebinding DNS server can't answer differently the second time.

const PRIVATE_V4 = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16],
  ['100.64.0.0', 10], // carrier-grade NAT
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['192.0.0.0', 24], ['192.0.2.0', 24], // only these two /24s; 192.0.78.x is WordPress.com
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 3], // multicast, reserved, broadcast
]) PRIVATE_V4.addSubnet(net, bits, 'ipv4');

// IPv6 counts as public only inside global unicast (2000::/3). Everything else is refused,
// including the forms that wrap an IPv4 address: mapped (::ffff:7f00:1), NAT64 (64:ff9b::), 6to4.
const GLOBAL_V6 = new BlockList();
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6');
const SPECIAL_V6 = new BlockList();
for (const [net, bits] of [
  ['2001::', 23], // Teredo, benchmarking, ORCHID
  ['2001:db8::', 32], ['3fff::', 20], // documentation
  ['2002::', 16], // 6to4
]) SPECIAL_V6.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(ip) {
  try {
    if (isIP(ip) === 4) return PRIVATE_V4.check(ip, 'ipv4');
    if (isIP(ip) === 6) return !GLOBAL_V6.check(ip, 'ipv6') || SPECIAL_V6.check(ip, 'ipv6');
  } catch {
    // unparseable (e.g. a zone id): not public
  }
  return true;
}

function assertPublicUrl(url) {
  const { protocol, hostname } = new URL(url);
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error(`Refusing ${protocol} URL`);
  const host = hostname.replace(/^\[|\]$/g, '');
  // Names without a dot (localhost, Docker service names) only exist on internal networks
  if (!isIP(host) && !host.includes('.')) throw new Error(`Refusing internal address ${host}`);
  // Literal addresses never reach the lookup below
  if (isIP(host) && isPrivateAddress(host)) throw new Error(`Refusing internal address ${host}`);
}

// Used as the socket's DNS lookup: the addresses checked here are the ones connected to.
function publicLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(new Error(`Refusing internal address ${hostname}`));
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
}

// One GET without following redirects; resolves once the headers are in.
function get(url, accept) {
  const client = new URL(url).protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, {
      headers: { 'user-agent': USER_AGENT, accept, 'accept-encoding': 'gzip, deflate, br' },
      lookup: publicLookup,
      agent: false, // a fresh connection every time, never a pooled one to somewhere else
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }, resolve);
    req.on('error', reject);
  });
}

const DECODERS = { gzip: createGunzip, 'x-gzip': createGunzip, deflate: createInflate, br: createBrotliDecompress };

// Decompresses as it reads and stops at MAX_BYTES, so zip bombs and endless bodies can't fill the memory.
async function readBody(res, url) {
  const decoder = DECODERS[String(res.headers['content-encoding'] || '').trim().toLowerCase()];
  const body = decoder ? pipeline(res, decoder(), () => {}) : res;
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_BYTES) {
      res.destroy();
      throw new Error(`Response too large for ${url}`);
    }
    chunks.push(chunk);
  }
  let buf = Buffer.concat(chunks);
  // A gzipped file (sitemap.xml.gz) rather than a gzip transfer encoding
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = await gunzipAsync(buf, { maxOutputLength: MAX_BYTES });
    } catch {
      throw new Error(`Couldn't unpack ${url} (broken, or larger than ${MAX_BYTES / 1024 / 1024} MB)`);
    }
  }
  return buf.toString('utf8');
}

export async function fetchText(url, { accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' } = {}) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    assertPublicUrl(current);
    const res = await get(current, accept);
    if (isPrivateAddress(res.socket?.remoteAddress)) {
      res.destroy();
      throw new Error(`Refusing internal address for ${current}`);
    }
    const { location } = res.headers;
    if (res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.destroy();
      current = new URL(location, current).href;
      continue;
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      res.destroy();
      throw new Error(`HTTP ${res.statusCode} for ${current}`);
    }
    const text = await readBody(res, current);
    return { text, finalUrl: current, headers: { get: (name) => res.headers[name.toLowerCase()] ?? null } };
  }
  throw new Error(`Too many redirects for ${url}`);
}

export async function fetchJson(url) {
  const { text, headers } = await fetchText(url, { accept: 'application/json' });
  return { data: JSON.parse(text), headers };
}

const decodeEntities = (s) => cheerio.load(`<p>${s ?? ''}</p>`)('p').text().trim();

// Paginated sources stop early once a page brings nothing new (unless doing a full scan).
const pageHasNew = (items, known) => items.some((it) => !known.has(normalizeUrl(it.url)));

// Caps one scan, so a huge or hostile site can't hold up the queue (scans run one at a time)
// or flood the database. Paginated sources stop where they are once it runs out.
const SCAN_MAX_MS = 30 * 60_000;
const SCAN_MAX_ITEMS = 100_000;

export function scanBudget() {
  const until = Date.now() + SCAN_MAX_MS;
  return {
    items: SCAN_MAX_ITEMS,
    hit: false,
    spent(count) {
      if (count >= SCAN_MAX_ITEMS || Date.now() > until) this.hit = true;
      return this.hit;
    },
  };
}

// --- WordPress ---

async function wordpress(blog, { known, full, budget }) {
  const items = [];
  for (let page = 1; page <= 500; page++) {
    const api = new URL(blog.config.apiUrl);
    api.searchParams.set('per_page', '100');
    api.searchParams.set('page', String(page));
    api.searchParams.set('_fields', 'link,title,date');
    let result;
    try {
      result = await fetchJson(api.href);
    } catch (err) {
      // WordPress answers 400 when paging past the end
      if (page > 1 && /HTTP 400/.test(err.message)) break;
      throw err;
    }
    const batch = result.data.map((p) => ({ url: p.link, title: decodeEntities(p.title?.rendered), published: toIsoDate(p.date) }));
    items.push(...batch);
    const totalPages = Number(result.headers.get('x-wp-totalpages') || 0);
    if (!batch.length || (totalPages && page >= totalPages)) break;
    if (!full && !pageHasNew(batch, known)) break;
    if (budget.spent(items.length)) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return items.reverse();
}

// --- Substack ---

async function substack(blog, { known, full, budget }) {
  const items = [];
  // Substack caps the page size below what you ask for, so page until empty
  for (let offset = 0; offset < 20_000; ) {
    const { data } = await fetchJson(`${blog.config.apiUrl}?sort=new&offset=${offset}&limit=50`);
    const batch = data.map((p) => ({ url: p.canonical_url, title: p.title, published: toIsoDate(p.post_date) }));
    if (!batch.length) break;
    items.push(...batch);
    offset += batch.length;
    if (!full && !pageHasNew(batch, known)) break;
    if (budget.spent(items.length)) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return items.reverse();
}

// --- Sitemap ---

// Child sitemaps that list tags, categories, authors or static pages instead of posts
const NON_POST_SITEMAP = /(^|[-_/])(tags?|category|categories|authors?|pages?|attachments?|topics?|users?|taxonom(y|ies)|archives?|products?|images?|videos?|news)([-_.\d]|$)/i;
// Post URLs that are really index pages
const NON_POST_PATH = /\/(tag|tags|category|categories|author|authors|page|feed|search|archive|archives|about|contact|privacy|imprint|impressum|subscribe)(\/|$)/i;

async function findSitemaps(origin) {
  const candidates = [];
  try {
    const { text } = await fetchText(`${origin}/robots.txt`, { accept: 'text/plain' });
    for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.push(m[1]);
  } catch {
    // no robots.txt is fine
  }
  candidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`, `${origin}/wp-sitemap.xml`);
  return [...new Set(candidates)];
}

async function readSitemap(url, budget, depth = 0, seen = new Set()) {
  if (depth > 3 || seen.has(url) || seen.size > 300) return [];
  seen.add(url);
  const { text } = await fetchText(url, { accept: 'application/xml,text/xml' });
  const $ = cheerio.load(text, { xml: true });
  const children = $('sitemapindex > sitemap > loc').map((_, el) => $(el).text().trim()).get();
  if (children.length) {
    const postSitemaps = children.filter((c) => !NON_POST_SITEMAP.test(new URL(c).pathname.split('/').pop()));
    const entries = [];
    for (const child of postSitemaps.length ? postSitemaps : children) {
      if (budget.spent(entries.length)) break;
      await sleep(REQUEST_DELAY_MS / 2);
      try {
        entries.push(...(await readSitemap(child, budget, depth + 1, seen)));
      } catch {
        // skip broken child sitemaps
      }
    }
    return entries;
  }
  return $('urlset > url').map((_, el) => ({
    url: $(el).children('loc').text().trim(),
    lastmod: $(el).children('lastmod').text().trim(),
  })).get();
}

async function sitemap(blog, { budget = scanBudget() } = {}) {
  const urls = blog.config.sitemapUrl ? [blog.config.sitemapUrl] : await findSitemaps(new URL(blog.url).origin);
  const blogHost = hostOf(blog.url);
  const root = normalizeUrl(blog.url);
  for (const url of urls) {
    let entries;
    try {
      entries = await readSitemap(url, budget);
    } catch {
      continue;
    }
    const items = entries
      .filter((e) => hostOf(e.url) === blogHost && normalizeUrl(e.url) !== root)
      .filter((e) => new URL(e.url).pathname.length > 1 && !NON_POST_PATH.test(new URL(e.url).pathname))
      .map((e) => ({
        url: e.url,
        title: titleFromSlug(e.url),
        titleGuessed: true,
        published: toIsoDate(dateFromUrl(e.url)) || toIsoDate(e.lastmod),
      }));
    if (items.length) return items.sort((a, b) => (a.published || '').localeCompare(b.published || ''));
  }
  throw new Error('No usable sitemap found');
}

// --- RSS / Atom ---

export function parseFeed(xml, baseUrl) {
  const $ = cheerio.load(xml, { xml: true });
  const items = [];
  $('item').each((_, el) => {
    const $el = $(el);
    const link = $el.children('link').text().trim() || $el.children('guid').text().trim();
    items.push({
      url: absoluteUrl(link, baseUrl),
      title: decodeEntities($el.children('title').text()),
      published: toIsoDate($el.children('pubDate').text() || $el.children('dc\\:date').text()),
    });
  });
  $('entry').each((_, el) => {
    const $el = $(el);
    const links = $el.children('link');
    const alt = links.filter((_, l) => !$(l).attr('rel') || $(l).attr('rel') === 'alternate').first();
    items.push({
      url: absoluteUrl((alt.length ? alt : links.first()).attr('href'), baseUrl),
      title: decodeEntities($el.children('title').text()),
      published: toIsoDate($el.children('published').text() || $el.children('updated').text()),
    });
  });
  return items.filter((it) => it.url);
}

export async function feed(blog) {
  const { text, finalUrl } = await fetchText(blog.config.feedUrl, { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml' });
  // Feeds list newest first; undated ones keep that order (reversed)
  const items = parseFeed(text, finalUrl).reverse();
  if (!items.length) throw new Error('Feed contains no entries');
  return items.every((it) => it.published) ? items.sort((a, b) => a.published.localeCompare(b.published)) : items;
}

// --- Archive pages ---

export function urlFilter(config) {
  const include = config.include ? new RegExp(config.include, 'i') : null;
  const exclude = config.exclude ? new RegExp(config.exclude, 'i') : null;
  return (url) => (!include || include.test(url)) && (!exclude || !exclude.test(url));
}

const filterByPatterns = (items, config) => items.filter((it) => urlFilter(config)(it.url));

async function archive(blog, { known, full, budget }) {
  const { linkSelector, nextSelector } = blog.config;
  if (!linkSelector) throw new Error('Archive scraping needs a link selector (see blog settings)');
  const maxPages = Number(blog.config.maxPages || 100);
  const archiveUrl = blog.config.archiveUrl || blog.url;
  const items = [];
  const seen = new Set();
  let pageUrl = archiveUrl;
  for (let page = 0; pageUrl && page < maxPages; page++) {
    const { text, finalUrl } = await fetchText(pageUrl);
    const $ = cheerio.load(text);
    const batch = [];
    $(linkSelector).each((_, el) => {
      const $a = $(el).is('a') ? $(el) : $(el).find('a').first();
      const url = absoluteUrl($a.attr('href'), finalUrl);
      const norm = url && normalizeUrl(url);
      if (!norm || seen.has(norm) || norm === normalizeUrl(archiveUrl)) return;
      seen.add(norm);
      const title = ($a.text() || $a.attr('title') || '').replace(/\s+/g, ' ').trim();
      batch.push({ url, title: title || titleFromSlug(url), titleGuessed: !title });
    });
    items.push(...batch);
    const next = nextSelector ? $(nextSelector).first().attr('href') : null;
    pageUrl = next ? absoluteUrl(next, finalUrl) : null;
    if (!full && !pageHasNew(batch, known)) break;
    if (budget.spent(items.length)) break;
    if (pageUrl) await sleep(REQUEST_DELAY_MS);
  }
  // Archive pages list newest first, unless told otherwise
  return blog.config.order === 'oldest-first' ? items : items.reverse();
}

const RUNNERS = { wordpress, substack, sitemap, feed, archive };

// Runs the blog's strategy. `known` = normalized URLs already stored;
// `full` = ignore early stopping (first import, or "full rescan");
// `budget` = from scanBudget(), check `budget.hit` afterwards to see if the scan was cut short.
export async function collect(blog, { known = new Set(), full = false, budget = scanBudget() } = {}) {
  const runner = RUNNERS[blog.strategy];
  if (!runner) throw new Error(`Unknown strategy "${blog.strategy}"`);
  let items = (await runner(blog, { known, full, budget })).filter((it) => isHttpUrl(it.url));
  // Oldest first, so keep the newest when one big sitemap alone is over the limit
  if (items.length > budget.items) {
    budget.hit = true;
    items = items.slice(-budget.items);
  }
  return filterByPatterns(items, blog.config);
}

// --- Detection when adding a blog ---

const FEED_LINK = 'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]';
const COMMON_FEED_PATHS = ['/feed', '/rss.xml', '/atom.xml', '/feed.xml', '/index.xml', '/rss'];

const siteName = ($, url) =>
  $('meta[property="og:site_name"]').attr('content')?.trim() ||
  $('title').first().text().split(/\s[|–—-]\s/)[0].trim() ||
  hostOf(url);

async function tryJson(url) {
  try {
    return (await fetchJson(url)).data;
  } catch {
    return null;
  }
}

export async function detect(inputUrl) {
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const { text: html, finalUrl } = await fetchText(url);
  const $ = cheerio.load(html);
  const origin = new URL(finalUrl).origin;
  const name = siteName($, finalUrl);

  const config = {};
  const feedHref = $(FEED_LINK).first().attr('href');
  if (feedHref) config.feedUrl = absoluteUrl(feedHref, finalUrl);

  const result = (strategy, extra = {}, note = '') => ({ name, url: finalUrl, strategy, config: { ...config, ...extra }, note });

  // Substack (also on custom domains)
  if (/substack/i.test(html) || hostOf(finalUrl).endsWith('substack.com')) {
    const apiUrl = `${origin}/api/v1/archive`;
    const data = await tryJson(`${apiUrl}?sort=new&offset=0&limit=1`);
    if (Array.isArray(data) && data.length) return result('substack', { apiUrl });
  }

  // WordPress: self-hosted REST API, then the WordPress.com public API
  const wpCandidates = [];
  const apiRoot = $('link[rel="https://api.w.org/"]').attr('href');
  if (apiRoot) wpCandidates.push(new URL('wp/v2/posts', apiRoot.endsWith('/') ? apiRoot : `${apiRoot}/`).href);
  wpCandidates.push(`${origin}/wp-json/wp/v2/posts`);
  if (/wordpress\.com|wp-content/i.test(html)) wpCandidates.push(`https://public-api.wordpress.com/wp/v2/sites/${new URL(finalUrl).hostname}/posts`);
  for (const apiUrl of [...new Set(wpCandidates)]) {
    const data = await tryJson(`${apiUrl}?per_page=1&_fields=link`);
    if (Array.isArray(data) && data.length) return result('wordpress', { apiUrl });
  }

  // Common feed locations if the page didn't advertise one
  if (!config.feedUrl) {
    for (const path of COMMON_FEED_PATHS) {
      try {
        const { text } = await fetchText(origin + path, { accept: 'application/rss+xml,application/atom+xml,application/xml' });
        if (parseFeed(text, origin).length) {
          config.feedUrl = origin + path;
          break;
        }
      } catch {
        // try the next one
      }
    }
  }

  let feedCount = 0;
  if (config.feedUrl) {
    try {
      feedCount = (await feed({ config })).length;
    } catch {
      delete config.feedUrl;
    }
  }

  try {
    const fromSitemap = await sitemap({ url: finalUrl, config });
    if (fromSitemap.length >= Math.max(5, feedCount)) {
      return result('sitemap', {}, `Found ${fromSitemap.length} pages in the sitemap. If non-article pages show up, add an exclude pattern in the settings.`);
    }
  } catch {
    // no sitemap
  }

  if (config.feedUrl) {
    return result('feed', {}, `Only the feed was found (${feedCount} recent posts). For the full history, set up archive scraping in the settings.`);
  }
  return result('archive', { archiveUrl: finalUrl }, 'No API, sitemap or feed found. Set a CSS selector for the post links in the settings.');
}

// --- Visiting a post: real title/date (for sitemap posts) and outbound links (for Discover) ---

// Where the post body usually lives, most specific first
const CONTENT_SELECTORS = ['.entry-content', '.post-content', '.article-content', '.available-content', '.body.markup', '.post-body', 'article', 'main', '#content'];
const NOISE = 'nav, header, footer, aside, form, script, style, .comments, #comments, .sharedaddy, .jp-relatedposts, .related-posts, .share, .social, .subscribe, .widget, .sidebar';
const FILE_LINK = /\.(jpe?g|png|gif|webp|svg|pdf|mp3|mp4|zip|epub|docx?)(\?|$)/i;

function outboundLinks($, pageUrl) {
  const root = CONTENT_SELECTORS.map((sel) => $(sel).first()).find((el) => el.length) ?? $('body');
  root.find(NOISE).remove();
  const ownHost = hostOf(pageUrl);
  const links = new Map();
  root.find('a[href]').each((_, a) => {
    const url = absoluteUrl($(a).attr('href'), pageUrl);
    if (!url || !/^https?:/.test(url) || FILE_LINK.test(url)) return;
    const host = hostOf(url);
    if (host && host !== ownHost && !links.has(host)) links.set(host, url);
  });
  return [...links].map(([host, url]) => ({ host, url }));
}

export async function fetchArticleDetails(url) {
  const { text, finalUrl } = await fetchText(url);
  const $ = cheerio.load(text);
  const meta = (sel) => $(sel).attr('content')?.trim();
  let published = meta('meta[property="article:published_time"]') || meta('meta[name="date"]') || $('time[datetime]').first().attr('datetime');
  if (!published) {
    $('script[type="application/ld+json"]').each((_, el) => {
      const m = /"datePublished"\s*:\s*"([^"]+)"/.exec($(el).text());
      if (m && !published) published = m[1];
    });
  }
  const title = meta('meta[property="og:title"]') || $('h1').first().text().trim() || $('title').first().text().trim();
  return { title: title?.replace(/\s+/g, ' ') || null, published: toIsoDate(published), links: outboundLinks($, finalUrl) };
}

// --- Quick look at a suggested site: is it a blog, what is it called, what are its latest posts? ---

// Posts per week, measured over the span the feed covers (feeds often hold only the last 10 items).
function postingRate(dates) {
  if (dates.length < 5) return 0;
  const times = dates.map(Date.parse).sort((a, b) => a - b);
  const spanDays = Math.max((times.at(-1) - times[0]) / 86_400_000, 0.5);
  return ((times.length - 1) / spanDays) * 7;
}

export async function probeSite(url) {
  const { text: html, finalUrl } = await fetchText(url);
  const $ = cheerio.load(html);
  const origin = new URL(finalUrl).origin;
  const description = ($('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '').trim();

  let samples = [];
  if (/substack/i.test(html)) {
    const data = await tryJson(`${origin}/api/v1/archive?sort=new&offset=0&limit=5`);
    if (Array.isArray(data)) samples = data.map((p) => ({ url: p.canonical_url, title: p.title, published: toIsoDate(p.post_date) }));
  }
  if (!samples.length) {
    const advertised = $(FEED_LINK).first().attr('href');
    const feeds = advertised ? [absoluteUrl(advertised, finalUrl)] : COMMON_FEED_PATHS.map((p) => origin + p);
    for (const feedUrl of feeds) {
      try {
        const { text, finalUrl: feedFinal } = await fetchText(feedUrl, { accept: 'application/rss+xml,application/atom+xml,application/xml' });
        samples = parseFeed(text, feedFinal).sort((a, b) => (b.published || '').localeCompare(a.published || ''));
        if (samples.length) break;
      } catch {
        // try the next location
      }
    }
  }
  samples = samples.filter((s) => s.title && isHttpUrl(s.url));
  const postsPerWeek = postingRate(samples.map((s) => s.published).filter(Boolean));
  samples = samples.slice(0, 4);
  return {
    url: origin,
    host: hostOf(finalUrl),
    name: siteName($, finalUrl),
    language: ($('html').attr('lang') || '').slice(0, 2).toLowerCase() || null,
    description: description.length > 300 ? `${description.slice(0, 297)}…` : description,
    samples,
    postsPerWeek,
    lastPost: samples.map((s) => s.published).filter(Boolean).sort().at(-1) || null,
  };
}
