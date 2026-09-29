import sharp from "sharp";

import { formatMoney } from "@/utils/format";
import { INVOICE_STATUS, PAYMENT_METHOD, formatDate } from "@/utils/labels";

type InvoicePdfItem = {
  description: string;
  quantity: number;
  unitPrice: number | string;
  total: number | string;
};

export type InvoicePdfData = {
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotal: number | string;
  taxAmount: number | string;
  discount: number | string;
  total: number | string;
  amountPaid: number | string;
  dueAt?: Date | null;
  sentAt?: Date | null;
  paidAt?: Date | null;
  notes?: string | null;
  business: {
    name: string;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    logoUrl?: string | null;
  };
  client: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  items: InvoicePdfItem[];
};

export type ReceiptPdfData = {
  receiptNumber: string;
  paymentMethod?: string | null;
  currency: string;
  subtotal: number | string;
  taxAmount: number | string;
  discount: number | string;
  total: number | string;
  amountPaid: number | string;
  paidAt?: Date | null;
  notes?: string | null;
  business: {
    name: string;
    email?: string | null;
    phone?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    logoUrl?: string | null;
  };
  client: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  items: InvoicePdfItem[];
};

type PdfImage = {
  data: Buffer;
  width: number;
  height: number;
};

/*
 * Invoices and receipts, drawn to DESIGN.md: a calm document on white, ink
 * and green-tinted greys, hairline rules, the customer as the title, a
 * sentence-case status pill, "NGN 25,000" money right-aligned in columns,
 * and green only where money is settled. The layout follows the invoice on
 * the landing page (landing/v1/impeccable).
 *
 * The PDF is written by hand, with the standard Helvetica and Courier fonts
 * (no embedding), so layout measures text with their published metrics.
 */

// DESIGN.md colour tokens, as PDF RGB.
type Rgb = readonly [number, number, number];
const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];
const COLOR = {
  ink: hex("#0f1a14"),
  ink2: hex("#37443c"),
  muted: hex("#5a665f"),
  faint: hex("#7f8a84"),
  line: hex("#e5ebe7"),
  surface: hex("#f4f7f5"),
  accent: hex("#25d366"),
  accentInk: hex("#075e54"),
  accentSoft: hex("#e8f9ee"),
  danger: hex("#b42318"),
  dangerSoft: hex("#fef3f2"),
} as const;

const PILL_TONES = {
  accent: { fill: COLOR.accentSoft, text: COLOR.accentInk },
  muted: { fill: COLOR.surface, text: COLOR.muted },
  danger: { fill: COLOR.dangerSoft, text: COLOR.danger },
} as const;

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;
/** Content stops here; the footer sits below. */
const BOTTOM = PAGE_HEIGHT - 72;

// Item table: right edges of the numeric columns.
const QTY_RIGHT = 356;
const PRICE_RIGHT = 450;
const DESCRIPTION_WIDTH = QTY_RIGHT - 44 - MARGIN;
// Totals and the meta block share this left edge.
const SIDE_LEFT = 340;

// --- Text: WinAnsi encoding and Helvetica metrics ---------------------------

type Font = "regular" | "bold" | "mono";
const FONT_RESOURCE: Record<Font, string> = {
  regular: "F1",
  bold: "F2",
  mono: "F3",
};

// Adobe's widths for Helvetica and Helvetica-Bold, characters 32-126, in
// thousandths of the font size.
const HELVETICA =
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
    .split(" ")
    .map(Number);
const HELVETICA_BOLD =
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584"
    .split(" ")
    .map(Number);

// WinAnsi's extra characters in 128-159, by the byte they are drawn with.
const WIN_ANSI_EXTRAS: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "„": 0x84,
  "…": 0x85,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "™": 0x99,
  "−": 0x96, // A minus sign draws as an en dash, which Helvetica has.
};
const EXTRA_WIDTHS: Record<number, number> = {
  0x80: 556,
  0x82: 222,
  0x84: 333,
  0x85: 1000,
  0x91: 222,
  0x92: 222,
  0x93: 333,
  0x94: 333,
  0x95: 350,
  0x96: 556,
  0x97: 1000,
  0x99: 1000,
  0xa0: 278, // no-break space
  0xb7: 278, // middle dot
};

