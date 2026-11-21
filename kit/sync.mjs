#!/usr/bin/env node
// Copies the design kit into the apps that use it, so each app still builds on its own
// (its Docker build only sees its own folder) while the look and the shared code stay one.
//
//   node kit/sync.mjs           copy the kit into every app below
//   node kit/sync.mjs --check   only report apps whose copy differs (exit code 1)
//   node kit/sync.mjs checkpoint   only these apps
//
// kit/web     → apps/<app>/web/src/kit   (Fernweh: client/src/kit)
// kit/server  → apps/<app>/server/kit    (Fernweh: api/kit)
// kit/scripts → apps/<app>/scripts/kit
//
// The copies are committed. Change the kit here, run this, commit both.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Where each part of the kit goes; Fernweh keeps its own layout (client/, api/)
const LAYOUT = { web: 'web/src/kit', server: 'server/kit', scripts: 'scripts/kit' };
const APPS = {
  checkpoint: LAYOUT,
  watchlist: LAYOUT,
  regal: LAYOUT,
  leute: LAYOUT,
  notizbuch: LAYOUT,
  todo: LAYOUT,
  stapel: LAYOUT,
  fernweh: { web: 'client/src/kit', server: 'api/kit', scripts: 'scripts/kit' },
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(dirname(here), 'apps');
const check = process.argv.includes('--check');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    return e.isDirectory() ? files(path) : [path];
  });
}

function withHeader(source, text) {
  const note = `Copied from kit/${source.replaceAll('\\', '/')} by kit/sync.mjs. Change it there, not here.`;
  const ext = extname(source);
  if (ext === '.vue') return `<!-- ${note} -->\n${text}`;
  if (ext === '.css') return `/* ${note} */\n${text}`;
  if (text.startsWith('#!')) {
    const nl = text.indexOf('\n') + 1;
    return `${text.slice(0, nl)}// ${note}\n${text.slice(nl)}`;
  }
  return `// ${note}\n${text}`;
}

let differences = 0;
for (const app of Object.keys(APPS).filter((a) => !only.length || only.includes(a))) {
  if (!existsSync(join(root, app))) {
    console.log(`${app}: not there, skipped`);
    continue;
  }
  for (const [from, to] of Object.entries(APPS[app])) {
    const srcDir = join(here, from);
    const destDir = join(root, app, to);
    const wanted = new Map();
    for (const file of files(srcDir)) {
      const rel = relative(srcDir, file);
      wanted.set(rel, withHeader(join(from, rel), readFileSync(file, 'utf8')));
    }
    for (const [rel, text] of wanted) {
      const dest = join(destDir, rel);
      const current = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
      if (current === text) continue;
      differences++;
      if (check) {
        console.log(`${app}: ${join(to, rel)} ${current === null ? 'is missing' : 'differs from the kit'}`);
      } else {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, text);
        console.log(`${app}: ${join(to, rel)} updated`);
      }
    }
    // Files the kit no longer has
    for (const file of files(destDir)) {
      const rel = relative(destDir, file);
      if (wanted.has(rel)) continue;
      differences++;
      if (check) console.log(`${app}: ${join(to, rel)} is not in the kit (any more)`);
      else {
        rmSync(file);
        console.log(`${app}: ${join(to, rel)} removed`);
      }
    }
  }
}

if (check && differences) {
  console.log(`\n${differences} difference(s). Run: node kit/sync.mjs`);
  process.exit(1);
}
if (!differences) console.log('All apps match the kit.');
