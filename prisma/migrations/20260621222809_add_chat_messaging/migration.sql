-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM');

-- CreateTable
CREATE TABLE "ChatIdentity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'MAIN_MENU',
    "context" JSONB,
    "lastProcessedMsgId" TEXT,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatLinkToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatIdentity_businessId_idx" ON "ChatIdentity"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatIdentity_channel_externalId_key" ON "ChatIdentity"("channel", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_identityId_key" ON "ChatSession"("identityId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatLinkToken_token_key" ON "ChatLinkToken"("token");

-- CreateIndex
CREATE INDEX "ChatLinkToken_token_idx" ON "ChatLinkToken"("token");

-- AddForeignKey
ALTER TABLE "ChatIdentity" ADD CONSTRAINT "ChatIdentity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "ChatIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
