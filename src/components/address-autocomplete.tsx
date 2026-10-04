"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { Field, Input, Spinner } from "@/components/ui";

type AddressSuggestion = { id: string; label: string; detail: string; lat: number; lng: number };
type Props = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  required?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
};

export function AddressAutocomplete({
  id,
  label,
  value,
  placeholder,
  required,
  error,
  onChange,
  onSelect,
}: Props) {
  const listId = `${id}-suggestions`;
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searched, setSearched] = useState(false);
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (selectedValue === value || query.length < 3) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setSearched(false);
      try {
        const response = await fetch(`/api/places/autocomplete?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) throw new Error("Address search failed");
        const data = (await response.json()) as { suggestions?: AddressSuggestion[] };
        setSuggestions(data.suggestions ?? []);
        setActiveIndex(0);
        setSearched(true);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setSearched(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, selectedValue]);

  function choose(suggestion: AddressSuggestion) {
    setSelectedValue(suggestion.label);
    setSuggestions([]);
    setOpen(false);
    setLoading(false);
    setSearched(false);
    onSelect(suggestion);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && open && suggestions[activeIndex]) {
      event.preventDefault();
      choose(suggestions[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <Field label={label} htmlFor={id} error={error} required={required}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          className="pr-10"
          onChange={(event) => {
            setSelectedValue(null);
            setSuggestions([]);
            setSearched(false);
            setLoading(false);
            setOpen(true);
            onChange(event.target.value);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-label="Searching addresses">
            <Spinner className="h-4 w-4" />
          </span>
        )}
        {open && (suggestions.length > 0 || (searched && value.trim().length >= 3)) && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            {suggestions.length > 0 ? (
              <ul id={listId} role="listbox" className="max-h-64 overflow-y-auto py-1">
                {suggestions.map((suggestion, index) => (
                  <li key={suggestion.id} role="presentation">
                    <button
                      id={`${listId}-${index}`}
                      type="button"
                      role="option"
                      aria-selected={activeIndex === index}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => choose(suggestion)}
                      className={`w-full px-3 py-2.5 text-left transition ${
                        activeIndex === index ? "bg-orange-50" : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="block text-sm font-medium text-slate-900">{suggestion.label}</span>
                      {suggestion.detail && <span className="mt-0.5 block text-xs text-slate-500">{suggestion.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-xs text-slate-500">No matches found. Try a street address and suburb.</p>
            )}
          </div>
        )}
      </div>
    </Field>
  );
}
