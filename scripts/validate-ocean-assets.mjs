/**
 * Validate versioned environment textures (HDR, local maps) under
 * public/assets/environment/v1/. Missing pack fails closed. Never fetch HDR/CDN.
 *
 * Usage: node scripts/validate-ocean-assets.mjs
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const packDir = resolve(root, 'public/assets/environment/v1');
const allowedExt = new Set(['.hdr', '.exr', '.png', '.jpg', '.jpeg', '.webp', '.ktx2', '.json']);
const REQUIRED_HDR = 'kloofendal_48d_partly_cloudy_puresky_1k.hdr';

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function noPack(reason) {
  console.log(JSON.stringify({ ok: false, pack: 'none', errors: [reason] }, null, 2));
  process.exit(1);
}

if (!existsSync(packDir)) {
  noPack('no environment pack');
}

const names = readdirSync(packDir).filter((name) => !name.startsWith('.'));
if (names.length === 0) {
  noPack('no environment pack');
}

const errors = [];
const warnings = [];
const report = [];
const ledgerPath = resolve(packDir, 'manifest.json');
const files = names.filter((name) => name !== 'manifest.json');

if (files.length === 0) {
  noPack('no environment pack');
}

if (!existsSync(ledgerPath)) {
  console.log(
    JSON.stringify(
      { ok: false, pack: 'environment/v1', errors: ['manifest.json missing'], warnings, report },
      null,
      2,
    ),
  );
  process.exit(1);
}

const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

if (!ledger.files || Object.keys(ledger.files).length === 0) {
  console.log(
    JSON.stringify(
      { ok: false, pack: 'environment/v1', errors: ['manifest files empty'], warnings, report },
      null,
      2,
    ),
  );
  process.exit(1);
}

if (!existsSync(resolve(packDir, REQUIRED_HDR))) {
  errors.push(`${REQUIRED_HDR}: required HDR missing`);
}

for (const name of files) {
  const ext = extname(name).toLowerCase();
  const abs = resolve(packDir, name);
  if (!statSync(abs).isFile()) continue;
  if (!allowedExt.has(ext)) {
    errors.push(`${name}: unsupported environment asset type`);
    continue;
  }
  const bytes = statSync(abs).size;
  const hash = sha256(abs);
  const entry = ledger?.files?.[name] ?? ledger?.assets?.find?.((item) => item.file === name);
  if (!entry) errors.push(`${name}: missing license/hash entry in environment/v1/manifest.json`);
  else {
    if (entry.sha256 && entry.sha256 !== hash) {
      errors.push(`${name}: hash mismatch`);
    }
    if (!entry.license) errors.push(`${name}: missing license`);
  }
  report.push({ file: name, bytes, sha256: hash, license: entry?.license ?? null });
}

for (const named of Object.keys(ledger.files)) {
  if (!existsSync(resolve(packDir, named))) {
    errors.push(`${named}: listed in manifest but missing on disk`);
  }
}

console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      pack: 'environment/v1',
      report,
      warnings,
      errors,
    },
    null,
    2,
  ),
);
if (errors.length) process.exit(1);
