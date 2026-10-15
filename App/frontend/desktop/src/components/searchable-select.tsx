/** Searchable select module: the long-list variant of Select for model pickers. */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { SelectOption } from "./Select.js";

/** Contract for searchable select props. */
export interface SearchableSelectProps {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
}

/** A dropdown with a filter box, for lists too long to scroll (one instance's model list). */
export function SearchableSelect(props: SearchableSelectProps) {
  const listboxId = `${useId()}-listbox`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState(props.value);

  const selected = props.options.find((option) => option.value === props.value);
  const enabled = useMemo(() => props.options.filter((option) => !option.disabled), [props.options]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? enabled.filter((option) => option.label.toLowerCase().includes(needle)) : enabled;
  }, [enabled, query]);

  useEffect(() => {
    if (!open) return;

    setActiveValue(props.value || enabled[0]?.value || "");

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [enabled, open, props.value]);

  function choose(value: string) {
    props.onValueChange(value);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open) return;

    const activeIndex = filtered.findIndex((option) => option.value === activeValue);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveValue(filtered[Math.min(activeIndex + 1, filtered.length - 1)]?.value ?? activeValue);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveValue(filtered[Math.max(activeIndex - 1, 0)]?.value ?? activeValue);
    } else if (event.key === "Enter") {
      const activeOption = filtered.find((option) => option.value === activeValue);
      if (activeOption) {
        event.preventDefault();
        choose(activeOption.value);
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`select-control select-control--placement-bottom ${props.className ?? ""}`}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        role="combobox"
        className={`select-control__button ${selected?.disabled ? "select-control__button--disabled-value " : ""}`}
        aria-label={props.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="select-control__selection">
          <span className={`select-control__value ${selected ? "" : "select-control__value--placeholder"}`}>
            {selected?.selectedLabel ?? selected?.label ?? props.placeholder ?? ""}
          </span>
        </span>
        <ChevronDown size={16} strokeWidth={2.2} className="select-control__icon" aria-hidden="true" />
      </button>
      {open && (
        <div className={`select-control__menu ${props.menuClassName ?? ""}`} role="presentation">
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Search size={12} aria-hidden="true" />
            <input
              autoFocus
              value={query}
              placeholder={props.searchPlaceholder}
              aria-label={props.searchPlaceholder}
              onChange={(event) => setQuery(event.target.value)}
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>
          <ul id={listboxId} role="listbox" aria-label={props.label}>
            {filtered.map((option) => (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === props.value}
                  className={`select-control__option ${
                    option.value === props.value ? "select-control__option--selected " : ""
                  }${option.value === activeValue ? "select-control__option--active" : ""}`}
                  onClick={() => choose(option.value)}
                  onMouseEnter={() => setActiveValue(option.value)}
                >
                  <span className="select-control__option-content">
                    <span className="select-control__option-label">{option.label}</span>
                  </span>
                  {option.value === props.value && (
                    <Check size={14} strokeWidth={2.6} className="select-control__option-check" aria-hidden="true" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
