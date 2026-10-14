import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serviceCard } from "./og";

const SERVICE = {
  name: "Knotless braids",
  businessName: "Acme Salon",
  price: 25000,
  currency: "NGN",
  duration: 240,
  bookingMode: "SLOT" as const,
  image: "https://res.cloudinary.com/demo/braids.jpg",
};

/** A photo no encoder can shrink: every pixel random. */
async function noisePhoto() {
  const size = 1200;
  const pixels = Buffer.alloc(size * size * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

afterEach(() => vi.restoreAllMocks());

describe("serviceCard", () => {
  // WhatsApp shows an og:image under 300KB large; over it, the small thumbnail or none.
  it("keeps a card with a service photo under WhatsApp's 300KB limit", async () => {
    const photo = await noisePhoto();
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(new Uint8Array(photo)));

    const card = await serviceCard(SERVICE);
    const body = await card.arrayBuffer();

    expect(card.headers.get("content-type")).toBe("image/jpeg");
    expect(body.byteLength).toBeLessThan(300 * 1024);
  }, 30_000);
});
