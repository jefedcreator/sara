-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "availableFrom" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "availableTo" TEXT NOT NULL DEFAULT '17:00';
