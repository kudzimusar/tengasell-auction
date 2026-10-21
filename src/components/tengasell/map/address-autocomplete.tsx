"use client";

// address-autocomplete.tsx — Photon-powered type-ahead address input.
// Debounced /api/geo/autocomplete with keyboard navigation and 44px rows;
// selection resolves to a typed GeoPlace used for quotes and maps.

import { useEffect, useRef, useState } from "react";
import { Loader2, MapPin } from "lucide-react";
import { geoAutocomplete, type GeoPlace } from "@/lib/tengasell/geo-client";
import { cn } from "@/lib/utils";

interface AddressAutocompleteProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  near?: { lat: number; lng: number };
  onSelect: (place: GeoPlace) => void;
  id?: string;
  "aria-label"?: string;
}

export function AddressAutocomplete({
  value,
  placeholder = "Search a suburb, town or landmark…",
  disabled,
  near,
  onSelect,
  id,
  "aria-label": ariaLabel = "Delivery address search",
}: AddressAutocompleteProps) {
  const [term, setTerm] = useState(value ?? "");
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const seqRef = useRef(0);

  // Programmatic term values (prefills) that must not trigger a search.
  // Kept as STATE (not a ref): the derived-state adjustment below runs in
  // render phase, and react-hooks/refs forbids ref writes during render.
  // The debounce effect reads it and clears it from the async continuation.
  const [programmatic, setProgrammatic] = useState(value ?? "");

  // Derived-state adjustment (React docs pattern): mirror the parent's
  // selected place into the input. Programmatic values skip the next search
  // so prefills don't open the suggestion list.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setTerm(value ?? "");
    setProgrammatic(value ?? "");
  }

  useEffect(() => {
    const q = term.trim();
    const seq = ++seqRef.current;
    const skip = q !== "" && q === programmatic;
    const t = setTimeout(async () => {
      await Promise.resolve(); // async continuation — state clears never render-sync
      if (seq !== seqRef.current) return;
      if (skip) {
        setProgrammatic("");
        setBusy(false);
        return;
      }
      if (q.length < 2) {
        setBusy(false);
        setResults([]);
        setOpen(false);
        return;
      }
      setBusy(true);
      const hits = await geoAutocomplete(q, near);
      if (seq !== seqRef.current) return; // stale response
      setBusy(false);
      if (!hits) {
        setResults([]);
        return;
      }
      setResults(hits);
      setOpen(hits.length > 0);
      setActive(hits.length > 0 ? 0 : -1);
    }, 260);
    return () => clearTimeout(t);
  }, [term, near?.lat, near?.lng]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const choose = (place: GeoPlace) => {
    setTerm(place.displayName);
    setOpen(false);
    setResults([]);
    onSelect(place);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 rounded-control border border-border bg-canvas px-3 focus-within:border-teal focus-within:ring-2 focus-within:ring-ring/30">
        <MapPin className="size-4 shrink-0 text-teal" aria-hidden="true" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id ?? "ts-addr"}-listbox`}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          value={term}
          disabled={disabled}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={(e) => {
            if (!open || results.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (active >= 0 && results[active]) choose(results[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          className="min-h-11 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground"
        />
        {busy && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />}
      </div>

      {open && results.length > 0 && (
        <ul
          id={`${id ?? "ts-addr"}-listbox`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-control border border-border bg-floating p-1 shadow-lg ts-scrollbar"
        >
          {results.map((r, i) => (
            <li key={`${r.placeId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-control px-3 py-2.5 text-start transition-colors",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-teal" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-label font-semibold text-foreground">{r.name}</span>
                  <span className="block truncate text-caption text-muted-foreground">{r.displayName}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
