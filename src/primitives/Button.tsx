import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

import { Spinner } from "./Spinner";

/*
 * Buttons from DESIGN.md: full pills. One primary (green fill, green-ink text)
 * per view; secondary is white with a hairline; dark is the compact utility.
 * Disabled is leaf grey and never green. The transition list names `scale`
 * because Tailwind v4 emits it as its own property.
 */
const buttonVariants = cva(
  "group/btn inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap no-underline transition-[background-color,border-color,color,scale] duration-200 ease-out-expo active:scale-98 disabled:cursor-not-allowed disabled:border-transparent disabled:bg-surface disabled:text-faint disabled:shadow-none disabled:active:scale-100 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent hover:bg-accent-hover",
        secondary: "border border-line bg-canvas text-ink hover:border-ink",
        dark: "bg-ink text-canvas hover:bg-accent-ink",
        ghost: "text-ink-2 hover:bg-surface hover:text-ink",
        danger: "bg-danger text-canvas hover:bg-danger/90",
      },
      size: {
        sm: "h-10 px-[18px] text-sm",
        md: "h-12 px-[22px] text-[15px]",
        lg: "h-14 px-[22px] text-[17px] shadow-cta disabled:shadow-none",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Shows a spinner and blocks presses while a request is in flight. */
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      isLoading = false,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    if (asChild) {
      return (
        <Slot.Root ref={ref} className={classes} {...props}>
          {children}
        </Slot.Root>
      );
    }

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={classes}
        disabled={disabled ?? isLoading}
        aria-busy={isLoading || undefined}
        {...props}
      >
        {isLoading ? <Spinner /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

/**
 * The white arrow disc that closes a primary button (DESIGN.md: padding
 * "0 8px 0 22px"), so give the button `pr-2` when using it.
 */
function ArrowDisc() {
  return (
    <span
      className="bg-canvas grid size-10 place-items-center rounded-full"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 16 16"
        className="stroke-accent-ink ease-out-expo size-4 transition-transform duration-300 group-hover/btn:translate-x-0.5"
        fill="none"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
      </svg>
    </span>
  );
}

export { ArrowDisc, Button, buttonVariants };