/** Printable ASCII and Latin-1, which WinAnsi draws with the same byte. */
const isDrawable = (code: number) =>
  (code >= 32 && code < 127) || (code >= 160 && code <= 255);

/**
 * The text as WinAnsi characters (one char per byte). Latin-1 passes
 * through, so "Adébáyọ̀" keeps its é and á; anything else loses its accents
 * ("ọ" draws as "o"), and what is still not drawable becomes "?".
 */
const toWinAnsi = (value: string) => {
  let out = "";
  for (const char of value.replace(/\s+/g, " ").normalize("NFC")) {
    const code = char.codePointAt(0)!;
    if (isDrawable(code)) {
      out += char;
    } else if (WIN_ANSI_EXTRAS[char] !== undefined) {
      out += String.fromCharCode(WIN_ANSI_EXTRAS[char]);
    } else if (char === "₦") {
      out += "NGN";
    } else {
      // A lone combining mark (the grave in "ọ̀") has no base and is dropped.
      const base = char.normalize("NFD").replace(/\p{M}/gu, "");
      if (!base) continue;
      out += [...base].every((c) => isDrawable(c.charCodeAt(0))) ? base : "?";
    }
  }
  return out;
};

const charWidth = (code: number, font: Font) => {
  if (font === "mono") return 600;
  const table = font === "bold" ? HELVETICA_BOLD : HELVETICA;
  if (code >= 32 && code <= 126) return table[code - 32]!;
  if (EXTRA_WIDTHS[code]) return EXTRA_WIDTHS[code];
  const base = String.fromCharCode(code).normalize("NFD").charCodeAt(0);
  return base >= 32 && base <= 126 ? table[base - 32]! : 556;
};

/** Width in points of text already converted with toWinAnsi. */
const measure = (encoded: string, size: number, font: Font) => {
  let units = 0;
  for (let i = 0; i < encoded.length; i++) {
    units += charWidth(encoded.charCodeAt(i), font);
  }
  return (units / 1000) * size;
};

const escapePdfText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Words wrapped to a width; a word longer than the line is kept whole. */
const wrap = (text: string, width: number, size: number, font: Font) => {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && measure(toWinAnsi(next), size, font) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

// --- Drawing ----------------------------------------------------------------

type TextOptions = {
  size?: number;
  font?: Font;
  color?: Rgb;
  align?: "left" | "right";
};

const num = (value: number) => value.toFixed(2);
const rgb = (color: Rgb) => color.map((c) => c.toFixed(3)).join(" ");

/**
 * Drawing commands, one list per page. Coordinates are measured from the
 * top of the page (PDF's own origin is the bottom), and `y` for text is the
 * baseline.
 */
class PdfCanvas {
  readonly pages: string[][] = [[]];

  private get commands() {
    return this.pages[this.pages.length - 1]!;
  }

  addPage() {
    this.pages.push([]);
  }

  text(value: string, x: number, y: number, options: TextOptions = {}) {
    const { size = 10, font = "regular", color = COLOR.ink } = options;
    const encoded = toWinAnsi(value);
    const left =
      options.align === "right" ? x - measure(encoded, size, font) : x;
    this.commands.push(
      `BT ${rgb(color)} rg /${FONT_RESOURCE[font]} ${size} Tf ${num(left)} ${num(
        PAGE_HEIGHT - y,
      )} Td (${escapePdfText(encoded)}) Tj ET`,
    );
  }

  line(x1: number, y: number, x2: number, color: Rgb = COLOR.line) {
    const top = num(PAGE_HEIGHT - y);
    this.commands.push(
      `q ${rgb(color)} RG 0.75 w ${num(x1)} ${top} m ${num(x2)} ${top} l S Q`,
    );
  }

  /** A filled rectangle, with rounded corners when `radius` is set. */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: Rgb,
    radius = 0,
  ) {
    const r = Math.min(radius, width / 2, height / 2);
    const left = x;
    const right = x + width;
    const top = PAGE_HEIGHT - y;
    const bottom = top - height;
    const k = r * 0.5523; // Bezier handle length for a quarter circle.
    const path =
      r === 0
        ? `${num(left)} ${num(bottom)} ${num(width)} ${num(height)} re`
        : [
            `${num(left + r)} ${num(bottom)} m`,
            `${num(right - r)} ${num(bottom)} l`,
            `${num(right - r + k)} ${num(bottom)} ${num(right)} ${num(bottom + r - k)} ${num(right)} ${num(bottom + r)} c`,
            `${num(right)} ${num(top - r)} l`,
            `${num(right)} ${num(top - r + k)} ${num(right - r + k)} ${num(top)} ${num(right - r)} ${num(top)} c`,
            `${num(left + r)} ${num(top)} l`,
            `${num(left + r - k)} ${num(top)} ${num(left)} ${num(top - r + k)} ${num(left)} ${num(top - r)} c`,
            `${num(left)} ${num(bottom + r)} l`,
            `${num(left)} ${num(bottom + r - k)} ${num(left + r - k)} ${num(bottom)} ${num(left + r)} ${num(bottom)} c`,
            "h",
          ].join(" ");
    this.commands.push(`q ${rgb(fill)} rg ${path} f Q`);
  }

  image(name: string, x: number, y: number, width: number, height: number) {
    this.commands.push(
      `q ${num(width)} 0 0 ${num(height)} ${num(x)} ${num(
        PAGE_HEIGHT - y - height,
      )} cm /${name} Do Q`,
    );
  }
}

