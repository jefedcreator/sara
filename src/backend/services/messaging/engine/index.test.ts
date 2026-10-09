import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../session", () => ({
  chatSessionService: {
    findIdentity: vi.fn(),
    getOrCreateSession: vi.fn(),
    save: vi.fn(),
    isStale: vi.fn().mockReturnValue(false),
    claimMessage: vi.fn(),
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
    listFullServiceOptions: vi.fn(),
    bookingLinkText: vi.fn(),
    listUnpaidInvoices: vi.fn(),
    listTodayBookings: vi.fn(),
    businessSummary: vi.fn(),
  },
}));

import type { InboundMessage } from "../channels/types";
import { intentDispatcher, type FullServiceOption } from "../dispatch";
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
  mockedSession.claimMessage.mockResolvedValue(true);
  mockedDispatch.listFullServiceOptions.mockResolvedValue([]);
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
    mockedSession.claimMessage.mockResolvedValue(false);
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

describe("service item selection with quantities", () => {
  const MOCK_SERVICES: FullServiceOption[] = [
    {
      id: "srv_1",
      slug: "box-braids",
      name: "Box Braids",
      price: 15000,
      currency: "NGN",
      label: "Box Braids — NGN 15,000 (2 hr)",
    },
    {
      id: "srv_2",
      slug: "wash-blow-dry",
      name: "Wash & Blow Dry",
      price: 5000,
      currency: "NGN",
      label: "Wash & Blow Dry — NGN 5,000 (45 min)",
    },
  ];

  it("handles service selection with count and creates invoice with line items", async () => {
    mockedDispatch.listFullServiceOptions.mockResolvedValue(MOCK_SERVICES);
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1013", link: "https://cdn.test/INV-1013.pdf" });

    // 1. Enter customer name at INVOICE_CUSTOMER
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CUSTOMER",
      context: {},
    });
    let reply = await conversationEngine.handle(inbound("Ada", "m1"));
    expect(reply?.text).toContain("Add a service, or enter a custom amount:");
    expect(reply?.text).toContain("1. Box Braids — NGN 15,000 (2 hr)");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: expect.objectContaining({
        customerName: "Ada",
        availableServices: MOCK_SERVICES,
      }),
    }));

    // 2. Select service #1 at INVOICE_ITEM_OR_AMOUNT
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, selectedItems: [] },
    });
    reply = await conversationEngine.handle(inbound("1", "m2"));
    expect(reply?.text).toContain("How many Box Braids? (e.g. 1 or 2)");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_ITEM_QTY",
      context: expect.objectContaining({ pendingServiceId: "srv_1" }),
    }));

    // 3. Enter count 2 at INVOICE_ITEM_QTY
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_QTY",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, pendingServiceId: "srv_1", selectedItems: [] },
    });
    reply = await conversationEngine.handle(inbound("2", "m3"));
    expect(reply?.text).toContain("Added: 2 × Box Braids (NGN 30,000)");
    expect(reply?.text).toContain("Total so far: NGN 30,000");
    expect(reply?.text).toContain("Add another service?");
    expect(reply?.text).toContain("DONE to continue");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_MORE_ITEMS",
      context: expect.objectContaining({
        amount: 30000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      }),
    }));

    // 4. Send "done" at INVOICE_MORE_ITEMS
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_MORE_ITEMS",
      context: {
        customerName: "Ada",
        availableServices: MOCK_SERVICES,
        amount: 30000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      },
    });
    reply = await conversationEngine.handle(inbound("done", "m4"));
    expect(reply?.text).toContain("What's it for? (or 'skip')");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_DESC",
    }));

    // 5. Send "skip" at INVOICE_DESC
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_DESC",
      context: {
        customerName: "Ada",
        availableServices: MOCK_SERVICES,
        amount: 30000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      },
    });
    reply = await conversationEngine.handle(inbound("skip", "m5"));
    expect(reply?.text).toContain("• 2 × Box Braids — NGN 30,000");
    expect(reply?.text).toContain("Total: NGN 30,000");
    expect(reply?.text).toContain("Reply YES to create, NO to cancel");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_CONFIRM",
    }));

    // 6. Send "yes" at INVOICE_CONFIRM
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: {
        customerName: "Ada",
        availableServices: MOCK_SERVICES,
        amount: 30000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      },
    });
    reply = await conversationEngine.handle(inbound("yes", "m6"));
    expect(mockedDispatch.createInvoice).toHaveBeenCalledWith("biz_1", {
      customerName: "Ada",
      amount: 30000,
      description: undefined,
      services: [
        { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
      ],
    });
    expect(reply?.text).toContain("Invoice INV-1013 created");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "MAIN_MENU",
      context: null,
    }));
  });

  it("supports adding multiple services and creates receipt with all line items", async () => {
    mockedDispatch.createReceipt.mockResolvedValue({ number: "RCP-1008", link: "https://cdn.test/RCP-1008.pdf" });

    // Start at RECEIPT_MORE_ITEMS with 1 item already selected
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_MORE_ITEMS",
      context: {
        customerName: "Tunde",
        availableServices: MOCK_SERVICES,
        amount: 30000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      },
    });
    // Select service 2: Wash & Blow Dry
    let reply = await conversationEngine.handle(inbound("2", "r1"));
    expect(reply?.text).toContain("How many Wash & Blow Dry? (e.g. 1 or 2)");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "RECEIPT_ITEM_QTY",
      context: expect.objectContaining({ pendingServiceId: "srv_2" }),
    }));

    // Enter qty 1
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_ITEM_QTY",
      context: {
        customerName: "Tunde",
        availableServices: MOCK_SERVICES,
        amount: 30000,
        pendingServiceId: "srv_2",
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
        ],
      },
    });
    reply = await conversationEngine.handle(inbound("1", "r2"));
    expect(reply?.text).toContain("Added: 1 × Wash & Blow Dry (NGN 5,000)");
    expect(reply?.text).toContain("Total so far: NGN 35,000");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "RECEIPT_MORE_ITEMS",
      context: expect.objectContaining({
        amount: 35000,
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
          { serviceId: "srv_2", name: "Wash & Blow Dry", quantity: 1, unitPrice: 5000, total: 5000 },
        ],
      }),
    }));

    // Confirm receipt
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_CONFIRM",
      context: {
        customerName: "Tunde",
        amount: 35000,
        description: "Full service",
        selectedItems: [
          { serviceId: "srv_1", name: "Box Braids", quantity: 2, unitPrice: 15000, total: 30000 },
          { serviceId: "srv_2", name: "Wash & Blow Dry", quantity: 1, unitPrice: 5000, total: 5000 },
        ],
      },
    });
    reply = await conversationEngine.handle(inbound("yes", "r3"));
    expect(mockedDispatch.createReceipt).toHaveBeenCalledWith("biz_1", {
      customerName: "Tunde",
      amount: 35000,
      description: "Full service",
      services: [
        { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
        { serviceId: "srv_2", quantity: 1, unitPrice: 5000, total: 5000, description: "Wash & Blow Dry" },
      ],
    });
    expect(reply?.text).toContain("Receipt RCP-1008 created");
  });

  it("allows custom amount fallback directly from ITEM_OR_AMOUNT", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, selectedItems: [] },
    });
    const reply = await conversationEngine.handle(inbound("5000", "c1"));
    expect(reply?.text).toContain("What's it for? (or 'skip')");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_DESC",
      context: expect.objectContaining({
        customerName: "Ada",
        amount: 5000,
        selectedItems: [],
      }),
    }));
  });

  it("skips service prompt when business has no active services", async () => {
    mockedDispatch.listFullServiceOptions.mockResolvedValue([]);
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CUSTOMER",
      context: {},
    });
    const reply = await conversationEngine.handle(inbound("Ada", "s0"));
    expect(reply?.text).toBe("Amount? e.g. 5000");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_AMOUNT",
      context: expect.objectContaining({ customerName: "Ada" }),
    }));
  });

  it("skips service prompt for receipt when business has no active services", async () => {
    mockedDispatch.listFullServiceOptions.mockResolvedValue([]);
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_CUSTOMER",
      context: {},
    });
    const reply = await conversationEngine.handle(inbound("Ada", "s0r"));
    expect(reply?.text).toBe("Amount paid? e.g. 5000");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "RECEIPT_AMOUNT",
      context: expect.objectContaining({ customerName: "Ada" }),
    }));
  });

  it("re-prompts on invalid quantity in ITEM_QTY", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_QTY",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, pendingServiceId: "srv_1" },
    });
    const reply = await conversationEngine.handle(inbound("zero", "q1"));
    expect(reply?.text).toContain("Please enter a valid count (e.g. 1 or 2):");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_ITEM_QTY",
    }));
  });

  it("re-prompts on invalid input in ITEM_OR_AMOUNT", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, selectedItems: [] },
    });
    const reply = await conversationEngine.handle(inbound("not-a-service-or-amount", "i1"));
    expect(reply?.text).toContain("Please reply with a service number (1-2) or enter an amount (e.g. 5000):");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_ITEM_OR_AMOUNT",
    }));
  });

  it("re-prompts on invalid input in MORE_ITEMS", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_MORE_ITEMS",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES, selectedItems: [] },
    });
    const reply = await conversationEngine.handle(inbound("not-valid", "i2"));
    expect(reply?.text).toContain("Reply with a service number to add more, or DONE to continue.");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_MORE_ITEMS",
    }));
  });

  it("handles cancel and menu from intermediate service states", async () => {
    // Cancel from INVOICE_ITEM_OR_AMOUNT
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: { customerName: "Ada", availableServices: MOCK_SERVICES },
    });
    let reply = await conversationEngine.handle(inbound("cancel", "c1"));
    expect(reply?.text).toContain("Cancelled.");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "MAIN_MENU",
      context: null,
    }));

    // Menu from INVOICE_ITEM_QTY
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_QTY",
      context: { customerName: "Ada", pendingServiceId: "srv_1" },
    });
    reply = await conversationEngine.handle(inbound("menu", "c2"));
    expect(reply?.text).toContain("Reply with a number:");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "MAIN_MENU",
    }));

    // 0 from INVOICE_MORE_ITEMS
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_MORE_ITEMS",
      context: { customerName: "Ada", selectedItems: [] },
    });
    reply = await conversationEngine.handle(inbound("0", "c3"));
    expect(reply?.text).toContain("Reply with a number:");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "MAIN_MENU",
    }));
  });
});

