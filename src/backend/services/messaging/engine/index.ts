import type { Prisma } from "@prisma/client";
import type { InboundMessage, OutboundMessage } from "../channels/types";
import {
  intentDispatcher,
  type ServiceOption,
} from "../dispatch";
import { linkingService } from "../linking";
import { chatSessionService } from "../session";
import { formatMoney, parseAmount } from "./amount";

const MAIN_MENU =
  "Sara 👋  Reply with a number:\n" +
  "1️⃣ New invoice\n" +
  "2️⃣ New receipt\n" +
  "3️⃣ Share a service (booking link)\n" +
  "4️⃣ Unpaid invoices\n" +
  "5️⃣ Today's bookings\n" +
  "6️⃣ Business summary";

type Draft = {
  customerName?: string;
  amount?: number;
  description?: string;
  services?: ServiceOption[];
};

type HandlerCtx = { text: string; businessId: string; context: Draft };
type HandlerResult = {
  reply: OutboundMessage;
  nextState: string;
  context: Draft | null;
};

function text(body: string): OutboundMessage {
  return { text: body };
}

class ConversationEngine {
  async handle(message: InboundMessage): Promise<OutboundMessage | null> {
    const identity = await chatSessionService.findIdentity(
      message.channel,
      message.externalId,
    );

    if (!identity) {
      const token = await linkingService.issueToken(message.channel, message.externalId);
      const url = linkingService.buildLinkUrl(token);
      return text(`👋 Welcome to Sara! Connect your business to get started:\n${url}`);
    }

    const session = await chatSessionService.getOrCreateSession(identity.id);

    let state = session.state;
    let context = (session.context as Draft | null) ?? {};
    if (chatSessionService.isStale(session)) {
      state = "MAIN_MENU";
      context = {};
    }

    // Atomically claim this messageId before doing any work. A concurrent or
    // duplicate Meta delivery of the same messageId loses the race and is dropped,
    // so write flows (invoice/receipt) can never run twice for one message.
    const claimed = await chatSessionService.claimMessage(session.id, message.messageId);
    if (!claimed) return null;

    const trimmed = message.text.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "menu" || lower === "0") {
      state = "MAIN_MENU";
      context = {};
    } else if (lower === "cancel") {
      await chatSessionService.save(session.id, {
        state: "MAIN_MENU",
        context: null,
        lastProcessedMsgId: message.messageId,
      });
      return text(`Cancelled.\n\n${MAIN_MENU}`);
    }

    const result = await this.route(state, {
      text: trimmed,
      businessId: identity.businessId,
      context,
    });

    await chatSessionService.save(session.id, {
      state: result.nextState,
      context: (result.context as Prisma.InputJsonValue | null) ?? null,
      lastProcessedMsgId: message.messageId,
    });

