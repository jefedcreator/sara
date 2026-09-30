/**
 * Emits the static brand assets (public/brand, the favicons, the app icons)
 * from the same geometry the `Logo` primitive draws.
 *
 * `src/primitives/Logo.tsx` is the source of truth. This file restates its path
 * data so it can render without React, then asserts every path appears verbatim
 * in the component, so a mark redrawn there and not here fails loudly instead
 * of shipping a favicon that disagrees with the nav. Colours are checked
 * against `src/styles/globals.css` for the same reason: an exported SVG has no
 * stylesheet to read tokens from.
 *
 *   yarn brand:generate
 */
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "public", "brand");

const logoSource = readFileSync(join(root, "src/primitives/Logo.tsx"), "utf8");
const tokenSource = readFileSync(join(root, "src/styles/globals.css"), "utf8");

/* Palette, from the @theme tokens. */
const C = {
  ink: "#0f1a14",
  canvas: "#ffffff",
  accent: "#25d366",
  onAccent: "#0b2b1a",
  faint: "#7f8a84",
};
for (const hex of Object.values(C)) {
  assert.ok(
    tokenSource.includes(hex),
    `${hex} is not in globals.css; the palette here has drifted`,
  );
}

/* Geometry, mirrored from Logo.tsx: each mark is its body paths plus the one
   accent shape (Sara's part, in green). `cradle`'s body is a stroke. */
const marks = {
  handoff: {
    accent:
      "M15 53H70.5A17.5 17.5 0 0 1 70.5 88H15A3 3 0 0 1 12 85V56A3 3 0 0 1 15 53Z",
    body: [
      "M29.5 12H85A3 3 0 0 1 88 15V44A3 3 0 0 1 85 47H29.5A17.5 17.5 0 0 1 29.5 12Z",
    ],
  },
  cradle: {
    accent: "M33 34A17 17 0 1 0 67 34A17 17 0 1 0 33 34Z",
    stroke: { d: "M15 40A35 35 0 0 0 85 40", width: 15 },
  },
  clover: {
    accent: "M54.24 45.76L59.74 23.33A14 14 0 1 1 76.67 40.26Z",
    body: [
      "M54.24 54.24L76.67 59.74A14 14 0 1 1 59.74 76.67Z",
      "M45.76 54.24L40.26 76.67A14 14 0 1 1 23.33 59.74Z",
      "M45.76 45.76L23.33 40.26A14 14 0 1 1 40.26 23.33Z",
    ],
  },
};

for (const [name, m] of Object.entries(marks)) {
  for (const d of [
    m.accent,
    ...(m.body ?? []),
    ...(m.stroke ? [m.stroke.d] : []),
  ]) {
    assert.ok(
      logoSource.includes(`"${d}"`),
      `${name}: "${d}" is not in Logo.tsx; these exports are stale`,
    );
  }
  if (m.stroke)
    assert.ok(
      logoSource.includes(`strokeWidth={${m.stroke.width}}`),
      `${name}: stroke width drifted`,
    );
}

/** One mark as SVG markup: body in `body`, the accent shape in `accent` (or body). */
const glyph = (name, { body, accent }) => {
  const m = marks[name];
  const parts = (m.body ?? []).map((d) => `<path d="${d}" fill="${body}"/>`);
  if (m.stroke) {
    parts.push(
      `<path d="${m.stroke.d}" fill="none" stroke="${body}" stroke-width="${m.stroke.width}" stroke-linecap="round"/>`,
    );
  }
  parts.push(`<path d="${m.accent}" fill="${accent ?? body}"/>`);
  return `<g>${parts.join("")}</g>`;
};

const svg = (inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Sara">${inner}</svg>\n`;

/** The tile, inset to 70%: ink ground keeps the green, green ground drops it. */
const tile = (name, ground = "ink") =>
  `<rect width="100" height="100" rx="22" fill="${ground === "ink" ? C.ink : C.accent}"/>` +
  `<g transform="translate(50 50) scale(0.7) translate(-50 -50)">` +
  glyph(
    name,
    ground === "ink"
      ? { body: C.canvas, accent: C.accent }
      : { body: C.onAccent },
  ) +
  `</g>`;

mkdirSync(brandDir, { recursive: true });
const written = [];
const write = (path, contents) => {
  writeFileSync(join(root, "public", path), contents);
  written.push(path);
};

for (const name of Object.keys(marks)) {
  write(
    `brand/sara-${name}-ink.svg`,
    svg(glyph(name, { body: C.ink, accent: C.accent })),
  );
  write(
    `brand/sara-${name}-paper.svg`,
    svg(glyph(name, { body: C.canvas, accent: C.accent })),
  );
  write(
    `brand/sara-${name}-mono.svg`,
    svg(glyph(name, { body: "currentColor" })),
  );
  write(`brand/sara-${name}-tile.svg`, svg(tile(name)));
  write(`brand/sara-${name}-tile-green.svg`, svg(tile(name, "accent")));
}

/* Favicons and app icons: the recommended mark on the ink tile. */
const icon = svg(tile("handoff"));
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

/* Specimen: every mark at each size class it has to survive, on both tiles
   and on ink. Rendered from the geometry above, so it cannot flatter a mark
   the code does not draw. No lockup: Bricolage is loaded by the app, not by a
   standalone SVG, so judge the lockup in the browser. */
const rows = [];
let y = 24;
for (const name of Object.keys(marks)) {
  rows.push(
    `<text x="24" y="${y + 54}" font-family="monospace" font-size="13" fill="${C.faint}">${name}</text>`,
  );
  let x = 110;
  for (const size of [16, 24, 32, 48, 96]) {
    rows.push(
      `<g transform="translate(${x} ${y + (96 - size) / 2}) scale(${size / 100})">${glyph(name, { body: C.ink, accent: C.accent })}</g>`,
    );
    x += size + 30;
  }
  rows.push(
    `<g transform="translate(${x} ${y + 8}) scale(0.8)">${tile(name)}</g>`,
  );
  rows.push(
    `<g transform="translate(${x + 100} ${y + 8}) scale(0.8)">${tile(name, "accent")}</g>`,
  );
  rows.push(
    `<g transform="translate(${x + 200} ${y + 40}) scale(0.16)">${tile(name)}</g>`,
  );
  rows.push(
    `<rect x="${x + 240}" y="${y}" width="120" height="96" rx="14" fill="${C.ink}"/>`,
  );
  rows.push(
    `<g transform="translate(${x + 264} ${y + 12}) scale(0.72)">${glyph(name, { body: C.canvas, accent: C.accent })}</g>`,
  );
  y += 124;
}
const W = 1080;
const H = y + 30;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.canvas}"/>${rows.join("")}<text x="24" y="${H - 18}" font-family="monospace" font-size="11" fill="${C.faint}">Sara marks · yarn brand:generate</text></svg>`;
write(
  "brand/sara-specimen.png",
  await sharp(Buffer.from(sheet), { density: 192 }).png().toBuffer(),
);

console.log(written.map((f) => `  public/${f}`).join("\n"));
