// Discover: finding new blogs from
//   1. the sites your blogs link to (weighted by what you actually read),
//   2. Substack's "recommended by" lists of the Substacks you follow,
//   3. optionally Claude, given your reading history.
// Every candidate is visited once to check it really is a blog with posts.

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import * as store from './db.js';
import { fetchJson, probeSite, sleep } from './discover.js';
import { hostOf } from './urls.js';

const DISCOVER_INTERVAL_DAYS = Number(process.env.DISCOVER_INTERVAL_DAYS || 7);
const REQUEST_DELAY_MS = Number(process.env.REQUEST_DELAY_MS || 1000);
const PROBES_PER_RUN = 60;
const MAX_POSTS_PER_WEEK = 14;
// Languages you read; suggestions in other languages are skipped
const LANGUAGES = (process.env.READ_LANGUAGES || 'en,de').split(',').map((l) => l.trim().toLowerCase());
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5';

export const aiEnabled = Boolean(process.env.ANTHROPIC_API_KEY);

// --- which linked sites can be blogs at all ---

// Matched as the host or any subdomain of it
const NOT_BLOGS = `wikipedia.org wikimedia.org wiktionary.org wikisource.org wikidata.org wikiquote.org
  youtube.com youtu.be twitter.com x.com t.co facebook.com fb.com instagram.com tiktok.com linkedin.com
  reddit.com redd.it pinterest.com tumblr.com bsky.app threads.net mastodon.social discord.gg discord.com
  amazon.com amazon.co.uk amazon.de amazon.ca amzn.to goodreads.com bookshop.org audible.com
  google.com goo.gl apple.com spotify.com soundcloud.com vimeo.com twitch.tv imgur.com flickr.com
  patreon.com paypal.com ko-fi.com buymeacoffee.com gofundme.com kickstarter.com
  github.com gitlab.com stackoverflow.com archive.org archive.ph archive.is archive.today
  doi.org jstor.org nih.gov arxiv.org ssrn.com researchgate.net academia.edu springer.com
  sciencedirect.com wiley.com tandfonline.com cambridge.org oup.com nature.com science.org pnas.org
  gutenberg.org perseus.tufts.edu britannica.com worldcat.org openlibrary.org loc.gov
  nytimes.com washingtonpost.com wsj.com theguardian.com bbc.co.uk bbc.com cnn.com reuters.com apnews.com
  bloomberg.com ft.com economist.com theatlantic.com newyorker.com vox.com politico.com foxnews.com
  nbcnews.com cbsnews.com abcnews.go.com npr.org forbes.com businessinsider.com axios.com wired.com
  theverge.com arstechnica.com time.com usatoday.com latimes.com dailymail.co.uk independent.co.uk
  telegraph.co.uk spiegel.de zeit.de faz.net sueddeutsche.de nature.org nationalgeographic.com
  wp.com gravatar.com disqus.com feedburner.com mailchimp.com eepurl.com substackcdn.com
  bit.ly tinyurl.com imdb.com rottentomatoes.com metacritic.com steampowered.com gum.co gumroad.com etsy.com
  ted.com khanacademy.org coursera.org ycombinator.com producthunt.com techcrunch.com
  statista.com ourworldindata.org who.int un.org worldbank.org imf.org`.split(/\s+/);

// Platform front pages: their subdomains are blogs, the bare domain is not
const PLATFORM_ROOTS = new Set(['substack.com', 'open.substack.com', 'wordpress.com', 'medium.com', 'blogspot.com', 'ghost.io', 'github.io', 'neocities.org']);
const ASSET_HOST = /^(i\d|s\d|cdn\d?|static|img|images?|media|assets|uploads?|files|fonts|pbs|lh\d)\./;

function couldBeBlog(host) {
  if (PLATFORM_ROOTS.has(host) || ASSET_HOST.test(host)) return false;
  if (/\.(gov|mil)(\.[a-z]{2})?$/.test(host)) return false;
  return !NOT_BLOGS.some((d) => host === d || host.endsWith(`.${d}`));
}

function trackedHosts() {
  const hosts = new Set();
  for (const blog of store.listBlogs()) {
    hosts.add(hostOf(blog.url));
    if (blog.config.apiUrl) hosts.add(hostOf(blog.config.apiUrl));
  }
  return hosts;
}

