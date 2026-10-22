import { dashboardService } from "@/backend/services/dashboard";
import { invoiceService } from "@/backend/services/invoice";
import { productService, type ProductWithOptions } from "@/backend/services/product";
import { optionLabel } from "@/backend/services/product/labels";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { productLink, publicLink, serviceLink } from "@/server/share";
import { NotFoundException } from "@/utils/exceptions";
import { serviceLabel, todayEventLabel, unitCount } from "@/utils/format";
import { orderStatusLabel } from "@/utils/labels";
import { stockBadge } from "@/utils/stock";
import { formatMoney } from "../engine/amount";

/** A line the chat sends: a service or a product option, never both. */
export type WriteLineDraft = {
  serviceId?: string;
  productOptionId?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  description?: string | null;
};

export type WriteDraft = {
  customerName: string;
  /** The existing customer the owner picked in the chat, if any. */
  customerId?: string;
  amount: number;
  description?: string;
  lines?: WriteLineDraft[];
};
export type WriteResult = { number: string; link: string };
export type ServiceOption = { slug: string; label: string };
export type FullServiceOption = {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  label: string;
};

export type ItemKind = "SERVICE" | "PRODUCT";

/**
 * One entry in the chat's invoice and receipt item list. For a product, `id`
 * and `productOptionId` are both the option's id, `slug` is the product's and
 * `name` is the option's label ("Frontal wig — 20\"").
 */
export type ItemOption = FullServiceOption & {
  kind: ItemKind;
  productOptionId?: string;
};

/** One entry in the chat's "Share a link" list. */
export type ShareOption = { kind: ItemKind; slug: string; label: string };

/** The most of each kind a chat list shows, so a reply stays readable. */
const LIST_LIMIT = 20;

/** "Frontal wig — NGN 45,000 (11 in stock)": the product's price and its stock across options. */
function productShareLabel(product: ProductWithOptions, currency: string): string {
  const stock = product.options.reduce((sum, option) => sum + option.stock, 0);
  const badge = stockBadge(product.tracksStock, stock);
  return `${product.name} — ${formatMoney(Number(product.price), currency)} (${badge.label})`;
}

/** Every active option of every active product, labelled with its own price and stock. */
function productItemOptions(products: ProductWithOptions[], currency: string): ItemOption[] {
  return products
    .flatMap((product) =>
      product.options.map((option) => {
        const name = optionLabel(product.name, option.name);
        const price = Number(option.price ?? product.price);
        const badge = stockBadge(product.tracksStock, option.stock);
        return {
          kind: "PRODUCT" as const,
          id: option.id,
          productOptionId: option.id,
          slug: product.slug,
          name,
          price,
          currency,
          label: `${name} — ${formatMoney(price, currency)} (${badge.label})`,
        };
      }),
    )
    .slice(0, LIST_LIMIT);
}

class IntentDispatcher {
  private async currencyFor(businessId: string): Promise<string> {
    const business = await db.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    if (!business) throw new NotFoundException("Business not found");
    return business.currency;
  }

