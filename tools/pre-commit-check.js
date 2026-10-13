#!/usr/bin/env node
// Repository guard, designed to run as a git pre-commit hook.
//
//   node tools/pre-commit-check.js --install   install the hook into .git/hooks
//   node tools/pre-commit-check.js             run the checks (the hook does this)
//   node tools/pre-commit-check.js --all       check every tracked file
//
// It blocks a commit when it finds:
//   * something that looks like an API key or token in a checked file
//   * non-ASCII bytes inside a .cmd / .bat / .ps1 file (Windows codepage corruption)
//   * a markdown link in SKILL.md pointing at a path that does not exist
//   * invalid SKILL.md frontmatter (name, description, leftover TODO placeholders)
//
// Deliberately fail-open: if Node cannot be found the installed hook prints a
// loud warning and lets the commit through. A guard that can lock you out of
// your own repository is worse than no guard.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SKILL_FILE = 'SKILL.md';
const ASCII_ONLY_EXTENSIONS = new Set(['.cmd', '.bat', '.ps1']);

const SECRET_PATTERNS = [
  ['GitHub OAuth/app token', /\b(?:gho|ghp|ghs|ghu)_[A-Za-z0-9]{20,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Zhipu API key', /\b[0-9a-f]{32}\.[A-Za-z0-9_-]{8,}\b/],
  ['CCR client key', /\bccr-profile--[A-Za-z0-9_-]{8,}/],
  [
    'inline secret assignment',
    /(?:api[-_]?key|auth[-_]?token|access[-_]?token|password)\s*[:=]\s*["'][A-Za-z0-9._-]{24,}["']/i,
  ],
];

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function fail(message) {
  console.error('pre-commit check: ' + message);
  process.exit(1);
}

function install() {
  const hookPath = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  const wrapper = [
    '#!/bin/sh',
    '# Installed by "node tools/pre-commit-check.js --install".',
    'exec node "$(git rev-parse --show-toplevel)/tools/pre-commit-check.js"',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, wrapper);
  try {
    fs.chmodSync(hookPath, 0o755);
  } catch {
    // Windows does not need the executable bit; git runs hooks through sh.
  }
  console.log('installed: ' + path.relative(ROOT, hookPath).replace(/\\/g, '/'));
  console.log('the guard now runs on every "git commit" in this clone.');
}

function stagedFiles() {
  const output = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function trackedFiles() {
  const output = git(['ls-files']);
  return output ? output.split(/\r?\n/).filter(Boolean) : [];
}

function checkSecrets(relativePath, text, problems) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(lines[i])) {
        problems.push(`${relativePath}:${i + 1}  looks like a ${label} - never commit a real key`);
      }
    }
  }
}

function checkAsciiOnly(relativePath, buffer, problems) {
  const index = buffer.findIndex((byte) => byte > 0x7f);
  if (index === -1) return;
  const line = buffer.subarray(0, index).toString('latin1').split('\n').length;
  problems.push(
    `${relativePath}:${line}  non-ASCII byte in a script file; ` +
      'Windows cmd reads these in the OEM codepage and can mangle the file',
  );
}

function checkSkillLinks(text, problems) {
  const linkPattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match;
  while ((match = linkPattern.exec(text)) !== null) {
    let target = match[1];
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#')[0].replace(/^<|>$/g, '').trim();
    if (!target) continue;
    if (!fs.existsSync(path.join(ROOT, target))) {
      problems.push(`${SKILL_FILE}  link points at a missing path: ${target}`);
    }
  }
}

function checkFrontmatter(text, problems) {
  if (!text.startsWith('---')) {
    problems.push(`${SKILL_FILE}  missing YAML frontmatter`);
    return;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) {
    problems.push(`${SKILL_FILE}  frontmatter is not closed with ---`);
    return;
  }
  const frontmatter = match[1];
  const read = (key) => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(frontmatter);
    return found ? found[1].trim() : '';
  };

  const name = read('name');
  const description = read('description');
  const folder = path.basename(ROOT);

  if (!name) problems.push(`${SKILL_FILE}  frontmatter has no name`);
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    problems.push(`${SKILL_FILE}  name must be hyphen-case: "${name}"`);
  } else if (name !== folder) {
    problems.push(`${SKILL_FILE}  name "${name}" does not match the folder name "${folder}"`);
  }

  if (!description) problems.push(`${SKILL_FILE}  frontmatter has no description`);
  else {
    if (description.length > 1024) {
      problems.push(`${SKILL_FILE}  description is ${description.length} characters; keep it under 1024`);
    }
    if (/[<>]/.test(description)) {
      problems.push(`${SKILL_FILE}  description must not contain angle brackets`);
    }
  }

  const body = text.slice(match[0].length);
  if (/^[ \t]*\[TODO:/m.test(body)) {
    problems.push(`${SKILL_FILE}  body still contains a [TODO: ...] placeholder`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--install')) {
    install();
    return;
  }

  const requestedAll = args.includes('--all');
  let scope = requestedAll ? 'all tracked' : 'staged';
  let files = requestedAll ? trackedFiles() : stagedFiles();
  if (!requestedAll && files.length === 0) {
    files = trackedFiles();
    scope = 'all tracked';
  }

  const problems = [];
  for (const relativePath of files) {
    const absolute = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue; // binary
    const text = buffer.toString('utf8');

    checkSecrets(relativePath, text, problems);
    if (ASCII_ONLY_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      checkAsciiOnly(relativePath, buffer, problems);
    }
    if (path.basename(relativePath) === SKILL_FILE) {
      checkFrontmatter(text, problems);
      checkSkillLinks(text, problems);
    }
  }

  if (problems.length > 0) {
    console.error(`\npre-commit check FAILED (${scope} files)\n`);
    for (const problem of problems) console.error('  BLOCKED  ' + problem);
    console.error(`\n${problems.length} problem(s). Commit aborted.`);
    console.error('Fix them, or bypass once with: git commit --no-verify\n');
    process.exit(1);
  }

  console.log(`pre-commit check: OK (${scope}: ${files.length} file${files.length === 1 ? '' : 's'})`);
}

try {
  main();
} catch (error) {
  if (error && error.code === 'ENOENT') {
    console.warn('\npre-commit check: SKIPPED - Node or git was not found on PATH.');
    console.warn('Install the guard was supposed to warn about: API keys, non-ASCII');
    console.warn('scripts, broken SKILL.md links, invalid frontmatter.\n');
    process.exit(0);
  }
  fail(error && error.message ? error.message : String(error));
}
