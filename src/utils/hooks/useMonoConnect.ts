"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type MonoSuccessData = {
  code: string;
};

export type UseMonoConnectOptions = {
  /** Mono public key (client ID) from your Mono dashboard */
  publicKey: string;
  /**
   * Called when the user successfully links a bank account.
   * Receives the one-time auth code to exchange server-side for a permanent account ID.
   */
  onSuccess: (data: MonoSuccessData) => void;
  /** Called when the user closes the widget without completing */
  onClose?: () => void;
  /** Called for widget lifecycle events (OPENED, LOADED, etc.) */
  onEvent?: (eventName: string, data: unknown) => void;
};

export type UseMonoConnectReturn = {
  /** Opens the Mono Connect modal */
  open: () => void;
  /** True while the SDK is being loaded */
  isLoading: boolean;
  /** Any error that occurred during SDK initialisation */
  error: Error | null;
};

/**
 * Initialises the Mono Connect widget using @mono.co/connect.js.
 *
 * The SDK is dynamically imported (client-only) to avoid SSR issues.
 * The auth code is received via the onSuccess callback — not a URL redirect.
 *
 * @example
 * ```tsx
 * const { open, isLoading } = useMonoConnect({
 *   publicKey: "live_pk_...",
 *   onSuccess: ({ code }) => {
 *     // send code to your backend POST /api/business
 *     submitBusinessForm({ monoCode: code });
 *   },
 * });
 *
 * <button onClick={open} disabled={isLoading}>
 *   Link bank account
 * </button>
 * ```
 */
export function useMonoConnect({
  publicKey,
  onSuccess,
  onClose,
  onEvent,
}: UseMonoConnectOptions): UseMonoConnectReturn {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Keep a stable ref to the Connect instance so it isn't recreated on re-renders
  const connectRef = useRef<import("@mono.co/connect.js").default | null>(null);

  // Keep stable callback refs so the effect doesn't re-run when arrow functions are re-created
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!publicKey) {
      setIsLoading(false);
      return;
    }

    let mounted = true;

    const init = async () => {
      try {
        // Dynamic import prevents SSR errors — the SDK manipulates window/document directly
        const { default: Connect } = await import("@mono.co/connect.js");

        if (!mounted) return;

        const instance = new Connect({
          key: publicKey,
          onSuccess: (data: MonoSuccessData) => {
            onSuccessRef.current(data);
          },
          onClose: () => {
            onCloseRef.current?.();
          },
          onEvent: (eventName: string, data: unknown) => {
            onEventRef.current?.(eventName, data);
          },
        });

        instance.setup();
        connectRef.current = instance;
        setIsLoading(false);
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err
              : new Error("Failed to initialise Mono Connect"),
          );
          setIsLoading(false);
        }
      }
    };

    void init();

    return () => {
      mounted = false;
    };
  }, [publicKey]); // re-init only if the key changes

  const open = useCallback(() => {
    if (connectRef.current) {
      connectRef.current.open();
    } else {
      console.warn("useMonoConnect: widget is not ready yet");
    }
  }, []);

  return { open, isLoading, error };
}
