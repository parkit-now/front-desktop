#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = process.env.OPENAPI_URL ?? 'http://localhost:3000/api-json';
const output = process.env.OPENAPI_TYPES_OUT ?? 'src/generated/api-types.ts';

await mkdir(dirname(output), { recursive: true });

const bunx = process.platform === 'win32' ? 'bunx.cmd' : 'bunx';
const args = ['openapi-typescript', source, '-o', output, '--alphabetize'];

console.log(`→ openapi-typescript (generate) from: ${source}`);

const result = spawnSync(bunx, args, {
  stdio: 'inherit',
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`✓ Tipos generados en ${output}`);
