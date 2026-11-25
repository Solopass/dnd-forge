import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MoreMenuItem = {
  key: string;
  label: ReactNode;
  title?: string;
  onSelect: () => void;
};

/**
 * Small disclosure menu for the header: a button with aria-expanded and a list of buttons.
 * Closes on Escape (focus returns to the button), outside click, and after choosing an item.
 */
export function MoreMenu({ items }: { items: MoreMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="topbar-more" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${open ? 'btn-primary' : ''}`}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        More ▾
      </button>
      {open && (
        <ul className="topbar-menu" id={listId}>
          {items.map((item) => (
            <li key={item.key}>
              <button
                type="button"
                className="topbar-menu-item"
                title={item.title}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
