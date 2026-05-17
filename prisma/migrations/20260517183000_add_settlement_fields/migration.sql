-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "monoAccountId" TEXT,
ADD COLUMN     "paystackSubaccountCode" TEXT,
ADD COLUMN     "settlementAccount" TEXT,
ADD COLUMN     "settlementAccountName" TEXT,
ADD COLUMN     "settlementBank" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Business_paystackSubaccountCode_key" ON "Business"("paystackSubaccountCode");
