import { render } from "@react-email/components";

import type { EmailMessage } from "./types";

export interface RenderedEmail {
  html: string;
  text: string;
}

/**
 * Both renderings of a message from its one React body. The plain-text part
 * isn't polish: clients that block HTML show it, spam filters weigh its
 * absence, and the console sender prints it.
 */
export async function renderEmail(
  message: EmailMessage,
): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(message.body),
    render(message.body, { plainText: true }),
  ]);
  return { html, text };
}
