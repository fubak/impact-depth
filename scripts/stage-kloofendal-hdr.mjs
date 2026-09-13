#!/usr/bin/env node
/**
 * One-shot local stage of Poly Haven Kloofendal 1k HDR (CC0).
 * Never imported by the game. Never called from app.ts.
 *
 *   HDR_SOURCE=./kloofendal.hdr npm run assets:stage:kloofendal
 *   ALLOW_HDR_STAGE=1 npm run assets:stage:kloofendal
 *
 * PowerShell:
 *   $env:ALLOW_HDR_STAGE='1'; npm run assets:stage:kloofendal
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HDR_URL =
  'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloofendal_48d_partly_cloudy_puresky_1k.hdr';
const FILE = 'kloofendal_48d_partly_cloudy_puresky_1k.hdr';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packDir = resolve(root, 'public/assets/environment/v1');

const sourcePath = process.env.HDR_SOURCE;
const allowFetch = process.env.ALLOW_HDR_STAGE === '1';

if (!sourcePath && !allowFetch) {
  console.error('Set HDR_SOURCE to a local .hdr or ALLOW_HDR_STAGE=1 to fetch once.');
  process.exit(1);
}

mkdirSync(packDir, { recursive: true });
const dest = resolve(packDir, FILE);

let bytes;
if (sourcePath) {
  const abs = resolve(sourcePath);
  if (!existsSync(abs)) {
    console.error(`HDR_SOURCE not found: ${abs}`);
    process.exit(1);
  }
  bytes = readFileSync(abs);
} else {
  const res = await fetch(HDR_URL);
  if (!res.ok) {
    console.error(`fetch failed ${res.status} ${HDR_URL}`);
    process.exit(1);
  }
  bytes = Buffer.from(await res.arrayBuffer());
}

if (bytes.length < 10_000) {
  console.error(`HDR too small (${bytes.length} bytes) — refusing to write`);
  process.exit(1);
}

writeFileSync(dest, bytes);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const manifest = {
  files: {
    [FILE]: {
      license: 'CC0-1.0',
      sha256,
      provenance: 'https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky',
      source: HDR_URL,
    },
  },
};
writeFileSync(resolve(packDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, file: FILE, bytes: bytes.length, sha256 }, null, 2));
