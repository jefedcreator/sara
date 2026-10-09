# WhatsApp Bot Service Items Selection Design

## Overview
Enable business owners to add services (with quantities / counts) when creating invoices and receipts through the WhatsApp bot, while preserving the optional fast path for entering a custom amount. This mirrors the behavior of the web application's `DocumentModal`.

## User Journey & Conversational Flow

### 1. Initiation & Customer Collection
- Owner sends `1` (New invoice) or `2` (New receipt) from the main menu.
- Bot responds: `Customer's name?`
- State: `INVOICE_CUSTOMER` / `RECEIPT_CUSTOMER`.
- Owner replies with customer's name (e.g. `Ada`).

### 2. Service Selection vs. Custom Amount Entry
The bot queries the business's active services.

#### Case A: No Active Services
If the business has no active services, skip service selection:
- Bot responds: `Amount? e.g. 5000` (or `Amount paid? e.g. 5000` for receipts).
- State: `INVOICE_AMOUNT` / `RECEIPT_AMOUNT`.

#### Case B: Active Services Available
If the business has active services, present the service catalog along with the option to type a custom amount:
- Bot responds:
  ```text
  Add a service, or enter a custom amount:
  1. Box Braids · NGN 15,000
  2. Wash & Blow Dry · NGN 5,000

  Reply with a service number, or enter an amount (e.g. 5000)
  ```
- State: `INVOICE_ITEM_OR_AMOUNT` / `RECEIPT_ITEM_OR_AMOUNT`.
- Context stores `customerName`, `availableServices`, and an empty `selectedItems: []`.

### 3. Handling Item Selection vs Custom Amount
When in `INVOICE_ITEM_OR_AMOUNT` / `RECEIPT_ITEM_OR_AMOUNT`:
- **If the input is an integer corresponding to an index in `availableServices` (e.g. `1` or `2`):**
  - Bot stores `pendingServiceId = service.id`.
  - Bot responds: `How many ${service.name}? (e.g. 1 or 2)`
  - Transition to: `INVOICE_ITEM_QTY` / `RECEIPT_ITEM_QTY`.
- **If the input is a valid amount (e.g. `5000`):**
  - Owner bypassed service catalog to enter custom amount.
  - Bot stores `amount = parsedAmount`.
  - Bot responds: `What's it for? (or 'skip')`
  - Transition to: `INVOICE_DESC` / `RECEIPT_DESC`.
- **Otherwise:**
  - Bot re-prompts: `Please reply with a service number (1-${availableServices.length}) or enter an amount (e.g. 5000)`.

### 4. Quantity Entry
When in `INVOICE_ITEM_QTY` / `RECEIPT_ITEM_QTY`:
- Parse count `qty`: positive integer (>= 1).
- If invalid integer, prompt: `Please enter a valid count (e.g. 1 or 2):`.
- If valid:
  - Calculate `itemTotal = service.price * qty`.
  - Append to `selectedItems`:
    ```ts
    {
      serviceId: service.id,
      name: service.name,
      quantity: qty,
      unitPrice: service.price,
      total: itemTotal,
    }
    ```
  - Compute total across all `selectedItems`.
  - Bot responds:
    ```text
    Added: ${qty} × ${service.name} (${formatMoney(itemTotal, currency)})
    Total so far: ${formatMoney(total, currency)}

    Add another service?
    1. Box Braids · NGN 15,000
    2. Wash & Blow Dry · NGN 5,000

    Reply with a service number to add more, or DONE to continue.
    ```
  - Transition to: `INVOICE_MORE_ITEMS` / `RECEIPT_MORE_ITEMS`.

### 5. Multi-Item Loop (`INVOICE_MORE_ITEMS` / `RECEIPT_MORE_ITEMS`)
- **If input is `DONE` (case-insensitive):**
  - Total is finalized as `amount = sum(selectedItems.total)`.
  - Bot responds: `Any notes or description? (or 'skip')`
  - Transition to: `INVOICE_DESC` / `RECEIPT_DESC`.
