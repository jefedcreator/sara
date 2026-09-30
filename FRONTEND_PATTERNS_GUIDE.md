# Frontend Patterns Guide

This document captures the frontend conventions established in this codebase (Next.js App Router). It's meant to be a portable reference — apply these patterns to any new Next.js project to keep architecture, naming, and data-flow consistent across the org.

---

## 1. Stack

```
next                     ^15   App Router, RSC by default
react                    ^19
typescript               ^5.8  strict, noUncheckedIndexedAccess, checkJs
tailwindcss              v4    tokens in `@theme static` in src/styles/globals.css;
                               there is no tailwind.config.ts
@tailwindcss/postcss     ^4    the v4 build step (+ tw-animate-css for shadcn's
                               animation utilities)
shadcn/ui                      CLI only, never a runtime dependency. v4 mode,
                               CSS variables, generates into src/primitives
radix-ui                 ^1.6  the unified package: `import { Slot } from "radix-ui"`.
                               The scoped `@radix-ui/react-*` packages exist only as
                               its transitive deps — never add one directly.
framer-motion            ^13   animation & microinteractions
next-themes              ^0.4  SSR-safe, flash-free dark mode provider (`data-theme` attribute)
@tanstack/react-query    ^5    client caching, background refetching, mutations
axios                    ^1    typed HTTP client with centralized interceptors
class-variance-authority ^0.7  (cva) + tailwind-merge ^3 + clsx ^2 — variant-driven styling
@phosphor-icons/react    ^2    the icon set (see §4)
@t3-oss/env-nextjs       ^0.12 typed, validated env vars
prisma / @prisma/client  ^6    database
zod                      ^3    validation
react-hook-form          ^7    uncontrolled forms (see §7)
@hookform/resolvers      ^5    bridges a Zod schema into `useForm`
vitest                   ^4    tests (`yarn test` → `vitest run`)
```

**Aspirational, not yet installed:** `zustand`, `nuqs`, `next-auth`, `sonner`. Sections 7, 9, 10 describe the intended patterns for these.

---

## 2. Project structure

