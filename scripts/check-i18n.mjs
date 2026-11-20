#!/usr/bin/env node
// Reports interface keys that are used in code but missing from a dictionary, and keys that differ between languages.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const load = (f) => { const s = readFileSync(path.join(root, f), 'utf8'); const keys = new Set(); for (const m of s.matchAll(/'([^'\n]+)':\s*'/g)) keys.add(m[1]); return keys; };
const en = load('packages/editor/src/i18n/en.ts');
const zh = load('packages/editor/src/i18n/zh-CN.ts');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) { if (!p.includes('i18n')) walk(p); } else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
['packages/editor/src', 'packages/runtime/src/builtins', 'packages/core/src'].forEach((d) => walk(path.join(root, d)));
const used = new Set();
const re = /(?:\bt\(|label:\s*|description:\s*|message:\s*|reason:\s*|['"]label['"]:\s*)['"]([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_\-]+)+)['"]/g;
for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(re)) used.add(m[1]);
const ignore = /^(core\.|com\.)/;
const missEn = [...used].filter((k) => !en.has(k) && !ignore.test(k));
const missZh = [...used].filter((k) => !zh.has(k) && !ignore.test(k));
const onlyEn = [...en].filter((k) => !zh.has(k));
const onlyZh = [...zh].filter((k) => !en.has(k));
console.log(`used=${used.size} en=${en.size} zh=${zh.size}`);
if (missEn.length) console.log('missing in en:', missEn.join(' '));
if (missZh.length) console.log('missing in zh-CN:', missZh.join(' '));
if (onlyEn.length) console.log('only in en:', onlyEn.join(' '));
if (onlyZh.length) console.log('only in zh-CN:', onlyZh.join(' '));
process.exit(missEn.length || missZh.length || onlyEn.length || onlyZh.length ? 1 : 0);
