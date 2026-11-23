import { addIcons } from './kit/icons.js';

// Icons only Regal uses (the kit has the common ones)
addIcons({
  books: '<rect x="3.5" y="4" width="4.5" height="16" rx="1"/><rect x="10" y="4" width="4.5" height="16" rx="1"/><path d="M16.3 5.3l3.4-.9 2.8 14.6-3.4.9z"/><path d="M3.5 8h4.5M10 8h4.5"/>',
  'book-open': '<path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5z"/><path d="M12 6.5v13"/>',
  book: '<path d="M5 19.5v-14A2.5 2.5 0 0 1 7.5 3H19v14H7.5A2.5 2.5 0 0 0 5 19.5zm0 0A2.5 2.5 0 0 0 7.5 22H19v-5"/>',
  tablet: '<rect x="5.5" y="3" width="13" height="18" rx="2"/><path d="M10 17.5h4"/>',
  pages: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 16h6"/>',
  goal: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
});
