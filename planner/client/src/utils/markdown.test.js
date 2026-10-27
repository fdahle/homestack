// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderPlain, renderChecklist, renderCheckableMarkdown, toggleCheckbox, sortCheckboxItems } from './markdown.js'

describe('renderPlain', () => {
  it('escapes HTML so plain text cannot inject markup', () => {
    const html = renderPlain('<script>alert(1)</script> & <b>x</b>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
  })
})

describe('renderCheckableMarkdown (sanitization)', () => {
  it('strips script tags from rendered markdown', () => {
    const html = renderCheckableMarkdown('# Hi\n\n<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Hi')
  })

  it('removes inline event handlers', () => {
    const html = renderCheckableMarkdown('<img src=x onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })
})

describe('renderChecklist', () => {
  it('escapes labels and emits checkbox inputs', () => {
    const html = renderChecklist('- [ ] <b>todo</b>\n- [x] done')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('<b>todo</b>')
    expect(html).toContain('&lt;b&gt;todo&lt;/b&gt;')
  })
})

describe('checkbox helpers', () => {
  it('sorts unchecked before checked', () => {
    const out = sortCheckboxItems('- [x] a\n- [ ] b')
    expect(out).toBe('- [ ] b\n- [x] a')
  })

  it('toggles the nth checkbox', () => {
    const out = toggleCheckbox('- [ ] a\n- [ ] b', 1, true)
    expect(out).toContain('- [x] b')
  })
})
