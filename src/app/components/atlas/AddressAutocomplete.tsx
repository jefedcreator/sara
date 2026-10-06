"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import type { AtlasGeocodeResult } from "types/atlas";

// ---------------------------------------------------------------------------
// AddressAutocomplete — Typeahead address input powered by Atlas geocoding
//
// As the user types, this component debounces the input and queries
// GET /api/atlas/geocode?q=… . The user picks an address from the dropdown,
// and `onSelect` fires with the full geocode result (including lat/lon).
// ---------------------------------------------------------------------------

interface AddressAutocompleteProps {
  /** Label shown above the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Called when the user picks an address from the dropdown */
  onSelect: (result: AtlasGeocodeResult) => void;
  /** Optional initial value for the input */
  defaultValue?: string;
  /** Additional CSS classes for the outer wrapper */
  className?: string;
  /** Input id attribute for form accessibility */
  id?: string;
}

export default function AddressAutocomplete({
  label = "Address",
  placeholder = "Start typing an address in Lagos…",
  onSelect,
  defaultValue = "",
  className = "",
  id = "address-autocomplete",
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState(defaultValue);
  const [results, setResults] = useState<AtlasGeocodeResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const cleanupPendingWork = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const rootRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) cleanupPendingWork();
    },
    [cleanupPendingWork],
  );

  // ── Fetch suggestions ─────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (q: string) => {
    abortRef.current?.abort();

    const trimmed = q.trim();
    if (trimmed.length < 3) {
      setResults([]);
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);

    try {
      const res = await fetch(
        `/api/atlas/geocode?q=${encodeURIComponent(trimmed)}&limit=5`,
        { signal: controller.signal },
      );
      const json = (await res.json()) as { data?: AtlasGeocodeResult[] };
      const data: AtlasGeocodeResult[] = json.data ?? [];
      if (controller.signal.aborted) return;
      setResults(data);
      setIsOpen(data.length > 0);
      setSelectedIndex(-1);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setResults([]);
      setIsOpen(false);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  // ── Debounced input handler ───────────────────────────────────────────
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchSuggestions(value);
    }, 300);
  };

  // ── Keyboard navigation ───────────────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && selectedIndex >= 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]!);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  // ── Selection handler ─────────────────────────────────────────────────
  const handleSelect = (result: AtlasGeocodeResult) => {
    cleanupPendingWork();
    const displayName = formatAddress(result);
    setQuery(displayName);
    setIsOpen(false);
    setResults([]);
    onSelect(result);
  };

  const handleBlur = (e: FocusEvent<HTMLDivElement>) => {
    const nextTarget = e.relatedTarget;
    if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
      setIsOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      onBlurCapture={handleBlur}
      className={`relative ${className}`}
    >
      {label && (
        <label
          htmlFor={id}
          className="text-ink mb-1.5 block text-sm font-semibold"
        >
          {label}
        </label>
      )}

      <div className="relative">
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setIsOpen(true)}
          placeholder={placeholder}
          className="rounded-chip border-line bg-canvas text-ink ease-out-expo placeholder:text-muted focus:border-accent-ink focus:ring-accent-tint h-11 w-full border pr-10 pl-3.5 text-[15px] transition duration-200 outline-none focus:ring-3"
        />

        {isLoading && (
          <div className="absolute top-1/2 right-3 -translate-y-1/2">
            <div className="border-line border-t-accent-ink h-4 w-4 animate-spin rounded-full border-2" />
          </div>
        )}

        {/* Search icon when not loading */}
        {!isLoading && (
          <svg
            className="text-muted pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
        )}
      </div>

      {/* ── Dropdown ───────────────────────────────────────────────────── */}
      {isOpen && (
        <ul className="rounded-card border-line bg-canvas shadow-lift absolute z-50 mt-1.5 max-h-60 w-full overflow-auto border py-1.5">
          {results.map((result, i) => (
            <li key={`${result.lat}-${result.lon}-${i}`}>
              <button
                type="button"
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition ${
                  i === selectedIndex
                    ? "bg-accent-soft text-accent-ink"
                    : "text-ink hover:bg-surface"
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSelect(result)}
              >
                {/* Pin icon */}
                <svg
                  className="text-accent-ink mt-0.5 h-4 w-4 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
                  />
                </svg>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{result.name}</p>
                  {result.address && (
                    <p className="text-muted truncate text-xs">
                      {[
                        result.address.street,
                        result.address.city,
                        result.address.region,
                        result.address.country,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatAddress(result: AtlasGeocodeResult): string {
  if (result.address) {
    return [
      result.name,
      result.address.street,
      result.address.city,
      result.address.region,
    ]
      .filter(Boolean)
      .join(", ");
  }
  return result.name;
}
