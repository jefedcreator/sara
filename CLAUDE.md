# CLAUDE.md

Instructions for Claude Code when working in this repository.

## Commit messages

- Never add "Co-Authored-By: Claude" or any variation of it (e.g. "Co-authored-by: Claude Code", "Generated with Claude Code", etc.) to commit messages.

## Task planning

- Break down every task into a todo list before starting work.
- If a task's todo list has more than one item, commit the work to git with an appropriate commit message upon completion of the task.

## Design language

- All UI (app and marketing) follows `DESIGN.md`, derived from `landing/v1/impeccable` (Clean Minimal SaaS). Read it before building or changing any screen.
- Always style with Tailwind utility classes in `className`. No CSS modules, component stylesheets or inline `style` for design values; `src/styles/globals.css` holds only `@theme` tokens and base defaults. Use `cn()` from `@/utils/cn` to compose classes.
- Use the Tailwind tokens defined in `src/styles/globals.css` (`bg-canvas`, `text-ink`, `bg-accent text-on-accent`, `text-accent-ink`, `rounded-panel`, `shadow-float`, `font-display`, ...). Do not hard-code colours or reintroduce the old zinc/emerald dark styling.
- WhatsApp green (`accent`) is a fill only, with `on-accent` text on it; green text or icons on white use `accent-ink`.
