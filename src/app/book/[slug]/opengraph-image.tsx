import { ImageResponse } from "next/og";
import sharp from "sharp";

import SiteOpenGraphImage from "@/app/opengraph-image";
import { getPublicService } from "@/server";
import { OG, OG_SIZE, OgLockup, OgMark, ogFonts } from "@/server/og";
import { formatDuration, formatMoney, todayIso } from "@/utils/format";

/*
 * A booking link's share card. Owners drop these links in Instagram bios and
 * DMs, so the card is the service's own: the business, the service, the price
 * and length, a "Pick a time" pill, and the service photo (the mark on leaf
 * grey when there is none). Sara signs it quietly at the foot, single ink,
 * like the booking page. An unknown or paused link gets the site card.
 */

export const alt = "Book a time";
export const size = OG_SIZE;
export const contentType = "image/png";

type Params = { params: Promise<{ slug: string }> };

const PANEL = { width: 420, height: 502 };

/** The service photo as a JPEG data URL cropped to the panel, or null. */
async function photo(url: string | null) {
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

export default async function BookingOpenGraphImage({ params }: Params) {
  const { slug } = await params;
  const service = await getPublicService(slug, todayIso()).catch(() => null);
  if (!service) return SiteOpenGraphImage();

  const image = await photo(service.image);
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
          <div
            style={{
              fontFamily: "Hanken",
              fontWeight: 600,
              fontSize: 28,
              color: OG.muted,
            }}
          >
            {service.businessName}
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
          <div
            style={{
              fontFamily: "Hanken",
              fontSize: 30,
              color: OG.ink,
              marginTop: 6,
            }}
          >
            {`${formatMoney(service.price, service.currency)} · ${formatDuration(service.duration)}`}
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
            Pick a time
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
        <img
          src={image}
          alt=""
          {...PANEL}
          style={{ borderRadius: 32, objectFit: "cover" }}
        />
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
