import { Minus, Plus } from "@phosphor-icons/react/dist/ssr";

const STEP =
  "bg-surface text-ink grid size-11 cursor-pointer place-items-center rounded-full transition-[background-color,scale] duration-200 ease-out-expo hover:bg-line active:scale-96 disabled:cursor-default disabled:text-faint disabled:hover:bg-surface disabled:active:scale-100";

interface DayCountStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** "day" / "days" for a count. */
  noun: (n: number) => string;
}

/** − 2 days + . */
export function DayCountStepper({ value, min, max, onChange, noun }: DayCountStepperProps) {
  return (
    <div className="border-line flex items-center justify-between rounded-full border p-1.5">
      <button type="button" className={STEP} aria-label="One day fewer" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus size={18} weight="bold" aria-hidden="true" />
      </button>
      <p className="text-[17px] font-semibold" aria-live="polite">
        {value} {noun(value)}
      </p>
      <button type="button" className={STEP} aria-label="One day more" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus size={18} weight="bold" aria-hidden="true" />
      </button>
    </div>
  );
}
