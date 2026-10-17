import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/** Keep keyboard and programmatic focus inside the active modal dialog. */
export function useModalFocus(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop [role="dialog"]'));
    const dialog = dialogs.reverse().find(isVisible);
    if (!dialog) return;

    const active = document.activeElement;
    const previousFocus = active instanceof HTMLElement ? active : null;
    const previousOverflow = document.body.style.overflow;
    const previousTabIndex = dialog.getAttribute('tabindex');
    if (previousTabIndex === null) dialog.setAttribute('tabindex', '-1');
    document.body.style.overflow = 'hidden';

    const getFocusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => {
      if (element.tabIndex < 0 || element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true') return false;
      return isVisible(element);
    });

    const focusInside = () => {
      const focusable = getFocusable();
      (focusable[0] ?? dialog).focus();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === dialog || !dialog.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || current === dialog || !dialog.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn, true);
    focusInside();

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn, true);
      document.body.style.overflow = previousOverflow;
      if (previousTabIndex === null) dialog.removeAttribute('tabindex');
      else dialog.setAttribute('tabindex', previousTabIndex);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.visibility !== 'collapse'
    && element.getClientRects().length > 0;
}
