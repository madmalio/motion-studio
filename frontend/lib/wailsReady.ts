// frontend/lib/wailsReady.ts

export function isWailsReady(): boolean {
  const w = window as any;
  return !!(w.go?.main?.App && w.runtime?.EventsOn && w.runtime?.EventsEmit);
}

export async function waitForWails(timeoutMs?: number): Promise<void> {
  const start = Date.now();

  while (true) {
    if (isWailsReady()) return;

    // only enforce timeout if you pass one in
    if (typeof timeoutMs === "number" && Date.now() - start > timeoutMs) {
      throw new Error("Wails runtime not ready");
    }

    await new Promise((r) => setTimeout(r, 50));
  }
}
