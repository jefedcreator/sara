import { readFile } from "node:fs/promises";
import path from "node:path";

import type { BookingMode } from "@prisma/client";
import { ImageResponse } from "next/og";
import sharp from "sharp";

import { bookingPill, type BookingView, type PublicBooking } from "@/utils/booking-view";
import { BRAND_COLOR, MARK_ACCENT, MARK_BODY } from "@/utils/brand";
import { formatMoney, formatSlotTime, shortDay, unitCount } from "@/utils/format";
import { formatDate } from "@/utils/labels";
import { CARDS, OG_SIZE, type CardKey } from "@/utils/metadata";
import type { ProductPage } from "@/utils/product-page";
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
 * Every card is a square (OG_SIZE): text at the top, one full-width panel in
 * the middle, and the status and Sara's signature along the foot.
 */
const CARD_PAD = 56;
/** The width inside the padding, which the full-width panels fill. */
const CARD_INNER = OG_SIZE.width - CARD_PAD * 2;

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
 * white and calm like the landing page, the lockup at the top, the mark large
 * on a leaf-grey panel, and the headline and its line at the foot.
 */
export async function pageCard(card: CardKey) {
  const { headline, description } = CARDS[card];
  const headlineSize = headline.length > 34 ? 60 : 68;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: CARD_PAD,
        gap: 40,
      }}
    >
      <OgLockup size={44} />
      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <OgMark size={220} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
 * business, the document and its dates at the top; the document itself on
 * leaf grey across the middle, total first, then up to three lines; the
 * status pill and a quiet Sara signature along the foot.
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
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: CARD_PAD,
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 28,
            color: OG.muted,
          }}
        >
          {clip(doc.businessName, 44)}
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
            marginTop: 4,
          }}
        >
          {dates.filter(Boolean).join(" · ")}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
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
            margin: "24px 0 20px",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {shown.map((line, i) => (
            <div key={i} style={row}>
              <span>
                {line.quantity > 1
                  ? `${clip(line.description.split("\n")[0]!, 30)} × ${line.quantity}`
                  : clip(line.description.split("\n")[0]!, 36)}
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

/** The service card's photo panel, full width under the text. */
const PANEL = { width: CARD_INNER, height: 360 };

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
 * A card re-encoded as JPEG, headers kept. For the cards that can carry a
 * photo: as a PNG one weighs half a megabyte or more, and WhatsApp previews
 * an image that heavy with the small thumbnail, or none. The flat-colour
 * cards stay PNG, near 40KB and crisper. 4:4:4 keeps the coloured type sharp.
 */
async function asJpeg(card: Response) {
  const jpeg = await sharp(Buffer.from(await card.arrayBuffer()))
    .jpeg({ quality: 85, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toBuffer();
  const headers = new Headers(card.headers);
  headers.set("content-type", "image/jpeg");
  headers.delete("content-length");
  return new Response(new Uint8Array(jpeg), { headers });
}

/*
 * A service's card, for its booking link (/book) and its page (/services)
 * alike. Owners drop these links in Instagram bios and DMs, so the card is
 * the service's own: the business, the service and its price at the top, the
 * service photo across the middle (the mark on leaf grey when there is none),
 * and a pill saying what comes next at the foot. Sara signs it quietly beside
 * the pill, single ink. A JPEG (asJpeg).
 */
export async function serviceCard(service: ServiceCardInput) {
  const image = await panelPhoto(service.image);
  const titleSize = service.name.length > 28 ? 60 : 76;

  const card = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: CARD_PAD,
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
          {clip(service.businessName, 44)}
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
          {clip(service.name, 48)}
        </div>
        <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 4 }}>
          {servicePriceLine(service)}
        </div>
      </div>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
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
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
  return asJpeg(card);
}

/*
 * A product's card, for its public page (/products/<slug>). Built like a
 * service card: the business, product and price at the top, the first photo
 * across the middle (the mark on leaf grey when there is none), and a pill
 * saying what the customer can do at the foot. Sara signs it "Orders by".
 */
export async function productCard(page: ProductPage) {
  const image = await panelPhoto(page.photos[0] ?? null);
  const titleSize = page.name.length > 28 ? 60 : 76;
  const soldOut =
    page.options.length === 0 ||
    page.options.every((option) => option.available === 0);
  const action = soldOut ? "Sold out" : page.canBuy ? "Buy now" : "View product";
  const actionStyle = soldOut
    ? PILL.muted
    : { background: OG.accent, color: OG.onAccent };

  const card = new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: CARD_PAD,
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
          {clip(page.businessName, 44)}
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
          {clip(page.name, 48)}
        </div>
        <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 4 }}>
          {formatMoney(page.price, page.currency)}
        </div>
      </div>

      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 68,
            padding: "0 34px",
            borderRadius: 999,
            ...actionStyle,
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 28,
          }}
        >
          {action}
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
          Orders by
          <OgLockup size={30} color={OG.faint} accent={OG.faint} />
        </div>
      </div>
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
  return asJpeg(card);
}

