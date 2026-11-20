// Reads messages copied out of a WhatsApp chat (or pasted from an exported one). Each message
// starts with date, time and sender:
//   copied on Android      [13.11.26, 17:05] Max: Hallo
//   copied in Web/Desktop  [17:05, 13.11.2026] Max: Hallo
//   Android export         13.11.26, 17:05 - Max: Hallo
//   English Android        11/13/26, 5:05 PM - Max: Hi
//   iPhone export          [13.11.26, 17:05:12] Max: Hallo
// Lines without such a start continue the message before.

import { findDateTime } from './dates.js';

const HEADER = /^\u200e?\[?(\d{1,4})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?(?:[\s\u202f]*([ap])\.?\s?m\.?)?\]?\s*(?:[-–]\s+)?(.*)$/i;

// Copied in WhatsApp Web or Desktop the time comes first: [17:05, 13.11.2026] Max: Hallo
const TIME_FIRST = /^\[(\d{1,2})[:.](\d{2})(?:\s*([ap])\.?\s?m\.?)?,\s*(\d{1,4})[./-](\d{1,2})[./-](\d{2,4})\]\s*(.*)$/i;

// The start of a message as [line, date parts a, b, c, hour, minute, am/pm, rest], or null
function header(line) {
  const m = HEADER.exec(line);
  if (m) return m;
  const t = TIME_FIRST.exec(line);
  return t && [t[0], t[4], t[5], t[6], t[1], t[2], t[3], t[7]];
}

const pad = (n) => String(n).padStart(2, '0');

// Media, deleted messages and the like: they count, but say nothing
const NO_CONTENT = /^\u200e|^<.*>$|^(Diese Nachricht wurde gelöscht|Du hast diese Nachricht gelöscht|This message was deleted|You deleted this message|null)\.?$/i;

export function parseChat(text) {
  const lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/);
  const heads = lines.map(header);
  const found = heads.filter(Boolean);
  if (!found.length) return { messages: [] };

  // Day or month first? Decided once for the whole chat: a number above 12 tells, otherwise
  // dots mean day first (German) and AM/PM month first (US)
  const firsts = found.filter((m) => m[1].length <= 2);
  let dayFirst = true;
  if (firsts.some((m) => Number(m[2]) > 12)) dayFirst = false;
  else if (firsts.some((m) => Number(m[1]) > 12)) dayFirst = true;
  else if (found.some((m) => m[6]) && !lines.some((l) => /^\[?\d{1,2}\.\d{1,2}\./.test(l))) dayFirst = false;

  const messages = [];
  let current = null;
  lines.forEach((line, i) => {
    const m = heads[i];
    if (!m) {
      if (current) current.text += `\n${line}`;
      return;
    }
    let [, a, b, c, h, min, ampm, rest] = m;
    let y, mo, d;
    if (a.length === 4) [y, mo, d] = [Number(a), Number(b), Number(c)];
    else [d, mo, y] = dayFirst ? [Number(a), Number(b), Number(c)] : [Number(b), Number(a), Number(c)];
    if (y < 100) y += 2000;
    let hour = Number(h);
    if (ampm) hour = (hour % 12) + (ampm.toLowerCase() === 'p' ? 12 : 0);
    const date = new Date(y, mo - 1, d);
    if (date.getMonth() !== mo - 1 || hour > 23) {
      if (current) current.text += `\n${line}`;
      return;
    }
    // "Name: text". Without a colon it is a system line ("Max hat die Gruppe erstellt").
    const colon = rest.indexOf(': ');
    current = null;
    if (colon <= 0) return;
    current = {
      at: `${y}-${pad(mo)}-${pad(d)}T${pad(hour)}:${pad(min)}`,
      sender: cleanName(rest.slice(0, colon)),
      text: rest.slice(colon + 2),
    };
    messages.push(current);
  });
  for (const msg of messages) msg.media = NO_CONTENT.test(msg.text.trim());
  return { messages };
}

// Names come with direction marks and the odd invisible character
const cleanName = (name) => name.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();

// "WhatsApp Chat mit Max Mustermann.txt" → "Max Mustermann"
export function chatNameFromFile(filename) {
  return String(filename || '')
    .replace(/\.(txt|zip)$/i, '')
    .replace(/^WhatsApp[ -]Chat\s*(mit|with|-|–)?\s*/i, '')
    .replace(/^_chat$/i, '')
    .trim();
}

// --- matching names to friends ---

// Lower case, no accents, no emoji: "Jörg 🍺" → "jorg"
export const normalizeName = (name) =>
  String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();

