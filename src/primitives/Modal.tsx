"use client";

import { X } from "@phosphor-icons/react/dist/ssr";
import { Dialog } from "radix-ui";
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

import { cn } from "@/utils/cn";

/*
 * Modal: a compound wrapper over Radix Dialog, same shape as strive's
 * (Modal / Modal.Button / Modal.Portal / Modal.Content / Modal.Title /
 * Modal.Close), restyled to DESIGN.md.
 *
 * Phone first: below 640px the content is a bottom sheet that rises from the
 * edge; from 640px it is a centred panel. Enter and exit are CSS keyframes on
 * `data-state` (tokens in globals.css). Radix keeps the element mounted until
 * the exit animation ends, so no Framer Motion is needed, and the global
 * reduced-motion rule reaches it.
 *
 * The overlay wraps the content (Radix's scrollable-overlay pattern), so a
 * tall form scrolls inside the backdrop instead of overflowing the viewport.
 */

interface ModalProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
}

function Modal({ open, onOpenChange, defaultOpen, children }: ModalProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      defaultOpen={defaultOpen}
    >
      {children}
    </Dialog.Root>
  );
}

function ModalPortal({
  children,
  className,
  container,
}: {
  children: ReactNode;
  className?: string;
  container?: HTMLElement | null;
}) {
  return (
    <Dialog.Portal container={container}>
      <Dialog.Overlay
        className={cn(
          "bg-ink/40 fixed inset-0 z-50 grid items-end overflow-y-auto overscroll-contain backdrop-blur-[2px] sm:place-items-center sm:p-6",
          "data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in",
          className,
        )}
      >
        {children}
      </Dialog.Overlay>
    </Dialog.Portal>
  );
}

const ModalContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof Dialog.Content>
>(({ className, children, ...props }, ref) => (
  <Dialog.Content
    ref={ref}
    className={cn(
      "bg-canvas shadow-float rounded-t-panel relative w-full px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] focus-visible:outline-none",
      "data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in",
      "sm:rounded-panel sm:max-w-[480px] sm:p-7",
      "sm:data-[state=closed]:animate-pop-out sm:data-[state=open]:animate-pop-in",
      className,
    )}
    {...props}
  >
    {children}
  </Dialog.Content>
));
ModalContent.displayName = "ModalContent";

const ModalTitle = forwardRef<
  HTMLHeadingElement,
  ComponentPropsWithoutRef<typeof Dialog.Title>
>(({ className, ...props }, ref) => (
  <Dialog.Title
    ref={ref}
    className={cn(
      "font-display pr-10 text-[22px] leading-[1.2] font-medium tracking-[-0.02em] text-balance",
      className,
    )}
    {...props}
  />
));
ModalTitle.displayName = "ModalTitle";

const ModalDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithoutRef<typeof Dialog.Description>
>(({ className, ...props }, ref) => (
  <Dialog.Description
    ref={ref}
    className={cn("text-muted mt-1.5 text-[15px] text-pretty", className)}
    {...props}
  />
));
ModalDescription.displayName = "ModalDescription";

/** The round close button pinned to the top-right corner of the content. */
function ModalDismiss({ label = "Close" }: { label?: string }) {
  return (
    <Dialog.Close
      aria-label={label}
      className="bg-surface text-ink-2 ease-out-expo hover:text-ink absolute top-4 right-4 grid size-9 cursor-pointer place-items-center rounded-full transition-[color,scale] duration-150 motion-safe:active:scale-[0.96] sm:top-5 sm:right-5"
    >
      <X className="size-4" weight="bold" />
    </Dialog.Close>
  );
}

/** The sheet's grab handle, phone only. Decorative. */
function ModalHandle() {
  return (
    <span
      aria-hidden="true"
      className="bg-line absolute top-2 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full sm:hidden"
    />
  );
}

Modal.Button = Dialog.Trigger;
Modal.Portal = ModalPortal;
Modal.Content = ModalContent;
Modal.Title = ModalTitle;
Modal.Description = ModalDescription;
Modal.Close = Dialog.Close;
Modal.Dismiss = ModalDismiss;
Modal.Handle = ModalHandle;

export { Modal };
