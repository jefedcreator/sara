const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a raw phone number into its digits, noting whether its prefix says it
 * is already international. `+` and a leading `00` both mean international.
 */
function digitsOf(raw: string): { digits: string; international: boolean } {
  const trimmed = raw.trim();
  const international = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
    return { digits, international: true };
  }

  return { digits, international };
}

/**
 * Normalise a phone number to E.164, defaulting to Nigeria.
 *
 * A number written with `+` or `00` keeps its own country code and must have
 * 8–15 digits. Nigerian numbers are accepted as `0803…` (11 digits), `803…`
 * (10 digits) or `234803…` (13 digits), and all become `+234803…`.
 * Anything else, including strings with no digits, returns null.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;

  const { digits, international } = digitsOf(raw);
  if (!digits) return null;

  if (international) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.length === 13 && digits.startsWith("234")) {
    return `+${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("0")) {
    return `+234${digits.slice(1)}`;
  }

  if (digits.length === 10 && !digits.startsWith("0")) {
    return `+234${digits}`;
  }

  return null;
}

/** Lower-case and trim an email, returning null unless it looks like one. */
export function normalizeEmail(raw?: string | null): string | null {
  const email = raw?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

/** The form of a name used for matching: no case, no extra whitespace. */
export function nameKey(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, " ").trim();
}
