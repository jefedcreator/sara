import {
  ArrowsClockwise,
  Clock,
  EnvelopeSimple,
  MapPinLine,
  Prohibit,
} from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";

import { env } from "@/env";
import { LogoMark, Wordmark } from "@/primitives";
import { cn } from "@/utils/cn";

import { CopyLinkButton } from "./CopyLinkButton";
import { LandingMotion } from "./LandingMotion";
import { LandingNav } from "./LandingNav";

/*
 * Sara landing page, ported from landing/v1/impeccable (the app-wide design
 * language, see /DESIGN.md). Styled entirely with Tailwind utilities on the
 * DESIGN.md tokens. Server-rendered; the only client pieces are the nav, the
 * scroll-motion root and the copy button.
 */

const BOOKING_LINK = "app.sara.ng/book/tobi-knotless-braids";

// ---------- Shared class lists (full literals so Tailwind can see them) ----------

const WRAP = "mx-auto w-full max-w-page px-4 md:px-8";
const H2 =
  "max-w-[22ch] font-display text-[clamp(1.9rem,1.3rem_+_2.2vw,3rem)] leading-[1.06] font-normal tracking-[-0.035em] text-balance";
const SUB = "mt-3.5 max-w-[52ch] text-pretty text-muted";
// No leading here: cn()/tailwind-merge drops a leading-* that precedes a text-* size, so each use sets size then leading.
const H3_DISPLAY = "font-display font-medium tracking-[-0.02em]";
const MSG =
  "w-fit max-w-full rounded-bubble px-3.5 py-2.5 text-[14.5px] leading-normal wrap-anywhere";
const MSG_IN = "rounded-bl-[6px] border border-line bg-canvas text-ink";
const MSG_OUT = "ml-auto rounded-br-[6px] bg-accent font-medium text-on-accent";
const CHIP =
  "mt-2 block rounded-chip bg-accent-soft px-2.5 py-[7px] text-[13px] font-semibold text-accent-ink";
const TIME = "inline-block min-w-[3.2em] font-semibold text-accent-ink";

/*
 * Scroll motion. LandingMotion puts [data-motion] on the page root and
 * [data-in] on each [data-arrive] group as it enters the viewport.
 * ARRIVE_ITEM: a child that waits (hidden) until its group is in, staggered by --i.
 * ARRIVE_SELF: a group that fades in as a whole.
 * Without JS or with reduced motion, [data-motion] is never set and nothing hides.
 */
const ARRIVE_ITEM =
  "transition-[opacity,translate,scale] duration-600 ease-out-expo delay-[calc(var(--i,0)*120ms)] [[data-motion]_[data-arrive]:not([data-in])_&]:translate-y-2.5 [[data-motion]_[data-arrive]:not([data-in])_&]:scale-98 [[data-motion]_[data-arrive]:not([data-in])_&]:opacity-0";
const ARRIVE_SELF =
  "transition-[opacity,translate] duration-700 ease-out-expo [[data-motion]_&:not([data-in])]:translate-y-4 [[data-motion]_&:not([data-in])]:opacity-0";

function whatsappHref() {
  const number = env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER;
  return number
    ? `https://wa.me/${number}?text=${encodeURIComponent("Hi Sara")}`
    : "https://wa.me/";
}

// ---------- Small building blocks ----------

function StartButton({ href, id }: { href: string; id?: string }) {
  return (
    <a
      className="group/btn bg-accent text-on-accent shadow-cta ease-out-expo hover:bg-accent-hover inline-flex h-14 items-center gap-3 rounded-full pr-2 pl-[22px] text-[17px] leading-none font-semibold whitespace-nowrap no-underline transition-[background-color,scale] duration-250 active:scale-98"
      id={id}
      href={href}
      target="_blank"
      rel="noopener"
    >
      Start on WhatsApp
      <span
        className="bg-canvas grid size-[42px] place-items-center rounded-full"
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 16 16"
          className="stroke-accent-ink ease-out-expo size-4 transition-transform duration-300 group-hover/btn:translate-x-0.5"
          fill="none"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
        </svg>
      </span>
    </a>
  );
}

