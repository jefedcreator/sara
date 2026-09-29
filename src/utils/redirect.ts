/**
 * A `?next=` value, kept only if it is a same-site path. Anything else
 * (absolute, protocol-relative, or with characters the URL parser strips)
 * falls back, so the param can't be used as an open redirect.
 */
export function safeNextPath(
  value: string | string[] | undefined,
  fallback = "/dashboard",
) {
  const next = Array.isArray(value) ? value[0] : value;
  if (!next?.startsWith("/") || next.startsWith("//") || /[\s\\]/.test(next)) {
    return fallback;
  }
  return next;
}
