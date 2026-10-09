# Editable Unpaid Invoices and Standalone Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow business owners to edit details of unpaid invoices (Draft, Sent, Overdue) and standalone manual receipts on the web app, automatically updating PDF documents on Cloudinary and notifying customers via email.

**Architecture:** Extend backend `PUT` endpoints for invoices and receipts to enforce editing rules and re-send updated email notifications; add `documentToFormValues` adapter in `src/utils/documents.ts`; add update mutations in `src/hooks/mutations/use-document-mutations.ts`; enhance `useDocumentComposer` and `DocumentModal` to support both create and edit modes; wire `Edit` action buttons into `InvoiceRow` and `ReceiptRow`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma, TanStack Query, React Hook Form, Zod, Vitest.

## Global Constraints
- Node environment for test execution: Use `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run <test-file>` to satisfy `styleText` dependency requirements.
- Strictly adhere to eligibility rules:
  - Invoices: editable only when `status` is `DRAFT`, `SENT`, or `OVERDUE` and `amountPaid === 0`.
  - Receipts: editable only when standalone and manual (`!receipt.payment?.invoice && (receipt.paymentMethod === "CASH" || receipt.paymentMethod === "BANK_TRANSFER")`).
- PDF regeneration must persist on Cloudinary without altering the customer's existing link.
- Re-send updated emails automatically when `clientEmail` / `email` is present.

---

### Task 1: Form Adapter Utility (`documentToFormValues`) & Unit Tests

**Files:**
- Modify: `src/utils/documents.ts`
- Create: `src/utils/documents.test.ts`

**Interfaces:**
- Produces: `documentToFormValues(doc: InvoiceDto | ReceiptDto, kind: "invoice" | "receipt"): DocumentFormSchema`

- [ ] **Step 1: Write the failing unit tests for `documentToFormValues`**

Create `src/utils/documents.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { InvoiceDto, ReceiptDto } from "types";
import { documentToFormValues } from "./documents";

const MOCK_INVOICE: InvoiceDto = {
  id: "inv_1",
  slug: "inv-1",
  publicId: "pub_inv_1",
  businessId: "biz_1",
  bookingId: null,
  invoiceNumber: "INV-1001",
  status: "SENT",
  currency: "NGN",
  clientName: "Ada Lovelace",
  clientEmail: "ada@example.com",
  clientPhone: "+2348012345678",
  subtotal: "25000",
  taxAmount: "1875",
  discount: "1000",
  total: "25875",
  amountPaid: "0",
  dueAt: new Date("2026-11-01T00:00:00.000Z"),
  sentAt: new Date("2026-10-01T00:00:00.000Z"),
  paidAt: null,
  notes: "Urgent delivery",
  url: "https://cdn.test/inv.pdf",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  services: [
    {
      invoiceId: "inv_1",
      serviceId: "srv_1",
      description: "Braids",
      quantity: 1,
      unitPrice: "25000",
      total: "25000",
      service: { id: "srv_1", name: "Braids" } as any,
    },
  ],
  business: { id: "biz_1", name: "Sara Salon" } as any,
  booking: null,
  payments: [],
  _count: { payments: 0 },
};

const MOCK_RECEIPT: ReceiptDto = {
  id: "rcp_1",
  slug: "rcp-1",
  publicId: "pub_rcp_1",
  businessId: "biz_1",
  paymentId: null,
  receiptNumber: "RCP-1001",
  name: "Bisi Akande",
  email: "bisi@example.com",
  phone: "+2348098765432",
  currency: "NGN",
  subtotal: "15000",
  taxAmount: "0",
  discount: "0",
  total: "15000",
  amountPaid: "15000",
  paymentMethod: "CASH",
  notes: "Walk-in payment",
  url: "https://cdn.test/rcp.pdf",
  createdAt: new Date("2026-10-05T00:00:00.000Z"),
  updatedAt: new Date("2026-10-05T00:00:00.000Z"),
  business: { id: "biz_1", name: "Sara Salon" } as any,
  payment: null,
  services: [],
};

describe("documentToFormValues", () => {
  it("converts an itemized invoice to DocumentFormSchema", () => {
    const values = documentToFormValues(MOCK_INVOICE, "invoice");
    expect(values.name).toBe("Ada Lovelace");
    expect(values.email).toBe("ada@example.com");
    expect(values.phone).toBe("+2348012345678");
    expect(values.mode).toBe("services");
    expect(values.items).toHaveLength(1);
    expect(values.items[0]).toEqual({
      serviceId: "srv_1",
      quantity: "1",
      unitPrice: "25000",
    });
    expect(values.taxAmount).toBe("1875");
    expect(values.discount).toBe("1000");
    expect(values.dueAt).toBe("2026-11-01");
    expect(values.description).toBe("Urgent delivery");
  });

  it("converts a custom amount receipt to DocumentFormSchema", () => {
    const values = documentToFormValues(MOCK_RECEIPT, "receipt");
    expect(values.name).toBe("Bisi Akande");
    expect(values.email).toBe("bisi@example.com");
    expect(values.mode).toBe("amount");
    expect(values.amount).toBe("15000");
    expect(values.items).toEqual([]);
    expect(values.paymentMethod).toBe("CASH");
    expect(values.description).toBe("Walk-in payment");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/utils/documents.test.ts`
