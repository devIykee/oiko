"use client";
import { AnimatePresence, m } from "motion/react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import { dur, ease, spring } from "../motion";

export interface ToastInput {
  message: ReactNode;
  tone?: "neutral" | "success" | "danger";
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}
interface ToastItem extends ToastInput { id: number }
const Ctx = createContext<{ show: (t: ToastInput) => void }>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.durationMs ?? 4000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="oi-toasts oi-root" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <m.div key={t.id} className="oi-toast" data-tone={t.tone ?? "neutral"} layout
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: spring.ui }}
              exit={{ opacity: 0, transition: { duration: dur.fast, ease: ease.in } }}>
              {t.tone && t.tone !== "neutral" && (
                <span className="oi-toast__icon"><Icon name={t.tone === "success" ? "success" : "error"} size={18} /></span>
              )}
              <span>{t.message}</span>
              {t.action && <button type="button" className="oi-toast__action" onClick={t.action.onClick}>{t.action.label}</button>}
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
export const useToast = () => useContext(Ctx);
