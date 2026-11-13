import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateRawSync } from 'node:zlib';
import { chatFromZip, chatNameFromFile, draftFromText, matchFriend, mentionedFriends, parseChat, planCandidates } from './whatsapp.js';

const LRM = String.fromCharCode(0x200e);
const NNBSP = String.fromCharCode(0x202f);

test('Android export, German', () => {
  const { messages } = parseChat([
    '13.11.26, 17:05 - Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.',
    '13.11.26, 17:05 - Max Mustermann: Wollen wir Samstag grillen?',
    'Ich bring Würstchen mit',
    '13.11.26, 17:07 - Felix: <Medien ausgeschlossen>',
    '13.11.26, 17:08 - Felix: Klar: um 7?',
  ].join('\n'));
  assert.equal(messages.length, 3);
  assert.deepEqual(messages[0], { at: '2026-11-13T17:05', sender: 'Max Mustermann', text: 'Wollen wir Samstag grillen?\nIch bring Würstchen mit', media: false });
  assert.equal(messages[1].media, true);
  assert.equal(messages[2].text, 'Klar: um 7?');
});

test('iPhone export with seconds and direction marks', () => {
  const { messages } = parseChat([
    `[13.11.26, 17:05:12] Anna: ${LRM}Nachrichten und Anrufe sind Ende-zu-Ende-verschlüsselt.`,
    `${LRM}[13.11.26, 17:06:40] ${LRM}Anna: Kino?`,
    `[13.11.26, 17:07:01] Felix: ${LRM}Bild weggelassen`,
  ].join('\r\n'));
  assert.equal(messages.length, 3);
  assert.equal(messages[1].sender, 'Anna');
  assert.equal(messages[1].at, '2026-11-13T17:06');
  assert.equal(messages[2].media, true);
});

test('US export with AM/PM, month first', () => {
  const { messages } = parseChat([
    `11/13/26, 5:05${NNBSP}PM - Jo: dinner friday?`,
    '11/14/26, 9:01 AM - Me: sure',
  ].join('\n'));
  assert.equal(messages[0].at, '2026-11-13T17:05');
  assert.equal(messages[1].at, '2026-11-14T09:01');
});

test('day first when a number shows it', () => {
  const { messages } = parseChat('13/11/2026, 17:05 - Jo: hi\n02/12/2026, 08:00 - Jo: hey');
  assert.equal(messages[1].at, '2026-12-02T08:00');
});

test('chat names from file names', () => {
  assert.equal(chatNameFromFile('WhatsApp Chat mit Max Mustermann.txt'), 'Max Mustermann');
  assert.equal(chatNameFromFile('WhatsApp Chat with Jo.zip'), 'Jo');
  assert.equal(chatNameFromFile('WhatsApp Chat - Klettergruppe.zip'), 'Klettergruppe');
  assert.equal(chatNameFromFile('_chat.txt'), '');
});

const friends = [
  { id: 1, name: 'Max Mustermann', nickname: null, phone: '+49 151 2345678' },
  { id: 2, name: 'Anna Schmidt', nickname: 'Anni' },
  { id: 3, name: 'Jörg Weber', nickname: null },
  { id: 4, name: 'Anna Berg', nickname: null },
];

test('matching senders to friends', () => {
  assert.equal(matchFriend('Max Mustermann', friends), 1);
  assert.equal(matchFriend('max mustermann 🍺', friends), 1);
  assert.equal(matchFriend('Anni', friends), 2);
  assert.equal(matchFriend('Jorg', friends), 3);
  assert.equal(matchFriend('+49 151 2345678', friends), 1);
  assert.equal(matchFriend('01512345678', friends), 1);
  assert.equal(matchFriend('Anna', friends), null); // two Annas
  assert.equal(matchFriend('Maxi', friends), null);
  assert.equal(matchFriend('Big M', friends, [{ name: 'Big M', friend_id: 1 }]), 1);
});

test('names mentioned in a text', () => {
  assert.deepEqual(mentionedFriends('Kommt Max auch? Und Anna Berg?', friends), [1, 4]);
  assert.deepEqual(mentionedFriends('Anna kommt', friends), []); // which Anna?
  assert.deepEqual(mentionedFriends('Maximal lecker', friends), []);
});

// A zip with one deflated file, like WhatsApp makes
function zip(name, content) {
  const data = Buffer.from(content);
  const packed = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const centralStart = local.length + nameBuf.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, nameBuf, packed, central, nameBuf, end]);
}

test('reading the chat from a zip export', () => {
  const text = '[13.11.26, 17:05:12] Anna: Hallo Welt';
  assert.equal(chatFromZip(zip('_chat.txt', text)), text);
  assert.throws(() => chatFromZip(Buffer.from('nope')));
});

test('draft from copied messages counts from when they were written', () => {
  const draft = draftFromText({
    text: '[12.11.26, 20:15] Max Mustermann: Wollen wir morgen grillen? So um 7\n[12.11.26, 20:16] Felix: Gerne!',
    friends,
    meNames: ['Felix'],
    now: new Date(2026, 10, 13, 10),
  });
  assert.equal(draft.date, '2026-11-13');
  assert.equal(draft.time, '19:00');
  assert.equal(draft.status, 'planned');
  assert.deepEqual(draft.friendIds, [1]);
  assert.equal(draft.title, 'Wollen wir morgen grillen? So um 7');
});

test('draft from plain text: no date makes it an idea', () => {
  const draft = draftFromText({ text: 'Mal wieder zusammen kochen mit Anni', friends, now: new Date(2026, 10, 13) });
  assert.equal(draft.status, 'idea');
  assert.deepEqual(draft.friendIds, [2]);
  const party = draftFromText({ text: 'Geburtstagsparty am 2.11.', title: 'Jörg Weber', friends, now: new Date(2026, 10, 13) });
  assert.equal(party.status, 'done');
  assert.equal(party.kind, 'party');
  assert.deepEqual(party.friendIds, [3]);
});

test('plan candidates in a chat', () => {
  const { messages } = parseChat([
    '01.11.26, 10:00 - Max Mustermann: Wie gehts?',
    '01.11.26, 10:05 - Felix: Gut! Hast du Samstag Zeit?',
    '01.11.26, 10:06 - Max Mustermann: Ja, 19 Uhr bei mir',
  ].join('\n'));
  const owners = new Map([['Max Mustermann', 1], ['Felix', 'me']]);
  const plans = planCandidates(messages, { owners, partnerId: 1 });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].date, '2026-11-07');
  assert.deepEqual(plans[0].friendIds, [1]);
});