- **If input is a valid service index (e.g. `2`):**
  - Bot sets `pendingServiceId = chosenService.id`.
  - Bot responds: `How many ${chosenService.name}? (e.g. 1 or 2)`
  - Transition to: `INVOICE_ITEM_QTY` / `RECEIPT_ITEM_QTY`.
- **Otherwise:**
  - Bot responds: `Reply with a service number to add more, or DONE to continue.`

### 6. Notes / Description
When in `INVOICE_DESC` / `RECEIPT_DESC`:
- Captures optional description (or undefined if `skip`).
- Builds preview summary:
  - **If services were selected:**
    ```text
    New invoice: ${customerName}
    • 2 × Box Braids — NGN 30,000
    • 1 × Wash & Blow Dry — NGN 5,000
    Total: NGN 35,000
    ${description ? `Notes: ${description}` : ""}

    Reply YES to create, NO to cancel
    ```
  - **If custom amount was entered:**
    ```text
    New invoice: ${customerName} · ${formatMoney(amount, currency)}${description ? ` · ${description}` : ""}

    Reply YES to create, NO to cancel
    ```
- Transition to: `INVOICE_CONFIRM` / `RECEIPT_CONFIRM`.

### 7. Confirmation & Creation
When in `INVOICE_CONFIRM` / `RECEIPT_CONFIRM`:
- If `YES` / `Y`:
  - Calls `intentDispatcher.createInvoice` or `createReceipt` with:
    ```ts
    {
      customerName: draft.customerName,
      amount: draft.amount,
      description: draft.description,
      services: draft.selectedItems?.map(item => ({
        serviceId: item.serviceId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total,
        description: item.name,
      })),
    }
    ```
  - `invoiceService.create` and `receiptService.create` save line items in the database (`InvoiceService` / `ReceiptService` models).
  - Responds with creation confirmation and link preview.
  - Transition to: `MAIN_MENU`.
- If `NO` / other:
  - Responds: `Okay, cancelled.\n\n${MAIN_MENU}`
  - Transition to: `MAIN_MENU`.

---

## Architecture & Data Contracts

### 1. `intentDispatcher` (`src/backend/services/messaging/dispatch/index.ts`)
- Update `WriteDraft`:
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
  ```
- Add `listFullServiceOptions(businessId: string)`:
  ```ts
  export type FullServiceOption = {
    id: string;
    slug: string;
    name: string;
    price: number;
    currency: string;
    label: string;
  };
  ```
  Returns active services ordered by `createdAt: "asc"`.
- Pass `draft.services` to `invoiceService.create` and `receiptService.create`.

### 2. `ConversationEngine` (`src/backend/services/messaging/engine/index.ts`)
- Update `Draft` type:
  ```ts
  export type SelectedServiceItem = {
    serviceId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  };

  export type Draft = {
    customerName?: string;
    amount?: number;
    description?: string;
    availableServices?: FullServiceOption[];
    selectedItems?: SelectedServiceItem[];
    pendingServiceId?: string;
  };
  ```
- Implement states:
  - `INVOICE_ITEM_OR_AMOUNT` / `RECEIPT_ITEM_OR_AMOUNT`
  - `INVOICE_ITEM_QTY` / `RECEIPT_ITEM_QTY`
  - `INVOICE_MORE_ITEMS` / `RECEIPT_MORE_ITEMS`

### 3. Error Handling & Edge Cases
- **Non-numeric quantities:** Re-prompt cleanly (`Please enter a valid count (e.g. 1 or 2):`).
- **Numbers greater than service list:** Treated as custom amount if valid amount, or re-prompted.
- **Cancel or Menu:** The global handlers for `cancel` and `menu` remain effective at every state.
- **Stale Sessions:** Session staleness checks reset to `MAIN_MENU` automatically.

---

## Testing Strategy
- Unit tests in `src/backend/services/messaging/engine/index.test.ts`:
  1. Service selection with single service and count.
  2. Multi-service selection with `DONE`.
  3. Direct custom amount fallback bypassing services.
  4. Flow when business has zero active services (falls back to amount directly).
  5. Invalid quantity retry handling.
- Verify `createInvoice` and `createReceipt` are called with the exact `services` payloads.
- Run complete test suite (`yarn test`).
