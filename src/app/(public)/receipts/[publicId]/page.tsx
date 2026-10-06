import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { SharedDocumentPage } from "@/components/documents/shared-document-page";
import { PublicError } from "@/components/public-error";
import { getSharedReceipt } from "@/server";
import { publicPath } from "@/utils/public-links";
import { documentMetadata } from "@/utils/shared-document";

type Params = { params: Promise<{ publicId: string }> };

// Always show the receipt as it is now.
export const dynamic = "force-dynamic";

/** The receipt link Sara sends the customer (server/share.ts). Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { publicId } = await params;
  const doc = await getSharedReceipt(publicId).catch(() => null);
  return documentMetadata(doc, publicPath("receipt", publicId));
}

export default async function SharedReceiptPage({ params }: Params) {
  const { publicId } = await params;

  let doc;
  try {
    doc = await getSharedReceipt(publicId);
  } catch (error) {
    console.error("[receipts] failed to load receipt:", error);
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
