-- Products belong to a business and carry ordered options with their own stock.
-- Existing businesses keep selling services, and document lines may now point
-- at a product option instead of a service.

-- CreateEnum
CREATE TYPE "BusinessSells" AS ENUM ('SERVICES', 'PRODUCTS', 'BOTH');

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "sells" "BusinessSells" NOT NULL DEFAULT 'SERVICES',
ADD COLUMN "offersDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "deliveryFee" DECIMAL(10,2),
ADD COLUMN "offersPickup" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN "productOptionId" TEXT;

-- AlterTable
ALTER TABLE "ReceiptLine" ADD COLUMN "productOptionId" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tracksStock" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "price" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "Product_businessId_idx" ON "Product"("businessId");

-- CreateIndex
CREATE INDEX "Product_slug_idx" ON "Product"("slug");

-- CreateIndex
CREATE INDEX "ProductOption_productId_idx" ON "ProductOption"("productId");

-- CreateIndex
CREATE INDEX "InvoiceLine_productOptionId_idx" ON "InvoiceLine"("productOptionId");

-- CreateIndex
CREATE INDEX "ReceiptLine_productOptionId_idx" ON "ReceiptLine"("productOptionId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptLine" ADD CONSTRAINT "ReceiptLine_productOptionId_fkey" FOREIGN KEY ("productOptionId") REFERENCES "ProductOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