```
src/
├── app/                      ← App Router routes ONLY (pages, layouts, route handlers)
│   ├── (app)/                ← route group: the authenticated app surfaces
│   │   ├── layout.tsx        ← the wash, and nothing else (see below)
│   │   ├── dashboard/page.tsx
│   │   ├── day/page.tsx
│   │   ├── mock/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   └── progress/page.tsx
│   ├── profile/              ← /profile (owner, authed) & /profile/[handle] (public, reached via /@handle rewrite outside auth)
│   ├── (general)/            ← route group: public/marketing/auth pages
│   └── api/                  ← Route Handlers, mirrors the resource tree
│       ├── attempts/route.ts
│       ├── day/
│       │   ├── route.ts
│       │   ├── blocks/route.ts
│       │   └── complete/route.ts
│       ├── mock/
│       │   ├── route.ts
│       │   └── [id]/
│       │       ├── complete/route.ts
│       │       └── submit/route.ts
│       ├── progress/route.ts
│       └── reviews/route.ts
│
├── backend/                  ← server-only application logic (never imported client-side)
│   ├── validators/           ← Zod schemas, one file per resource: `[resource].validator.ts`
│   ├── services/             ← integrations & business logic, one folder per service
│   ├── middleware/           ← composable route-handler middleware
│   └── cron/                 ← scheduled jobs
│
├── server/                   ← server-side data-fetch layer consumed by Server Components
│   ├── index.ts              ← re-exports typed fetch wrappers (getDay, getProgress, getMockHistory, getMockFormats, getDayIndex)
│   ├── day.ts
│   ├── mock.ts               ← also getMockFormats: the assembler's blueprint + a bank count
│   ├── progress.ts
│   └── stamp.ts              ← getDayIndex, one count, for the topbar's day stamp alone
│
├── components/                ← "smart" feature components (kebab-case files)
│   ├── app-nav.ts             ← the five destinations, shared by both chromes, plus hasAppChrome
│   ├── app-topbar.tsx         ← 'use client' — wordmark, ink pill nav, day stamp
│   ├── app-rail.tsx           ← 'use client' — the floating icon rail (≥1181px only)
│   ├── app-chrome.tsx         ← 'use client' — rail + shell + topbar; mounted BY THE LAYOUT, never a page
│   ├── app-close.tsx          ← the band that restates the primary action at the foot
│   ├── app-error.tsx          ← the fallback when a surface's data will not load
│   ├── app-skeleton.tsx       ← what every (app) loading.tsx is built from
│   ├── theme-toggle.tsx       ← 'use client' — next-themes toggle with Framer Motion icon swap
│   ├── dashboard/             ← dashboard-client.tsx, programme-board.tsx
│   ├── day/                   ← day-page-client.tsx, day-spine.tsx, day-aside.tsx, day-recaps.tsx, blocks/
│   ├── mock/                  ← mock-hub-client.tsx, mock-session-client.tsx, mock-score-report.tsx, mock-attempt-row.tsx
│   ├── progress/              ← progress-page-client.tsx
│   ├── exercises/             ← the four renderers plus parts.tsx (the shared frame, options, feedback)
│   └── landing/               ← marketing sections of `/`: hero, strip, track, method, exam, etc.
│
├── primitives/                ← "dumb" reusable UI building blocks (design system layer)
│   ├── index.ts               ← barrel export for the folder — hand-built and generated alike
│   ├── Meta.tsx, Shell.tsx, Stat.tsx, Surface.tsx, FadeIn.tsx   ← hand-built, PascalCase
│   ├── Card.tsx, KeyValue.tsx, Notice.tsx, Chip.tsx,            ← the pale-wash-glass set
│   │   Body.tsx, EmptyState.tsx                                    (see DESIGN_SYSTEM §4)
│   └── button.tsx, accordion.tsx                                ← shadcn/ui-generated, kebab-case
│
├── hooks/                     ← TanStack Query hooks & mutations (`use-*.ts`)
│   ├── queries/               ← `use-day.ts`, `use-progress.ts`, `use-mock.ts`
│   └── mutations/             ← `use-day-mutations.ts`, `use-mock-mutations.ts`
│
├── provider/                  ← app-wide context providers (QueryProvider, ThemeProvider)
│   ├── index.tsx              ← unified root Provider wrapper
│   ├── query-provider.tsx     ← SSR-safe QueryClient singleton provider
│   └── theme-provider.tsx     ← next-themes ThemeProvider wrapper
│
├── types/                     ← shared TS types/interfaces (DTOs, contract.ts)
├── utils/                     ← pure helpers, `cn`, `axios.ts`, `api.ts`, theme constants
└── styles/                    ← globals.css, CSS custom properties
```

### Rules of thumb

