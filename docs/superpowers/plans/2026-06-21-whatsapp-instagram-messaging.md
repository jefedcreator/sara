# WhatsApp & Instagram Messaging Gateway — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SME owners manage their business from WhatsApp and Instagram (create invoices/receipts, share a service booking link, check unpaid, view bookings, see a summary), and let their customers book + pay through that link, with the owner auto-notified and a receipt generated on payment.

**Architecture:** A channel-agnostic conversation engine drives a numbered-menu state machine over Sara's services. Two Meta adapters (WhatsApp Cloud API, Instagram Messaging API) implement one `ChannelAdapter` interface; webhooks normalize inbound messages into the engine and send replies. Invoice, receipt, and booking creation are first extracted from the route handlers into services so chat, the existing routes, and new public booking routes share one code path. Public unauthenticated routes expose service details/availability and booking-with-payment. The Paystack webhook is extended to auto-create a receipt and notify the owner in chat.

**Tech Stack:** Next.js 15 (App Router route handlers), TypeScript, Prisma + PostgreSQL, Zod, Vitest, Node `crypto`, Meta Graph API v21.0, Paystack.

## Global Constraints

- Node `>=24.15.0 <25`; package manager `yarn@1.22.22`. Run tests with `yarn test` (vitest).
- Services are **class-based singletons** exported as a lowercase instance (e.g. `export const fooService = new FooService()`), matching `src/backend/services/*`.
- Authenticated route handlers use `withMiddleware(handler, [authMiddleware, …])` from `@/backend/middleware`; throw `HttpException` subclasses from `@/utils/exceptions`. **Public** routes (webhooks, `/api/public/*`) are plain `export async function GET/POST(request: Request)` with no `authMiddleware`.
- Webhook routes must **always return HTTP 200** after a valid signature (except `403` on bad signature); never surface internal errors as non-200 — Meta disables failing webhooks. The Paystack webhook already follows this.
- Decimal money fields are Prisma `Decimal`: pass plain JS numbers to `create`/`update`; wrap reads in `Number(...)` before formatting.
- Currency for chat-created invoices/receipts and notifications comes from `Business.currency`. Never hardcode a currency.
- Meta Graph base: `https://graph.facebook.com/v21.0`. Webhook signature header `x-hub-signature-256`, format `sha256=<hex>`, HMAC-SHA256 over the raw body keyed by `META_APP_SECRET`.
- Chat idempotency key is the inbound provider `messageId`; never create an invoice/receipt twice for the same `messageId`. The Paystack webhook keeps its dedupe on payment `reference`.
- Session is stale when `lastActiveAt` is older than 24h → reset to `MAIN_MENU`.
- New env vars are **optional** (`z.string().optional()`) like the other integrations, so builds/tests don't require them.
- Booking links point to `${APP_URL}/book/<service.slug>` where `APP_URL` resolves via `appBaseUrl()` (Task 4). The `/book` webpage itself is out of scope (separate frontend).

---

## File Structure

**Create — extracted services:**
- `src/backend/services/invoice/index.ts` (+ `index.test.ts`) — `InvoiceService.create()`
- `src/backend/services/receipt/index.ts` (+ `index.test.ts`) — `ReceiptService.create()`
- `src/backend/services/booking/index.ts` (+ `index.test.ts`) — `BookingService.createWithPayment()`

**Create — messaging core:**
- `src/backend/services/messaging/channels/types.ts` — `InboundMessage`, `OutboundMessage`, `ChannelAdapter`
- `src/backend/services/messaging/url.ts` (+ `url.test.ts`) — `appBaseUrl()`, `publicUrl()`
- `src/backend/services/messaging/engine/amount.ts` (+ `amount.test.ts`) — `parseAmount()`, `formatMoney()`
- `src/backend/services/messaging/session/index.ts` (+ `index.test.ts`) — `ChatSessionService`
- `src/backend/services/messaging/linking/index.ts` (+ `index.test.ts`) — `LinkingService`
- `src/backend/services/messaging/linking/validator.ts` — `linkValidatorSchema`
- `src/backend/services/messaging/dispatch/index.ts` (+ `index.test.ts`) — `IntentDispatcher`
- `src/backend/services/messaging/engine/index.ts` (+ `index.test.ts`) — `ConversationEngine`
- `src/backend/services/messaging/channels/whatsapp/index.ts` (+ `index.test.ts`) — `WhatsAppAdapter`
- `src/backend/services/messaging/channels/instagram/index.ts` (+ `index.test.ts`) — `InstagramAdapter`
- `src/backend/services/messaging/channels/registry.ts` — `adapterFor(channel)`
- `src/backend/services/messaging/notify/index.ts` (+ `index.test.ts`) — `OwnerNotifier`

**Create — routes:**
- `src/app/api/messaging/link/route.ts`
- `src/app/api/webhooks/whatsapp/route.ts` (+ `route.test.ts`)
- `src/app/api/webhooks/instagram/route.ts`
- `src/app/api/public/services/[slug]/route.ts` (+ `route.test.ts`)
- `src/app/api/public/bookings/route.ts` (+ `route.test.ts`)

**Modify:**
- `prisma/schema.prisma` — enum + 3 models + `Business.chatIdentities`
- `src/env.js`, `.env.example` — Meta/WhatsApp/Instagram env vars
- `src/app/api/invoices/route.ts` — delegate POST to `invoiceService.create()`
- `src/app/api/receipts/route.ts` — delegate POST to `receiptService.create()`
- `src/app/api/bookings/route.ts` — delegate POST core to `bookingService.createWithPayment()`
- `src/app/api/webhooks/paystack/route.ts` — add receipt + owner-notify on `charge.success`

---

## Task 1: Data model, relations, and env vars

**Files:**
- Modify: `prisma/schema.prisma`, `src/env.js`, `.env.example`

**Interfaces:**
- Produces: enum `ChatChannel { WHATSAPP, INSTAGRAM }`; models `ChatIdentity`, `ChatSession`, `ChatLinkToken`; `Business.chatIdentities`. Env vars: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`, `META_APP_SECRET`, `INSTAGRAM_VERIFY_TOKEN`, `INSTAGRAM_IG_ID`, `INSTAGRAM_PAGE_TOKEN`.

- [ ] **Step 1: Add the enum and models to `prisma/schema.prisma`**

Append at the end of the file:

```prisma
enum ChatChannel {
  WHATSAPP
  INSTAGRAM
}

model ChatIdentity {
  id          String      @id @default(cuid())
  businessId  String
  channel     ChatChannel
  externalId  String // WhatsApp phone (E.164) or Instagram-scoped user ID (IGSID)
  displayName String?
  linkedAt    DateTime    @default(now())

  business Business     @relation(fields: [businessId], references: [id], onDelete: Cascade)
  session  ChatSession?

  @@unique([channel, externalId])
  @@index([businessId])
}

model ChatSession {
  id                 String   @id @default(cuid())
  identityId         String   @unique
  state              String   @default("MAIN_MENU")
  context            Json?
  lastProcessedMsgId String?
  lastActiveAt       DateTime @default(now())

  identity ChatIdentity @relation(fields: [identityId], references: [id], onDelete: Cascade)
}

model ChatLinkToken {
  id         String      @id @default(cuid())
  token      String      @unique
  channel    ChatChannel
  externalId String
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime    @default(now())

  @@index([token])
}
```

- [ ] **Step 2: Add the back-relation to `Business`**

Inside `model Business`, alongside the existing `services Service[]`, `bookings Booking[]`, … relations, add:

```prisma
  chatIdentities   ChatIdentity[]
```

- [ ] **Step 3: Add env vars to `src/env.js`**

In the `server:` object, after `CRON_SECRET: z.string().optional(),` add:

```js
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_TOKEN: z.string().optional(),
    META_APP_SECRET: z.string().optional(),
    INSTAGRAM_VERIFY_TOKEN: z.string().optional(),
    INSTAGRAM_IG_ID: z.string().optional(),
    INSTAGRAM_PAGE_TOKEN: z.string().optional(),
```

In the `runtimeEnv:` object, after `CRON_SECRET: process.env.CRON_SECRET,` add:

```js
    WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN,
    META_APP_SECRET: process.env.META_APP_SECRET,
    INSTAGRAM_VERIFY_TOKEN: process.env.INSTAGRAM_VERIFY_TOKEN,
    INSTAGRAM_IG_ID: process.env.INSTAGRAM_IG_ID,
    INSTAGRAM_PAGE_TOKEN: process.env.INSTAGRAM_PAGE_TOKEN,
```

- [ ] **Step 4: Document the vars in `.env.example`**

Append:

```bash
# WhatsApp Cloud API + Instagram Messaging (Meta)
WHATSAPP_VERIFY_TOKEN=""        # arbitrary string also set in the Meta webhook config
WHATSAPP_PHONE_NUMBER_ID=""     # from WhatsApp > API Setup
WHATSAPP_TOKEN=""               # permanent system-user access token
META_APP_SECRET=""              # Meta App > Settings > Basic > App Secret (webhook signature)
INSTAGRAM_VERIFY_TOKEN=""       # arbitrary string for the IG webhook config
INSTAGRAM_IG_ID=""              # Instagram professional account id (sends DMs)
INSTAGRAM_PAGE_TOKEN=""         # page/IG access token for messaging
```

- [ ] **Step 5: Generate the migration and Prisma client**

Run: `yarn db:generate`
Expected: a migration is created under `prisma/migrations/` and `prisma generate` succeeds. (Requires local Postgres; if unavailable, run `npx prisma generate` to regenerate the client and create the migration when the DB is up.)

- [ ] **Step 6: Verify type-check**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma src/env.js .env.example
git commit -m "feat: add chat messaging data model and Meta env vars"
```

---

## Task 2: Extract `InvoiceService.create()` and delegate the route

**Files:**
- Create: `src/backend/services/invoice/index.ts`, `src/backend/services/invoice/index.test.ts`
- Modify: `src/app/api/invoices/route.ts` (POST handler body only)

**Interfaces:**
- Consumes: `generateInvoicePdf` (`@/backend/services/pdf`), `cloudinaryService` (`@/backend/services/cloudinary`), `db`.
- Produces:
  ```ts
  type CreateInvoiceInput = {
    businessId: string; name: string; email?: string | null; phone?: string | null;
    status: import("@prisma/client").InvoiceStatus; currency: string;
    subtotal: number; taxAmount: number; discount: number; total: number; amountPaid: number;
    dueAt?: Date | null; sentAt?: Date | null; paidAt?: Date | null; notes?: string | null;
    bookingId?: string | null;
    services?: Array<{ serviceId: string; description?: string | null; quantity: number; unitPrice: number; total: number }>;
  };
  invoiceService.create(input: CreateInvoiceInput): Promise<import("@prisma/client").Invoice>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/invoice/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    invoice: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    booking: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/pdf", () => ({
  generateInvoicePdf: vi.fn().mockResolvedValue(Buffer.from("pdf")),
}));
vi.mock("@/backend/services/cloudinary", () => ({
  cloudinaryService: {
    uploadImage: vi.fn().mockResolvedValue({ secure_url: "https://cdn.test/INV-1001.pdf" }),
  },
}));

import { db } from "@/server/db";
import { invoiceService } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.invoice.findFirst.mockResolvedValue(null);
  mockedDb.invoice.findUnique.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.invoice.create.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    business: BUSINESS, services: [], subtotal: 5000, taxAmount: 0, discount: 0,
    total: 5000, amountPaid: 0, currency: "NGN", status: "SENT",
    dueAt: null, sentAt: null, paidAt: null, notes: "eggs",
    clientName: "Ada", clientEmail: null, clientPhone: null,
  });
  mockedDb.invoice.update.mockResolvedValue({
    id: "inv_1", slug: "acme-salon-inv-1001", invoiceNumber: "INV-1001",
    url: "https://cdn.test/INV-1001.pdf",
  });
});

describe("invoiceService.create", () => {
  it("creates the first invoice as INV-1001 and returns the record with a url", async () => {
    const result = await invoiceService.create({
      businessId: "biz_1", name: "Ada", status: "SENT", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 0, notes: "eggs",
    });
    expect(mockedDb.invoice.create.mock.calls[0]![0].data.invoiceNumber).toBe("INV-1001");
    expect(result.url).toBe("https://cdn.test/INV-1001.pdf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/invoice/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Implement `InvoiceService`**

Create `src/backend/services/invoice/index.ts`:

```ts
import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateInvoicePdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type Invoice, type InvoiceStatus } from "@prisma/client";
import slugify from "slugify";

