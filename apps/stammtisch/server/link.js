// The link API for Fernweh: your friends and where they live, so Fernweh can put them on its map.
// Server to server (over a shared Docker network, never through the login proxy), so it comes
// before the login: the shared secret LINK_TOKEN is the key (STAMMTISCH_LINK_TOKEN in Fernweh).
//
//   GET /api/link/people   Authorization: Bearer <LINK_TOKEN>
//   → { people: [{ id, name, nickname, city, address, archived, updated_at }] }
//
// Only these fields leave Stammtisch: no phone numbers, e-mail, birthdays or notes.
// Without LINK_TOKEN the endpoint isn't there (404); a missing or wrong token gets a 401.

import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s) => createHash('sha256').update(String(s)).digest();
// Same length either way, so the comparison takes the same time whatever was sent
export const sameSecret = (a, b) => timingSafeEqual(digest(a), digest(b));

// people: () => the list (store.linkPeople)
export function mountLinkApi(app, { token = process.env.LINK_TOKEN || '', people }) {
  app.get('/api/link/people', (req, res) => {
    if (!token) return res.status(404).json({ error: 'not_found' });
    const [, given] = /^Bearer\s+(\S+)\s*$/i.exec(req.get('authorization') || '') || [];
    if (!given || !sameSecret(given, token)) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ error: 'wrong_token' });
    }
    res.set('Cache-Control', 'no-store').json({ people: people() });
  });
}
