/**
 * Validate versioned environment textures (HDR, local maps) under
 * public/assets/environment/v1/. Missing pack is a pass: production stays
 * self-only until a local CC0 file is staged. Never fetch HDR/CDN.
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

function sha256(abs) {
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

function noPack(reason) {
  console.log(JSON.stringify({ ok: true, pack: 'none', message: reason }, null, 2));
  process.exit(0);
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
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null;
const files = names.filter((name) => name !== 'manifest.json');

if (files.length === 0 && !ledger) {
  noPack('no environment pack');
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
  if (ledger) {
    if (!entry) errors.push(`${name}: missing license/hash entry in environment/v1/manifest.json`);
    else {
      if (entry.sha256 && entry.sha256 !== hash) {
        errors.push(`${name}: hash mismatch`);
      }
      if (!entry.license) errors.push(`${name}: missing license`);
    }
  } else {
    warnings.push(`${name}: present without environment/v1/manifest.json (hash recorded only)`);
  }
  report.push({ file: name, bytes, sha256: hash, license: entry?.license ?? null });
}

if (ledger?.files) {
  for (const named of Object.keys(ledger.files)) {
    if (!existsSync(resolve(packDir, named))) {
      errors.push(`${named}: listed in manifest but missing on disk`);
    }
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
