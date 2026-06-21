export function parseAmount(text: string): number | null {
  const trimmed = text.trim().toLowerCase();

  // Check for negative sign
  if (trimmed.startsWith("-")) {
    return null;
  }

  const kMatch = /^(\d+(?:\.\d+)?)\s*k$/.exec(trimmed.replace(/[, ]/g, ""));
  if (kMatch) {
    const value = parseFloat(kMatch[1]!) * 1000;
    return value > 0 ? value : null;
  }
  const cleaned = trimmed.replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const value = parseFloat(cleaned);
  if (isNaN(value) || value <= 0) return null;
  return value;
}

export function formatMoney(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency ? `${currency} ${formatted}` : formatted;
}
