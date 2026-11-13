// Reads WhatsApp chats: exported chats (.txt, or the .zip WhatsApp makes of it) and messages
// copied out of a chat. Both start each message with date, time and sender:
//   Android export   13.11.26, 17:05 - Max: Hallo
//   English Android  11/13/26, 5:05 PM - Max: Hi
//   iPhone export    [13.11.26, 17:05:12] Max: Hallo
//   copied messages  [13.11.26, 17:05] Max: Hallo
// Lines without such a start continue the message before.

import { inflateRawSync } from 'node:zlib';
import { findDateTime, looksLikePlan } from './dates.js';

const HEADER = /^\u200e?\[?(\d{1,4})[./-](\d{1,2})[./-](\d{2,4}),?\s+(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?(?:[\s\u202f]*([ap])\.?\s?m\.?)?\]?\s*(?:[-–]\s+)?(.*)$/i;

const pad = (n) => String(n).padStart(2, '0');

// Media, deleted messages and the like: they count, but say nothing
const NO_CONTENT = /^\u200e|^<.*>$|^(Diese Nachricht wurde gelöscht|Du hast diese Nachricht gelöscht|This message was deleted|You deleted this message|null)\.?$/i;

export function parseChat(text) {
  const lines = String(text || '').replace(/^\ufeff/, '').split(/\r?\n/);
  const heads = lines.map((line) => HEADER.exec(line));
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

// Finds the friend a WhatsApp sender name belongs to: a remembered alias, the full name,
// the nickname, a first name only one friend has, or the phone number WhatsApp shows for unknown contacts.
export function matchFriend(name, friends, aliases = []) {
  const key = normalizeName(name);
  if (!key) return null;
  const alias = aliases.find((a) => normalizeName(a.name) === key);
  if (alias) return alias.friend_id;
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

// --- zip ---

// The chat text from a WhatsApp .zip export (it holds _chat.txt and, with media, the files).
// Just enough of the zip format for that: the central directory, stored or deflated entries.
export function chatFromZip(buffer, maxSize = 50 * 1024 * 1024) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip file');
  const count = buffer.readUInt16LE(end + 10);
  let pos = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count && pos + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const size = buffer.readUInt32LE(pos + 24);
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    const offset = buffer.readUInt32LE(pos + 42);
    const name = buffer.toString('utf8', pos + 46, pos + 46 + nameLength);
    entries.push({ method, compressedSize, size, offset, name });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  const texts = entries.filter((e) => /\.txt$/i.test(e.name) && !e.name.includes('/'));
  const entry = texts.find((e) => /_chat\.txt$/i.test(e.name)) || texts.find((e) => /whatsapp/i.test(e.name)) || texts[0];
  if (!entry) throw new Error('no chat in the zip file');
  if (entry.size > maxSize) throw new Error('chat too large');
  const local = entry.offset;
  if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error('broken zip file');
  const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
  const data = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return data.toString('utf8');
  if (entry.method === 8) return inflateRawSync(data, { maxOutputLength: maxSize }).toString('utf8');
  throw new Error('unsupported zip compression');
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
export function draftFromText({ text, title = '', friends, aliases = [], meNames = [], now = new Date() }) {
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
      const id = matchFriend(m.sender, friends, aliases);
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
    const id = matchFriend(chatNameFromFile(title), friends, aliases);
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

// Messages in an imported chat that look like plans, newest first, with the friends they
// concern: in a one-to-one chat the other person, in a group whoever wrote it.
// owners: Map sender → friend id or 'me'
export function planCandidates(messages, { owners, partnerId = null, limit = 60 }) {
  const out = [];
  for (let i = messages.length - 1; i >= 0 && out.length < limit; i--) {
    const m = messages[i];
    if (m.media) continue;
    const ref = parseLocal(m.at);
    if (!looksLikePlan(m.text, ref)) continue;
    const { date, time } = findDateTime(m.text, ref);
    const owner = owners.get(m.sender);
    const friendIds = partnerId ? [partnerId] : owner && owner !== 'me' ? [owner] : [];
    out.push({ at: m.at, sender: m.sender, text: m.text, title: titleFrom(m.text), kind: guessKind(m.text), date, time, friendIds });
  }
  return out;
}
