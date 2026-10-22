-- Invoice and receipt lines become general line tables. A line may point at a
-- service or stand on its own name, and it keeps its name when the service is
-- deleted. Existing rows move one-to-one, in their old order (position 0).

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "serviceId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiptLine_pkey" PRIMARY KEY ("id")
);

-- Backfill from the old composite tables, taking each line's name snapshot
-- from the service it pointed at.
INSERT INTO "InvoiceLine" ("id", "invoiceId", "serviceId", "name", "description", "quantity", "unitPrice", "total", "position")
SELECT gen_random_uuid()::text, s."invoiceId", s."serviceId", sv."name", s."description", s."quantity", s."unitPrice", s."total", 0
FROM "InvoiceService" s
JOIN "Service" sv ON sv."id" = s."serviceId";

INSERT INTO "ReceiptLine" ("id", "receiptId", "serviceId", "name", "description", "quantity", "unitPrice", "total", "position")
SELECT gen_random_uuid()::text, s."receiptId", s."serviceId", sv."name", s."description", s."quantity", s."unitPrice", s."total", 0
FROM "ReceiptService" s
JOIN "Service" sv ON sv."id" = s."serviceId";

-- DropTable
DROP TABLE "InvoiceService";
DROP TABLE "ReceiptService";

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_serviceId_idx" ON "InvoiceLine"("serviceId");

-- CreateIndex
CREATE INDEX "ReceiptLine_receiptId_idx" ON "ReceiptLine"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptLine_serviceId_idx" ON "ReceiptLine"("serviceId");

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;
