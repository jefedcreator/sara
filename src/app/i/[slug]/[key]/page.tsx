import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedDocumentPage } from "@/components/documents/shared-document-page";
import { PublicError } from "@/components/public-error";
import { getSharedInvoice } from "@/server";
import { sharePath } from "@/server/share";
import { documentMetadata } from "@/utils/shared-document";

type Params = { params: Promise<{ slug: string; key: string }> };

// Payments land on the invoice after it's sent; always show it as it is now.
export const dynamic = "force-dynamic";

/** The invoice link Sara sends the customer (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, key } = await params;
  const doc = await getSharedInvoice(slug, key).catch(() => null);
  return documentMetadata(
    doc,
    doc ? sharePath("invoice", slug) : `/i/${encodeURIComponent(slug)}`,
  );
}

export default async function SharedInvoicePage({ params }: Params) {
  const { slug, key } = await params;

  let doc;
  try {
    doc = await getSharedInvoice(slug, key);
  } catch (error) {
    console.error("[i] failed to load invoice:", error);
    return (
      <PublicError
        title="This invoice didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!doc) notFound();

  return <SharedDocumentPage doc={doc} />;
}
