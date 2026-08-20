import { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

// Lightweight unsaved-change protection.
//
// Deliberately not a global form-state system. One page at a time may declare
// that it holds unsaved work by registering a predicate; everything that can
// take the user away from that work asks the predicate first. The page keeps
// owning its own fields, so nothing here knows what a "form" is.

export const DISCARD_PROMPT = 'You have unsaved changes. Discard them?';

let pendingGuard = null;

/** Declare that unsaved work exists while `isDirty()` returns true. */
export function registerUnsavedChangesGuard(isDirty) {
  pendingGuard = isDirty;
  return () => {
    if (pendingGuard === isDirty) pendingGuard = null;
  };
}

export function hasUnsavedChanges() {
  return Boolean(pendingGuard && pendingGuard());
}

/** True when it is safe to leave: nothing unsaved, or the user chose to discard. */
export function confirmDiscardUnsavedChanges() {
  if (!hasUnsavedChanges()) return true;
  return window.confirm(DISCARD_PROMPT);
}

/**
 * Register the guard for as long as the calling component wants it, and keep
 * the browser's own "leave site?" prompt in step with it. `isDirty` is read at
 * call time, so a component may pass a fresh closure on every render.
 */
export function useUnsavedChangesGuard(isDirty) {
  useEffect(() => {
    const unregister = registerUnsavedChangesGuard(() => isDirty);
    const warnOnUnload = (event) => {
      if (!isDirty) return;
      // Reload, tab close and off-site navigation only accept the browser's
      // own wording; preventDefault is what makes Chromium show it at all.
      event.preventDefault();
      event.returnValue = DISCARD_PROMPT;
    };
    window.addEventListener('beforeunload', warnOnUnload);
    return () => {
      window.removeEventListener('beforeunload', warnOnUnload);
      unregister();
    };
  }, [isDirty]);
}

/** navigate() that asks before discarding unsaved work. */
export function useGuardedNavigate() {
  const navigate = useNavigate();
  return useCallback((...args) => {
    if (!confirmDiscardUnsavedChanges()) return;
    navigate(...args);
  }, [navigate]);
}
