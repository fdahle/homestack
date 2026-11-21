import { addIcons } from './kit/icons.js';

// Icons only Watchlist uses (the kit has the common ones)
addIcons({
  film: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M16 4v16M4 8.5h4M4 15.5h4M16 8.5h4M16 15.5h4"/>',
  tv: '<rect x="3" y="6" width="18" height="12.5" rx="2"/><path d="M8.5 21.5h7M9 2.5l3 3.5 3-3.5"/>',
  queue: '<path d="M4 6h11M4 11h7M4 16h7"/><path d="M14.5 11.5v7l5.5-3.5z"/>',
  checks: '<path d="M2.5 12.5l4 4 8-9"/><path d="M11.5 16l.5.5 8-9"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z"/>',
});
