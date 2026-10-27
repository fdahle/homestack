// Pure date / task helpers, extracted so they can be unit-tested without pulling
// in PouchDB and the rest of the notes store.

// A note is a "task" if explicitly flagged or if it has a due date.
// This is a pure read-time derivation — never stored.
export function isTaskNote(note) {
  return note.isTask === true || (note.dueDate != null && note.dueDate !== '')
}

// Local-timezone YYYY-MM-DD. dueDate strings come from a date picker (local
// calendar day), so all date-bucket comparisons must use the local date too —
// toISOString() would yield the UTC day and bucket notes a day off for users
// far from UTC or near midnight.
export function localDateStr(d = new Date()) {
  const y   = d.getFullYear()
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getNextDueDate(currentDue, recurrence) {
  const d = new Date(currentDue + 'T00:00:00')
  if (recurrence === 'daily')        d.setDate(d.getDate() + 1)
  else if (recurrence === 'weekly')  d.setDate(d.getDate() + 7)
  else if (recurrence === 'monthly') d.setMonth(d.getMonth() + 1)
  return localDateStr(d)
}