- **`app/`** contains _only_ routing concerns: a Server Component `page.tsx` that fetches data and renders one client component. Business logic never lives in `page.tsx`.
- **`server/`** vs **`backend/`**: `server/` is the _consumer-facing_ fetch layer used by Server Components (thin wrappers around `fetch` with fallbacks). `backend/` is where the actual API logic, validators, and services live, imported only from Route Handlers.
- Each route folder gets its own `loading.tsx` — Next's built-in Suspense boundary, styled as a skeleton matching the eventual layout. The `(app)` ones are built from `app-skeleton.tsx` and draw **the page body alone**: the chrome is mounted by the layout and stays standing while the page suspends, so a skeleton that redrew it would replace a live pill nav with a dead copy of itself for the length of the fetch.
- **`(app)/layout.tsx` mounts the wash _and the chrome_.** The rail, pill nav and day stamp come from `AppChrome`, mounted once by the layout and **never composed by a page**. This is not a style choice: only a layout survives a route change, so chrome rendered from a page is unmounted and rebuilt on every navigation — replaying its entrance animation, dropping whatever `AccountMenu` held open, and mounting the nav three times per move once `loading.tsx` draws its own copy. Mounted from the layout it persists, and only its own UI state — the current marker, read from `usePathname` — changes.
- **The one route without chrome opts out from inside `AppChrome`, on the client.** `/mock/[id]` renders a running exam section, and an app navigation across the top of one is an exit the real test does not offer. `hasAppChrome(pathname)` in `app-nav.ts` is that rule. It is read from `usePathname` rather than from a middleware header because a shared layout is _not_ re-rendered when the reader moves between its own children — a server-side branch there would only ever update on a full page load.
- **The day stamp is read once, by the layout**, via `getDayIndex()` — one `count`. Pages no longer fetch it, and no longer pass it anywhere. Because the layout is not re-rendered between its children, that is one query per visit rather than one per navigation; the tradeoff is that a day rolling over mid-visit shows on the next full load. The layout catches its own failure and passes `dayIndex: null` (the stamp is dropped, not guessed), because `error.tsx` sits _below_ the layout and cannot catch what the layout itself throws.
- **`(app)/template.tsx` wraps the page body only.** Next renders `layout > template > page`, so the chrome above is outside the template's remount-per-navigation and does not re-animate with the content. It is a **Server Component**: the entrance is the `.app-enter` CSS class, not Framer Motion, so no client bundle is paid for it on any `(app)` route. See §11 for why that animation is CSS.
- A **feature** (e.g. "mock", "progress", "day") owns one `*-page-client.tsx` that composes queries (`useProgressQuery`), mutation hooks (`useSubmitAnswerMutation`), and user interaction. Presentational pieces stay dumb and receive props/callbacks only.
- **`primitives/`** is the design-system layer and holds two kinds of file side by side: hand-built PascalCase primitives (`Shell`, `Meta`, `Surface`, `Stat`, `FadeIn`) and shadcn/ui-generated kebab-case ones (`button`, `accordion`). `components.json` points the CLI at it (`"ui": "@/primitives"`), so `npx shadcn@latest add …` writes there directly — no relocation step. Both kinds are re-exported from `primitives/index.ts`; feature code imports from `@/primitives`.

---

## 3. Naming conventions

| What                                     | Convention                                                                                | Example                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Feature components (`src/components`)    | kebab-case file, PascalCase export                                                        | `mock-hub-client.tsx` → `export function MockHubClient` |
| Hand-built primitives (`src/primitives`) | PascalCase file **matching** the export                                                   | `Surface.tsx` → `export function Surface`               |
| shadcn/ui-generated primitives           | kebab-case, lowercase — the _filename_ is left as scaffolded, the styling is not (see §5) | `button.tsx`, `accordion.tsx`                           |
| Query / Mutation Hooks                   | kebab-case filename prefixed with `use-`, camelCase export                                | `use-progress.ts` → `useProgressQuery`                  |
| Zod validators                           | `[resource].validator.ts`, schema var `xValidatorSchema`, type `XValidatorSchema`         | `day.validator.ts` → `patchBlockValidatorSchema`        |
| Types                                    | PascalCase interfaces/types in `src/types/index.ts`, or colocated `*.types.ts`            | `GetDaySessionResponseData`, `ProgressResponseData`     |
| API route folders                        | mirror the REST resource path exactly                                                     | `api/mock/[id]/submit/route.ts`                         |
| Query keys                               | factory object with `all`, `lists()`, `detail(id)`                                        | `progressKeys.all`, `mockKeys.detail(id)`               |

**Barrel files**: `src/primitives/index.ts`, `src/utils/index.ts`, `src/provider/index.tsx` re-export the public surface of that folder — import from the barrel (`@/primitives`, `@/utils`, `@/provider`) in feature code.

**Path alias**: `@/*` → `src/*` (configured in `tsconfig.json`). Never use deep relative imports (`../../../`) across feature boundaries.

---

## 4. Iconography

- **The icon set is `@phosphor-icons/react`** — the only one installed. There is no `lucide-react` and no `react-icons` in this project.
- **Runtime icons always come from the SSR entry**, in Server _and_ Client Components alike:
  `import { ArrowRight, Moon, Sun, Exam } from "@phosphor-icons/react/dist/ssr"`. Every runtime icon import in `src/` uses this path. Don't import runtime icons from the package root.
