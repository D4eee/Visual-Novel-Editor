#!/usr/bin/env node
/**
 * Generates docs/api/README.md from sdk/types/index.d.ts, the single source of
 * truth for the module API. Run after changing the typings: npm run docs:api
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(path.join(root, 'sdk/types/index.d.ts'), 'utf8');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const apiVersion = (readFileSync(path.join(root, 'packages/core/src/defaults.ts'), 'utf8').match(/API_VERSION = '([^']+)'/) || [])[1] || '?';

// Split on banner comments:  /* ---- */ /* Title */ /* ---- */
const parts = src.split(/\/\* -{10,} \*\/\n\/\* (.+?)\s*\*\/\n\/\* -{10,} \*\/\n/);
const intro = parts[0];
const sections = [];
for (let i = 1; i < parts.length; i += 2) sections.push({ title: parts[i].trim(), body: parts[i + 1].trim() });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const names = (body) => [...body.matchAll(/^export (?:interface|type|declare const|declare function) (\w+)/gm)].map((m) => m[1]);

let out = `# API reference

Module API version **${apiVersion}** · engine ${pkg.version}. Generated from [\`sdk/types/index.d.ts\`](../../sdk/types/index.d.ts) by \`npm run docs:api\` — the typings are the source of truth; use them for autocompletion with \`// @ts-check\`.

Guides: [runtime extensions](../modding/runtime.md) · [editor extensions](../modding/editor.md) · [manifest](../modding/manifest.md).

## Contents

${sections.map((s) => `- [${s.title}](#${slug(s.title)}) — ${names(s.body).map((n) => `\`${n}\``).join(', ')}`).join('\n')}

## Overview

${intro.replace(/^\/\*\*\n?|\*\/\s*$/g, '').split('\n').map((l) => l.replace(/^\s*\* ?/, '')).join('\n').trim()}
`;
for (const s of sections) out += `\n## ${s.title}\n\n\`\`\`ts\n${s.body}\n\`\`\`\n`;
mkdirSync(path.join(root, 'docs/api'), { recursive: true });
writeFileSync(path.join(root, 'docs/api/README.md'), out);
console.log(`docs/api/README.md: ${sections.length + 1} sections`);
