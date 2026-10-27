function daysInMonth(year, month) {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return y > 0 && (m === undefined || (m >= 1 && m <= 12)) &&
    (d === undefined || (d >= 1 && d <= daysInMonth(y, m)))
}

export function normDate(value, end = false) {
  if (!value) return ''
  const [y, m, d] = value.split('-')
  if (!m) return `${y}-${end ? '12-31' : '01-01'}`
  if (!d) return `${y}-${m}-${end ? daysInMonth(+y, +m) : '01'}`
  return value
}

export function validateDates(start, end) {
  if ((start && !validDate(start)) || (end && !validDate(end))) return 'Enter a valid year, month or calendar date'
  return start && end && normDate(start) > normDate(end, true) ? 'Start date must be before end date' : null
}

export function parseDate(input) {
  if (!input) return ''
  if (typeof input !== 'string') return null
  const value = input.trim()
  let parts
  if (/^\d{4}([-/]\d{1,2}){0,2}$/.test(value)) parts = value.split(/[-/]/)
  else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(value)) parts = value.split(/[-/.]/).reverse()
  else if (/^\d{1,2}[-/.]\d{4}$/.test(value)) parts = value.split(/[-/.]/).reverse()
  else return null
  const result = parts.map((p, i) => i ? p.padStart(2, '0') : p).join('-')
  return validDate(result) ? result : null
}
