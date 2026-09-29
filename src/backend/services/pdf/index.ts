import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type Color,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
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

/*
 * Invoices and receipts, drawn to DESIGN.md: a calm document on white, ink
 * and green-tinted greys, hairline rules, the customer as the title, a
 * sentence-case status pill, "NGN 25,000" money right-aligned in columns,
 * and green only where money is settled. The layout follows the invoice on
 * the landing page (landing/v1/impeccable).
 *
 * Type is the app's own: Bricolage Grotesque for display (the document
 * title, the customer) and Hanken Grotesk for everything else, embedded and
 * subset from assets/fonts. Hanken's digits are tabular, so every figure is
 * set in it (DESIGN.md's Tabular Money Rule).
 */

// DESIGN.md colour tokens.
const hex = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
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
};

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

// --- Fonts ------------------------------------------------------------------

type Font = "display" | "regular" | "bold" | "mono";

/*
 * Read from assets/fonts at the project root, which the Docker image copies
 * and next.config.js traces for the API routes. Read once per process.
 */
const FONT_FILES = {
  display: "BricolageGrotesque-Regular.ttf",
  regular: "HankenGrotesk-Regular.ttf",
  bold: "HankenGrotesk-SemiBold.ttf",
} as const;

type FontBytes = Record<keyof typeof FONT_FILES, Buffer>;
let fontBytes: Promise<FontBytes> | undefined;

const loadFontBytes = () =>
  (fontBytes ??= Promise.all(
    Object.entries(FONT_FILES).map(async ([role, file]) => [
      role,
      await readFile(path.join(process.cwd(), "assets", "fonts", file)),
    ]),
  ).then((entries) => Object.fromEntries(entries) as FontBytes));

