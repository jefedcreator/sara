import { Check } from "@phosphor-icons/react/dist/ssr";

import { cn } from "@/utils/cn";

const STEPS = ["Sign in", "Set up your business", "Connect your chat"] as const;

/**
 * Where an owner is in getting their chat connected. `current` is the index
 * of the step on screen; earlier steps are done.
 */
export function SetupSteps({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Setup progress">
      {STEPS.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex items-center gap-2 text-sm font-semibold",
              active ? "text-ink" : "text-faint",
              done && "text-accent-ink",
            )}
          >
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs",
                done && "bg-accent-soft text-accent-ink",
                active && "bg-accent text-on-accent",
                !done && !active && "bg-surface text-faint",
              )}
              aria-hidden="true"
            >
              {done ? <Check className="size-3.5" weight="bold" /> : index + 1}
            </span>
            {label}
            {done ? <span className="sr-only">(done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
