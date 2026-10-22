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
    listItemOptions: vi.fn(),
    listShareOptions: vi.fn(),
    bookingLinkText: vi.fn(),
    productLinkText: vi.fn(),
    listUnpaidInvoices: vi.fn(),
    listTodayBookings: vi.fn(),
    businessSummary: vi.fn(),
    ordersToSendOutText: vi.fn(),
  },
}));
vi.mock("@/backend/services/customer", () => ({
  customerService: { findByName: vi.fn() },
}));

import type { Customer } from "@prisma/client";
import { customerService } from "@/backend/services/customer";
import type { InboundMessage } from "../channels/types";
import { intentDispatcher, type ItemOption } from "../dispatch";
import { linkingService } from "../linking";
import { chatSessionService } from "../session";
import { conversationEngine, mainMenuText } from "./index";

const mockedSession = chatSessionService as any;
const mockedDispatch = intentDispatcher as any;
const mockedCustomers = customerService as any;

function inbound(text: string, messageId = "m1"): InboundMessage {
  return { channel: "WHATSAPP", externalId: "234800", text, messageId };
}
const IDENTITY = {
  id: "id_1", businessId: "biz_1",
  business: { sells: "SERVICES" },
  session: { id: "sess_1", state: "MAIN_MENU", context: null, lastProcessedMsgId: null, lastActiveAt: new Date() },
};

function identityFor(sells: "SERVICES" | "PRODUCTS" | "BOTH") {
  return { ...IDENTITY, business: { sells } };
}

function makeCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "cus_1",
    businessId: "biz_1",
    name: "Tolu Adeyemi",
    nameKey: "tolu adeyemi",
    phone: null,
    email: null,
    address: null,
    notes: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** The context the engine saved on its last turn. */
function lastSavedContext() {
  return mockedSession.save.mock.calls.at(-1)?.[1]?.context;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedSession.isStale.mockReturnValue(false);
  mockedSession.findIdentity.mockResolvedValue(IDENTITY);
  mockedSession.getOrCreateSession.mockResolvedValue(IDENTITY.session);
  mockedSession.claimMessage.mockResolvedValue(true);
  mockedDispatch.listItemOptions.mockResolvedValue([]);
  mockedCustomers.findByName.mockResolvedValue({ exact: null, similar: [] });
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

  it("keeps the services-only menu exactly as it is today", () =>
    expect(mainMenuText("SERVICES")).toBe("Sara 👋  Reply with a number:\n1️⃣ New invoice\n2️⃣ New receipt\n3️⃣ Share a service (booking link)\n4️⃣ Unpaid invoices\n5️⃣ Today's bookings\n6️⃣ Business summary"));

  it("gives a products business orders to send out at 5", async () => {
    const menu = mainMenuText("PRODUCTS");
    expect(menu).toContain("3️⃣ Share a link");
    expect(menu).toContain("5️⃣ Orders to send out");
    expect(menu).toContain("6️⃣ Business summary");
    expect(menu).not.toContain("Today's bookings");

    mockedSession.findIdentity.mockResolvedValue(identityFor("PRODUCTS"));
    mockedDispatch.ordersToSendOutText.mockResolvedValue(
      "📦 Orders to send out:\n1. ORD-1022 · Tolu Adeyemi · Delivery · New",
    );
    const reply = await conversationEngine.handle(inbound("5"));
    expect(mockedDispatch.ordersToSendOutText).toHaveBeenCalledWith("biz_1");
    expect(mockedDispatch.listTodayBookings).not.toHaveBeenCalled();
    expect(reply?.text).toContain("1. ORD-1022 · Tolu Adeyemi · Delivery · New");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({ state: "MAIN_MENU" }));
  });

  it("gives a business that does both seven items", async () => {
    const menu = mainMenuText("BOTH");
    expect(menu.split("\n")).toHaveLength(8);
    expect(menu).toContain("3️⃣ Share a link");
    expect(menu).toContain("5️⃣ Today's bookings");
    expect(menu).toContain("7️⃣ Orders to send out");

    mockedSession.findIdentity.mockResolvedValue(identityFor("BOTH"));
    mockedDispatch.listTodayBookings.mockResolvedValue("📅 No bookings today.");
    mockedDispatch.ordersToSendOutText.mockResolvedValue("✅ Nothing to send out.");
    expect((await conversationEngine.handle(inbound("5", "b5")))?.text).toBe("📅 No bookings today.");
    expect((await conversationEngine.handle(inbound("7", "b7")))?.text).toBe("✅ Nothing to send out.");
  });

  it("shows a merchant their own menu for unknown input and on cancel", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("PRODUCTS"));
    expect((await conversationEngine.handle(inbound("hello", "h1")))?.text).toBe(mainMenuText("PRODUCTS"));
    expect((await conversationEngine.handle(inbound("cancel", "h2")))?.text).toBe(
      `Cancelled.\n\n${mainMenuText("PRODUCTS")}`,
    );
  });
});