Expected: FAIL with "documentToFormValues is not a function"

- [ ] **Step 3: Implement `documentToFormValues` in `src/utils/documents.ts`**

Add to `src/utils/documents.ts`:
```ts
import type { InvoiceDto, ReceiptDto } from "types";

export function documentToFormValues(
  doc: InvoiceDto | ReceiptDto,
  kind: "invoice" | "receipt",
): DocumentFormSchema {
  const isInvoice = kind === "invoice";
  const inv = isInvoice ? (doc as InvoiceDto) : null;
  const rcp = !isInvoice ? (doc as ReceiptDto) : null;

  const name = isInvoice ? inv!.clientName : (rcp!.name ?? "");
  const email = isInvoice ? (inv!.clientEmail ?? "") : (rcp!.email ?? "");
  const phone = isInvoice ? (inv!.clientPhone ?? "") : (rcp!.phone ?? "");

  const hasServices = doc.services && doc.services.length > 0;
  const mode = hasServices ? "services" : "amount";

  const items = hasServices
    ? doc.services.map((item) => ({
        serviceId: item.serviceId,
        quantity: String(item.quantity),
        unitPrice: String(Number(item.unitPrice)),
      }))
    : [];

  const amount = !hasServices ? String(Number(doc.subtotal)) : "";
  const description = doc.notes ?? "";

  const taxAmount = Number(doc.taxAmount) > 0 ? String(Number(doc.taxAmount)) : "";
  const discount = Number(doc.discount) > 0 ? String(Number(doc.discount)) : "";

  let dueAt = "";
  if (isInvoice && inv?.dueAt) {
    dueAt = new Date(inv.dueAt).toISOString().split("T")[0] ?? "";
  }

  const paymentMethod = !isInvoice && rcp?.paymentMethod === "BANK_TRANSFER"
    ? "BANK_TRANSFER"
    : "CASH";

  return {
    name,
    email,
    phone,
    mode,
    items,
    amount,
    description,
    taxAmount,
    discount,
    dueAt,
    paymentMethod,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/utils/documents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/documents.ts src/utils/documents.test.ts
git commit -m "feat(documents): add documentToFormValues adapter utility"
```

---

### Task 2: Backend Invoice Update Email Dispatch & Guard Verification

**Files:**
- Modify: `src/app/api/invoices/[slug]/route.ts`
- Modify: `src/app/api/invoices/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `PUT /api/invoices/[slug]`
- Produces: Updated `Invoice` record; re-dispatches `emailInvoice` when updating a `SENT` or `OVERDUE` invoice or when promoting `DRAFT` $\rightarrow$ `SENT`.

- [ ] **Step 1: Write test for updating a SENT invoice and verifying email dispatch**

Add test in `src/app/api/invoices/[slug]/route.test.ts`:
```ts
vi.mock("@/backend/services/email/documents", () => ({
  emailInvoice: vi.fn().mockResolvedValue(undefined),
  emailReceipt: vi.fn().mockResolvedValue(undefined),
}));
import { emailInvoice } from "@/backend/services/email/documents";

