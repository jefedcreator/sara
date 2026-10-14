/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/documents", () => ({ getSharedInvoice: vi.fn(), getSharedReceipt: vi.fn() }));
vi.mock("@/server/booking-page", () => ({ getPublicBooking: vi.fn() }));
vi.mock("@/server/service-page", () => ({ getServicePage: vi.fn() }));

vi.mock("@/server/og", () => {
  const png = (body: string) => async () =>
    new Response(body, { headers: { "content-type": "image/png" } });
  return {
    documentCard: vi.fn(png("document")),
    bookingCard: vi.fn(png("booking")),
    serviceCard: vi.fn(async () => new Response("service", { headers: { "content-type": "image/jpeg" } })),
    pageCard: vi.fn(png("site")),
  };
});

vi.mock("@/utils/booking-view", () => ({ bookingView: vi.fn(() => "upcoming") }));
vi.mock("@/utils/url", () => ({ appBaseUrl: () => "https://sara.example" }));

import { getSharedInvoice } from "@/server/documents";
import { getServicePage } from "@/server/service-page";

import { cardFor, linkCard, primeLinkCard } from "./link-cards";

const mockedInvoice = getSharedInvoice as any;
const mockedService = getServicePage as any;

beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as any).saraLinkCards?.clear();
  mockedInvoice.mockResolvedValue({ kind: "invoice", number: "INV-1" });
  mockedService.mockResolvedValue({ name: "Knotless braids" });
});

afterEach(() => vi.useRealTimers());

describe("cardFor", () => {
  it("knows Sara's customer links by their path", () => {
    expect(cardFor("https://sara.example/invoices/inv_1")).toEqual({ kind: "invoice", id: "inv_1" });
    expect(cardFor("https://sara.example/receipts/rcp_1")).toEqual({ kind: "receipt", id: "rcp_1" });
    expect(cardFor("https://sara.example/bookings/bk_1")).toEqual({ kind: "booking", id: "bk_1" });
    expect(cardFor("https://sara.example/services/acme-braids")).toEqual({ kind: "service", id: "acme-braids" });
    expect(cardFor("https://sara.example/book/acme-braids")).toEqual({ kind: "service", id: "acme-braids" });
    expect(cardFor("https://sara.example/services/acme%20braids")).toEqual({ kind: "service", id: "acme braids" });
  });

  it("leaves everything else alone", () => {
    expect(cardFor("https://elsewhere.example/invoices/inv_1")).toBeNull();
    expect(cardFor("https://sara.example/invoices")).toBeNull();
    expect(cardFor("https://sara.example/invoices/inv_1/opengraph-image")).toBeNull();
    expect(cardFor("https://sara.example/link?t=abc")).toBeNull();
    expect(cardFor("https://sara.example/constructor/x")).toBeNull();
    expect(cardFor("https://sara.example/invoices/%E0%A4%A")).toBeNull();
    expect(cardFor("not a url")).toBeNull();
  });
});

describe("linkCard", () => {
  it("renders a card once and answers again from memory", async () => {
    const first = await linkCard("invoice", "inv_1");
    const second = await linkCard("invoice", "inv_1");

    expect(await first.text()).toBe("document");
    expect(await second.text()).toBe("document");
    expect(second.headers.get("content-type")).toBe("image/png");
    expect(mockedInvoice).toHaveBeenCalledTimes(1);
  });

  it("shares one render between requests that arrive together", async () => {
    await Promise.all([linkCard("invoice", "inv_1"), linkCard("invoice", "inv_1")]);
    expect(mockedInvoice).toHaveBeenCalledTimes(1);
  });

  it("renders again once a card is ten minutes old", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await linkCard("invoice", "inv_1");
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    await linkCard("invoice", "inv_1");
    expect(mockedInvoice).toHaveBeenCalledTimes(2);
  });

  it("gives a link that leads nowhere the site card, and asks again next time", async () => {
    mockedInvoice.mockResolvedValue(null);
    const card = await linkCard("invoice", "gone");
    await linkCard("invoice", "gone");

    expect(await card.text()).toBe("site");
    expect(mockedInvoice).toHaveBeenCalledTimes(2);
  });

  it("gives a failed read the site card, and asks again next time", async () => {
    mockedInvoice.mockRejectedValueOnce(new Error("db down"));
    const card = await linkCard("invoice", "inv_1");
    const retry = await linkCard("invoice", "inv_1");

    expect(await card.text()).toBe("site");
    expect(await retry.text()).toBe("document");
  });
});

describe("primeLinkCard", () => {
  it("renders the card behind a Sara link before the link goes out", async () => {
    await primeLinkCard("https://sara.example/invoices/inv_1");
    expect(mockedInvoice).toHaveBeenCalledTimes(1);

    await linkCard("invoice", "inv_1");
    expect(mockedInvoice).toHaveBeenCalledTimes(1);
  });

  it("renders afresh even when a card is in memory, for a document just changed", async () => {
    await linkCard("invoice", "inv_1");
    await primeLinkCard("https://sara.example/invoices/inv_1");
    expect(mockedInvoice).toHaveBeenCalledTimes(2);
  });

  it("warms a service's page and its booking link together", async () => {
    await primeLinkCard("https://sara.example/services/acme-braids");
    const card = await linkCard("service", "acme-braids");

    expect(await card.text()).toBe("service");
    expect(card.headers.get("content-type")).toBe("image/jpeg");
    expect(mockedService).toHaveBeenCalledTimes(1);
  });

  it("ignores links that aren't Sara's customer links", async () => {
    await primeLinkCard("https://elsewhere.example/invoices/inv_1");
    await primeLinkCard("https://sara.example/link?t=abc");
    expect(mockedInvoice).not.toHaveBeenCalled();
  });

  it("never throws", async () => {
    mockedInvoice.mockRejectedValue(new Error("db down"));
    await expect(primeLinkCard("https://sara.example/invoices/inv_1")).resolves.toBeUndefined();
  });

  it("stops waiting after its timeout and keeps the render it started", async () => {
    let finish!: (doc: unknown) => void;
    mockedInvoice.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));

    await primeLinkCard("https://sara.example/invoices/inv_1", 10);
    finish({ kind: "invoice", number: "INV-1" });
    const card = await linkCard("invoice", "inv_1");

    expect(await card.text()).toBe("document");
    expect(mockedInvoice).toHaveBeenCalledTimes(1);
  });
});
