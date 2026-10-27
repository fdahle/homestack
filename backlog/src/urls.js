// URL normalization, so the same post matches no matter how it was linked
// (www or not, trailing slash, tracking parameters, http vs https, AMP).

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|mc_cid|mc_eid|ref|ref_src|source|s|r|triedRedirect|publication_id|post_id|isFreemail)$/i;

export function normalizeUrl(raw, base) {
  let u;
  try {
    u = new URL(raw, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname.replace(/\/amp\/?$/, '').replace(/\/+$/, '') || '/';
  const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAM.test(k)).sort();
  const query = params.length ? '?' + new URLSearchParams(params) : '';
  return host + path + query;
}

export function hostOf(raw) {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function absoluteUrl(href, base) {
  try {
    const u = new URL(href, base);
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

// "/2019/05/12/the-siege-of-x/" -> "The siege of x" (used until the real title is fetched)
export function titleFromSlug(raw) {
  try {
    const segments = new URL(raw).pathname.split('/').filter(Boolean);
    const slug = decodeURIComponent(segments.at(-1) || '').replace(/\.(html?|php|aspx?)$/i, '');
    const words = slug.replace(/[-_+]+/g, ' ').trim();
    return words ? words[0].toUpperCase() + words.slice(1) : raw;
  } catch {
    return raw;
  }
}

// Many blogs put the date in the URL: /2019/05/12/slug or /2019/05/slug
export function dateFromUrl(raw) {
  const m = /\/((?:19|20)\d{2})\/(0[1-9]|1[0-2])(?:\/(0[1-9]|[12]\d|3[01]))?\//.exec(raw);
  return m ? `${m[1]}-${m[2]}-${m[3] || '01'}` : null;
}

export function toIsoDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