// The blog itself or one of its subdomains (newsletter.example.com, store.example.com)
const belongsToTracked = (host, tracked) => [...tracked].some((t) => host === t || host.endsWith(`.${t}`));

// --- 1. links from your blogs ---

// Per site: how many posts of each blog link to it. Posts you read count double,
// several blogs agreeing counts extra, and repetition within one blog is dampened.
function linkCandidates() {
  const tracked = trackedHosts();
  const bySite = new Map();
  for (const row of store.linkStats()) {
    if (belongsToTracked(row.host, tracked) || !couldBeBlog(row.host)) continue;
    const site = bySite.get(row.host) || { host: row.host, url: new URL(row.url).origin, posts: 0, raw: 0, blogs: [] };
    site.posts += row.n;
    site.raw += Math.log2(1 + row.n + row.n_read);
    site.blogs.push({ name: row.blog_name, n: row.n });
    bySite.set(row.host, site);
  }
  return [...bySite.values()]
    .filter((s) => s.posts >= 2)
    .map((s) => ({ ...s, score: s.raw * (1 + 0.5 * (s.blogs.length - 1)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 150);
}

// --- 2. Substack recommendations ---

async function substackRecommendations() {
  const byHost = new Map();
  for (const blog of store.listBlogs().filter((b) => b.strategy === 'substack')) {
    try {
      const [latest] = (await fetchJson(`${blog.config.apiUrl}?sort=new&offset=0&limit=1`)).data;
      const origin = new URL(blog.config.apiUrl).origin;
      const { data } = await fetchJson(`${origin}/api/v1/recommendations/from/${latest.publication_id}`);
      for (const { recommendedPublication: p } of data) {
        const url = p.custom_domain ? `https://${p.custom_domain}` : `https://${p.subdomain}.substack.com`;
        const host = hostOf(url);
        const entry = byHost.get(host) || { host, url, name: p.name, description: p.hero_text, by: [] };
        entry.by.push(blog.name);
        byHost.set(host, entry);
      }
    } catch (err) {
      console.warn(`substack recommendations for "${blog.name}" failed: ${err.message}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  return [...byHost.values()];
}

// --- 3. Claude ---

const AiSuggestions = z.object({
  suggestions: z.array(z.object({ name: z.string(), url: z.string(), reason: z.string() })),
});

const AI_SYSTEM = `You recommend blogs and newsletters to someone who reads blogs from the very first post onward, \
using a personal tracker. They like long-form writing with a substantial archive worth working through.
Only suggest blogs you are confident exist, with the URL of the blog's homepage. Prefer independent writers over \
news outlets and company blogs. Each reason is one sentence connecting the blog to what this reader already reads. \
Never suggest anything on the reader's "already known" list.`;

async function askClaude(wish) {
  const blogs = store.listBlogs();
  const known = [...new Set([...trackedHosts(), ...store.suggestionHosts()])];
  const recent = store.recentlyRead(60);
  const prompt = [
    'Blogs I follow (posts read / total):',
    ...blogs.map((b) => `- ${b.name} (${hostOf(b.url)}): ${b.read_count}/${b.total}`),
    '',
    recent.length ? 'Posts I read most recently:' : 'I have not marked any posts as read yet.',
    ...recent.map((a) => `- ${a.title} (${a.blog_name})`),
    '',
    `Already known, do not suggest: ${known.join(', ')}`,
    wish ? `\nRight now I am in the mood for: ${wish}` : '',
    '\nSuggest 12 blogs.',
  ].join('\n');

  const client = new Anthropic();
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    // Server-side fallback: if a safety classifier declines, another model answers instead
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: betaZodOutputFormat(AiSuggestions) },
    system: AI_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined this request');
  if (!response.parsed_output) throw new Error(`Claude returned no usable answer (${response.stop_reason})`);
  return response.parsed_output.suggestions;
}

// --- checking candidates ---

const LATIN_SCRIPT_LANGUAGES = new Set('en de fr es it nl pt sv da no nb nn fi pl cs sk hu ro hr sl et lv lt tr id ms'.split(' '));

// The declared language is often wrong (templates default to "en"), so when you only read
// Latin-script languages, also check that the post titles are mostly Latin script.
function readableLanguage(site) {
  if (site.language && !LANGUAGES.includes(site.language)) return false;
  if (!LANGUAGES.every((l) => LATIN_SCRIPT_LANGUAGES.has(l))) return true;
  const titles = site.samples.map((s) => s.title).join(' ');
  const letters = titles.match(/\p{L}/gu)?.length || 0;
  const latin = titles.match(/\p{Script=Latin}/gu)?.length || 0;
  return letters === 0 || latin / letters > 0.6;
}

async function probeSuggestions(list) {
  const tracked = trackedHosts();
  const taken = new Set(store.suggestionHosts());
  let checked = 0;
  for (const s of list) {
    try {
      const site = await probeSite(s.url);
      // Redirected to a blog you already follow, or to another suggestion
      if (belongsToTracked(site.host, tracked) || (site.host !== s.host && taken.has(site.host))) {
        store.setSuggestionStatus(s.id, 'hidden');
      } else {
        // A blog has posts; more than ~2 a day means a news site or magazine
        const ok =
          site.samples.length > 0 &&
          site.postsPerWeek <= MAX_POSTS_PER_WEEK &&
          readableLanguage(site);
        store.saveProbe(s.id, { ...site, ok });
      }
    } catch {
      store.saveProbe(s.id, { ok: false });
    }
    checked++;
    await sleep(REQUEST_DELAY_MS);
  }
  return checked;
}

// --- running it all ---

let running = false;
export const discoveryRunning = () => running;

function claudeErrorMessage(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'the ANTHROPIC_API_KEY was rejected';
  if (err instanceof Anthropic.RateLimitError) return 'rate limited, try again in a while';
  if (err instanceof Anthropic.APIConnectionError) return 'could not reach the Anthropic API';
  if (err instanceof Anthropic.APIError) return `API error ${err.status}`;
  return err.message;
}

async function addClaudeIdeas(wish) {
  const ideas = await askClaude(wish);
  const tracked = trackedHosts();
  const fresh = [];
  for (const idea of ideas) {
    const url = /^https?:\/\//i.test(idea.url) ? idea.url : `https://${idea.url}`;
    const host = hostOf(url);
    if (!host || belongsToTracked(host, tracked)) continue;
    store.upsertSuggestion({ host, url: new URL(url).origin, name: idea.name, sources: { ai: idea.reason } });
    const s = store.getSuggestionByHost(host);
    if (s.probe_ok === null) fresh.push(s);
  }
  // Check Claude's ideas right away, so ones that don't exist never show up
  await probeSuggestions(fresh);
  return { total: ideas.length, fresh: fresh.length };
}

export async function runDiscovery({ ai = false, wish = '' } = {}) {
  if (running) return;
  running = true;
  const notes = [];
  let ok = true;
  try {
    const links = linkCandidates();
    for (const c of links) {
      store.upsertSuggestion({ host: c.host, url: c.url, sources: { links: { posts: c.posts, score: c.score, blogs: c.blogs } } });
    }
    notes.push(`${links.length} linked sites`);

    const recs = await substackRecommendations();
    for (const r of recs) {
      store.upsertSuggestion({ host: r.host, url: r.url, name: r.name, description: r.description, sources: { substack: r.by } });
    }
    if (recs.length) notes.push(`${recs.length} Substack recommendations`);

    if (ai && aiEnabled) {
      try {
        const { total, fresh } = await addClaudeIdeas(wish.trim());
        notes.push(`${total} ideas from Claude (${fresh} new)`);
      } catch (err) {
        console.error('asking Claude failed:', err);
        notes.push(`asking Claude failed: ${claudeErrorMessage(err)}`);
        ok = false;
      }
    }

    const checked = await probeSuggestions(store.suggestionsToProbe(PROBES_PER_RUN));
    notes.push(`${checked} sites checked`);
    store.writeJsonSetting('discover_status', { at: new Date().toISOString(), ok, message: notes.join(', ') });
  } catch (err) {
    console.error('discovery failed:', err);
    store.writeJsonSetting('discover_status', { at: new Date().toISOString(), ok: false, message: err.message });
  } finally {
    running = false;
  }
}

export function startDiscoveryScheduler() {
  const tick = () => {
    const last = store.readJsonSetting('discover_status');
    const due = !last || Date.now() - Date.parse(last.at) > DISCOVER_INTERVAL_DAYS * 86_400_000;
    // Wait for the harvester to have read a good part of the posts before the first run
    const { total, done } = store.harvestProgress();
    if (due && total && done / total > 0.25) runDiscovery();
  };
  setInterval(tick, 60 * 60_000);
}
