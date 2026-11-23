import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zip } from '../../../server/zip.js';
import { escapeLine, fromKeep, keepId, readTakeout, textToMarkdown } from './keep.js';
import { readZip } from './unzip.js';
import { plainText, previewLines } from './markdown.js';

// A ZIP as a File, made by the export's writer
async function zipFile(name, entries) {
  const chunks = await Array.fromAsync(zip(entries.map(([path, data, store]) => ({ name: path, data, date: new Date(), store }))));
  return new File(chunks, name, { type: 'application/zip' });
}

const usec = (iso) => Date.parse(iso) * 1000;
const keepNote = (fields = {}) => ({
  color: 'DEFAULT', isTrashed: false, isPinned: false, isArchived: false, title: '', textContent: '',
  userEditedTimestampUsec: usec('2024-03-02T10:00:00Z'), createdTimestampUsec: usec('2024-03-01T09:00:00Z'), ...fields,
});

test('zip: stored and deflated entries read back, folders left out', async () => {
  const text = 'Hallo Welt, '.repeat(500);
  const file = await zipFile('a.zip', [['dir/a.txt', text], ['dir/b.bin', Buffer.from([1, 2, 3]), true], ['dir/ü ß.txt', 'umlaut']]);
  const entries = await readZip(file);
  assert.deepEqual(entries.map((e) => e.name), ['dir/a.txt', 'dir/b.bin', 'dir/ü ß.txt']);
  assert.equal(await (await entries[0].open()).text(), text);
  assert.deepEqual([...new Uint8Array(await (await entries[1].open()).arrayBuffer())], [1, 2, 3]);
  assert.equal(await (await entries[2].open()).text(), 'umlaut');
  await assert.rejects(readZip(new File(['not a zip at all, just text'], 'x.zip')));
});

test('plain text: lines stay lines, empty lines make paragraphs, Markdown in it shows as typed', () => {
  assert.equal(textToMarkdown('Milch\nBrot\n\n\nEier  '), 'Milch\\\nBrot\n\nEier');
  assert.equal(escapeLine('# kein Titel'), '\\# kein Titel');
  assert.equal(escapeLine('- kein Punkt'), '\\- kein Punkt');
  assert.equal(escapeLine('1. keine Liste'), '1\\. keine Liste');
  assert.equal(escapeLine('> kein Zitat'), '\\> kein Zitat');
  assert.equal(escapeLine('==='), '\\===');
  assert.equal(escapeLine('*fett* [x] `c` snake_case _a_ AT&amp;T'), '\\*fett\\* \\[x\\] \\`c\\` snake_case \\_a\\_ AT\\&amp;T');
  assert.equal(escapeLine('siehe https://example.com/a_b*c~d und _x_'), 'siehe https://example.com/a_b*c~d und \\_x\\_');
  // The list shows it as it was typed
  assert.deepEqual(previewLines(textToMarkdown('# kein Titel\n- kein Punkt\n*Stern*')).map((l) => [l.kind, l.text]), [
    ['text', '# kein Titel'],
    ['text', '- kein Punkt'],
    ['text', '*Stern*'],
  ]);
  assert.equal(plainText('a\\\nb\\\\\nc'), 'a\nb\\\nc');
});

