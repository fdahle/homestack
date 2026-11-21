// Accept "example.com" (or "example.com:8080/x") by assuming https; only "scheme://" counts as a scheme.
export function normalizeUrl(value) {
  const url = value?.trim()
  if (!url) return null
  if (url.startsWith('//')) return 'https:' + url
  return /^[a-z][a-z\d+.-]*:\/\//i.test(url) ? url : 'https://' + url
}

// OSM wikipedia tags are "lang:Title" (the title may contain colons) or, less often, a full article URL.
export function parseWikipediaTag(tag) {
  const value = tag?.trim()
  if (!value) return null
  const url = /^https?:\/\/([a-z][a-z-]{1,11})(?:\.m)?\.wikipedia\.org\/wiki\/([^?#]+)/i.exec(value)
  if (url) {
    let title = url[2]
    try { title = decodeURIComponent(title) } catch { /* keep it encoded */ }
    return { lang: url[1].toLowerCase(), title: title.replace(/_/g, ' ') }
  }
  const match = /^([a-z][a-z-]{1,11}):(.+)$/.exec(value)
  if (!match || match[2].startsWith('//')) return null
  return { lang: match[1], title: match[2] }
}