- **The package root is for the `Icon` type only**, because the ssr entry doesn't export it: `import type { Icon } from "@phosphor-icons/react"`.
- Weight is a prop (`weight="bold"` / `weight="fill"`).
- Icons are sized with Tailwind (`className="size-4"`), never hand-rolled SVG per component.

---

## 5. Styling & Dark Mode

### Tailwind v4

Tokens live in `@theme static` in `src/styles/globals.css` — there is no `tailwind.config.ts` and one must not be added. Reference tokens (`bg-bone`, `text-ink-2`, `border-rule`, `text-h1`, `rounded-surface`), never raw hex.

- `static` is load-bearing: without it Tailwind only emits the tokens it saw used, and dark mode overrides these variables at runtime.

### Dark Mode Architecture with `next-themes`

Dark mode is **attribute-driven** via `next-themes` using `data-theme="dark"` / `data-theme="light"`:

1. **Provider Setup (`src/provider/theme-provider.tsx` & `src/provider/index.tsx`):**

   ```tsx
   // src/provider/theme-provider.tsx
   "use client";
   import {
     ThemeProvider as NextThemesProvider,
     type ThemeProviderProps,
   } from "next-themes";

   export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
     return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
   }

   // src/provider/index.tsx
   export function Provider({ children }: { children: ReactNode }) {
     return (
       <QueryProvider>
         <ThemeProvider
           attribute="data-theme"
           defaultTheme="system"
           enableSystem
           disableTransitionOnChange
         >
           {children}
         </ThemeProvider>
       </QueryProvider>
     );
   }
   ```

2. **Root Layout (`src/app/layout.tsx`):**
   - Add `suppressHydrationWarning` to `<html lang="en">` so `next-themes` can set the attribute without React hydration warnings.
   - `next-themes` automatically injects its pre-paint script, eliminating flash of unstyled theme (FOUC).

3. **Theme Toggle Component (`src/components/theme-toggle.tsx`):**
   - Consumes `useTheme()` from `next-themes` (`resolvedTheme`, `setTheme`).
   - Uses `mounted` state guard to avoid SSR/hydration markup mismatch.
   - Cross-fades the sun/moon icons with `AnimatePresence`. The two icons are
     **absolutely positioned on top of each other** so they overlap during the swap and
     the blur bridges them into one shape resolving — rather than `mode="wait"` sliding
     one out before the other arrives, which reads as two icons trading places.

   Read the live file for the whole component; this is the part that matters:

   ```tsx
   // Reduced motion keeps the opacity fade — it is what makes the change legible —
   // and drops the scale and blur. Safe to branch on because every render before
   // `mounted` returns the placeholder, so server and first client render agree.
   let enter: TargetAndTransition = ICON_ENTER;
   let exit: TargetAndTransition = ICON_EXIT;
   let transition: Transition = ICON_SPRING;
   if (reduceMotion) {
     enter = ICON_ENTER_REDUCED;
     exit = ICON_EXIT_REDUCED;
     transition = ICON_FADE;
   }

   <AnimatePresence initial={false}>
     <motion.span
       key={isDark ? "dark" : "light"}
       initial={exit}
       animate={enter}
       exit={exit}
       transition={transition}
       className="absolute inset-0 grid place-items-center"
     >
       {isDark ? <Moon className="size-4" weight="bold" /> : <Sun className="size-4" weight="bold" />}
     </motion.span>
   </AnimatePresence>
   ```

   The animation values (`scale` `0.25`→`1`, `opacity` `0`→`1`, `filter`
   `blur(4px)`→`blur(0px)`, spring with `bounce: 0`) are the contextual-icon rule — see
   `DESIGN_SYSTEM.md` §6. The `if` rather than a conditional spread is the project rule
   in `CLAUDE.md`.

   > `disableTransitionOnChange` on the provider above is load-bearing and easy to
   > delete by accident. A theme flip changes colour, background, border and shadow on
   > nearly every element at once; without it every one of those transitions fires
   > together and the switch smears instead of snapping. `next-themes` implements the
   > suppress → reflow → restore dance for us.