// --- Shared layout ----------------------------------------------------------

type DocumentData = {
  kind: "Invoice" | "Receipt";
  number: string;
  pill: { label: string; tone: keyof typeof PILL_TONES };
  /** Label and value pairs under the pill: dates, payment method. */
  meta: Array<[string, string]>;
  currency: string;
  subtotal: number | string;
  taxAmount: number | string;
  discount: number | string;
  total: number | string;
  amountPaid: number | string;
  notes?: string | null;
  business: InvoicePdfData["business"];
  client: InvoicePdfData["client"];
  items: InvoicePdfItem[];
};

const money = (value: number | string, currency: string) =>
  formatMoney(value, currency);

const pdfDate = (date: Date) => formatDate(date.toISOString());

/** Sentence-case status pill, right-aligned at `right`, like StatusPill. */
const drawPill = (
  canvas: PdfCanvas,
  label: string,
  tone: keyof typeof PILL_TONES,
  right: number,
  top: number,
) => {
  const size = 9.5;
  const width = measure(toWinAnsi(label), size, "bold") + 20;
  const { fill, text } = PILL_TONES[tone];
  canvas.rect(right - width, top, width, 22, fill, 11);
  canvas.text(label, right - 10, top + 14.5, {
    size,
    font: "bold",
    color: text,
    align: "right",
  });
};

const drawTableHeader = (canvas: PdfCanvas, y: number) => {
  const style = { size: 9, color: COLOR.muted };
  canvas.text("Item", MARGIN, y, style);
  canvas.text("Qty", QTY_RIGHT, y, { ...style, align: "right" });
  canvas.text("Price", PRICE_RIGHT, y, { ...style, align: "right" });
  canvas.text("Amount", RIGHT, y, { ...style, align: "right" });
  canvas.line(MARGIN, y + 10, RIGHT);
  return y + 30;
};

const drawFooter = (canvas: PdfCanvas, data: DocumentData) => {
  canvas.pages.forEach((_, index) => {
    // Footers are drawn onto every page once the body is laid out.
    const page = canvas.pages[index]!;
    const draw = new PdfCanvas();
    const y = PAGE_HEIGHT - 36;
    draw.line(MARGIN, y - 18, RIGHT);
    draw.text(data.business.name, MARGIN, y, { size: 8.5, color: COLOR.faint });
    const pageLabel =
      canvas.pages.length > 1
        ? `${data.number} · Page ${index + 1} of ${canvas.pages.length}`
        : `${data.number} · Made with Sara`;
    draw.text(pageLabel, RIGHT, y, {
      size: 8.5,
      color: COLOR.faint,
      align: "right",
    });
    page.push(...draw.pages[0]!);
  });
};

