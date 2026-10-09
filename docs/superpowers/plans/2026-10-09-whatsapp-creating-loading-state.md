# WhatsApp "Creating..." Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an immediate `"Creating invoice... ⏳"` or `"Creating receipt... ⏳"` loading state via WhatsApp right after the user confirms invoice/receipt details with `"YES"`, while document generation, PDF creation, and link preview warming complete.

**Architecture:** Extend `ConversationEngine.handle(message, options?)` to accept an optional `HandleOptions` object containing an `onProgress` asynchronous callback. In `ConversationEngine.confirm()`, after validating the user's `"yes"` response and draft context, call `onProgress` with the intermediate text before executing `intentDispatcher.createInvoice` or `createReceipt`. In the WhatsApp webhook handler (`src/app/api/webhooks/whatsapp/route.ts`), supply `onProgress` to dispatch the loading message immediately via `whatsAppAdapter.send()`.

**Tech Stack:** TypeScript, Next.js App Router (Node.js runtime), Vitest, Meta WhatsApp Cloud API.

## Global Constraints
- Immediate loading message text must be exactly `"Creating invoice... ⏳"` for invoices and `"Creating receipt... ⏳"` for receipts.
- Trigger point must occur immediately upon receiving `"YES"` or `"y"` at `INVOICE_CONFIRM` and `RECEIPT_CONFIRM`, prior to the async document creation.
- If the user responds with anything other than `"yes"`/`"y"` (such as `"no"`, `"cancel"`, or unexpected text), no progress message is sent.
- Failure in the `onProgress` hook (e.g. temporary network error when posting to Meta) must be caught and logged without aborting invoice or receipt creation.
- Existing single-reply callers of `conversationEngine.handle(message)` without options must continue to work without modification.
- All existing and new tests must pass (`yarn test`).

---

### Task 1: Support `HandleOptions` and `onProgress` in `ConversationEngine`

**Files:**
- Modify: `src/backend/services/messaging/engine/index.ts`
- Test: `src/backend/services/messaging/engine/index.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type HandleOptions = {
    onProgress?: (message: OutboundMessage) => Promise<void> | void;
  };
  ```
  `conversationEngine.handle(message: InboundMessage, options?: HandleOptions): Promise<OutboundMessage | null>`
- Consumes:
  `intentDispatcher.createInvoice`, `intentDispatcher.createReceipt`, `OutboundMessage`, `InboundMessage`

- [ ] **Step 1: Write the failing tests in `src/backend/services/messaging/engine/index.test.ts`**

Add tests to `src/backend/services/messaging/engine/index.test.ts` checking:
1. `onProgress` is called with `"Creating invoice... ⏳"` when user confirms invoice creation with `"yes"`.
2. `onProgress` is called with `"Creating receipt... ⏳"` when user confirms receipt creation with `"yes"`.
3. `onProgress` is NOT called when user cancels with `"no"` at `INVOICE_CONFIRM`.
4. `onProgress` throwing an error is safely caught and does not block invoice creation.

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: FAIL (`onProgress` not called or handle does not accept second parameter)

- [ ] **Step 3: Write minimal implementation in `src/backend/services/messaging/engine/index.ts`**

1. Export `HandleOptions`:
```typescript
export type HandleOptions = {
  onProgress?: (message: OutboundMessage) => Promise<void> | void;
};
```

2. Update `handle(message: InboundMessage, options?: HandleOptions)`:
```typescript
  async handle(
    message: InboundMessage,
    options?: HandleOptions,
  ): Promise<OutboundMessage | null> {
```
Pass `options` to `this.route`:
```typescript
    const result = await this.route(
      state,
      {
        text: trimmed,
        businessId: identity.businessId,
        context,
      },
      options,
    );
```

3. Update `route(state: string, ctx: HandlerCtx, options?: HandleOptions)`:
```typescript
  private async route(
    state: string,
    ctx: HandlerCtx,
    options?: HandleOptions,
  ): Promise<HandlerResult> {
    switch (state) {
      case "INVOICE_CUSTOMER": return this.collectCustomer(ctx, "INVOICE");
      case "INVOICE_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "INVOICE");
      case "INVOICE_ITEM_QTY": return this.collectItemQty(ctx, "INVOICE");
      case "INVOICE_MORE_ITEMS": return this.collectMoreItems(ctx, "INVOICE");
      case "INVOICE_AMOUNT": return this.collectAmount(ctx, "INVOICE");
      case "INVOICE_DESC": return this.collectDesc(ctx, "INVOICE");
      case "INVOICE_CONFIRM": return this.confirm(ctx, "INVOICE", options);
      case "RECEIPT_CUSTOMER": return this.collectCustomer(ctx, "RECEIPT");
      case "RECEIPT_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "RECEIPT");
      case "RECEIPT_ITEM_QTY": return this.collectItemQty(ctx, "RECEIPT");
      case "RECEIPT_MORE_ITEMS": return this.collectMoreItems(ctx, "RECEIPT");
      case "RECEIPT_AMOUNT": return this.collectAmount(ctx, "RECEIPT");
      case "RECEIPT_DESC": return this.collectDesc(ctx, "RECEIPT");
      case "RECEIPT_CONFIRM": return this.confirm(ctx, "RECEIPT", options);
      case "SHARE_SERVICE_SELECT": return this.shareServiceSelect(ctx);
      case "MAIN_MENU":
      default: return this.mainMenu(ctx);
    }
  }
```

