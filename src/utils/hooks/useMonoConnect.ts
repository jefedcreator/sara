"use client";

import { useCallback, useRef, useState } from "react";

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Keep a stable ref to the Connect instance so it isn't recreated on re-renders
  const connectRef = useRef<import("@mono.co/connect.js").default | null>(null);
  const connectKeyRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);
  const requestIdRef = useRef(0);

  // Keep stable callback refs so the widget always calls the latest handlers.
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  const onEventRef = useRef(onEvent);
  onSuccessRef.current = onSuccess;
  onCloseRef.current = onClose;
  onEventRef.current = onEvent;

  const open = useCallback(() => {
    if (!publicKey) {
      setError(new Error("Mono public key is missing"));
      return;
    }

    if (isLoadingRef.current) return;

    if (connectRef.current && connectKeyRef.current === publicKey) {
      connectRef.current.open();
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    isLoadingRef.current = true;
    setIsLoading(true);
    setError(null);

    const initAndOpen = async () => {
      try {
        // Dynamic import prevents SSR errors — the SDK manipulates window/document directly.
        const { default: Connect } = await import("@mono.co/connect.js");
        if (requestIdRef.current !== requestId) return;

        connectRef.current?.close();
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
        connectKeyRef.current = publicKey;
        instance.open();
      } catch (err) {
        setError(
          err instanceof Error
            ? err
            : new Error("Failed to initialise Mono Connect"),
        );
      } finally {
        if (requestIdRef.current === requestId) {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    };

    void initAndOpen();
  }, [publicKey]);

  return { open, isLoading, error };
}
