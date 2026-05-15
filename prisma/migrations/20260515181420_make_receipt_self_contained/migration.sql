/*
  Warnings:

  - You are about to drop the column `clientEmail` on the `Receipt` table. All the data in the column will be lost.
  - You are about to drop the column `clientName` on the `Receipt` table. All the data in the column will be lost.
  - You are about to drop the column `clientPhone` on the `Receipt` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[businessId,receiptNumber]` on the table `Receipt` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `amountPaid` to the `Receipt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `total` to the `Receipt` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Receipt" DROP CONSTRAINT "Receipt_paymentId_fkey";

-- AlterTable
ALTER TABLE "Receipt" DROP COLUMN "clientEmail",
DROP COLUMN "clientName",
DROP COLUMN "clientPhone",
ADD COLUMN     "amountPaid" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod",
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "total" DECIMAL(10,2) NOT NULL,
ALTER COLUMN "paymentId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ReceiptItem" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptItem_receiptId_idx" ON "ReceiptItem"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_businessId_receiptNumber_key" ON "Receipt"("businessId", "receiptNumber");

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptItem" ADD CONSTRAINT "ReceiptItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
