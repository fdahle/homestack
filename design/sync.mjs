#!/usr/bin/env node
// Copies the design kit into the apps that use it, so each app still builds on its own
// (its Docker build only sees its own folder) while the look and the shared code stay one.
//
//   node design/sync.mjs           copy the kit into every app below
//   node design/sync.mjs --check   only report apps whose copy differs (exit code 1)
//   node design/sync.mjs checkpoint   only these apps
//
// design/web     → <app>/web/src/kit
// design/server  → <app>/server/kit
// design/scripts → <app>/scripts/kit
//
// The copies are committed. Change the kit here, run this, commit both.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPS = ['checkpoint', 'flimmer', 'regal'];
const PARTS = [
  ['web', 'web/src/kit'],
  ['server', 'server/kit'],
  ['scripts', 'scripts/kit'],
];

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
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
  const note = `Copied from design/${source.replaceAll('\\', '/')} by design/sync.mjs. Change it there, not here.`;
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
for (const app of only.length ? APPS.filter((a) => only.includes(a)) : APPS) {
  if (!existsSync(join(root, app))) {
    console.log(`${app}: not there, skipped`);
    continue;
  }
  for (const [from, to] of PARTS) {
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
  console.log(`\n${differences} difference(s). Run: node design/sync.mjs`);
  process.exit(1);
}
if (!differences) console.log('All apps match the kit.');
