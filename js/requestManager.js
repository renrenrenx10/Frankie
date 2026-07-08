// ── RequestManager ────────────────────────────────────────────────────────────
// Centralised AbortController lifecycle, active request tracking, stale-render
// prevention, and timeout helpers.

let _activeRequestId = 0;
const _activeControllers = new Map(); // requestId → AbortController

export const RequestManager = {
    /**
     * Start a new request. Aborts any in-flight request first.
     * Returns { requestId, signal } for use in fetch and render guards.
     */
    start(timeoutMs = 0) {
        // Abort previous
        for (const [id, ctrl] of _activeControllers) {
            try { ctrl.abort(); } catch {}
            _activeControllers.delete(id);
        }

        const requestId = ++_activeRequestId;
        const controller = new AbortController();
        _activeControllers.set(requestId, controller);

        let _timeoutHandle = null;
        if (timeoutMs > 0) {
            _timeoutHandle = setTimeout(() => {
                controller.abort();
            }, timeoutMs);
        }

        return {
            requestId,
            signal: controller.signal,
            clearTimeout: () => {
                if (_timeoutHandle) clearTimeout(_timeoutHandle);
            }
        };
    },

    /** Is this requestId still the active one? */
    isActive(requestId) {
        return requestId === _activeRequestId;
    },

    /** Abort a specific request (e.g. on component unmount). */
    abort(requestId) {
        const ctrl = _activeControllers.get(requestId);
        if (ctrl) {
            try { ctrl.abort(); } catch {}
            _activeControllers.delete(requestId);
        }
    },

    /** Current active request ID (read-only). */
    get activeId() {
        return _activeRequestId;
    }
};
