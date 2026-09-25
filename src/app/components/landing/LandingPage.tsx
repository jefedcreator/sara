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

import { CopyLinkButton } from "./CopyLinkButton";
import { LandingMotion } from "./LandingMotion";
import { LandingNav } from "./LandingNav";
import s from "./landing.module.css";

/*
 * Sara landing page, ported from landing/v1/impeccable (the app-wide design
 * language, see /DESIGN.md). Server-rendered; the only client pieces are the
 * nav, the scroll motion root and the copy button.
 */

const BOOKING_LINK = "app.sara.ng/book/tobi-knotless-braids";

function whatsappHref() {
  const number = env.NEXT_PUBLIC_SARA_WHATSAPP_NUMBER;
  return number
    ? `https://wa.me/${number}?text=${encodeURIComponent("Hi Sara")}`
    : "https://wa.me/";
}

function Arrow() {
  return (
    <span className={s.btnArrow} aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
      </svg>
    </span>
  );
}

function StartButton({ href, id }: { href: string; id?: string }) {
  return (
    <a
      className={`${s.btn} ${s.btnLg}`}
      id={id}
      href={href}
      target="_blank"
      rel="noopener"
    >
      Start on WhatsApp
      <Arrow />
    </a>
  );
}

function Owner({ children }: { children: ReactNode }) {
  return (
    <p className={`${s.msg} ${s.msgOut}`} data-item>
      {children}
    </p>
  );
}

function Sara({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={`${s.msg} ${s.msgIn} ${className}`} data-item>
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
    <article className={s.card} data-arrive>
      <header className={s.cardHead}>
        <span className={s.num}>{n}</span>
        <h3>{title}</h3>
      </header>
      <div className={s.thread}>{children}</div>
    </article>
  );
}

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

