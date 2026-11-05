"use client";

import { useEffect, useRef } from "react";
import type { ActionResult } from "types";

import { cn } from "@/utils/cn";

export type AssistantMessage = {
  id: string;
  role: "owner" | "sara";
  text: string;
  transcript?: string;
  result?: ActionResult | null;
};

function resultLink(link: string | null) {
  if (!link) return undefined;
  // Result URLs are structured server output; free-form replies never become HTML.
  if (link.startsWith("/") && !link.startsWith("//") && !link.includes("\\")) return link;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function MessageList({ messages }: { messages: AssistantMessage[] }) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scroll.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <div ref={scroll} role="log" aria-label="Conversation with Sara" aria-live="polite" aria-relevant="additions text"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {messages.length === 0 ? (
        <div className="bg-surface rounded-panel grid gap-3 p-5">
          <p className="font-display text-ink text-xl font-medium tracking-tight">Ask about your business</p>
          <p className="text-muted text-sm leading-relaxed">Try “What invoices are unpaid?” or ask Sara to prepare an invoice. You review every change before it is sent.</p>
        </div>
      ) : (
        <ol className="grid gap-4 py-1">
          {messages.map((message) => (
            <li key={message.id} className={cn("grid max-w-[92%] gap-1.5", message.role === "owner" ? "justify-self-end" : "justify-self-start")}>
              <p className={cn("text-muted px-1 text-xs font-semibold", message.role === "owner" && "text-right")}>{message.role === "owner" ? "You" : "Sara"}</p>
              <div className={cn("rounded-bubble px-3.5 py-3 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere", message.role === "owner" ? "bg-accent text-on-accent rounded-br-[6px]" : "border-line text-ink rounded-bl-[6px] border")}>
                <p>{message.text}</p>
                {message.transcript !== undefined ? (
                  <div className="mt-2 border-t border-on-accent/20 pt-2">
                    <p className="mb-1 text-xs font-semibold">Voice transcript</p>
                    <p>{message.transcript}</p>
                  </div>
                ) : null}
                {message.result ? (
                  <p className="mt-2">
                    {resultLink(message.result.link) ? <a className="text-accent-ink underline underline-offset-4" href={resultLink(message.result.link)}>{message.result.text}</a> : message.result.text}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
