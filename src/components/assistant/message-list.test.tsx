import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MessageList } from "./message-list";
import { VoiceStatus } from "./voice-status";

describe("MessageList", () => {
  it("offers useful help in an empty, accessible conversation", () => {
    const html = renderToStaticMarkup(<MessageList messages={[]} />);
    expect(html).toContain('role="log"');
    expect(html).toContain("Ask about your business");
    expect(html).toContain("What invoices are unpaid?");
  });

  it("shows owner text, Sara replies and a separately labelled voice transcript", () => {
    const html = renderToStaticMarkup(<MessageList messages={[
      { id: "1", role: "owner", text: "Voice note", transcript: "Invoice Tolu for two wigs" },
      { id: "2", role: "sara", text: "Here is the draft.\nPlease review it." },
    ]} />);
    expect(html).toContain("Voice transcript");
    expect(html).toContain("Invoice Tolu for two wigs");
    expect(html).toContain("Here is the draft.\nPlease review it.");
    expect(html).toContain("You");
    expect(html).toContain("Sara");
  });

  it("escapes owner and model text without rendering suggested links", () => {
    const html = renderToStaticMarkup(<MessageList messages={[
      { id: "1", role: "owner", text: '<img src=x onerror="alert(1)">' },
      { id: "2", role: "sara", text: "<script>bad</script> https://example.com/fake" },
    ]} />);
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href=');
  });

  it("links only an actual saved action result and rejects executable URLs", () => {
    const result = { text: "Invoice created", resourceId: "inv1", link: "https://sara.test/i/abc", affected: ["invoices"] as const };
    const render = (link: string) => renderToStaticMarkup(<MessageList messages={[
      { id: "1", role: "sara", text: "Done", result: { ...result, affected: [...result.affected], link } },
    ]} />);
    expect(render(result.link)).toContain('href="https://sara.test/i/abc"');
    expect(render(result.link)).toContain("Invoice created");
    expect(render("javascript:alert(1)")).not.toContain('href=');
    expect(render("//untrusted.test")).not.toContain('href=');
  });
});

describe("VoiceStatus", () => {
  it("keeps typing available when recording is unsupported or permission is denied", () => {
    const unsupported = renderToStaticMarkup(<VoiceStatus supported={false} state="idle" error={null} />);
    const denied = renderToStaticMarkup(<VoiceStatus supported state="idle" error="Microphone permission was denied. You can still type." />);
    expect(unsupported).toContain("You can still type");
    expect(denied).toContain("permission was denied");
    expect(denied).toContain("You can still type");
    expect(denied).toContain('aria-live="polite"');
  });

  it("announces recording and slow requests", () => {
    expect(renderToStaticMarkup(<VoiceStatus supported state="recording" error={null} />)).toContain("Recording");
    expect(renderToStaticMarkup(<VoiceStatus supported state="idle" error={null} waiting />)).toContain("One moment…");
  });
});
