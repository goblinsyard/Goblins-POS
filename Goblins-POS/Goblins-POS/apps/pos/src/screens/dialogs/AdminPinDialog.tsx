import { useState } from 'react';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

export function AdminPinDialog({
  onConfirm, onClose,
}: {
  onConfirm: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function submit(p: string) {
    setError(false);
    setErrorMessage('');
    try {
      await onConfirm(p);
    } catch (e) {
      setError(true);
      setErrorMessage(e instanceof Error ? e.message : 'Wrong PIN');
      setPin('');
      setTimeout(() => setError(false), 1200);
    }
  }

  function press(d: string) {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
    if (next.length >= 4) void submit(next);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-center text-lg font-bold">{t(lang, 'adminPin')}</h2>
        
        <div className={`mb-6 flex justify-center gap-3 ${error ? 'animate-pulse' : ''}`}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-4 w-4 rounded-full ${i < pin.length ? (error ? 'bg-red-500' : 'bg-goblin-300') : 'bg-goblin-800'}`}
            />
          ))}
        </div>

        {errorMessage && <p className="mb-4 text-center text-sm text-red-400">{errorMessage}</p>}

        <div className="grid grid-cols-3 gap-3 bg-goblin-950/40 p-3 rounded-2xl border border-goblin-800">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                if (k === '⌫') setPin(pin.slice(0, -1));
                else if (k === '✓') void submit(pin);
                else press(k);
              }}
              className="rounded-2xl bg-goblin-800 py-4 text-xl font-bold hover:bg-goblin-750 active:bg-goblin-600 transition-all shadow-sm"
            >
              {k}
            </button>
          ))}
        </div>

        <button onClick={onClose} className="mt-4 w-full rounded-xl bg-goblin-800 py-3 text-sm font-semibold">
          {t(lang, 'cancel')}
        </button>
      </div>
    </div>
  );
}
