"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
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
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch suggestions ─────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(
        `/api/atlas/geocode?q=${encodeURIComponent(q)}&limit=5&country=NG`,
      );
      const json = await res.json();
      const data: AtlasGeocodeResult[] = json.data ?? [];
      setResults(data);
      setIsOpen(data.length > 0);
      setSelectedIndex(-1);
    } catch {
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Debounced input handler ───────────────────────────────────────────
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  // ── Keyboard navigation ───────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
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
    const displayName = formatAddress(result);
    setQuery(displayName);
    setIsOpen(false);
    setResults([]);
    onSelect(result);
  };

  // ── Close on outside click ────────────────────────────────────────────
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={wrapperRef} className={`relative ${className}`}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-sm font-medium text-zinc-300"
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
          className="w-full rounded-md border border-white/10 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/25"
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-emerald-400" />
          </div>
        )}

        {/* Search icon when not loading */}
        {!isLoading && (
          <svg
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
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
        <ul className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border border-white/10 bg-zinc-900 py-1 shadow-xl shadow-black/30 backdrop-blur-sm">
          {results.map((result, i) => (
            <li key={`${result.lat}-${result.lon}-${i}`}>
              <button
                type="button"
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition ${
                  i === selectedIndex
                    ? "bg-emerald-500/10 text-emerald-300"
                    : "text-zinc-300 hover:bg-white/5"
                }`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => handleSelect(result)}
              >
                {/* Pin icon */}
                <svg
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400/70"
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
                    <p className="truncate text-xs text-zinc-500">
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
