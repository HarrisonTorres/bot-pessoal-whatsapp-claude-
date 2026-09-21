const MAX_UNEXPECTED_ATTEMPTS = 5;

export function createWorker({ inbox, processor, now = Date.now, log, idleMs = 30_000 }) {
  let running = false;
  let loopPromise = null;
  let wakeUp = null;

  function waitFor(ms) {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); wakeUp = null; resolve(); };
      const timer = setTimeout(done, ms);
      wakeUp = done;
    });
  }

  async function loop() {
    while (running) {
      const row = inbox.nextDue(now());
      if (row) {
        try {
          await processor.handle(row);
        } catch (e) {
          log.error({ err: String(e), messageId: row.messageId }, 'erro inesperado no worker');
          if (row.attempts + 1 >= MAX_UNEXPECTED_ATTEMPTS) inbox.markFailed(row.messageId, String(e));
          else inbox.retryLater(row.messageId, now() + 60_000, String(e));
        }
        continue;
      }
      const next = inbox.nextDueAt();
      const wait = next == null ? idleMs : Math.min(Math.max(next - now(), 50), idleMs);
      await waitFor(wait);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loopPromise = loop();
    },
    async stop() {
      running = false;
      wakeUp?.();
      await loopPromise;
    },
    notify() { wakeUp?.(); },
  };
}
