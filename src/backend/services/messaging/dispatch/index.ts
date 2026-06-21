import { invoiceService } from "@/backend/services/invoice";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { NotFoundException } from "@/utils/exceptions";
import { formatMoney } from "../engine/amount";
import { publicUrl } from "../url";

export type WriteDraft = {
  customerName: string;
  amount: number;
  description?: string;
};
export type WriteResult = { number: string; link: string };
export type ServiceOption = { slug: string; label: string };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function startOfWeek(): Date {
  const d = startOfToday();
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  return d;
}
function endOfToday(): Date {
  const d = startOfToday();
  d.setDate(d.getDate() + 1);
  return d;
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
    });
    return {
      number: invoice.invoiceNumber,
      link: invoice.url ?? publicUrl("invoices", invoice.slug),
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
    });
    return {
      number: receipt.receiptNumber,
      link: receipt.url ?? publicUrl("receipts", receipt.slug),
    };
  }

  async listServiceOptions(businessId: string): Promise<ServiceOption[]> {
    const currency = await this.currencyFor(businessId);
    const services = await db.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { slug: true, name: true, price: true, duration: true },
    });
    return services.map((s) => ({
      slug: s.slug,
      label: `${s.name} — ${formatMoney(Number(s.price), currency)} (${s.duration} min)`,
    }));
  }

  bookingLinkText(option: ServiceOption): string {
    const link = publicUrl("book", option.slug);
    return (
      `Share this booking link with your customer:\n${link}\n` +
      `— — —\nHi! You can book here: ${link}\n— — —`
    );
  }

  async listUnpaidInvoices(businessId: string): Promise<string> {
    const invoices = await db.invoice.findMany({
      where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { invoiceNumber: true, clientName: true, total: true, amountPaid: true, currency: true },
    });
    if (invoices.length === 0) return "✅ No unpaid invoices. You're all settled up!";
    const lines = invoices.map((inv) => {
      const outstanding = Number(inv.total) - Number(inv.amountPaid);
      return `• ${inv.clientName} — ${formatMoney(outstanding, inv.currency)} (${inv.invoiceNumber})`;
    });
    return `🧾 Unpaid invoices:\n${lines.join("\n")}`;
  }

  async listTodayBookings(businessId: string): Promise<string> {
    const bookings = await db.booking.findMany({
      where: {
        businessId,
        startTime: { gte: startOfToday(), lt: endOfToday() },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { startTime: "asc" },
      take: 20,
      select: { startTime: true, clientName: true, service: { select: { name: true } } },
    });
    if (bookings.length === 0) return "📅 No bookings today.";
    const lines = bookings.map((b) => {
      const time = b.startTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `• ${time} — ${b.service.name} (${b.clientName})`;
    });
    return `📅 Today's bookings:\n${lines.join("\n")}`;
  }

  async businessSummary(businessId: string): Promise<string> {
    const currency = await this.currencyFor(businessId);
    const [todayAgg, weekAgg, unpaidCount] = await Promise.all([
      db.payment.aggregate({ where: { businessId, createdAt: { gte: startOfToday() } }, _sum: { amount: true } }),
      db.payment.aggregate({ where: { businessId, createdAt: { gte: startOfWeek() } }, _sum: { amount: true } }),
      db.invoice.count({ where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } } }),
    ]);
    return [
      "📊 Business summary",
      `• Today's revenue: ${formatMoney(Number(todayAgg._sum.amount ?? 0), currency)}`,
      `• This week: ${formatMoney(Number(weekAgg._sum.amount ?? 0), currency)}`,
      `• Unpaid invoices: ${unpaidCount}`,
    ].join("\n");
  }
}

export const intentDispatcher = new IntentDispatcher();
