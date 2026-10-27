// Marker text search. All markers are already in the browser, so this runs locally:
// accent- and case-insensitive, every word must match somewhere, label matches rank first.

const fold = (value) => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const textCache = new WeakMap()
function searchableText(marker) {
  let text = textCache.get(marker)
  if (text === undefined) {
    text = fold([
      marker.label, marker.description, marker.address, marker.country,
      ...(marker.categories ?? []).map((c) => c.name),
      ...(marker.collections ?? []).map((c) => c.name),
      ...(marker.persons ?? []).map((p) => p.name),
    ].filter(Boolean).join('\n'))
    textCache.set(marker, text)
  }
  return text
}

export function searchTerms(query) {
  return fold(query).split(/\s+/).filter(Boolean)
}

export function matchesTerms(marker, terms) {
  const text = searchableText(marker)
  return terms.every((term) => text.includes(term))
}

// Returns matching markers, best first: label starts with the query, then label contains words.
export function searchMarkers(markers, query, limit = Infinity) {
  const terms = searchTerms(query)
  if (!terms.length) return []
  const phrase = terms.join(' ')
  return markers
    .filter((m) => matchesTerms(m, terms))
    .map((m) => {
      const label = fold(m.label)
      const score = (label.startsWith(phrase) ? 10 : 0) + (label.includes(phrase) ? 5 : 0) + terms.filter((t) => label.includes(t)).length
      return { m, score }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ m }) => m)
}
