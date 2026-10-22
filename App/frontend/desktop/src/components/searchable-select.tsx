/** Searchable select module: the long-list variant of Select for model pickers. */
import { Select, type SelectOption } from "./Select.js";

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

/** A Select with the filter box enabled; kept under its own name for the model pickers. */
export function SearchableSelect(props: SearchableSelectProps) {
  return (
    <Select
      ariaLabel={props.label}
      label={props.label}
      labelClassName="sr-only"
      value={props.value}
      options={props.options}
      onValueChange={props.onValueChange}
      placeholder={props.placeholder}
      searchable
      searchPlaceholder={props.searchPlaceholder}
      disabled={props.disabled}
      className={props.className}
      menuClassName={props.menuClassName}
    />
  );
}
