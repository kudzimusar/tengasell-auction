"use client";

// Tengasell message composer — auto-growing textarea (capped at ~4 rows)
// with Enter-to-send / Shift+Enter-for-new-line, IME-composition safe and
// a gold send button (44px target). onSend returns whether the message went
// out; the draft is only cleared on success so failures never lose text.

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";

interface ComposerProps {
  onSend: (body: string) => Promise<boolean> | boolean;
  sending: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Cap ≈ 4 rows of body text (4 × 1.55rem line height + padding). */
const MAX_HEIGHT_PX = 110;

export function Composer({
  onSend,
  sending,
  placeholder,
  disabled = false,
  autoFocus = false,
}: ComposerProps) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // auto-grow to fit the content, capped at MAX_HEIGHT_PX
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [body]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  const trimmed = body.trim();
  const busy = sending || disabled;

  const submit = async () => {
    if (!trimmed || busy) return;
    const ok = await onSend(trimmed);
    if (ok) setBody("");
    else ref.current?.focus();
  };

  return (
    <div className="p-3">
      <div className="flex items-end gap-2">
        <label htmlFor="ts-composer" className="sr-only">
          Message
        </label>
        <textarea
          id="ts-composer"
          ref={ref}
          rows={1}
          autoFocus={autoFocus}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter starts a new line; skip while IME
            // composition is active (Japanese input)
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder ?? "Write a message…"}
          disabled={busy}
          className="ts-scrollbar flex-1 min-w-0 resize-none min-h-11 max-h-[110px] rounded-input border border-border bg-section px-3 py-2.5 text-body text-foreground outline-none placeholder:text-muted-foreground transition-shadow focus-visible:border-teal focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!trimmed || busy}
          aria-label="Send message"
          className="size-11 shrink-0 grid place-items-center rounded-control bg-gold text-gold-on hover:bg-gold-deep transition-colors focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-1 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {sending ? (
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-5" aria-hidden="true" />
          )}
        </button>
      </div>
      <p className="hidden md:block text-caption text-muted-foreground mt-1.5 select-none">
        <kbd className="rounded-sm bg-muted px-1 py-px font-sans">Enter</kbd> sends ·{" "}
        <kbd className="rounded-sm bg-muted px-1 py-px font-sans">Shift + Enter</kbd> adds a new
        line
      </p>
    </div>
  );
}
