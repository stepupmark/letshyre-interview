import { useCallback, useRef } from "react";

/**
 * Handlers for a Radix dialog opened without a trigger: focus goes back to
 * whatever had it before, such as the answer being typed, instead of the page.
 */
export function useFocusReturn() {
  const previousRef = useRef(null);

  const onOpenAutoFocus = useCallback(() => {
    previousRef.current = document.activeElement;
  }, []);

  const onCloseAutoFocus = useCallback((event) => {
    const previous = previousRef.current;
    previousRef.current = null;
    if (!previous?.isConnected || previous === document.body) return;
    event.preventDefault();
    previous.focus({ preventScroll: true });
  }, []);

  return { onOpenAutoFocus, onCloseAutoFocus };
}
