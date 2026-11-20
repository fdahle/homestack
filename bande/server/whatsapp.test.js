import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatNameFromFile, draftFromText, matchFriend, mentionedFriends, parseChat } from './whatsapp.js';

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

test('copied in WhatsApp Web or Desktop: time first', () => {
  const { messages } = parseChat('[20:15, 12.11.2026] Max Mustermann: Kino am Samstag?\nOder lieber Sonntag\n[20:16, 12.11.2026] Felix: Samstag!');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].at, '2026-11-12T20:15');
  assert.equal(messages[0].sender, 'Max Mustermann');
  assert.equal(messages[0].text, 'Kino am Samstag?\nOder lieber Sonntag');
  const us = parseChat('[8:15 PM, 11/12/2026] Jo: movie?');
  assert.equal(us.messages[0].at, '2026-11-12T20:15');
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
});

test('names mentioned in a text', () => {
  assert.deepEqual(mentionedFriends('Kommt Max auch? Und Anna Berg?', friends), [1, 4]);
  assert.deepEqual(mentionedFriends('Anna kommt', friends), []); // which Anna?
  assert.deepEqual(mentionedFriends('Maximal lecker', friends), []);
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
