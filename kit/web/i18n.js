import { ref } from 'vue';

// UI language (set in the settings). t('a.b', { n: 3 }) fills {n}.
// The kit brings the texts its own components use; the app adds its own with addMessages().
export const lang = ref('de');

const DICTS = {
  de: {
    back: 'Zurück',
    close: 'Schließen',
    save: 'Speichern',
    saved: 'Gespeichert',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    more: 'Mehr',
    less: 'Weniger',
    nav: { label: 'Navigation', settings: 'Einstellungen' },
    login: { username: 'Benutzername', password: 'Passwort', submit: 'Anmelden', wrong: 'Benutzername oder Passwort falsch' },
    date: { day: 'Tag', month: 'Monat', year: 'Jahr', yearOptional: 'Jahr (optional)' },
    rating: { label: 'Bewertung', value: '{n} von 5 Sternen', none: 'Nicht bewertet' },
    account: {
      profile: 'Profil',
      name: 'Name',
      language: 'Sprache',
      theme: 'Darstellung',
      themes: { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' },
      password: 'Passwort',
      currentPassword: 'Aktuelles Passwort',
      newPassword: 'Neues Passwort (mind. 8 Zeichen)',
      changePassword: 'Passwort ändern',
      passwordChanged: 'Passwort geändert. Andere Geräte sind abgemeldet.',
      viaProxy: 'Du bist über die Anmeldung des Servers angemeldet.',
      logout: 'Abmelden',
    },
    shortcuts: { search: 'Suchen', close: 'Schließen' },
    errors: {
      generic: 'Das hat nicht geklappt. Bitte noch einmal versuchen.',
      not_found: 'Nicht gefunden.',
      wrong_password: 'Das aktuelle Passwort stimmt nicht.',
      password_too_short: 'Das Passwort braucht mindestens 8 Zeichen.',
      too_many_attempts: 'Zu viele Versuche. Bitte später noch einmal.',
      bad_date: 'Das Datum stimmt nicht.',
      bad_image: 'Das Bild ließ sich nicht lesen.',
      too_large: 'Das ist zu groß.',
      login_via_proxy: 'Die Anmeldung läuft über die Anmeldeseite des Servers. Lade die Seite neu.',
    },
  },
  en: {
    back: 'Back',
    close: 'Close',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    delete: 'Delete',
    more: 'More',
    less: 'Less',
    nav: { label: 'Navigation', settings: 'Settings' },
    login: { username: 'Username', password: 'Password', submit: 'Log in', wrong: 'Wrong username or password' },
    date: { day: 'Day', month: 'Month', year: 'Year', yearOptional: 'Year (optional)' },
    rating: { label: 'Rating', value: '{n} out of 5 stars', none: 'Not rated' },
    account: {
      profile: 'Profile',
      name: 'Name',
      language: 'Language',
      theme: 'Appearance',
      themes: { auto: 'Automatic', light: 'Light', dark: 'Dark' },
      password: 'Password',
      currentPassword: 'Current password',
      newPassword: 'New password (at least 8 characters)',
      changePassword: 'Change password',
      passwordChanged: 'Password changed. Other devices are logged out.',
      viaProxy: "You're logged in through the server's login.",
      logout: 'Log out',
    },
    shortcuts: { search: 'Search', close: 'Close' },
    errors: {
      generic: "That didn't work. Please try again.",
      not_found: 'Not found.',
      wrong_password: "The current password isn't right.",
      password_too_short: 'The password needs at least 8 characters.',
      too_many_attempts: 'Too many attempts. Please try again later.',
      bad_date: "That date doesn't work.",
      bad_image: "The picture couldn't be read.",
      too_large: "That's too large.",
      login_via_proxy: "Logging in goes through the server's login page. Reload this page.",
    },
  },
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(into, from) {
  for (const [k, v] of Object.entries(from)) {
    if (isObject(v) && isObject(into[k])) merge(into[k], v);
    else into[k] = v;
  }
}

// { de: {…}, en: {…} } — the app's texts; they win over the kit's
export function addMessages(dicts) {
  for (const [code, dict] of Object.entries(dicts)) merge((DICTS[code] ??= {}), dict);
}

const lookup = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);

export function t(key, vars) {
  const value = lookup(DICTS[lang.value], key) ?? lookup(DICTS.de, key);
  if (typeof value !== 'string') return key;
  return vars ? value.replace(/\{(\w+)\}/g, (m, name) => (vars[name] ?? m)) : value;
}

export const hasText = (key) => typeof (lookup(DICTS[lang.value], key) ?? lookup(DICTS.de, key)) === 'string';
