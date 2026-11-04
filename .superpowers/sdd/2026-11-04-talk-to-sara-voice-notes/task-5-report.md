# Task 5 implementation report

Implemented transaction-bound invoice and receipt creation and independent PDF finalization. Existing `create` callers retain their defaults and PDF behavior: creation commits first, PDF generation/upload is best effort, successful URL writes use the global client, and URL-write database failures still escape. Public IDs remain database-generated and usable if PDF generation/upload fails.

## Exported interfaces

From `src/backend/services/invoice/index.ts`:

```ts
invoiceService.create(input: CreateInvoiceInput): Promise<Invoice>
invoiceService.createInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateInvoiceInput,
): Promise<CreatedInvoice>
finalizeInvoice(id: string): Promise<void>
```

From `src/backend/services/receipt/index.ts`:

```ts
receiptService.create(input: CreateReceiptInput): Promise<Receipt>
receiptService.createInTransaction(
  tx: Prisma.TransactionClient,
  input: CreateReceiptInput,
): Promise<CreatedReceipt>
finalizeReceipt(id: string): Promise<void>
```

Both indexes also export their existing input types, typed `invoiceInclude` / `receiptInclude` constants, and Prisma payload types:

```ts
type CreatedInvoice = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
type CreatedReceipt = Prisma.ReceiptGetPayload<{ include: typeof receiptInclude }>;
```

The include constants and payload types live in their respective `finalize.ts` files and are re-exported from the indexes to avoid a circular runtime import. Both includes load business and lines ordered by position, including each line's service. Finalizers can also be imported directly from their respective `finalize.ts` paths.

## Behavior and static review

- Cores never call `$transaction`, the global `db`, PDF generation, or upload. Business lookup, document numbering, booking/payment ownership checks, customer resolution and line resolution use the exact supplied client.
- Receipts keep the existing payment ownership/duplicate checks and copy invoice lines when omitted. Existing-payment receipts skip sale/order/payment/stock creation.
- Walk-in receipt sale creation receives the exact supplied client and keeps pickup/delivery defaults. When an order is created, the core reloads the receipt using `tx.receipt.findUniqueOrThrow` so its returned `paymentId` includes the sale's newly linked payment.
- Finalizers reload committed documents independently and only render/upload PDFs and update their URL. They retain number-based filenames, business folders, `resource_type: "raw"`, and document IDs as Cloudinary public IDs.
- Existing service tests were adapted for committed-document reloads and retain the expired-transaction update trap. Added core regression coverage for exact transaction propagation, no nested transaction or PDF work, scoped booking/payment access, existing-payment line copying, and fresh receipt payment linkage. Added finalizer suites for committed-row loading, deterministic upload identity, generation/upload failure, missing records and URL-write failure.

## Deferred checks and integration concerns

No tests, lint, build, typecheck, schema validation or other verification commands were run, per the user override until Task 21 implementation is complete. Review was static source/diff reading only. Written tests must be executed after that gate; route and messaging regression suites remain deferred too.

Document numbering retains the current allocation behavior and database uniqueness constraints. Task 11 must supply serializable retry around assistant approval transactions; these cores intentionally do not open their own transaction or retry closure. Stock remains the existing order helper's behavior; strict assistant stock preflight belongs to Tasks 8/11.

The shared `Effect` export was requested through the root and is owned by the foundation worker in `assistant/types.ts`; this task did not edit that file. Root confirmed that its shared shape includes optional `previousStartTime` and `previousEndTime` for booking fidelity. No new effects module was necessary.
