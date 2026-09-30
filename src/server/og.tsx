import { readFile } from "node:fs/promises";
import path from "node:path";

import { BRAND_COLOR, MARK_ACCENT, MARK_BODY } from "@/utils/brand";

/*
 * Shared pieces for the Open Graph cards (next/og). Satori renders these, not
 * the browser: no Tailwind, no CSS variables, flex layout only, and fonts
 * passed in as bytes. Values below are DESIGN.md tokens, restated because a
 * card has no stylesheet.
 */

export const OG_SIZE = { width: 1200, height: 630 };

export const OG = {
  ...BRAND_COLOR,
  surface: "#f4f7f5",
  line: "#e5ebe7",
  muted: "#5a665f",
  faint: "#7f8a84",
} as const;

/*
 * The app's own type from assets/fonts (static TTFs; satori cannot read the
 * woff2 next/font serves): Bricolage for display and the wordmark, Hanken for
 * everything else. Read once per process.
 */
const FONTS = [
  ["Bricolage", 400, "BricolageGrotesque-Regular.ttf"],
  ["Bricolage", 600, "BricolageGrotesque-SemiBold.ttf"],
  ["Hanken", 400, "HankenGrotesk-Regular.ttf"],
  ["Hanken", 600, "HankenGrotesk-SemiBold.ttf"],
] as const;

let fonts: ReturnType<typeof readFonts> | undefined;
const readFonts = () =>
  Promise.all(
    FONTS.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: "normal" as const,
      data: await readFile(path.join(process.cwd(), "assets", "fonts", file)),
    })),
  );

export const ogFonts = () => (fonts ??= readFonts());

/** The mark, `size` px square, owner's half in `body` and Sara's in `accent`. */
export function OgMark({
  size,
  body = OG.ink,
  accent = OG.accent,
}: {
  size: number;
  body?: string;
  accent?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <path d={MARK_BODY} fill={body} />
      <path d={MARK_ACCENT} fill={accent} />
    </svg>
  );
}

/**
 * The lockup at `size` px type, set as the Wordmark primitive sets it: mark at
 * 0.95em, 0.28em gap, display 600 with -0.04em tracking.
 */
export function OgLockup({
  size,
  color = OG.ink,
  accent = OG.accent,
}: {
  size: number;
  color?: string;
  accent?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.28,
        color,
        fontFamily: "Bricolage",
        fontWeight: 600,
        fontSize: size,
        letterSpacing: -0.04 * size,
        lineHeight: 1,
      }}
    >
      <div style={{ display: "flex", marginTop: size * 0.07 }}>
        <OgMark size={size * 0.95} body={color} accent={accent} />
      </div>
      <span style={{ marginTop: -size * 0.06 }}>sara</span>
    </div>
  );
}