4. **CSS Palette Specificity:**
   In `src/styles/globals.css`, the palette flips in two places, with load-bearing order:
   - `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` first.
   - `:root[data-theme="dark"]` second.
   - `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` binds Tailwind's `dark:` modifier to the attribute.

---

## 6. Component architecture: primitives vs. components

Two distinct layers, don't blur them:

1. **`primitives/`** — dumb, app-agnostic UI atoms. Either:
   - Hand-built (`Shell`, `Meta`, `Surface`, `Stat`, `FadeIn`), or
   - shadcn/ui-generated (`button.tsx`, `accordion.tsx`), kept at their scaffolded filename and API but restyled in place — see §5 on editing the existing `cva` call rather than wrapping it.
   - Never import `@tanstack/react-query` or feature types into `primitives/`.

2. **`components/`** — feature-aware, composed from primitives. The `*-page-client.tsx` pattern:
   - **Parent owns state**: query hooks (`useProgressQuery`), mutation hooks (`useCompleteDayMutation`), and local navigation live in the page-client component.
   - **Children are pure UI**: cards and sections receive data and callbacks as props.

---

## 7. Forms — React Hook Form + Zod

- Schema lives in `src/backend/validators/[resource].validator.ts`, always `.strict()`, exports both the schema and `z.infer` type from the same file.
- `useForm<FormValues>` where `FormValues = z.input<typeof schema>`.
- Create forms use `defaultValues`; edit forms use `values` (re-syncs when server data changes).
- Plain inputs use `register('field')` spread directly on the primitive (`<Input {...register('slug')} />`).
- `noValidate` on every form — validation is Zod's job, and the browser's native
  bubbles compete with the rendered field errors.
- `autoComplete="off"` on ordinary forms, **but not on auth forms**. `/login`
  and `/signup` set real tokens (`username`, `current-password`,
  `new-password`): suppressing password managers on a sign-in form is
  user-hostile and pushes people toward passwords weak enough to memorise.
- There is no `<Form>` primitive yet. Two auth forms did not justify inventing
  one; the third form is the moment to extract it. Until then a plain
  `<form noValidate onSubmit={handleSubmit(…)}>` is the pattern.

---

## 8. Data fetching — TanStack Query & Axios

Two distinct data paths:

### a. Initial/server-rendered data → `src/server/`

Server Components fetch through typed wrapper functions (`getDay`, `getProgress`, `getMockHistory`) that:

- Attach credentials/cookies server-side.
- Always `try/catch` and return a **typed empty-state fallback** on failure so pages degrade gracefully instead of throwing 500s.
- Are passed into the client component as `initialData`, which seeds `useQuery({ queryKey, queryFn, initialData })` — avoiding client refetch waterfalls on first paint.
- Are wrapped in React `cache()`. Per-request memoisation, not a persistent cache: a route reads the same wrapper twice — once in `generateMetadata`, once in the component — and must not pay for it twice. Next dedupes `fetch` automatically and nothing else, and these wrappers go straight to Prisma.

---

## 8b. Page metadata — described from the page's own service

Every route whose page calls a `src/server/` wrapper describes itself from **that same wrapper**, through `liveMetadata` in `src/utils/metadata.ts`. A hardcoded blurb is accurate about the route and silent about the page; `liveMetadata` says which day, which module, how many boards, whether the mock was scored.

```ts
export async function generateMetadata(): Promise<Metadata> {
  return liveMetadata(
    getDay,                                 // the page's own fetcher, cache()d
    (day) => ({                             // title + description ONLY
      title: `Day ${day.dayIndex} · ${day.lesson.moduleTitle}`,
      description: `...`,
    }),
    { title: "Today's session", cardTitle: "…", path: "/day", index: false },
  );
}
```

**The split is the rule, and the types enforce it.**

