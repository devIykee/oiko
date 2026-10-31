"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m, useDragControls } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { dur, ease, spring, useCalm } from "../motion";
import { IconButton, cx } from "./primitives";

function useIsDesktop() {
  const [d, setD] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const f = () => setD(mq.matches);
    f();
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return d;
}

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Full-screen on all sizes (e.g. lock confirmation). */
  full?: boolean;
  closeLabel?: string;
  /** Prevent closing (while a money action is in flight). */
  dismissible?: boolean;
  testId?: string;
  back?: { label: string; onClick: () => void };
}

/** Bottom sheet on mobile (spring up, drag to dismiss), centred dialog on desktop. */
export function Sheet({ open, onOpenChange, title, description, children, footer, full, closeLabel = "Close", dismissible = true, testId, back }: SheetProps) {
  const desktop = useIsDesktop();
  const calm = useCalm();
  const drag = useDragControls();
  const mode = full ? "full" : desktop ? "dialog" : "bottom";
  const change = (o: boolean) => { if (o || dismissible) onOpenChange(o); };

  const motionProps =
    mode === "bottom"
      ? {
          initial: calm ? { opacity: 0 } : { y: "100%" },
          animate: calm ? { opacity: 1 } : { y: 0, transition: spring.sheet },
          exit: calm ? { opacity: 0 } : { y: "100%", transition: { duration: dur.fast + 0.04, ease: ease.in } },
        }
      : mode === "dialog"
        ? {
            initial: { opacity: 0, scale: calm ? 1 : 0.97, x: "-50%", y: "-50%" },
            animate: { opacity: 1, scale: 1, x: "-50%", y: "-50%", transition: calm ? { duration: 0 } : spring.ui },
            exit: { opacity: 0, scale: calm ? 1 : 0.98, x: "-50%", y: "-50%", transition: { duration: dur.fast, ease: ease.in } },
          }
        : {
            initial: calm ? { opacity: 0 } : { opacity: 0, y: 24 },
            animate: { opacity: 1, y: 0, transition: calm ? { duration: 0 } : spring.sheet },
            exit: { opacity: 0, transition: { duration: dur.fast, ease: ease.in } },
          };

  return (
    <Dialog.Root open={open} onOpenChange={change}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="oi-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { duration: dur.base } }} exit={{ opacity: 0, transition: { duration: dur.fast } }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount
              onEscapeKeyDown={(e) => { if (!dismissible) e.preventDefault(); }}
              onPointerDownOutside={(e) => { if (!dismissible) e.preventDefault(); }}
              {...(description ? {} : { "aria-describedby": undefined })}>
              <m.div
                className={cx("oi-sheet", "oi-root", `oi-sheet--${mode}`)}
                data-testid={testId}
                {...motionProps}
                drag={mode === "bottom" && !calm && dismissible ? "y" : false}
                dragControls={drag}
                dragListener={false}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => { if (info.offset.y > 110 || info.velocity.y > 600) onOpenChange(false); }}
              >
                {mode === "bottom" && (
                  <div className="oi-sheet__grab" onPointerDown={(e) => drag.start(e)} aria-hidden />
                )}
                <div className="oi-sheet__head" style={mode !== "bottom" ? { paddingTop: 18 } : undefined}>
                  {back && <IconButton icon="chevronLeft" label={back.label} plain small onClick={back.onClick} />}
                  <Dialog.Title className="oi-sheet__title">{title}</Dialog.Title>
                  {dismissible && (
                    <Dialog.Close asChild>
                      <IconButton icon="close" label={closeLabel} small />
                    </Dialog.Close>
                  )}
                </div>
                {description && <Dialog.Description className="oi-sheet__desc">{description}</Dialog.Description>}
                <div className="oi-sheet__body">{children}</div>
                {footer && <div className="oi-sheet__foot">{footer}</div>}
              </m.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
