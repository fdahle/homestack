import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checklistCount, firstLine, inlineText, plainText, previewLines } from './markdown.js';

test('preview: kinds of lines, syntax taken out', () => {
  const lines = previewLines('# Einkauf\n\n- [ ] **Milch**\n- [x] Brot\n  - [ ] Vollkorn\n\n\n* Eier\n> Zitat\n```\ncode\n```\nEnde [Link](https://x.de)\n\n');
  assert.deepEqual(lines, [
    { kind: 'heading', text: 'Einkauf' },
    { kind: 'gap', text: '' },
    { kind: 'check', checked: false, text: 'Milch', depth: 0 },
    { kind: 'check', checked: true, text: 'Brot', depth: 0 },
    { kind: 'check', checked: false, text: 'Vollkorn', depth: 1 },
    { kind: 'gap', text: '' },
    { kind: 'bullet', text: 'Eier', depth: 0 },
    { kind: 'quote', text: 'Zitat' },
    { kind: 'code', text: 'code' },
    { kind: 'text', text: 'Ende Link' },
  ]);
});

test('preview stops at max lines', () => {
  assert.equal(previewLines('a\nb\nc\nd', 2).length, 2);
});

test('inline syntax', () => {
  assert.equal(inlineText('_kursiv_ und *auch* und `code` und ~~weg~~ und \\*Stern'), 'kursiv und auch und code und weg und *Stern');
  assert.equal(inlineText('snake_case_name bleibt'), 'snake_case_name bleibt');
});

test('checklist count, plain text, first line', () => {
  assert.deepEqual(checklistCount('- [ ] a\n- [x] b\n- [X] c\ntext'), { done: 2, total: 3 });
  assert.equal(checklistCount('nur text'), null);
  assert.equal(plainText('# Titel\n- [ ] **Milch**'), 'Titel\nMilch');
  assert.equal(firstLine('\n\n## Hallo *du*'), 'Hallo du');
});
