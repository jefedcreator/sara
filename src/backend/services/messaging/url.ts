export function appBaseUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXTAUTH_URL ??
    "https://sara.app";
  return base.replace(/\/$/, "");
}

export function publicUrl(path: string, slug: string): string {
  return `${appBaseUrl()}/${path}/${slug}`;
}