it("updates details on a SENT invoice and re-sends invoice email", async () => {
  mockedDb.invoice.findUnique.mockResolvedValue({
    ...invoice("SENT"),
    clientEmail: "ada@example.com",
    services: [],
  });
  const response = await put({ name: "Ada Updated" });
  expect(response.status).toBe(200);
  expect(mockedDb.invoice.update).toHaveBeenCalled();
  expect(emailInvoice).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/app/api/invoices/\[slug\]/route.test.ts`
Expected: FAIL because `emailInvoice` is currently only called when transitioning from `DRAFT` to `SENT`.

- [ ] **Step 3: Update `src/app/api/invoices/[slug]/route.ts` email dispatch logic**

In `src/app/api/invoices/[slug]/route.ts`, lines 186-190, replace:
```ts
      // Marking a draft as sent sends it: to the customer too, if they have
      // an address. (A new invoice created as SENT is emailed on create.)
      if (invoice.status === "DRAFT" && updatedInvoicedata.invoice.status === "SENT") {
        await emailInvoice(updatedInvoicedata.invoice, updatedInvoicedata.business);
      }
```
with:
```ts
      // Email customer when promoting draft to sent, or when an already sent/overdue invoice is updated.
      const shouldEmail =
        (invoice.status === "DRAFT" && updatedInvoicedata.invoice.status === "SENT") ||
        (invoice.status === "SENT" || invoice.status === "OVERDUE");
      if (shouldEmail && updatedInvoicedata.invoice.clientEmail) {
        await emailInvoice(updatedInvoicedata.invoice, updatedInvoicedata.business);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/app/api/invoices/\[slug\]/route.test.ts`
Expected: PASS (all 5 tests pass)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/invoices/[slug]/route.ts src/app/api/invoices/[slug]/route.test.ts
git commit -m "feat(invoices): re-dispatch invoice email on updating sent or overdue invoice"
```

---

### Task 3: Backend Receipt Update Guard & Email Notification

**Files:**
- Modify: `src/app/api/receipts/[slug]/route.ts`
- Create: `src/app/api/receipts/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `PUT /api/receipts/[slug]`
- Produces: Guards against editing invoice-linked receipts (`existingReceipt.payment?.invoiceId`); re-dispatches `emailReceipt` when receipt has customer email.

- [ ] **Step 1: Write tests for `PUT /api/receipts/[slug]`**

Create `src/app/api/receipts/[slug]/route.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticatedCookies,
  createMockRequest,
  mockAuthenticatedSession,
} from "@/backend/test-utils/mock-request";

vi.mock("@/server/db", () => {
  const db: any = {
    session: { findUnique: vi.fn(), delete: vi.fn() },
    receipt: { findUnique: vi.fn(), update: vi.fn() },
  };
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateReceiptPdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/RCP-1001.pdf" }),
  },
}));
vi.mock("@/backend/services/email/documents", () => ({
  emailReceipt: vi.fn().mockResolvedValue(undefined),
}));

import { db } from "@/server/db";
import { emailReceipt } from "@/backend/services/email/documents";
import { PUT } from "./route";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", ownerId: "user_1" };
const USER = { id: "user_1", name: "Owner", email: "owner@example.com" };

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "rcp_1",
    slug: "rcp-1",
    receiptNumber: "RCP-1001",
    currency: "NGN",
    subtotal: 10000,
    taxAmount: 0,
    discount: 0,
    total: 10000,
    amountPaid: 10000,
    paymentMethod: "CASH",
    name: "Customer",
    email: "customer@example.com",
    createdAt: new Date(),
    business: { id: "biz_1", ownerId: "user_1", name: "Sara Business" },
    payment: null,
    services: [],
    ...overrides,
  };
}

