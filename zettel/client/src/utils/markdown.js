import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.use({ breaks: true })

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function renderPlain(text) {
  if (!text) return ''
  return `<span style="white-space:pre-wrap">${escapeHtml(text)}</span>`
}

const CHECKBOX_RE = /^\s*[-*+] \[( |x|X)\] (.*)$/

function splitCheckboxLines(markdown) {
  const unchecked = [], checked = []
  for (const line of (markdown || '').split('\n')) {
    const m = line.match(CHECKBOX_RE)
    if (!m) continue
    ;(m[1] === ' ' ? unchecked : checked).push({ checked: m[1] !== ' ', label: m[2] })
  }
  return { unchecked, checked }
}

/** Re-order checkbox lines in markdown: unchecked first, checked last. */
export function sortCheckboxItems(markdown) {
  const { unchecked, checked } = splitCheckboxLines(markdown)
  return [
    ...unchecked.map(i => `- [ ] ${i.label}`),
    ...checked  .map(i => `- [x] ${i.label}`),
  ].join('\n')
}

/** Toggle the Nth checkbox (0-based) in markdown text and re-sort. */
export function toggleCheckbox(markdown, idx, checked) {
  let count = 0
  const toggled = (markdown || '').replace(
    /^(\s*[-*+] \[)[ xX](\] .*)$/gm,
    (match, before, after) => count++ === idx ? `${before}${checked ? 'x' : ' '}${after}` : match
  )
  return sortCheckboxItems(toggled)
}

/** Render checklist: two groups (unchecked then checked), no markdown parser. */
export function renderChecklist(text) {
  const { unchecked, checked } = splitCheckboxLines(text || '')
  let idx = 0
  const render = (items, extraCls) => items.map(({ label }) => {
    const isChecked = extraCls.includes('checked')
    const escaped = escapeHtml(label)
    return `<div class="task-item${extraCls}"><input type="checkbox"${isChecked ? ' checked' : ''} data-checkbox-idx="${idx++}"><span>${escaped}</span></div>`
  })
  const uncheckedHtml = render(unchecked, '')
  const checkedHtml   = render(checked,   ' task-item--checked')
  if (checkedHtml.length) checkedHtml[0] = checkedHtml[0].replace('task-item--checked', 'task-item--first-checked task-item--checked')
  return DOMPurify.sanitize([...uncheckedHtml, ...checkedHtml].join('\n'), { ADD_ATTR: ['data-checkbox-idx'] })
}

const ALLOWED_URI_REGEXP = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

/** Render full markdown (used for markdown mode only). */
export function renderCheckableMarkdown(text) {
  return DOMPurify.sanitize(marked.parse(text || ''), { ALLOWED_URI_REGEXP })
}

export function hasCheckboxes(text) {
  return /^\s*- \[[ xX]\] /m.test(text || '')
}

/** Turn plain/markdown text into checklist markdown — one checkbox per non-empty line. */
export function textToChecklist(text) {
  return (text || '').split('\n').map(line => {
    if (/^\s*[-*+] \[[ xX]\] /.test(line)) return line
    const ulMatch = line.match(/^(\s*)[-*+] (.*)$/)
    if (ulMatch) return `${ulMatch[1]}- [ ] ${ulMatch[2]}`
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/)
    if (olMatch) return `${olMatch[1]}- [ ] ${olMatch[2]}`
    if (line.trim() !== '') return `- [ ] ${line}`
    return line
  }).join('\n')
}

/** Strip checkbox prefixes, returning plain text. */
export function checklistToText(text) {
  return (text || '').replace(/^(\s*)[-*+] \[[ xX]\] /gm, '$1')
}

/** Route a note to the correct renderer based on its contentType. */
export function renderNoteContent(note) {
  const type = note.contentType ?? (hasCheckboxes(note.content) ? 'checklist' : 'plain')
  if (type === 'checklist') return renderChecklist(note.content)
  if (type === 'markdown')  return renderCheckableMarkdown(note.content)
  return renderPlain(note.content)
}
