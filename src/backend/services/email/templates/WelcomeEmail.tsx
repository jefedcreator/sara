import {
  CtaButton,
  EmailLayout,
  Exchange,
  Heading,
  Note,
  Paragraph,
  greeting,
} from "./_components/Layout";

export interface WelcomeEmailProps {
  origin: string;
  name: string | null;
}

/** To a new owner, on their first sign-in. Next step: set up the business. */
export default function WelcomeEmail({ origin, name }: WelcomeEmailProps) {
  return (
    <EmailLayout
      origin={origin}
      sender={{ kind: "sara" }}
      preview="Invoices, receipts and booking links, from the chat you already use."
    >
      <Heading>Welcome to Sara.</Heading>
      <Paragraph>{greeting(name)}</Paragraph>
      <Paragraph>
        Sara handles the admin side of your business from your WhatsApp or
        Instagram chat: invoices, receipts, booking links your customers pay
        through, and today&apos;s numbers when you ask.
      </Paragraph>
      <Exchange
        messages={[
          {
            from: "sara",
            text: "New invoice: Ada · 15,000 · gele\nReply YES to create, NO to cancel",
          },
          { from: "owner", text: "YES" },
          { from: "sara", text: "Invoice INV-1012 created ✅" },
        ]}
      />
      <Paragraph>
        First, set up your business: its name and the bank account your payments
        settle into.
      </Paragraph>
      <CtaButton href={`${origin}/onboarding`}>Set up your business</CtaButton>
      <Note>
        It takes about two minutes. Then message Sara on WhatsApp to connect
        your chat.
      </Note>
    </EmailLayout>
  );
}

// Sample data for `yarn email:dev`.
WelcomeEmail.PreviewProps = {
  origin: "https://sara.app",
  name: "Tolu Adeyemi",
} satisfies WelcomeEmailProps;
