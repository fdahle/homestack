import { ref } from 'vue';
import { compareText, formatNumber } from './kit/util.js';
import { t } from './i18n.js';

export * from './kit/util.js';

// --- statuses ---

export const STATUSES = ['playing', 'finished', 'completed', 'dropped', 'backlog', 'wishlist'];
export const STATUS_ICONS = { wishlist: 'heart', backlog: 'stack', playing: 'gamepad', finished: 'flag', completed: 'trophy', dropped: 'stop' };
// What you were or are doing with a game (not just wishing for or stacking it)
export const PLAYED = ['playing', 'finished', 'completed', 'dropped'];
export const BEATEN = ['finished', 'completed'];

export const formatHours = (h) => (h == null ? '' : t('hours', { n: formatNumber(h, 1) }));

// --- covers ---

export const coverUrl = (game) => (game?.cover_file ? `/covers/${game.cover_file}` : null);
// Game covers are 3:4
export const COVER_SIZE = { width: 600, height: 800 };

// --- lists ---

export const byName = (a, b) => compareText(a.name, b.name);

// A game's platforms to filter by: the one you played it on, else the ones it came out on
export const gamePlatforms = (g) => (g.played_on ? [g.played_on] : g.platforms);

// The last change made on a game's page: { id, game } or { id, deleted: true }.
// The library beside it watches this instead of loading everything again.
export const gameChange = ref(null);
