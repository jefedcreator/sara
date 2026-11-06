import { resolveDraft } from "../../src/backend/services/assistant/actions/resolve";
import { draftRequestSchema } from "../../src/backend/services/assistant/actions/schemas";
import { renderSummary } from "../../src/backend/services/assistant/actions/summary";
import type { PreparedAction } from "../../src/backend/services/assistant/actions/types";
import { periodRange } from "../../src/backend/services/assistant/clock";
import { readRequestSchema, type ReadRequest } from "../../src/backend/services/assistant/tools/schemas";
import type { ToolDispatcher, ToolOutcome } from "../../src/backend/services/assistant/tools/registry";
import { createFixtures, fixtureDatabase, NOW, URLS, type Fixtures } from "./fixtures";

type Facts = Record<string, string | number | boolean>;
type Row = Record<string, unknown>;
function row(value: unknown): Row { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {}; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(row) : []; }
function primitiveFacts(value: Row): Facts {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean"));
}

function draftFacts(prepared: PreparedAction): Facts {
  const p = row(prepared.payload), s = row(prepared.snapshot);
  const facts = primitiveFacts(p);
  if (prepared.kind === "create_invoice" || prepared.kind === "create_receipt") {
    const lines = rows(p.lines), first = lines[0] ?? {};
    Object.assign(facts, { customerId: row(p.customer).id ?? "", optionId: first.productOptionId ?? "",
      quantity: lines.reduce((n, line) => n + Number(line.quantity), 0), unitPriceMinor: first.unitPriceMinor ?? 0,
      priceSource: rows(s.catalogLines)[0]?.priceSource ?? "", stockAfter: Object.values(row(s.stockAfter))[0] ?? 0 });
  }
  if (prepared.kind === "void_invoice") {
    const order = row(s.orderInfo);
    Object.assign(facts, { orderId: order.id ?? "", restockQuantity: rows(order.restockLines).reduce((n, line) => n + Number(line.quantity), 0) });
  }
  if (prepared.kind === "create_product") {
    Object.assign(facts, { photos: 0, stock: rows(p.options)[0]?.stock ?? 0, optionName: rows(p.options)[0]?.name ?? "" });
  }
  return facts;
}

/** Fixture facts are computed from independent data, never from case expectations. */
function readFacts(f: Fixtures, args: ReadRequest): Facts {
  switch (args.name) {
    case "find_customers": {
      const customers = f.customers.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(args.query.toLowerCase()));
      return { count: customers.length, ids: customers.map((c) => c.id).join(","), customers: JSON.stringify(customers) };
    }
    case "list_items": return { products: JSON.stringify(f.products), services: JSON.stringify([f.service]) };
    case "unpaid_invoices": {
      const range = args.period === "all" ? null : periodRange(args.period, NOW);
      const invoices = f.invoices.filter((i) => i.status !== "PAID" && (!args.customerId || i.customerId === args.customerId)
        && (!range || (new Date(i.dueAt) >= range.from && new Date(i.dueAt) < range.to)));
      return { ...(range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {}),
        outstandingMinor: invoices.reduce((n, i) => n + i.totalMinor - i.paidMinor, 0), count: invoices.length, invoices: JSON.stringify(invoices) };
    }
    case "business_summary": {
      const range = periodRange(args.period, NOW);
      const payments = f.payments.filter((p) => new Date(p.at) >= range.from && new Date(p.at) < range.to);
      const facts: Facts = { period: args.period, byItem: args.byItem, totalMinor: payments.reduce((n, p) => n + p.amountMinor, 0), count: payments.length };
      for (const payment of payments) facts[`item.${payment.itemId}.totalMinor`] = Number(facts[`item.${payment.itemId}.totalMinor`] ?? 0) + payment.amountMinor;
      return facts;
    }
    case "list_bookings": {
      const parse = (date: string) => new Date(date.length === 10 ? `${date}T00:00:00+01:00` : date);
      const from = parse(args.from), to = parse(args.to);
      if (+to <= +from || +to - +from > 31 * 86_400_000) throw new Error("Invalid fixture range");
      const bookings = f.bookings.filter((b) => b.status !== "COMPLETED" && new Date(b.startTime) >= from && new Date(b.startTime) < to);
      return { from: from.toISOString(), to: to.toISOString(), count: bookings.length, ids: bookings.map((b) => b.id).join(","), bookings: JSON.stringify(bookings) };
    }
    case "orders_to_send": {
      const orders = f.orders.filter((o) => o.status === "NEW" || o.status === "READY");
      return { count: orders.length, statuses: orders.map((o) => o.status).join(","), ids: orders.map((o) => o.id).join(","), orders: JSON.stringify(orders) };
    }
    case "get_customer": {
      const customer = f.customers.find((c) => c.id === args.customerId);
      if (!customer) throw new Error("Unknown fixture customer");
      return { customerId: customer.id, outstandingMinor: f.invoices.filter((i) => i.customerId === customer.id).reduce((n, i) => n + i.totalMinor - i.paidMinor, 0) };
    }
    case "find_document": {
      if (args.kind === "invoice") {
        const invoice = f.invoices.find((i) => i.number === args.number);
        if (!invoice) throw new Error("Unknown fixture document");
        return { documentId: invoice.id, number: invoice.number, totalMinor: invoice.totalMinor,
          paidMinor: invoice.paidMinor, outstandingMinor: invoice.totalMinor - invoice.paidMinor };
      }
      const order = f.orders.find((o) => o.number === args.number);
      if (!order || args.kind !== "order") throw new Error("Unknown fixture document");
      return { documentId: order.id, number: order.number, status: order.status };
    }
    case "share_link": {
      const item = args.kind === "product" ? f.products.find((p) => p.id === args.id) : f.service.id === args.id ? f.service : undefined;
      if (!item) throw new Error("Unknown fixture item");
      return { id: item.id, url: args.kind === "service" ? URLS.gele : item.id === f.products[1]?.id ? URLS.shea : URLS.wig };
    }
  }
}

