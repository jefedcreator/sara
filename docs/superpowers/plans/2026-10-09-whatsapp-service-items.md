# WhatsApp Bot Service Items Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable business owners to add services with quantities/counts when creating invoices or receipts via the WhatsApp bot, while preserving the direct custom amount fallback.

**Architecture:** Extend `intentDispatcher` to expose `listFullServiceOptions` and accept `services` on `WriteDraft`. Enhance `ConversationEngine` with states for service selection (`ITEM_OR_AMOUNT`), count collection (`ITEM_QTY`), and multi-item loop (`MORE_ITEMS`) so that documents can be created with line items matching the web modal behavior.

**Tech Stack:** TypeScript, Prisma, Vitest, WhatsApp Messaging Service.

## Global Constraints
- Preserve existing custom amount fast path: typing a valid amount when prompted bypasses service selection.
- If a business has zero active services, seamlessly fall back directly to the custom amount prompt.
- Global commands `menu`, `0`, and `cancel` must remain functional at every step of the conversation.
- All test suites must pass (`yarn test`).

---

### Task 1: Extend `intentDispatcher` to Support Service Line Items

**Files:**
- Modify: `src/backend/services/messaging/dispatch/index.ts`
- Test: `src/backend/services/messaging/dispatch/index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WriteServiceDraft = {
    serviceId: string;
    quantity: number;
    unitPrice: number;
    total: number;
    description?: string | null;
  };

  export type WriteDraft = {
    customerName: string;
    amount: number;
    description?: string;
    services?: WriteServiceDraft[];
  };

  export type FullServiceOption = {
    id: string;
    slug: string;
    name: string;
    price: number;
    currency: string;
    label: string;
  };

  intentDispatcher.listFullServiceOptions(businessId: string): Promise<FullServiceOption[]>;
  ```

- [ ] **Step 1: Write the failing tests for `intentDispatcher` service options and line items**

In `src/backend/services/messaging/dispatch/index.test.ts`, add:
```ts
describe("listFullServiceOptions", () => {
  it("returns active services with IDs, names, prices and formatted labels", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { id: "srv_1", slug: "box-braids", name: "Box Braids", price: 15000, duration: 120, bookingMode: "SLOT" },
    ]);
    const options = await intentDispatcher.listFullServiceOptions("biz_1");
    expect(options).toEqual([
      {
        id: "srv_1",
        slug: "box-braids",
        name: "Box Braids",
        price: 15000,
        currency: "NGN",
        label: "Box Braids — NGN 15,000 (2 hr)",
      },
    ]);
  });
});

describe("createInvoice with services", () => {
  it("forwards line items to invoiceService.create", async () => {
    (invoiceService.create as any).mockResolvedValue({
      invoiceNumber: "INV-1013", slug: "acme-inv-1013", publicId: "pub_1013",
    });
    await intentDispatcher.createInvoice("biz_1", {
      customerName: "Ada",
      amount: 30000,
      description: "Braids",
      services: [
        { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
      ],
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          { serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" },
        ],
      }),
    );
  });
});

describe("createReceipt with services", () => {
  it("forwards line items to receiptService.create", async () => {
    (receiptService.create as any).mockResolvedValue({
      receiptNumber: "RCP-1008", slug: "acme-rcp-1008", publicId: "pub_1008",
    });
    await intentDispatcher.createReceipt("biz_1", {
      customerName: "Ada",
      amount: 15000,
      services: [
        { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
      ],
    });
    expect(receiptService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        services: [
          { serviceId: "srv_1", quantity: 1, unitPrice: 15000, total: 15000, description: "Box Braids" },
        ],
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: FAIL with `listFullServiceOptions is not a function` or missing `services` forwarding.

- [ ] **Step 3: Implement `listFullServiceOptions` and pass `services` in `intentDispatcher`**

In `src/backend/services/messaging/dispatch/index.ts`:
```ts
export type WriteServiceDraft = {
  serviceId: string;
  quantity: number;
  unitPrice: number;
  total: number;
  description?: string | null;
};

export type WriteDraft = {
  customerName: string;
  amount: number;
  description?: string;
  services?: WriteServiceDraft[];
};

