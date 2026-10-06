import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BookingMode } from "@prisma/client";
import { ImageResponse } from "next/og";
import sharp from "sharp";

import { BRAND_COLOR, MARK_ACCENT, MARK_BODY } from "@/utils/brand";
import { formatMoney } from "@/utils/format";
import { formatDate } from "@/utils/labels";
import { CARDS, OG_SIZE, type CardKey } from "@/utils/metadata";
import { SERVICE_PICK, servicePriceLine } from "@/utils/service-page";
import { documentLines, type SharedDocument } from "@/utils/shared-document";

/*
 * Shared pieces for the Open Graph cards (next/og). Satori renders these, not
 * the browser: no Tailwind, no CSS variables, flex layout only, and fonts
 * passed in as bytes. Values below are DESIGN.md tokens, restated because a
 * card has no stylesheet.
 */

export { OG_SIZE };

export const OG = {
  ...BRAND_COLOR,
  surface: "#f4f7f5",
  line: "#e5ebe7",
  muted: "#5a665f",
  faint: "#7f8a84",
  accentSoft: "#e8f9ee",
  accentInk: "#075e54",
  danger: "#b42318",
  dangerSoft: "#fef3f2",
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

/*
 * A page's card, for pages previewed by what they are (the fixed CARDS):
 * white and calm like the landing page, the lockup top-left, the headline and
 * its line below, the mark large on a leaf-grey panel.
 */
export async function pageCard(card: CardKey) {
  const { headline, description } = CARDS[card];
  const headlineSize = headline.length > 34 ? 64 : 72;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: 64,
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
          paddingTop: 8,
          paddingBottom: 8,
        }}
      >
        <OgLockup size={44} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: headlineSize,
              lineHeight: 1.04,
              letterSpacing: -0.04 * headlineSize,
              color: OG.ink,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              fontFamily: "Hanken",
              fontSize: 28,
              lineHeight: 1.45,
              color: OG.muted,
            }}
          >
            {description}
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 420,
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <OgMark size={250} />
      </div>
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}

const PILL = {
  accent: { background: OG.accentSoft, color: OG.accentInk },
  muted: { background: OG.surface, color: OG.muted },
  danger: { background: OG.dangerSoft, color: OG.danger },
} as const;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

/*
 * An invoice or receipt link's card, laid out like a booking link's: the
 * business, the document and its dates on the left with the status pill and
 * a quiet Sara signature at the foot; on the right, the document itself on
 * leaf grey, total first, then up to three lines.
 */
