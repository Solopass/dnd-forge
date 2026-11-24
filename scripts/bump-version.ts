import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tier = (process.argv[2] ?? 'small').toLowerCase();
const versionPath = resolve(import.meta.dir, '../src/version.ts');
const raw = readFileSync(versionPath, 'utf8');
const match = raw.match(/APP_VERSION\s*=\s*'v(\d+)\.(\d{2})'/);

if (!match?.[1] || !match[2]) {
  throw new Error(`Could not parse APP_VERSION in ${versionPath}`);
}

const currentHundredths = Number.parseInt(match[1], 10) * 100 + Number.parseInt(match[2], 10);
let nextHundredths = currentHundredths + 1;

if (tier === 'major') {
  nextHundredths = (Math.floor(currentHundredths / 100) + 1) * 100;
} else if (tier === 'medium' || tier === 'feature') {
  nextHundredths = currentHundredths + 10;
}

const major = Math.floor(nextHundredths / 100);
const minor = String(nextHundredths % 100).padStart(2, '0');
const nextVersion = `v${major}.${minor}`;

writeFileSync(versionPath, `export const APP_VERSION = '${nextVersion}';\n`, 'utf8');
console.log(`Bumped APP_VERSION (${tier}): v${match[1]}.${match[2]} -> ${nextVersion}`);
