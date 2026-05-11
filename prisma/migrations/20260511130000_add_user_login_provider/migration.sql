-- CreateEnum
CREATE TYPE "LoginProvider" AS ENUM ('google', 'facebook', 'instagram');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "loginProvider" "LoginProvider";

-- CreateIndex
CREATE INDEX "User_loginProvider_idx" ON "User"("loginProvider");
