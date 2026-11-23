#!/usr/bin/env node
// Try the apps on this computer: builds them and starts them like on the server (with the
// offline service worker and everything), each on its own port.
//
//   node try.mjs                 which apps there are
//   node try.mjs todo            one app
//   node try.mjs todo notizbuch  several
//   node try.mjs all             all of them
//   node try.mjs todo --sample   with sample data instead of yours
//   node try.mjs todo --sample --fresh   the sample data made again from scratch
//
// The first time, an app gets its packages and, if it has no .env yet, a local one with the
// account felix and a password printed below (an existing .env is used as it is). Data goes
// to the app's own data/ folder (ignored by git), so it stays out of your real server data.
//
// --sample uses data-sample/ instead, filled by the app's scripts/sample.js (if it has one yet),
// on the port + 1000 (To-do: 4073). The other port keeps the browser's copy of the sample data,
// its login and its service worker apart from your own local data. Same account as without it.
// Ctrl+C stops everything.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const NODE = [process.execPath, '--disable-warning=ExperimentalWarning'];

// How each app is installed, built and started. Most follow the design kit's layout; the rest
// are listed with their differences. For --sample: dataEnv points the app at its data folder
// (DATA_DIR unless it says otherwise), sampleEnv keeps it off the network, sampleLogin is the
// login to print.
const KIT = (port) => ({ port, build: ['run', 'build'], start: ['server/server.js'] });
const APPS = {
  backlog: {
    ...KIT(3066),
    env: { HARVEST_LINKS: '0' },
    // The sample blogs are made up: no rescans and no discovery, or they'd all show "scan failed"
    sampleEnv: { SCAN_INTERVAL_HOURS: 'Infinity', DISCOVER_INTERVAL_DAYS: 'Infinity' },
  },
  checkpoint: KIT(3069),
  fernweh: {
    port: 3063,
    install: ['.', 'api', 'client'],
    build: ['run', 'build'],
    start: ['api/index.js'],
    // Fernweh has its own login: the first visitor chooses the password
    env: () => ({ SESSION_SECRET: randomBytes(32).toString('hex') }),
    dataEnv: (data) => ({ MAPPER_DB_PATH: join(data, 'mapper.db') }),
    noAccount: 'choose a password on the first visit',
    sampleLogin: 'password fernweh-sample',
  },
  todo: KIT(3073),
  stammtisch: KIT(3068),
  // The sample's own small Calibre library (never the one in .env: the sample script rewrites it)
  regal: { ...KIT(3072), dataEnv: (data) => ({ DATA_DIR: data, CALIBRE_LIBRARY: join(data, 'calibre') }) },
  stammbaum: {
    port: 3065,
    build: ['run', 'build'],
    start: ['dist-server/main.js'],
    // Without your family file it shows the sample family (a copy, so editing doesn't touch the sample)
    prepare: (dir, data) => {
      if (!existsSync(join(data, 'family.md'))) cpSync(join(dir, 'sample'), data, { recursive: true });
    },
    hasSample: true,
    noAccount: 'no login locally (on the server it sits behind Authelia)',
  },
  notizbuch: KIT(3070),
  stapel: {
    ...KIT(3067),
    // No Comic Vine or GCD for the sample, even for a series added by hand
    sampleEnv: { COMICVINE_API_KEY: '', GCD_EMAIL: '', GCD_PASSWORD: '' },
    sampleLoginExtra: 'also anna / local-anna, tom / local-tom',
  },
  watchlist: KIT(3071),
};

const args = process.argv.slice(2);
const sample = args.includes('--sample');
const fresh = args.includes('--fresh');
const badFlags = args.filter((a) => a.startsWith('-') && !['--sample', '--fresh'].includes(a));
if (badFlags.length || (fresh && !sample)) {
  console.error(badFlags.length ? `Unknown: ${badFlags.join(', ')}` : '--fresh only goes with --sample (it never touches your own data)');
  process.exit(1);
}
const names = args.filter((a) => !a.startsWith('-'));
if (!names.length) {
  console.log('node try.mjs <app> [<app> …] | all  [--sample [--fresh]]\n');
  for (const [name, app] of Object.entries(APPS).sort()) console.log(`  ${name.padEnd(11)} http://localhost:${app.port}`);
  process.exit(0);
}
const chosen = names.includes('all') ? Object.keys(APPS) : names;
const unknown = chosen.filter((n) => !APPS[n]);
if (unknown.length) {
  console.error(`Unknown: ${unknown.join(', ')}. Apps: ${Object.keys(APPS).join(', ')}`);
  process.exit(1);
}

