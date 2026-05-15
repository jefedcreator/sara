import sharp from "sharp";

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

type PdfImage = {
  data: Buffer;
  width: number;
  height: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

const escapePdfText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

const toNumber = (value: number | string) => Number(value);

const formatMoney = (value: number | string, currency: string) => {
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(toNumber(value));
  } catch (error) {
    // Fallback for invalid currency codes like symbols ($, £, etc.)
    return `${currency}${toNumber(value).toLocaleString("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
};

const formatDate = (date?: Date | null) =>
  date
    ? new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(date)
    : "Not set";

const wrapText = (text: string, maxChars: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

const fetchLogo = async (logoUrl?: string | null): Promise<PdfImage | null> => {
  if (!logoUrl || logoUrl.includes("placeimg.com")) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(logoUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) return null;

    const input = Buffer.from(await response.arrayBuffer());
    const { data, info } = await sharp(input)
      .resize({
        width: 180,
        height: 80,
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
  } catch (error: any) {
    if (error.name === "AbortError") {
      console.warn("Logo fetch timed out");
    } else {
      console.warn("Unable to embed business logo in invoice PDF:", error.message || error);
    }
    return null;
  }
};

class PdfCanvas {
  private readonly commands: string[] = [];

  text(
    value: string,
    x: number,
    y: number,
    options: { size?: number; bold?: boolean } = {},
  ) {
    const font = options.bold ? "F2" : "F1";
    const size = options.size ?? 10;
    this.commands.push(
      `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(
        value,
      )}) Tj ET`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.commands.push(
      `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  }

  image(name: string, x: number, y: number, width: number, height: number) {
    this.commands.push(
      `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(
        2,
      )} cm /${name} Do Q`,
    );
  }

  toBuffer() {
    return Buffer.from(this.commands.join("\n"), "utf8");
  }
}

const buildPdf = (content: Buffer, logo: PdfImage | null) => {
  const objects: Buffer[] = [];

  const addObject = (body: string | Buffer) => {
    const id = objects.length + 1;
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"));
    return id;
  };

  const catalogId = addObject("placeholder");
  const pagesId = addObject("placeholder");
  const pageId = addObject("placeholder");
  const regularFontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  );
  const boldFontId = addObject(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  );
  const contentId = addObject(
    Buffer.concat([
      Buffer.from(`<< /Length ${content.length} >>\nstream\n`, "utf8"),
      content,
      Buffer.from("\nendstream", "utf8"),
    ]),
  );

  let logoId: number | null = null;
  if (logo) {
    logoId = addObject(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.data.length} >>\nstream\n`,
          "utf8",
        ),
        logo.data,
        Buffer.from("\nendstream", "utf8"),
      ]),
    );
  }

  objects[catalogId - 1] = Buffer.from(
    `<< /Type /Catalog /Pages ${pagesId} 0 R >>`,
    "utf8",
  );
  objects[pagesId - 1] = Buffer.from(
    `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`,
    "utf8",
  );
  objects[pageId - 1] = Buffer.from(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${
      logoId ? ` /XObject << /Logo ${logoId} 0 R >>` : ""
    } >> /Contents ${contentId} 0 R >>`,
    "utf8",
  );

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n", "utf8")];
  const offsets: number[] = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(
      Buffer.from(`${index + 1} 0 obj\n`, "utf8"),
      object,
      Buffer.from("\nendobj\n", "utf8"),
    );
  });

  const xrefOffset = Buffer.concat(chunks).length;
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
      } /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "utf8",
    ),
  );

  return Buffer.concat(chunks);
};

export const generateInvoicePdf = async (invoice: InvoicePdfData) => {
  const logo = await fetchLogo(invoice.business.logoUrl);
  const canvas = new PdfCanvas();
  let y = PAGE_HEIGHT - MARGIN;

  if (logo) {
    const width = Math.min(logo.width, 150);
    const height = (logo.height / logo.width) * width;
    canvas.image("Logo", MARGIN, y - height, width, height);
  }

  canvas.text("INVOICE", PAGE_WIDTH - 170, y - 8, { size: 24, bold: true });
  canvas.text(`#${invoice.invoiceNumber}`, PAGE_WIDTH - 170, y - 28, {
    size: 11,
  });
  canvas.text(invoice.status, PAGE_WIDTH - 170, y - 44, { size: 10 });

  y -= 92;
  canvas.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);

  y -= 26;
  canvas.text(invoice.business.name, MARGIN, y, { size: 14, bold: true });
  y -= 16;
  [
    invoice.business.email,
    invoice.business.phone,
    [invoice.business.city, invoice.business.state, invoice.business.country]
      .filter(Boolean)
      .join(", "),
  ]
    .filter(Boolean)
    .forEach((line) => {
      canvas.text(String(line), MARGIN, y, { size: 10 });
      y -= 14;
    });

  const clientTop = PAGE_HEIGHT - MARGIN - 118;
  canvas.text("Bill To", PAGE_WIDTH - 220, clientTop, { size: 10, bold: true });
  canvas.text(invoice.client.name, PAGE_WIDTH - 220, clientTop - 16, {
    size: 12,
    bold: true,
  });
  if (invoice.client.email)
    canvas.text(invoice.client.email, PAGE_WIDTH - 220, clientTop - 32);
  if (invoice.client.phone)
    canvas.text(invoice.client.phone, PAGE_WIDTH - 220, clientTop - 46);
  canvas.text(
    `Due: ${formatDate(invoice.dueAt)}`,
    PAGE_WIDTH - 220,
    clientTop - 66,
  );

  y = Math.min(y - 32, clientTop - 92);
  canvas.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y -= 22;

  canvas.text("Description", MARGIN, y, { bold: true });
  canvas.text("Qty", 330, y, { bold: true });
  canvas.text("Unit", 380, y, { bold: true });
  canvas.text("Total", 475, y, { bold: true });
  y -= 14;
  canvas.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y -= 18;

  invoice.items.forEach((item) => {
    const lines = wrapText(item.description, 42);
    canvas.text(lines[0] ?? "", MARGIN, y);
    lines.slice(1, 3).forEach((line, index) => {
      canvas.text(line, MARGIN, y - 14 * (index + 1));
    });
    canvas.text(String(item.quantity), 330, y);
    canvas.text(formatMoney(item.unitPrice, invoice.currency), 380, y);
    canvas.text(formatMoney(item.total, invoice.currency), 475, y);
    y -= Math.max(28, lines.slice(0, 3).length * 14 + 10);
  });

  y -= 12;
  canvas.line(330, y, PAGE_WIDTH - MARGIN, y);
  y -= 20;

  const totals: Array<[string, number | string]> = [
    ["Subtotal", invoice.subtotal],
    ["Tax", invoice.taxAmount],
    ["Discount", invoice.discount],
    ["Total", invoice.total],
    ["Amount paid", invoice.amountPaid],
  ];

  totals.forEach(([label, value], index) => {
    canvas.text(String(label), 360, y, { bold: index === 3 });
    canvas.text(formatMoney(value, invoice.currency), 465, y, {
      bold: index === 3,
    });
    y -= 16;
  });

  if (invoice.notes) {
    y -= 12;
    canvas.text("Notes", MARGIN, y, { bold: true });
    y -= 16;
    wrapText(invoice.notes, 84)
      .slice(0, 5)
      .forEach((line) => {
        canvas.text(line, MARGIN, y);
        y -= 14;
      });
  }

  return buildPdf(canvas.toBuffer(), logo);
};