function put(body: unknown) {
  return PUT(
    createMockRequest({
      method: "PUT",
      url: "http://localhost:3000/api/receipts/rcp-1",
      cookies: authenticatedCookies(),
      headers: { "content-type": "application/json" },
      body,
    }),
    { params: Promise.resolve({ slug: "rcp-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticatedSession(mockedDb, { user: USER, business: BUSINESS });
  mockedDb.receipt.update.mockImplementation(async ({ data }: any) => ({
    ...receipt(),
    ...data,
  }));
});

describe("PUT /api/receipts/[slug]", () => {
  it("updates a standalone manual receipt and sends email", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(receipt());
    const response = await put({ name: "Updated Customer" });
    expect(response.status).toBe(200);
    expect(mockedDb.receipt.update).toHaveBeenCalled();
    expect(emailReceipt).toHaveBeenCalled();
  });

  it("refuses updating a receipt linked to an invoice payment", async () => {
    mockedDb.receipt.findUnique.mockResolvedValue(
      receipt({ payment: { invoiceId: "inv_123" } }),
    );
    const response = await put({ name: "Updated Customer" });
    expect(response.status).toBe(400);
    expect(mockedDb.receipt.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/app/api/receipts/\[slug\]/route.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement guards and email dispatch in `src/app/api/receipts/[slug]/route.ts`**

In `src/app/api/receipts/[slug]/route.ts`:
1. Import `emailReceipt`:
```ts
import { emailReceipt } from "@/backend/services/email/documents";
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from "@/utils/exceptions";
```
2. In `db.receipt.findUnique`:
Include `payment: { select: { invoiceId: true } }`:
```ts
      const existingReceipt = await db.receipt.findUnique({
        where: { slug },
        include: { business: true, payment: { select: { invoiceId: true } } },
      });
```
3. Add the guard right after authorization check:
```ts
      if (existingReceipt.payment?.invoiceId) {
        throw new BadRequestException("Receipts linked to invoice payments cannot be edited directly");
      }
```
4. After updating `finalReceipt`, dispatch email:
```ts
      if (finalReceipt.email) {
        await emailReceipt(finalReceipt, existingReceipt.business);
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run src/app/api/receipts/\[slug\]/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/receipts/[slug]/route.ts src/app/api/receipts/[slug]/route.test.ts
git commit -m "feat(receipts): guard against editing invoice-linked receipts and email on update"
```

---

### Task 4: Frontend API Methods & Mutation Hooks

**Files:**
- Modify: `src/utils/api.ts:247-285`
- Modify: `src/hooks/mutations/use-document-mutations.ts`

**Interfaces:**
- Produces:
  - `api.invoices.update(slug: string, values: InvoiceUpdateInput): Promise<InvoiceDto>`
  - `api.receipts.update(slug: string, values: ReceiptUpdateInput): Promise<ReceiptDto>`
  - `useUpdateInvoiceMutation()`
  - `useUpdateReceiptMutation()`

- [ ] **Step 1: Add update input types and methods to `src/utils/api.ts`**

In `src/utils/api.ts`:
Define inputs:
```ts
export type InvoiceUpdateInput = Partial<DocumentMoney> & {
  name?: string;
  email?: string;
  phone?: string;
  status?: "DRAFT" | "SENT";
  amountPaid?: number;
  dueAt?: string;
  sentAt?: string;
  notes?: string;
  services?: LineItemInput[];
};

export type ReceiptUpdateInput = Partial<DocumentMoney> & {
  name?: string;
  email?: string;
  phone?: string;
  amountPaid?: number;
  paymentMethod?: "CASH" | "BANK_TRANSFER";
  notes?: string;
  services?: LineItemInput[];
};
```
In `api.invoices`:
```ts
    update: (slug: string, values: InvoiceUpdateInput) =>
      data<InvoiceDto>(http.put(`/invoices/${encodeURIComponent(slug)}`, values)),
```
In `api.receipts`:
```ts
    update: (slug: string, values: ReceiptUpdateInput) =>
      data<ReceiptDto>(http.put(`/receipts/${encodeURIComponent(slug)}`, values)),
```

- [ ] **Step 2: Add mutation hooks in `src/hooks/mutations/use-document-mutations.ts`**

Add imports and hooks:
```ts
import {
  api,
  type InvoiceCreateInput,
  type InvoicePaymentInput,
  type InvoiceUpdateInput,
  type ReceiptCreateInput,
  type ReceiptUpdateInput,
} from "@/utils/api";

export function useUpdateInvoiceMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ slug, values }: { slug: string; values: InvoiceUpdateInput }) =>
      api.invoices.update(slug, values),
    onSuccess: invalidate,
  });
}

export function useUpdateReceiptMutation() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ slug, values }: { slug: string; values: ReceiptUpdateInput }) =>
      api.receipts.update(slug, values),
    onSuccess: invalidate,
  });
}
```

- [ ] **Step 3: Run typecheck to verify types**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/api.ts src/hooks/mutations/use-document-mutations.ts
git commit -m "feat(api): add update methods and mutation hooks for invoices and receipts"
```

---

### Task 5: Extend `useDocumentComposer` Hook for Editing

**Files:**
- Modify: `src/hooks/use-document-composer.ts`

**Interfaces:**
- Consumes: `useUpdateInvoiceMutation`, `useUpdateReceiptMutation`
- Produces: `start(documentToEdit?: InvoiceDto | ReceiptDto)` and `modal.editing` in `useDocumentComposer`

- [ ] **Step 1: Update `src/hooks/use-document-composer.ts` to handle edit state and submission**

Modify `src/hooks/use-document-composer.ts`:
```ts
import { useState } from "react";
import type { InvoiceDto, ReceiptDto } from "types";

import type { DocumentFormSchema } from "@/backend/validators/document-form.validator";
import type { CreatedDocument, DocumentKind } from "@/components/documents/document-modal";
import {
  useCreateInvoiceMutation,
  useCreateReceiptMutation,
  useUpdateInvoiceMutation,
  useUpdateReceiptMutation,
} from "@/hooks/mutations/use-document-mutations";
import { errorMessage } from "@/utils/axios";
import { toDocumentPayload } from "@/utils/documents";

export function useDocumentComposer(kind: DocumentKind, currency: string) {
  const [session, setSession] = useState(0);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceDto | ReceiptDto | null>(null);
  const [created, setCreated] = useState<CreatedDocument | null>(null);

  const createInvoice = useCreateInvoiceMutation();
  const createReceipt = useCreateReceiptMutation();
  const updateInvoice = useUpdateInvoiceMutation();
  const updateReceipt = useUpdateReceiptMutation();

  const activeMutation = editing
    ? kind === "invoice"
      ? updateInvoice
      : updateReceipt
    : kind === "invoice"
      ? createInvoice
      : createReceipt;

  function start(doc?: InvoiceDto | ReceiptDto) {
    createInvoice.reset();
    createReceipt.reset();
    updateInvoice.reset();
    updateReceipt.reset();
    setCreated(null);
    setEditing(doc ?? null);
    setSession((n) => n + 1);
    setOpen(true);
  }

  function submit(values: DocumentFormSchema, { draft }: { draft: boolean }) {
    const base = toDocumentPayload(values, currency);

    if (editing) {
      if (kind === "invoice") {
        const inv = editing as InvoiceDto;
        const willBeSent = inv.status === "DRAFT" ? !draft : true;
        updateInvoice.mutate(
          {
            slug: inv.slug,
            values: {
              ...base,
              status: willBeSent ? "SENT" : "DRAFT",
              dueAt: values.dueAt ? `${values.dueAt}T00:00:00.000Z` : undefined,
              sentAt: inv.status === "DRAFT" && willBeSent ? new Date().toISOString() : undefined,
            },
          },
          {
            onSuccess: () => setOpen(false),
          },
        );
      } else {
        const rcp = editing as ReceiptDto;
        updateReceipt.mutate(
          {
            slug: rcp.slug,
            values: {
              ...base,
              amountPaid: base.total,
              paymentMethod: values.paymentMethod,
            },
          },
          {
            onSuccess: () => setOpen(false),
          },
        );
      }
      return;
    }

    if (kind === "invoice") {
      createInvoice.mutate(
        {
          ...base,
          status: draft ? "DRAFT" : "SENT",
          amountPaid: 0,
          sentAt: draft ? undefined : new Date().toISOString(),
          dueAt: values.dueAt ? `${values.dueAt}T00:00:00.000Z` : undefined,
        },
        {
          onSuccess: (invoice) =>
            setCreated({
              number: invoice.invoiceNumber,
              shareUrl: invoice.shareUrl,
              url: invoice.url,
              total: Number(invoice.total),
              customer: invoice.clientName,
            }),
        },
      );
      return;
    }

    createReceipt.mutate(
      { ...base, amountPaid: base.total, paymentMethod: values.paymentMethod },
      {
        onSuccess: (receipt) =>
          setCreated({
            number: receipt.receiptNumber,
            shareUrl: receipt.shareUrl,
            url: receipt.url,
            total: Number(receipt.total),
            customer: receipt.name ?? base.name,
          }),
      },
    );
  }

  return {
    start,
    modal: {
      key: `${kind}-${editing ? "edit-" + ("invoiceNumber" in editing ? editing.invoiceNumber : editing.receiptNumber) : "new"}-${session}`,
      kind,
      open,
      onOpenChange: setOpen,
      currency,
      editing,
      onSubmit: submit,
      isPending: activeMutation.isPending,
      error: activeMutation.isError ? errorMessage(activeMutation.error) : null,
      created,
    },
  };
}
```

- [ ] **Step 2: Run typecheck to verify types**

Run: `npm run typecheck`
Expected: PASS (or complaints only if `DocumentModalProps` does not accept `editing` yet)

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-document-composer.ts
git commit -m "feat(documents): extend useDocumentComposer to support editing"
```

---

### Task 6: Unified `DocumentModal` with Edit Mode Support

**Files:**
- Modify: `src/components/documents/document-modal.tsx`

**Interfaces:**
- Consumes: `editing?: InvoiceDto | ReceiptDto | null` prop from composer modal
- Produces: Dynamic title/description and action buttons for editing vs creating

- [ ] **Step 1: Update `DocumentModalProps` and initialization in `src/components/documents/document-modal.tsx`**

In `src/components/documents/document-modal.tsx`:
1. Import `InvoiceDto`, `ReceiptDto`, and `documentToFormValues`:
```ts
import type { InvoiceDto, ReceiptDto, ServiceDto } from "types";
import { computeTotals, documentToFormValues } from "@/utils/documents";
```
2. Update `DocumentModalProps`:
```ts
interface DocumentModalProps {
  kind: DocumentKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  services: ServiceDto[];
  currency: string;
  onSubmit: (values: DocumentFormSchema, options: { draft: boolean }) => void;
  isPending: boolean;
  error: string | null;
  created: CreatedDocument | null;
  editing?: InvoiceDto | ReceiptDto | null;
}
```
3. Set form default values using `documentToFormValues`:
```ts
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<DocumentFormSchema>({
    resolver: zodResolver(documentFormSchema),
    defaultValues: editing ? documentToFormValues(editing, kind) : emptyValues(services),
  });
```

- [ ] **Step 2: Update modal header and footer buttons for edit mode**

1. Modal header:
```tsx
const docNumber = editing
  ? "invoiceNumber" in editing
    ? editing.invoiceNumber
    : editing.receiptNumber
  : null;

const title = editing ? `Edit ${kind === "invoice" ? "invoice" : "receipt"} ${docNumber}` : copy.title;
const description = editing
  ? `Update ${kind === "invoice" ? "invoice details, line items, or customer information." : "receipt details or line items."}`
  : copy.description;
```
2. In the footer actions:
```tsx
{editing ? (
  kind === "invoice" && (editing as InvoiceDto).status === "DRAFT" ? (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={submit(true)}
        isLoading={isPending}
      >
        Save changes
      </Button>
      <Button
        type="button"
        variant="primary"
        onClick={submit(false)}
        isLoading={isPending}
      >
        Save & send
      </Button>
    </>
  ) : (
    <Button type="submit" variant="primary" isLoading={isPending}>
      Save changes
    </Button>
  )
) : (
  <>
    {kind === "invoice" ? (
      <Button
        type="button"
        variant="ghost"
        onClick={submit(true)}
        isLoading={isPending}
      >
        Save as draft
      </Button>
    ) : null}
    <Button
      type={kind === "invoice" ? "button" : "submit"}
      variant="primary"
      onClick={kind === "invoice" ? submit(false) : undefined}
      isLoading={isPending}
    >
      {copy.submit}
    </Button>
  </>
)}
```

- [ ] **Step 3: Run typecheck to verify component typing**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/documents/document-modal.tsx
git commit -m "feat(documents): enhance DocumentModal with edit mode and dynamic action buttons"
```

---

### Task 7: Row Components Edit Actions

**Files:**
- Modify: `src/components/invoices/invoice-row.tsx`
- Modify: `src/components/receipts/receipt-row.tsx`

**Interfaces:**
- Produces: `onEdit?: () => void` prop on `InvoiceRow` and `ReceiptRow`; renders "Edit" button for eligible documents.

- [ ] **Step 1: Add `onEdit` to `InvoiceRow`**

In `src/components/invoices/invoice-row.tsx`:
1. Add `onEdit?: () => void;` to `InvoiceRowProps`.
2. Compute `isEditable`:
```ts
const isEditable =
  ["DRAFT", "SENT", "OVERDUE"].includes(invoice.status) &&
  Number(invoice.amountPaid) === 0;
```
3. Add "Edit" button to actions (between payment/send actions and copy link button):
```tsx
{isEditable && onEdit ? (
  <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}>
    Edit
  </Button>
) : null}
```

- [ ] **Step 2: Add `onEdit` to `ReceiptRow`**

In `src/components/receipts/receipt-row.tsx`:
1. Add `onEdit?: () => void;` to `ReceiptRowProps`:
```ts
interface ReceiptRowProps {
  receipt: ReceiptDto;
  link: string;
  onEdit?: () => void;
}
```
2. Compute `isEditable`:
```ts
const isEditable =
  !receipt.payment?.invoice &&
  (receipt.paymentMethod === "CASH" || receipt.paymentMethod === "BANK_TRANSFER");
```
3. Add "Edit" button to actions:
```tsx
{isEditable && onEdit ? (
  <Button size="sm" variant="ghost" onClick={onEdit}>
    Edit
  </Button>
) : null}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/invoices/invoice-row.tsx src/components/receipts/receipt-row.tsx
git commit -m "feat(documents): add Edit action button to InvoiceRow and ReceiptRow"
```

---

### Task 8: Page Integration & Verification

**Files:**
- Modify: `src/components/invoices/invoices-page-client.tsx`
- Modify: `src/components/receipts/receipts-page-client.tsx`

**Interfaces:**
- Connects `composer.start(invoice)` and `composer.start(receipt)` to rows.

- [ ] **Step 1: Connect `onEdit` in `InvoicesPageClient`**

In `src/components/invoices/invoices-page-client.tsx`:
Pass `onEdit={() => composer.start(invoice)}` to `<InvoiceRow>`:
```tsx
<InvoiceRow
  invoice={invoice}
  link={`${publicBaseUrl}${publicPath("invoice", invoice.publicId)}`}
  busy={busySlug === invoice.slug}
  onEdit={() => composer.start(invoice)}
  onRecordPayment={() => {
    ...
```

- [ ] **Step 2: Connect `onEdit` in `ReceiptsPageClient`**

In `src/components/receipts/receipts-page-client.tsx`:
Pass `onEdit={() => composer.start(receipt)}` to `<ReceiptRow>`:
```tsx
<ReceiptRow
  receipt={receipt}
  link={`${publicBaseUrl}${publicPath("receipt", receipt.publicId)}`}
  onEdit={() => composer.start(receipt)}
/>
```

- [ ] **Step 3: Run full verification suite**

Run:
1. `npm run typecheck`
2. `~/.nvm/versions/node/v22.23.2/bin/node ./node_modules/.bin/vitest run`
Expected: All tests pass, 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/invoices/invoices-page-client.tsx src/components/receipts/receipts-page-client.tsx
git commit -m "feat(documents): wire edit actions into invoices and receipts pages"
```
