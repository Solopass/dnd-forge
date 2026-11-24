import { ReactNode, useEffect, useId, useRef } from 'react';

interface ModalDialogProps {
  isOpen: boolean;
  title: ReactNode;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Native top-layer modal dialog using `<dialog>` + `showModal()` and `closedby="any"`.
 * Includes a pointerdown/pointerup bounding-box fallback for browsers without `closedBy`.
 */
export function ModalDialog({ isOpen, title, wide, onClose, children }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = '';
      if (isOpen) {
        onClose();
      }
    };

    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('close', handleClose);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    const isOutside = (e: PointerEvent) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };

    let pressedOutside = false;
    const onPointerDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) {
        dialog.close();
      }
      pressedOutside = false;
    };

    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('pointerup', onPointerUp);
    return () => {
      dialog.removeEventListener('pointerdown', onPointerDown);
      dialog.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={wide ? 'forge-dialog forge-dialog-wide' : 'forge-dialog'}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      {isOpen && (
        <>
          <div className="forge-dialog-header">
            <h1 id={titleId} className="forge-dialog-title">
              {title}
            </h1>
            <button type="button" className="btn" onClick={onClose}>
              Close (Esc)
            </button>
          </div>
          <div className="forge-dialog-body">{children}</div>
        </>
      )}
    </dialog>
  );
}
