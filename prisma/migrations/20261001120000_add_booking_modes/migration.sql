-- Booking modes: slot (today), nightly (shortlets), daily (self-drive).
CREATE TYPE "BookingMode" AS ENUM ('SLOT', 'NIGHTLY', 'DAILY');

ALTER TABLE "Service"
  ADD COLUMN "bookingMode" "BookingMode" NOT NULL DEFAULT 'SLOT',
  ADD COLUMN "checkInTime" TEXT,
  ADD COLUMN "checkOutTime" TEXT,
  ADD COLUMN "minUnits" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxUnits" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "Booking"
  ADD COLUMN "units" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "amount" DECIMAL(10,2),
  ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- Every existing booking was one unit at the service's price.
UPDATE "Booking" b SET "amount" = s."price" FROM "Service" s WHERE b."serviceId" = s."id";
ALTER TABLE "Booking" ALTER COLUMN "amount" SET NOT NULL;

-- Unpaid bookings get the same 30-minute hold new ones get, so stale ones stop blocking now.
UPDATE "Booking" SET "holdExpiresAt" = "createdAt" + INTERVAL '30 minutes' WHERE "status" = 'PENDING';

CREATE INDEX "Booking_serviceId_startTime_endTime_idx" ON "Booking"("serviceId", "startTime", "endTime");