test('a Keep note: text, checklist, labels, colour, pinned, archived, times', async () => {
  const { trashed, fields } = await fromKeep(keepNote({
    title: ' Einkauf ',
    textContent: 'Für Samstag',
    listContent: [{ text: 'Milch', isChecked: false }, { text: '', isChecked: false }, { text: 'Brot\n2 Stück', isChecked: true }],
    labels: [{ name: 'Haus' }, { name: ' haus ' }, { name: 'Wichtig  heute' }],
    color: 'CERULEAN',
    isPinned: true,
    isArchived: true,
  }));
  assert.equal(trashed, false);
  assert.equal(fields.title, 'Einkauf');
  assert.equal(fields.body, 'Für Samstag\n\n- [ ] Milch\n- [x] Brot\\\n  2 Stück');
  assert.deepEqual(fields.labels, ['Haus', 'Wichtig heute']);
  assert.equal(fields.color, 'darkblue');
  assert.equal(fields.pinned, true);
  assert.equal(fields.created_at, '2024-03-01T09:00:00.000Z');
  assert.equal(fields.updated_at, '2024-03-02T10:00:00.000Z');
  assert.equal(fields.archived_at, fields.updated_at);
  assert.match(fields.id, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

  const plain = (await fromKeep(keepNote({ color: 'DEFAULT', isTrashed: true }))).fields;
  assert.equal(plain.color, '');
  assert.equal(plain.archived_at, null);
  assert.equal((await fromKeep(keepNote({ isTrashed: true }))).trashed, true);
});

test('links Keep found: only the ones not in the text already are added', async () => {
  const { fields } = await fromKeep(keepNote({
    textContent: 'Rezept: https://example.com/kuchen',
    annotations: [
      { source: 'WEBLINK', url: 'https://example.com/kuchen/', title: 'Kuchen' },
      { source: 'WEBLINK', url: 'https://example.org/a (b)', title: 'Mehr [dazu]' },
      { source: 'WEBLINK', url: 'https://example.net', title: '' },
      { source: 'WEBLINK', url: 'javascript:alert(1)', title: 'nein' },
    ],
  }));
  assert.equal(fields.body, 'Rezept: https://example.com/kuchen\n\n[Mehr \\[dazu\\]](https://example.org/a%20%28b%29)\n\nhttps://example.net');
});

test('the same note gets the same id, another account another one', async () => {
  const note = keepNote();
  assert.equal(await keepId(note, '1'), await keepId({ ...note, title: 'changed later' }, '1'));
  assert.notEqual(await keepId(note, '1'), await keepId(note, '2'));
  assert.notEqual(await keepId(note, '1'), await keepId(keepNote({ createdTimestampUsec: note.createdTimestampUsec + 1 }), '1'));
});

test('a Takeout download in two parts: notes found by their JSON, pictures in the other part, .jpg vs .jpeg', async () => {
  const one = await zipFile('takeout-001.zip', [
    ['Takeout/Notizen/Einkauf.json', JSON.stringify(keepNote({ title: 'Einkauf', attachments: [{ filePath: 'abc.jpg', mimetype: 'image/jpeg' }, { filePath: 'gone.png', mimetype: 'image/png' }] }))],
    ['Takeout/Notizen/Einkauf.html', '<html></html>'],
    ['Takeout/Notizen/Labels.txt', 'Haus'],
    ['Takeout/Notizen/leer.json', JSON.stringify(keepNote())],
    ['Takeout/Notizen/kaputt.json', '{ not json'],
    ['Takeout/archive_browser.json', JSON.stringify({ something: 'else' })],
  ]);
  const two = await zipFile('takeout-002.zip', [['Takeout/Notizen/abc.jpeg', Buffer.from([0xff, 0xd8, 0xff]), true]]);
  const broken = new File(['nope'], 'other.zip');
  const { notes, unreadable } = await readTakeout([one, two, broken], { owner: '7' });
  assert.deepEqual(unreadable, ['other.zip']);
  assert.equal(notes.length, 1, 'the empty note, the HTML and other JSON are left out');
  const [note] = notes;
  assert.equal(note.fields.title, 'Einkauf');
  assert.equal(note.missing, 1);
  assert.deepEqual(note.files.map((f) => [f.name, f.type]), [['abc.jpeg', 'image/jpeg']]);
  assert.equal((await (await note.files[0].open()).arrayBuffer()).byteLength, 3);
});

test('loose files picked instead of a ZIP work too', async () => {
  const json = new File([JSON.stringify(keepNote({ textContent: 'lose', attachments: [{ filePath: 'p.png', mimetype: 'image/png' }] }))], 'n.json', { type: 'application/json' });
  const picture = new File([new Uint8Array([1])], 'p.png', { type: 'image/png' });
  const { notes } = await readTakeout([json, picture]);
  assert.equal(notes[0].fields.body, 'lose');
  assert.equal(notes[0].files[0].name, 'p.png');
});
