#!/usr/bin/env node
// Configure the CCR (claude-code-router) config database for a GLM upstream.
//
// ASCII only on purpose: Windows cmd reads .cmd/.ps1 in the OEM codepage, and
// non-ASCII content in scripts is a known way to corrupt them.
//
// What it does:
//   - locates the CCR config database
//   - refuses to run while CCR is still listening (the DB must not be edited live)
//   - backs the database up next to itself
//   - replaces the provider's model list, the Claude Code profile model mapping
//     and the gateway fallback chain (used for image requests)
//
// Usage:
//   node ccr-configure.js --api-key KEY [options]
//   node ccr-configure.js --api-key KEY --db <copy.sqlite>   # test on a copy
//
// Run with --help for the full option list.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const DEFAULTS = {
  providerId: 'zhipu-cn',
  providerName: 'GLM (Zhipu)',
  providerType: 'openai_chat_completions',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  main: '',
  small: '',
  vision: '',
  models: '',
  gatewayPort: 3456,
  managementPort: 3458,
  db: '',
  apiKey: '',
  dryRun: false,
  allowRunning: false,
  help: false,
};

function usage() {
  console.log(
    [
      'Configure CCR for a GLM upstream (ASCII only output).',
      '',
      'Required:',
      '  --api-key KEY            upstream GLM API key (stored locally only)',
      '  --main MODEL             model for default/opus/sonnet slots',
      '',
      'Common:',
      '  --small MODEL            model for haiku / small-fast slots',
      '  --vision M1,M2           models to fall back to when the upstream',
      '                           rejects the request (e.g. image content)',
      '  --models M1,M2           full provider model list shown to clients;',
      '                           defaults to main+small+vision',
      '  --base-url URL           upstream base url (default Zhipu general API)',
      '  --provider-id ID         provider id (default zhipu-cn)',
      '  --provider-name NAME     provider display name',
      '  --provider-type TYPE     default openai_chat_completions',
      '',
      'Safety / testing:',
      '  --db PATH                operate on this database instead of the live one',
      '  --dry-run                print the planned change, write nothing',
      '  --allow-running          skip the "CCR is still running" guard',
      '  --help                   this text',
      '',
      'Run this while CCR is stopped:  ccr stop',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error('unexpected argument: ' + token);
    const eq = token.indexOf('=');
    const name = eq === -1 ? token.slice(2) : token.slice(2, eq);
    const value = () => {
      if (eq !== -1) return token.slice(eq + 1);
      const next = argv[i + 1];
      if (next === undefined) throw new Error('--' + name + ' needs a value');
      i += 1;
      return next;
    };

    if (name === 'help') opts.help = true;
    else if (name === 'dry-run') opts.dryRun = true;
    else if (name === 'allow-running') opts.allowRunning = true;
    else if (name === 'api-key') opts.apiKey = value();
    else if (name === 'main') opts.main = value();
    else if (name === 'small') opts.small = value();
    else if (name === 'vision') opts.vision = value();
    else if (name === 'models') opts.models = value();
    else if (name === 'base-url') opts.baseUrl = value();
    else if (name === 'provider-id') opts.providerId = value();
    else if (name === 'provider-name') opts.providerName = value();
    else if (name === 'provider-type') opts.providerType = value();
    else if (name === 'db') opts.db = value();
    else if (name === 'gateway-port') opts.gatewayPort = Number(value());
    else throw new Error('unknown option: --' + name);
  }
  return opts;
}

function splitList(text) {
  return String(text || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(items) {
  return [...new Set(items)];
}

function defaultDbPath() {
  const name = path.join('claude-code-router', 'config.sqlite');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, name);
  }
  return path.join(os.homedir(), '.' + name);
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function loadSqlite() {
  try {
    return require('node:sqlite').DatabaseSync;
  } catch (error) {
    throw new Error(
      'node:sqlite is unavailable in this Node build (' +
        error.message +
        '). Re-run with: node --experimental-sqlite ' +
        path.basename(__filename),
    );
  }
}

function backupDatabase(dbPath) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..+$/, '');
  const saved = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const source = dbPath + suffix;
    if (!fs.existsSync(source)) continue;
    const target = dbPath + '.bak_' + stamp + suffix;
    fs.copyFileSync(source, target);
    saved.push(target);
  }
  return saved;
}

function maskKey(key) {
  if (!key) return '(unchanged)';
  return key.length <= 10 ? '***' : key.slice(0, 6) + '...(' + key.length + ')';
}

