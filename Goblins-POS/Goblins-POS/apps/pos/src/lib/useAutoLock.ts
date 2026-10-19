import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { usePos } from './store';

const WARNING_MS = 20_000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Locks the POS back to the PIN screen after `pos.autoLockMinutes` of no
 * touch/keyboard activity, so a terminal left open can't be used under someone
 * else's login. Orders live on the server, so nothing is lost by locking.
 * Returns the seconds left while the warning is showing, otherwise null.
 */
export function useAutoLock(): number | null {
  const { user, logout } = usePos();
  const [minutes, setMinutes] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActivity = useRef(Date.now());

  // read the configured timeout whenever someone signs in
  useEffect(() => {
    if (!user) return;
    lastActivity.current = Date.now();
    api<Record<string, unknown>>('/settings')
      .then((s) => {
        const m = Number(s['pos.autoLockMinutes'] ?? 3);
        setMinutes(Number.isFinite(m) && m > 0 ? m : 0);
      })
      .catch(() => setMinutes(3));
  }, [user]);

  useEffect(() => {
    if (!user || minutes <= 0) {
      setSecondsLeft(null);
      return;
    }
    const bump = () => {
      lastActivity.current = Date.now();
    };
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, bump, { capture: true, passive: true });

    const limit = minutes * 60_000;
    const timer = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= limit) {
        setSecondsLeft(null);
        logout();
      } else if (idle >= limit - WARNING_MS) {
        setSecondsLeft(Math.ceil((limit - idle) / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, 1000);

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, bump, { capture: true });
      clearInterval(timer);
    };
  }, [user, minutes, logout]);

  return secondsLeft;
}