export type FullServiceOption = {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  label: string;
};
```
In `createInvoice`:
```ts
  async createInvoice(businessId: string, draft: WriteDraft): Promise<WriteResult> {
    const currency = await this.currencyFor(businessId);
    const invoice = await invoiceService.create({
      businessId,
      name: draft.customerName,
      status: "SENT",
      currency,
      subtotal: draft.amount,
      taxAmount: 0,
      discount: 0,
      total: draft.amount,
      amountPaid: 0,
      sentAt: new Date(),
      notes: draft.description ?? null,
      services: draft.services,
    });
    return {
      number: invoice.invoiceNumber,
      link: publicLink("invoice", invoice.publicId),
    };
  }
```
In `createReceipt`:
```ts
  async createReceipt(businessId: string, draft: WriteDraft): Promise<WriteResult> {
    const currency = await this.currencyFor(businessId);
    const receipt = await receiptService.create({
      businessId,
      name: draft.customerName,
      currency,
      subtotal: draft.amount,
      taxAmount: 0,
      discount: 0,
      total: draft.amount,
      amountPaid: draft.amount,
      notes: draft.description ?? null,
      services: draft.services,
    });
    return {
      number: receipt.receiptNumber,
      link: publicLink("receipt", receipt.publicId),
    };
  }
```
Add `listFullServiceOptions`:
```ts
  async listFullServiceOptions(businessId: string): Promise<FullServiceOption[]> {
    const currency = await this.currencyFor(businessId);
    const services = await db.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { id: true, slug: true, name: true, price: true, duration: true, bookingMode: true },
    });
    return services.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      price: Number(s.price),
      currency,
      label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode }),
    }));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/dispatch/index.ts src/backend/services/messaging/dispatch/index.test.ts
