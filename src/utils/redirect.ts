/**
 * A `?next=` value, kept only if it is a same-site path. Anything else
 * (absolute, protocol-relative, or with characters the URL parser strips)
 * falls back, so the param can't be used as an open redirect.
 */
export function safeNextPath(
  value: string | string[] | null | undefined,
  fallback = "/dashboard",
) {
  const next = Array.isArray(value) ? value[0] : value;
  if (
    !next?.startsWith("/") ||
    next.startsWith("//") ||
    // Control characters and whitespace are stripped by the URL parser, which
    // turns "/\t/host" into "//host"; a backslash normalises to a slash.
    /[\u0000-\u001f\u007f\s\\]/.test(next)
  ) {
    return fallback;
  }
  return next;
}
