import type { OwnerEvidence } from "./types";

const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function belowHundred(tokens: string[]): number | null {
  if (tokens.length === 1) {
    const token = tokens[0] ?? "";
    return /^\d{1,3}$/.test(token) ? Number(token) : SMALL[token] ?? null;
  }
  if (tokens.length !== 2) return null;
  const tens = SMALL[tokens[0] ?? ""];
  const units = SMALL[tokens[1] ?? ""];
  return tens !== undefined && tens >= 20 && tens % 10 === 0 &&
    units !== undefined && units >= 1 && units <= 9 ? tens + units : null;
}

function group(tokens: string[]): number | null {
  const hundred = tokens.indexOf("hundred");
  if (hundred < 0) return belowHundred(tokens);
  const multiplier = SMALL[tokens[0] ?? ""];
  if (hundred !== 1 || multiplier === undefined || multiplier < 1 || multiplier > 9) return null;
  let rest = tokens.slice(2);
  if (rest[0] === "and") rest = rest.slice(1);
  const tail = rest.length === 0 ? 0 : belowHundred(rest);
  return tail === null ? null : multiplier * 100 + tail;
}

/** Parse an entire amount, never a numeric fragment extracted from a sentence. */
export function parseEnglishAmount(text: string): number | null {
  let value = text.trim().toLowerCase();
  if (!value || /\b(minus|negative)\b/.test(value) || value.startsWith("-")) return null;
  value = value.replace(/^(?:₦|ngn|#)\s*/, "").replace(/\s*(?:naira|ngn)$/, "").trim();
  const digits = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k)?$/.exec(value);
  if (digits) {
    const whole = Number(digits[1]?.replace(/,/g, ""));
    const fraction = Number((digits[2] ?? "").padEnd(2, "0"));
    const minor = (whole * 100 + fraction) * (digits[3] ? 1_000 : 1);
    return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
  }

  const tokens = value.replace(/(?<=[a-z])-(?=[a-z])/g, " ").split(/\s+/);
  const decimalIndex = tokens.findIndex((token) => token === "point" || token === "dot");
  let fraction = 0;
  let integers = tokens;
  if (decimalIndex >= 0) {
    integers = tokens.slice(0, decimalIndex);
    const decimal = tokens.slice(decimalIndex + 1);
    const decimalDigits = decimal.map((token) => {
      const digit = SMALL[token];
      return /^\d{1,2}$/.test(token) ? token : digit !== undefined && digit < 10 ? String(digit) : "?";
    }).join("");
    if (!/^\d{1,2}$/.test(decimalDigits)) return null;
    fraction = Number(decimalDigits.padEnd(2, "0"));
  }
  if (integers.length === 0) return null;
  let total = 0;
  let remaining = integers;
  let previousScale = Infinity;
  for (;;) {
    const index = remaining.findIndex((token) => token === "million" || token === "thousand");
    if (index < 0) break;
    const scale = remaining[index] === "million" ? 1_000_000 : 1_000;
    if (scale >= previousScale) return null;
    const multiplier = group(remaining.slice(0, index));
    if (multiplier === null || multiplier === 0) return null;
    total += multiplier * scale;
    previousScale = scale;
    remaining = remaining.slice(index + 1);
    if (remaining[0] === "and") {
      remaining = remaining.slice(1);
      if (!remaining.length) return null;
    }
  }
  const tail = remaining.length ? group(remaining) : 0;
  if (tail === null) return null;
  const minor = (total + tail) * 100 + fraction;
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
}

/** The quote must be a whole amount in a stored owner turn, not part of another number. */
export function verifyOwnerPrice(
  value: { quote: string; amountMinor: number },
  evidence: OwnerEvidence,
): number {
  const quote = value.quote.trim().toLowerCase();
  const found = quote.length > 0 && [evidence.text, ...evidence.recentOwnerTexts].some((text) => {
    const lower = text.toLowerCase();
    let from = 0;
    for (;;) {
      const index = lower.indexOf(quote, from);
      if (index < 0) return false;
      const before = lower.slice(0, index);
      const after = lower.slice(index + quote.length);
      // A quoted item count is not an owner-stated price ("two wigs").
      const isCount = /^\s+(?:units?|pieces?|items?|wigs?|products?|services?|customers?|orders?|nights?|days?|hours?|minutes?)\b/u.test(after);
      if (!isCount && !/[\p{L}\p{N}.,+\-]$/u.test(before) && !/^(?:[\p{L}\p{N}]|[.,]\d|-[\p{L}\p{N}])/u.test(after)) return true;
      from = index + 1;
    }
  });
  if (!found || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || parseEnglishAmount(quote) !== value.amountMinor) {
    throw new Error("Please state the price you want to use.");
  }
  return value.amountMinor;
}
