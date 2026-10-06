import { type Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicError } from "@/components/public-error";
import { ServiceProfile } from "@/components/public/service-profile";
import { getServicePage } from "@/server";
import { servicePath } from "@/utils/public-links";
import { serviceMetadata } from "@/utils/service-page";

type Params = { params: Promise<{ slug: string }> };

// A paused service must stop showing at once.
export const dynamic = "force-dynamic";

/** A service's public page; its action hands off to /book/<slug>. Card: ./opengraph-image.tsx. */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await getServicePage(slug).catch(() => null);
  return serviceMetadata(page, servicePath(slug));
}

export default async function ServicePublicPage({ params }: Params) {
  const { slug } = await params;

  let page;
  try {
    page = await getServicePage(slug);
  } catch (error) {
    console.error("[services] failed to load service:", error);
    return (
      <PublicError
        title="This service didn't load."
        body="Something went wrong on our side. Refresh the page to try again."
      />
    );
  }

  if (!page) notFound();

  return <ServiceProfile page={page} />;
}
