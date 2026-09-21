import React, { useMemo, useState } from 'react';

// Renders a searchable checkbox-based selector that does not require modifier keys.
const MultiSelect = ({ label, options, value = [], onChange, placeholder = 'Search options', grouped = false, help = '', disabled = false }) => {
  const [query, setQuery] = useState('');
  const flatOptions = useMemo(() => grouped
    ? options.flatMap((group) => [{ value: group.name, label: group.name, group: group.name }, ...(group.children || []).map((child) => ({ value: child, label: child, group: group.name }))])
    : options, [options, grouped]);
  const visible = flatOptions.filter((option) => option.label.toLowerCase().includes(query.toLowerCase()));

  // Toggles one option and removes conflicting genre ancestors or descendants.
  const toggle = (option) => {
    if (value.includes(option.value)) return onChange(value.filter((item) => item !== option.value));
    let next = [...value];
    if (grouped) {
      const group = options.find((entry) => entry.name === option.group);
      if (option.value === option.group) next = next.filter((item) => !group.children.includes(item));
      else next = next.filter((item) => item !== option.group);
    }
    onChange([...next, option.value]);
  };

  return (
    <fieldset className="selector-field" title={help || undefined} disabled={disabled} aria-disabled={disabled}>
      <legend title={help || undefined}>{label}</legend>
      {disabled && help && <small className="lifecycle-note">{help}</small>}
      <input aria-label={`Search ${label}`} title={`Search available ${label.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      <div className="selected-chips">
        {value.map((item) => {
          const selected = flatOptions.find((option) => option.value === item);
          return <button type="button" title={`Remove ${selected?.label || item}`} key={item} onClick={() => toggle({ value:item, group:options.find((group) => group.children?.includes(item))?.name || item })}>{selected?.label || item} ×</button>;
        })}
      </div>
      <div className="option-list">
        {visible.map((option) => (
          <label key={`${option.group || ''}-${option.value}`} className={value.includes(option.value) ? 'selected-option' : ''}>
            <input type="checkbox" checked={value.includes(option.value)} onChange={() => toggle(option)} />
            <span>{grouped && option.value !== option.group ? `↳ ${option.label}` : option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

export default MultiSelect;