export async function documentCard(doc: SharedDocument) {
  const noun = doc.kind === "invoice" ? "Invoice" : "Receipt";
  const title = `${noun} ${doc.number}`;
  const titleSize = title.length > 18 ? 60 : 76;

  const dates =
    doc.kind === "invoice"
      ? [
          `Issued ${formatDate(doc.issuedAt)}`,
          doc.dueAt ? `Due ${formatDate(doc.dueAt)}` : null,
        ]
      : [`Paid ${formatDate(doc.issuedAt)}`, doc.paymentMethod];

  const total = formatMoney(doc.total, doc.currency);
  const totalSize = total.length > 14 ? 44 : total.length > 11 ? 52 : 60;
  const lines = documentLines(doc);
  const shown = lines.slice(0, 3);
  const more = lines.length - shown.length;

  const row = {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    fontFamily: "Hanken",
    fontSize: 22,
    color: OG.ink,
  } as const;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: 64,
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 28,
              color: OG.muted,
            }}
          >
            {clip(doc.businessName, 36)}
          </div>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: titleSize,
              lineHeight: 1.04,
              letterSpacing: -0.035 * titleSize,
              color: OG.ink,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontFamily: "Hanken",
              fontSize: 30,
              color: OG.ink,
              marginTop: 6,
            }}
          >
            {dates.filter(Boolean).join(" · ")}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 60,
              padding: "0 28px",
              borderRadius: 999,
              ...PILL[doc.status.tone],
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 26,
            }}
          >
            {doc.status.label}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "Hanken",
              fontSize: 22,
              color: OG.faint,
            }}
          >
            {`${noun}s by`}
            <OgLockup size={30} color={OG.faint} accent={OG.faint} />
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 420,
          padding: 40,
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <div
          style={{
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 22,
            color: OG.muted,
          }}
        >
          {doc.kind === "receipt" ? "Amount paid" : "Total"}
        </div>
        <div
          style={{
            fontFamily: "Bricolage",
            fontSize: totalSize,
            lineHeight: 1.1,
            letterSpacing: -0.03 * totalSize,
            color: OG.ink,
            marginTop: 8,
          }}
        >
          {total}
        </div>
        <div
          style={{
            display: "flex",
            height: 2,
            background: OG.line,
            margin: "28px 0 24px",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {shown.map((line, i) => (
            <div key={i} style={row}>
              <span>
                {line.quantity > 1
                  ? `${clip(line.description.split("\n")[0]!, 15)} × ${line.quantity}`
                  : clip(line.description.split("\n")[0]!, 20)}
              </span>
              <span style={{ color: OG.muted }}>
                {formatMoney(line.total, "")}
              </span>
            </div>
          ))}
          {more > 0 ? (
            <div style={{ ...row, color: OG.faint }}>{`+ ${more} more`}</div>
          ) : null}
        </div>
        {doc.balance > 0 && doc.balance < doc.total ? (
          <div style={{ ...row, fontWeight: 600, marginTop: "auto" }}>
            <span>Balance due</span>
            <span>{formatMoney(doc.balance, doc.currency)}</span>
          </div>
        ) : null}
      </div>
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}

export type ServiceCardInput = {
  name: string;
  businessName: string;
  price: string | number;
  currency: string;
  duration: number;
  bookingMode: BookingMode;
  image: string | null;
};

const PANEL = { width: 420, height: 502 };

/** A photo as a JPEG data URL cropped to the card's right panel, or null. */
async function panelPhoto(url: string | null) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const jpeg = await sharp(Buffer.from(await response.arrayBuffer()))
      .resize(PANEL.width * 2, PANEL.height * 2, { fit: "cover" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

/*
 * A service's card, for its booking link (/book) and its page (/services)
 * alike. Owners drop these links in Instagram bios and DMs, so the card is
 * the service's own: the business, the service, its price, a pill saying
 * what comes next, and the service photo (the mark on leaf grey when there
 * is none). Sara signs it quietly at the foot, single ink.
 */
export async function serviceCard(service: ServiceCardInput) {
  const image = await panelPhoto(service.image);
  const titleSize = service.name.length > 28 ? 60 : 76;

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: 64,
        gap: 56,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          flex: 1,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
            {clip(service.businessName, 36)}
          </div>
          <div
            style={{
              fontFamily: "Bricolage",
              fontSize: titleSize,
              lineHeight: 1.04,
              letterSpacing: -0.035 * titleSize,
              color: OG.ink,
            }}
          >
            {service.name}
          </div>
          <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 6 }}>
            {servicePriceLine(service)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 68,
              padding: "0 34px",
              borderRadius: 999,
              background: OG.accent,
              color: OG.onAccent,
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 28,
            }}
          >
            {SERVICE_PICK[service.bookingMode]}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "Hanken",
              fontSize: 22,
              color: OG.faint,
            }}
          >
            Bookings by
            <OgLockup size={30} color={OG.faint} accent={OG.faint} />
          </div>
        </div>
      </div>

      {image ? (
        <img src={image} alt="" {...PANEL} style={{ borderRadius: 32, objectFit: "cover" }} />
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...PANEL,
            borderRadius: 32,
            background: OG.surface,
          }}
        >
          <OgMark size={200} />
        </div>
      )}
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}

