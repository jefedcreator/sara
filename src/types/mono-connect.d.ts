/**
 * Minimal type declarations for @mono.co/connect.js v2.
 * The package ships no TypeScript types; these cover the public API we use.
 */
declare module "@mono.co/connect.js" {
  export type MonoConnectSuccessData = {
    code: string;
  };

  export type MonoConnectOptions = {
    /** Your Mono public key (client ID from the Mono dashboard) */
    key: string;
    /**
     * Called when the user successfully links a bank account.
     * `code` is a one-time auth token — exchange it server-side for a permanent account ID.
     */
    onSuccess: (data: MonoConnectSuccessData) => void;
    /** Called when the user closes the widget without completing */
    onClose?: () => void;
    /** Called for widget lifecycle events (e.g. LOADED, OPENED) */
    onEvent?: (eventName: string, data: unknown) => void;
  };

  export default class Connect {
    constructor(options: MonoConnectOptions);
    /** Injects the widget iframe into the DOM and registers message listeners */
    setup(): void;
    /** Opens (shows) the widget modal */
    open(): void;
    /** Closes (hides) the widget modal */
    close(): void;
  }
}