const renderDocument = async (data: DocumentData) => {
  const logo = await fetchLogo(data.business.logoUrl);
  const canvas = new PdfCanvas();
  const { currency } = data;
  let y = MARGIN;

  // Header: the business on the left, the document on the right.
  let left = y;
  if (logo) {
    const scale = Math.min(140 / logo.width, 44 / logo.height, 1);
    const width = logo.width * scale;
    const height = logo.height * scale;
    canvas.image("Logo", MARGIN, left, width, height);
    left += height + 20;
    canvas.text(data.business.name, MARGIN, left, { size: 11, font: "bold" });
  } else {
    left += 18;
    canvas.text(data.business.name, MARGIN, left, { size: 17, font: "bold" });
  }
  left += 16;
  [
    data.business.email,
    data.business.phone,
    [data.business.city, data.business.state, data.business.country]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .forEach((line) => {
      canvas.text(String(line), MARGIN, left, {
        size: 9.5,
        color: COLOR.muted,
      });
      left += 13.5;
    });

  canvas.text(data.kind, RIGHT, y + 20, { size: 22, align: "right" });
  canvas.text(data.number, RIGHT, y + 38, {
    size: 10,
    font: "mono",
    color: COLOR.faint,
    align: "right",
  });

  y = Math.max(left, y + 50) + 14;
  canvas.line(MARGIN, y, RIGHT);
  y += 34;

  // Who it is for, and the status with its dates.
  const partiesTop = y;
  canvas.text("Billed to", MARGIN, y, { size: 9, color: COLOR.muted });
  y += 26;
  wrap(data.client.name, SIDE_LEFT - MARGIN - 24, 20, "regular")
    .slice(0, 2)
    .forEach((line) => {
      canvas.text(line, MARGIN, y, { size: 20 });
      y += 24;
    });
  y -= 6;
  [data.client.email, data.client.phone].filter(Boolean).forEach((line) => {
    canvas.text(String(line), MARGIN, y, { size: 10, color: COLOR.muted });
    y += 14;
  });

  drawPill(canvas, data.pill.label, data.pill.tone, RIGHT, partiesTop - 14);
  let side = partiesTop + 30;
  data.meta.forEach(([label, value]) => {
    canvas.text(label, SIDE_LEFT, side, { size: 9.5, color: COLOR.muted });
    canvas.text(value, RIGHT, side, { size: 10, align: "right" });
    side += 18;
  });

  y = Math.max(y, side) + 22;

  // Line items.
  y = drawTableHeader(canvas, y);
  data.items.forEach((item) => {
    const lines = wrap(item.description, DESCRIPTION_WIDTH, 10.5, "regular");
    // Each rule sits 10pt under the row's last line; the next row starts 20pt below it.
    const height = (lines.length - 1) * 14 + 30;
    if (y + height > BOTTOM) {
      canvas.addPage();
      y = drawTableHeader(canvas, MARGIN + 10);
    }
    lines.forEach((line, index) => {
      canvas.text(line, MARGIN, y + index * 14, { size: 10.5 });
    });
    const figures = { size: 10.5, align: "right" as const };
    canvas.text(String(item.quantity), QTY_RIGHT, y, figures);
    canvas.text(money(item.unitPrice, currency), PRICE_RIGHT, y, figures);
    canvas.text(money(item.total, currency), RIGHT, y, figures);
    y += height;
    canvas.line(MARGIN, y - 20, RIGHT);
  });

  // Totals: quiet lines, then the total. Tax and discount only when used.
  const soft: Array<[string, string]> = [
    ["Subtotal", money(data.subtotal, currency)],
  ];
  if (Number(data.taxAmount) > 0)
    soft.push(["Tax", money(data.taxAmount, currency)]);
  if (Number(data.discount) > 0) {
    soft.push(["Discount", `−${money(data.discount, currency)}`]);
  }

  const total = Number(data.total);
  const paid = Number(data.amountPaid);
  const outstanding = Math.max(total - paid, 0);
  const totalsHeight = soft.length * 20 + 120 + (paid > 0 ? 40 : 0);
  if (y + 14 + totalsHeight > BOTTOM) {
    canvas.addPage();
    y = MARGIN + 10;
  }

  y += 14;
  soft.forEach(([label, value]) => {
    canvas.text(label, SIDE_LEFT, y, { size: 10, color: COLOR.muted });
    canvas.text(value, RIGHT, y, {
      size: 10,
      color: COLOR.muted,
      align: "right",
    });
    y += 20;
  });
  canvas.line(SIDE_LEFT, y - 6, RIGHT);
  y += 18;
  canvas.text("Total", SIDE_LEFT, y, { size: 13, font: "bold" });
  canvas.text(money(total, currency), RIGHT, y, {
    size: 15,
    font: "bold",
    align: "right",
  });
  y += 26;

  if (data.kind === "Receipt") {
    canvas.text("Amount paid", SIDE_LEFT, y, {
      size: 10,
      color: COLOR.accentInk,
    });
    canvas.text(money(paid, currency), RIGHT, y, {
      size: 10,
      font: "bold",
      color: COLOR.accentInk,
      align: "right",
    });
    y += 20;
    if (outstanding > 0) {
      canvas.text("Still owed", SIDE_LEFT, y, { size: 10, color: COLOR.muted });
      canvas.text(money(outstanding, currency), RIGHT, y, {
        size: 10,
        color: COLOR.muted,
        align: "right",
      });
      y += 20;
    }
  } else {
    if (paid > 0 && total > 0) {
      // The landing invoice's progress bar: mint track, green fill.
      const width = RIGHT - SIDE_LEFT;
      canvas.rect(SIDE_LEFT, y - 4, width, 6, COLOR.accentSoft, 3);
      canvas.rect(
        SIDE_LEFT,
        y - 4,
        width * Math.min(paid / total, 1),
        6,
        COLOR.accent,
        3,
      );
      y += 18;
      canvas.text(
        `${money(paid, currency)} of ${money(total, currency)} paid`,
        SIDE_LEFT,
        y,
        { size: 9, color: COLOR.muted },
      );
      y += 22;
    }
    canvas.text(
      outstanding > 0 ? "Balance due" : "Nothing owed",
      SIDE_LEFT,
      y,
      {
        size: 10.5,
        font: "bold",
      },
    );
    canvas.text(money(outstanding, currency), RIGHT, y, {
      size: 10.5,
      font: "bold",
      color: outstanding > 0 ? COLOR.ink : COLOR.accentInk,
      align: "right",
    });
    y += 20;
  }

  // Notes, on a leaf-grey panel.
  if (data.notes?.trim()) {
    const lines = wrap(data.notes, RIGHT - MARGIN - 36, 10, "regular").slice(
      0,
      8,
    );
    const height = 40 + lines.length * 14;
    y += 18;
    if (y + height > BOTTOM) {
      canvas.addPage();
      y = MARGIN + 10;
    }
    canvas.rect(MARGIN, y, RIGHT - MARGIN, height, COLOR.surface, 14);
    canvas.text("Notes", MARGIN + 18, y + 22, { size: 9, color: COLOR.muted });
    lines.forEach((line, index) => {
      canvas.text(line, MARGIN + 18, y + 40 + index * 14, {
        size: 10,
        color: COLOR.ink2,
      });
    });
  }

  drawFooter(canvas, data);
  return buildPdf(canvas.pages, logo);
};

// --- Invoice and receipt ----------------------------------------------------

export const generateInvoicePdf = (invoice: InvoicePdfData) => {
  const status = INVOICE_STATUS[invoice.status] ?? {
    label: invoice.status,
    tone: "muted" as const,
  };
  const meta: Array<[string, string]> = [
    ["Issued", pdfDate(invoice.sentAt ?? new Date())],
  ];
  if (invoice.dueAt) meta.push(["Due", pdfDate(invoice.dueAt)]);
  if (invoice.paidAt) meta.push(["Paid", pdfDate(invoice.paidAt)]);

  return renderDocument({
    kind: "Invoice",
    number: invoice.invoiceNumber,
    pill: status,
    meta,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    discount: invoice.discount,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    notes: invoice.notes,
    business: invoice.business,
    client: invoice.client,
    items: invoice.items,
  });
};

export const generateReceiptPdf = (receipt: ReceiptPdfData) => {
  const meta: Array<[string, string]> = [
    ["Paid on", pdfDate(receipt.paidAt ?? new Date())],
  ];
  if (receipt.paymentMethod) {
    meta.push([
      "Paid by",
      PAYMENT_METHOD[receipt.paymentMethod] ?? receipt.paymentMethod,
    ]);
  }

  return renderDocument({
    kind: "Receipt",
    number: receipt.receiptNumber,
    pill: { label: "Paid", tone: "accent" },
    meta,
    currency: receipt.currency,
    subtotal: receipt.subtotal,
    taxAmount: receipt.taxAmount,
    discount: receipt.discount,
    total: receipt.total,
    amountPaid: receipt.amountPaid,
    notes: receipt.notes,
    business: receipt.business,
    client: receipt.client,
    items: receipt.items,
  });
};

// --- Logo and file assembly -------------------------------------------------

const fetchLogo = async (logoUrl?: string | null): Promise<PdfImage | null> => {
  if (!logoUrl || logoUrl.includes("placeimg.com")) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const input = Buffer.from(await response.arrayBuffer());
    // Twice the drawn size, so the logo stays sharp when zoomed or printed.
    const { data, info } = await sharp(input)
      .resize({
        width: 280,
        height: 88,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });

    return {
      data,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("Logo fetch timed out");
    } else {
      console.warn(
        "Unable to embed business logo in invoice PDF:",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
};

const buildPdf = (pages: string[][], logo: PdfImage | null) => {
  const objects: Buffer[] = [];

  const addObject = (body: string | Buffer) => {
    const id = objects.length + 1;
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return id;
  };

  const catalogId = addObject("placeholder");
  const pagesId = addObject("placeholder");
  const font = (name: string) =>
    addObject(
      `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`,
    );
  const fonts = `/F1 ${font("Helvetica")} 0 R /F2 ${font("Helvetica-Bold")} 0 R /F3 ${font("Courier")} 0 R`;

  let logoId: number | null = null;
  if (logo) {
    logoId = addObject(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>\nstream\n`,
          "latin1",
        ),
        logo.data,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
  }

  const resources = `<< /Font << ${fonts} >>${
    logoId ? ` /XObject << /Logo ${logoId} 0 R >>` : ""
  } >>`;

  const pageIds = pages.map((commands) => {
    // Text is already WinAnsi, one char per byte, so latin1 writes it as is.
    const content = Buffer.from(commands.join("\n"), "latin1");
    const contentId = addObject(
      Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "latin1"),
        content,
        Buffer.from("\nendstream", "latin1"),
      ]),
    );
    return addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources ${resources} /Contents ${contentId} 0 R >>`,
    );
  });

  objects[catalogId - 1] = Buffer.from(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    "latin1",
  );
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`,
    "latin1",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets: number[] = [0];
  let length = chunks[0]!.length;

  objects.forEach((object, index) => {
    offsets.push(length);
    const piece = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "latin1"),
      object,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    chunks.push(piece);
    length += piece.length;
  });

  const xrefRows = offsets
    .map((offset, index) =>
      index === 0
        ? "0000000000 65535 f "
        : `${String(offset).padStart(10, "0")} 00000 n `,
    )
    .join("\n");

  chunks.push(
    Buffer.from(
      `xref\n0 ${objects.length + 1}\n${xrefRows}\ntrailer\n<< /Size ${
        objects.length + 1
      } /Root ${catalogId} 0 R >>\nstartxref\n${length}\n%%EOF\n`,
      "latin1",
    ),
  );

  return Buffer.concat(chunks);
};