  private async activeServices(businessId: string) {
    return db.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: LIST_LIMIT,
      select: { id: true, slug: true, name: true, price: true, duration: true, bookingMode: true },
    });
  }

  async createInvoice(businessId: string, draft: WriteDraft): Promise<WriteResult> {
    const currency = await this.currencyFor(businessId);
    const invoice = await invoiceService.create({
      businessId,
      name: draft.customerName,
      status: "SENT",
      currency,
      subtotal: draft.amount,
      taxAmount: 0,
      discount: 0,
      total: draft.amount,
      amountPaid: 0,
      sentAt: new Date(),
      notes: draft.description ?? null,
      customerId: draft.customerId ?? null,
      lines: draft.lines,
    });
    return {
      number: invoice.invoiceNumber,
      link: publicLink("invoice", invoice.publicId),
    };
  }

  async createReceipt(businessId: string, draft: WriteDraft): Promise<WriteResult> {
    const currency = await this.currencyFor(businessId);
    const receipt = await receiptService.create({
      businessId,
      name: draft.customerName,
      currency,
      subtotal: draft.amount,
      taxAmount: 0,
      discount: 0,
      total: draft.amount,
      amountPaid: draft.amount,
      notes: draft.description ?? null,
      customerId: draft.customerId ?? null,
      lines: draft.lines,
    });
    return {
      number: receipt.receiptNumber,
      link: publicLink("receipt", receipt.publicId),
    };
  }

  /** What an invoice or receipt can list: active services, then every active product option. */
  async listItemOptions(businessId: string): Promise<ItemOption[]> {
    const currency = await this.currencyFor(businessId);
    const [services, products] = await Promise.all([
      this.activeServices(businessId),
      productService.list(businessId),
    ]);
    const serviceOptions: ItemOption[] = services.map((s) => ({
      kind: "SERVICE",
      id: s.id,
      slug: s.slug,
      name: s.name,
      price: Number(s.price),
      currency,
      label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode }),
    }));
    return [...serviceOptions, ...productItemOptions(products, currency)];
  }

  async listServiceOptions(businessId: string): Promise<ServiceOption[]> {
    const currency = await this.currencyFor(businessId);
    const services = await this.activeServices(businessId);
    return services.map((s) => ({
      slug: s.slug,
      label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode }),
    }));
  }

  /** "Share a link" for a business that sells products: its services, then its products with their stock. */
  async listShareOptions(businessId: string): Promise<ShareOption[]> {
    const currency = await this.currencyFor(businessId);
    const [services, products] = await Promise.all([
      this.activeServices(businessId),
      productService.list(businessId),
    ]);
    return [
      ...services.map((s) => ({
        kind: "SERVICE" as const,
        slug: s.slug,
        label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode }),
      })),
      ...products.slice(0, LIST_LIMIT).map((product) => ({
        kind: "PRODUCT" as const,
        slug: product.slug,
        label: productShareLabel(product, currency),
      })),
    ];
  }

  bookingLinkText(option: ServiceOption): string {
    // The service's page; its "Book a time" opens /book/<slug>.
    const link = serviceLink(option.slug);
    return (
      `Share this booking link with your customer:\n${link}\n` +
      `— — —\nHi! You can book here: ${link}\n— — —`
    );
  }

  productLinkText(slug: string): string {
    // The product's page, where the customer picks an option and checks out.
    const link = productLink(slug);
    return (
      `Share this product link with your customer:\n${link}\n` +
      `— — —\nHi! You can buy it here: ${link}\n— — —`
    );
  }

  /** Paid orders not yet handed over, oldest first, as the Today page lists them. */
  async ordersToSendOutText(businessId: string): Promise<string> {
    const orders = await dashboardService.ordersToSendOut(businessId);
    if (orders.length === 0) return "✅ Nothing to send out.";
    const lines = orders.map(
      (order, i) =>
        `${i + 1}. ${order.orderNumber} · ${order.clientName} · ` +
        `${order.fulfilment === "DELIVERY" ? "Delivery" : "Pickup"} · ` +
        orderStatusLabel(order.status, order.fulfilment),
    );
    return `📦 Orders to send out:\n${lines.join("\n")}`;
  }

  async listUnpaidInvoices(businessId: string): Promise<string> {
    const invoices = await dashboardService.unpaidInvoices(businessId);
    if (invoices.length === 0) return "✅ No unpaid invoices. You're all settled up!";
    const lines = invoices.map(
      (inv) =>
        `• ${inv.clientName} — ${formatMoney(inv.outstanding, inv.currency)} (${inv.invoiceNumber})`,
    );
    return `🧾 Unpaid invoices:\n${lines.join("\n")}`;
  }

  async listTodayBookings(businessId: string): Promise<string> {
    const bookings = await dashboardService.todayBookings(businessId);
    if (bookings.length === 0) return "📅 No bookings today.";
    const lines = bookings.map((b) => {
      const time = b.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      if (b.kind === "SLOT") return `• ${time} — ${b.serviceName} (${b.clientName})`;
      const length =
        b.kind === "CHECK_IN" ? `, ${unitCount("NIGHTLY", b.units)}` : b.kind === "PICKUP" ? `, ${unitCount("DAILY", b.units)}` : "";
      return `• ${time} — ${todayEventLabel(b.kind)}: ${b.serviceName} (${b.clientName}${length})`;
    });
    return `📅 Today's bookings:\n${lines.join("\n")}`;
  }

  async businessSummary(businessId: string): Promise<string> {
    const currency = await this.currencyFor(businessId);
    const summary = await dashboardService.summary(businessId);
    return [
      "📊 Business summary",
      `• Today's revenue: ${formatMoney(summary.todayRevenue, currency)}`,
      `• This week: ${formatMoney(summary.weekRevenue, currency)}`,
      `• Unpaid invoices: ${summary.unpaidCount}`,
    ].join("\n");
  }
}

export const intentDispatcher = new IntentDispatcher();
