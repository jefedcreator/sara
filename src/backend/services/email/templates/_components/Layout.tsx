import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Row,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

import { emailTailwind, FONTS_HREF } from "./theme";

/*
 * The frame and parts every Sara email is built from: DESIGN.md's "calm
 * ledger" on a leaf-grey page, one green pill per email, figures in their own
 * panel. Mirrors the app's public pages: an email to a business's customer
 * leads with the business and signs "by sara" quietly at the foot, like the
 * booking page; an email to the owner leads with Sara.
 */

type Sender =
  /** To an owner: Sara's wordmark up top. */
  | { kind: "sara" }
  /** To a business's customer: their name up top, Sara at the foot. */
  | {
      kind: "business";
      name: string;
      credit: "Bookings" | "Invoices" | "Receipts";
    };

export function EmailLayout({
  preview,
  origin,
  sender,
  children,
}: {
  /** The inbox line shown after the subject. */
  preview: string;
  /** The app's origin, with no trailing slash. */
  origin: string;
  sender: Sender;
  children: ReactNode;
}) {
  return (
    <Html lang="en">
      <Head>
        <link rel="stylesheet" href={FONTS_HREF} />
      </Head>
      <Preview>{preview}</Preview>
      <Tailwind config={emailTailwind}>
        <Body className="bg-surface m-0 px-4 py-10 font-sans">
          <Container className="bg-canvas border-line rounded-card max-w-[560px] border border-solid">
            <Section className="px-9 pt-8">
              {sender.kind === "sara" ? (
                <Wordmark origin={origin} />
              ) : (
                <Text className="text-muted m-0 text-[15px] leading-[1.4] font-semibold">
                  {sender.name}
                </Text>
              )}
            </Section>
            <Section className="px-9 pt-7 pb-10">{children}</Section>
          </Container>
          <Container className="max-w-[560px]">
            {sender.kind === "sara" ? (
              <Text className="text-faint m-0 px-9 pt-5 text-[12px] leading-[1.6]">
                You&apos;re getting this because this address runs a business on{" "}
                <Link href={origin} className="text-faint underline">
                  Sara
                </Link>
                .
              </Text>
            ) : (
              <Row className="px-9 pt-5">
                <Column className="text-faint w-[1%] pr-2 text-[12px] leading-[1.6] whitespace-nowrap">
                  {sender.credit} by
                </Column>
                <Column>
                  <Wordmark origin={origin} muted />
                </Column>
              </Row>
            )}
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

/**
 * The lockup as live shapes and text, not an image: most clients block images
 * by default and render no SVG, and a broken box is worse than no logo. The
 * mark is its two halves as bars, the owner's in ink over Sara's in green
 * (single ink when `muted`, as in the app's "Bookings by sara" credit).
 */
function Wordmark({
  origin,
  muted = false,
}: {
  origin: string;
  muted?: boolean;
}) {
  const size = muted ? "small" : "large";
  const bar = size === "large" ? "h-[8px] w-[20px]" : "h-[6px] w-[15px]";
  return (
    <Link href={origin} className="no-underline">
      <table role="presentation" cellPadding={0} cellSpacing={0}>
        <tbody>
          <tr>
            <td className="pr-[7px] align-middle">
              <div
                className={`${bar} ${muted ? "bg-faint" : "bg-ink"} rounded-l-full rounded-r-[2px]`}
              />
              <div
                className={`${bar} ${muted ? "bg-faint" : "bg-accent"} mt-[2px] rounded-l-[2px] rounded-r-full`}
              />
            </td>
            <td
              className={`font-display align-middle leading-none font-semibold tracking-[-0.04em] ${
                muted ? "text-faint text-[15px]" : "text-ink text-[24px]"
              }`}
            >
              sara
            </td>
          </tr>
        </tbody>
      </table>
    </Link>
  );
}

/** The page's one headline, set like the app's display type. */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text className="font-display text-ink m-0 mb-4 text-[30px] leading-[1.08] font-normal tracking-[-0.035em]">
      {children}
    </Text>
  );
}

/** Body copy: 16px at 1.6, ink-2. */
export function Paragraph({ children }: { children: ReactNode }) {
  return (
    <Text className="text-ink-2 m-0 mb-4 text-[16px] leading-[1.6]">
      {children}
    </Text>
  );
}

