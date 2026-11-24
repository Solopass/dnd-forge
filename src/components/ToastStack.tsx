import { useEffect, useRef, useState } from 'react';
import { ToastMessage } from '../state/useSheetStore';

interface ToastStackProps {
  toasts: ToastMessage[];
  suppressToasts: boolean;
  onDismiss: (id: string) => void;
}

function ToastItem({
  toast,
  onDismiss,
  onFocusDismissNext,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
  onFocusDismissNext: (dismissedId: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const el = ref.current as (HTMLDivElement & { showPopover?: () => void; hidePopover?: () => void }) | null;
    if (!el) return;
    try {
      if (typeof el.showPopover === 'function') {
        el.showPopover();
      } else {
        el.classList.add(':popover-open');
      }
    } catch {
      el.classList.add(':popover-open');
    }
    try {
      const nav = navigator as unknown as { ariaNotify?: (msg: string) => void };
      nav.ariaNotify?.(toast.text);
    } catch {
      // ignore if ariaNotify unsupported
    }
    return () => {
      try {
        el.hidePopover?.();
      } catch {
        // ignore
      }
    };
  }, [toast.text]);

  useEffect(() => {
    if (hovered || pausedRef.current) return;
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, hovered, onDismiss]);

  return (
    <div
      ref={ref}
      popover="manual"
      data-toast-id={toast.id}
      className={`toast-card toast-${toast.tone}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        pausedRef.current = true;
      }}
      onBlur={() => {
        pausedRef.current = false;
      }}
    >
      <span className="toast-text">{toast.text}</span>
      <button
        type="button"
        className="btn toast-close"
        aria-label="Dismiss notification"
        onClick={() => {
          onFocusDismissNext(toast.id);
          onDismiss(toast.id);
        }}
      >
        ×
      </button>
    </div>
  );
}

export function ToastStack({ toasts, suppressToasts, onDismiss }: ToastStackProps) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (toasts.length === 1 && document.activeElement instanceof HTMLElement) {
      previousFocusRef.current = document.activeElement;
    }
  }, [toasts.length]);

  const handleFocusDismissNext = (dismissedId: string) => {
    const remaining = toasts.filter((t) => t.id !== dismissedId);
    const nextToast = remaining[0];
    if (nextToast) {
      const nextBtn = document.querySelector<HTMLButtonElement>(
        `[data-toast-id="${nextToast.id}"] .toast-close`
      );
      nextBtn?.focus();
    } else if (previousFocusRef.current?.isConnected) {
      previousFocusRef.current.focus();
    }
  };

  if (suppressToasts || toasts.length === 0) {
    return (
      <div className="toast-region" role="region" aria-label="Notifications">
        <p className="sr-only">Screen reader notifications</p>
        <div className="sr-only" aria-live="polite" />
      </div>
    );
  }

  return (
    <div className="toast-region" role="region" aria-label="Notifications">
      <p className="sr-only">Screen reader notifications</p>
      <div className="sr-only" aria-live="polite">
        {toasts[0]?.text ?? ''}
      </div>
      {toasts.map((t) => (
        <ToastItem
          key={t.id}
          toast={t}
          onDismiss={onDismiss}
          onFocusDismissNext={handleFocusDismissNext}
        />
      ))}
    </div>
  );
}
