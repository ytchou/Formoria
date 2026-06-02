#!/usr/bin/env node
// CI/pre-commit guard: src/app/favicon.ico must be RGBA.
//
// Next.js 16's Turbopack decodes favicon.ico with the Rust `image` crate,
// which requires every embedded entry to carry an alpha channel. A non-RGBA
// favicon (RGB PNG / 24bpp BMP) crashes `next build` with
//   "Format error decoding Ico: The PNG is not in RGBA format!"
// and silently broke every Railway production build (see PR #68). This guard
// parses the ICO directly (no deps) and asserts each entry is RGBA.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FAVICON = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'app',
  'favicon.ico',
);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) {
  console.error(`\n✖ favicon guard: ${message}\n`);
  console.error('  src/app/favicon.ico must be RGBA or `next build` (Turbopack) crashes,');
  console.error('  which breaks every Railway deploy. Regenerate it with an alpha channel:');
  console.error('');
  console.error('    python3 - <<PY');
  console.error('    from PIL import Image');
  console.error("    Image.open('src/app/icon.png').convert('RGBA').save(");
  console.error("        'src/app/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])");
  console.error('    PY');
  console.error('');
  process.exit(1);
}

let buf;
try {
  buf = readFileSync(FAVICON);
} catch {
  fail(`cannot read ${FAVICON}`);
}

// ICO header: reserved(2)=0, type(2)=1 (icon), count(2).
if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) {
  fail('src/app/favicon.ico is not a valid .ico file');
}

const count = buf.readUInt16LE(4);
if (count === 0) {
  fail('src/app/favicon.ico has no icon entries');
}

const problems = [];
for (let i = 0; i < count; i++) {
  const entry = 6 + i * 16;
  const width = buf.readUInt8(entry) || 256;
  const height = buf.readUInt8(entry + 1) || 256;
  const size = buf.readUInt32LE(entry + 8);
  const offset = buf.readUInt32LE(entry + 12);
  const data = buf.subarray(offset, offset + size);

  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // PNG entry. IHDR color-type byte is at offset 25:
    // 8 (sig) + 4 (len) + 4 ("IHDR") + 4 (width) + 4 (height) + 1 (bit depth).
    const colorType = data.readUInt8(25);
    if (colorType !== 6) {
      problems.push(`${width}x${height}: PNG color type ${colorType} (need 6 = RGBA)`);
    }
  } else {
    // BMP/DIB entry. BITMAPINFOHEADER biBitCount (uint16) is at offset 14.
    const bitCount = data.length >= 16 ? data.readUInt16LE(14) : 0;
    if (bitCount !== 32) {
      problems.push(`${width}x${height}: BMP ${bitCount}bpp (need 32 = BGRA with alpha)`);
    }
  }
}

if (problems.length > 0) {
  fail(`non-RGBA entries found:\n    - ${problems.join('\n    - ')}`);
}

console.log(
  `✓ favicon guard: src/app/favicon.ico is RGBA (${count} ${count === 1 ? 'entry' : 'entries'})`,
);