// npm through the shell, so it works on Windows (npm.cmd) and elsewhere
function npm(args, cwd) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} failed in ${cwd}`);
}

function readEnv(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}

const children = [];
const summary = [];

for (const name of chosen) {
  const app = APPS[name];
  const dir = join(root, 'apps', name);
  console.log(`\n=== ${name}`);

  for (const sub of app.install || ['.']) {
    const where = join(dir, sub);
    if (existsSync(join(where, 'package.json')) && !existsSync(join(where, 'node_modules'))) {
      console.log(`installing packages in ${name}/${sub === '.' ? '' : sub}`);
      npm(['install', '--no-audit', '--no-fund'], where);
    }
  }

  // A local .env, unless there is one already
  const envFile = join(dir, '.env');
  let login = app.noAccount;
  if (!existsSync(envFile)) {
    const lines = ['# Made by try.mjs for trying the app on this computer. Not used by the server.'];
    const extra = typeof app.env === 'function' ? app.env() : {};
    if (!app.noAccount) {
      const password = `local-${randomBytes(4).toString('hex')}`;
      lines.push('ADMIN_USER=felix', `ADMIN_PASSWORD=${password}`);
      login = `felix / ${password}`;
    }
    for (const [k, v] of Object.entries(extra)) lines.push(`${k}=${v}`);
    lines.push('DATA_DIR=./data');
    writeFileSync(envFile, `${lines.join('\n')}\n`);
  } else if (!app.noAccount) {
    const env = readEnv(envFile);
    login = env.ADMIN_PASSWORD || env.APP_PASSWORD ? `${env.ADMIN_USER || 'admin'} / the password in ${name}/.env` : `see ${name}/.env`;
  }

  // Your local data, or the sample data on its own port
  const data = join(dir, sample ? 'data-sample' : 'data');
  const port = sample ? app.port + 1000 : app.port;
  if (fresh && existsSync(data)) {
    try {
      rmSync(data, { recursive: true, force: true });
    } catch (err) {
      if (!['EPERM', 'EBUSY'].includes(err.code)) throw err;
      // Windows keeps a folder an app still has open
      console.error(`Can't remove ${name}/data-sample: is the sample of ${name} still running (port ${port})? Stop it first.`);
      process.exit(1);
    }
    console.log(`removed ${name}/data-sample`);
  }
  mkdirSync(data, { recursive: true });
  app.prepare?.(dir, data);
  if (app.build) {
    console.log(`building ${name}`);
    npm(app.build, dir);
  }

  const env = {
    ...process.env,
    DATA_DIR: './data',
    ...(typeof app.env === 'object' ? app.env : {}),
    ...readEnv(envFile),
    ...(sample ? (app.dataEnv || ((d) => ({ DATA_DIR: d })))(data) : {}),
    ...(sample ? app.sampleEnv : {}),
    PORT: String(port),
  };
  delete env.NODE_ENV; // not "production": cookies work over plain http on localhost

  if (sample) {
    if (app.sampleLogin) login = app.sampleLogin;
    if (app.sampleLoginExtra) login += `; ${app.sampleLoginExtra}`;
    const script = join(dir, 'scripts', 'sample.js');
    if (existsSync(script)) {
      const r = spawnSync(NODE[0], [...NODE.slice(1), script], { cwd: dir, env, stdio: 'inherit' });
      if (r.status !== 0) throw new Error(`scripts/sample.js failed in ${name}`);
    } else if (!app.hasSample) {
      console.log(`${name} has no sample data yet (scripts/sample.js): it starts empty`);
    }
  }

  const child = spawn(NODE[0], [...NODE.slice(1), ...app.start], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}] `;
  const relay = (stream, out) => {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('exit', (code) => code && console.log(`${prefix}stopped (${code})`));
  children.push(child);
  summary.push([name, `http://localhost:${port}`, login]);
}

setTimeout(() => {
  console.log(sample ? '\nRunning with sample data (data-sample/):' : '\nRunning:');
  for (const [name, url, login] of summary) console.log(`  ${name.padEnd(11)} ${url.padEnd(24)} ${login}`);
  console.log('\nOffline mode: DevTools → Network → Offline. Ctrl+C stops everything.\n');
}, 1500);

const stop = () => {
  for (const c of children) c.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
