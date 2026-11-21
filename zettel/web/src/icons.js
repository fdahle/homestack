import { addIcons } from './kit/icons.js';

// Zettel's symbols, in the kit's style (24×24, 2px round stroke)
addIcons({
  note: '<path d="M5 4.5h14v10.5l-5 5H5z"/><path d="M14 20v-5h5"/><path d="M8.5 9h7M8.5 12.5h4"/>',
  pin: '<path d="M9 3.5h6l-1 5.5 3 3V14H7v-2l3-3z"/><path d="M12 14v6.5"/>',
  archive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  unarchive: '<rect x="3.5" y="4.5" width="17" height="4.5" rx="1"/><path d="M5 9v9.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M12 17.5v-5M9.5 15 12 12.5l2.5 2.5"/>',
  tag: '<path d="M4 12.6V5a1 1 0 0 1 1-1h7.6a1 1 0 0 1 .7.3l6.4 6.4a1 1 0 0 1 0 1.4l-7.6 7.6a1 1 0 0 1-1.4 0l-6.4-6.4a1 1 0 0 1-.3-.7z"/><circle cx="8.5" cy="8.5" r="1.3"/>',
  paperclip: '<path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5z"/><path d="M9.5 13.8l2 2 3.5-3.6"/>',
  'cloud-up': '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5z"/><path d="M12 16.5v-5M9.8 13.6 12 11.4l2.2 2.2"/>',
  'cloud-off': '<path d="M6.4 9.5A4.5 4.5 0 0 0 7 18.5h10M9.4 5.6A6 6 0 0 1 17.9 11a3.8 3.8 0 0 1 2.2 5.9"/><path d="M4 4l16 16"/>',
  bold: '<path d="M7 5h5.5a3.5 3.5 0 0 1 0 7H7zM7 12h6.5a3.5 3.5 0 0 1 0 7H7z"/>',
  italic: '<path d="M10 5h8M6 19h8M14 5l-4 14"/>',
  strike: '<path d="M5 12h14"/><path d="M16.5 7.5C16 5.8 14.3 5 12 5c-2.7 0-4.5 1.3-4.5 3.3 0 1.3.8 2.2 2.3 2.7M8 16.5c.5 1.7 2 2.5 4.2 2.5 2.8 0 4.6-1.3 4.6-3.4 0-.6-.2-1.2-.5-1.6"/>',
  heading: '<path d="M6 5v14M17 5v14M6 12h11"/>',
  list: '<path d="M9.5 6.5h10.5M9.5 12h10.5M9.5 17.5h10.5"/><circle cx="5" cy="6.5" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="17.5" r="1" fill="currentColor"/>',
  'list-ordered': '<path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H20"/><path d="M4.5 5l1.5-1v5"/><path d="M4.3 14.5c.3-.8 2.7-.9 2.7.6 0 1.3-2.7 2.1-2.7 3.4H7"/>',
  checklist: '<rect x="3.5" y="4" width="5.5" height="5.5" rx="1.2"/><path d="M4.5 16.3l1.7 1.7 3-3.2"/><path d="M12.5 6.8H20M12.5 16.5H20"/>',
  quote: '<path d="M10 7H6.5A1.5 1.5 0 0 0 5 8.5V12h5zM10 12v1.5A4.5 4.5 0 0 1 5.5 18M19 7h-3.5A1.5 1.5 0 0 0 14 8.5V12h5zM19 12v1.5a4.5 4.5 0 0 1-4.5 4.5"/>',
  code: '<path d="M8.5 7 3.5 12l5 5M15.5 7l5 5-5 5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.7"/><path d="M4 4v5h5"/>',
  file: '<path d="M14 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8z"/><path d="M14 3.5V8h4.5"/>',
  'check-box': '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 12.3l2.7 2.7 5.3-5.6"/>',
  box: '<rect x="4" y="4" width="16" height="16" rx="3.5"/>',
});