| Field | Where it goes | May carry live data |
| --- | --- | --- |
| `title`, `description` | the page's own HTML, served to the signed-in reader | **yes** |
| `cardTitle`, `eyebrow`, `tag` | the query string of an `/api/og` URL | **no** |

A card URL is fetched anonymously and cached indefinitely by every service a link is pasted into, so anything reaching it is published permanently to an audience the reader never chose. `liveMetadata` therefore takes a `describe` callback typed `LiveDescription` (`title` and `description`, nothing else) and **requires** a static `cardTitle` in the fallback — without which `pageMetadata` would silently fall back to `cardTitle ?? title` and carry the live title into the image URL.

Other rules:

- `liveMetadata` calls `unstable_rethrow` before its fallback, so `redirect()` from `requireCurrentUserId` and `notFound()` still work from inside `generateMetadata`.
- A failed read costs the page its live description and nothing else — the component's own `try/catch` still renders `AppError`.
- Refusals stay indistinguishable. `getBoard` returns null for both "no such board" and "not your board" (spec §6.1); the describer gives both the same generic text rather than rebuilding the enumeration oracle.
- `path` names the actual route, slug included, so the canonical and `og:url` point at the page rather than at its index.
- A page that calls no service keeps static `pageMetadata` — `/duels/[slug]`, which fetches client-side, is the only one.

### Shared links — a public page describes the resource

A link built to be sent to someone (`/cards/<slug>`, `/duels/<slug>`, `/@handle`, a study-group invite) is the one case where the card **does** carry live data, and it gets there a different way: a **public** page, outside the middleware's auth gate, whose `generateMetadata` reads the resource and points `og:image` at a **stateful** route under `/api/og/<resource>/` that reads the same row. The image is drawn from stored data rather than from query parameters, so a pasted link cannot be made to claim something about the resource that it does not lead to. The public design is shared through `src/app/api/og/house-card.tsx`.

- **What may be published is fixed by a DTO,** not by the page. `InvitePreviewDto` is the example: the group's name and counts, never a member — members agreed to be seen by the group, and the card is shown to whoever the link is pasted in front of.
- **A link that must stay at a gated address is rewritten, not redirected.** The invite link is `/leaderboards?invite=<token>`, which a signed-in reader follows to join. For a signed-out request the middleware rewrites it to the public `/invite/[token]` page instead of redirecting to `/login`. Signed out includes every link unfurler, so no user-agent list decides whether the card resolves.
- **A dead link stops describing the resource.** A rotated invite token gets a generic "no longer active" card, and its stateful image answers 404.
- The static cards the middleware serves to known bots for the gated `(app)` routes (`PROTECTED_BOT_METADATA`, rendered by `src/utils/bot-card.ts`) are for links that were never meant to be shared. They carry nothing live.

### b. Client-side mutations & live state → `@tanstack/react-query` + Axios

- **Centralized Axios Client (`src/utils/axios.ts`):** `baseURL: '/api'`, `withCredentials: true`, standard typed error handler.
- **Typed API methods (`src/utils/api.ts`):** `api.progress.get()`, `api.mock.start(format)`, `api.day.patchBlock(payload)`, etc.
- **Query Key Factories:**
  ```ts
  export const progressKeys = {
    all: ["progress"] as const,
    current: () => [...progressKeys.all, "current"] as const,
  };
  ```
- **Mutation Hooks (`src/hooks/mutations/`):**
  - Invalidate relevant query keys on `onSuccess` so server and client data stay synchronized:
  ```ts
  export function useCompleteDayMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: () => api.day.complete(),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: dayKeys.all });
        void queryClient.invalidateQueries({ queryKey: progressKeys.all });
      },
    });
  }
  ```

---

## 9. Client/global state — Zustand (Target Pattern)

Used sparingly for cross-tree client state seeded from the server (e.g. interactive multi-step runner state):

1. **Store factory** in `src/store/index.ts` — `createXStore(initState)` returns `createStore<XState>(...)` (SSR-safe per-request).
2. **Context provider** in `src/provider/store-provider.tsx` — creates store once per mount via `useRef`, seeds with server data.
3. Components consume via selector hooks: `const activeItem = useMockRunnerStore((s) => s.activeItem)`.

