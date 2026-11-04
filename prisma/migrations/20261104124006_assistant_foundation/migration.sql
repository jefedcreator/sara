-- CreateEnum
CREATE TYPE "AssistantChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'WEB');

-- CreateEnum
CREATE TYPE "AssistantTurnState" AS ENUM ('RUNNING', 'DONE', 'ERROR');

-- CreateEnum
CREATE TYPE "AssistantActionStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED', 'EXPIRED', 'REPLACED', 'INVALID');

-- CreateEnum
CREATE TYPE "AssistantUsageMode" AS ENUM ('VOICE', 'TEXT', 'APPROVAL');

-- CreateTable
CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" "AssistantChannel" NOT NULL,
    "principalId" TEXT NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "memoryVersion" INTEGER NOT NULL DEFAULT 0,
    "clarification" JSONB,
    "editingActionId" TEXT,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),

    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "memoryVersion" INTEGER NOT NULL,
    "userText" TEXT NOT NULL DEFAULT '',
    "transcript" TEXT,
    "toolRecords" JSONB NOT NULL DEFAULT '[]',
    "reply" JSONB,
    "state" "AssistantTurnState" NOT NULL DEFAULT 'RUNNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAction" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "AssistantActionStatus" NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantUsage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "channel" "AssistantChannel" NOT NULL,
    "mode" "AssistantUsageMode" NOT NULL,
    "audioSeconds" DOUBLE PRECISION,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(14,8),
    "pricingVersion" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'running',
    "providerRequestIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantDailyUsage" (
    "businessId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AssistantDailyUsage_pkey" PRIMARY KEY ("businessId","day")
);

-- CreateTable
CREATE TABLE "ProcessedChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AssistantConversation_businessId_channel_principalId_key" ON "AssistantConversation"("businessId", "channel", "principalId");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantTurn_conversationId_requestId_key" ON "AssistantTurn"("conversationId", "requestId");

-- CreateIndex
CREATE INDEX "AssistantTurn_conversationId_createdAt_idx" ON "AssistantTurn"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAction_conversationId_status_idx" ON "AssistantAction"("conversationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AssistantUsage_conversationId_requestId_key" ON "AssistantUsage"("conversationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedChatMessage_sessionId_messageId_key" ON "ProcessedChatMessage"("sessionId", "messageId");

-- AddForeignKey
ALTER TABLE "AssistantConversation" ADD CONSTRAINT "AssistantConversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantTurn" ADD CONSTRAINT "AssistantTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantUsage" ADD CONSTRAINT "AssistantUsage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantUsage" ADD CONSTRAINT "AssistantUsage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantDailyUsage" ADD CONSTRAINT "AssistantDailyUsage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessedChatMessage" ADD CONSTRAINT "ProcessedChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (manual partial unique index: at most one pending action per conversation)
CREATE UNIQUE INDEX "AssistantAction_one_pending" ON "AssistantAction" ("conversationId") WHERE "status" = 'PENDING';
