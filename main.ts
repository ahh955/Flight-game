// Langit Biru: Island Run — make.fun entrypoint.
//
// Copies game/ and screenshots/ from this repository into /output and
// writes dossier.json there, built by the official make.fun vendor
// library from what was just copied. The grader runs this file with
// the repository read-only and only /output writable, so /output is
// an absolute path and the sources resolve from this script's own
// directory, never from the working directory.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const outDir = '/output';
const rootDir = dirname(fileURLToPath(import.meta.url));

mkdirSync(outDir, { recursive: true });
cpSync(join(rootDir, 'game'), join(outDir, 'game'), { recursive: true });
cpSync(join(rootDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });

// The dossier is built from /output AFTER the copy, so the file the
// scorer grades is byte-identical to what this program writes.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`wrote dossier.json (${dossier.length} bytes) to ${outDir}`);