describe("progress loading state", () => {
  it("calls onProgress with 'Creating invoice... ⏳' when confirming invoice", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: { customerName: "Ada", amount: 15000, description: "Haircut" },
    });
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1001", link: "https://sara.ng/i/inv-1" });

    const onProgress = vi.fn().mockResolvedValue(undefined);
    const reply = await conversationEngine.handle(inbound("yes", "m_prog_1"), { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ text: "Creating invoice... ⏳" });
    expect(mockedDispatch.createInvoice).toHaveBeenCalled();
    expect(reply?.text).toContain("Invoice INV-1001 created ✅");
  });

  it("calls onProgress with 'Creating receipt... ⏳' when confirming receipt", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_CONFIRM",
      context: { customerName: "Chidi", amount: 20000 },
    });
    mockedDispatch.createReceipt.mockResolvedValue({ number: "REC-1001", link: "https://sara.ng/r/rec-1" });

    const onProgress = vi.fn().mockResolvedValue(undefined);
    const reply = await conversationEngine.handle(inbound("yes", "m_prog_2"), { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ text: "Creating receipt... ⏳" });
    expect(mockedDispatch.createReceipt).toHaveBeenCalled();
    expect(reply?.text).toContain("Receipt REC-1001 created ✅");
  });

  it("does not call onProgress when user declines confirmation", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: { customerName: "Ada", amount: 15000 },
    });

    const onProgress = vi.fn().mockResolvedValue(undefined);
    const reply = await conversationEngine.handle(inbound("no", "m_prog_3"), { onProgress });

    expect(onProgress).not.toHaveBeenCalled();
    expect(mockedDispatch.createInvoice).not.toHaveBeenCalled();
    expect(reply?.text).toContain("Okay, cancelled.");
  });

  it("proceeds with creation if onProgress throws", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: { customerName: "Ada", amount: 15000 },
    });
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1001", link: "https://sara.ng/i/inv-1" });

    const onProgress = vi.fn().mockRejectedValue(new Error("Network error"));
    const reply = await conversationEngine.handle(inbound("yes", "m_prog_4"), { onProgress });

    expect(onProgress).toHaveBeenCalledWith({ text: "Creating invoice... ⏳" });
    expect(mockedDispatch.createInvoice).toHaveBeenCalled();
    expect(reply?.text).toContain("Invoice INV-1001 created ✅");
  });
});


