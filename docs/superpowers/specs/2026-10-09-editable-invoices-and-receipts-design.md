# Editable Unpaid Invoices and Standalone Receipts Design

## Overview
Enable business owners to edit the details of unpaid invoices and standalone manual receipts directly on the Sara web application. When edited, financial totals and line items are recomputed, customer documents (PDFs) are regenerated and updated on Cloudinary, and updated email notifications are dispatched to customers.

---

## 1. Business Logic & Eligibility Rules

### 1.1 Invoices
* **Editable Statuses:**
  * Invoices with status `DRAFT`, `SENT`, or `OVERDUE` where `amountPaid === 0`.
* **Locked Statuses:**
  * `PAID`: Invoices that have been paid in full cannot be modified.
  * `PARTIALLY_PAID`: Invoices that have already received partial payments are locked against detail/item edits to preserve financial integrity and transaction history.
* **Status Transitions During Edit:**
  * **Draft:** The owner can choose **"Save changes"** (keeps status as `DRAFT`) or **"Save & send"** (promotes status to `SENT` and triggers customer email).
  * **Sent / Overdue:** The owner clicks **"Save changes"** (retains current status, regenerates PDF, and re-sends the updated invoice email).

### 1.2 Receipts
* **Editable Receipts:**
  * Only **standalone manual receipts** created directly by the business owner (payment method `CASH` or `BANK_TRANSFER`).
* **Locked Receipts:**
  * **Invoice-Linked Receipts:** Receipts created when recording payment against an invoice (`payment.invoiceId !== null`) cannot be edited directly; their amounts reflect specific recorded invoice transactions.
  * **Automated Booking Receipts:** Receipts generated automatically from online customer payments (e.g. Paystack / booking checkouts) cannot be edited.
* **Notification on Edit:**
  * When a standalone manual receipt is edited, the PDF is regenerated on Cloudinary, and if the customer has an email address, an updated receipt email is re-sent.

---

## 2. API & Backend Architecture

### 2.1 Invoices (`PUT /api/invoices/[slug]`)
* **Endpoint:** `PUT /api/invoices/[slug]`
* **Validation:** Existing `updateInvoiceValidatorSchema` validates fields:
  * `name`, `email`, `phone`, `status`, `currency`, `subtotal`, `taxAmount`, `discount`, `total`, `dueAt`, `notes`, `services`.
* **Backend Guard Updates:**
  * Reject editing if `invoice.status === "PAID"`.
  * Reject editing non-payment fields if `invoice.status === "PARTIALLY_PAID"`.
* **Side Effects:**
  1. Update database record via Prisma.
  2. Regenerate PDF with `generateInvoicePdf` and upload to Cloudinary at `sara/businesses/${businessId}/invoices/${invoice.id}`.
  3. If `finalInvoice.status === "SENT" || finalInvoice.status === "OVERDUE"`, call `emailInvoice(finalInvoice, business)` if `clientEmail` is set.

### 2.2 Receipts (`PUT /api/receipts/[slug]`)
* **Endpoint:** `PUT /api/receipts/[slug]`
* **Validation:** Existing `updateReceiptValidatorSchema` validates fields:
  * `name`, `email`, `phone`, `currency`, `subtotal`, `taxAmount`, `discount`, `total`, `amountPaid`, `paymentMethod`, `notes`, `services`.
* **Backend Guard Updates:**
  * Check if receipt is linked to an invoice payment (`existingReceipt.payment?.invoiceId !== null` or automated transaction). If so, reject with `BadRequestException("Receipts linked to invoice payments cannot be edited directly")`.
* **Side Effects:**
  1. Update database record via Prisma.
  2. Regenerate PDF with `generateReceiptPdf` and upload to Cloudinary.
  3. Call `emailReceipt(updatedReceipt, business)` if `updatedReceipt.email` is present.

---

## 3. Frontend Architecture

### 3.1 Form Adapter (`src/utils/documents.ts`)
Add a helper function to convert existing `InvoiceDto` or `ReceiptDto` into `DocumentFormSchema`:
```ts
export function documentToFormValues(
  doc: InvoiceDto | ReceiptDto,
  kind: "invoice" | "receipt"
): DocumentFormSchema
```
* **Mapping Logic:**
  * **Name / Email / Phone:** Mapped from `clientName` / `name`, `clientEmail` / `email`, `clientPhone` / `phone`.
  * **Line Items vs Custom Amount:**
    * If `doc.services` contains items, map each to `{ serviceId: s.serviceId, quantity: String(s.quantity), unitPrice: String(Number(s.unitPrice)) }` and set `mode: "services"`.
    * If `doc.services` is empty, set `mode: "amount"`, `amount: String(Number(doc.subtotal))`, and `description: doc.notes ?? ""`.
  * **Taxes & Discounts:** Map `taxAmount` and `discount` to numeric strings if $> 0$, otherwise `""`.
  * **Due Date:** For invoices, format `dueAt` to `YYYY-MM-DD`.
  * **Payment Method:** For receipts, map `paymentMethod ?? "CASH"`.
  * **Notes:** Map `doc.notes ?? ""`.

