'use client';

import { useEffect, useRef, useState } from 'react';

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const buttonText = selected.length === 0 ? label : `${label} (${selected.length})`;

  return (
    <div className="multiselect" ref={ref}>
      <button
        type="button"
        className={`multiselect-trigger ${selected.length > 0 ? 'multiselect-trigger-active' : ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {buttonText} <span className="multiselect-chev">▾</span>
      </button>

      {open && (
        <div className="multiselect-panel">
          {selected.length > 0 && (
            <button type="button" className="multiselect-clear" onClick={() => onChange([])}>
              Clear
            </button>
          )}
          {options.map((opt) => (
            <label className="multiselect-option" key={opt.value}>
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
