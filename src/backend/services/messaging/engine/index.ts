import type { BusinessSells, Customer, Prisma } from "@prisma/client";
import { customerService } from "@/backend/services/customer";
import { MENU } from "@/utils/menu";
import type { InboundMessage, OutboundMessage } from "../channels/types";
import {
  intentDispatcher,
  type ItemKind,
  type ItemOption,
  type ServiceOption,
  type WriteDraft,
} from "../dispatch";
import { linkingService } from "../linking";
import { chatSessionService } from "../session";
import { formatMoney, parseAmount } from "./amount";

/** "1️⃣": the digit, then the emoji presentation selector and the combining keycap. */
function keycap(n: number): string {
  return `${n}️⃣`;
}

/**
 * The owner's numbered menu for what the business sells. The items and their
 * order come from MENU (src/utils/menu.ts), which the Today page numbers from
 * too. A business that only sells services keeps the menu it always had, word
 * for word.
 */
export function mainMenuText(sells: BusinessSells): string {
  return [
    "Sara 👋  Reply with a number:",
    ...MENU[sells].map((item, i) => `${keycap(i + 1)} ${item.label}`),
  ].join("\n");
}

/** A line picked for an invoice or receipt: a service or a product option. */
export type SelectedItem = {
  serviceId?: string;
  productOptionId?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type HandleOptions = {
  onProgress?: (message: OutboundMessage) => Promise<void> | void;
};

/** An existing customer the owner can pick when the typed name could mean several. */
type CustomerChoice = { id: string; name: string; label: string };

/** A service or product to share. Entries saved before products existed have no kind. */
type ShareChoice = ServiceOption & { kind?: ItemKind };

/*
 * The draft, saved as the session's JSON context between messages. The item
 * fields were named when the chat only listed services, and keep their names
 * so chats already in progress resume: `availableServices` holds services and
 * product options, and `pendingServiceId` is the id of the entry being added.
 */
type Draft = {
  customerName?: string;
  customerId?: string;
  customerChoices?: CustomerChoice[];
  amount?: number;
  description?: string;
  services?: ShareChoice[];
  availableServices?: ItemOption[];
  selectedItems?: SelectedItem[];
  pendingServiceId?: string;
};

type Kind = "INVOICE" | "RECEIPT";

type HandlerCtx = {
  text: string;
  businessId: string;
  sells: BusinessSells;
  context: Draft;
};
type HandlerResult = {
  reply: OutboundMessage;
  nextState: string;
  context: Draft | null;
};

function text(body: string): OutboundMessage {
  return { text: body };
}

/** An entry with no kind was saved before products existed, so it is a service. */
function isProduct(item: { kind?: ItemKind }): boolean {
  return item.kind === "PRODUCT";
}

/**
 * What to call the entries of a list: "service" when they are all services
 * (the wording the chat has always used), "product" when they are all
 * products, and `mixed` otherwise.
 */
function listNoun(items: { kind?: ItemKind }[], mixed: string): string {
  const products = items.filter(isProduct).length;
  if (products === 0) return "service";
  return products === items.length ? "product" : mixed;
}

/** "a service", "an item". */
function withArticle(noun: string): string {
  return /^[aeiou]/.test(noun) ? `an ${noun}` : `a ${noun}`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function numbered(items: { label: string }[]): string {
  return items.map((item, i) => `${i + 1}. ${item.label}`).join("\n");
}

/** Which service or product option a picked line points at. */
function itemRef(item: ItemOption): Pick<SelectedItem, "serviceId" | "productOptionId"> {
  return isProduct(item)
    ? { productOptionId: item.productOptionId ?? item.id }
    : { serviceId: item.id };
}

/** Whether a picked line is this entry, so adding it again adds to its quantity. */
function isSameItem(line: SelectedItem, item: ItemOption): boolean {
  return isProduct(item)
    ? line.productOptionId === (item.productOptionId ?? item.id)
    : line.serviceId === item.id;
}

/** "Tolu Adeyemi · +2348035550142", or just the name when there's no phone or email. */
function customerLabel(customer: Customer): string {
  const contact = customer.phone ?? customer.email;
  return contact ? `${customer.name} · ${contact}` : customer.name;
}

/** The matching customers, numbered, with "New customer" last. */
function customerChoiceList(choices: CustomerChoice[]): string {
  return [
    ...choices.map((choice, i) => `${i + 1}. ${choice.label}`),
    `${choices.length + 1}. New customer`,
  ].join("\n");
}

class ConversationEngine {
  async handle(
    message: InboundMessage,
    options?: HandleOptions,
  ): Promise<OutboundMessage | null> {
    const identity = await chatSessionService.findIdentity(
      message.channel,
      message.externalId,
    );

    if (!identity) {
      const token = await linkingService.issueToken(message.channel, message.externalId);
      const url = linkingService.buildLinkUrl(token);
      return text(`👋 Welcome to Sara! Connect your business to get started:\n${url}`);
    }

    const sells = identity.business.sells;
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
      return text(`Cancelled.\n\n${mainMenuText(sells)}`);
    }

    const result = await this.route(
      state,
      {
        text: trimmed,
        businessId: identity.businessId,
        sells,
        context,
      },
      options,
    );

    await chatSessionService.save(session.id, {
      state: result.nextState,
      context: (result.context as Prisma.InputJsonValue | null) ?? null,
      lastProcessedMsgId: message.messageId,
    });

    return result.reply;
  }

  private async route(
    state: string,
    ctx: HandlerCtx,
    options?: HandleOptions,
  ): Promise<HandlerResult> {
    switch (state) {
      case "INVOICE_CUSTOMER": return this.collectCustomer(ctx, "INVOICE");
      case "INVOICE_CUSTOMER_PICK": return this.pickCustomer(ctx, "INVOICE");
      case "INVOICE_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "INVOICE");
      case "INVOICE_ITEM_QTY": return this.collectItemQty(ctx, "INVOICE");
      case "INVOICE_MORE_ITEMS": return this.collectMoreItems(ctx, "INVOICE");
      case "INVOICE_AMOUNT": return this.collectAmount(ctx, "INVOICE");
      case "INVOICE_DESC": return this.collectDesc(ctx, "INVOICE");
      case "INVOICE_CONFIRM": return this.confirm(ctx, "INVOICE", options);
      case "RECEIPT_CUSTOMER": return this.collectCustomer(ctx, "RECEIPT");
      case "RECEIPT_CUSTOMER_PICK": return this.pickCustomer(ctx, "RECEIPT");
      case "RECEIPT_ITEM_OR_AMOUNT": return this.collectItemOrAmount(ctx, "RECEIPT");
      case "RECEIPT_ITEM_QTY": return this.collectItemQty(ctx, "RECEIPT");
      case "RECEIPT_MORE_ITEMS": return this.collectMoreItems(ctx, "RECEIPT");
      case "RECEIPT_AMOUNT": return this.collectAmount(ctx, "RECEIPT");
      case "RECEIPT_DESC": return this.collectDesc(ctx, "RECEIPT");
      case "RECEIPT_CONFIRM": return this.confirm(ctx, "RECEIPT", options);
      case "SHARE_SERVICE_SELECT": return this.shareSelect(ctx);
      case "MAIN_MENU":
      default: return this.mainMenu(ctx);
    }
  }

  private async mainMenu(ctx: HandlerCtx): Promise<HandlerResult> {
    // The reply is a position in this business's menu, not a fixed action:
    // "5" is today's bookings for a service business, orders for a shop.
    const action = MENU[ctx.sells].find((_, i) => String(i + 1) === ctx.text)?.action;
    switch (action) {
      case "NEW_INVOICE":
        return { reply: text("Customer's name?"), nextState: "INVOICE_CUSTOMER", context: {} };
      case "NEW_RECEIPT":
        return { reply: text("Customer's name?"), nextState: "RECEIPT_CUSTOMER", context: {} };
      case "SHARE_LINK":
        return this.startShare(ctx);
      case "UNPAID":
        return { reply: text(await intentDispatcher.listUnpaidInvoices(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "TODAY_BOOKINGS":
        return { reply: text(await intentDispatcher.listTodayBookings(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "SUMMARY":
        return { reply: text(await intentDispatcher.businessSummary(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      case "ORDERS_TO_SEND":
        return { reply: text(await intentDispatcher.ordersToSendOutText(ctx.businessId)), nextState: "MAIN_MENU", context: null };
      default:
        return { reply: text(mainMenuText(ctx.sells)), nextState: "MAIN_MENU", context: null };
    }
  }

  private async startShare(ctx: HandlerCtx): Promise<HandlerResult> {
    // A business that only sells services shares booking links, as it always has.
    if (ctx.sells === "SERVICES") return this.startShareService(ctx);

    const options = await intentDispatcher.listShareOptions(ctx.businessId);
    if (options.length === 0) {
      const what = ctx.sells === "PRODUCTS" ? "products" : "products or services";
      return {
        reply: text(`You have no active ${what} to share.\n\n${mainMenuText(ctx.sells)}`),
        nextState: "MAIN_MENU",
        context: null,
      };
    }
    return {
      reply: text(`Which ${listNoun(options, "one")}? Reply with a number:\n${numbered(options)}`),
      nextState: "SHARE_SERVICE_SELECT",
      context: { services: options },
    };
  }

  private async startShareService(ctx: HandlerCtx): Promise<HandlerResult> {
    const services = await intentDispatcher.listServiceOptions(ctx.businessId);
    if (services.length === 0) {
      return {
        reply: text(`You have no active services to share.\n\n${mainMenuText(ctx.sells)}`),
        nextState: "MAIN_MENU",
        context: null,
      };
    }
    return {
      reply: text(`Which service? Reply with a number:\n${numbered(services)}`),
      nextState: "SHARE_SERVICE_SELECT",
      context: { services },
    };
  }

  /** The owner's pick from the share list: a booking link for a service, a product link for a product. */
  private shareSelect(ctx: HandlerCtx): HandlerResult {
    const options = ctx.context.services ?? [];
    const index = parseInt(ctx.text, 10) - 1;
    const chosen = Number.isInteger(index) ? options[index] : undefined;
    if (!chosen) {
      return {
        reply: text(`Please reply with a number from the list:\n${numbered(options)}`),
        nextState: "SHARE_SERVICE_SELECT",
        context: ctx.context,
      };
    }
    return {
      reply: text(
        isProduct(chosen)
          ? intentDispatcher.productLinkText(chosen.slug)
          : intentDispatcher.bookingLinkText(chosen),
      ),
      nextState: "MAIN_MENU",
      context: null,
    };
  }

  /**
   * "Customer's name?" One customer with exactly that name is linked without
   * asking. Customers whose name starts with the typed words are offered as a
   * numbered choice with "New customer" last. Otherwise the typed name becomes
   * a new customer when the invoice or receipt is created.
   */
  private async collectCustomer(ctx: HandlerCtx, kind: Kind): Promise<HandlerResult> {
    if (ctx.text.length === 0) {
      return { reply: text("Customer's name?"), nextState: `${kind}_CUSTOMER`, context: ctx.context };
    }
    const customerName = ctx.text;
    const { exact, similar } = await customerService.findByName(ctx.businessId, customerName);
    if (exact) {
      return this.offerItems(ctx, kind, { customerName: exact.name, customerId: exact.id });
    }
    if (similar.length > 0) {
      const customerChoices = similar.map((customer) => ({
        id: customer.id,
        name: customer.name,
        label: customerLabel(customer),
      }));
      return {
        reply: text(`Which customer?\n${customerChoiceList(customerChoices)}`),
        nextState: `${kind}_CUSTOMER_PICK`,
        context: { ...ctx.context, customerName, customerChoices },
      };
    }
    return this.offerItems(ctx, kind, { customerName });
  }

  private async pickCustomer(ctx: HandlerCtx, kind: Kind): Promise<HandlerResult> {
    const typedName = ctx.context.customerName;
    if (!typedName) {
      return { reply: text("Customer's name?"), nextState: `${kind}_CUSTOMER`, context: {} };
    }
    const choices = ctx.context.customerChoices ?? [];
    const trimmed = ctx.text.trim();
    const index = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) - 1 : -1;
    const chosen = index >= 0 ? choices[index] : undefined;
    if (chosen) {
      return this.offerItems(ctx, kind, { customerName: chosen.name, customerId: chosen.id });
    }
    // The number after the matches is "New customer": carry on with the name as typed.
    if (index === choices.length) {
      return this.offerItems(ctx, kind, { customerName: typedName });
    }
    return {
      reply: text(`Please reply with a number from the list:\n${customerChoiceList(choices)}`),
      nextState: `${kind}_CUSTOMER_PICK`,
      context: ctx.context,
    };
  }

  /** With the customer settled, offer services and products to add, or ask for an amount when there are none. */
  private async offerItems(
    ctx: HandlerCtx,
    kind: Kind,
    customer: { customerName: string; customerId?: string },
  ): Promise<HandlerResult> {
    const draft: Draft = {
      ...ctx.context,
      customerName: customer.customerName,
      customerId: customer.customerId,
      customerChoices: undefined,
    };
    const availableServices = await intentDispatcher.listItemOptions(ctx.businessId);
    if (availableServices.length === 0) {
      return {
        reply: text(kind === "INVOICE" ? "Amount? e.g. 5000" : "Amount paid? e.g. 5000"),
        nextState: `${kind}_AMOUNT`,
        context: draft,
      };
    }
    const noun = listNoun(availableServices, "item");
    return {
      reply: text(
        `Add ${withArticle(noun)}, or enter a custom amount:\n${numbered(availableServices)}\n\n` +
          `Reply with ${withArticle(noun)} number, or enter an amount (e.g. 5000)`,
      ),
      nextState: `${kind}_ITEM_OR_AMOUNT`,
      context: { ...draft, availableServices, selectedItems: [] },
    };
  }

  private collectItemOrAmount(ctx: HandlerCtx, kind: Kind): HandlerResult {
    const items = ctx.context.availableServices ?? [];
    const trimmed = ctx.text.trim();
    const isItemIndex = /^\d+$/.test(trimmed);
    const index = isItemIndex ? parseInt(trimmed, 10) - 1 : -1;
    if (index >= 0 && index < items.length) {
      const chosen = items[index]!;
      return {
        reply: text(`How many ${chosen.name}? (e.g. 1 or 2)`),
        nextState: `${kind}_ITEM_QTY`,
        context: { ...ctx.context, pendingServiceId: chosen.id },
      };
    }
    const amount = parseAmount(ctx.text);
    if (amount !== null) {
      return {
        reply: text("What's it for? (or 'skip')"),
        nextState: `${kind}_DESC`,
        context: { ...ctx.context, amount, selectedItems: [] },
      };
    }
    const noun = listNoun(items, "item");
    return {
      reply: text(
        `Please reply with ${withArticle(noun)} number (1-${items.length}) or enter an amount (e.g. 5000):\n${numbered(items)}`,
      ),
      nextState: `${kind}_ITEM_OR_AMOUNT`,
      context: ctx.context,
    };
  }

  private collectItemQty(ctx: HandlerCtx, kind: Kind): HandlerResult {
    const trimmed = ctx.text.trim();
    const qty = /^\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    if (!Number.isInteger(qty) || qty <= 0) {
      return {
        reply: text("Please enter a valid count (e.g. 1 or 2):"),
        nextState: `${kind}_ITEM_QTY`,
        context: ctx.context,
      };
    }
    const items = ctx.context.availableServices ?? [];
    const noun = listNoun(items, "item");
    const item = items.find((s) => s.id === ctx.context.pendingServiceId);
    if (!item) {
      return {
        reply: text(`${capitalise(noun)} not found. Let's enter an amount: e.g. 5000`),
        nextState: `${kind}_AMOUNT`,
        context: { ...ctx.context, pendingServiceId: undefined },
      };
    }
    const itemTotal = item.price * qty;
    const existing = ctx.context.selectedItems ?? [];
    const existingIndex = existing.findIndex((line) => isSameItem(line, item));
    let selectedItems: SelectedItem[];
    if (existingIndex >= 0) {
      const current = existing[existingIndex]!;
      const newQty = current.quantity + qty;
      const newTotal = item.price * newQty;
      selectedItems = [
        ...existing.slice(0, existingIndex),
        { ...current, quantity: newQty, total: newTotal },
        ...existing.slice(existingIndex + 1),
      ];
    } else {
      selectedItems = [
        ...existing,
        {
          ...itemRef(item),
          name: item.name,
          quantity: qty,
          unitPrice: item.price,
          total: itemTotal,
        },
      ];
    }
    const total = selectedItems.reduce((acc, it) => acc + it.total, 0);
    return {
      reply: text(
        `Added: ${qty} × ${item.name} (${formatMoney(itemTotal, item.currency)})\n` +
          `Total so far: ${formatMoney(total, item.currency)}\n\n` +
          `Add another ${noun}?\n${numbered(items)}\n\n` +
          `Reply with ${withArticle(noun)} number to add more, or DONE to continue.`,
      ),
      nextState: `${kind}_MORE_ITEMS`,
      context: { ...ctx.context, selectedItems, amount: total, pendingServiceId: undefined },
    };
  }

  private collectMoreItems(ctx: HandlerCtx, kind: Kind): HandlerResult {
    const trimmed = ctx.text.trim();
    const lower = trimmed.toLowerCase();
    if (lower === "done") {
      return {
        reply: text("What's it for? (or 'skip')"),
        nextState: `${kind}_DESC`,
        context: ctx.context,
      };
    }
    const items = ctx.context.availableServices ?? [];
    const isItemIndex = /^\d+$/.test(trimmed);
    const index = isItemIndex ? parseInt(trimmed, 10) - 1 : -1;
    if (index >= 0 && index < items.length) {
      const chosen = items[index]!;
      return {
        reply: text(`How many ${chosen.name}? (e.g. 1 or 2)`),
        nextState: `${kind}_ITEM_QTY`,
        context: { ...ctx.context, pendingServiceId: chosen.id },
      };
    }
    return {
      reply: text(
        `Reply with ${withArticle(listNoun(items, "item"))} number to add more, or DONE to continue.`,
      ),
      nextState: `${kind}_MORE_ITEMS`,
      context: ctx.context,
    };
  }

  private collectAmount(ctx: HandlerCtx, kind: Kind): HandlerResult {
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

  private collectDesc(ctx: HandlerCtx, kind: Kind): HandlerResult {
    const description = ctx.text.toLowerCase() === "skip" ? undefined : ctx.text;
    const merged: Draft = { ...ctx.context, description };
    const label = kind === "INVOICE" ? "invoice" : "receipt";
    const selected = merged.selectedItems ?? [];
    let summary: string;
    if (selected.length > 0) {
      const currency = merged.availableServices?.[0]?.currency ?? "";
      const lines = selected.map((it) => `• ${it.quantity} × ${it.name} — ${formatMoney(it.total, currency)}`);
      summary =
        `New ${label}: ${merged.customerName}\n` +
        `${lines.join("\n")}\n` +
        `Total: ${formatMoney(merged.amount ?? 0, currency)}` +
        (description ? `\nNotes: ${description}` : "");
    } else {
      summary =
        `New ${label}: ${merged.customerName} · ${formatMoney(merged.amount ?? 0, "")}` +
        (description ? ` · ${description}` : "");
    }
    return {
      reply: text(`${summary}\n\nReply YES to create, NO to cancel`),
      nextState: `${kind}_CONFIRM`,
      context: merged,
    };
  }

  private async confirm(
    ctx: HandlerCtx,
    kind: Kind,
    options?: HandleOptions,
  ): Promise<HandlerResult> {
    const menu = mainMenuText(ctx.sells);
    const answer = ctx.text.toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return { reply: text(`Okay, cancelled.\n\n${menu}`), nextState: "MAIN_MENU", context: null };
    }
    const draft = ctx.context;
    if (!draft.customerName || draft.amount == null) {
      return { reply: text(`Something went wrong. Let's start over.\n\n${menu}`), nextState: "MAIN_MENU", context: null };
    }

    if (options?.onProgress) {
      try {
        await options.onProgress(
          text(kind === "INVOICE" ? "Creating invoice... ⏳" : "Creating receipt... ⏳"),
        );
      } catch (err) {
        console.warn("[ConversationEngine] onProgress error ignored:", err);
      }
    }

    const linesPayload = draft.selectedItems && draft.selectedItems.length > 0
      ? draft.selectedItems.map((it) => ({
          ...(it.productOptionId
            ? { productOptionId: it.productOptionId }
            : { serviceId: it.serviceId }),
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
          description: it.name,
        }))
      : undefined;
    const writeDraft: WriteDraft = {
      customerName: draft.customerName,
      amount: draft.amount,
      description: draft.description,
    };
    if (draft.customerId) {
      writeDraft.customerId = draft.customerId;
    }
    if (linesPayload) {
      writeDraft.lines = linesPayload;
    }
    try {
      if (kind === "INVOICE") {
        const res = await intentDispatcher.createInvoice(ctx.businessId, writeDraft);
        return {
          reply: text(
            `Invoice ${res.number} created ✅\nPayment link: ${res.link}\n\n` +
              `Share with ${draft.customerName}:\n— — —\nHi ${draft.customerName}, here's your invoice. Pay securely: ${res.link}\n— — —`,
          ),
          nextState: "MAIN_MENU",
          context: null,
        };
      }
      const res = await intentDispatcher.createReceipt(ctx.businessId, writeDraft);
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
