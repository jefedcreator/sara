import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedDocumentPage } from "@/components/documents/shared-document-page";
import { PublicError } from "@/components/public-error";
import { getSharedReceipt } from "@/server";
import { sharePath } from "@/server/share";
import { documentMetadata } from "@/utils/shared-document";

type Params = { params: Promise<{ slug: string; key: string }> };

// The key is checked on every visit; nothing here is cached.
export const dynamic = "force-dynamic";

/** The receipt link Sara sends the customer (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, key } = await params;
  const doc = await getSharedReceipt(slug, key).catch(() => null);
  return documentMetadata(
    doc,
    doc ? sharePath("receipt", slug) : `/r/${encodeURIComponent(slug)}`,
  );
}

export default async function SharedReceiptPage({ params }: Params) {
  const { slug, key } = await params;

  let doc;
  try {
    doc = await getSharedReceipt(slug, key);
  } catch (error) {
    console.error("[r] failed to load receipt:", error);
    return (
      <PublicError
        title="This receipt didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!doc) notFound();

  return <SharedDocumentPage doc={doc} />;
}