describe("share-a-link flow for merchants", () => {
  const SHARE_OPTIONS = [
    { kind: "SERVICE", slug: "acme-haircut", label: "Haircut — NGN 5,000 (1 hr)" },
    { kind: "PRODUCT", slug: "frontal-wig", label: "Frontal wig — NGN 45,000 (11 in stock)" },
  ];

  it("lists services and products, then returns a product link", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("BOTH"));
    mockedDispatch.listShareOptions.mockResolvedValue(SHARE_OPTIONS);
    let reply = await conversationEngine.handle(inbound("3", "a"));
    expect(mockedDispatch.listServiceOptions).not.toHaveBeenCalled();
    expect(reply?.text).toBe(
      "Which one? Reply with a number:\n1. Haircut — NGN 5,000 (1 hr)\n2. Frontal wig — NGN 45,000 (11 in stock)",
    );
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "SHARE_SERVICE_SELECT",
      context: { services: SHARE_OPTIONS },
    }));

    mockedDispatch.productLinkText.mockReturnValue(
      "Share this product link with your customer:\nhttps://app.sara.ng/products/frontal-wig",
    );
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session, state: "SHARE_SERVICE_SELECT", context: { services: SHARE_OPTIONS },
    });
    reply = await conversationEngine.handle(inbound("2", "b"));
    expect(mockedDispatch.productLinkText).toHaveBeenCalledWith("frontal-wig");
    expect(mockedDispatch.bookingLinkText).not.toHaveBeenCalled();
    expect(reply?.text).toContain("https://app.sara.ng/products/frontal-wig");
  });

  it("still gives a booking link for a service in the list", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("BOTH"));
    mockedDispatch.bookingLinkText.mockReturnValue("Share this booking link:\nhttps://app.sara.ng/services/acme-haircut");
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session, state: "SHARE_SERVICE_SELECT", context: { services: SHARE_OPTIONS },
    });
    const reply = await conversationEngine.handle(inbound("1", "c"));
    expect(mockedDispatch.bookingLinkText).toHaveBeenCalledWith(SHARE_OPTIONS[0]);
    expect(mockedDispatch.productLinkText).not.toHaveBeenCalled();
    expect(reply?.text).toContain("https://app.sara.ng/services/acme-haircut");
  });

  it("asks a shop which product when it only has products", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("PRODUCTS"));
    mockedDispatch.listShareOptions.mockResolvedValue([SHARE_OPTIONS[1]]);
    const reply = await conversationEngine.handle(inbound("3", "d"));
    expect(reply?.text).toBe("Which product? Reply with a number:\n1. Frontal wig — NGN 45,000 (11 in stock)");
  });

  it("tells a shop when it has nothing to share", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("PRODUCTS"));
    mockedDispatch.listShareOptions.mockResolvedValue([]);
    const reply = await conversationEngine.handle(inbound("3", "e"));
    expect(reply?.text).toBe(`You have no active products to share.\n\n${mainMenuText("PRODUCTS")}`);
  });
});