function applyProfile(profile, main, small) {
  const before = profile.model;
  profile.model = main;
  profile.opusModel = main;
  profile.sonnetModel = main;
  if ('fableModel' in profile) profile.fableModel = main;
  if (small) {
    profile.haikuModel = small;
    profile.smallFastModel = small;
  }
  delete profile.__before;
  return before;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (!opts.apiKey && !opts.dryRun) throw new Error('--api-key is required');
  if (!opts.main) throw new Error('--main is required');

  const testDb = Boolean(opts.db);
  const dbPath = testDb ? path.resolve(opts.db) : defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      'CCR config database not found: ' +
        dbPath +
        '\nRun "ccr start --daemon --no-open --gateway" once, then "ccr stop", then retry.',
    );
  }

  if (!testDb && !opts.allowRunning) {
    for (const port of [opts.gatewayPort, opts.managementPort]) {
      if (await portIsOpen(port)) {
        throw new Error(
          'CCR is still listening on port ' +
            port +
            '. Run "ccr stop" first (the config database must not be edited while CCR is running).',
        );
      }
    }
  }

  const vision = splitList(opts.vision);
  const models = unique([
    ...splitList(opts.models),
    opts.main,
    ...(opts.small ? [opts.small] : []),
    ...vision,
  ]);

  const DatabaseSync = loadSqlite();
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('select value_json from app_config where key = ?').get('default');
  if (!row) throw new Error('app_config row "default" is missing in ' + dbPath);
  const config = JSON.parse(row.value_json);

  config.Providers = config.Providers || [];
  let provider = config.Providers.find((item) => item.id === opts.providerId);
  const providerWasNew = !provider;
  if (!provider) {
    provider = { id: opts.providerId };
    config.Providers.push(provider);
  }
  const previousModels = Array.isArray(provider.models) ? provider.models.slice() : [];
  provider.name = opts.providerName;
  provider.api_base_url = opts.baseUrl;
  provider.type = opts.providerType;
  if (opts.apiKey) provider.api_key = opts.apiKey;
  provider.models = models;

  config.profile = config.profile || {};
  const claudeCode = config.profile.claudeCode;
  if (!claudeCode) throw new Error('config.profile.claudeCode is missing; finish the CCR onboarding first');
  const mainBefore = applyProfile(claudeCode, opts.main, opts.small);
  let profileTouched = 0;
  for (const profile of config.profile.profiles || []) {
    if (profile.agent === 'claude-code' && profile.enabled !== false) {
      applyProfile(profile, opts.main, opts.small);
      profileTouched += 1;
    }
  }

  config.Router = config.Router || {};
  config.Router.fallback = vision.length
    ? {
        mode: 'model-chain',
        models: vision.map((model) => opts.providerId + ',' + model),
        retryCount: 1,
      }
    : { mode: 'off', models: [], retryCount: 1 };

  console.log('database        : ' + dbPath);
  console.log('provider        : ' + opts.providerId + (providerWasNew ? ' (created)' : '') + '  ' + opts.providerName);
  console.log('upstream        : ' + opts.baseUrl + '  [' + opts.providerType + ']');
  console.log('api key         : ' + maskKey(opts.apiKey));
  console.log('models before   : ' + JSON.stringify(previousModels));
  console.log('models after    : ' + JSON.stringify(models));
  console.log('profile mapping : default/opus/sonnet/fable -> ' + opts.main + ', haiku/small -> ' + (opts.small || '(unchanged)') + '  (was ' + mainBefore + ')');
  console.log('claude-code profiles updated: ' + profileTouched);
  console.log('fallback chain  : ' + JSON.stringify(config.Router.fallback.models));

  if (opts.dryRun) {
    console.log('\ndry run: nothing written');
    db.close();
    return;
  }

  const backups = testDb ? [] : backupDatabase(dbPath);
  db.prepare('update app_config set value_json = ?, updated_at = ? where key = ?').run(
    JSON.stringify(config),
    new Date().toISOString(),
    'default',
  );
  db.close();

  console.log('\nbackups         : ' + (backups.length ? backups.join(', ') : '(test database, skipped)'));
  console.log('done. next      : ccr start --daemon --no-open --gateway');
  console.log('verify with     : claude -p "reply with exactly: OK"');
}

main().catch((error) => {
  console.error('\nERROR: ' + error.message);
  process.exit(1);
});
