import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

/* Console v2 toast system — replaces every native alert().
 * Bottom-right stack, newest on top, max 3 visible (+N more chip + Clear all).
 * success/info auto-dismiss in 6s with a progress bar (hover pauses);
 * warn/error persist until dismissed. ESC clears all. aria-live polite
 * (errors assertive). Reduced motion: fade only. Tokens from tokens.css. */

const KINDS = {
  success: { g: "✓", c: "#4edea3" },
  info:    { g: "▸", c: "#adc6ff" },
  warn:    { g: "◐", c: "#ffb95f" },
  error:   { g: "✕", c: "#ffb4ab" },
};
const AUTO_MS = 6000;

const ToastCtx = createContext(null);
export function useToast() {
  const ctx = useContext(ToastCtx);
  // Safe no-op outside the provider (e.g. isolated component tests).
  return ctx || (() => {});
}

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const close = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const clearAll = useCallback(() => setToasts([]), []);
  const push = useCallback((kind, title, body, action) => {
    const id = nextId++;
    setToasts((ts) => [...ts, { id, kind: KINDS[kind] ? kind : "info", title, body, action, born: Date.now() }]);
    return id;
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") clearAll(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearAll]);

  const api = useMemo(() => {
    const fn = (kind, title, body, action) => push(kind, title, body, action);
    fn.close = close; fn.clearAll = clearAll;
    return fn;
  }, [push, close, clearAll]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <ToastStack toasts={toasts} onClose={close} onClearAll={clearAll} />
    </ToastCtx.Provider>
  );
}

function ToastCard({ t, onClose }) {
  const k = KINDS[t.kind];
  const auto = t.kind === "success" || t.kind === "info";
  const [hover, setHover] = useState(false);
  const remainRef = useRef(AUTO_MS);
  const timerRef = useRef(null);
  const startRef = useRef(0);

  useEffect(() => {
    if (!auto) return undefined;
    if (hover) return undefined; // pause on hover
    startRef.current = Date.now();
    timerRef.current = setTimeout(() => onClose(t.id), remainRef.current);
    return () => {
      clearTimeout(timerRef.current);
      remainRef.current = Math.max(0, remainRef.current - (Date.now() - startRef.current));
    };
  }, [auto, hover, onClose, t.id]);

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex", alignItems: "flex-start", gap: 11, position: "relative", overflow: "hidden",
        background: "rgba(11,19,38,0.72)", backdropFilter: "blur(13px)", WebkitBackdropFilter: "blur(13px)",
        borderRadius: 12, padding: "12px 14px", boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
        pointerEvents: "auto", border: `1px solid ${k.c}4d`,
      }}
    >
      <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none", background: `${k.c}26`, color: k.c }}>{k.g}</span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", font: "600 12px Inter, sans-serif", color: k.c }}>{t.title}</span>
        {t.body && <span style={{ display: "block", font: "400 12px/1.45 Inter, sans-serif", color: "#c2c6d6", marginTop: 2 }}>{t.body}</span>}
        {t.action && (
          <button onClick={() => { t.action.fn(); onClose(t.id); }} style={{ display: "inline-block", marginTop: 7, font: "600 11.5px Inter, sans-serif", color: "#002e6a", background: "#adc6ff", border: 0, borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>
            {t.action.label}
          </button>
        )}
      </span>
      <button onClick={() => onClose(t.id)} aria-label="Dismiss notification" style={{ color: "#9aa3bd", fontSize: 12, flex: "none", cursor: "pointer", background: "transparent", border: 0, padding: 0 }}>✕</button>
      {auto && (
        <span aria-hidden="true" style={{ position: "absolute", left: 0, bottom: 0, height: 2, background: k.c, opacity: 0.65, width: "100%", transformOrigin: "left", animation: `snToastBar ${AUTO_MS}ms linear forwards`, animationPlayState: hover ? "paused" : "running" }} />
      )}
    </div>
  );
}

function ToastStack({ toasts, onClose, onClearAll }) {
  const visible = toasts.slice(-3).reverse();
  const overflow = Math.max(0, toasts.length - 3);
  const hasError = visible.some((t) => t.kind === "error");
  return (
    <div
      aria-live={hasError ? "assertive" : "polite"}
      role="status"
      style={{ position: "fixed", right: 18, bottom: 18, zIndex: 60, display: "flex", flexDirection: "column", gap: 10, width: 340, maxWidth: "calc(100vw - 36px)", pointerEvents: "none" }}
    >
      <style>{`@keyframes snToastBar{from{transform:scaleX(1)}to{transform:scaleX(0)}}
@media (prefers-reduced-motion: reduce){.sn-toast-in{animation:none!important}}`}</style>
      {overflow > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, pointerEvents: "auto" }}>
          <span style={{ font: "500 11px Inter, sans-serif", color: "#9aa3bd", background: "rgba(11,19,38,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 99, padding: "4px 10px" }}>+{overflow} more</span>
          <button onClick={onClearAll} style={{ font: "500 11px Inter, sans-serif", color: "#adc6ff", background: "rgba(11,19,38,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 99, padding: "4px 10px", cursor: "pointer" }}>Clear all</button>
        </div>
      )}
      {visible.map((t) => <ToastCard key={t.id} t={t} onClose={onClose} />)}
    </div>
  );
}