/*
 * A booking link's card, laid out like the service and document cards: the
 * business and the service at the top; a calendar leaf on leaf grey across
 * the middle, because the date is what the customer opens it for; the status
 * and Sara's quiet signature along the foot. Never the customer's name or the
 * amount: cards get forwarded into group chats.
 */
/** One end of a stay or rental on the card's leaf: "Check-in", "Fri 2 Oct", "From 14:00". */
function BookingLeg({ label, day, time }: { label: string; day: string; time: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 22, color: OG.muted }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "Bricolage",
          fontSize: 56,
          lineHeight: 1.05,
          letterSpacing: -1.5,
          color: OG.ink,
          marginTop: 6,
        }}
      >
        {day}
      </div>
      <div style={{ fontFamily: "Hanken", fontSize: 24, color: OG.muted, marginTop: 6 }}>
        {time}
      </div>
    </div>
  );
}

export async function bookingCard(booking: PublicBooking, view: BookingView) {
  const pill = bookingPill(view);
  const mode = booking.service.bookingMode;
  const titleSize = booking.service.name.length > 28 ? 60 : 76;
  const start = new Date(booking.startTime);
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(start);

  const leaf =
    mode === "SLOT" ? (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flex: 1,
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 26, color: OG.muted }}>
          {`${part({ weekday: "long" })} · ${part({ month: "long" })}`}
        </div>
        <div
          style={{
            fontFamily: "Bricolage",
            fontSize: 200,
            lineHeight: 1,
            letterSpacing: -8,
            color: OG.ink,
            marginTop: 8,
          }}
        >
          {String(start.getUTCDate())}
        </div>
        <div style={{ fontFamily: "Hanken", fontSize: 30, color: OG.ink, marginTop: 12 }}>
          {formatSlotTime(booking.startTime)}
        </div>
      </div>
    ) : (
      // A stay or rental: its two ends side by side, labelled as on the
      // booking page, then its length.
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          padding: "0 48px",
          borderRadius: 32,
          background: OG.surface,
        }}
      >
        <div style={{ display: "flex", gap: 40 }}>
          <BookingLeg
            label={mode === "NIGHTLY" ? "Check-in" : "Pickup"}
            day={shortDay(booking.startTime)}
            time={`${mode === "NIGHTLY" ? "From " : ""}${formatSlotTime(booking.startTime)}`}
          />
          <div style={{ display: "flex", width: 2, background: OG.line }} />
          <BookingLeg
            label={mode === "NIGHTLY" ? "Check-out" : "Return"}
            day={shortDay(booking.endTime)}
            time={`${mode === "NIGHTLY" ? "By " : ""}${formatSlotTime(booking.endTime)}`}
          />
        </div>
        <div
          style={{
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 26,
            color: OG.accentInk,
            marginTop: 40,
          }}
        >
          {unitCount(mode, booking.units)}
        </div>
      </div>
    );

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: OG.canvas,
        padding: CARD_PAD,
        gap: 32,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontFamily: "Hanken", fontWeight: 600, fontSize: 28, color: OG.muted }}>
          {clip(booking.businessName, 44)}
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
          {clip(booking.service.name, 48)}
        </div>
      </div>

      {leaf}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            height: 60,
            padding: "0 28px",
            borderRadius: 999,
            ...PILL[pill.tone],
            fontFamily: "Hanken",
            fontWeight: 600,
            fontSize: 26,
          }}
        >
          {pill.label}
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
    </div>,
    { ...OG_SIZE, fonts: await ogFonts() },
  );
}
