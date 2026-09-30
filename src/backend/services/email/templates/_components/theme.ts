import { pixelBasedPreset, type TailwindConfig } from "@react-email/components";

/*
 * DESIGN.md's tokens for email, under the names src/styles/globals.css gives
 * them, so a template reads like the app: `bg-accent text-on-accent`,
 * `text-accent-ink`, `rounded-bubble`. React Email's <Tailwind> turns the
 * classes into inline styles at render, the only styling every client keeps.
 *
 * Restated by value: email clients read neither CSS variables nor the app's
 * @theme, and `yarn email:dev` bundles templates/ itself without the `@/`
 * alias (relative imports only under templates/). Light palette only; no
 * client can be relied on to apply a dark variant. Update both when a token
 * moves.
 */
export const colors = {
  canvas: "#ffffff",
  surface: "#f4f7f5",
  line: "#e5ebe7",
  ink: "#0f1a14",
  "ink-2": "#37443c",
  muted: "#5a665f",
  faint: "#7f8a84",
  accent: "#25d366",
  "accent-ink": "#075e54",
  "on-accent": "#0b2b1a",
  "accent-soft": "#e8f9ee",
  danger: "#b42318",
  "danger-soft": "#fef3f2",
} as const;

// Apple Mail and iOS load the brand faces; Gmail and Outlook ignore the link
// and fall back down these stacks, which end on system faces of similar build.
export const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600&family=Hanken+Grotesk:wght@400;600&display=swap";

export const emailTailwind: TailwindConfig = {
  // rem → px: several clients size rem against their own chrome.
  presets: [pixelBasedPreset],
  theme: {
    extend: {
      colors,
      fontFamily: {
        display: [
          "'Bricolage Grotesque'",
          "'Hanken Grotesk'",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
        sans: [
          "'Hanken Grotesk'",
          "-apple-system",
          "'Segoe UI'",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        chip: "10px",
        bubble: "18px",
        card: "24px",
        panel: "28px",
      },
    },
  },
};
