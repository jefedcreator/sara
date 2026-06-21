import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../session", () => ({
  chatSessionService: {
    findIdentity: vi.fn(),
    getOrCreateSession: vi.fn(),
    save: vi.fn(),
    isStale: vi.fn().mockReturnValue(false),
  },
}));
vi.mock("../linking", () => ({
  linkingService: {
    issueToken: vi.fn().mockResolvedValue("tok_123"),
    buildLinkUrl: vi.fn().mockReturnValue("https://app.sara.ng/link?t=tok_123"),
  },
}));
vi.mock("../dispatch", () => ({
  intentDispatcher: {
    createInvoice: vi.fn(),
    createReceipt: vi.fn(),
    listServiceOptions: vi.fn(),
    bookingLinkText: vi.fn(),
    listUnpaidInvoices: vi.fn(),
    listTodayBookings: vi.fn(),
    businessSummary: vi.fn(),
  },
}));

import type { InboundMessage } from "../channels/types";
import { intentDispatcher } from "../dispatch";
import { linkingService } from "../linking";
import { chatSessionService } from "../session";
import { conversationEngine } from "./index";

const mockedSession = chatSessionService as any;
const mockedDispatch = intentDispatcher as any;

function inbound(text: string, messageId = "m1"): InboundMessage {
  return { channel: "WHATSAPP", externalId: "234800", text, messageId };
}
const IDENTITY = {
  id: "id_1", businessId: "biz_1",
  session: { id: "sess_1", state: "MAIN_MENU", context: null, lastProcessedMsgId: null, lastActiveAt: new Date() },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedSession.isStale.mockReturnValue(false);
  mockedSession.findIdentity.mockResolvedValue(IDENTITY);
  mockedSession.getOrCreateSession.mockResolvedValue(IDENTITY.session);
});

describe("linking", () => {
  it("replies with a link when the sender is unknown", async () => {
    mockedSession.findIdentity.mockResolvedValue(null);
    const reply = await conversationEngine.handle(inbound("hi"));
    expect(linkingService.issueToken).toHaveBeenCalledWith("WHATSAPP", "234800");
    expect(reply?.text).toContain("https://app.sara.ng/link?t=tok_123");
  });
});

describe("idempotency", () => {
  it("drops a duplicate messageId", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, lastProcessedMsgId: "m1" });
    const reply = await conversationEngine.handle(inbound("1", "m1"));
    expect(reply).toBeNull();
    expect(mockedSession.save).not.toHaveBeenCalled();
  });
});

describe("main menu", () => {
  it("shows the menu for unknown input", async () => {
    const reply = await conversationEngine.handle(inbound("hello"));
    expect(reply?.text).toContain("New invoice");
    expect(reply?.text).toContain("Share a service");
  });
});

describe("read flow", () => {
  it("runs unpaid invoices and returns to the menu", async () => {
    mockedDispatch.listUnpaidInvoices.mockResolvedValue("🧾 Unpaid invoices:\n• Ada");
    const reply = await conversationEngine.handle(inbound("4"));
    expect(mockedDispatch.listUnpaidInvoices).toHaveBeenCalledWith("biz_1");
    expect(reply?.text).toContain("Ada");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({ state: "MAIN_MENU" }));
  });
});

describe("share-a-service flow", () => {
  it("lists services then returns a booking link", async () => {
    mockedDispatch.listServiceOptions.mockResolvedValue([{ slug: "acme-haircut", label: "Haircut — NGN 5,000 (60 min)" }]);
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "MAIN_MENU" });
    let reply = await conversationEngine.handle(inbound("3", "a"));
    expect(reply?.text).toContain("1. Haircut");

    mockedDispatch.bookingLinkText.mockReturnValue("Share this booking link:\nhttps://app.sara.ng/book/acme-haircut");
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session, state: "SHARE_SERVICE_SELECT",
      context: { services: [{ slug: "acme-haircut", label: "Haircut — NGN 5,000 (60 min)" }] },
    });
    reply = await conversationEngine.handle(inbound("1", "b"));
    expect(reply?.text).toContain("https://app.sara.ng/book/acme-haircut");
  });

  it("tells the owner when there are no active services", async () => {
    mockedDispatch.listServiceOptions.mockResolvedValue([]);
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "MAIN_MENU" });
    const reply = await conversationEngine.handle(inbound("3", "a"));
    expect(reply?.text.toLowerCase()).toContain("no active services");
  });
});

describe("invoice write flow", () => {
  it("creates the invoice at confirm and returns the link", async () => {
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1012", link: "https://cdn.test/INV-1012.pdf" });
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session, state: "INVOICE_CONFIRM",
      context: { customerName: "Ada", amount: 15000, description: "gele" },
    });
    const reply = await conversationEngine.handle(inbound("yes", "e"));
    expect(mockedDispatch.createInvoice).toHaveBeenCalledWith("biz_1", { customerName: "Ada", amount: 15000, description: "gele" });
    expect(reply?.text).toContain("INV-1012");
    expect(reply?.text).toContain("https://cdn.test/INV-1012.pdf");
  });

  it("re-prompts on an invalid amount without advancing", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "INVOICE_AMOUNT", context: { customerName: "Ada" } });
    const reply = await conversationEngine.handle(inbound("abc", "x"));
    expect(reply?.text.toLowerCase()).toContain("amount");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({ state: "INVOICE_AMOUNT" }));
  });
});
