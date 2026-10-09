# Design: WhatsApp "Creating..." Loading State for Invoices and Receipts

## 1. Overview
When a business owner creates an invoice or receipt via the WhatsApp bot, finalizing the creation requires database operations, PDF generation, cloud storage upload, and metadata cache warming. This takes roughly 1.5 to 3.5 seconds. During this period, the conversation currently appears inactive.

This feature introduces an immediate intermediate loading message:
- For invoices: `"Creating invoice... ⏳"`
- For receipts: `"Creating receipt... ⏳"`

The loading state is dispatched immediately after the user confirms creation with `"YES"` / `"y"`, followed by the final document card with payment/share links once generation completes.

---

## 2. Architecture & Interfaces

### 2.1 Engine Interface (`src/backend/services/messaging/engine/index.ts`)
Add an optional `HandleOptions` argument to `ConversationEngine.handle`:

```typescript
export type HandleOptions = {
  onProgress?: (message: OutboundMessage) => Promise<void> | void;
};
```

In `ConversationEngine`:
```typescript
async handle(
  message: InboundMessage,
  options?: HandleOptions,
): Promise<OutboundMessage | null>
```

The options object is passed down through `route(state, ctx, options)` to `confirm(ctx, kind, options)`.

### 2.2 Confirmation Flow (`confirm`)
In `confirm(ctx, kind, options)`:
1. Normalize user response:
   - If not `"yes"` / `"y"`: emit cancellation response, do not call `onProgress`.
2. Check draft context integrity:
   - If missing required fields, emit error response, do not call `onProgress`.
3. Dispatch progress notification:
   ```typescript
   if (options?.onProgress) {
     try {
       await options.onProgress({
         text: kind === "INVOICE" ? "Creating invoice... ⏳" : "Creating receipt... ⏳",
       });
     } catch (err) {
       console.warn("[ConversationEngine] onProgress error ignored:", err);
     }
   }
   ```
4. Await document generation:
   - `intentDispatcher.createInvoice` or `intentDispatcher.createReceipt`.
5. Return final success message:
   - `"Invoice <number> created ✅\nPayment link: <url>..."` / `"Receipt <number> created ✅\nReceipt link: <url>..."`.
6. If document generation throws an error:
   - Catch error, return retry message: `"Couldn't create that just now — reply YES to retry or 'menu' to start over"`.

---

## 3. Webhook Route Integration

### 3.1 WhatsApp Webhook (`src/app/api/webhooks/whatsapp/route.ts`)
Provide `onProgress` to `conversationEngine.handle`:

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
```

### 3.2 Instagram Webhook (`src/app/api/webhooks/instagram/route.ts`)
Provide consistent `onProgress` handling for Instagram as well.

---

## 4. Error Handling & Edge Cases
1. **Network Failure on Progress Message:**
   - If `whatsAppAdapter.send` fails for the intermediate message, it is logged and swallowed so it does not abort the invoice/receipt creation.
2. **Cancellation or Invalid Input:**
   - If the user sends anything other than `"yes"` or `"y"` (e.g. `"no"`, `"cancel"`, or gibberish), no progress message is sent.
3. **Creation Failure:**
   - If `createInvoice` or `createReceipt` fails after the progress message is sent, the existing error handler returns the retry prompt so the user is never left in an unknown state.
4. **Duplicate Messages (Idempotency):**
   - The message is already claimed via `chatSessionService.claimMessage` before routing, preventing multiple creations and duplicate progress messages.

---

## 5. Testing Plan
1. **Engine Tests (`src/backend/services/messaging/engine/index.test.ts`):**
   - Verify `onProgress` is invoked with `"Creating invoice... ⏳"` when confirming an invoice.
   - Verify `onProgress` is invoked with `"Creating receipt... ⏳"` when confirming a receipt.
   - Verify `onProgress` is NOT invoked if the user replies `"no"` or `"cancel"`.
   - Verify error in `onProgress` does not block invoice creation.
2. **Webhook Tests (`src/app/api/webhooks/whatsapp/route.test.ts`):**
   - Verify `whatsAppAdapter.send` is called for both the progress message and the final reply when `onProgress` is fired.
