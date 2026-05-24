import { useState, useEffect, useRef } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  copiedLabel?: string;
  size?: "small" | "default";
  block?: boolean;
}

// Reusable Copy-to-clipboard button. Shows a "Copied" confirmation for a
// short window so users have visible feedback that the action succeeded
// without needing to switch out of the popup.
export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  size = "default",
  block = false,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function handleCopy() {
    setError(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Fallback for older Chromiums / restrictive contexts.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
      } catch {
        setError(true);
      }
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopied(false);
      setError(false);
    }, 2200);
  }

  const small = size === "small";
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      style={{
        width: block ? "100%" : "auto",
        padding: small ? "4px 10px" : "8px 14px",
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        background: copied
          ? "rgba(16, 185, 129, 0.15)"
          : "transparent",
        color: copied
          ? "var(--accent, #10B981)"
          : error
            ? "var(--red, #DC2626)"
            : "var(--text, #ECECEC)",
        border: `1px solid ${copied ? "var(--accent, #10B981)" : "var(--border, #2A2A2D)"}`,
        borderRadius: 6,
        cursor: "pointer",
        transition: "all 120ms ease",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
      aria-live="polite"
    >
      {copied ? (
        <>
          <svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          {copiedLabel}
        </>
      ) : error ? (
        "Copy failed"
      ) : (
        <>
          <svg width={small ? 12 : 14} height={small ? 12 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          {label}
        </>
      )}
    </button>
  );
}