git commit -m "feat(messaging): support full service options and line items in dispatch"
```

---

### Task 2: Implement Conversational Flow for Services & Counts in `ConversationEngine`

**Files:**
- Modify: `src/backend/services/messaging/engine/index.ts`
- Test: `src/backend/services/messaging/engine/index.test.ts`

**Interfaces:**
- Consumes:
  - `intentDispatcher.listFullServiceOptions(businessId)`
  - `intentDispatcher.createInvoice(businessId, draft)`
  - `intentDispatcher.createReceipt(businessId, draft)`
- Produces:
  - New conversation states:
    - `INVOICE_ITEM_OR_AMOUNT` / `RECEIPT_ITEM_OR_AMOUNT`
    - `INVOICE_ITEM_QTY` / `RECEIPT_ITEM_QTY`
    - `INVOICE_MORE_ITEMS` / `RECEIPT_MORE_ITEMS`
  - Multi-item service collection and confirmation breakdown.

- [ ] **Step 1: Write the failing tests for service selection flow in `ConversationEngine`**

In `src/backend/services/messaging/engine/index.test.ts`:
Add test scenarios:
1. `handles service selection with count and creates invoice with line items`:
   - Start at `INVOICE_CUSTOMER` with name "Ada".
   - `listFullServiceOptions` returns 2 services (1: Box Braids NGN 15000, 2: Wash NGN 5000).
   - Bot replies with service list and prompt. State: `INVOICE_ITEM_OR_AMOUNT`.
   - User replies "1". Bot replies `How many Box Braids? (e.g. 1 or 2)`. State: `INVOICE_ITEM_QTY`.
   - User replies "2". Bot replies `Added: 2 × Box Braids (NGN 30,000)... Add another service? ... or DONE`. State: `INVOICE_MORE_ITEMS`.
   - User replies "done". Bot replies `Any notes or description? (or 'skip')`. State: `INVOICE_DESC`.
   - User replies "skip". Bot replies summary with bullet points: `• 2 × Box Braids — NGN 30,000... Total: NGN 30,000`. State: `INVOICE_CONFIRM`.
   - User replies "yes". `createInvoice` called with `services: [{ serviceId: "srv_1", quantity: 2, unitPrice: 15000, total: 30000, description: "Box Braids" }]`.
2. `supports adding multiple distinct services`:
   - After adding service 1 (qty 2), user replies "2" to add Wash.
   - Bot asks `How many Wash & Blow Dry?`.
   - User replies "1".
   - User replies "done".
   - Bot summary includes both items and total NGN 35,000.
3. `allows custom amount fallback directly from ITEM_OR_AMOUNT`:
   - In `INVOICE_ITEM_OR_AMOUNT`, user types "5000".
   - Bot transitions to `INVOICE_DESC` with `amount: 5000` and no services.
4. `skips service prompt when business has no active services`:
   - `listFullServiceOptions` returns `[]`.
   - Entering customer name transitions directly to `INVOICE_AMOUNT` asking `Amount? e.g. 5000`.
5. `re-prompts on invalid quantity`:
   - In `INVOICE_ITEM_QTY`, user types "zero" or "0".
   - Bot re-prompts with `Please enter a valid count (e.g. 1 or 2):`.

- [ ] **Step 2: Run test to verify failure**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the service selection and count handlers in `ConversationEngine`**

In `src/backend/services/messaging/engine/index.ts`:
1. Define types:
```ts
export type SelectedServiceItem = {
  serviceId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type Draft = {
  customerName?: string;
  amount?: number;
  description?: string;
  services?: ServiceOption[];
  availableServices?: FullServiceOption[];
  selectedItems?: SelectedServiceItem[];
  pendingServiceId?: string;
};
```
2. Update `route(state, ctx)`:
```ts
      case "INVOICE_CUSTOMER": return this.collectCustomer(ctx, "INVOICE");
      case "INVOICE_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "INVOICE");
      case "INVOICE_ITEM_QTY": return this.collectItemQty(ctx, "INVOICE");
      case "INVOICE_MORE_ITEMS": return this.collectMoreItems(ctx, "INVOICE");
      case "INVOICE_AMOUNT": return this.collectAmount(ctx, "INVOICE");
      case "INVOICE_DESC": return this.collectDesc(ctx, "INVOICE");
      case "INVOICE_CONFIRM": return this.confirm(ctx, "INVOICE");
      case "RECEIPT_CUSTOMER": return this.collectCustomer(ctx, "RECEIPT");
      case "RECEIPT_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "RECEIPT");
      case "RECEIPT_ITEM_QTY": return this.collectItemQty(ctx, "RECEIPT");
      case "RECEIPT_MORE_ITEMS": return this.collectMoreItems(ctx, "RECEIPT");
      case "RECEIPT_AMOUNT": return this.collectAmount(ctx, "RECEIPT");
      case "RECEIPT_DESC": return this.collectDesc(ctx, "RECEIPT");
      case "RECEIPT_CONFIRM": return this.confirm(ctx, "RECEIPT");
```
3. Update `collectCustomer`:
```ts
  private async collectCustomer(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): Promise<HandlerResult> {
    if (ctx.text.length === 0) {
      return { reply: text("Customer's name?"), nextState: `${kind}_CUSTOMER`, context: ctx.context };
    }
    const customerName = ctx.text;
    const availableServices = await intentDispatcher.listFullServiceOptions(ctx.businessId);
    if (availableServices.length === 0) {
      return {
        reply: text(kind === "INVOICE" ? "Amount? e.g. 5000" : "Amount paid? e.g. 5000"),
        nextState: `${kind}_AMOUNT`,
        context: { ...ctx.context, customerName },
      };
    }
    const list = availableServices.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: text(
        `Add a service, or enter a custom amount:\n${list}\n\n` +
          `Reply with a service number, or enter an amount (e.g. 5000)`,
      ),
      nextState: `${kind}_ITEM_OR_AMOUNT`,
      context: { ...ctx.context, customerName, availableServices, selectedItems: [] },
    };
  }
```
4. Implement `collectItemOrAmount`:
```ts
  private collectItemOrAmount(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const services = ctx.context.availableServices ?? [];
    const index = parseInt(ctx.text, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < services.length) {
      const chosen = services[index]!;
      return {
        reply: text(`How many ${chosen.name}? (e.g. 1 or 2)`),
        nextState: `${kind}_ITEM_QTY`,
        context: { ...ctx.context, pendingServiceId: chosen.id },
      };
    }
    const amount = parseAmount(ctx.text);
    if (amount !== null) {
      return {
        reply: text("What's it for? (or 'skip')"),
        nextState: `${kind}_DESC`,
        context: { ...ctx.context, amount, selectedItems: [] },
      };
    }
    const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: text(`Please reply with a service number (1-${services.length}) or enter an amount (e.g. 5000):\n${list}`),
      nextState: `${kind}_ITEM_OR_AMOUNT`,
      context: ctx.context,
    };
  }