const embedFonts = async (doc: PDFDocument) => {
  doc.registerFontkit(fontkit);
  const bytes = await loadFontBytes();
  const fonts: Record<Font, PDFFont> = {
    display: await doc.embedFont(bytes.display, { subset: true }),
    regular: await doc.embedFont(bytes.regular, { subset: true }),
    bold: await doc.embedFont(bytes.bold, { subset: true }),
    // The document number, like the landing invoice's monospace number.
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  const glyphs = Object.fromEntries(
    Object.entries(fonts).map(([role, font]) => [
      role,
      new Set(font.getCharacterSet()),
    ]),
  ) as Record<Font, Set<number>>;
  return { fonts, glyphs };
};

// --- Drawing ----------------------------------------------------------------

type TextOptions = {
  size?: number;
  font?: Font;
  color?: Color;
  align?: "left" | "right";
};

/**
 * One document's pages. Coordinates are measured from the top of the page
 * (PDF's own origin is the bottom), and `y` for text is the baseline. Every
 * string drawn is kept in `drawn`, which is how tests read the output.
 */
class PdfCanvas {
  readonly drawn: string[] = [];
  private page: PDFPage;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: Record<Font, PDFFont>,
    private readonly glyphs: Record<Font, Set<number>>,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }

  addPage() {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  }

  /**
   * The text with every character the font can draw. Accented letters are
   * composed first ("é", "ọ"); an accent that stays a separate mark (the
   * tone mark in "ọ̀") is dropped, because pdf-lib draws marks by advance
   * width and they land beside the letter instead of over it. Missing
   * letters fall back to their unaccented form, then "?". "₦" reads "NGN",
   * the app's form anyway.
   */
  private drawable(value: string, font: Font) {
    const has = (char: string) => this.glyphs[font].has(char.codePointAt(0)!);
    let out = "";
    for (const char of value.replace(/\s+/g, " ").normalize("NFC")) {
      if (/\p{M}/u.test(char)) continue;
      else if (has(char)) out += char;
      else if (char === "₦") out += "NGN";
      else {
        const base = char.normalize("NFD").replace(/\p{M}/gu, "");
        out += base && [...base].every(has) ? base : "?";
      }
    }
    return out;
  }

  measure(value: string, size: number, font: Font) {
    return this.fonts[font].widthOfTextAtSize(this.drawable(value, font), size);
  }

  text(value: string, x: number, y: number, options: TextOptions = {}) {
    const { size = 10, font = "regular", color = COLOR.ink } = options;
    const safe = this.drawable(value, font);
    const width = this.fonts[font].widthOfTextAtSize(safe, size);
    this.drawn.push(safe);
    this.page.drawText(safe, {
      x: options.align === "right" ? x - width : x,
      y: PAGE_HEIGHT - y,
      size,
      font: this.fonts[font],
      color,
    });
  }

  line(x1: number, y: number, x2: number, color: Color = COLOR.line) {
    this.page.drawLine({
      start: { x: x1, y: PAGE_HEIGHT - y },
      end: { x: x2, y: PAGE_HEIGHT - y },
      thickness: 0.75,
      color,
    });
  }

  /** A filled rectangle, with rounded corners when `radius` is set. */
  rect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: Color,
    radius = 0,
  ) {
    if (width <= 0 || height <= 0) return;
    const r = Math.min(radius, width / 2, height / 2);
    if (r === 0) {
      this.page.drawRectangle({
        x,
        y: PAGE_HEIGHT - y - height,
        width,
        height,
        color: fill,
      });
      return;
    }
    // An SVG path is drawn with y pointing down from its origin, which is
    // the page's top-left here.
    const right = x + width;
    const bottom = y + height;
    this.page.drawSvgPath(
      [
        `M ${x + r} ${y}`,
        `H ${right - r}`,
        `A ${r} ${r} 0 0 1 ${right} ${y + r}`,
        `V ${bottom - r}`,
        `A ${r} ${r} 0 0 1 ${right - r} ${bottom}`,
        `H ${x + r}`,
        `A ${r} ${r} 0 0 1 ${x} ${bottom - r}`,
        `V ${y + r}`,
        `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
        "Z",
      ].join(" "),
      { x: 0, y: PAGE_HEIGHT, color: fill },
    );
  }

  image(image: PDFImage, x: number, y: number, width: number, height: number) {
    this.page.drawImage(image, {
      x,
      y: PAGE_HEIGHT - y - height,
      width,
      height,
    });
  }

  /** Runs `draw` on every page, for the footer once the body is laid out. */
  eachPage(draw: (index: number, count: number) => void) {
    const current = this.page;
    const pages = this.doc.getPages();
    pages.forEach((page, index) => {
      this.page = page;
      draw(index, pages.length);
    });
    this.page = current;
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

const pdfDate = (date: Date) => formatDate(date.toISOString());

/** Words wrapped to a width; a word longer than the line is kept whole. */
const wrap = (
  canvas: PdfCanvas,
  text: string,
  width: number,
  size: number,
  font: Font,
) => {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && canvas.measure(next, size, font) > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

/** Sentence-case status pill, right-aligned at `right`, like StatusPill. */
const drawPill = (
  canvas: PdfCanvas,
  label: string,
  tone: keyof typeof PILL_TONES,
  right: number,
  top: number,
) => {
  const size = 9.5;
  const width = canvas.measure(label, size, "bold") + 22;
  const { fill, text } = PILL_TONES[tone];
  canvas.rect(right - width, top, width, 22, fill, 11);
  canvas.text(label, right - 11, top + 14.5, {
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

const renderDocument = async (data: DocumentData) => {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.kind} ${data.number}`);
  doc.setAuthor(data.business.name);
  doc.setCreator("Sara");
  doc.setProducer("Sara");

  const [{ fonts, glyphs }, logo] = await Promise.all([
    embedFonts(doc),
    fetchLogo(data.business.logoUrl),
  ]);
  const logoImage = logo ? await doc.embedJpg(logo) : null;
  const canvas = new PdfCanvas(doc, fonts, glyphs);
  const money = (value: number | string) => formatMoney(value, data.currency);
  let y = MARGIN;

  // Header: the business on the left, the document on the right.
  let left = y;
  if (logoImage) {
    const scale = Math.min(140 / logoImage.width, 44 / logoImage.height, 1);
    const width = logoImage.width * scale;
    const height = logoImage.height * scale;
    canvas.image(logoImage, MARGIN, left, width, height);
    left += height + 20;
    canvas.text(data.business.name, MARGIN, left, { size: 11, font: "bold" });
  } else {
    left += 18;
    canvas.text(data.business.name, MARGIN, left, { size: 16, font: "bold" });
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

  canvas.text(data.kind, RIGHT, y + 22, {
    size: 26,
    font: "display",
    align: "right",
  });
  canvas.text(data.number, RIGHT, y + 40, {
    size: 10,
    font: "mono",
    color: COLOR.faint,
    align: "right",
  });

  y = Math.max(left, y + 52) + 14;
  canvas.line(MARGIN, y, RIGHT);
  y += 34;

  // Who it is for, and the status with its dates.
  const partiesTop = y;
  canvas.text("Billed to", MARGIN, y, { size: 9, color: COLOR.muted });
  y += 27;
  wrap(canvas, data.client.name, SIDE_LEFT - MARGIN - 24, 22, "display")
    .slice(0, 2)
    .forEach((line) => {
      canvas.text(line, MARGIN, y, { size: 22, font: "display" });
      y += 26;
    });
  y -= 7;
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
    const lines = wrap(
      canvas,
      item.description,
      DESCRIPTION_WIDTH,
      10.5,
      "regular",
    );
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
    canvas.text(money(item.unitPrice), PRICE_RIGHT, y, figures);
    canvas.text(money(item.total), RIGHT, y, figures);
    y += height;
    canvas.line(MARGIN, y - 20, RIGHT);
  });

  // Totals: quiet lines, then the total. Tax and discount only when used.
  const soft: Array<[string, string]> = [["Subtotal", money(data.subtotal)]];
  if (Number(data.taxAmount) > 0) soft.push(["Tax", money(data.taxAmount)]);
  if (Number(data.discount) > 0) {
    soft.push(["Discount", `−${money(data.discount)}`]);
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
  canvas.text(money(total), RIGHT, y, {
    size: 16,
    font: "bold",
    align: "right",
  });
  y += 26;

  if (data.kind === "Receipt") {
    canvas.text("Amount paid", SIDE_LEFT, y, {
      size: 10,
      color: COLOR.accentInk,
    });
    canvas.text(money(paid), RIGHT, y, {
      size: 10,
      font: "bold",
      color: COLOR.accentInk,
      align: "right",
    });
    y += 20;
    if (outstanding > 0) {
      canvas.text("Still owed", SIDE_LEFT, y, { size: 10, color: COLOR.muted });
      canvas.text(money(outstanding), RIGHT, y, {
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
      canvas.text(`${money(paid)} of ${money(total)} paid`, SIDE_LEFT, y, {
        size: 9,
        color: COLOR.muted,
      });
      y += 22;
    }
    canvas.text(
      outstanding > 0 ? "Balance due" : "Nothing owed",
      SIDE_LEFT,
      y,
      { size: 10.5, font: "bold" },
    );
    canvas.text(money(outstanding), RIGHT, y, {
      size: 10.5,
      font: "bold",
      color: outstanding > 0 ? COLOR.ink : COLOR.accentInk,
      align: "right",
    });
    y += 20;
  }

  // Notes, on a leaf-grey panel.
  if (data.notes?.trim()) {
    const lines = wrap(
      canvas,
      data.notes,
      RIGHT - MARGIN - 36,
      10,
      "regular",
    ).slice(0, 8);
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

  // Footer on every page.
  canvas.eachPage((index, count) => {
    const footer = PAGE_HEIGHT - 36;
    canvas.line(MARGIN, footer - 18, RIGHT);
    canvas.text(data.business.name, MARGIN, footer, {
      size: 8.5,
      color: COLOR.faint,
    });
    canvas.text(
      count > 1
        ? `${data.number} · Page ${index + 1} of ${count}`
        : `${data.number} · Made with Sara`,
      RIGHT,
      footer,
      { size: 8.5, color: COLOR.faint, align: "right" },
    );
  });

  return {
    pdf: Buffer.from(await doc.save()),
    pageCount: doc.getPageCount(),
    text: canvas.drawn,
  };
};

// --- Invoice and receipt ----------------------------------------------------

const invoiceDocument = (invoice: InvoicePdfData): DocumentData => {
  const meta: Array<[string, string]> = [
    ["Issued", pdfDate(invoice.sentAt ?? new Date())],
  ];
  if (invoice.dueAt) meta.push(["Due", pdfDate(invoice.dueAt)]);
  if (invoice.paidAt) meta.push(["Paid", pdfDate(invoice.paidAt)]);

  return {
    kind: "Invoice",
    number: invoice.invoiceNumber,
    pill: INVOICE_STATUS[invoice.status] ?? {
      label: invoice.status,
      tone: "muted",
    },
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
  };
};

const receiptDocument = (receipt: ReceiptPdfData): DocumentData => {
  const meta: Array<[string, string]> = [
    ["Paid on", pdfDate(receipt.paidAt ?? new Date())],
  ];
  if (receipt.paymentMethod) {
    meta.push([
      "Paid by",
      PAYMENT_METHOD[receipt.paymentMethod] ?? receipt.paymentMethod,
    ]);
  }

  return {
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
  };
};

/** The PDF with what it drew; tests read `text` and `pageCount`. */
export const renderInvoicePdf = (invoice: InvoicePdfData) =>
  renderDocument(invoiceDocument(invoice));

export const renderReceiptPdf = (receipt: ReceiptPdfData) =>
  renderDocument(receiptDocument(receipt));

export const generateInvoicePdf = async (invoice: InvoicePdfData) =>
  (await renderInvoicePdf(invoice)).pdf;

export const generateReceiptPdf = async (receipt: ReceiptPdfData) =>
  (await renderReceiptPdf(receipt)).pdf;

// --- Logo -------------------------------------------------------------------

/** The business logo as a JPEG, or null when it is missing or unreachable. */
const fetchLogo = async (logoUrl?: string | null): Promise<Buffer | null> => {
  if (!logoUrl || logoUrl.includes("placeimg.com")) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const input = Buffer.from(await response.arrayBuffer());
    // Twice the drawn size, so the logo stays sharp when zoomed or printed.
    return await sharp(input)
      .resize({
        width: 280,
        height: 88,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer();
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