function Owner({ children }: { children: ReactNode }) {
  return (
    <p className={cn(MSG, MSG_OUT, ARRIVE_ITEM)} data-item>
      {children}
    </p>
  );
}

function Sara({
  children,
  className = "shadow-bubble",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn(MSG, MSG_IN, ARRIVE_ITEM, className)} data-item>
      {children}
    </p>
  );
}

function MenuCard({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <article
      className="rounded-panel bg-surface px-[18px] pt-[22px] pb-5 min-[1040px]:nth-[3n+2]:mt-10"
      data-arrive
    >
      <header className="mb-[18px] flex items-center gap-3">
        <span className="bg-accent text-on-accent grid size-8 place-items-center rounded-full text-[15px] leading-none font-bold">
          {n}
        </span>
        <h3 className={cn(H3_DISPLAY, "text-[19px] leading-[1.2]")}>{title}</h3>
      </header>
      <div className="grid gap-2">{children}</div>
    </article>
  );
}

type DayKind = "open" | "on" | "off";
function Day({
  label,
  date,
  kind = "open",
  title,
}: {
  label: string;
  date: number;
  kind?: DayKind;
  title?: string;
}) {
  return (
    <span
      role="listitem"
      title={title}
      className={cn(
        "grid justify-items-center gap-0.5 rounded-[14px] border py-2 text-xs",
        kind === "open" && "border-line text-muted",
        kind === "on" && "border-accent bg-accent text-on-accent",
        kind === "off" && "border-line bg-surface text-faint border-dashed",
      )}
    >
      {label}
      <b
        className={cn(
          "text-[17px] leading-none font-semibold",
          kind === "open" && "text-ink",
          kind === "on" && "text-on-accent",
          kind === "off" && "text-faint line-through",
        )}
      >
        {date}
      </b>
    </span>
  );
}

type SlotKind = "open" | "taken" | "on";
function Slot({ time, kind = "open" }: { time: string; kind?: SlotKind }) {
  return (
    <span
      role="listitem"
      className={cn(
        "rounded-full border py-2.5 text-center text-sm font-semibold",
        kind === "open" && "border-line",
        kind === "taken" &&
          "bg-surface text-faint border-transparent line-through",
        kind === "on" && "border-accent-ink bg-accent-soft text-accent-ink",
      )}
    >
      {time}
    </span>
  );
}

type LineKind = "item" | "first" | "soft" | "total";
function Line({
  label,
  amount,
  kind = "item",
}: {
  label: string;
  amount: string;
  kind?: LineKind;
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4",
        kind === "item" && "py-[9px] text-[15px]",
        kind === "first" &&
          "border-line mb-1 border-b pt-[9px] pb-3.5 text-[15px]",
        kind === "soft" && "text-muted py-[5px] text-sm",
        kind === "total" &&
          "border-line mt-2 border-t pt-3.5 pb-[9px] text-[17px] font-semibold",
      )}
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap">{amount}</dd>
    </div>
  );
}

// ---------- Content ----------

const FREE_TIME = [
  {
    Icon: Clock,
    title: "Weekly working hours",
    body: "Nothing outside your hours is ever shown.",
  },
  {
    Icon: Prohibit,
    title: "One-off closures",
    body: "Thu 1 Oct, Independence Day: closed, invisible to customers.",
  },
  {
    Icon: ArrowsClockwise,
    title: "Google Calendar, two-way",
    body: "Confirmed bookings added, cancellations removed, reschedules moved.",
  },
  {
    Icon: EnvelopeSimple,
    title: "Customer emails",
    body: "Confirmation, reschedule, cancellation and a 24-hour reminder. Never a WhatsApp message.",
  },
  {
    Icon: MapPinLine,
    title: "Home service",
    body: "Route and distance from the customer's address to yours.",
  },
] as const;

