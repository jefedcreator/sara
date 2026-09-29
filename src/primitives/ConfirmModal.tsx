"use client";

import type { ReactNode } from "react";

import { Button } from "./Button";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  tone?: "danger" | "default";
}

/** A yes/no question built on Modal. Cancel stays the easy, first choice. */
export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  isPending = false,
  tone = "default",
}: ConfirmModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <Modal.Portal>
        <Modal.Content>
          <Modal.Handle />
          <Modal.Title>{title}</Modal.Title>
          <Modal.Description>{description}</Modal.Description>
          <div className="mt-7 grid gap-2.5 sm:flex sm:flex-row-reverse">
            <Button
              variant={tone === "danger" ? "danger" : "dark"}
              onClick={onConfirm}
              isLoading={isPending}
            >
              {confirmLabel}
            </Button>
            <Modal.Close asChild>
              <Button variant="secondary">Cancel</Button>
            </Modal.Close>
          </div>
        </Modal.Content>
      </Modal.Portal>
    </Modal>
  );
}
