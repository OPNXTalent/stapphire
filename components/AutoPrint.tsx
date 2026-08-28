'use client';

import { useEffect, useState } from 'react';

const PRINT_TRIGGER_DELAY_MS = 250;
// window.close() has no success signal of its own - give it a moment,
// then check whether the tab is actually gone.
const CLOSE_FALLBACK_DELAY_MS = 500;

// This is the disposable ?print=1 print-session tab, opened by
// CompletedInterviewActions specifically so the original candidate
// workspace tab is never navigated or otherwise disturbed. Once the
// browser's print dialog is done with - printed or cancelled, both fire
// the same "afterprint" event - this tab has nothing left to do, so it
// closes itself rather than sitting around as a second, fully
// interactive Stapphire instance.
export function AutoPrint() {
  const [closeFailed, setCloseFailed] = useState(false);

  useEffect(() => {
    // Guards against React development-mode effect replay (mount ->
    // cleanup -> mount) ever running the after-print cycle twice - the
    // cleanup below already removes the listener and cancels the
    // timers for a torn-down instance, but this is a second, cheap line
    // of defense against a duplicate print/close cycle.
    let handled = false;
    let printTimer: ReturnType<typeof setTimeout> | null = null;
    let closeCheckTimer: ReturnType<typeof setTimeout> | null = null;

    function handleAfterPrint() {
      if (handled) return;
      handled = true;
      window.close();
      closeCheckTimer = setTimeout(() => {
        if (!window.closed) setCloseFailed(true);
      }, CLOSE_FALLBACK_DELAY_MS);
    }

    // Registered before window.print() is ever invoked below, so the
    // print dialog's completion can never fire before this is listening
    // for it.
    window.addEventListener('afterprint', handleAfterPrint);
    printTimer = setTimeout(() => window.print(), PRINT_TRIGGER_DELAY_MS);

    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      if (printTimer) clearTimeout(printTimer);
      if (closeCheckTimer) clearTimeout(closeCheckTimer);
    };
  }, []);

  // If the browser silently refused the script-initiated close (policy-
  // dependent, not something this tab can force), never leave a fully
  // interactive application instance behind - replace it with a minimal
  // notice instead.
  if (!closeFailed) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fff',
        color: '#333',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14
      }}
    >
      Printing finished — close this tab.
    </div>
  );
}