### 3.2 API Client & Mutation Hooks
* **`src/utils/api.ts`:**
  * Add `api.invoices.update(slug: string, values: InvoiceUpdateInput): Promise<InvoiceDto>`
  * Add `api.receipts.update(slug: string, values: ReceiptUpdateInput): Promise<ReceiptDto>`
* **`src/hooks/mutations/use-document-mutations.ts`:**
  * Add `useUpdateInvoiceMutation()`
  * Add `useUpdateReceiptMutation()`
  * Invalidate query keys `invoiceKeys.all`, `receiptKeys.all`, and `dashboardKeys.all` upon mutation success.

### 3.3 Enhanced Document Composer (`useDocumentComposer`)
Extend `useDocumentComposer` to support both creation and editing:
* `start(doc?: InvoiceDto | ReceiptDto)`:
  * When `doc` is passed, set `editingDoc: doc`, initialize session key, and set `open: true`.
  * When called with no arguments, initialize an empty form as before.
* `submit(values, { draft })`:
  * If `editingDoc` is present:
    * Call `updateInvoice` or `updateReceipt` with mapped payload.
    * On success, close modal and trigger confirmation callback or notice.
  * If creating:
    * Call `createInvoice` or `createReceipt` as before.

### 3.4 Unified `DocumentModal` Component
Enhance `DocumentModal` in `src/components/documents/document-modal.tsx`:
* **Props:**
  * `editing?: InvoiceDto | ReceiptDto | null`
* **Form Defaults:**
  * Uses `editing ? documentToFormValues(editing, kind) : emptyValues(services)`.
* **Titles & Copy:**
  * **Invoice Edit:** Title: `"Edit invoice ${invoice.invoiceNumber}"`.
  * **Receipt Edit:** Title: `"Edit receipt ${receipt.receiptNumber}"`.
* **Footer Actions in Edit Mode:**
  * **Draft Invoice:** Two buttons:
    * `Button variant="ghost"`: "Save changes" (calls `submit(true)` keeping status `DRAFT`).
    * `Button variant="primary"`: "Save & send" (calls `submit(false)` promoting to `SENT`).
  * **Sent / Overdue Invoice:**
    * `Button variant="primary"`: "Save changes" (calls `submit(false)`).
  * **Receipt:**
    * `Button variant="primary"`: "Save changes" (calls `submit(false)`).

### 3.5 Row Components & Action Buttons
* **`src/components/invoices/invoice-row.tsx`:**
  * Prop: `onEdit?: () => void`
  * Add `isEditable = (invoice.status === "DRAFT" || invoice.status === "SENT" || invoice.status === "OVERDUE") && Number(invoice.amountPaid) === 0`
  * When `isEditable` is true, render an `"Edit"` button (`Button size="sm" variant="ghost"`) in the card actions.
* **`src/components/receipts/receipt-row.tsx`:**
  * Prop: `onEdit?: () => void`
  * Add `isEditable = !receipt.payment?.invoice && (receipt.paymentMethod === "CASH" || receipt.paymentMethod === "BANK_TRANSFER")`
  * When `isEditable` is true, render an `"Edit"` button (`Button size="sm" variant="ghost"`) in the card actions.
* **Page Integration:**
  * In `invoices-page-client.tsx`, connect `onEdit={() => composer.start(invoice)}`.
  * In `receipts-page-client.tsx`, connect `onEdit={() => composer.start(receipt)}`.

---

## 4. Error Handling & Edge Cases

| Scenario | Behavior |
| --- | --- |
| Attempt to edit invoice with payments (`PAID` or `PARTIALLY_PAID`) | Edit button hidden in UI; API throws `400 BadRequestException`. |
| Attempt to edit invoice-linked receipt | Edit button hidden in UI; API throws `400 BadRequestException`. |
| Customer email modified | Stored on document record; PDF regenerated with new contact info; notification email delivered to updated address. |
| Customer has no email address | Document updated and PDF regenerated; email delivery skipped gracefully. |
| Cloudinary upload failure | Logged as error; DB update succeeds so the user never loses their edits. |

---

## 5. Testing Plan

### 5.1 Backend Unit & Integration Tests
* `src/app/api/invoices/[slug]/route.test.ts`:
  * Test updating client name, line items, and due date on a `DRAFT` invoice.
  * Test updating a `SENT` invoice re-sends invoice email.
  * Test updating a `PARTIALLY_PAID` or `PAID` invoice returns 400.
* `src/app/api/receipts/[slug]/route.test.ts`:
  * Test updating line items and notes on a standalone manual receipt.
  * Test that receipt update triggers `emailReceipt` when email is provided.
  * Test updating an invoice-linked receipt returns 400.

### 5.2 Frontend Component Tests
* `documentToFormValues`:
  * Verify conversion for itemized invoice $\rightarrow$ form values.
  * Verify conversion for custom amount receipt $\rightarrow$ form values.
* `InvoiceRow`:
  * Renders "Edit" button for `DRAFT`, `SENT`, `OVERDUE` with 0 amount paid.
  * Does NOT render "Edit" button for `PAID` or `PARTIALLY_PAID`.
* `ReceiptRow`:
  * Renders "Edit" button for standalone cash/transfer receipts.
  * Does NOT render "Edit" button for invoice-linked or automated receipts.
