import type { OwnerEvidence } from "./types";

const WORDS_TO_NUM: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SINGLE_DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

/**
 * Parses amounts in digits (e.g. "45,000", "45,000.50"), "k" notation ("45k"),
 * NGN/naira currency symbols/prefixes ("₦45,000", "45000 naira"), and spoken
 * English words ("forty-five thousand", "one hundred and twenty-five thousand",
 * "two million", "ten thousand five hundred naira").
 *
 * Returns minor units as an integer (e.g., 45,000 NGN -> 4,500,000 minor units).
 * Handles zero, fractional currency up to 2 decimal places.
 * Rejects negative numbers, nonfinite/unsafe amounts, more than 2 decimal places,
 * invalid tokens, or loose sentence text.
 */
export function parseEnglishAmount(text: string): number | null {
  if (typeof text !== "string") return null;

  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return null;

  // Reject negative numbers or indicators
  if (
    trimmed.startsWith("-") ||
    trimmed.startsWith("minus") ||
    trimmed.startsWith("negative") ||
    /\b(minus|negative)\b/.test(trimmed)
  ) {
    return null;
  }

  // Strip currency symbols and names: ₦, ngn, #, naira
  let s = trimmed
    .replace(/^(\u20a6|ngn|#)\s*/i, "")
    .replace(/\s*(naira|ngn)$/i, "")
    .trim();

  if (!s) return null;

  // 1. Try 'k' notation: e.g. "45k", "45.5k", "1,200k"
  const kMatch = /^([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]+))?\s*k$/i.exec(s);
  if (kMatch) {
    const intStr = kMatch[1]!.replace(/,/g, "");
    const decStr = kMatch[2];
    if (decStr && decStr.length > 2) return null;

    const intPart = parseInt(intStr, 10);
    if (!Number.isSafeInteger(intPart)) return null;

    let minor = intPart * 100_000;
    if (decStr) {
      const decPart = parseInt(decStr.padEnd(2, "0"), 10);
      minor += decPart * 1_000;
    }

    if (!Number.isSafeInteger(minor) || minor < 0 || minor > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return minor;
  }

  // 2. Try standard digits: e.g. "45,000", "45,000.50", "45000", "0", "0.00", "0.50"
  const numMatch = /^([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(?:\.([0-9]+))?$/.exec(s);
  if (numMatch) {
    const intStr = numMatch[1]!.replace(/,/g, "");
    const decStr = numMatch[2];
    if (decStr && decStr.length > 2) return null;

    const intPart = parseInt(intStr, 10);
    if (!Number.isSafeInteger(intPart)) return null;

    const decPart = decStr ? parseInt(decStr.padEnd(2, "0"), 10) : 0;
    const minor = intPart * 100 + decPart;

    if (!Number.isSafeInteger(minor) || minor < 0 || minor > Number.MAX_SAFE_INTEGER) {
      return null;
    }
    return minor;
  }

  // 3. Spoken English words / mixed notation
  // Normalize hyphens and commas to spaces
  const normalizedWords = s
    .replace(/[-]/g, " ")
    .replace(/[,]/g, " ")
    .trim();

  const rawTokens = normalizedWords.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return null;

  // Handle single "zero" or "zero naira"
  if (rawTokens.length === 1 && rawTokens[0] === "zero") {
    return 0;
  }
  if (
    rawTokens.length === 2 &&
    rawTokens[0] === "zero" &&
    (rawTokens[1] === "naira" || rawTokens[1] === "ngn")
  ) {
    return 0;
  }

  // Check for decimal separator words: "point" or "dot"
  const pointIndex = rawTokens.findIndex((t) => t === "point" || t === "dot");
  let intTokens = rawTokens;
  let decTokens: string[] = [];

  if (pointIndex !== -1) {
    intTokens = rawTokens.slice(0, pointIndex);
    decTokens = rawTokens.slice(pointIndex + 1);
    if (intTokens.length === 0 || decTokens.length === 0) return null;
  }

  // Parse decimal tokens if present
  let decPartMinor = 0;
  if (decTokens.length > 0) {
    // Can be digits (e.g. "50", "5") or words (e.g. ["five", "zero"], ["five"])
    if (decTokens.length === 1 && /^\d+$/.test(decTokens[0]!)) {
      const dStr = decTokens[0]!;
      if (dStr.length > 2) return null;
      decPartMinor = parseInt(dStr.padEnd(2, "0"), 10);
    } else {
      let digitChars = "";
      for (const token of decTokens) {
        if (SINGLE_DIGIT_WORDS[token] !== undefined) {
          digitChars += SINGLE_DIGIT_WORDS[token];
        } else if (WORDS_TO_NUM[token] !== undefined && WORDS_TO_NUM[token]! >= 10 && WORDS_TO_NUM[token]! <= 99) {
          digitChars += WORDS_TO_NUM[token]!.toString();
        } else {
          return null; // Unrecognized decimal token
        }
      }
      if (digitChars.length === 0 || digitChars.length > 2) return null;
      decPartMinor = parseInt(digitChars.padEnd(2, "0"), 10);
    }
  }

  // Parse integer tokens
  let total = 0;
  let currentGroup = 0;

  for (const token of intTokens) {
    if (token === "and") continue;
    if (token === "naira" || token === "ngn") continue;

    if (/^\d+$/.test(token)) {
      const val = parseInt(token, 10);
      if (!Number.isSafeInteger(val) || val < 0) return null;
      currentGroup += val;
      continue;
    }

    if (token in WORDS_TO_NUM) {
      const val = WORDS_TO_NUM[token]!;
      currentGroup += val;
      continue;
    }

    if (token === "hundred") {
      currentGroup = (currentGroup === 0 ? 1 : currentGroup) * 100;
      continue;
    }

    if (token === "thousand") {
      total += (currentGroup === 0 ? 1 : currentGroup) * 1_000;
      currentGroup = 0;
      continue;
    }

    if (token === "million") {
      total += (currentGroup === 0 ? 1 : currentGroup) * 1_000_000;
      currentGroup = 0;
      continue;
    }

    if (token === "billion") {
      total += (currentGroup === 0 ? 1 : currentGroup) * 1_000_000_000;
      currentGroup = 0;
      continue;
    }

    // Unrecognized word/token -> reject!
    return null;
  }

  total += currentGroup;

  if (!Number.isSafeInteger(total) || total < 0 || total > Number.MAX_SAFE_INTEGER / 100) {
    return null;
  }

  const minor = total * 100 + decPartMinor;
  if (!Number.isSafeInteger(minor) || minor < 0 || minor > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return minor;
}

/**
 * Ensures quote appears in evidence.text or evidence.recentOwnerTexts (case-insensitive)
 * and that parseEnglishAmount(quote) === value.amountMinor.
 * Throws Error("Please state the price you want to use.") if mismatch or not found.
 */
export function verifyOwnerPrice(
  value: { quote: string; amountMinor: number },
  evidence: OwnerEvidence,
): number {
  const quote = value.quote.trim().toLowerCase();
  const found = [evidence.text, ...evidence.recentOwnerTexts].some((text) =>
    text.toLowerCase().includes(quote),
  );
  if (!found || parseEnglishAmount(quote) !== value.amountMinor) {
    throw new Error("Please state the price you want to use.");
  }
  return value.amountMinor;
}
