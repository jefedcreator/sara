/**
 * Strips the legacy Facebook/Instagram OAuth redirect fragment (`#_=_` or `#_`)
 * from the browser's address bar without triggering a reload or polluting history.
 */
export function cleanAuthFragment(
  win?: {
    location: { hash: string; pathname: string; search: string };
    history: { replaceState: (data: unknown, unused: string, url: string) => void };
  },
) {
  const target = win ?? (typeof window !== "undefined" ? window : undefined);
  if (!target?.location || !target?.history) return;

  if (target.location.hash === "#_=_" || target.location.hash === "#_") {
    target.history.replaceState(
      null,
      "",
      target.location.pathname + target.location.search,
    );
  }
}

/**
 * Inline script executed in <head> before page render and React hydration,
 * ensuring freshly logged in users never see the `#_=_` fragment in the address bar.
 */
export const CLEAN_AUTH_FRAGMENT_SCRIPT = `(function(){if(window.location.hash==='#_=_'||window.location.hash==='#_'){history.replaceState(null,'',window.location.pathname+window.location.search);}})();`;