describe("customer matching", () => {
  const CHOICES = [
    { id: "cus_1", name: "Tolu Adeyemi", label: "Tolu Adeyemi · +2348035550142" },
    { id: "cus_2", name: "Tolu Bakare", label: "Tolu Bakare" },
  ];

  it("links the one exact name match without asking", async () => {
    mockedCustomers.findByName.mockResolvedValue({
      exact: makeCustomer({ id: "cus_1", name: "Tolu Adeyemi" }),
      similar: [makeCustomer({ id: "cus_9", name: "Tolu Adeyemi Jr", nameKey: "tolu adeyemi jr" })],
    });
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "INVOICE_CUSTOMER", context: {} });
    const reply = await conversationEngine.handle(inbound("tolu adeyemi", "n1"));
    expect(mockedCustomers.findByName).toHaveBeenCalledWith("biz_1", "tolu adeyemi");
    expect(reply?.text).toBe("Amount? e.g. 5000");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_AMOUNT",
      context: expect.objectContaining({ customerName: "Tolu Adeyemi", customerId: "cus_1" }),
    }));

    // The invoice is then created for that customer.
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1020", link: "https://app.sara.ng/invoices/x" });
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: { customerName: "Tolu Adeyemi", customerId: "cus_1", amount: 15000 },
    });
    await conversationEngine.handle(inbound("yes", "n2"));
    expect(mockedDispatch.createInvoice).toHaveBeenCalledWith("biz_1", {
      customerName: "Tolu Adeyemi",
      customerId: "cus_1",
      amount: 15000,
      description: undefined,
    });
  });

  it("asks which customer when names are similar", async () => {
    mockedCustomers.findByName.mockResolvedValue({
      exact: null,
      similar: [
        makeCustomer({ id: "cus_1", name: "Tolu Adeyemi", phone: "+2348035550142" }),
        makeCustomer({ id: "cus_2", name: "Tolu Bakare", nameKey: "tolu bakare" }),
      ],
    });
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "INVOICE_CUSTOMER", context: {} });
    const reply = await conversationEngine.handle(inbound("Tolu", "p1"));
    expect(reply?.text).toBe("Which customer?\n1. Tolu Adeyemi · +2348035550142\n2. Tolu Bakare\n3. New customer");
    expect(mockedDispatch.listItemOptions).not.toHaveBeenCalled();
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_CUSTOMER_PICK",
      context: { customerName: "Tolu", customerChoices: CHOICES },
    }));
  });

  it("links the customer the owner picks", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_CUSTOMER_PICK",
      context: { customerName: "Tolu", customerChoices: CHOICES },
    });
    const reply = await conversationEngine.handle(inbound("2", "p2"));
    expect(reply?.text).toBe("Amount paid? e.g. 5000");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({ state: "RECEIPT_AMOUNT" }));
    expect(lastSavedContext()).toMatchObject({ customerName: "Tolu Bakare", customerId: "cus_2" });
    expect(lastSavedContext().customerChoices).toBeUndefined();
  });

  it("carries on with the typed name when the owner picks New customer", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CUSTOMER_PICK",
      context: { customerName: "Tolu", customerChoices: CHOICES },
    });
    await conversationEngine.handle(inbound("3", "p3"));
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({ state: "INVOICE_AMOUNT" }));
    expect(lastSavedContext()).toMatchObject({ customerName: "Tolu" });
    expect(lastSavedContext().customerId).toBeUndefined();
  });

  it("asks again when the pick is not on the list", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CUSTOMER_PICK",
      context: { customerName: "Tolu", customerChoices: CHOICES },
    });
    const reply = await conversationEngine.handle(inbound("9", "p4"));
    expect(reply?.text).toBe(
      "Please reply with a number from the list:\n1. Tolu Adeyemi · +2348035550142\n2. Tolu Bakare\n3. New customer",
    );
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_CUSTOMER_PICK",
      context: { customerName: "Tolu", customerChoices: CHOICES },
    }));
  });

  it("carries on with a new name when nobody matches", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "RECEIPT_CUSTOMER", context: {} });
    const reply = await conversationEngine.handle(inbound("Kemi", "p5"));
    expect(reply?.text).toBe("Amount paid? e.g. 5000");
    expect(lastSavedContext()).toMatchObject({ customerName: "Kemi" });
    expect(lastSavedContext().customerId).toBeUndefined();
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
  const MOCK_SERVICES: ItemOption[] = [
    {
      kind: "SERVICE",
      id: "srv_1",
      slug: "box-braids",
      name: "Box Braids",
      price: 15000,
      currency: "NGN",
      label: "Box Braids — NGN 15,000 (2 hr)",
    },
    {
      kind: "SERVICE",
      id: "srv_2",
      slug: "wash-blow-dry",
      name: "Wash & Blow Dry",
      price: 5000,
      currency: "NGN",
      label: "Wash & Blow Dry — NGN 5,000 (45 min)",
    },
  ];

  it("handles service selection with count and creates invoice with line items", async () => {
    mockedDispatch.listItemOptions.mockResolvedValue(MOCK_SERVICES);
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
      lines: [
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
      lines: [
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
    mockedDispatch.listItemOptions.mockResolvedValue([]);
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
    mockedDispatch.listItemOptions.mockResolvedValue([]);
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

describe("product item selection", () => {
  const ITEMS: ItemOption[] = [
    {
      kind: "SERVICE",
      id: "srv_1",
      slug: "box-braids",
      name: "Box Braids",
      price: 15000,
      currency: "NGN",
      label: "Box Braids — NGN 15,000 (2 hr)",
    },
    {
      kind: "PRODUCT",
      id: "opt_20",
      productOptionId: "opt_20",
      slug: "frontal-wig",
      name: 'Frontal wig — 20"',
      price: 45000,
      currency: "NGN",
      label: 'Frontal wig — 20" — NGN 45,000 (11 in stock)',
    },
  ];
  const WIG_LINE = { productOptionId: "opt_20", name: 'Frontal wig — 20"', quantity: 2, unitPrice: 45000, total: 90000 };

  it("offers product options in the invoice item list", async () => {
    mockedSession.findIdentity.mockResolvedValue(identityFor("BOTH"));
    mockedDispatch.listItemOptions.mockResolvedValue(ITEMS);
    mockedSession.getOrCreateSession.mockResolvedValue({ ...IDENTITY.session, state: "INVOICE_CUSTOMER", context: {} });
    let reply = await conversationEngine.handle(inbound("Ada", "w1"));
    expect(reply?.text).toBe(
      "Add an item, or enter a custom amount:\n" +
        "1. Box Braids — NGN 15,000 (2 hr)\n" +
        '2. Frontal wig — 20" — NGN 45,000 (11 in stock)\n\n' +
        "Reply with an item number, or enter an amount (e.g. 5000)",
    );

    // Pick the wig.
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_OR_AMOUNT",
      context: { customerName: "Ada", availableServices: ITEMS, selectedItems: [] },
    });
    reply = await conversationEngine.handle(inbound("2", "w2"));
    expect(reply?.text).toBe('How many Frontal wig — 20"? (e.g. 1 or 2)');
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_ITEM_QTY",
      context: expect.objectContaining({ pendingServiceId: "opt_20" }),
    }));

    // Two of them.
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_ITEM_QTY",
      context: { customerName: "Ada", availableServices: ITEMS, pendingServiceId: "opt_20", selectedItems: [] },
    });
    reply = await conversationEngine.handle(inbound("2", "w3"));
    expect(reply?.text).toContain('Added: 2 × Frontal wig — 20" (NGN 90,000)');
    expect(reply?.text).toContain("Add another item?");
    expect(reply?.text).toContain("Reply with an item number to add more, or DONE to continue.");
    expect(mockedSession.save).toHaveBeenCalledWith("sess_1", expect.objectContaining({
      state: "INVOICE_MORE_ITEMS",
      context: expect.objectContaining({ amount: 90000, selectedItems: [WIG_LINE] }),
    }));

    // Confirm: the invoice gets a product line.
    mockedDispatch.createInvoice.mockResolvedValue({ number: "INV-1021", link: "https://app.sara.ng/invoices/y" });
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "INVOICE_CONFIRM",
      context: { customerName: "Ada", availableServices: ITEMS, amount: 90000, selectedItems: [WIG_LINE] },
    });
    await conversationEngine.handle(inbound("yes", "w4"));
    expect(mockedDispatch.createInvoice).toHaveBeenCalledWith("biz_1", {
      customerName: "Ada",
      amount: 90000,
      description: undefined,
      lines: [
        { productOptionId: "opt_20", quantity: 2, unitPrice: 45000, total: 90000, description: 'Frontal wig — 20"' },
      ],
    });
  });

  it("adds to the quantity when the same option is picked again", async () => {
    mockedSession.getOrCreateSession.mockResolvedValue({
      ...IDENTITY.session,
      state: "RECEIPT_ITEM_QTY",
      context: { customerName: "Ada", availableServices: ITEMS, pendingServiceId: "opt_20", selectedItems: [WIG_LINE] },
    });
    await conversationEngine.handle(inbound("1", "w5"));
    expect(lastSavedContext()).toMatchObject({
      amount: 135000,
      selectedItems: [{ ...WIG_LINE, quantity: 3, total: 135000 }],
    });
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