export function LandingPage() {
  const wa = whatsappHref();

  return (
    <LandingMotion>
      <a className={s.skip} href="#main">
        Skip to content
      </a>
      <LandingNav whatsappHref={wa} />

      <main id="main">
        <section className={s.hero} id="top">
          <div className={`${s.wrap} ${s.heroCopy}`}>
            <h1 className={s.heroTitle}>
              Your whole business, <br className={s.brLg} />
              one chat away.
            </h1>
            <p className={s.lede}>
              Invoices, receipts, booking links and today&apos;s numbers,
              straight from the WhatsApp chat you already have open. Reply with
              a number. Sara does the rest.
            </p>
            <div className={s.ctaRow}>
              <StartButton href={wa} id="start" />
              <a className={s.linkQuiet} href="#booking-links">
                See how booking links work
              </a>
            </div>
            <p className={s.works}>
              <span className={s.worksLabel}>Works with</span>
              <span>Paystack</span>
              <span>Mono</span>
              <span>Google Calendar</span>
              <span>WhatsApp</span>
              <span>Instagram</span>
            </p>
          </div>

          {/*
            HERO IMAGE SLOTS. Swap each div for next/image (object-fit: cover) at the same size.
            1) shotTall: WhatsApp conversation screenshot (menu → "1" → invoice for Ada,
               NGN 15,000, gele tying → payment link). Ratio 9:19. Export @2x: 720×1520.
            2) shotSummary: "Business summary" reply (today, this week, 3 unpaid). Ratio 5:4. Export @2x: 680×544.
          */}
          <div className={s.heroStage}>
            <div
              className={s.shotTall}
              role="img"
              aria-label="Sara WhatsApp conversation: the numbered menu, then an invoice for Ada, NGN 15,000 for gele tying, with its payment link"
            />
            <div
              className={s.shotSummary}
              role="img"
              aria-label="Sara Business summary reply: today's revenue, this week's revenue, 3 unpaid invoices"
            />
          </div>
        </section>

        {/* SAMPLE FIGURES: placeholders confirmed by the product owner. Replace before launch. */}
        <section className={s.stats} aria-label="Sara in numbers">
          <div className={`${s.wrap} ${s.statsRow}`}>
            <div className={s.stat}>
              <p className={s.statNum}>₦48.2M</p>
              <p className={s.statLabel}>
                collected through Sara booking links
              </p>
            </div>
            <div className={s.stat}>
              <p className={s.statNum}>3,100+</p>
              <p className={s.statLabel}>
                businesses across Lagos, Abuja and Port Harcourt
              </p>
            </div>
            <div className={s.stat}>
              <p className={s.statNum}>&lt;5s</p>
              <p className={s.statLabel}>
                from payment landing to receipt sent
              </p>
            </div>
          </div>
        </section>

        <section className={s.free} aria-labelledby="free-h">
          <div className={`${s.wrap} ${s.freeGrid}`}>
            <div className={s.freeCopy}>
              <h2 id="free-h" className={s.h2}>
                Booking links that only sell real free time.
              </h2>
              <p className={s.sub}>
                Share {"app.sara.ng/book/<service>"} anywhere. The customer
                picks a slot and pays by Paystack, then Sara confirms, sends the
                receipt and pings you.
              </p>
            </div>
            <ul className={s.freeRules} data-arrive>
              {FREE_TIME.map(({ Icon, title, body }) => (
                <li key={title} data-item>
                  <span className={s.freeIco}>
                    <Icon size={20} weight="bold" aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className={s.features} id="how" aria-labelledby="features-h">
          <div className={s.wrap}>
            <h2 id="features-h" className={s.h2}>
              Six numbers run the whole studio.
            </h2>
            <p className={s.sub}>
              Every card below is a real exchange with Sara, from Tobi&apos;s
              beauty studio in Yaba.
            </p>
            <div className={s.cards}>
              <MenuCard n={1} title="New invoice">
                <Owner>1</Owner>
                <Sara>New invoice. Customer, service and amount?</Sara>
                <Owner>Ada, gele tying, 15000</Owner>
                <Sara>
                  INV-0142 for Ada Okafor: Gele tying, NGN 15,000.
                  <span className={s.chip}>
                    🔗 Payment link ready to forward
                  </span>
                </Sara>
              </MenuCard>
              <MenuCard n={2} title="New receipt">
                <Owner>2</Owner>
                <Sara>New receipt. Customer, service and amount?</Sara>
                <Owner>Chidi, low cut + beard trim, 6000 cash</Owner>
                <Sara>
                  RCT-0388 for Chidi Eze: Low cut + beard trim, NGN 6,000, paid
                  in cash.
                  <span className={s.chip}>📄 RCT-0388.pdf</span>
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
                  <span className={`${s.chip} ${s.mono}`}>{BOOKING_LINK}</span>
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
                  <span className={s.t}>09:30</span> Ada Okafor · Gele tying
                  <br />
                  <span className={s.t}>12:00</span> Kemi Adeyemi · Bridal
                  makeup
                  <br />
                  <span className={s.t}>15:30</span> Funke Bello · Knotless
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

        <section
          className={s.booking}
          id="booking-links"
          aria-labelledby="booking-h"
        >
          <div className={`${s.wrap} ${s.bookingGrid}`}>
            <div>
              <h2 id="booking-h" className={s.h2}>
                One link per service. Customers book and pay on their own.
              </h2>
              <p className={s.sub}>
                Reply 3, pick the service, and drop the link in your Instagram
                bio or a chat. Customers open it in their browser, choose a free
                slot and pay through Paystack.
              </p>
              <div className={s.linkbox}>
                <code>{BOOKING_LINK}</code>
                <CopyLinkButton url={`https://${BOOKING_LINK}`} />
              </div>
              <ul className={s.rules}>
                <li>
                  <b>Only real free time.</b> Slots respect your weekly working
                  hours, one-off closures like holidays and rest days, and
                  bookings you already have.
                </li>
                <li>
                  <b>Google Calendar, both ways.</b> Confirmed bookings are
                  added, cancellations removed, reschedules moved.
                </li>
                <li>
                  <b>Customers hear from Sara by email.</b> Confirmation,
                  reschedule and cancellation emails, plus a reminder 24 hours
                  before.
                </li>
              </ul>
            </div>

            <div className={s.bookingVisual} data-arrive>
              <div
                className={s.bookPage}
                aria-label="Customer booking page example"
                data-item
              >
                <p className={s.bpUrl}>{BOOKING_LINK}</p>
                <p className={s.bpBiz}>Tobi Beauty Studio · Yaba, Lagos</p>
                <p className={s.bpSvc}>Knotless braids — NGN 25,000 (4 hr)</p>
                <p className={s.bpLabel}>Pick a day</p>
                <div className={s.days} role="list">
                  <span role="listitem" className={s.day}>
                    Sat<b>26</b>
                  </span>
                  <span role="listitem" className={`${s.day} ${s.dayOn}`}>
                    Mon<b>28</b>
                  </span>
                  <span role="listitem" className={s.day}>
                    Tue<b>29</b>
                  </span>
                  <span role="listitem" className={s.day}>
                    Wed<b>30</b>
                  </span>
                  <span
                    role="listitem"
                    className={`${s.day} ${s.dayOff}`}
                    title="Closed: Independence Day"
                  >
                    Thu<b>1</b>
                  </span>
                </div>
                <p className={s.bpLabel}>Free times, Monday 28 September</p>
                <div className={s.slots} role="list">
                  <span role="listitem" className={s.slot}>
                    09:00
                  </span>
                  <span role="listitem" className={`${s.slot} ${s.slotTaken}`}>
                    10:00
                  </span>
                  <span role="listitem" className={`${s.slot} ${s.slotTaken}`}>
                    11:00
                  </span>
                  <span role="listitem" className={`${s.slot} ${s.slotOn}`}>
                    13:00
                  </span>
                  <span role="listitem" className={s.slot}>
                    14:00
                  </span>
                  <span role="listitem" className={s.slot}>
                    15:00
                  </span>
                </div>
                <p className={s.bpPay}>Pay NGN 25,000 with Paystack</p>
              </div>
              <Sara className={s.ping}>
                ✅ New booking: Funke Bello, Knotless braids, Mon 28 Sep at
                13:00. NGN 25,000 paid. Receipt sent.
              </Sara>
            </div>
          </div>
        </section>

        <section className={s.invoices} id="invoices" aria-labelledby="inv-h">
          <div className={`${s.wrap} ${s.invGrid}`}>
            <div
              className={s.invoice}
              aria-label="Invoice example"
              data-arrive
              data-self
            >
              <div className={s.invTop}>
                <div>
                  <p className={s.invNo}>INV-0139</p>
                  <p className={s.invTo}>Kemi Adeyemi</p>
                </div>
                <span className={s.status}>Partially paid</span>
              </div>
              <dl className={s.lines}>
                <div>
                  <dt>Bridal makeup (wedding day)</dt>
                  <dd>NGN 18,000</dd>
                </div>
                <div>
                  <dt>Gele tying</dt>
                  <dd>NGN 6,000</dd>
                </div>
                <div className={s.lineSoft}>
                  <dt>Subtotal</dt>
                  <dd>NGN 24,000</dd>
                </div>
                <div className={s.lineSoft}>
                  <dt>VAT 7.5%</dt>
                  <dd>NGN 1,800</dd>
                </div>
                <div className={s.lineSoft}>
                  <dt>Discount</dt>
                  <dd>−NGN 800</dd>
                </div>
                <div className={s.lineTotal}>
                  <dt>Total</dt>
                  <dd>NGN 25,000</dd>
                </div>
              </dl>
              <div
                className={s.progress}
                role="img"
                aria-label="NGN 10,000 of NGN 25,000 paid"
              >
                <span style={{ width: "40%" }} />
              </div>
              <p className={s.invFoot}>
                <span>NGN 10,000 of NGN 25,000 paid</span>
                <span className={s.pdf}>Export PDF</span>
              </p>
            </div>
            <div className={s.invCopy}>
              <h2 id="inv-h" className={s.h2}>
                Invoices that know who still owes you.
              </h2>
              <p className={s.sub}>
                Line items, tax and discounts, with status that moves on its
                own: Unpaid, Partially paid, Paid. Export any invoice as a PDF.
              </p>
              <p className={`${s.msg} ${s.msgIn} ${s.receiptMsg}`}>
                ✅ Payment received: Kemi paid NGN 10,000 for Bridal makeup.
                Receipt RCT-0412 sent.
              </p>
              <p className={`${s.sub} ${s.subSmall}`}>
                When a payment lands, the receipt is created for you. Nothing to
                type.
              </p>
            </div>
          </div>
        </section>

        <section className={s.money} aria-labelledby="money-h">
          <div className={s.wrap}>
            <h2 id="money-h" className={`${s.h2} ${s.center}`}>
              The plumbing of a salon chain, in a one-chair studio.
            </h2>
            <div className={s.moneyGrid}>
              <div className={s.moneyItem}>
                <p className={s.miName}>Paystack split payments</p>
                <p>
                  Customer payments settle straight into your business&apos;s
                  own Paystack subaccount.
                </p>
              </div>
              <div className={s.moneyItem}>
                <p className={s.miName}>Mono bank linking</p>
                <p>Link your business bank account once for settlement.</p>
              </div>
              <div className={s.moneyItem}>
                <p className={s.miName}>Home service routes</p>
                <p>
                  Sara works out the route and distance between the
                  customer&apos;s address and yours.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className={s.onboard} aria-labelledby="onboard-h">
          <div className={s.wrap}>
            <h2 id="onboard-h" className={`${s.h2} ${s.center}`}>
              Connected in three messages.
            </h2>
            <ol className={s.steps}>
              <li>
                <span className={s.stepN}>1</span>
                <p>
                  <b>Message Sara&apos;s WhatsApp number.</b> One number for
                  every business.
                </p>
              </li>
              <li>
                <span className={s.stepN}>2</span>
                <p>
                  <b>Open the one-time link</b> Sara sends back.
                </p>
              </li>
              <li>
                <span className={s.stepN}>3</span>
                <p>
                  <b>Sign in with Google, Facebook or Instagram.</b> Your chat
                  is connected.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section className={s.faq} id="faq" aria-labelledby="faq-h">
          <div className={`${s.wrap} ${s.faqWrap}`}>
            <h2 id="faq-h" className={s.h2}>
              Questions owners ask first
            </h2>
            <div className={s.faqList}>
              {FAQ.map(({ q, a }) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
              <details id="pricing">
                <summary>What does Sara cost?</summary>
                {/* PLACEHOLDER: pricing not confirmed. Replace before launch. */}
                <p data-placeholder>Pricing details go here before launch.</p>
              </details>
            </div>
          </div>
        </section>

        <section className={s.close} aria-labelledby="close-h">
          <div className={`${s.wrap} ${s.closeInner}`}>
            <p className={s.closeMark} aria-hidden="true">
              sara
            </p>
            <h2 id="close-h" className={s.closeTitle}>
              Reply with a number. Run the business.
            </h2>
            <StartButton href={wa} />
          </div>
        </section>
      </main>

      <footer className={s.foot}>
        <div className={`${s.wrap} ${s.footInner}`}>
          <a className={s.wordmark} href="#top">
            sara
          </a>
          <nav className={s.footNav} aria-label="Footer">
            <a href="#how">How it works</a>
            <a href="#booking-links">Booking links</a>
            <a href="#invoices">Invoices &amp; receipts</a>
            <a href="#faq">FAQ</a>
            <Link href="/sign-in">Sign in</Link>
          </nav>
          <p className={s.footNote}>© 2026 Sara. Made in Lagos.</p>
        </div>
      </footer>
    </LandingMotion>
  );
}
