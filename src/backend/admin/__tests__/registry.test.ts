import { nameKey } from "@/backend/services/customer/normalize";
import { describe, expect, it } from "vitest";
import { SECRET_FIELD, resolveRegistry, uncoveredModels } from "../kit/policy";
import { adminRegistry } from "../registry";

const TOTALS_NOTE = "Totals aren't recomputed from lines or payments.";
const SIGN_IN_ONLY = ["chat-link-tokens", "accounts", "sessions"];
const WITH_TOTALS = [
  "invoices",
  "invoice-lines",
  "receipts",
  "receipt-lines",
  "orders",
  "order-lines",
];

describe("sara admin registry", () => {
  const resolved = resolveRegistry(adminRegistry);
  const fieldsOf = (key: string) =>
    resolved.byKey.get(key)!.fields.map((f) => f.name);

  it("classifies every model", () =>
    expect(uncoveredModels(adminRegistry)).toEqual([]));

  it("registers the spec §7.2 keys in order", () =>
    expect(resolved.resources.map((r) => r.key)).toEqual([
      "users",
      "businesses",
      "business-hours",
      "business-closures",
      "services",
      "products",
      "product-options",
      "gallery-items",
      "customers",
      "bookings",
      "invoices",
      "invoice-lines",
      "receipts",
      "receipt-lines",
      "orders",
      "order-lines",
      "payments",
      "chat-identities",
      "chat-sessions",
      "chat-link-tokens",
      "accounts",
      "sessions",
    ]));

  it("maps each key to its model, title and group", () => {
    expect(
      resolved.resources.map((r) => [r.key, r.model, r.titleField, r.group]),
    ).toEqual([
      ["users", "User", "email", "People"],
      ["businesses", "Business", "name", "Businesses"],
      ["business-hours", "BusinessHours", "dayOfWeek", "Businesses"],
      ["business-closures", "BusinessClosure", "date", "Businesses"],
      ["services", "Service", "name", "Catalogue"],
      ["products", "Product", "name", "Catalogue"],
      ["product-options", "ProductOption", "name", "Catalogue"],
      ["gallery-items", "GalleryItem", "url", "Catalogue"],
      ["customers", "Customer", "name", "Customers"],
      ["bookings", "Booking", "clientName", "Sales"],
      ["invoices", "Invoice", "invoiceNumber", "Sales"],
      ["invoice-lines", "InvoiceLine", "name", "Sales"],
      ["receipts", "Receipt", "receiptNumber", "Sales"],
      ["receipt-lines", "ReceiptLine", "name", "Sales"],
      ["orders", "Order", "clientName", "Sales"],
      ["order-lines", "OrderLine", "name", "Sales"],
      ["payments", "Payment", "clientName", "Sales"],
      ["chat-identities", "ChatIdentity", "externalId", "Chat"],
      ["chat-sessions", "ChatSession", "state", "Chat"],
      ["chat-link-tokens", "ChatLinkToken", "externalId", "Sign-in"],
      ["accounts", "Account", "provider", "Sign-in"],
      ["sessions", "Session", "userId", "Sign-in"],
    ]);
  });

  it("excludes only the verification token", () =>
    expect(Object.keys(adminRegistry.excluded)).toEqual(["VerificationToken"]));

  it("exposes nothing secret", () =>
    expect(
      resolved.resources.flatMap((r) =>
        r.fields
          .filter((f) => SECRET_FIELD.test(f.name))
          .map((f) => `${r.key}.${f.name}`),
      ),
    ).toEqual([]));

  it("keeps the Google Calendar tokens off businesses", () => {
    const fields = fieldsOf("businesses");
    expect(fields).not.toContain("googleCalendarAccessToken");
    expect(fields).not.toContain("googleCalendarRefreshToken");
    // The rest of the calendar settings are not secret.
    expect(fields).toContain("googleCalendarId");
  });

  it("hides the link token, the session token and the account session state", () => {
    expect(fieldsOf("chat-link-tokens")).not.toContain("token");
    expect(fieldsOf("sessions")).not.toContain("sessionToken");
    expect(fieldsOf("accounts")).not.toContain("session_state");
    expect(fieldsOf("accounts")).not.toContain("access_token");
    expect(fieldsOf("accounts")).not.toContain("refresh_token");
    expect(fieldsOf("accounts")).not.toContain("id_token");
  });

  it("lets sign-in records be revoked only", () => {
    for (const key of SIGN_IN_ONLY) {
      expect(resolved.byKey.get(key)!.can).toEqual({
        create: false,
        update: false,
        delete: true,
      });
    }
  });

  it("lets every other resource be created, changed and deleted", () => {
    for (const resource of resolved.resources) {
      if (SIGN_IN_ONLY.includes(resource.key)) continue;
      expect(resource.can).toEqual({
        create: true,
        update: true,
        delete: true,
      });
    }
  });

  it("notes that totals aren't recomputed on the Sales documents", () => {
    for (const key of WITH_TOTALS) {
      expect(resolved.byKey.get(key)!.note).toBe(TOTALS_NOTE);
    }
  });

  it("adds a note only where the spec gives one", () =>
    expect(
      resolved.resources.filter((r) => r.note !== null).map((r) => r.key),
    ).toEqual([...WITH_TOTALS, "payments", "chat-sessions"]));

  it("warns that a payment is changed on its own", () =>
    expect(resolved.byKey.get("payments")!.note).toBe(
      "Changes this record only. Paystack isn't contacted.",
    ));

  it("warns that editing a chat session changes what Sara does next", () =>
    expect(resolved.byKey.get("chat-sessions")!.note).toBe(
      "Live chat state. Editing it changes what Sara does next in that chat.",
    ));
});

describe("the customers nameKey hook", () => {
  const resolved = resolveRegistry(adminRegistry);
  const customers = resolved.byKey.get("customers")!;
  const beforeWrite = customers.hooks.beforeWrite;
  if (!beforeWrite) throw new Error("customers has no beforeWrite hook");

  it("shows nameKey but never accepts it", () => {
    const field = customers.fields.find((f) => f.name === "nameKey")!;
    expect(field.readOnly).toBe(true);
    expect(field.required).toBe(false);
  });

  it("sets nameKey from a name on create", () =>
    expect(beforeWrite({ name: "Adaeze  Obi" }, "create").nameKey).toBe(
      nameKey("Adaeze  Obi"),
    ));

  it("sets nameKey from a name on update, keeping the other fields", () =>
    expect(
      beforeWrite({ name: " Chidi OKAFOR ", phone: "+2348031234567" }, "update"),
    ).toEqual({
      name: " Chidi OKAFOR ",
      phone: "+2348031234567",
      nameKey: "chidi okafor",
    }));

  it("leaves a write that doesn't set name alone", () => {
    const data = { phone: "+2348031234567" };
    expect(beforeWrite(data, "update")).toEqual({ phone: "+2348031234567" });
    expect(beforeWrite(data, "update")).not.toHaveProperty("nameKey");
  });
});
