/*
  Warnings:

  - You are about to drop the `InvoiceItem` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ReceiptItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "InvoiceItem" DROP CONSTRAINT "InvoiceItem_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "ReceiptItem" DROP CONSTRAINT "ReceiptItem_receiptId_fkey";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "image" TEXT;

-- DropTable
DROP TABLE "InvoiceItem";

-- DropTable
DROP TABLE "ReceiptItem";

-- CreateTable
CREATE TABLE "InvoiceService" (
    "invoiceId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "InvoiceService_pkey" PRIMARY KEY ("invoiceId","serviceId")
);

-- CreateTable
CREATE TABLE "ReceiptService" (
    "receiptId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ReceiptService_pkey" PRIMARY KEY ("receiptId","serviceId")
);

-- CreateIndex
CREATE INDEX "InvoiceService_invoiceId_idx" ON "InvoiceService"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceService_serviceId_idx" ON "InvoiceService"("serviceId");

-- CreateIndex
CREATE INDEX "ReceiptService_receiptId_idx" ON "ReceiptService"("receiptId");

-- CreateIndex
CREATE INDEX "ReceiptService_serviceId_idx" ON "ReceiptService"("serviceId");

-- AddForeignKey
ALTER TABLE "InvoiceService" ADD CONSTRAINT "InvoiceService_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceService" ADD CONSTRAINT "InvoiceService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptService" ADD CONSTRAINT "ReceiptService_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptService" ADD CONSTRAINT "ReceiptService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;
