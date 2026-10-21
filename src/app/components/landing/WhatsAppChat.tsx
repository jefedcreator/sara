import {
  Camera,
  CaretLeft,
  Checks,
  LinkSimple,
  Microphone,
  Phone,
  Plus,
  ShareFat,
  Sticker,
  VideoCamera,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

import { LogoMark, LogoTile } from "@/primitives";
import { cn } from "@/utils/cn";

import { ARRIVE_ITEM } from "./motion";

/*
 * A chat with Sara as the owner's WhatsApp shows it: iOS in light mode, like
 * the hero recording. Sara's header, the doodle wallpaper, the owner's
 * messages in WhatsApp's pale green with grey ticks (delivered: Sara sends no
 * read receipts), and Sara's in white. Sara sends plain text, so a reply has
 * no colour of its own: links are underlined, and WhatsApp draws their
 * preview. The wa-* colours are WhatsApp's own and are used only here.
 *
 * Like a screenshot, the window has a phone's height: a long exchange keeps
 * its latest messages in view and the earlier ones slip under the header.
 */

const BUBBLE =
  "relative w-fit max-w-[85%] rounded-bubble px-3 pt-[7px] pb-2 text-[14.5px] leading-[1.38] text-ink shadow-bubble wrap-anywhere";
const STAMP =
  "inline-flex items-center gap-0.5 text-[11px] leading-none whitespace-nowrap";

export function WhatsAppChat({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-panel border-line bg-wa-wallpaper shadow-float overflow-hidden border bg-[url(/landing/wa-doodles.svg)]">
      <div
        className="border-line bg-canvas text-ink flex items-center gap-2 border-b py-2.5 pr-4 pl-2"
        aria-hidden="true"
      >
        <CaretLeft size={20} weight="bold" />
        <span className="size-8 overflow-hidden rounded-full">
          <LogoTile className="size-full" />
        </span>
        <span className="text-[15px] leading-none font-semibold">sara</span>
        <span className="ml-auto flex items-center gap-5">
          <VideoCamera size={21} />
          <Phone size={19} />
        </span>
      </div>
      <div className="flex max-h-[580px] flex-col justify-end gap-2 overflow-hidden px-3 pt-3.5 pb-2">
        <p
          className="bg-canvas text-ink-2 shadow-bubble mx-auto mb-1 w-fit rounded-full px-3 py-[5px] text-xs leading-none font-semibold"
          aria-hidden="true"
        >
          Today
        </p>
        {children}
      </div>
      <div
        className="text-ink flex items-center gap-3 px-3 pt-1.5 pb-3"
        aria-hidden="true"
      >
        <Plus size={20} />
        <span className="bg-canvas shadow-bubble flex h-8 flex-1 items-center justify-end rounded-full pr-2.5">
          <Sticker size={18} />
        </span>
        <Camera size={20} />
        <span className="bg-accent text-on-accent grid size-8 place-items-center rounded-full">
          <Microphone size={16} weight="fill" />
        </span>
      </div>
    </div>
  );
}

/** The owner's message: right, pale green, with the time and ticks. */
export function OwnerMessage({
  time,
  children,
}: {
  time: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex justify-end", ARRIVE_ITEM)} data-item>
      <p className={cn(BUBBLE, "bg-wa-out rounded-br-[4px]")}>
        <span className="sr-only">Tobi: </span>
        {children}
        <Stamp time={time} ticks />
        <Tail className="fill-wa-out -right-[5px] -scale-x-100" />
      </p>
    </div>
  );
}

/**
 * Sara's reply: left, white. With a `preview`, the reply carries a link and
 * shows WhatsApp's link preview above it and the forward button beside it.
 * `grouped`: Sara's next message follows straight on, so this one drops its
 * tail and sits close to it, as WhatsApp groups a run of messages.
 */
export function SaraMessage({
  time,
  preview,
  grouped = false,
  children,
}: {
  time: string;
  preview?: { title: string; body: string };
  grouped?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2",
        grouped && "-mb-1.5",
        ARRIVE_ITEM,
      )}
      data-item
    >
      <p className={cn(BUBBLE, "bg-canvas", !grouped && "rounded-bl-[4px]")}>
        <span className="sr-only">Sara: </span>
        {preview ? <LinkPreview {...preview} /> : null}
        {children}
        <Stamp time={time} />
        {grouped ? null : <Tail className="fill-canvas -left-[5px]" />}
      </p>
      {preview ? (
        <span
          className="bg-ink/20 text-canvas grid size-7 flex-none place-items-center rounded-full"
          aria-hidden="true"
        >
          <ShareFat size={14} weight="fill" />
        </span>
      ) : null}
    </div>
  );
}

/** A link in a reply, as WhatsApp underlines it. */
export function ChatLink({ children }: { children: ReactNode }) {
  return (
    <span className="text-accent-ink underline decoration-1 underline-offset-2">
      {children}
    </span>
  );
}

/**
 * Time (and ticks) at the bottom right. The invisible copy holds room on the
 * last line, so the stamp sits beside short text and drops below long text.
 */
function Stamp({ time, ticks = false }: { time: string; ticks?: boolean }) {
  const stamp = (
    <>
      {time}
      {ticks ? <Checks size={15} weight="bold" /> : null}
    </>
  );
  return (
    <>
      <span className={cn(STAMP, "invisible pl-2")} aria-hidden="true">
        {stamp}
      </span>
      <span
        className={cn(STAMP, "text-ink/45 absolute right-2.5 bottom-[5px]")}
        aria-hidden="true"
      >
        {stamp}
      </span>
    </>
  );
}

/** iOS WhatsApp's tail on the bubble's bottom corner, drawn for the left; flip it for the right. */
function Tail({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 11 17"
      className={cn("absolute bottom-0 h-[17px] w-[11px]", className)}
      aria-hidden="true"
    >
      <path d="M5 0C5 8.5 3.6 13.4.4 16.2c-.4.4-.2.8.4.8H11V0Z" />
    </svg>
  );
}

/** The preview WhatsApp builds from the link's card: thumbnail, title, description, domain. */
function LinkPreview({ title, body }: { title: string; body: string }) {
  return (
    <span
      className="bg-surface -mx-2 -mt-[3px] mb-2 flex overflow-hidden rounded-[12px]"
      aria-hidden="true"
    >
      <span className="bg-accent-soft grid w-16 flex-none place-items-center">
        <LogoMark className="size-7" />
      </span>
      <span className="grid min-w-0 content-center gap-0.5 px-2.5 py-2">
        <span className="line-clamp-2 text-[13px] leading-[1.3] font-semibold">
          {title}
        </span>
        <span className="text-muted line-clamp-2 text-xs leading-[1.3]">
          {body}
        </span>
        <span className="text-faint mt-0.5 flex items-center gap-1 text-[11.5px] leading-none">
          <LinkSimple size={12} />
          app.sara.ng
        </span>
      </span>
    </span>
  );
}