---

## 10. URL state — nuqs (Target Pattern)

Filters, tabs, and pagination that should survive a refresh/share live in the URL:

- Parser objects colocated in `src/utils/index.ts`.
- Read and update query states with `useQueryStates(params, { shallow: false, throttleMs: 500 })`.

---

## 11. Animation — CSS first, Framer Motion where it earns it

**The values** — every duration, curve, scale and blur — live in `DESIGN_SYSTEM.md` §2
and §6. This section is only about *which tool* animates a thing. Do not restate values
here; they drift.

### Choosing the tool

| | Use | Why |
| --- | --- | --- |
| Entrances that fire during navigation | **CSS** (`.app-enter`) | Runs off the main thread, which is busy mounting the route. A rAF-driven animation drops frames exactly there |
| Interactive state changes (hover, press, open/close) | **CSS transitions** | Interruptible — they retarget mid-flight. Keyframes restart from zero |
| Enter *and* exit of a mounting/unmounting element | **Framer Motion** (`AnimatePresence`) | CSS cannot animate an element that React has already removed |
| Staged one-shot sequences | CSS keyframes | Nothing to interrupt |

Reach for Framer Motion when you need exit animations, gesture/drag physics, or spring
interpolation. Reach for CSS otherwise — it is cheaper, it survives a failed bundle, and
it is the only one the global reduced-motion rule can reach.

### Layout-safe animations

Animate `transform`, `translate`, `scale` and `opacity`. Never `height`, `width`,
`padding` or `margin` — those trigger layout and paint on every frame.

### Two traps, both silent

1. **Arbitrary `transition-[…]` lists do not cover `translate` / `scale` / `rotate`.**
   Tailwind v4 emits those as standalone CSS properties, so naming `transform` misses
   them and the change snaps with no easing. The shorthand `transition-transform` is
   safe; the arbitrary-list form is not. See `DESIGN_SYSTEM.md` §7.2.
2. **Framer Motion is invisible to the reduced-motion rule.** The global
   `@media (prefers-reduced-motion: reduce)` block in `globals.css` sets
   `animation-duration` / `transition-duration`, which reaches CSS only. Framer writes
   inline styles from rAF and animates straight through it. Anything animated in JS must
   handle reduced motion itself — and per `DESIGN_SYSTEM.md` §7.3 that branch must not
   change render output before mount, or React 19 discards the server HTML.

### What exists today

- **`FadeIn`** (`@/primitives`) — the scroll reveal. Reduced motion is handled in CSS via
  `[data-fade-in]`, never in JS. There is no `FadeInStagger`; if you need one, build it
  rather than importing the name.
- **`.app-enter`** — the `(app)` page entrance, mounted by `(app)/template.tsx`.
- **`ThemeToggle`** — the reference for an icon cross-fade (§5).

---

## 11b. UI polish skills — `better-ui` and `emil-design-eng`

Two agent skills are installed project-level and encode the polish rules this codebase
is held to. They are the *source* of the conventions in `DESIGN_SYSTEM.md` §6 and §7.2 —
when they disagree with a component, the component is wrong.

### What's installed and where

```
.agents/skills/better-ui/          ← the skill files (tracked in git)
.agents/skills/emil-design-eng/
.claude/skills/                    ← symlinks into the above; how Claude Code sees them
skills-lock.json                   ← written at the repo root by the newer CLI
.agents/skills-lock.json           ← the older lockfile; holds a disjoint set
```

Installed with `npx skills add <repo> --skill <name> --agent claude-code --agent gemini-cli`.
Note the flag does **not** accept a comma-separated list — repeat it per agent. Gemini CLI
reads `.agents/skills/` directly (the "universal" location); Claude Code reads the
symlinks.

> **Two lockfiles now coexist.** The newer CLI writes `skills-lock.json` at the repo root
> rather than extending `.agents/skills-lock.json`, so each holds a different set of
> skills. Reconcile them before relying on `skills update`.

