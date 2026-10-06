import { dashboardService } from "@/backend/services/dashboard";
import { invoiceService } from "@/backend/services/invoice";
import { receiptService } from "@/backend/services/receipt";
import { db } from "@/server/db";
import { publicLink } from "@/server/share";
import { NotFoundException } from "@/utils/exceptions";
import { serviceLabel, todayEventLabel, unitCount } from "@/utils/format";
import { formatMoney } from "../engine/amount";
import { publicUrl } from "@/utils/url";

export type WriteDraft = {
  customerName: string;
  amount: number;
  description?: string;
};
export type WriteResult = { number: string; link: string };
export type ServiceOption = { slug: string; label: string };

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
    });
    return {
      number: receipt.receiptNumber,
      link: publicLink("receipt", receipt.publicId),
    };
  }

  async listServiceOptions(businessId: string): Promise<ServiceOption[]> {
    const currency = await this.currencyFor(businessId);
    const services = await db.service.findMany({
      where: { businessId, isActive: true },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { slug: true, name: true, price: true, duration: true, bookingMode: true },
    });
    return services.map((s) => ({
      slug: s.slug,
      label: serviceLabel({ name: s.name, price: Number(s.price), duration: s.duration, currency, bookingMode: s.bookingMode }),
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
