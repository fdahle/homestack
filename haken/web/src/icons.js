import { addIcons } from './kit/icons.js';

// Haken's symbols, in the kit's style (24×24, 2px round stroke)
addIcons({
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  lists: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><rect x="3.5" y="5" width="3" height="3" rx=".8"/><rect x="3.5" y="10.5" width="3" height="3" rx=".8"/><rect x="3.5" y="16" width="3" height="3" rx=".8"/>',
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20"/>',
  repeat: '<path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19"/><path d="m16 3 3 3-3 3"/><path d="M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5"/><path d="m8 21-3-3 3-3"/>',
  priority: '<path d="M6 21V4"/><path d="M6 4.5h11l-2 4 2 4H6"/>',
  note: '<path d="M5 4.5h14v15H5z"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  subtasks: '<path d="M5 4v10a2 2 0 0 0 2 2h4"/><rect x="13" y="13" width="7" height="6" rx="1.5"/><path d="M5 8h6"/><rect x="13" y="5" width="7" height="6" rx="1.5"/>',
  'cloud': '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5z"/><path d="M9.5 13.8l2 2 3.5-3.6"/>',
  'cloud-up': '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5z"/><path d="M12 16.5v-5M9.8 13.6 12 11.4l2.2 2.2"/>',
  'cloud-off': '<path d="M6.4 9.5A4.5 4.5 0 0 0 7 18.5h10M9.4 5.6A6 6 0 0 1 17.9 11a3.8 3.8 0 0 1 2.2 5.9"/><path d="M4 4l16 16"/>',
});