4. Update `confirm(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT", options?: HandleOptions)`:
```typescript
  private async confirm(
    ctx: HandlerCtx,
    kind: "INVOICE" | "RECEIPT",
    options?: HandleOptions,
  ): Promise<HandlerResult> {
    const answer = ctx.text.toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return { reply: text(`Okay, cancelled.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }
    const draft = ctx.context;
    if (!draft.customerName || draft.amount == null) {
      return { reply: text(`Something went wrong. Let's start over.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }

    if (options?.onProgress) {
      try {
        await options.onProgress(
          text(kind === "INVOICE" ? "Creating invoice... ⏳" : "Creating receipt... ⏳"),
        );
      } catch (err) {
        console.warn("[ConversationEngine] onProgress error ignored:", err);
      }
    }

    const servicesPayload = draft.selectedItems && draft.selectedItems.length > 0
...
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/engine/index.ts src/backend/services/messaging/engine/index.test.ts
git commit -m "feat(messaging): add onProgress loading state to conversation engine"
```

---

### Task 2: Wire `onProgress` in WhatsApp and Instagram Webhook Handlers

**Files:**
- Modify: `src/app/api/webhooks/whatsapp/route.ts`
- Modify: `src/app/api/webhooks/instagram/route.ts`
- Test: `src/app/api/webhooks/whatsapp/route.test.ts`

**Interfaces:**
- Consumes:
  `conversationEngine.handle(message, { onProgress })`, `whatsAppAdapter.send`, `instagramAdapter.send`

- [ ] **Step 1: Write the failing test in `src/app/api/webhooks/whatsapp/route.test.ts`**

Add a test in `src/app/api/webhooks/whatsapp/route.test.ts`:
```typescript
  it("passes onProgress and sends intermediate loading message", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockReturnValue([
      { channel: "WHATSAPP", externalId: "234800", text: "yes", messageId: "m1" },
    ]);

    mockedEngine.handle.mockImplementation(async (_msg: any, options: any) => {
      if (options?.onProgress) {
        await options.onProgress({ text: "Creating invoice... ⏳" });
      }
      return { text: "Invoice INV-1001 created ✅" };
    });

    const res = await POST(postReq({ entry: [] }));
    expect(res.status).toBe(200);
    expect(mockedAdapter.send).toHaveBeenNthCalledWith(1, "234800", { text: "Creating invoice... ⏳" });
    expect(mockedAdapter.send).toHaveBeenNthCalledWith(2, "234800", { text: "Invoice INV-1001 created ✅" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/app/api/webhooks/whatsapp/route.test.ts`
Expected: FAIL (`toHaveBeenNthCalledWith` not called twice because `onProgress` was not passed)

- [ ] **Step 3: Update `src/app/api/webhooks/whatsapp/route.ts` and `src/app/api/webhooks/instagram/route.ts`**

In `src/app/api/webhooks/whatsapp/route.ts`:
```typescript
        const reply = await conversationEngine.handle(message, {
          onProgress: async (progressMsg) => {
            console.log(`[WhatsApp Webhook] Sending progress message to ${message.externalId}: "${progressMsg.text}"`);
            await whatsAppAdapter.send(message.externalId, progressMsg);
            recordLog("outbound_sent", {
              to: message.externalId,
              replyText: progressMsg.text,
            });
          },
        });
        if (reply) {
          console.log(`[WhatsApp Webhook] Sending reply to ${message.externalId}`);
          await whatsAppAdapter.send(message.externalId, reply);
          recordLog("outbound_sent", {
            to: message.externalId,
            replyText: reply.text,
          });
        }
```

In `src/app/api/webhooks/instagram/route.ts`:
```typescript
        const reply = await conversationEngine.handle(message, {
          onProgress: async (progressMsg) => {
            await instagramAdapter.send(message.externalId, progressMsg);
          },
        });
        if (reply) await instagramAdapter.send(message.externalId, reply);
```

- [ ] **Step 4: Run webhook tests to verify they pass**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test src/app/api/webhooks/whatsapp/route.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 24 && yarn test`
Expected: All test suites PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/whatsapp/route.ts src/app/api/webhooks/whatsapp/route.test.ts src/app/api/webhooks/instagram/route.ts
git commit -m "feat(webhooks): pipe onProgress to WhatsApp and Instagram adapters"
```
