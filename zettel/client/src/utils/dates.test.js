import { describe, it, expect, vi, afterEach } from 'vitest'
import { isTaskNote, localDateStr, getNextDueDate } from './dates.js'

describe('isTaskNote', () => {
  it('treats explicitly flagged notes as tasks', () => {
    expect(isTaskNote({ isTask: true })).toBe(true)
  })
  it('treats notes with a due date as tasks', () => {
    expect(isTaskNote({ dueDate: '2026-01-01' })).toBe(true)
  })
  it('is false for plain notes', () => {
    expect(isTaskNote({})).toBe(false)
    expect(isTaskNote({ isTask: false, dueDate: '' })).toBe(false)
    expect(isTaskNote({ dueDate: null })).toBe(false)
  })
})

describe('localDateStr', () => {
  it('formats a date as local YYYY-MM-DD', () => {
    // Construct via local components so the result is timezone-independent.
    const d = new Date(2026, 0, 5) // 2026-01-05 local
    expect(localDateStr(d)).toBe('2026-01-05')
  })

  it('uses the LOCAL day, not the UTC day (regression for timezone bug)', () => {
    // 23:30 local on Jan 10 is still Jan 10 locally even if UTC has rolled over.
    const d = new Date(2026, 0, 10, 23, 30)
    expect(localDateStr(d)).toBe('2026-01-10')
  })
})

describe('getNextDueDate', () => {
  it('advances daily/weekly/monthly recurrences', () => {
    expect(getNextDueDate('2026-01-10', 'daily')).toBe('2026-01-11')
    expect(getNextDueDate('2026-01-10', 'weekly')).toBe('2026-01-17')
    expect(getNextDueDate('2026-01-10', 'monthly')).toBe('2026-02-10')
  })

  it('returns a local date string (no UTC off-by-one)', () => {
    // Whatever the runner's timezone, the result must round-trip as the same day.
    const next = getNextDueDate('2026-06-30', 'daily')
    expect(next).toBe('2026-07-01')
  })
})