```
5. Implement `collectItemQty`:
```ts
  private collectItemQty(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const qty = parseInt(ctx.text, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      return {
        reply: text("Please enter a valid count (e.g. 1 or 2):"),
        nextState: `${kind}_ITEM_QTY`,
        context: ctx.context,
      };
    }
    const services = ctx.context.availableServices ?? [];
    const service = services.find((s) => s.id === ctx.context.pendingServiceId);
    if (!service) {
      return {
        reply: text("Service not found. Let's enter an amount: e.g. 5000"),
        nextState: `${kind}_AMOUNT`,
        context: { ...ctx.context, pendingServiceId: undefined },
      };
    }
    const itemTotal = service.price * qty;
    const existing = ctx.context.selectedItems ?? [];
    const selectedItems = [
      ...existing,
      {
        serviceId: service.id,
        name: service.name,
        quantity: qty,
        unitPrice: service.price,
        total: itemTotal,
      },
    ];
    const total = selectedItems.reduce((acc, it) => acc + it.total, 0);
    const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: text(
        `Added: ${qty} × ${service.name} (${formatMoney(itemTotal, service.currency)})\n` +
          `Total so far: ${formatMoney(total, service.currency)}\n\n` +
          `Add another service?\n${list}\n\n` +
          `Reply with a service number to add more, or DONE to continue.`,
      ),
      nextState: `${kind}_MORE_ITEMS`,
      context: { ...ctx.context, selectedItems, amount: total, pendingServiceId: undefined },
    };
  }
```
6. Implement `collectMoreItems`:
```ts
  private collectMoreItems(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const lower = ctx.text.toLowerCase();
    if (lower === "done") {
      return {
        reply: text("What's it for? (or 'skip')"),
        nextState: `${kind}_DESC`,
        context: ctx.context,
      };
    }
    const services = ctx.context.availableServices ?? [];
    const index = parseInt(ctx.text, 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < services.length) {
      const chosen = services[index]!;
      return {
        reply: text(`How many ${chosen.name}? (e.g. 1 or 2)`),
        nextState: `${kind}_ITEM_QTY`,
        context: { ...ctx.context, pendingServiceId: chosen.id },
      };
    }
    return {
      reply: text("Reply with a service number to add more, or DONE to continue."),
      nextState: `${kind}_MORE_ITEMS`,
      context: ctx.context,
    };
  }
```
7. Update `collectDesc` to format itemized lines:
```ts
  private collectDesc(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const description = ctx.text.toLowerCase() === "skip" ? undefined : ctx.text;
    const merged: Draft = { ...ctx.context, description };
    const label = kind === "INVOICE" ? "invoice" : "receipt";
    const selected = merged.selectedItems ?? [];
    let summary: string;
    if (selected.length > 0) {
      const lines = selected.map((it) => `• ${it.quantity} × ${it.name} — ${formatMoney(it.total, "")}`);
      summary =
        `New ${label}: ${merged.customerName}\n` +
        `${lines.join("\n")}\n` +
        `Total: ${formatMoney(merged.amount ?? 0, "")}` +
        (description ? `\nNotes: ${description}` : "");
    } else {
      summary =
        `New ${label}: ${merged.customerName} · ${formatMoney(merged.amount ?? 0, "")}` +
        (description ? ` · ${description}` : "");
    }
    return {
      reply: text(`${summary}\n\nReply YES to create, NO to cancel`),
      nextState: `${kind}_CONFIRM`,
      context: merged,
    };
  }
```
8. Update `confirm` to pass `services`:
```ts
        const servicesPayload = draft.selectedItems?.map((it) => ({
          serviceId: it.serviceId,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
          description: it.name,
        }));
        if (kind === "INVOICE") {
          const res = await intentDispatcher.createInvoice(ctx.businessId, {
            customerName: draft.customerName,
            amount: draft.amount,
            description: draft.description,
            services: servicesPayload,
          });
          ...
        } else {
          const res = await intentDispatcher.createReceipt(ctx.businessId, {
            customerName: draft.customerName,
            amount: draft.amount,
            description: draft.description,
            services: servicesPayload,
          });
          ...
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run full test suite**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test`
Expected: All test suites PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/messaging/engine/index.ts src/backend/services/messaging/engine/index.test.ts
git commit -m "feat(messaging): add service item selection with count to WhatsApp invoice/receipt creation"
```
