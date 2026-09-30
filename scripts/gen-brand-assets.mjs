/**
 * Emits the static brand assets (public/brand, the favicons, the app icons)
 * from the mark's one definition in `src/utils/brand.ts`, the same data the
 * `Logo` primitive, the PDFs and the Open Graph cards draw from.
 *
 * The paths and colours are read out of that file rather than restated here,
 * so a redrawn mark cannot ship with a stale favicon. Colours are also checked
 * against `src/styles/globals.css`: an exported SVG has no stylesheet to read
 * tokens from, so the hex values must match the tokens exactly.
 *
 * The lockup exports outline "sara" from assets/fonts/BricolageGrotesque-
 * SemiBold.ttf (the nav's weight, opsz 48), so they need no font installed.
 *
 *   yarn brand:generate
 */
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "public", "brand");

/* ── the mark, read from src/utils/brand.ts ─────────────────────────────── */
const brandSource = readFileSync(join(root, "src/utils/brand.ts"), "utf8");
const constant = (name) => {
  const match = brandSource.match(new RegExp(`${name}\\s*=\\s*"([^"]+)"`));
  assert.ok(match, `${name} not found in src/utils/brand.ts`);
  return match[1];
};
const color = (name) => {
  const match = brandSource.match(new RegExp(`${name}:\\s*"(#[0-9a-f]{6})"`));
  assert.ok(match, `BRAND_COLOR.${name} not found in src/utils/brand.ts`);
  return match[1];
};

const BODY = constant("MARK_BODY");
const ACCENT = constant("MARK_ACCENT");
const C = {
  ink: color("ink"),
  canvas: color("canvas"),
  accent: color("accent"),
  onAccent: color("onAccent"),
  faint: "#7f8a84",
};

const tokenSource = readFileSync(join(root, "src/styles/globals.css"), "utf8");
for (const hex of Object.values(C)) {
  assert.ok(
    tokenSource.includes(hex),
    `${hex} is not in globals.css; the brand palette has drifted from the tokens`,
  );
}

/** The mark as SVG markup: the owner's half in `body`, Sara's in `accent`. */
const glyph = ({ body, accent }) =>
  `<g><path d="${BODY}" fill="${body}"/><path d="${ACCENT}" fill="${accent ?? body}"/></g>`;

const svg = (inner, w = 100, h = 100) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Sara">${inner}</svg>\n`;

/** The tile, inset to 70%: ink ground keeps the green, green ground drops it. */
const tile = (ground = "ink") =>
  `<rect width="100" height="100" rx="22" fill="${ground === "ink" ? C.ink : C.accent}"/>` +
  `<g transform="translate(50 50) scale(0.7) translate(-50 -50)">` +
  glyph(
    ground === "ink"
      ? { body: C.canvas, accent: C.accent }
      : { body: C.onAccent },
  ) +
  `</g>`;

/* ── the lockup: mark + outlined "sara", set as the Wordmark primitive sets
   it (display 600, -0.04em tracking, mark 0.95em, gap 0.28em, mark centred on
   the x-height). Units: 1em = 100.                                        */
const font = fontkit.create(
  readFileSync(join(root, "assets/fonts/BricolageGrotesque-SemiBold.ttf")),
);
const EM = 100;
const scale = EM / font.unitsPerEm;
let pen = 0;
const letters = [...font.layout("sara").glyphs].map((g) => {
  const d = g.path.toSVG();
  const x = pen;
  pen += g.advanceWidth * scale - 0.04 * EM;
  return { d, x };
});
const wordWidth = pen + 0.04 * EM;
const baseline = font.ascent * scale; // text box top = 0
const xCentre = baseline - (font.xHeight * scale) / 2;
const markSize = 0.95 * EM;
// Centred on the x-height, which is where the browser's 0.07em nudge lands it.
const markTop = xCentre - markSize / 2;
const gap = 0.28 * EM;
const top = Math.min(markTop, 0);
const bottom = Math.max(markTop + markSize, baseline + -font.descent * scale);
const lockupW = Math.ceil(markSize + gap + wordWidth);
const lockupH = Math.ceil(bottom - top);
const lockup = ({ body, accent, text }) =>
  `<g transform="translate(0 ${-top})">` +
  `<g transform="translate(0 ${markTop}) scale(${markSize / 100})">${glyph({ body, accent })}</g>` +
  `<g fill="${text}" transform="translate(${markSize + gap} ${baseline})">` +
  letters
    .map(
      ({ d, x }) =>
        `<path transform="translate(${x.toFixed(2)} 0) scale(${scale} ${-scale})" d="${d}"/>`,
    )
    .join("") +
  `</g></g>`;