    return result.reply;
  }

  private async route(state: string, ctx: HandlerCtx): Promise<HandlerResult> {
    switch (state) {
      case "INVOICE_CUSTOMER": return this.collectCustomer(ctx, "INVOICE");
      case "INVOICE_AMOUNT": return this.collectAmount(ctx, "INVOICE");
      case "INVOICE_DESC": return this.collectDesc(ctx, "INVOICE");
      case "INVOICE_CONFIRM": return this.confirm(ctx, "INVOICE");
      case "RECEIPT_CUSTOMER": return this.collectCustomer(ctx, "RECEIPT");
      case "RECEIPT_AMOUNT": return this.collectAmount(ctx, "RECEIPT");
      case "RECEIPT_DESC": return this.collectDesc(ctx, "RECEIPT");
      case "RECEIPT_CONFIRM": return this.confirm(ctx, "RECEIPT");
      case "SHARE_SERVICE_SELECT": return this.shareServiceSelect(ctx);
      case "MAIN_MENU":
      default: return this.mainMenu(ctx);
    }
  }

  private async mainMenu(ctx: HandlerCtx): Promise<HandlerResult> {
    switch (ctx.text) {
      case "1":
        return { reply: text("Customer's name?"), nextState: "INVOICE_CUSTOMER", context: {} };
      case "2":
        return { reply: text("Customer's name?"), nextState: "RECEIPT_CUSTOMER", context: {} };
      case "3":
        return this.startShareService(ctx);
      case "4":
        return { reply: text(await intentDispatcher.listUnpaidInvoices(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "5":
        return { reply: text(await intentDispatcher.listTodayBookings(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "6":
        return { reply: text(await intentDispatcher.businessSummary(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      default:
        return { reply: text(MAIN_MENU), nextState: "MAIN_MENU", context: null };
    }
  }

  private async startShareService(ctx: HandlerCtx): Promise<HandlerResult> {
    const services = await intentDispatcher.listServiceOptions(ctx.businessId);
    if (services.length === 0) {
      return {
        reply: text(`You have no active services to share.\n\n${MAIN_MENU}`),
        nextState: "MAIN_MENU",
        context: null,
      };
    }
    const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
    return {
      reply: text(`Which service? Reply with a number:\n${list}`),
      nextState: "SHARE_SERVICE_SELECT",
      context: { services },
    };
  }

  private shareServiceSelect(ctx: HandlerCtx): HandlerResult {
    const services = ctx.context.services ?? [];
    const index = parseInt(ctx.text, 10) - 1;
    const chosen = Number.isInteger(index) ? services[index] : undefined;
    if (!chosen) {
      const list = services.map((s, i) => `${i + 1}. ${s.label}`).join("\n");
      return {
        reply: text(`Please reply with a number from the list:\n${list}`),
        nextState: "SHARE_SERVICE_SELECT",
        context: ctx.context,
      };
    }
    return {
      reply: text(intentDispatcher.bookingLinkText(chosen)),
      nextState: "MAIN_MENU",
      context: null,
    };
  }

  private collectCustomer(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    if (ctx.text.length === 0) {
      return { reply: text("Customer's name?"), nextState: `${kind}_CUSTOMER`, context: ctx.context };
    }
    return {
      reply: text(kind === "INVOICE" ? "Amount? e.g. 5000" : "Amount paid? e.g. 5000"),
      nextState: `${kind}_AMOUNT`,
      context: { ...ctx.context, customerName: ctx.text },
    };
  }

  private collectAmount(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const amount = parseAmount(ctx.text);
    if (amount === null) {
      return {
        reply: text("That doesn't look like a valid amount. Try again, e.g. 5000"),
        nextState: `${kind}_AMOUNT`,
        context: ctx.context,
      };
    }
    return {
      reply: text("What's it for? (or 'skip')"),
      nextState: `${kind}_DESC`,
      context: { ...ctx.context, amount },
    };
  }

  private collectDesc(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): HandlerResult {
    const description = ctx.text.toLowerCase() === "skip" ? undefined : ctx.text;
    const merged: Draft = { ...ctx.context, description };
    const label = kind === "INVOICE" ? "invoice" : "receipt";
    const summary =
      `New ${label}: ${merged.customerName} · ${formatMoney(merged.amount ?? 0, "")}` +
      (description ? ` · ${description}` : "");
    return {
      reply: text(`${summary}\nReply YES to create, NO to cancel`),
      nextState: `${kind}_CONFIRM`,
      context: merged,
    };
  }

  private async confirm(ctx: HandlerCtx, kind: "INVOICE" | "RECEIPT"): Promise<HandlerResult> {
    const answer = ctx.text.toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return { reply: text(`Okay, cancelled.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }
    const draft = ctx.context;
    if (!draft.customerName || draft.amount == null) {
      return { reply: text(`Something went wrong. Let's start over.\n\n${MAIN_MENU}`), nextState: "MAIN_MENU", context: null };
    }
    try {
      if (kind === "INVOICE") {
        const res = await intentDispatcher.createInvoice(ctx.businessId, {
          customerName: draft.customerName, amount: draft.amount, description: draft.description,
        });
        return {
          reply: text(
            `Invoice ${res.number} created ✅\nPayment link: ${res.link}\n\n` +
              `Share with ${draft.customerName}:\n— — —\nHi ${draft.customerName}, here's your invoice. Pay securely: ${res.link}\n— — —`,
          ),
          nextState: "MAIN_MENU",
          context: null,
        };
      }
      const res = await intentDispatcher.createReceipt(ctx.businessId, {
        customerName: draft.customerName, amount: draft.amount, description: draft.description,
      });
      return { reply: text(`Receipt ${res.number} created ✅\nReceipt link: ${res.link}`), nextState: "MAIN_MENU", context: null };
    } catch {
      return {
        reply: text("Couldn't create that just now — reply YES to retry or 'menu' to start over"),
        nextState: `${kind}_CONFIRM`,
        context: draft,
      };
    }
  }
}

export const conversationEngine = new ConversationEngine();