// The last nine digits: +49 151 2345678, 0151 2345678 and 0049151… are the same number
export const phoneKey = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-9) : null;
};

// Finds the friend a WhatsApp sender name belongs to: the full name,
// the nickname, a first name only one friend has, or the phone number WhatsApp shows for unknown contacts.
export function matchFriend(name, friends) {
  const key = normalizeName(name);
  if (!key) return null;
  const byName = friends.filter((f) => normalizeName(f.name) === key || (f.nickname && normalizeName(f.nickname) === key));
  if (byName.length === 1) return byName[0].id;
  const phone = /^[+\d\s()/-]{6,}$/.test(name) ? phoneKey(name) : null;
  if (phone) return friends.find((f) => phoneKey(f.phone) === phone)?.id ?? null;
  const first = key.split(' ')[0];
  const byFirst = friends.filter((f) => normalizeName(f.name).split(' ')[0] === first);
  return byFirst.length === 1 && first.length >= 3 ? byFirst[0].id : null;
}

// Friends whose first name, full name or nickname appears as a word in a text
export function mentionedFriends(text, friends) {
  const words = ` ${normalizeName(text)} `;
  const out = [];
  for (const f of friends) {
    const names = [normalizeName(f.name), normalizeName(f.name).split(' ')[0], f.nickname && normalizeName(f.nickname)];
    if (names.some((n) => n && n.length >= 3 && words.includes(` ${n} `))) out.push(f.id);
  }
  // A first name several friends share says nothing
  const firstCounts = new Map();
  for (const f of friends) {
    const first = normalizeName(f.name).split(' ')[0];
    firstCounts.set(first, (firstCounts.get(first) || 0) + 1);
  }
  return out.filter((id) => {
    const f = friends.find((x) => x.id === id);
    const full = normalizeName(f.name);
    const first = full.split(' ')[0];
    return firstCounts.get(first) === 1 || words.includes(` ${full} `) || (f.nickname && words.includes(` ${normalizeName(f.nickname)} `));
  });
}

// --- event drafts ---

const parseLocal = (at) => {
  const [d, t = '00:00'] = at.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y, m - 1, day, h, min);
};
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// The first line, at most 60 characters, cut at a word
export function titleFrom(text) {
  const line = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const clean = line.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60)}…`;
}

export function guessKind(text) {
  const t = String(text || '').toLowerCase();
  if (/telefon|anruf|anrufen|call\b|facetime|videocall|skype|zoom/.test(t)) return 'call';
  if (/urlaub|reise|trip|ausflug|roadtrip|camping|festival|vacation|holiday/.test(t)) return 'trip';
  if (/party|feier|geburtstag|hochzeit|polterabend|silvester|birthday|wedding|housewarming|einweihung/.test(t)) return 'party';
  return 'meet';
}

// Turns shared or pasted text into a draft event: date and time from the words, friends from
// senders, the share title (often the chat's name) and names in the text.
// Copied messages carry their time, so "morgen" counts from when it was written.
export function draftFromText({ text, title = '', friends, meNames = [], now = new Date() }) {
  const { messages } = parseChat(text);
  const me = new Set(meNames.map(normalizeName));
  const friendIds = new Set();
  let focus = String(text || '').trim();
  let ref = now;
  let notes = focus;
  let mentionText = focus;
  if (messages.length) {
    for (const m of messages) {
      if (me.has(normalizeName(m.sender))) continue;
      const id = matchFriend(m.sender, friends);
      if (id) friendIds.add(id);
    }
    // The newest message that names a day is most likely the plan
    const said = messages.filter((m) => !m.media);
    const pick = [...said].reverse().find((m) => findDateTime(m.text, parseLocal(m.at)).date) || said[0] || messages.at(-1);
    focus = pick.text;
    ref = parseLocal(pick.at);
    notes = messages.map((m) => `${m.sender}: ${m.text}`).join('\n');
    mentionText = said.map((m) => m.text).join('\n');
  }
  if (title) {
    const id = matchFriend(chatNameFromFile(title), friends);
    if (id) friendIds.add(id);
  }
  for (const id of mentionedFriends(mentionText, friends)) friendIds.add(id);

  let { date, time } = findDateTime(focus, ref);
  if (!date) ({ date, time } = findDateTime(mentionText, ref));
  const today = localIso(now);
  return {
    title: titleFrom(focus),
    kind: guessKind(mentionText),
    status: !date ? 'idea' : date >= today ? 'planned' : 'done',
    date,
    time: date ? time : null,
    friendIds: [...friendIds],
    notes,
    source: 'whatsapp',
  };
}