### What each one covers

| Skill | Scope |
| --- | --- |
| `better-ui` | Concentric radius, optical alignment, surface depth, contextual icon animation, press feedback, image outlines, icon stroke weight, theme-switch suppression. Ships reference files: `animations.md`, `icon-transitions.md`, `surfaces.md`, `icons.md`, `enter-exit.md`, `performance.md` |
| `emil-design-eng` | The animation decision framework (should this animate at all?), easing and duration choice, spring configuration, `clip-path` technique, gesture/drag physics, perceived performance |

They overlap and occasionally differ on a value — `better-ui` prescribes `scale(0.96)` on
press, `emil-design-eng` allows `0.95`–`0.98`. **`better-ui` wins on exact values**; it
states them as fixed, and `DESIGN_SYSTEM.md` records what we settled on.

### When to invoke them

Invoke before writing or reviewing any component, page or style — the same trigger as
reading `DESIGN_SYSTEM.md`. `emil-design-eng` first when the question is *whether and how*
something should animate; `better-ui` when the question is *what value* to use.

Both define a review output format (a `| Before | After | Why |` table, with severity and
a Block/Approve verdict in `better-ui`). Use it when reviewing — it is what makes findings
comparable across reviews.

### The division of labour

`DESIGN_SYSTEM.md` is canonical for this project and **wins over both skills** where they
conflict, because it records decisions made against real constraints here — tokens, the
`cta-fill` escape hatch, the `(app)` surfaces. The skills are the general rules; the
design system is the ruling. When a skill teaches something new, fold it into
`DESIGN_SYSTEM.md` rather than leaving the knowledge only in the skill.

---

## 12. Validation, types & backend boundary

- **Zod is the single source of truth** for server validation and payload contracts.
- **Compile-time contract proof (`src/types/contract.ts`):** Asserts type equality between service response types and documented API DTOs.
- Route Handlers are composed with `withMiddleware(handler, [authMiddleware, bodyValidatorMiddleware(schema), ...])`.

### What the client must expect from the API

- **Session cookie authentication:** `parcours_session` is `HttpOnly` and attached automatically via `withCredentials: true`.
- **`PATCH /api/day/blocks` can refuse `complete: true` with a `409`** when the block's work is incomplete.
- **`requested` vs `filled`** on practice and test slots is surfaced as an honest underfill indicator.
- **`GET /api/progress` returns `provisional` and `measured` scores separately** for all four skills.

---

## 13. Environment variables

- `@t3-oss/env-nextjs` + Zod schema in `src/env.js` — server vars and client vars (`NEXT_PUBLIC_*`) validated at build time.
- Always import `{ env } from '@/env'` instead of reading `process.env`.

---

## 14. Quick checklist: scaffolding a new feature

- [ ] Zod schema(s) in `src/backend/validators/[resource].validator.ts`
- [ ] Route Handler(s) in `src/app/api/[resource]/route.ts` composed via `withMiddleware`
- [ ] Fetch wrapper in `src/server/[resource].ts` (`get[Resource]`) with try/catch + typed fallback
- [ ] Shared response DTOs in `src/types/index.ts` verified by `src/types/contract.ts`
- [ ] Query key factory in `src/hooks/queries/use-[resource].ts`
- [ ] Mutation hook in `src/hooks/mutations/use-[resource]-mutations.ts` with cache invalidation
- [ ] `page.tsx` (Server Component): fetches initial data, passes as `initialData` prop
- [ ] `loading.tsx` skeleton matching layout
- [ ] `[resource]-page-client.tsx`: connects `useQuery(initialData)` and mutations
- [ ] Interactive controls verified under both light and dark themes with `ThemeToggle`
- [ ] Ran the polish pass: `emil-design-eng` for whether/how it animates, `better-ui` for the values (§11b)
- [ ] Every `transition-[…]` list names `translate` / `scale` / `rotate` if the element uses them (§11)
- [ ] Anything animated in JS handles reduced motion itself — the CSS rule cannot reach it (§11)
