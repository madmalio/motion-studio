import { useState, useEffect } from "react";

export function useWails() {
    const [isReady, setIsReady] = useState(false);

    useEffect(() => {
        // If already checking/ready, skip
        if (isReady) return;

        // 1. Immediate check
        if ((window as any).go?.main?.App) {
            setIsReady(true);
            return;
        }

        // 2. Poll for it (Race Condition Fix)
        const interval = setInterval(() => {
            if ((window as any).go?.main?.App) {
                setIsReady(true);
                clearInterval(interval);
            }
        }, 50); // Check every 50ms

        // 3. Fallback / Timeout logic could go here if we wanted "Browser Mode"
        // For now, we just wait indefinitely for the backend as requested.

        return () => clearInterval(interval);
    }, [isReady]);

    return isReady;
}
