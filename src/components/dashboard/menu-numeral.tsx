/** The chat menu's green numeral, tying each dashboard part to its chat reply. */
export function MenuNumeral({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="bg-accent text-on-accent grid size-8 shrink-0 place-items-center rounded-full text-[15px] leading-none font-bold"
    >
      {n}
    </span>
  );
}
