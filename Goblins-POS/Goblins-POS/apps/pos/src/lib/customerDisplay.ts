import { api } from './api';

/**
 * The customer-facing screen can be:
 *  - a second window on the same device (BroadcastChannel, nothing leaves the device), or
 *  - another device such as a tablet facing the guest: the POS posts the order to the
 *    server under this terminal's pairing code and the display polls it.
 */
export interface DisplayLine { qty: number; name: string; cents: number; mods: string[] }
export interface DisplayState {
  kind: 'order' | 'idle' | 'thanks';
  number?: number;
  lines?: DisplayLine[];
  subtotalCents?: number;
  discountCents?: number;
  serviceCents?: number;
  taxCents?: number;
  totalCents?: number;
  paidCents?: number;
}

const CHANNEL = 'goblins-customer-display';
let channel: BroadcastChannel | null = null;
let last: DisplayState = { kind: 'idle' };

function ch(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    // a display that opens late asks for the current state
    channel.onmessage = (e) => { if (e.data === 'hello') channel?.postMessage(last); };
  } catch { channel = null; }
  return channel;
}

const CODE_KEY = 'pos.displayCode';
const REMOTE_KEY = 'pos.remoteDisplay';

/** This terminal's 6-character pairing code (created on first use). */
export function displayCode(): string {
  try {
    let c = localStorage.getItem(CODE_KEY);
    if (!c || !/^[A-Z0-9]{6}$/.test(c)) {
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const rnd = crypto.getRandomValues(new Uint8Array(6));
      c = Array.from(rnd, (b) => abc[b % abc.length]).join('');
      localStorage.setItem(CODE_KEY, c);
    }
    return c;
  } catch {
    return 'GOBLIN';
  }
}

export function remoteDisplayOn(): boolean {
  try { return localStorage.getItem(REMOTE_KEY) === '1'; } catch { return false; }
}

export function setRemoteDisplay(on: boolean) {
  try { localStorage.setItem(REMOTE_KEY, on ? '1' : '0'); } catch { /* per-terminal convenience */ }
  if (on) void pushRemote(last);
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
function pushRemote(state: DisplayState) {
  if (pushTimer) clearTimeout(pushTimer);
  // small debounce: tapping several items quickly sends one update
  pushTimer = setTimeout(() => {
    void api(`/display/${displayCode()}`, { method: 'POST', body: state }).catch(() => {});
  }, 250);
}

export function publishDisplay(state: DisplayState) {
  last = state;
  ch()?.postMessage(state);
  if (remoteDisplayOn()) pushRemote(state);
}

/** Display side, other device: poll the server for this code. */
export function pollDisplay(code: string, onState: (s: DisplayState) => void): () => void {
  let stopped = false;
  let lastJson = '';
  async function tick() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/display/${encodeURIComponent(code)}`, { cache: 'no-store' });
      if (r.ok) {
        const txt = await r.text();
        if (txt !== lastJson) { lastJson = txt; onState(JSON.parse(txt) as DisplayState); }
      }
    } catch { /* offline for a moment — keep the last screen */ }
    if (!stopped) setTimeout(tick, 1500);
  }
  void tick();
  return () => { stopped = true; };
}

export function listenDisplay(onState: (s: DisplayState) => void): () => void {
  let c: BroadcastChannel | null = null;
  try { c = new BroadcastChannel(CHANNEL); } catch { return () => {}; }
  c.onmessage = (e) => { if (e.data && typeof e.data === 'object') onState(e.data as DisplayState); };
  c.postMessage('hello');
  return () => c?.close();
}

export function openCustomerDisplay() {
  window.open('/?display=customer', 'goblins-customer-display', 'popup,width=1024,height=768');
}

export function remoteDisplayUrl(): string {
  return `${window.location.origin}/?display=customer&code=${displayCode()}`;
}
