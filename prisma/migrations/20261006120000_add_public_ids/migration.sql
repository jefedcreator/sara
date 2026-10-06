-- Customer links by random id: /invoices/<publicId>, /receipts/<publicId>,
-- /bookings/<publicId>. New rows get nanoid(16) from Prisma Client; existing
-- rows get 16 URL-safe characters from gen_random_uuid() (built into
-- Postgres 13+, no extension needed).

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "publicId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "bookingId" TEXT;

-- Backfill
UPDATE "Booking" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');
UPDATE "Invoice" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');
UPDATE "Receipt" SET "publicId" = translate(substr(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), 1, 16), '+/', '-_');

-- Constrain
ALTER TABLE "Booking" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Invoice" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "Receipt" ALTER COLUMN "publicId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_publicId_key" ON "Booking"("publicId");
CREATE UNIQUE INDEX "Invoice_publicId_key" ON "Invoice"("publicId");
CREATE UNIQUE INDEX "Receipt_publicId_key" ON "Receipt"("publicId");
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
