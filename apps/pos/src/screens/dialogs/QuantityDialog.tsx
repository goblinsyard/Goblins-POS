import { useState } from 'react';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

export function QuantityDialog({
  initialValue, description, onConfirm, onClose,
}: {
  initialValue: number;
  description: string;
  onConfirm: (val: number) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [valStr, setValStr] = useState(String(initialValue));

  function handleKeyPress(key: string) {
    if (key === 'C') {
      setValStr('');
    } else if (key === '⌫') {
      setValStr(valStr.slice(0, -1));
    } else if (key === '.') {
      if (!valStr.includes('.')) {
        setValStr(valStr + '.');
      }
    } else {
      if (valStr === '0' && key === '0') return;
      setValStr((valStr === '0' ? '' : valStr) + key);
    }
  }

  function adjust(delta: number) {
    const current = Number(valStr) || 0;
    const next = Math.max(0, current + delta);
    setValStr(String(Number(next.toFixed(3))));
  }

  const numVal = Number(valStr) || 0;
  const isValid = numVal > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">{t(lang, 'editQty')}</h2>
        <p className="mb-4 text-sm text-goblin-300 truncate"><b>{description}</b></p>

        <div className="flex items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => adjust(-1)}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-goblin-800 text-2xl font-bold hover:bg-goblin-750 active:bg-goblin-600"
          >
            -
          </button>
          <input
            type="number"
            inputMode="decimal"
            value={valStr}
            onChange={(e) => setValStr(e.target.value)}
            className="flex-1 rounded-xl bg-goblin-950 p-3 text-center text-xl font-bold border border-goblin-800 focus:outline-none focus:border-goblin-500"
            autoFocus
          />
          <button
            type="button"
            onClick={() => adjust(1)}
            className="flex h-12 w-12 items-center justify-center rounded-xl bg-goblin-800 text-2xl font-bold hover:bg-goblin-750 active:bg-goblin-600"
          >
            +
          </button>
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 bg-goblin-950/40 p-3 rounded-2xl border border-goblin-800">
          {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '.'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => handleKeyPress(k)}
              className="rounded-xl bg-goblin-800 py-3 text-lg font-bold hover:bg-goblin-750 active:bg-goblin-600 transition-all shadow-sm"
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleKeyPress('⌫')}
            className="col-span-3 rounded-xl bg-red-900/40 border border-red-800/60 py-2.5 font-bold hover:bg-red-900/60 active:bg-red-800 transition-all text-red-200 text-sm"
          >
            ⌫ {lang === 'ar' ? 'مسح التراجع' : 'Backspace'}
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">
            {t(lang, 'cancel')}
          </button>
          <button
            disabled={!isValid}
            onClick={() => onConfirm(numVal)}
            className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold text-white disabled:opacity-40"
          >
            {t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
