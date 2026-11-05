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

const AMOUNT_WORDS = new Set([
  ...Object.keys(SMALL), "hundred", "thousand", "million", "point", "dot",
  "minus", "negative", "ngn", "naira", "k",
]);

/** Expand to the complete adjacent expression, preserving signs/scales/decimals.
 * A sentence conjunction belongs to an amount only when it joins amount tokens.
 */
type AmountExpression = { text: string; start: number; end: number };
function completeExpression(text: string, start: number, end: number): AmountExpression {
  const tokens = [...text.matchAll(/[\p{L}]+|\d(?:[\d,.]*\d)?k?|[₦#+−-]/gu)].map((match) => ({
    value: match[0], start: match.index, end: match.index + match[0].length,
  }));
  const isAmount = (index: number): boolean => {
    const token = tokens[index]?.value ?? "";
    return AMOUNT_WORDS.has(token) || /^\d/.test(token) || /^[₦#+−-]$/.test(token);
  };
  let first = tokens.findIndex((token) => token.end > start);
  let last = tokens.findIndex((token) => token.end >= end);
  if (first < 0 || last < 0) return { text: "", start, end };
  const adjacent = (left: number, right: number) => /^\s*$/.test(text.slice(tokens[left]!.end, tokens[right]!.start));
  while (first > 0 && adjacent(first - 1, first)) {
    if (isAmount(first - 1)) first--;
    else if (tokens[first - 1]?.value === "and" && first > 1 && adjacent(first - 2, first - 1) && isAmount(first - 2)) first -= 2;
    else break;
  }
  while (last + 1 < tokens.length && adjacent(last, last + 1)) {
    if (isAmount(last + 1)) last++;
    else if (tokens[last + 1]?.value === "and" && last + 2 < tokens.length && adjacent(last + 1, last + 2) && isAmount(last + 2)) last += 2;
    else break;
  }
  const expressionStart = tokens[first]!.start;
  const expressionEnd = tokens[last]!.end;
  return { text: text.slice(expressionStart, expressionEnd), start: expressionStart, end: expressionEnd };
}

function amountBody(text: string): string {
  return text.trim().replace(/^(?:₦|ngn|#)\s*/, "").replace(/\s*(?:naira|ngn)$/, "").trim();
}

/** Finding a complete number proves its value, not that the owner meant money.
 * Accept positive financial language, never an open-ended list of item nouns.
 */
function hasMonetaryContext(text: string, expression: AmountExpression, evidence: OwnerEvidence, isCurrentTurn: boolean): boolean {
  const before = text.slice(0, expression.start);
  const after = text.slice(expression.end);
  // Delimit the local clause without splitting numeric grouping/decimal marks.
  const localBefore = before.split(/[,;.!?\n](?!\d)/u).at(-1)?.trim() ?? "";
  // These are reference-field grammars, not item nouns. Neither a transaction
  // elsewhere nor a bare "at" may turn a labelled identifier into a price.
  const referencePrefix = /\b(?:code|number|reference|id|phone|telephone|date|quantity|count)\s*(?:(?:is|was|of|to|at|use)\s*)?[:=#]?\s*$/u;
  if (referencePrefix.test(localBefore)) return false;
  if (/^(?:₦|ngn)|(?:naira|ngn)$/u.test(expression.text)) return true;
  // An unknown following noun makes a bare number ambiguous, even after "use".
  const monetaryTail = /^\s*(?:(?:[.!?,;:]\s*)?$|(?:each|apiece|per|for|on|cash|and)\b|(?:in\s+cash|by\s+bank\s+transfer|bank\s+transfer)\b)/u.test(after);
  if (!monetaryTail) return false;
  const pricePrefix = /\b(?:(?:price|cost|rate|amount|total|payment)(?:\s+(?:is|was|of|to|at|should\s+be|will\s+be))?|pay|paid|charge|charging)\s*[:=]?\s*$/u.test(localBefore);
  if (pricePrefix) return true;
  // Legacy # currency notation also denotes document/product identifiers.
  // Its currency meaning needs an explicit adjacent price/payment statement.
  if (expression.text.startsWith("#")) return false;

  // Match complete local command forms. A financial verb anywhere earlier in
  // the turn supplies no evidence for the current number.
  const qualifiedAmount = /\d{3,}|\d[.,]\d|\dk\b|\b(?:hundred|thousand|million)\b/u.test(expression.text);
  const commandTail = /^\s*(?:[.!?,;:]?\s*$|(?:each|apiece|per|cash|in\s+cash|by\s+bank\s+transfer|bank\s+transfer)\b|for\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b)/u.test(after);
  const amountCommand = /^\s*(?:please\s+)?(?:use|record)\s*$/u.test(before) && commandTail;
  const directInvoice = /^(?:please\s+)?invoice\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,3}$/u.test(localBefore) && /^\s+for\s+\S/u.test(after);
  const itemAtPrice = /^(?:please\s+)?invoice\s+[\p{L}'’-]+(?:\s+[\p{L}'’-]+){0,3}\s+for\s+.+\s+at$/u.test(localBefore);
  const unitPrice = /^\s*(?:each|apiece|per)\b/u.test(after);
  if (qualifiedAmount && (amountCommand || directInvoice || itemAtPrice || unitPrice)) return true;

  // Bare replies can correct a discussed price, but an old item count must not
  // acquire monetary meaning from a later turn. Small bare replies can also be
  // numbered choices, so require an explicit correction phrase for those.
  const correctionPrefix = /^\s*(?:actually|instead|correction|make\s+that|no[, ]+)\s*[:,]?\s*$/u.test(before);
  const standalone = /^\s*$/u.test(before) || correctionPrefix;
  // Require a prior price/value statement, not the word "price" in a label.
  const priorPricing = evidence.recentOwnerTexts.some((turn) => /\b(?:(?:price|cost|rate|payment|amount|total)(?:\s+(?:is|was|of|to|at|should\s+be|will\s+be))?|pay|paid|charge|charging)\s*[:=]?\s*(?:₦|ngn(?=\s|\d)|#|\d|zero\b|one\b|two\b|three\b|four\b|five\b|six\b|seven\b|eight\b|nine\b|ten\b|twenty\b|thirty\b|forty\b|fifty\b|sixty\b|seventy\b|eighty\b|ninety\b)/iu.test(turn));
  return isCurrentTurn && standalone && /^\s*[.!?]?\s*$/u.test(after) && priorPricing && (qualifiedAmount || correctionPrefix);
}

/** The quote must identify a whole amount in a stored owner turn. */
export function verifyOwnerPrice(
  value: { quote: string; amountMinor: number },
  evidence: OwnerEvidence,
): number {
  const quote = value.quote.trim().toLowerCase();
  const found = quote.length > 0 && [evidence.text, ...evidence.recentOwnerTexts].some((text, turnIndex) => {
    const lower = text.toLowerCase();
    let from = 0;
    for (;;) {
      const index = lower.indexOf(quote, from);
      if (index < 0) return false;
      const before = lower.slice(0, index);
      const after = lower.slice(index + quote.length);
      const expression = completeExpression(lower, index, index + quote.length);
      if (!/[\p{L}\p{N}.,+\-]$/u.test(before) && !/^(?:[\p{L}\p{N}]|[.,]\d|-[\p{L}\p{N}])/u.test(after) &&
        amountBody(expression.text) === amountBody(quote) && parseEnglishAmount(expression.text) === value.amountMinor &&
        hasMonetaryContext(lower, expression, evidence, turnIndex === 0)) return true;
      from = index + 1;
    }
  });
  if (!found || !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 0 || parseEnglishAmount(quote) !== value.amountMinor) {
    throw new Error("Please state the price you want to use.");
  }
  return value.amountMinor;
}
