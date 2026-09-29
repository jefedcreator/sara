import { Notice } from "@/primitives";

/** The fallback when an owner page's data won't load. */
export function AppError({ title }: { title: string }) {
  return (
    <Notice tone="danger">
      <b className="font-semibold">{title}</b> Refresh the page to try again.
    </Notice>
  );
}
