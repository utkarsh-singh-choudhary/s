"use client";

import { useEffect, useState } from "react";
import { fmtDate, parseDisplayDate } from "@/lib/format";

/**
 * A date box that is typed and shown as dd-mm-yyyy but hands the page an ISO
 * (yyyy-mm-dd) value - that is what the server expects.
 */
export function DateField({
  value, onChange, placeholder = "dd-mm-yyyy", className = "", disabled,
}: {
  value: string; onChange: (iso: string) => void; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const [text, setText] = useState(value ? fmtDate(value) : "");
  const [bad, setBad] = useState(false);

  useEffect(() => {
    setText(value ? fmtDate(value) : "");
    setBad(false);
  }, [value]);

  function commit(t: string) {
    if (!t.trim()) {
      setBad(false);
      if (value) onChange("");
      return;
    }
    const iso = parseDisplayDate(t);
    if (!iso) {
      setBad(true);
      return;
    }
    setBad(false);
    if (iso !== value) onChange(iso);
  }

  return (
    <input
      value={text}
      disabled={disabled}
      inputMode="numeric"
      placeholder={placeholder}
      maxLength={10}
      onChange={(e) => {
        setText(e.target.value);
        const iso = parseDisplayDate(e.target.value);
        if (iso) {
          setBad(false);
          if (iso !== value) onChange(iso);
        }
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      title={bad ? "Use dd-mm-yyyy, e.g. 31-03-2027" : undefined}
      className={`border rounded-sm px-2 py-1.5 text-sm w-28 ${bad ? "border-bad" : "border-border"} ${className}`}
    />
  );
}