export type CreateInvoiceInput = {
  businessId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  dueAt?: Date | null;
  sentAt?: Date | null;
  paidAt?: Date | null;
  notes?: string | null;
  bookingId?: string | null;
  services?: Array<{
    serviceId: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

class InvoiceService {
  async create(input: CreateInvoiceInput): Promise<Invoice> {
    return db.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: input.businessId },
      });
      if (!business) throw new NotFoundException("Business not found");

      const lastInvoice = await tx.invoice.findFirst({
        where: { businessId: business.id },
        orderBy: { createdAt: "desc" },
        select: { invoiceNumber: true },
      });
      let invoiceNumber = "INV-1001";
      if (lastInvoice && lastInvoice.invoiceNumber.startsWith("INV-")) {
        const n = parseInt(lastInvoice.invoiceNumber.replace("INV-", ""), 10);
        invoiceNumber = `INV-${isNaN(n) ? 1001 : n + 1}`;
      }

      const [booking, existingInvoice] = await Promise.all([
        input.bookingId
          ? tx.booking.findFirst({
              where: { id: input.bookingId, businessId: business.id },
            })
          : Promise.resolve(null),
        tx.invoice.findUnique({
          where: {
            businessId_invoiceNumber: { businessId: business.id, invoiceNumber },
          },
        }),
      ]);
      if (input.bookingId && !booking) {
        throw new BadRequestException("Booking not found for this business");
      }
      if (existingInvoice) {
        throw new ConflictException(
          `Invoice with number ${invoiceNumber} already exists for this business`,
        );
      }

      const lineItems = input.services ?? [];
      const serviceIds = Array.from(
        new Set(
          lineItems.map((i) => i.serviceId).filter((id): id is string => Boolean(id)),
        ),
      );
      if (serviceIds.length > 0) {
        const services = await tx.service.findMany({
          where: { id: { in: serviceIds }, businessId: business.id },
          select: { id: true },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            "One or more invoice item services do not belong to this business",
          );
        }
      }

      const createData: Prisma.InvoiceCreateInput = {
        business: { connect: { id: business.id } },
        slug: slugify(`${business.name}-${invoiceNumber}`, { lower: true, strict: true }),
        clientName: input.name,
        clientEmail: input.email ?? null,
        clientPhone: input.phone ?? null,
        invoiceNumber,
        status: input.status,
        currency: input.currency,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        discount: input.discount,
        total: input.total,
        amountPaid: input.amountPaid,
        dueAt: input.dueAt ?? null,
        sentAt: input.sentAt ?? null,
        paidAt: input.paidAt ?? null,
        notes: input.notes ?? null,
      };
      if (input.bookingId) createData.booking = { connect: { id: input.bookingId } };
      if (lineItems.length > 0) {
        createData.services = {
          create: lineItems.map((item) => ({
            serviceId: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        };
      }

      const invoice = await tx.invoice.create({
        data: createData,
        include: { business: true, services: { include: { service: true } } },
      });
      if (!invoice.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the invoice",
        );
      }

      const pdfBuffer = await generateInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        discount: invoice.discount.toString(),
        total: invoice.total.toString(),
        amountPaid: invoice.amountPaid.toString(),
        dueAt: invoice.dueAt,
        sentAt: invoice.sentAt,
        paidAt: invoice.paidAt,
        notes: invoice.notes,
        business: {
          name: invoice.business.name,
          email: invoice.business.email,
          phone: invoice.business.phone,
          city: invoice.business.city,
          state: invoice.business.state,
          country: invoice.business.country,
          logoUrl: invoice.business.logoUrl,
        },
        client: {
          name: invoice.clientName,
          email: invoice.clientEmail,
          phone: invoice.clientPhone,
        },
        items: invoice.services.map((item) => ({
          description: item.description || item.service.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${invoice.invoiceNumber}.pdf`,
        folder: `sara/businesses/${business.id}/invoices`,
        mime_type: "application/pdf",
        public_id: invoice.id,
        resource_type: "raw",
      });

      return tx.invoice.update({
        where: { id: invoice.id },
        data: { url: uploadResult.secure_url },
      });
    });
  }
}

export const invoiceService = new InvoiceService();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/invoice/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `POST /api/invoices` to delegate**

In `src/app/api/invoices/route.ts`, replace the whole `const invoicedata = await db.$transaction(async (tx) => { … });` block with:

```ts
      const invoicedata = await invoiceService.create({
        businessId: business.id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        status: payload.status,
        currency: payload.currency,
        subtotal: payload.subtotal,
        taxAmount: payload.taxAmount,
        discount: payload.discount,
        total: payload.total,
        amountPaid: payload.amountPaid,
        dueAt: payload.dueAt,
        sentAt: payload.sentAt,
        paidAt: payload.paidAt,
        notes: payload.notes,
        bookingId: payload.bookingId,
        services: payload.services,
      });
```

Add `import { invoiceService } from "@/backend/services/invoice";`. Remove now-unused `generateInvoicePdf`, `cloudinaryService`, `slugify` imports (keep `Prisma` — the GET handler uses it).

- [ ] **Step 6: Verify type-check and full test run**

Run: `yarn typecheck && yarn test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/services/invoice src/app/api/invoices/route.ts
git commit -m "refactor: extract invoice creation into InvoiceService"
```

---

## Task 3: Extract `ReceiptService.create()` and delegate the route

**Files:**
- Create: `src/backend/services/receipt/index.ts`, `src/backend/services/receipt/index.test.ts`
- Modify: `src/app/api/receipts/route.ts` (POST handler body only)

**Interfaces:**
- Produces:
  ```ts
  type CreateReceiptInput = {
    businessId: string; name?: string | null; email?: string | null; phone?: string | null;
    currency: string; subtotal: number; taxAmount: number; discount: number; total: number; amountPaid: number;
    paymentMethod?: import("@prisma/client").PaymentMethod | null; notes?: string | null; paymentId?: string | null;
    services?: Array<{ serviceId: string; description?: string | null; quantity: number; unitPrice: number; total: number }>;
  };
  receiptService.create(input: CreateReceiptInput): Promise<import("@prisma/client").Receipt>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/receipt/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    receipt: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn() },
    service: { findMany: vi.fn() },
    business: { findUnique: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
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

import { db } from "@/server/db";
import { receiptService } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", name: "Acme Salon", email: null, phone: null, city: null, state: null, country: null, logoUrl: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
  mockedDb.receipt.findFirst.mockResolvedValue(null);
  mockedDb.service.findMany.mockResolvedValue([]);
  mockedDb.receipt.create.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    business: BUSINESS, services: [], currency: "NGN", subtotal: 5000, taxAmount: 0,
    discount: 0, total: 5000, amountPaid: 5000, paymentMethod: null, notes: "gele",
    name: "Ada", email: null, phone: null, createdAt: new Date(),
  });
  mockedDb.receipt.update.mockResolvedValue({
    id: "rcp_1", slug: "acme-salon-rcp-1001", receiptNumber: "RCP-1001",
    url: "https://cdn.test/RCP-1001.pdf",
  });
});

describe("receiptService.create", () => {
  it("creates the first receipt as RCP-1001 and returns the record with a url", async () => {
    const result = await receiptService.create({
      businessId: "biz_1", name: "Ada", currency: "NGN",
      subtotal: 5000, taxAmount: 0, discount: 0, total: 5000, amountPaid: 5000, notes: "gele",
    });
    expect(mockedDb.receipt.create.mock.calls[0]![0].data.receiptNumber).toBe("RCP-1001");
    expect(result.url).toBe("https://cdn.test/RCP-1001.pdf");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/receipt/index.test.ts`
Expected: FAIL — `receiptService` undefined.

- [ ] **Step 3: Implement `ReceiptService`**

Create `src/backend/services/receipt/index.ts`:

```ts
import { cloudinaryService } from "@/backend/services/cloudinary";
import { generateReceiptPdf } from "@/backend/services/pdf";
import { db } from "@/server/db";
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { Prisma, type PaymentMethod, type Receipt } from "@prisma/client";
import slugify from "slugify";

export type CreateReceiptInput = {
  businessId: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discount: number;
  total: number;
  amountPaid: number;
  paymentMethod?: PaymentMethod | null;
  notes?: string | null;
  paymentId?: string | null;
  services?: Array<{
    serviceId: string;
    description?: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
};

class ReceiptService {
  async create(input: CreateReceiptInput): Promise<Receipt> {
    return db.$transaction(async (tx) => {
      const business = await tx.business.findUnique({
        where: { id: input.businessId },
      });
      if (!business) throw new NotFoundException("Business not found");

      let servicesToCreate = input.services ?? [];

      if (input.paymentId) {
        const payment = await tx.payment.findFirst({
          where: { id: input.paymentId, businessId: business.id },
          include: {
            receipt: { select: { id: true } },
            invoice: { include: { services: true } },
          },
        });
        if (!payment) throw new BadRequestException("Payment not found for this business");
        if (payment.receipt) {
          throw new ConflictException("A receipt already exists for this payment");
        }
        if (servicesToCreate.length === 0 && payment.invoice?.services) {
          servicesToCreate = payment.invoice.services.map((s) => ({
            serviceId: s.serviceId,
            description: s.description ?? undefined,
            quantity: s.quantity,
            unitPrice: Number(s.unitPrice),
            total: Number(s.total),
          }));
        }
      }

      if (servicesToCreate.length > 0) {
        const serviceIds = Array.from(new Set(servicesToCreate.map((s) => s.serviceId)));
        const services = await tx.service.findMany({
          where: { id: { in: serviceIds }, businessId: business.id },
          select: { id: true },
        });
        if (services.length !== serviceIds.length) {
          throw new BadRequestException(
            "One or more services do not belong to this business",
          );
        }
      }

      const lastReceipt = await tx.receipt.findFirst({
        where: { businessId: business.id },
        orderBy: { createdAt: "desc" },
        select: { receiptNumber: true },
      });
      let receiptNumber = "RCP-1001";
      if (lastReceipt && lastReceipt.receiptNumber.startsWith("RCP-")) {
        const n = parseInt(lastReceipt.receiptNumber.replace("RCP-", ""), 10);
        receiptNumber = `RCP-${isNaN(n) ? 1001 : n + 1}`;
      }

      const createData: Prisma.ReceiptCreateInput = {
        business: { connect: { id: business.id } },
        slug: slugify(`${business.name}-${receiptNumber}`, { lower: true, strict: true }),
        receiptNumber,
        name: input.name ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        currency: input.currency,
        subtotal: input.subtotal,
        taxAmount: input.taxAmount,
        discount: input.discount,
        total: input.total,
        amountPaid: input.amountPaid,
        paymentMethod: input.paymentMethod ?? null,
        notes: input.notes ?? null,
      };
      if (input.paymentId) createData.payment = { connect: { id: input.paymentId } };
      if (servicesToCreate.length > 0) {
        createData.services = {
          create: servicesToCreate.map((item) => ({
            serviceId: item.serviceId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
          })),
        };
      }

      const receipt = await tx.receipt.create({
        data: createData,
        include: { business: true, services: { include: { service: true } } },
      });
      if (!receipt.business) {
        throw new InternalServerErrorException(
          "Failed to retrieve business details for the receipt",
        );
      }

      const pdfBuffer = await generateReceiptPdf({
        receiptNumber: receipt.receiptNumber,
        paymentMethod: receipt.paymentMethod,
        currency: receipt.currency,
        subtotal: receipt.subtotal.toString(),
        taxAmount: receipt.taxAmount.toString(),
        discount: receipt.discount.toString(),
        total: receipt.total.toString(),
        amountPaid: receipt.amountPaid.toString(),
        paidAt: receipt.createdAt,
        notes: receipt.notes,
        business: {
          name: receipt.business.name,
          email: receipt.business.email,
          phone: receipt.business.phone,
          city: receipt.business.city,
          state: receipt.business.state,
          country: receipt.business.country,
          logoUrl: receipt.business.logoUrl,
        },
        client: {
          name: receipt.name || "Client",
          email: receipt.email,
          phone: receipt.phone,
        },
        items: receipt.services.map((item) => ({
          description: item.description || item.service.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          total: item.total.toString(),
        })),
      });

      const uploadResult = await cloudinaryService.uploadImage(pdfBuffer, {
        filename: `${receipt.receiptNumber}.pdf`,
        folder: `sara/businesses/${business.id}/receipts`,
        mime_type: "application/pdf",
        public_id: receipt.id,
        resource_type: "raw",
      });

      return tx.receipt.update({
        where: { id: receipt.id },
        data: { url: uploadResult.secure_url },
      });
    });
  }
}

export const receiptService = new ReceiptService();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/receipt/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `POST /api/receipts` to delegate**

In `src/app/api/receipts/route.ts`, replace the whole `const receiptResult = await db.$transaction(async (tx) => { … });` block with:

```ts
      const receiptResult = await receiptService.create({
        businessId: business.id,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        currency: payload.currency,
        subtotal: payload.subtotal,
        taxAmount: payload.taxAmount,
        discount: payload.discount,
        total: payload.total,
        amountPaid: payload.amountPaid,
        paymentMethod: payload.paymentMethod,
        notes: payload.notes,
        paymentId: payload.paymentId,
        services: payload.services,
      });
```

Add `import { receiptService } from "@/backend/services/receipt";`. Remove unused `generateReceiptPdf`, `cloudinaryService`, `slugify` imports (keep `Prisma` — the GET handler uses it).

- [ ] **Step 6: Verify type-check and full test run**

Run: `yarn typecheck && yarn test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/services/receipt src/app/api/receipts/route.ts
git commit -m "refactor: extract receipt creation into ReceiptService"
```

---

## Task 4: Extract `BookingService.createWithPayment()` and delegate the route

**Files:**
- Create: `src/backend/services/booking/index.ts`, `src/backend/services/booking/index.test.ts`
- Modify: `src/app/api/bookings/route.ts` (POST handler — replace validation+create+payment core, keep Atlas enrichment as a post-step)

**Interfaces:**
- Consumes: `paystackService.initializeTransaction` (`@/backend/services/paystack`), `db`, `slugify`.
- Produces:
  ```ts
  type CreateBookingInput = {
    serviceId?: string;      // either serviceId
    serviceSlug?: string;    // ...or serviceSlug (public route uses slug)
    startTime: Date; endTime: Date;
    clientName: string; clientEmail?: string | null; clientPhone?: string | null; notes?: string | null;
    payerEmailFallback?: string | null; // used when clientEmail is absent
  };
  type BookingWithPayment = {
    booking: import("@prisma/client").Booking;
    paymentUrl: string;
    paymentReference: string;
  };
  bookingService.createWithPayment(input: CreateBookingInput): Promise<BookingWithPayment>
  ```
  Throws `NotFoundException` (service missing), `BadRequestException` (inactive, no subaccount, invalid slot, slot taken).

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/booking/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    service: { findUnique: vi.fn(), findFirst: vi.fn() },
    booking: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});
vi.mock("@/backend/services/paystack", () => ({
  paystackService: {
    initializeTransaction: vi.fn().mockResolvedValue({
      authorization_url: "https://paystack.test/pay",
      reference: "ref_123",
    }),
  },
}));

import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { bookingService } from "./index";

const mockedDb = db as any;
const SERVICE = {
  id: "svc_1", name: "Haircut", duration: 60, isActive: true, price: 5000,
  businessId: "biz_1",
  business: { id: "biz_1", ownerId: "user_1", name: "Acme", paystackSubaccountCode: "ACCT_1", currency: "NGN" },
};
const START = new Date(Date.now() + 24 * 60 * 60 * 1000);
const END = new Date(START.getTime() + 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  mockedDb.service.findUnique.mockResolvedValue(SERVICE);
  mockedDb.service.findFirst.mockResolvedValue(SERVICE);
  mockedDb.booking.findFirst.mockResolvedValue(null);
  mockedDb.booking.findUnique.mockResolvedValue(null);
  mockedDb.booking.create.mockResolvedValue({
    id: "bkg_1", slug: "haircut-ada-1", businessId: "biz_1", serviceId: "svc_1",
    startTime: START, endTime: END, status: "PENDING",
  });
});

describe("bookingService.createWithPayment", () => {
  it("creates a PENDING booking and returns a payment url", async () => {
    const result = await bookingService.createWithPayment({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    });
    expect(result.paymentUrl).toBe("https://paystack.test/pay");
    expect(result.paymentReference).toBe("ref_123");
    expect(paystackService.initializeTransaction).toHaveBeenCalled();
  });

  it("rejects an overlapping slot", async () => {
    mockedDb.booking.findFirst.mockResolvedValue({ id: "existing" });
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(paystackService.initializeTransaction).not.toHaveBeenCalled();
  });

  it("rejects when the business has no Paystack subaccount", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      ...SERVICE, business: { ...SERVICE.business, paystackSubaccountCode: null },
    });
    await expect(
      bookingService.createWithPayment({
        serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/booking/index.test.ts`
Expected: FAIL — `bookingService` undefined.

- [ ] **Step 3: Implement `BookingService`**

Create `src/backend/services/booking/index.ts`:

```ts
import { paystackService } from "@/backend/services/paystack";
import { db } from "@/server/db";
import { BadRequestException, NotFoundException } from "@/utils/exceptions";
import { type Booking, type Prisma } from "@prisma/client";
import slugify from "slugify";

export type CreateBookingInput = {
  serviceId?: string;
  serviceSlug?: string;
  startTime: Date;
  endTime: Date;
  clientName: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  notes?: string | null;
  payerEmailFallback?: string | null;
};

export type BookingWithPayment = {
  booking: Booking;
  paymentUrl: string;
  paymentReference: string;
};

class BookingService {
  async createWithPayment(
    input: CreateBookingInput,
  ): Promise<BookingWithPayment> {
    if (!input.serviceId && !input.serviceSlug) {
      throw new BadRequestException("A serviceId or serviceSlug is required");
    }

    const businessSelect = {
      business: {
        select: {
          id: true,
          name: true,
          paystackSubaccountCode: true,
          currency: true,
        },
      },
    } as const;

    const service = input.serviceId
      ? await db.service.findUnique({
          where: { id: input.serviceId },
          include: businessSelect,
        })
      : await db.service.findFirst({
          where: { slug: input.serviceSlug },
          include: businessSelect,
        });

    if (!service) throw new NotFoundException("Service not found");
    if (!service.isActive) {
      throw new BadRequestException(
        "This service is currently unavailable for booking",
      );
    }
    if (!service.business.paystackSubaccountCode) {
      throw new BadRequestException(
        "This business has not set up payment processing. Please contact the service provider.",
      );
    }

    const startTime = input.startTime;
    const endTime = input.endTime;
    if (startTime >= endTime) {
      throw new BadRequestException("startTime must be before endTime");
    }
    if (startTime < new Date()) {
      throw new BadRequestException("Cannot book a slot in the past");
    }
    const slotMinutes = (endTime.getTime() - startTime.getTime()) / (60 * 1000);
    if (slotMinutes !== service.duration) {
      throw new BadRequestException(
        `Slot duration (${slotMinutes} min) does not match service duration (${service.duration} min)`,
      );
    }

    const overlapping = await db.booking.findFirst({
      where: {
        businessId: service.business.id,
        status: { in: ["PENDING", "CONFIRMED"] },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
    });
    if (overlapping) {
      throw new BadRequestException(
        "This time slot is already booked. Please select a different slot.",
      );
    }

    const booking = await db.$transaction(async (tx) => {
      let slug = slugify(`${service.name}-${input.clientName}-${Date.now()}`, {
        lower: true,
        strict: true,
      });
      let attempts = 0;
      while (attempts < 10) {
        const existing = await tx.booking.findUnique({ where: { slug } });
        if (!existing) break;
        slug = `${slug}-${Math.random().toString(36).substring(2, 7)}`;
        attempts++;
      }

      const data: Prisma.BookingCreateInput = {
        slug,
        business: { connect: { id: service.business.id } },
        service: { connect: { id: service.id } },
        startTime,
        endTime,
        clientName: input.clientName,
        clientEmail: input.clientEmail ?? null,
        clientPhone: input.clientPhone ?? null,
        notes: input.notes ?? null,
        status: "PENDING",
      };
      return tx.booking.create({ data });
    });

    const amountInSmallestUnit = Math.round(Number(service.price) * 100);
    const payerEmail =
      input.clientEmail || input.payerEmailFallback || "customer@sara.app";

    const transaction = await paystackService.initializeTransaction({
      email: payerEmail,
      amount: amountInSmallestUnit,
      subaccountCode: service.business.paystackSubaccountCode,
      metadata: {
        bookingId: booking.id,
        bookingSlug: booking.slug,
        serviceId: service.id,
        serviceName: service.name,
        businessId: service.business.id,
        businessName: service.business.name,
        clientName: input.clientName,
      },
      bearer: "account",
    });

    return {
      booking,
      paymentUrl: transaction.authorization_url,
      paymentReference: transaction.reference,
    };
  }
}

export const bookingService = new BookingService();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/booking/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor `POST /api/bookings` to delegate the core**

In `src/app/api/bookings/route.ts`, replace everything from `// 1. Fetch the service …` down to and including the `// 6. Initialize Paystack transaction …` block and the `paystackTransaction` creation — i.e. the service lookup, validation, overlap check, booking `$transaction`, and Paystack init — with a single call, while **keeping** the Atlas enrichment (step 5b) as a post-step:

```ts
      const { booking, paymentUrl, paymentReference } =
        await bookingService.createWithPayment({
          serviceId: payload.serviceId,
          startTime: new Date(payload.startTime),
          endTime: new Date(payload.endTime),
          clientName: payload.clientName,
          clientEmail: payload.clientEmail,
          clientPhone: payload.clientPhone,
          notes: payload.notes,
          payerEmailFallback: user.email,
        });

      // Best-effort Atlas route enrichment (non-fatal).
      if (payload.clientLat != null && payload.clientLong != null) {
        const businessCoords = await db.business.findUnique({
          where: { id: booking.businessId },
          select: { latitude: true, longitude: true },
        });
        if (businessCoords?.latitude != null && businessCoords?.longitude != null) {
          try {
            const routeResult = await atlasService.route(
              { lat: payload.clientLat, lon: payload.clientLong },
              { lat: Number(businessCoords.latitude), lon: Number(businessCoords.longitude) },
              "car",
            );
            await db.booking.update({
              where: { id: booking.id },
              data: {
                clientLat: payload.clientLat,
                clientLong: payload.clientLong,
                distanceKm: routeResult.distance_m / 1000,
                durationMin: Math.ceil(routeResult.duration_s / 60),
                routePolyline: JSON.stringify(routeResult.geometry),
              },
            });
          } catch (routeError: any) {
            console.warn("Atlas routing failed:", routeError.message);
          }
        }
      }

      const response: ApiResponse<CreatedBooking> = {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: { ...booking, paymentUrl, paymentReference },
      };

      return NextResponse.json(response, { status: 201 });
```

Add `import { bookingService } from "@/backend/services/booking";`. Remove the now-unused `paystackService` and `slugify` imports (keep `atlasService`, `db`, `Prisma`/`Booking` types as still referenced).

- [ ] **Step 6: Run the existing bookings route test + type-check**

Run: `yarn test src/app/api/bookings/route.test.ts && yarn typecheck`
Expected: PASS — the existing overlap-scoping test still passes (the overlap check now lives in `BookingService` but uses the same mocked `db`).

- [ ] **Step 7: Commit**

```bash
git add src/backend/services/booking src/app/api/bookings/route.ts
git commit -m "refactor: extract booking+payment creation into BookingService"
```

---

## Task 5: Messaging channel types + URL helpers

**Files:**
- Create: `src/backend/services/messaging/channels/types.ts`
- Create: `src/backend/services/messaging/url.ts`, `src/backend/services/messaging/url.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type InboundMessage = { channel: ChatChannel; externalId: string; text: string; messageId: string; displayName?: string };
  type OutboundMessage = { text: string };
  interface ChannelAdapter { channel: ChatChannel; verify(req: Request): Response; isAuthentic(req: Request, rawBody: string): boolean; normalizeInbound(payload: unknown): InboundMessage[]; send(externalId: string, message: OutboundMessage): Promise<void>; }
  appBaseUrl(): string
  publicUrl(path: string, slug: string): string
  ```

- [ ] **Step 1: Create the types file**

Create `src/backend/services/messaging/channels/types.ts`:

```ts
import type { ChatChannel } from "@prisma/client";

export type InboundMessage = {
  channel: ChatChannel;
  externalId: string;
  text: string;
  messageId: string;
  displayName?: string;
};

export type OutboundMessage = {
  text: string;
};

export interface ChannelAdapter {
  channel: ChatChannel;
  verify(req: Request): Response;
  isAuthentic(req: Request, rawBody: string): boolean;
  normalizeInbound(payload: unknown): InboundMessage[];
  send(externalId: string, message: OutboundMessage): Promise<void>;
}
```

- [ ] **Step 2: Write the failing test for URL helpers**

Create `src/backend/services/messaging/url.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { appBaseUrl, publicUrl } from "./url";

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original;
});

describe("url helpers", () => {
  it("strips a trailing slash from the base url", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng/";
    expect(appBaseUrl()).toBe("https://app.sara.ng");
  });
  it("builds a public url from a path and slug", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng";
    expect(publicUrl("book", "acme-haircut")).toBe("https://app.sara.ng/book/acme-haircut");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/url.test.ts`
Expected: FAIL — cannot resolve `./url`.

- [ ] **Step 4: Implement the URL helpers**

Create `src/backend/services/messaging/url.ts`:

```ts
export function appBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://sara.app";
  return base.replace(/\/$/, "");
}

export function publicUrl(path: string, slug: string): string {
  return `${appBaseUrl()}/${path}/${slug}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/url.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/messaging/channels/types.ts src/backend/services/messaging/url.ts src/backend/services/messaging/url.test.ts
git commit -m "feat: add messaging channel types and url helpers"
```

---

## Task 6: Amount parsing + money formatting

**Files:**
- Create: `src/backend/services/messaging/engine/amount.ts`, `src/backend/services/messaging/engine/amount.test.ts`

**Interfaces:**
- Produces: `parseAmount(text: string): number | null`; `formatMoney(amount: number, currency: string): string`.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/engine/amount.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatMoney, parseAmount } from "./amount";

describe("parseAmount", () => {
  it("parses plain digits", () => expect(parseAmount("5000")).toBe(5000));
  it("ignores commas and currency symbols", () => expect(parseAmount("₦15,000")).toBe(15000));
  it("expands a trailing k as thousands", () => expect(parseAmount("15k")).toBe(15000));
  it("returns null for non-numeric input", () => expect(parseAmount("abc")).toBeNull());
  it("returns null for zero or negative", () => {
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("-100")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("formats with separators and currency", () =>
    expect(formatMoney(15000, "NGN")).toBe("NGN 15,000"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/engine/amount.test.ts`
Expected: FAIL — cannot resolve `./amount`.

- [ ] **Step 3: Implement amount helpers**

Create `src/backend/services/messaging/engine/amount.ts`:

```ts
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  const kMatch = /^(\d+(?:\.\d+)?)\s*k$/.exec(trimmed.replace(/[, ]/g, ""));
  if (kMatch) {
    const value = parseFloat(kMatch[1]!) * 1000;
    return value > 0 ? value : null;
  }
  const cleaned = trimmed.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = parseFloat(cleaned);
  if (isNaN(value) || value <= 0) return null;
  return value;
}

export function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${currency} ${formatted}` : formatted;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/engine/amount.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/engine/amount.ts src/backend/services/messaging/engine/amount.test.ts
git commit -m "feat: add chat amount parsing and money formatting"
```

---

## Task 7: ChatSessionService

**Files:**
- Create: `src/backend/services/messaging/session/index.ts`, `src/backend/services/messaging/session/index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type IdentityWithSession = ChatIdentity & { session: ChatSession | null };
  chatSessionService.findIdentity(channel: ChatChannel, externalId: string): Promise<IdentityWithSession | null>
  chatSessionService.getOrCreateSession(identityId: string): Promise<ChatSession>
  chatSessionService.save(sessionId: string, data: { state: string; context: Prisma.InputJsonValue | null; lastProcessedMsgId: string }): Promise<void>
  chatSessionService.isStale(session: ChatSession): boolean
  ```

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/session/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    chatIdentity: { findUnique: vi.fn() },
    chatSession: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return { db };
});

import { db } from "@/server/db";
import { chatSessionService } from "./index";

const mockedDb = db as any;
beforeEach(() => vi.clearAllMocks());

describe("chatSessionService", () => {
  it("returns null when no identity exists", async () => {
    mockedDb.chatIdentity.findUnique.mockResolvedValue(null);
    expect(await chatSessionService.findIdentity("WHATSAPP", "234800")).toBeNull();
  });

  it("creates a session when one does not exist", async () => {
    mockedDb.chatSession.findUnique.mockResolvedValue(null);
    mockedDb.chatSession.create.mockResolvedValue({
      id: "sess_1", identityId: "id_1", state: "MAIN_MENU",
      context: null, lastProcessedMsgId: null, lastActiveAt: new Date(),
    });
    const session = await chatSessionService.getOrCreateSession("id_1");
    expect(session.state).toBe("MAIN_MENU");
    expect(mockedDb.chatSession.create).toHaveBeenCalled();
  });

  it("treats a session older than 24h as stale", () => {
    expect(chatSessionService.isStale({ lastActiveAt: new Date(Date.now() - 25 * 3600 * 1000) } as any)).toBe(true);
    expect(chatSessionService.isStale({ lastActiveAt: new Date() } as any)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/session/index.test.ts`
Expected: FAIL — `chatSessionService` undefined.

- [ ] **Step 3: Implement the service**

Create `src/backend/services/messaging/session/index.ts`:

```ts
import { db } from "@/server/db";
import {
  Prisma,
  type ChatChannel,
  type ChatIdentity,
  type ChatSession,
} from "@prisma/client";

export type IdentityWithSession = ChatIdentity & {
  session: ChatSession | null;
};

const STALE_MS = 24 * 60 * 60 * 1000;

class ChatSessionService {
  async findIdentity(
    channel: ChatChannel,
    externalId: string,
  ): Promise<IdentityWithSession | null> {
    return db.chatIdentity.findUnique({
      where: { channel_externalId: { channel, externalId } },
      include: { session: true },
    });
  }

  async getOrCreateSession(identityId: string): Promise<ChatSession> {
    const existing = await db.chatSession.findUnique({ where: { identityId } });
    if (existing) return existing;
    return db.chatSession.create({ data: { identityId } });
  }

  async save(
    sessionId: string,
    data: {
      state: string;
      context: Prisma.InputJsonValue | null;
      lastProcessedMsgId: string;
    },
  ): Promise<void> {
    await db.chatSession.update({
      where: { id: sessionId },
      data: {
        state: data.state,
        context: data.context ?? Prisma.JsonNull,
        lastProcessedMsgId: data.lastProcessedMsgId,
        lastActiveAt: new Date(),
      },
    });
  }

  isStale(session: ChatSession): boolean {
    return Date.now() - new Date(session.lastActiveAt).getTime() > STALE_MS;
  }
}

export const chatSessionService = new ChatSessionService();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/session/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/session
git commit -m "feat: add ChatSessionService for chat conversation state"
```

---

## Task 8: LinkingService + link web route

**Files:**
- Create: `src/backend/services/messaging/linking/index.ts`, `src/backend/services/messaging/linking/index.test.ts`
- Create: `src/backend/services/messaging/linking/validator.ts`
- Create: `src/app/api/messaging/link/route.ts`

**Interfaces:**
- Produces:
  ```ts
  linkingService.issueToken(channel: ChatChannel, externalId: string): Promise<string>
  linkingService.buildLinkUrl(token: string): string
  linkingService.consumeToken(token: string, businessId: string): Promise<ChatIdentity>
  linkValidatorSchema  // { token: string }
  POST /api/messaging/link
  ```

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/linking/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    chatLinkToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    chatIdentity: { upsert: vi.fn() },
  };
  db.$transaction = vi.fn(async (cb: (tx: typeof db) => unknown) => cb(db));
  return { db };
});

import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import { linkingService } from "./index";

const mockedDb = db as any;
beforeEach(() => vi.clearAllMocks());

describe("linkingService", () => {
  it("issues and persists a token", async () => {
    mockedDb.chatLinkToken.create.mockResolvedValue({ token: "abc" });
    const token = await linkingService.issueToken("WHATSAPP", "234800");
    expect(typeof token).toBe("string");
    expect(mockedDb.chatLinkToken.create).toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    mockedDb.chatLinkToken.findUnique.mockResolvedValue({
      id: "t1", token: "abc", channel: "WHATSAPP", externalId: "234800",
      expiresAt: new Date(Date.now() - 1000), consumedAt: null,
    });
    await expect(linkingService.consumeToken("abc", "biz_1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("creates an identity and consumes a valid token", async () => {
    mockedDb.chatLinkToken.findUnique.mockResolvedValue({
      id: "t1", token: "abc", channel: "WHATSAPP", externalId: "234800",
      expiresAt: new Date(Date.now() + 60_000), consumedAt: null,
    });
    mockedDb.chatIdentity.upsert.mockResolvedValue({
      id: "id_1", businessId: "biz_1", channel: "WHATSAPP", externalId: "234800",
    });
    const identity = await linkingService.consumeToken("abc", "biz_1");
    expect(identity.businessId).toBe("biz_1");
    expect(mockedDb.chatLinkToken.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/linking/index.test.ts`
Expected: FAIL — `linkingService` undefined.

- [ ] **Step 3: Implement the service**

Create `src/backend/services/messaging/linking/index.ts`:

```ts
import { db } from "@/server/db";
import { BadRequestException } from "@/utils/exceptions";
import type { ChatChannel, ChatIdentity } from "@prisma/client";
import crypto from "node:crypto";
import { appBaseUrl } from "../url";

const TOKEN_TTL_MS = 15 * 60 * 1000;

class LinkingService {
  async issueToken(channel: ChatChannel, externalId: string): Promise<string> {
    const token = crypto.randomBytes(24).toString("hex");
    await db.chatLinkToken.create({
      data: {
        token,
        channel,
        externalId,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });
    return token;
  }

  buildLinkUrl(token: string): string {
    return `${appBaseUrl()}/link?t=${token}`;
  }

  async consumeToken(token: string, businessId: string): Promise<ChatIdentity> {
    return db.$transaction(async (tx) => {
      const record = await tx.chatLinkToken.findUnique({ where: { token } });
      if (!record) {
        throw new BadRequestException("Invalid link. Please request a new one.");
      }
      if (record.consumedAt) {
        throw new BadRequestException("This link has already been used.");
      }
      if (record.expiresAt < new Date()) {
        throw new BadRequestException("This link has expired. Please request a new one.");
      }

      const identity = await tx.chatIdentity.upsert({
        where: {
          channel_externalId: {
            channel: record.channel,
            externalId: record.externalId,
          },
        },
        create: {
          businessId,
          channel: record.channel,
          externalId: record.externalId,
        },
        update: { businessId },
      });

      await tx.chatLinkToken.update({
        where: { token },
        data: { consumedAt: new Date() },
      });

      return identity;
    });
  }
}

export const linkingService = new LinkingService();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/linking/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the link validator**

Create `src/backend/services/messaging/linking/validator.ts`:

```ts
import { z } from "zod";

export const linkValidatorSchema = z
  .object({ token: z.string().min(1, "token is required") })
  .strict();

export type LinkValidatorSchema = z.infer<typeof linkValidatorSchema>;
```

- [ ] **Step 6: Implement the link web route**

Create `src/app/api/messaging/link/route.ts`:

```ts
import {
  authMiddleware,
  bodyValidatorMiddleware,
  withMiddleware,
} from "@/backend/middleware";
import { linkingService } from "@/backend/services/messaging/linking";
import {
  linkValidatorSchema,
  type LinkValidatorSchema,
} from "@/backend/services/messaging/linking/validator";
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@/utils/exceptions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @body LinkValidatorSchema
 * @description Binds a WhatsApp/Instagram chat identity (from a link token) to the
 *              authenticated owner's business.
 * @auth bearer
 */
export const POST = withMiddleware<LinkValidatorSchema>(
  async (request) => {
    try {
      const { token } = request.validatedData!;
      const user = request.user!;
      const business = user.business;
      if (!business) throw new NotFoundException("Business not found");
      if (business.ownerId !== user.id) {
        throw new ForbiddenException("You cannot link a chat to this business");
      }

      await linkingService.consumeToken(token, business.id);

      return NextResponse.json({
        status: 200,
        message: "Your chat is now connected. Send a message to get started.",
      });
    } catch (error: any) {
      if (error.statusCode) throw error;
      throw new InternalServerErrorException(
        `An error occurred while linking chat: ${error.message}`,
      );
    }
  },
  [authMiddleware, bodyValidatorMiddleware(linkValidatorSchema)],
);
```

- [ ] **Step 7: Verify type-check passes**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/backend/services/messaging/linking src/app/api/messaging/link
git commit -m "feat: add chat linking service and web route"
```

---

## Task 9: IntentDispatcher

**Files:**
- Create: `src/backend/services/messaging/dispatch/index.ts`, `src/backend/services/messaging/dispatch/index.test.ts`

**Interfaces:**
- Consumes: `invoiceService.create`, `receiptService.create`, `db`, `publicUrl`/`appBaseUrl` (`../url`), `formatMoney` (`../engine/amount`).
- Produces:
  ```ts
  type WriteDraft = { customerName: string; amount: number; description?: string };
  type WriteResult = { number: string; link: string };
  type ServiceOption = { slug: string; label: string };
  intentDispatcher.createInvoice(businessId, draft: WriteDraft): Promise<WriteResult>
  intentDispatcher.createReceipt(businessId, draft: WriteDraft): Promise<WriteResult>
  intentDispatcher.listServiceOptions(businessId): Promise<ServiceOption[]>
  intentDispatcher.bookingLinkText(option: ServiceOption): string
  intentDispatcher.listUnpaidInvoices(businessId): Promise<string>
  intentDispatcher.listTodayBookings(businessId): Promise<string>
  intentDispatcher.businessSummary(businessId): Promise<string>
  ```

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/dispatch/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = {
    business: { findUnique: vi.fn() },
    service: { findMany: vi.fn() },
    invoice: { findMany: vi.fn(), count: vi.fn() },
    booking: { findMany: vi.fn() },
    payment: { aggregate: vi.fn() },
  };
  return { db };
});
vi.mock("@/backend/services/invoice", () => ({ invoiceService: { create: vi.fn() } }));
vi.mock("@/backend/services/receipt", () => ({ receiptService: { create: vi.fn() } }));

import { invoiceService } from "@/backend/services/invoice";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { intentDispatcher } from "./index";

const mockedDb = db as any;
const BUSINESS = { id: "biz_1", currency: "NGN" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = "https://app.sara.ng";
  mockedDb.business.findUnique.mockResolvedValue(BUSINESS);
});

describe("createInvoice", () => {
  it("creates a SENT invoice in business currency and returns number + link", async () => {
    (invoiceService.create as any).mockResolvedValue({
      invoiceNumber: "INV-1012", slug: "acme-inv-1012", url: "https://cdn.test/INV-1012.pdf",
    });
    const result = await intentDispatcher.createInvoice("biz_1", {
      customerName: "Ada", amount: 15000, description: "gele",
    });
    expect(invoiceService.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: "SENT", currency: "NGN", total: 15000, amountPaid: 0, notes: "gele" }),
    );
    expect(result).toEqual({ number: "INV-1012", link: "https://cdn.test/INV-1012.pdf" });
  });
});

describe("createReceipt", () => {
  it("creates a fully-paid receipt", async () => {
    (receiptService.create as any).mockResolvedValue({
      receiptNumber: "RCP-1007", slug: "acme-rcp-1007", url: "https://cdn.test/RCP-1007.pdf",
    });
    const result = await intentDispatcher.createReceipt("biz_1", { customerName: "Ada", amount: 15000 });
    expect(receiptService.create).toHaveBeenCalledWith(expect.objectContaining({ total: 15000, amountPaid: 15000 }));
    expect(result.number).toBe("RCP-1007");
  });
});

describe("service options + booking link", () => {
  it("lists active services and builds a booking link", async () => {
    mockedDb.service.findMany.mockResolvedValue([
      { slug: "acme-haircut", name: "Haircut", price: 5000, duration: 60, currency: "NGN" },
    ]);
    const options = await intentDispatcher.listServiceOptions("biz_1");
    expect(options).toEqual([{ slug: "acme-haircut", label: "Haircut — NGN 5,000 (60 min)" }]);
    expect(intentDispatcher.bookingLinkText(options[0]!)).toContain("https://app.sara.ng/book/acme-haircut");
  });
});

describe("listUnpaidInvoices", () => {
  it("summarises unpaid invoices", async () => {
    mockedDb.invoice.findMany.mockResolvedValue([
      { invoiceNumber: "INV-1001", clientName: "Ada", total: 15000, amountPaid: 0, currency: "NGN" },
    ]);
    const text = await intentDispatcher.listUnpaidInvoices("biz_1");
    expect(text).toContain("Ada");
    expect(text).toContain("INV-1001");
  });
  it("handles an empty list", async () => {
    mockedDb.invoice.findMany.mockResolvedValue([]);
    expect((await intentDispatcher.listUnpaidInvoices("biz_1")).toLowerCase()).toContain("no unpaid");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: FAIL — `intentDispatcher` undefined.

- [ ] **Step 3: Implement the dispatcher**

Create `src/backend/services/messaging/dispatch/index.ts`:

```ts
import { invoiceService } from "@/backend/services/invoice";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import { formatMoney } from "../engine/amount";
import { publicUrl } from "../url";

export type WriteDraft = {
  customerName: string;
  amount: number;
  description?: string;
};
export type WriteResult = { number: string; link: string };
export type ServiceOption = { slug: string; label: string };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}
function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
}

class IntentDispatcher {
  private async currencyFor(businessId: string): Promise<string> {
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    if (!business) throw new NotFoundException("Business not found");
    return business.currency;
  }

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
    });
    return {
      number: invoice.invoiceNumber,
      link: invoice.url ?? publicUrl("invoices", invoice.slug),
    };
  }

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
    });
    return {
      number: receipt.receiptNumber,
      link: receipt.url ?? publicUrl("receipts", receipt.slug),
    };
  }

  async listServiceOptions(businessId: string): Promise<ServiceOption[]> {
    const currency = await this.currencyFor(businessId);
    const services = await db.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { slug: true, name: true, price: true, duration: true },
    });
    return services.map((s) => ({
      slug: s.slug,
      label: `${s.name} — ${formatMoney(Number(s.price), currency)} (${s.duration} min)`,
    }));
  }

  bookingLinkText(option: ServiceOption): string {
    const link = publicUrl("book", option.slug);
    return (
      `Share this booking link with your customer:\n${link}\n` +
      `— — —\nHi! You can book here: ${link}\n— — —`
    );
  }

  async listUnpaidInvoices(businessId: string): Promise<string> {
    const invoices = await db.invoice.findMany({
      where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { invoiceNumber: true, clientName: true, total: true, amountPaid: true, currency: true },
    });
    if (invoices.length === 0) return "✅ No unpaid invoices. You're all settled up!";
    const lines = invoices.map((inv) => {
      const outstanding = Number(inv.total) - Number(inv.amountPaid);
      return `• ${inv.clientName} — ${formatMoney(outstanding, inv.currency)} (${inv.invoiceNumber})`;
    });
    return `🧾 Unpaid invoices:\n${lines.join("\n")}`;
  }

  async listTodayBookings(businessId: string): Promise<string> {
    const bookings = await db.booking.findMany({
      where: {
        businessId,
        startTime: { gte: startOfToday(), lt: endOfToday() },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { startTime: "asc" },
      take: 20,
      select: { startTime: true, clientName: true, service: { select: { name: true } } },
    });
    if (bookings.length === 0) return "📅 No bookings today.";
    const lines = bookings.map((b) => {
      const time = b.startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `• ${time} — ${b.service.name} (${b.clientName})`;
    });
    return `📅 Today's bookings:\n${lines.join("\n")}`;
  }

  async businessSummary(businessId: string): Promise<string> {
    const currency = await this.currencyFor(businessId);
    const [todayAgg, weekAgg, unpaidCount] = await Promise.all([
      db.payment.aggregate({ where: { businessId, createdAt: { gte: startOfToday() } }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { businessId, createdAt: { gte: startOfWeek() } }, _sum: { amount: true } }),
      db.invoice.count({ where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }),
    ]);
    return [
      "📊 Business summary",
      `• Today's revenue: ${formatMoney(Number(todayAgg._sum.amount ?? 0), currency)}`,
      `• This week: ${formatMoney(Number(weekAgg._sum.amount ?? 0), currency)}`,
      `• Unpaid invoices: ${unpaidCount}`,
    ].join("\n");
  }
}

export const intentDispatcher = new IntentDispatcher();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/dispatch/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/dispatch
git commit -m "feat: add IntentDispatcher mapping chat intents to services"
```

---

## Task 10: ConversationEngine

**Files:**
- Create: `src/backend/services/messaging/engine/index.ts`, `src/backend/services/messaging/engine/index.test.ts`

**Interfaces:**
- Consumes: `chatSessionService`, `linkingService`, `intentDispatcher`, `parseAmount`/`formatMoney` (`./amount`), types (`../channels/types`).
- Produces: `conversationEngine.handle(message: InboundMessage): Promise<OutboundMessage | null>` (null = nothing to send, e.g. duplicate messageId).

**States:** `MAIN_MENU`, `INVOICE_CUSTOMER`, `INVOICE_AMOUNT`, `INVOICE_DESC`, `INVOICE_CONFIRM`, `RECEIPT_CUSTOMER`, `RECEIPT_AMOUNT`, `RECEIPT_DESC`, `RECEIPT_CONFIRM`, `SHARE_SERVICE_SELECT`.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/engine/index.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: FAIL — `conversationEngine` undefined.

- [ ] **Step 3: Implement the engine**

Create `src/backend/services/messaging/engine/index.ts`:

```ts
import type { Prisma } from "@prisma/client";
import type { InboundMessage, OutboundMessage } from "../channels/types";
import {
  intentDispatcher,
  type ServiceOption,
} from "../dispatch";
import { linkingService } from "../linking";
import { chatSessionService } from "../session";
import { formatMoney, parseAmount } from "./amount";

const MAIN_MENU =
  "Sara 👋  Reply with a number:\n" +
  "1️⃣ New invoice\n" +
  "2️⃣ New receipt\n" +
  "3️⃣ Share a service (booking link)\n" +
  "4️⃣ Unpaid invoices\n" +
  "5️⃣ Today's bookings\n" +
  "6️⃣ Business summary";

type Draft = {
  customerName?: string;
  amount?: number;
  description?: string;
  services?: ServiceOption[];
};

type HandlerCtx = { text: string; businessId: string; context: Draft };
type HandlerResult = {
  reply: OutboundMessage;
  nextState: string;
  context: Draft | null;
};

function text(body: string): OutboundMessage {
  return { text: body };
}

class ConversationEngine {
  async handle(message: InboundMessage): Promise<OutboundMessage | null> {
    const identity = await chatSessionService.findIdentity(
      message.channel,
      message.externalId,
    );

    if (!identity) {
      const token = await linkingService.issueToken(message.channel, message.externalId);
      const url = linkingService.buildLinkUrl(token);
      return text(`👋 Welcome to Sara! Connect your business to get started:\n${url}`);
    }

    const session = await chatSessionService.getOrCreateSession(identity.id);
    if (session.lastProcessedMsgId === message.messageId) return null;

    let state = session.state;
    let context = (session.context as Draft | null) ?? {};
    if (chatSessionService.isStale(session)) {
      state = "MAIN_MENU";
      context = {};
    }

    const trimmed = message.text.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "menu" || lower === "0") {
      state = "MAIN_MENU";
      context = {};
    } else if (lower === "cancel") {
      await chatSessionService.save(session.id, {
        state: "MAIN_MENU",
        context: null,
        lastProcessedMsgId: message.messageId,
      });
      return text(`Cancelled.\n\n${MAIN_MENU}`);
    }

    const result = await this.route(state, {
      text: trimmed,
      businessId: identity.businessId,
      context,
    });

    await chatSessionService.save(session.id, {
      state: result.nextState,
      context: (result.context as Prisma.InputJsonValue | null) ?? null,
      lastProcessedMsgId: message.messageId,
    });

    return result.reply;
  }

  private async route(state: string, ctx: HandlerCtx): Promise<HandlerResult> {
    switch (state) {
      case "INVOICE_CUSTOMER": return this.collectCustomer(ctx, "INVOICE");
      case "INVOICE_AMOUNT": return this.collectAmount(ctx, "INVOICE");
      case "INVOICE_DESC": return this.collectDesc(ctx, "INVOICE");
      case "INVOICE_CONFIRM": return this.confirm(ctx, "INVOICE");
      case "RECEIPT_CUSTOMER": return this.collectCustomer(ctx, "RECEIPT");
      case "RECEIPT_AMOUNT": return this.collectAmount(ctx, "RECEIPT");
      case "RECEIPT_DESC": return this.collectDesc(ctx, "RECEIPT");
      case "RECEIPT_CONFIRM": return this.confirm(ctx, "RECEIPT");
      case "SHARE_SERVICE_SELECT": return this.shareServiceSelect(ctx);
      case "MAIN_MENU":
      default: return this.mainMenu(ctx);
    }
  }

  private async mainMenu(ctx: HandlerCtx): Promise<HandlerResult> {
    switch (ctx.text) {
      case "1":
        return { reply: text("Customer's name?"), nextState: "INVOICE_CUSTOMER", context: {} };
      case "2":
        return { reply: text("Customer's name?"), nextState: "RECEIPT_CUSTOMER", context: {} };
      case "3":
        return this.startShareService(ctx);
      case "4":
        return { reply: text(await intentDispatcher.listUnpaidInvoices(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "5":
        return { reply: text(await intentDispatcher.listTodayBookings(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "6":
        return { reply: text(await intentDispatcher.businessSummary(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      default:
        return { reply: text(MAIN_MENU), nextState: "MAIN_MENU", context: null };
    }
  }

  private async startShareService(ctx: HandlerCtx): Promise<HandlerResult> {
    const services = await intentDispatcher.listServiceOptions(ctx.businessId);
    if (services.length === 0) {
      return {
        reply: text(`You have no active services to share.\n\n${MAIN_MENU}`),
        nextState: "MAIN_MENU",
        context: null,
      };
    }
    const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: text(`Which service? Reply with a number:\n${list}`),
      nextState: "SHARE_SERVICE_SELECT",
      context: { services },
    };
  }

  private shareServiceSelect(ctx: HandlerCtx): HandlerResult {
    const services = ctx.context.services ?? [];
    const index = parseInt(ctx.text, 10) - 1;
    const chosen = Number.isInteger(index) ? services[index] : undefined;
    if (!chosen) {
      const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
      return {
        reply: text(`Please reply with a number from the list:\n${list}`),
        nextState: "SHARE_SERVICE_SELECT",
        context: ctx.context,
      };
    }
    return {
      reply: text(intentDispatcher.bookingLinkText(chosen)),
      nextState: "MAIN_MENU",
      context: null,
    };
  }

  private collectCustomer(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    if (ctx.text.length === 0) {
      return { reply: text("Customer's name?"), nextState: `${kind}_CUSTOMER`, context: ctx.context };
    }
    return {
      reply: text(kind === "INVOICE" ? "Amount? e.g. 5000" : "Amount paid? e.g. 5000"),
      nextState: `${kind}_AMOUNT`,
      context: { ...ctx.context, customerName: ctx.text },
    };
  }

  private collectAmount(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const amount = parseAmount(ctx.text);
    if (amount === null) {
      return {
        reply: text("That doesn't look like a valid amount. Try again, e.g. 5000"),
        nextState: `${kind}_AMOUNT`,
        context: ctx.context,
      };
    }
    return {
      reply: text("What's it for? (or 'skip')"),
      nextState: `${kind}_DESC`,
      context: { ...ctx.context, amount },
    };
  }

  private collectDesc(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const description = ctx.text.toLowerCase() === "skip" ? undefined : ctx.text;
    const merged: Draft = { ...ctx.context, description };
    const label = kind === "INVOICE" ? "invoice" : "receipt";
    const summary =
      `New ${label}: ${merged.customerName} · ${formatMoney(merged.amount ?? 0, "")}` +
      (description ? ` · ${description}` : "");
    return {
      reply: text(`${summary}\nReply YES to create, NO to cancel`),
      nextState: `${kind}_CONFIRM`,
      context: merged,
    };
  }

  private async confirm(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): Promise<HandlerResult> {
    const answer = ctx.text.toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return { reply: text(`Okay, cancelled.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }
    const draft = ctx.context;
    if (!draft.customerName || draft.amount == null) {
      return { reply: text(`Something went wrong. Let's start over.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }
    try {
      if (kind === "INVOICE") {
        const res = await intentDispatcher.createInvoice(ctx.businessId, {
          customerName: draft.customerName, amount: draft.amount, description: draft.description,
        });
        return {
          reply: text(
            `Invoice ${res.number} created ✅\nPayment link: ${res.link}\n\n` +
              `Share with ${draft.customerName}:\n— — —\nHi ${draft.customerName}, here's your invoice. Pay securely: ${res.link}\n— — —`,
          ),
          nextState: "MAIN_MENU",
          context: null,
        };
      }
      const res = await intentDispatcher.createReceipt(ctx.businessId, {
        customerName: draft.customerName, amount: draft.amount, description: draft.description,
      });
      return { reply: text(`Receipt ${res.number} created ✅\nReceipt link: ${res.link}`), nextState: "MAIN_MENU", context: null };
    } catch {
      return {
        reply: text("Couldn't create that just now — reply YES to retry or 'menu' to start over"),
        nextState: `${kind}_CONFIRM`,
        context: draft,
      };
    }
  }
}

export const conversationEngine = new ConversationEngine();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/engine/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify type-check passes**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/backend/services/messaging/engine/index.ts src/backend/services/messaging/engine/index.test.ts
git commit -m "feat: add ConversationEngine menu state machine"
```

---

## Task 11: WhatsApp adapter

**Files:**
- Create: `src/backend/services/messaging/channels/whatsapp/index.ts`, `src/backend/services/messaging/channels/whatsapp/index.test.ts`

**Interfaces:**
- Produces: `whatsAppAdapter: ChannelAdapter` (`channel = "WHATSAPP"`). The `adapterFor` registry that ties both adapters together is created in Task 13, after the Instagram adapter exists.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/channels/whatsapp/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    WHATSAPP_VERIFY_TOKEN: "verify_me",
    WHATSAPP_PHONE_NUMBER_ID: "PNID",
    WHATSAPP_TOKEN: "wa_token",
    META_APP_SECRET: "app_secret",
  },
}));

import { whatsAppAdapter } from "./index";

beforeEach(() => vi.clearAllMocks());

describe("verify", () => {
  it("echoes the challenge on a matching token", () => {
    const req = new Request("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify_me&hub.challenge=C123");
    expect(whatsAppAdapter.verify(req).status).toBe(200);
  });
  it("rejects a wrong token", () => {
    const req = new Request("https://x/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=C");
    expect(whatsAppAdapter.verify(req).status).toBe(403);
  });
});

describe("normalizeInbound", () => {
  it("extracts text messages and the sender", () => {
    const payload = {
      entry: [{ changes: [{ value: {
        contacts: [{ profile: { name: "Ada" }, wa_id: "234800" }],
        messages: [{ from: "234800", id: "wamid.1", type: "text", text: { body: "hi" } }],
      } }] }],
    };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([
      { channel: "WHATSAPP", externalId: "234800", text: "hi", messageId: "wamid.1", displayName: "Ada" },
    ]);
  });
  it("ignores non-text messages", () => {
    const payload = { entry: [{ changes: [{ value: { messages: [{ from: "x", id: "1", type: "image" }] } }] }] };
    expect(whatsAppAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
  it("posts a text message to the Graph API", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await whatsAppAdapter.send("234800", { text: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/PNID/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({ messaging_product: "whatsapp", to: "234800", type: "text", text: { body: "hello" } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/channels/whatsapp/index.test.ts`
Expected: FAIL — `whatsAppAdapter` undefined.

- [ ] **Step 3: Implement the adapter**

Create `src/backend/services/messaging/channels/whatsapp/index.ts`:

```ts
import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

class WhatsAppAdapter implements ChannelAdapter {
  channel: ChatChannel = "WHATSAPP";

  verify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token && token === env.WHATSAPP_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  isAuthentic(req: Request, rawBody: string): boolean {
    const secret = env.META_APP_SECRET;
    if (!secret) return false;
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  normalizeInbound(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};
        const contactName = value?.contacts?.[0]?.profile?.name as string | undefined;
        for (const msg of value?.messages ?? []) {
          if (msg?.type !== "text" || !msg?.text?.body) continue;
          out.push({
            channel: "WHATSAPP",
            externalId: String(msg.from),
            text: String(msg.text.body),
            messageId: String(msg.id),
            displayName: contactName,
          });
        }
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<void> {
    const res = await fetch(`${GRAPH}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: externalId,
        type: "text",
        text: { body: message.text },
      }),
    });
    if (!res.ok) {
      console.error(`[WhatsApp] send failed: ${res.status} ${await res.text()}`);
    }
  }
}

export const whatsAppAdapter = new WhatsAppAdapter();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/channels/whatsapp/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/channels/whatsapp
git commit -m "feat: add WhatsApp Cloud API channel adapter"
```

---

## Task 12: WhatsApp webhook route

**Files:**
- Create: `src/app/api/webhooks/whatsapp/route.ts`, `src/app/api/webhooks/whatsapp/route.test.ts`

**Interfaces:**
- Consumes: `whatsAppAdapter`, `conversationEngine`.
- Produces: `GET` (handshake) + `POST` (receive). POST returns 200 after a valid signature; 403 on bad signature.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/webhooks/whatsapp/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/messaging/channels/whatsapp", () => ({
  whatsAppAdapter: { verify: vi.fn(), isAuthentic: vi.fn(), normalizeInbound: vi.fn(), send: vi.fn() },
}));
vi.mock("@/backend/services/messaging/engine", () => ({
  conversationEngine: { handle: vi.fn() },
}));

import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { POST } from "./route";

const mockedAdapter = whatsAppAdapter as any;
const mockedEngine = conversationEngine as any;
beforeEach(() => vi.clearAllMocks());

function postReq(body: unknown) {
  return new Request("https://x/api/webhooks/whatsapp", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/webhooks/whatsapp", () => {
  it("returns 403 on an invalid signature", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(false);
    const res = await POST(postReq({}));
    expect(res.status).toBe(403);
    expect(mockedEngine.handle).not.toHaveBeenCalled();
  });

  it("processes messages, sends replies, returns 200", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockReturnValue([
      { channel: "WHATSAPP", externalId: "234800", text: "1", messageId: "m1" },
    ]);
    mockedEngine.handle.mockResolvedValue({ text: "Customer's name?" });
    const res = await POST(postReq({ entry: [] }));
    expect(res.status).toBe(200);
    expect(mockedAdapter.send).toHaveBeenCalledWith("234800", { text: "Customer's name?" });
  });

  it("still returns 200 when processing throws", async () => {
    mockedAdapter.isAuthentic.mockReturnValue(true);
    mockedAdapter.normalizeInbound.mockImplementation(() => { throw new Error("boom"); });
    const res = await POST(postReq({}));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/app/api/webhooks/whatsapp/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/webhooks/whatsapp/route.ts`:

```ts
import { whatsAppAdapter } from "@/backend/services/messaging/channels/whatsapp";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return whatsAppAdapter.verify(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!whatsAppAdapter.isAuthentic(request, rawBody)) {
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = whatsAppAdapter.normalizeInbound(payload);
    for (const message of messages) {
      const reply = await conversationEngine.handle(message);
      if (reply) await whatsAppAdapter.send(message.externalId, reply);
    }
  } catch (error: any) {
    console.error("[WhatsApp Webhook] Error:", error?.message ?? error);
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/app/api/webhooks/whatsapp/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/whatsapp
git commit -m "feat: add WhatsApp webhook route"
```

---

## Task 13: Instagram adapter + registry

**Files:**
- Create: `src/backend/services/messaging/channels/instagram/index.ts`, `src/backend/services/messaging/channels/instagram/index.test.ts`
- Create: `src/backend/services/messaging/channels/registry.ts`

**Interfaces:**
- Produces: `instagramAdapter: ChannelAdapter` (`channel = "INSTAGRAM"`); `adapterFor(channel)`.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/channels/instagram/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    INSTAGRAM_VERIFY_TOKEN: "ig_verify",
    INSTAGRAM_IG_ID: "IGID",
    INSTAGRAM_PAGE_TOKEN: "ig_token",
    META_APP_SECRET: "app_secret",
  },
}));

import { instagramAdapter } from "./index";

beforeEach(() => vi.clearAllMocks());

describe("verify", () => {
  it("echoes the challenge on a matching token", () => {
    const req = new Request("https://x/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=ig_verify&hub.challenge=C9");
    expect(instagramAdapter.verify(req).status).toBe(200);
  });
});

describe("normalizeInbound", () => {
  it("extracts text DMs", () => {
    const payload = { entry: [{ messaging: [
      { sender: { id: "igsid_1" }, recipient: { id: "IGID" }, message: { mid: "mid_1", text: "hi" } },
    ] }] };
    expect(instagramAdapter.normalizeInbound(payload)).toEqual([
      { channel: "INSTAGRAM", externalId: "igsid_1", text: "hi", messageId: "mid_1" },
    ]);
  });
  it("ignores echoes and non-text events", () => {
    const payload = { entry: [{ messaging: [
      { sender: { id: "x" }, message: { mid: "m", text: "hi", is_echo: true } },
      { sender: { id: "y" }, message: { mid: "n" } },
    ] }] };
    expect(instagramAdapter.normalizeInbound(payload)).toEqual([]);
  });
});

describe("send", () => {
  it("posts a message to the Graph API for the IG account", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await instagramAdapter.send("igsid_1", { text: "hello" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://graph.facebook.com/v21.0/IGID/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as any).body);
    expect(body).toMatchObject({ recipient: { id: "igsid_1" }, message: { text: "hello" } });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/channels/instagram/index.test.ts`
Expected: FAIL — `instagramAdapter` undefined.

- [ ] **Step 3: Implement the adapter**

Create `src/backend/services/messaging/channels/instagram/index.ts`:

```ts
import { env } from "@/env";
import type { ChatChannel } from "@prisma/client";
import crypto from "node:crypto";
import type { ChannelAdapter, InboundMessage, OutboundMessage } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

class InstagramAdapter implements ChannelAdapter {
  channel: ChatChannel = "INSTAGRAM";

  verify(req: Request): Response {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") ?? "";
    if (mode === "subscribe" && token && token === env.INSTAGRAM_VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  isAuthentic(req: Request, rawBody: string): boolean {
    const secret = env.META_APP_SECRET;
    if (!secret) return false;
    const signature = req.headers.get("x-hub-signature-256");
    if (!signature) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  normalizeInbound(payload: unknown): InboundMessage[] {
    const out: InboundMessage[] = [];
    const body = payload as any;
    for (const entry of body?.entry ?? []) {
      for (const event of entry?.messaging ?? []) {
        const msg = event?.message;
        if (!msg || msg.is_echo || !msg.text) continue;
        out.push({
          channel: "INSTAGRAM",
          externalId: String(event.sender?.id),
          text: String(msg.text),
          messageId: String(msg.mid),
        });
      }
    }
    return out;
  }

  async send(externalId: string, message: OutboundMessage): Promise<void> {
    const res = await fetch(`${GRAPH}/${env.INSTAGRAM_IG_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: externalId },
        message: { text: message.text },
      }),
    });
    if (!res.ok) {
      console.error(`[Instagram] send failed: ${res.status} ${await res.text()}`);
    }
  }
}

export const instagramAdapter = new InstagramAdapter();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/channels/instagram/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the adapter registry (now both adapters exist)**

Create `src/backend/services/messaging/channels/registry.ts`:

```ts
import type { ChatChannel } from "@prisma/client";
import { instagramAdapter } from "./instagram";
import type { ChannelAdapter } from "./types";
import { whatsAppAdapter } from "./whatsapp";

export function adapterFor(channel: ChatChannel): ChannelAdapter {
  switch (channel) {
    case "WHATSAPP":
      return whatsAppAdapter;
    case "INSTAGRAM":
      return instagramAdapter;
  }
}
```

- [ ] **Step 6: Verify type-check passes**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/backend/services/messaging/channels/instagram src/backend/services/messaging/channels/registry.ts
git commit -m "feat: add Instagram channel adapter and adapter registry"
```

---

## Task 14: Instagram webhook route

**Files:**
- Create: `src/app/api/webhooks/instagram/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/webhooks/instagram/route.ts`:

```ts
import { instagramAdapter } from "@/backend/services/messaging/channels/instagram";
import { conversationEngine } from "@/backend/services/messaging/engine";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return instagramAdapter.verify(request);
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!instagramAdapter.isAuthentic(request, rawBody)) {
    return NextResponse.json({ message: "Invalid webhook signature" }, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as unknown;
    const messages = instagramAdapter.normalizeInbound(payload);
    for (const message of messages) {
      const reply = await conversationEngine.handle(message);
      if (reply) await instagramAdapter.send(message.externalId, reply);
    }
  } catch (error: any) {
    console.error("[Instagram Webhook] Error:", error?.message ?? error);
  }

  return NextResponse.json({ status: "ok" }, { status: 200 });
}
```

- [ ] **Step 2: Verify type-check passes**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/instagram
git commit -m "feat: add Instagram webhook route"
```

---

## Task 15: OwnerNotifier

**Files:**
- Create: `src/backend/services/messaging/notify/index.ts`, `src/backend/services/messaging/notify/index.test.ts`

**Interfaces:**
- Consumes: `db`, `adapterFor` (`../channels/registry`).
- Produces: `ownerNotifier.notify(businessId: string, text: string): Promise<void>` — sends `text` to every `ChatIdentity` of the business via its channel adapter; silently no-ops when there are none; one identity's failure never blocks the others.

- [ ] **Step 1: Write the failing test**

Create `src/backend/services/messaging/notify/index.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { chatIdentity: { findMany: vi.fn() } };
  return { db };
});

const send = vi.fn();
vi.mock("../channels/registry", () => ({
  adapterFor: vi.fn(() => ({ send })),
}));

import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";
import { ownerNotifier } from "./index";

const mockedDb = db as any;
beforeEach(() => {
  vi.clearAllMocks();
});

describe("ownerNotifier.notify", () => {
  it("sends to every linked identity via its adapter", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "234800" },
      { channel: "INSTAGRAM", externalId: "igsid_1" },
    ]);
    await ownerNotifier.notify("biz_1", "💰 Paid");
    expect(adapterFor).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("234800", { text: "💰 Paid" });
    expect(send).toHaveBeenCalledWith("igsid_1", { text: "💰 Paid" });
  });

  it("no-ops when the business has no linked identity", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([]);
    await ownerNotifier.notify("biz_1", "hi");
    expect(send).not.toHaveBeenCalled();
  });

  it("continues when one send fails", async () => {
    mockedDb.chatIdentity.findMany.mockResolvedValue([
      { channel: "WHATSAPP", externalId: "a" },
      { channel: "WHATSAPP", externalId: "b" },
    ]);
    send.mockRejectedValueOnce(new Error("boom"));
    await ownerNotifier.notify("biz_1", "hi");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/backend/services/messaging/notify/index.test.ts`
Expected: FAIL — `ownerNotifier` undefined.

- [ ] **Step 3: Implement the notifier**

Create `src/backend/services/messaging/notify/index.ts`:

```ts
import { db } from "@/server/db";
import { adapterFor } from "../channels/registry";

class OwnerNotifier {
  async notify(businessId: string, text: string): Promise<void> {
    const identities = await db.chatIdentity.findMany({
      where: { businessId },
      select: { channel: true, externalId: true },
    });

    await Promise.all(
      identities.map(async (identity) => {
        try {
          await adapterFor(identity.channel).send(identity.externalId, { text });
        } catch (error: any) {
          console.warn(
            `[OwnerNotifier] failed to notify ${identity.channel}:${identity.externalId}:`,
            error?.message ?? error,
          );
        }
      }),
    );
  }
}

export const ownerNotifier = new OwnerNotifier();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/backend/services/messaging/notify/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/services/messaging/notify
git commit -m "feat: add OwnerNotifier for outbound owner chat notifications"
```

---

## Task 16: Public service-details route

**Files:**
- Create: `src/app/api/public/services/[slug]/route.ts`, `src/app/api/public/services/[slug]/route.test.ts`

**Interfaces:**
- Consumes: `db`, `availabilityService.getAvailableSlots`.
- Produces: public `GET /api/public/services/[slug]?date=YYYY-MM-DD` → `{ status, data: { service public fields, slots } }`; `404` for missing/inactive.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/public/services/[slug]/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => {
  const db: any = { service: { findFirst: vi.fn() } };
  return { db };
});
vi.mock("@/backend/services/availability", () => ({
  availabilityService: { getAvailableSlots: vi.fn() },
}));

import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { GET } from "./route";

const mockedDb = db as any;
const mockedAvail = availabilityService as any;
beforeEach(() => vi.clearAllMocks());

function req(date?: string) {
  const url = date
    ? `https://x/api/public/services/haircut?date=${date}`
    : "https://x/api/public/services/haircut";
  return new Request(url);
}

describe("GET /api/public/services/[slug]", () => {
  it("returns the service with availability slots", async () => {
    mockedDb.service.findFirst.mockResolvedValue({
      id: "svc_1", slug: "haircut", name: "Haircut", description: null, image: null,
      price: 5000, duration: 60, isActive: true, businessId: "biz_1",
      business: { name: "Acme", currency: "NGN" },
    });
    mockedAvail.getAvailableSlots.mockResolvedValue([
      { startTime: new Date("2026-06-22T10:00:00Z"), endTime: new Date("2026-06-22T11:00:00Z"), isAvailable: true },
    ]);
    const res = await GET(req("2026-06-22"), { params: Promise.resolve({ slug: "haircut" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.name).toBe("Haircut");
    expect(json.data.slots).toHaveLength(1);
  });

  it("returns 404 for an inactive service", async () => {
    mockedDb.service.findFirst.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ slug: "missing" }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/app/api/public/services/[slug]/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/public/services/[slug]/route.ts`:

```ts
import { availabilityService } from "@/backend/services/availability";
import { db } from "@/server/db";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * @description Public (unauthenticated) service details + availability for a date.
 *              Used by the customer-facing booking page.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await context.params;
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? new Date().toISOString().split("T")[0]!;

    const service = await db.service.findFirst({
      where: { slug, isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        image: true,
        price: true,
        duration: true,
        businessId: true,
        business: { select: { name: true, currency: true } },
      },
    });

    if (!service) {
      return NextResponse.json({ status: 404, message: "Service not found" }, { status: 404 });
    }

    const availableSlots = await availabilityService.getAvailableSlots({
      businessId: service.businessId,
      serviceId: service.id,
      date,
    });

    const slots = availableSlots.map((slot) => ({
      startTime: slot.startTime.toISOString(),
      endTime: slot.endTime.toISOString(),
      isAvailable: slot.isAvailable,
    }));

    return NextResponse.json({
      status: 200,
      message: "Service retrieved successfully",
      data: {
        slug: service.slug,
        name: service.name,
        description: service.description,
        image: service.image,
        price: service.price,
        duration: service.duration,
        currency: service.business.currency,
        businessName: service.business.name,
        slots,
      },
    });
  } catch (error: any) {
    console.error("[Public Service] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/app/api/public/services/[slug]/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/public/services
git commit -m "feat: add public service details + availability route"
```

---

## Task 17: Public booking route

**Files:**
- Create: `src/app/api/public/bookings/route.ts`, `src/app/api/public/bookings/route.test.ts`

**Interfaces:**
- Consumes: `bookingService.createWithPayment`.
- Produces: public `POST /api/public/bookings` — body `{ serviceSlug, startTime, endTime, clientName, clientEmail?, clientPhone?, notes? }` → `{ status, data: { ...booking, paymentUrl, paymentReference } }`. Validation errors → `4xx`.

- [ ] **Step 1: Write the failing test**

Create `src/app/api/public/bookings/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/services/booking", () => ({
  bookingService: { createWithPayment: vi.fn() },
}));

import { bookingService } from "@/backend/services/booking";
import { BadRequestException } from "@/utils/exceptions";
import { POST } from "./route";

const mockedBooking = bookingService as any;
beforeEach(() => vi.clearAllMocks());

function postReq(body: unknown) {
  return new Request("https://x/api/public/bookings", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const START = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const END = new Date(Date.now() + 25 * 3600 * 1000).toISOString();

describe("POST /api/public/bookings", () => {
  it("creates a booking and returns the payment url", async () => {
    mockedBooking.createWithPayment.mockResolvedValue({
      booking: { id: "bkg_1", slug: "haircut-ada-1" },
      paymentUrl: "https://paystack.test/pay",
      paymentReference: "ref_1",
    });
    const res = await POST(postReq({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.paymentUrl).toBe("https://paystack.test/pay");
  });

  it("returns 422 when required fields are missing", async () => {
    const res = await POST(postReq({ serviceSlug: "haircut" }));
    expect(res.status).toBe(422);
    expect(mockedBooking.createWithPayment).not.toHaveBeenCalled();
  });

  it("maps a service error to its status code", async () => {
    mockedBooking.createWithPayment.mockRejectedValue(new BadRequestException("Slot taken"));
    const res = await POST(postReq({
      serviceSlug: "haircut", startTime: START, endTime: END, clientName: "Ada",
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/app/api/public/bookings/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `src/app/api/public/bookings/route.ts`:

```ts
import { bookingService } from "@/backend/services/booking";
import { HttpException } from "@/utils/exceptions";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const publicBookingSchema = z
  .object({
    serviceSlug: z.string().min(1, "serviceSlug is required"),
    startTime: z.coerce.date("startTime must be a valid date"),
    endTime: z.coerce.date("endTime must be a valid date"),
    clientName: z.string().min(1, "clientName is required").max(255),
    clientEmail: z.string().email("clientEmail must be a valid email").optional(),
    clientPhone: z.string().max(20).optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

/**
 * @description Public (unauthenticated) booking creation + Paystack payment init.
 *              Used by the customer-facing booking page.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = publicBookingSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { status: 422, message: first ? `${first.path.join(".")}: ${first.message}` : "Validation failed" },
        { status: 422 },
      );
    }

    const data = parsed.data;
    const result = await bookingService.createWithPayment({
      serviceSlug: data.serviceSlug,
      startTime: data.startTime,
      endTime: data.endTime,
      clientName: data.clientName,
      clientEmail: data.clientEmail,
      clientPhone: data.clientPhone,
      notes: data.notes,
    });

    return NextResponse.json(
      {
        status: 201,
        message: "Booking created successfully. Complete payment to confirm.",
        data: {
          ...result.booking,
          paymentUrl: result.paymentUrl,
          paymentReference: result.paymentReference,
        },
      },
      { status: 201 },
    );
  } catch (error: any) {
    if (error instanceof HttpException) {
      return NextResponse.json({ status: error.statusCode, message: error.message }, { status: error.statusCode });
    }
    console.error("[Public Booking] Error:", error?.message ?? error);
    return NextResponse.json({ status: 500, message: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/app/api/public/bookings/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/public/bookings
git commit -m "feat: add public booking + payment route"
```

---

## Task 18: Extend the Paystack webhook (receipt + owner notify)

**Files:**
- Modify: `src/app/api/webhooks/paystack/route.ts`

**Interfaces:**
- Consumes: `receiptService.create`, `ownerNotifier.notify`, `formatMoney` (`@/backend/services/messaging/engine/amount`), existing `db`.

- [ ] **Step 1: Add imports**

In `src/app/api/webhooks/paystack/route.ts`, add to the imports at the top:

```ts
import { receiptService } from "@/backend/services/receipt";
import { ownerNotifier } from "@/backend/services/messaging/notify";
import { formatMoney } from "@/backend/services/messaging/engine/amount";
```

- [ ] **Step 2: Load the business currency for the notification**

In `handleChargeSuccess`, the `booking` query already selects `business`. Extend that nested `business.select` to also include `currency`:

Find the `business: { select: { id: true, name: true, googleCalendarId: true, … } }` block inside the `db.booking.findUnique({ … select: { … } })` call and add `currency: true,` to that `business.select`.

- [ ] **Step 3: Add the receipt + owner-notify block**

In `handleChargeSuccess`, immediately after the existing `console.log("[Paystack Webhook] Booking ${bookingId} confirmed. …")` line and before the confirmation-email block, insert:

```ts
  // Best-effort: auto-create a receipt for the paid booking.
  let receiptUrl: string | null = null;
  try {
    const payment = await db.payment.findUnique({
      where: { reference },
      select: { id: true },
    });
    const receipt = await receiptService.create({
      businessId,
      paymentId: payment?.id ?? null,
      name: booking.clientName ?? null,
      email: booking.clientEmail ?? null,
      phone: booking.clientPhone ?? null,
      currency: booking.business.currency,
      subtotal: amount / 100,
      taxAmount: 0,
      discount: 0,
      total: amount / 100,
      amountPaid: amount / 100,
      paymentMethod: "PAYSTACK",
    });
    receiptUrl = receipt.url;
  } catch (err) {
    console.warn("[Paystack Webhook] Receipt creation failed:", err);
  }

  // Best-effort: notify the owner on their linked chat channel(s).
  try {
    const when = booking.startTime.toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    const paidLine = `💰 ${booking.clientName ?? "A customer"} paid ${formatMoney(
      amount / 100,
      booking.business.currency,
    )} for ${booking.service.name} (${when}).`;
    const text = receiptUrl ? `${paidLine}\nReceipt: ${receiptUrl}` : paidLine;
    await ownerNotifier.notify(businessId, text);
  } catch (err) {
    console.warn("[Paystack Webhook] Owner notification failed:", err);
  }
```

- [ ] **Step 4: Verify type-check and the existing Paystack webhook test pass**

Run: `yarn test src/app/api/webhooks/paystack/route.test.ts && yarn typecheck`
Expected: PASS. (The existing test exercises `charge.success`; the new steps are best-effort and wrapped in try/catch, so they never fail the webhook. If the existing test asserts on specific `db`/service mocks, ensure `receiptService` and `ownerNotifier` are mocked in that test file — add `vi.mock("@/backend/services/receipt")` and `vi.mock("@/backend/services/messaging/notify", () => ({ ownerNotifier: { notify: vi.fn() } }))` if needed, and have `db.payment.findUnique` return a value.)

- [ ] **Step 5: Run the full suite + full check**

Run: `yarn test && yarn check`
Expected: PASS — all suites green; `next lint` and `tsc --noEmit` succeed.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/paystack/route.ts
git commit -m "feat: create receipt and notify owner on successful payment"
```

---

## Manual verification (after merge, requires Meta + Paystack setup)

1. **Webhook handshake:** Configure the WhatsApp webhook callback to `/api/webhooks/whatsapp` with `WHATSAPP_VERIFY_TOKEN`; confirm "Verified". Repeat for Instagram at `/api/webhooks/instagram`.
2. **Linking:** Message the Sara WhatsApp number → expect a `/link?t=…` reply → open it, sign in as an owner, confirm success → message again → expect the main menu.
3. **Invoice / receipt flows:** Reply `1` / `2`, complete the steps, confirm an `INV-…` / `RCP-…` with a link, and verify the record in the dashboard.
4. **Share a service:** Reply `3` → pick a service → confirm a `${APP_URL}/book/<slug>` link is returned.
5. **Customer booking:** `GET /api/public/services/<slug>` returns slots; `POST /api/public/bookings` returns a `paymentUrl`; open it and pay with a Paystack test card.
6. **Payment success:** Confirm the booking flips to CONFIRMED, a receipt is created, the owner receives the chat notification, and the confirmation email is sent.
7. **Reads:** Reply `4`, `5`, `6` and confirm unpaid invoices, today's bookings, and the summary.
8. **Instagram parity:** DM the Sara Instagram professional account and confirm the same menu behaviour.

---

## Self-Review notes

- **Spec coverage:** linking (Tasks 1, 8) · session/idempotency/staleness (Task 7, enforced Task 10) · invoice/receipt write flows returning links (Tasks 2, 3, 9, 10) · share-a-service booking link (Tasks 9, 10) · reads (Task 9) · WhatsApp + Instagram adapters/webhooks with signature + always-200 (Tasks 11–14) · OwnerNotifier (Task 15) · public service + booking APIs reusing availability + shared BookingService (Tasks 4, 16, 17) · payment-success receipt + owner notify + existing email (Task 18) · env/config (Task 1).
- **Shared logic:** invoice, receipt, and booking creation each live in one service used by routes, chat, and the webhook — no duplication.
- **Decimal handling:** reads wrapped in `Number(...)` before formatting; writes pass plain numbers.
- **Idempotency:** chat dedupes on `messageId`; the Paystack webhook keeps its `reference` dedupe; the new receipt/notify steps run after the existing idempotency guard and are best-effort.
- **Registry ordering:** `registry.ts` is created in Task 13 (after both adapters exist) so it always type-checks.