// SAMPLE FIGURES: placeholders confirmed by the product owner. Replace before launch.
const STATS = [
  { value: "₦48.2M", label: "collected through Sara booking links" },
  {
    value: "3,100+",
    label: "businesses across Lagos, Abuja and Port Harcourt",
  },
  { value: "<5s", label: "from payment landing to receipt sent" },
] as const;

const BOOKING_RULES = [
  [
    "Only real free time.",
    "Slots respect your weekly working hours, one-off closures like holidays and rest days, and bookings you already have.",
  ],
  [
    "Google Calendar, both ways.",
    "Confirmed bookings are added, cancellations removed, reschedules moved.",
  ],
  [
    "Customers hear from Sara by email.",
    "Confirmation, reschedule and cancellation emails, plus a reminder 24 hours before.",
  ],
] as const;

const MONEY = [
  {
    name: "Paystack split payments",
    body: "Customer payments settle straight into your business's own Paystack subaccount.",
  },
  {
    name: "Mono bank linking",
    body: "Link your business bank account once for settlement.",
  },
  {
    name: "Home service routes",
    body: "Sara works out the route and distance between the customer's address and yours.",
  },
] as const;

const STEPS = [
  ["Message Sara's WhatsApp number.", "One number for every business."],
  ["Open the one-time link", "Sara sends back."],
  ["Sign in with Google, Facebook or Instagram.", "Your chat is connected."],
] as const;

const FAQ = [
  {
    q: "Is Sara an AI chatbot?",
    a: 'No. Sara is a guided menu. You reply with a number and Sara answers the same way every time. Send "menu" or "0" to go back.',
  },
  {
    q: "Will Sara message my customers on WhatsApp?",
    a: "Never. Sara only replies to you. Customers get emails: confirmation, reschedule, cancellation, and a reminder 24 hours before their appointment.",
  },
  {
    q: "Where does the money go?",
    a: "Paystack split payments settle straight into your business's own subaccount. Mono links your bank account for settlement.",
  },
  {
    q: "I already use Google Calendar.",
    a: "Good. Sync runs both ways: confirmed bookings are added, cancellations removed and reschedules moved, and your busy time is never offered to customers.",
  },
  {
    q: "Can I use Instagram instead of WhatsApp?",
    a: "Yes. The same numbered menu works in your Instagram chat.",
  },
] as const;

const FAQ_SUMMARY =
  "flex cursor-pointer list-none justify-between gap-4 py-[22px] font-display text-lg leading-[1.35] font-medium tracking-[-0.015em] [&::-webkit-details-marker]:hidden after:mt-1.5 after:size-3 after:flex-none after:rotate-45 after:border-r-[1.5px] after:border-b-[1.5px] after:border-accent-ink after:transition-transform after:duration-300 after:ease-out-expo after:content-[''] group-open/faq:after:translate-y-1 group-open/faq:after:-rotate-[135deg]";
const FAQ_ANSWER = "max-w-[60ch] pb-[22px] text-muted";

// ---------- Page ----------

