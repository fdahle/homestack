// Categories, collections and persons are listed alphabetically everywhere. The server's ORDER BY name
// is case-sensitive and puts umlauts last, so the client sorts itself, also after creating or renaming.
export const byName = (a, b) => a.name.localeCompare(b.name)
