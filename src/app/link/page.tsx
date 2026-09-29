import { type Metadata } from "next";

import { LinkChatClient } from "@/components/link/link-chat-client";
import { PublicError } from "@/components/public-error";
import { SetupShell } from "@/components/setup-shell";
import { Button } from "@/primitives";
import { getCurrentUser, signInPath } from "@/server";
import { whatsappHref } from "@/utils/whatsapp";

export const metadata: Metadata = {
  title: "Connect your chat · Sara",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * The one-time link Sara sends a new number in chat (`/link?t=…`). Walks the
 * owner through sign-in and business setup, then binds the chat to the
 * business.
 */
export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : null;

  if (!token) {
    return (
      <PublicError
        title="This link is missing its code."
        body="Message Sara on WhatsApp and you'll get a fresh link to connect your chat."
      >
        <Button asChild variant="dark">
          <a href={whatsappHref()} target="_blank" rel="noopener">
            Message Sara
          </a>
        </Button>
      </PublicError>
    );
  }

  const here = `/link?t=${encodeURIComponent(token)}`;
  const user = await getCurrentUser();

  if (!user) {
    return (
      <SetupShell
        step={0}
        title="Connect your chat to Sara."
        body="Sign in first. Then your WhatsApp or Instagram chat can create invoices, share booking links and send you today's numbers."
      >
        <Button asChild size="lg" className="w-full sm:w-auto">
          <a href={signInPath(here)}>Sign in to continue</a>
        </Button>
        <p className="text-muted mt-4 text-[13px]">This link works once and expires after 15 minutes.</p>
      </SetupShell>
    );
  }

  if (!user.business) {
    return (
      <SetupShell
        step={1}
        title="Set up your business first."
        body="Add your business name and link the bank account your payments should settle into. It takes about two minutes."
      >
        <Button asChild size="lg" className="w-full sm:w-auto">
          <a href={`/onboarding?next=${encodeURIComponent(here)}`}>Set up my business</a>
        </Button>
      </SetupShell>
    );
  }

  return (
    <LinkChatClient
      token={token}
      businessName={user.business.name}
      chatHref={whatsappHref("menu")}
    />
  );
}