export function LandingPage() {
  const wa = whatsappHref();

  return (
    <LandingMotion>
      <a
        className="focus:bg-ink focus:text-canvas sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-full focus:px-3.5 focus:py-2"
        href="#main"
      >
        Skip to content
      </a>
      <LandingNav whatsappHref={wa} />

      <main id="main">
        {/* Hero */}
        <section
          className="scroll-mt-21 overflow-hidden pt-12 text-center md:pt-22"
          id="top"
        >
          <div className={WRAP}>
            <h1 className="font-display motion-safe:animate-rise mx-auto max-w-[15ch] text-[clamp(2.6rem,1.4rem_+_5.4vw,5.1rem)] leading-[1.02] [font-weight:360] tracking-[-0.04em] text-balance [font-variation-settings:'opsz'_96] md:max-w-none">
              Your whole business, <br className="hidden md:inline" />
              one chat away.
            </h1>
            <p className="text-muted motion-safe:animate-rise-1 mx-auto mt-[22px] max-w-[50ch] text-[clamp(16px,1rem_+_0.3vw,19px)] text-pretty">
              Invoices, receipts, booking links and today&apos;s numbers,
              straight from the WhatsApp chat you already have open. Reply with
              a number. Sara does the rest.
            </p>
            <div className="motion-safe:animate-rise-2 mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3.5">
              <StartButton href={wa} id="start" />
              <a
                className="text-ink-2 decoration-accent-tint hover:decoration-accent-ink font-medium underline decoration-2 underline-offset-[5px] transition-[text-decoration-color] duration-200"
                href="#booking-links"
              >
                See how booking links work
              </a>
            </div>
            <p className="font-display text-faint motion-safe:animate-rise-3 mx-auto mt-11 flex max-w-[620px] flex-wrap items-baseline justify-center gap-x-[22px] gap-y-1.5 text-[15px] leading-[1.4] font-semibold tracking-[-0.01em]">
              <span className="w-full font-sans text-[13px] font-medium tracking-normal sm:w-auto">
                Works with
              </span>
              <span>Paystack</span>
              <span>Mono</span>
              <span>Google Calendar</span>
              <span>WhatsApp</span>
              <span>Instagram</span>
            </p>
          </div>

          {/*
            HERO IMAGE SLOTS. Swap each div for next/image (object-cover) at the same size.
            1) Tall card: WhatsApp conversation screenshot (menu → "1" → invoice for Ada,
               NGN 15,000, gele tying → payment link). Ratio 9:19. Export @2x: 720×1520.
            2) Overlapping card: "Business summary" reply (today, this week, 3 unpaid).
               Ratio 5:4. Export @2x: 680×544.
          */}
          <div className="relative mx-auto mt-14 max-w-[760px] px-4 pb-16 md:px-8">
            <div
              className="rounded-shot from-accent-soft to-accent-tint shadow-float motion-safe:animate-rise-tall mx-auto aspect-[9/19] w-[min(320px,70vw)] -translate-x-[14%] bg-linear-to-b max-[520px]:-translate-x-[12%] max-[520px]:rounded-[26px]"
              role="img"
              aria-label="Sara WhatsApp conversation: the numbered menu, then an invoice for Ada, NGN 15,000 for gele tying, with its payment link"
            />
            <div
              className="rounded-card border-line bg-canvas shadow-lift motion-safe:animate-rise-late absolute right-[max(16px,calc(50%_-_330px))] bottom-[120px] aspect-[5/4] w-[min(340px,58vw)] border max-[520px]:right-4 max-[520px]:bottom-24 max-[520px]:rounded-[18px] md:right-[max(32px,calc(50%_-_330px))]"
              role="img"
              aria-label="Sara Business summary reply: today's revenue, this week's revenue, 3 unpaid invoices"
            />
          </div>
        </section>

        {/* Stats */}
        <section className="border-line border-y" aria-label="Sara in numbers">
          <div className={cn(WRAP, "grid md:grid-cols-3")}>
            {STATS.map((stat) => (
              <div
                key={stat.value}
                className="border-line border-b py-7 last:border-b-0 md:border-b-0 md:border-l md:px-8 md:py-11 md:first:border-l-0 md:first:pl-0"
              >
                <p className="font-display text-[clamp(2.4rem,1.8rem_+_2.2vw,3.4rem)] leading-none [font-weight:330] tracking-[-0.035em]">
                  {stat.value}
                </p>
                <p className="text-muted mt-2 max-w-[26ch] text-[15px]">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Free time behind every booking link */}
        <section
          className="border-line border-b py-24 md:py-34"
          aria-labelledby="free-h"
        >
          <div
            className={cn(
              WRAP,
              "grid gap-10 min-[960px]:grid-cols-[1fr_1.1fr] min-[960px]:items-start min-[960px]:gap-20",
            )}
          >
            <div className="min-[960px]:sticky min-[960px]:top-28">
              <h2 id="free-h" className={H2}>
                Booking links that only sell real free time.
              </h2>
              <p className={SUB}>
                Share {"app.sara.ng/book/<service>"} anywhere. The customer
                picks a slot and pays by Paystack, then Sara confirms, sends the
                receipt and pings you.
              </p>
            </div>
            <ul className="border-ink border-t" data-arrive>
              {FREE_TIME.map(({ Icon, title, body }) => (
                <li
                  key={title}
                  className={cn(
                    "border-line grid grid-cols-[44px_1fr] gap-3.5 border-b py-[22px]",
                    ARRIVE_ITEM,
                  )}
                  data-item
                >
                  <span className="bg-accent-soft text-accent-ink grid size-10 place-items-center rounded-full">
                    <Icon size={20} weight="bold" aria-hidden="true" />
                  </span>
                  <div>
                    <h3
                      className={cn(
                        H3_DISPLAY,
                        "pt-[7px] text-xl leading-[1.25]",
                      )}
                    >
                      {title}
                    </h3>
                    <p className="text-muted mt-1 max-w-[46ch]">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* The six menu numbers */}
        <section
          className="scroll-mt-21 pt-6 pb-28 md:pt-28"
          id="how"
          aria-labelledby="features-h"
        >
          <div className={WRAP}>
            <h2 id="features-h" className={H2}>
              Six numbers run the whole studio.
            </h2>
            <p className={SUB}>
              Every card below is a real exchange with Sara, from Tobi&apos;s
              beauty studio in Yaba.
            </p>
            <div className="mt-12 grid items-start gap-4 min-[700px]:grid-cols-2 min-[1040px]:grid-cols-3 min-[1040px]:gap-5">
              <MenuCard n={1} title="New invoice">
                <Owner>1</Owner>
                <Sara>New invoice. Customer, service and amount?</Sara>
                <Owner>Ada, gele tying, 15000</Owner>
                <Sara>
                  INV-0142 for Ada Okafor: Gele tying, NGN 15,000.
                  <span className={CHIP}>🔗 Payment link ready to forward</span>
                </Sara>
              </MenuCard>
              <MenuCard n={2} title="New receipt">
                <Owner>2</Owner>
                <Sara>New receipt. Customer, service and amount?</Sara>
                <Owner>Chidi, low cut + beard trim, 6000 cash</Owner>
                <Sara>
                  RCT-0388 for Chidi Eze: Low cut + beard trim, NGN 6,000, paid
                  in cash.
                  <span className={CHIP}>📄 RCT-0388.pdf</span>
                </Sara>
              </MenuCard>
              <MenuCard n={3} title="Share a service">
                <Owner>3</Owner>
                <Sara>
                  Which service?
                  <br />
                  1. Knotless braids — NGN 25,000 (4 hr)
                  <br />
                  2. Boho braids — NGN 30,000 (5 hr)
                </Sara>
                <Owner>1</Owner>
                <Sara>
                  Here&apos;s your booking link. Put it in your bio or send it
                  to a customer:
                  <span
                    className={cn(
                      CHIP,
                      "font-mono font-medium tracking-[-0.01em]",
                    )}
                  >
                    {BOOKING_LINK}
                  </span>
                </Sara>
              </MenuCard>
              <MenuCard n={4} title="Unpaid invoices">
                <Owner>4</Owner>
                <Sara>
                  3 unpaid, NGN 55,000 outstanding:
                  <br />
                  Kemi A. · Bridal makeup · NGN 15,000 left (Partially paid)
                  <br />
                  Bisi O. · Knotless braids · NGN 25,000
                  <br />
                  Ngozi E. · Gele tying · NGN 15,000
                </Sara>
              </MenuCard>
              <MenuCard n={5} title="Today's bookings">
                <Owner>5</Owner>
                <Sara>
                  Today, Friday: 3 bookings
                  <br />
                  <span className={TIME}>09:30</span> Ada Okafor · Gele tying
                  <br />
                  <span className={TIME}>12:00</span> Kemi Adeyemi · Bridal
                  makeup
                  <br />
                  <span className={TIME}>15:30</span> Funke Bello · Knotless
                  braids
                </Sara>
              </MenuCard>
              <MenuCard n={6} title="Business summary">
                <Owner>6</Owner>
                <Sara>
                  Today: NGN 31,000
                  <br />
                  This week: NGN 188,000
                  <br />
                  Unpaid: 3 invoices
                  <br />
                  <br />
                  By service this week:
                  <br />
                  Knotless braids NGN 75,000
                  <br />
                  Bridal makeup NGN 50,000
                  <br />
                  Gele tying NGN 45,000
                  <br />
                  Low cut + beard trim NGN 18,000
                </Sara>
              </MenuCard>
            </div>
          </div>
        </section>

        {/* Booking links */}
        <section
          className="bg-surface scroll-mt-21 py-26"
          id="booking-links"
          aria-labelledby="booking-h"
        >
          <div
            className={cn(
              WRAP,
              "grid grid-cols-1 items-center gap-12 min-[960px]:grid-cols-2 min-[960px]:gap-18",
            )}
          >
            <div>
              <h2 id="booking-h" className={H2}>
                One link per service. Customers book and pay on their own.
              </h2>
              <p className={SUB}>
                Reply 3, pick the service, and drop the link in your Instagram
                bio or a chat. Customers open it in their browser, choose a free
                slot and pay through Paystack.
              </p>
              <div className="border-line bg-canvas mt-7 flex max-w-[460px] items-center gap-2 rounded-full border py-1.5 pr-1.5 pl-4">
                <code className="text-ink min-w-0 flex-1 truncate font-mono text-sm">
                  {BOOKING_LINK}
                </code>
                <CopyLinkButton url={`https://${BOOKING_LINK}`} />
              </div>
              <ul className="mt-8 grid max-w-[52ch] gap-[18px]">
                {BOOKING_RULES.map(([lead, rest]) => (
                  <li
                    key={lead}
                    className="text-muted before:bg-accent relative pl-[18px] text-[15px] before:absolute before:top-[0.62em] before:left-0 before:size-1.5 before:rounded-full before:content-['']"
                  >
                    <b className="text-ink font-semibold">{lead}</b> {rest}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative pb-14" data-arrive>
              <div
                className={cn(
                  "rounded-panel bg-canvas shadow-float mx-auto max-w-[440px] px-5 pt-[22px] pb-5",
                  ARRIVE_ITEM,
                )}
                aria-label="Customer booking page example"
                data-item
              >
                <p className="border-line text-faint border-b pb-3.5 font-mono text-xs font-medium">
                  {BOOKING_LINK}
                </p>
                <p className="text-muted mt-4 text-[13px]">
                  Tobi Beauty Studio · Yaba, Lagos
                </p>
                <p className={cn(H3_DISPLAY, "mt-1 text-xl leading-[1.25]")}>
                  Knotless braids — NGN 25,000 (4 hr)
                </p>
                <p className="text-ink-2 mt-5 text-[13px] font-semibold">
                  Pick a day
                </p>
                <div className="mt-2.5 grid grid-cols-5 gap-1.5" role="list">
                  <Day label="Sat" date={26} />
                  <Day label="Mon" date={28} kind="on" />
                  <Day label="Tue" date={29} />
                  <Day label="Wed" date={30} />
                  <Day
                    label="Thu"
                    date={1}
                    kind="off"
                    title="Closed: Independence Day"
                  />
                </div>
                <p className="text-ink-2 mt-5 text-[13px] font-semibold">
                  Free times, Monday 28 September
                </p>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5" role="list">
                  <Slot time="09:00" />
                  <Slot time="10:00" kind="taken" />
                  <Slot time="11:00" kind="taken" />
                  <Slot time="13:00" kind="on" />
                  <Slot time="14:00" />
                  <Slot time="15:00" />
                </div>
                <p className="bg-ink text-canvas mt-5 rounded-full p-3.5 text-center text-[15px] font-semibold">
                  Pay NGN 25,000 with Paystack
                </p>
              </div>
              <Sara className="shadow-lift absolute bottom-0 left-0 max-w-[300px] min-[960px]:-left-6">
                ✅ New booking: Funke Bello, Knotless braids, Mon 28 Sep at
                13:00. NGN 25,000 paid. Receipt sent.
              </Sara>
            </div>
          </div>
        </section>

        {/* Invoices */}
        <section
          className="scroll-mt-21 py-28"
          id="invoices"
          aria-labelledby="inv-h"
        >
          <div
            className={cn(
              WRAP,
              "grid items-center gap-12 min-[960px]:grid-cols-2 min-[960px]:gap-22",
            )}
          >
            <div
              className={cn(
                "rounded-panel border-line bg-canvas shadow-card max-w-[480px] border px-[22px] pt-[26px] pb-[22px]",
                ARRIVE_SELF,
              )}
              aria-label="Invoice example"
              data-arrive
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-faint font-mono text-xs font-medium">
                    INV-0139
                  </p>
                  <p
                    className={cn(H3_DISPLAY, "mt-1 text-[22px] leading-[1.2]")}
                  >
                    Kemi Adeyemi
                  </p>
                </div>
                <span className="bg-accent-soft text-accent-ink flex-none rounded-full px-3 py-1.5 text-[13px] font-semibold">
                  Partially paid
                </span>
              </div>
              <dl className="mt-[22px] grid">
                <Line label="Bridal makeup (wedding day)" amount="NGN 18,000" />
                <Line label="Gele tying" amount="NGN 6,000" kind="first" />
                <Line label="Subtotal" amount="NGN 24,000" kind="soft" />
                <Line label="VAT 7.5%" amount="NGN 1,800" kind="soft" />
                <Line label="Discount" amount="−NGN 800" kind="soft" />
                <Line label="Total" amount="NGN 25,000" kind="total" />
              </dl>
              <div
                className="bg-accent-soft mt-[18px] h-2 overflow-hidden rounded-full"
                role="img"
                aria-label="NGN 10,000 of NGN 25,000 paid"
              >
                <span className="bg-accent block h-full w-2/5 rounded-full" />
              </div>
              <p className="text-muted mt-3 flex items-center justify-between gap-3 text-[13px]">
                <span>NGN 10,000 of NGN 25,000 paid</span>
                <span className="text-accent-ink font-semibold">
                  Export PDF
                </span>
              </p>
            </div>
            <div className="min-[960px]:order-2">
              <h2 id="inv-h" className={H2}>
                Invoices that know who still owes you.
              </h2>
              <p className={SUB}>
                Line items, tax and discounts, with status that moves on its
                own: Unpaid, Partially paid, Paid. Export any invoice as a PDF.
              </p>
              <p
                className={cn(MSG, MSG_IN, "shadow-bubble mt-7 max-w-[360px]")}
              >
                ✅ Payment received: Kemi paid NGN 10,000 for Bridal makeup.
                Receipt RCT-0412 sent.
              </p>
              <p className={cn(SUB, "mt-3 text-sm")}>
                When a payment lands, the receipt is created for you. Nothing to
                type.
              </p>
            </div>
          </div>
        </section>

        {/* Money plumbing */}
        <section
          className="border-line border-t py-26"
          aria-labelledby="money-h"
        >
          <div className={WRAP}>
            <h2 id="money-h" className={cn(H2, "mx-auto text-center")}>
              The plumbing of a salon chain, in a one-chair studio.
            </h2>
            <div className="border-line mt-14 grid border-t min-[860px]:grid-cols-3 min-[860px]:border-t-0">
              {MONEY.map((m) => (
                <div
                  key={m.name}
                  className="border-line grid gap-1.5 border-b py-6 min-[860px]:border-b-0 min-[860px]:border-l min-[860px]:px-8 min-[860px]:py-0 min-[860px]:first:border-l-0 min-[860px]:first:pl-0"
                >
                  <p className={cn(H3_DISPLAY, "text-xl leading-[1.2]")}>
                    {m.name}
                  </p>
                  <p className="text-muted max-w-[40ch] text-[15px]">
                    {m.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Onboarding */}
        <section className="bg-surface py-26" aria-labelledby="onboard-h">
          <div className={WRAP}>
            <h2 id="onboard-h" className={cn(H2, "mx-auto text-center")}>
              Connected in three messages.
            </h2>
            <ol className="mx-auto mt-12 grid max-w-[880px] gap-3.5 min-[860px]:grid-cols-3 min-[860px]:gap-4">
              {STEPS.map(([lead, rest], i) => (
                <li
                  key={lead}
                  className="bg-canvas flex items-start gap-4 rounded-[22px] p-5 min-[860px]:flex-col min-[860px]:px-6 min-[860px]:pt-[26px] min-[860px]:pb-7"
                >
                  <span className="border-accent text-accent-ink grid size-[34px] flex-none place-items-center rounded-full border-[1.5px] font-semibold">
                    {i + 1}
                  </span>
                  <p className="text-muted pt-1">
                    <b className="text-ink font-semibold">{lead}</b> {rest}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* FAQ */}
        <section
          className="scroll-mt-21 py-28"
          id="faq"
          aria-labelledby="faq-h"
        >
          <div
            className={cn(
              WRAP,
              "grid gap-9 min-[960px]:grid-cols-[1fr_1.4fr] min-[960px]:gap-18",
            )}
          >
            <h2 id="faq-h" className={H2}>
              Questions owners ask first
            </h2>
            <div className="border-line border-t">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group/faq border-line border-b">
                  <summary className={FAQ_SUMMARY}>{q}</summary>
                  <p className={FAQ_ANSWER}>{a}</p>
                </details>
              ))}
              <details
                id="pricing"
                className="group/faq border-line scroll-mt-21 border-b"
              >
                <summary className={FAQ_SUMMARY}>What does Sara cost?</summary>
                {/* PLACEHOLDER: pricing not confirmed. Replace before launch. */}
                <p className={FAQ_ANSWER} data-placeholder>
                  Pricing details go here before launch.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* Close */}
        <section className="pt-10 pb-30" aria-labelledby="close-h">
          <div
            className={cn(WRAP, "grid justify-items-center gap-7 text-center")}
          >
            {/* The closing lockup, all green: the mark in single ink so it reads as one word with the name. */}
            <p
              className="font-display text-accent inline-flex items-center gap-[0.2em] text-[clamp(5rem,3rem_+_14vw,13rem)] leading-[0.9] font-semibold tracking-[-0.06em] [font-variation-settings:'opsz'_96]"
              aria-hidden="true"
            >
              <LogoMark
                accent={false}
                className="size-[0.95em] translate-y-[0.07em]"
              />
              sara
            </p>
            <h2
              id="close-h"
              className="font-display max-w-[22ch] text-[clamp(1.5rem,1.1rem_+_1.4vw,2.2rem)] leading-[1.15] font-normal tracking-[-0.03em] text-balance"
            >
              Reply with a number. Run the business.
            </h2>
            <StartButton href={wa} />
          </div>
        </section>
      </main>

      <footer className="border-line border-t pt-8 pb-12">
        <div
          className={cn(
            WRAP,
            "text-muted flex flex-wrap items-center gap-x-8 gap-y-4 text-sm",
          )}
        >
          <Wordmark href="#top" />
          <nav
            className="flex flex-wrap gap-x-[22px] gap-y-2"
            aria-label="Footer"
          >
            <a className="hover:text-ink" href="#how">
              How it works
            </a>
            <a className="hover:text-ink" href="#booking-links">
              Booking links
            </a>
            <a className="hover:text-ink" href="#invoices">
              Invoices &amp; receipts
            </a>
            <a className="hover:text-ink" href="#faq">
              FAQ
            </a>
            <Link className="hover:text-ink" href="/signin">
              Sign in
            </Link>
          </nav>
          <p className="ml-auto max-[700px]:ml-0 max-[700px]:w-full">
            © 2026 Sara. Made in Lagos.
          </p>
        </div>
      </footer>
    </LandingMotion>
  );
}
