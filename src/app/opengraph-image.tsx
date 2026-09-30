import { ImageResponse } from "next/og";

import { OG, OG_SIZE, OgLockup, OgMark, ogFonts } from "@/server/og";

/*
 * The site's share card: every route without its own (booking links have
 * theirs). White and calm like the landing page, the lockup top-left, the
 * mark large on a leaf-grey panel.
 */

export const alt = "Sara: the admin side of your business, handled.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function OpenGraphImage() {
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
              fontSize: 72,
              lineHeight: 1.04,
              letterSpacing: -0.04 * 72,
              color: OG.ink,
            }}
          >
            The admin side of your business, handled.
          </div>
          <div
            style={{
              fontFamily: "Hanken",
              fontSize: 28,
              lineHeight: 1.45,
              color: OG.muted,
            }}
          >
            Invoices, receipts, booking links and today&apos;s numbers, for
            small service businesses.
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