/** Only reads and previews exist here; mutations fail before touching any real DB. */
export function createFixtureDispatcher() {
  const fixtures = createFixtures();
  const state = { facts: {} as Facts, domainWrites: 0, drafts: 0 };
  const database = fixtureDatabase(fixtures, () => { state.domainWrites += 1; throw new Error("FORBIDDEN_WRITE"); });
  const dispatch: ToolDispatcher = async (context, name, argumentsJson): Promise<ToolOutcome> => {
    context.signal.throwIfAborted();
    const args: unknown = JSON.parse(argumentsJson);
    if (!name.startsWith("draft_")) {
      const parsed = readRequestSchema.parse(args);
      if (parsed.name !== name) throw new Error("Tool name mismatch");
      const facts = readFacts(fixtures, parsed);
      state.facts = facts;
      return { kind: "read", data: facts, text: JSON.stringify(facts) };
    }
    const request = draftRequestSchema.parse(args);
    if (name !== `draft_${request.kind}`) throw new Error("Tool name mismatch");
    try {
      const prepared = await resolveDraft(database, context.scope, request, context.evidence, context.now);
      if ("question" in prepared) {
        state.facts = { choiceCount: prepared.choices.length, choices: prepared.choices.map((c) => c.id).join(","), pendingWrites: 0 };
        return { kind: "clarification", question: prepared.question, choices: prepared.choices };
      }
      state.drafts += 1;
      state.facts = { ...draftFacts(prepared), draftCount: state.drafts, priorReplaced: state.drafts > 1 };
      return { kind: "draft", draft: { id: `fixture-draft-${state.drafts}`, summary: renderSummary(prepared.kind, prepared.payload, prepared.snapshot),
        expiresAt: new Date(+NOW + 86_400_000).toISOString(), status: "PENDING" } };
    } catch (error) {
      if (error instanceof Error && error.message === "Payment cannot exceed the outstanding balance" && request.kind === "record_invoice_payment") {
        const invoice = fixtures.invoices.find((i) => i.id === request.invoiceId)!;
        state.facts = { error: "BALANCE_EXCEEDED", outstandingMinor: invoice.totalMinor - invoice.paidMinor, pendingWrites: 0 };
        return { kind: "error", code: "BALANCE_EXCEEDED", message: "Payment exceeds the outstanding balance.", question: "How much was paid?" };
      }
      throw error;
    }
  };
  return { dispatch, get facts() { return state.facts; }, get domainWrites() { return state.domainWrites; } };
}