const PILL_TONES = {
  accent: "bg-accent-soft text-accent-ink",
  muted: "bg-surface text-muted",
  danger: "bg-danger-soft text-danger",
} as const;

/** The app's StatusPill: a literal state, sentence case. */
export function Pill({
  tone = "accent",
  children,
}: {
  tone?: keyof typeof PILL_TONES;
  children: ReactNode;
}) {
  return (
    <Text className="m-0 mb-5">
      <span
        className={`${PILL_TONES[tone]} inline-block rounded-full px-3 py-[6px] text-[13px] leading-none font-semibold`}
      >
        {children}
      </span>
    </Text>
  );
}

/**
 * The primary button: green fill, green-ink text, a full pill. One per email.
 * No hover: email has none.
 */
export function CtaButton({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Section className="mt-7 mb-2">
      <Button
        href={href}
        className="bg-accent text-on-accent rounded-full px-[26px] py-[15px] text-[15px] font-semibold no-underline"
      >
        {children}
      </Button>
    </Section>
  );
}

/**
 * The figures of the email (when, what, how much) in a leaf-grey panel, one
 * row per fact, value on the right. `strong` marks the row that matters most.
 */
export function Details({
  rows,
}: {
  rows: {
    label: string;
    value: ReactNode;
    strong?: boolean;
    struck?: boolean;
  }[];
}) {
  return (
    <Section className="bg-surface rounded-[20px] px-5 py-3">
      {rows.map((row) => (
        <Row key={row.label}>
          <Column className="text-muted py-[7px] pr-4 align-top text-[14px] leading-[1.45]">
            {row.label}
          </Column>
          <Column
            align="right"
            className={`py-[7px] align-top text-[14px] leading-[1.45] ${
              row.strong ? "text-ink font-semibold" : "text-ink"
            } ${row.struck ? "text-faint line-through" : ""}`}
          >
            {row.value}
          </Column>
        </Row>
      ))}
    </Section>
  );
}

/**
 * A few lines of chat, the product's own proof: the owner's messages in green
 * on the right, Sara's replies on white on the left (DESIGN.md bubble-owner
 * and bubble-sara).
 */
export function Exchange({
  messages,
}: {
  messages: { from: "owner" | "sara"; text: string }[];
}) {
  return (
    <Section className="bg-surface mb-5 rounded-[20px] px-4 pt-2 pb-4">
      {messages.map((message, i) =>
        message.from === "owner" ? (
          <Row key={i}>
            <Column align="right">
              <Text className="bg-accent text-on-accent rounded-bubble m-0 mt-2 inline-block max-w-[80%] rounded-br-[6px] px-[14px] py-[10px] text-left text-[14.5px] leading-[1.45]">
                {message.text}
              </Text>
            </Column>
          </Row>
        ) : (
          <Row key={i}>
            <Column>
              <Text className="bg-canvas text-ink border-line rounded-bubble m-0 mt-2 inline-block max-w-[85%] rounded-bl-[6px] border border-solid px-[14px] py-[10px] text-[14.5px] leading-[1.45] whitespace-pre-line">
                {message.text}
              </Text>
            </Column>
          </Row>
        ),
      )}
    </Section>
  );
}

/**
 * The raw link under a button. Some clients break buttons and some readers
 * won't press one; the address must still be there to copy.
 */
export function FallbackLink({ href }: { href: string }) {
  return (
    <>
      <Hr className="border-line mt-7 mb-5" />
      <Text className="text-muted m-0 mb-1 text-[13px] leading-[1.6]">
        If the button doesn&apos;t work, paste this into your browser:
      </Text>
      <Text className="m-0 text-[12px] leading-[1.6] break-all">
        <Link href={href} className="text-ink-2 underline">
          {href}
        </Link>
      </Text>
    </>
  );
}

/** Small closing print: what happens next, or who to ask. */
export function Note({ children }: { children: ReactNode }) {
  return (
    <Text className="text-muted m-0 mt-4 text-[13px] leading-[1.6]">
      {children}
    </Text>
  );
}

export function greeting(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : "Hi,";
}
