"use client";

import { SetupShell } from "@/components/setup-shell";
import { useLinkChatMutation } from "@/hooks/mutations/use-link-mutations";
import { ArrowDisc, Button, Notice } from "@/primitives";
import { errorMessage } from "@/utils/axios";

interface LinkChatClientProps {
  token: string;
  businessName: string;
  chatHref: string;
}

/** Binds the chat that asked for this link to the signed-in owner's business. */
export function LinkChatClient({ token, businessName, chatHref }: LinkChatClientProps) {
  const link = useLinkChatMutation();

  if (link.isSuccess) {
    return (
      <SetupShell
        step={2}
        title="Your chat is connected."
        body={`Go back to your chat and send "menu". Sara will reply with your options for ${businessName}.`}
      >
        <div className="grid gap-4">
          <p className="rounded-bubble bg-accent text-on-accent ml-auto w-fit rounded-br-[6px] px-3.5 py-2.5 text-[14.5px] font-medium">
            menu
          </p>
          <p className="rounded-bubble border-line bg-canvas shadow-bubble w-fit max-w-full rounded-bl-[6px] border px-3.5 py-2.5 text-[14.5px] leading-normal">
            Sara 👋 Reply with a number: 1️⃣ New invoice · 2️⃣ New receipt · 3️⃣
            Share a service · 4️⃣ Unpaid invoices · 5️⃣ Today&apos;s bookings · 6️⃣
            Business summary
          </p>
          <Button asChild size="lg" className="mt-4 w-full justify-between pr-2 sm:w-auto">
            <a href={chatHref} target="_blank" rel="noopener">
              Back to WhatsApp
              <ArrowDisc />
            </a>
          </Button>
        </div>
      </SetupShell>
    );
  }

  return (
    <SetupShell
      step={2}
      title={`Connect this chat to ${businessName}?`}
      body="The chat that sent you this link will be able to create invoices and receipts, share booking links and read your numbers."
    >
      {link.isError ? (
        <Notice tone="danger" className="mb-5">
          {errorMessage(
            link.error,
            "We couldn't connect your chat. Message Sara again for a new link.",
          )}
        </Notice>
      ) : null}
      <Button
        size="lg"
        className="w-full sm:w-auto"
        isLoading={link.isPending}
        onClick={() => link.mutate(token)}
      >
        Connect my chat
      </Button>
    </SetupShell>
  );
}