/* ── write ───────────────────────────────────────────────────────────────── */
mkdirSync(brandDir, { recursive: true });
const written = [];
const write = (path, contents) => {
  writeFileSync(join(root, "public", path), contents);
  written.push(path);
};

write("brand/sara-mark-ink.svg", svg(glyph({ body: C.ink, accent: C.accent })));
write(
  "brand/sara-mark-paper.svg",
  svg(glyph({ body: C.canvas, accent: C.accent })),
);
write("brand/sara-mark-mono.svg", svg(glyph({ body: "currentColor" })));
write("brand/sara-tile.svg", svg(tile()));
write("brand/sara-tile-green.svg", svg(tile("accent")));

const lockupInk = svg(
  lockup({ body: C.ink, accent: C.accent, text: C.ink }),
  lockupW,
  lockupH,
);
write("brand/sara-lockup-ink.svg", lockupInk);
write(
  "brand/sara-lockup-paper.svg",
  svg(
    lockup({ body: C.canvas, accent: C.accent, text: C.canvas }),
    lockupW,
    lockupH,
  ),
);
write(
  "brand/sara-lockup-ink.png",
  await sharp(Buffer.from(lockupInk), { density: 72 * 8 })
    .png()
    .toBuffer(),
);

/* Favicons and app icons: the mark on the ink tile. */
const icon = svg(tile());
write("favicon.svg", icon);
const png = (size) =>
  sharp(Buffer.from(icon), { density: 384 })
    .resize(size, size)
    .png()
    .toBuffer();
for (const [path, size] of [
  ["apple-touch-icon.png", 180],
  ["brand/sara-icon-192.png", 192],
  ["brand/sara-icon-512.png", 512],
]) {
  write(path, await png(size));
}

/* favicon.ico: PNG images in an ICO container (supported by every current
   browser), at the three sizes a tab strip or shortcut asks for. */
const icoSizes = [16, 32, 48];
const images = await Promise.all(icoSizes.map(png));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((img, i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(icoSizes[i], e);
  header.writeUInt8(icoSizes[i], e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(img.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += img.length;
});
write("favicon.ico", Buffer.concat([header, ...images]));

/* Specimen: the mark at each size class it has to survive, on both tiles and
   on ink, and the lockup on white and ink. Rendered from the data above, so it
   cannot flatter a mark the code does not draw. */
const rows = [];
let x = 24;
for (const size of [16, 24, 32, 48, 96]) {
  rows.push(
    `<g transform="translate(${x} ${24 + (96 - size) / 2}) scale(${size / 100})">${glyph({ body: C.ink, accent: C.accent })}</g>`,
  );
  x += size + 30;
}
rows.push(`<g transform="translate(${x} 32) scale(0.8)">${tile()}</g>`);
rows.push(
  `<g transform="translate(${x + 100} 32) scale(0.8)">${tile("accent")}</g>`,
);
rows.push(`<g transform="translate(${x + 200} 64) scale(0.16)">${tile()}</g>`);
const lockupScale = 0.64;
rows.push(
  `<g transform="translate(24 164) scale(${lockupScale})">${lockup({ body: C.ink, accent: C.accent, text: C.ink })}</g>`,
  `<rect x="${24 + lockupW * lockupScale + 40}" y="144" width="${lockupW * lockupScale + 48}" height="${lockupH * lockupScale + 40}" rx="16" fill="${C.ink}"/>`,
  `<g transform="translate(${24 + lockupW * lockupScale + 64} 164) scale(${lockupScale})">${lockup({ body: C.canvas, accent: C.accent, text: C.canvas })}</g>`,
);
const W = Math.max(x + 240, 24 + lockupW * lockupScale * 2 + 136);
const H = 164 + lockupH * lockupScale + 64;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.canvas}"/>${rows.join("")}<text x="24" y="${H - 18}" font-family="monospace" font-size="11" fill="${C.faint}">Sara · handoff · yarn brand:generate</text></svg>`;
write(
  "brand/sara-specimen.png",
  await sharp(Buffer.from(sheet), { density: 192 }).png().toBuffer(),
);

console.log(written.map((f) => `  public/${f}`).join("\n"));
