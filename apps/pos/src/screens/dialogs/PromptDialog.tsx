import { useState } from 'react';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

/** Generic text prompt; optionally collects a number too (e.g. discount %). */
export function PromptDialog({
  title, extraNumber, onConfirm, onConfirmWithNumber, onClose,
}: {
  title: string;
  extraNumber?: string;
  onConfirm?: (text: string) => void;
  onConfirmWithNumber?: (text: string, num: number) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [text, setText] = useState('');
  const [num, setNum] = useState('');

  const valid = text.trim().length > 0 && (!extraNumber || Number(num) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        {extraNumber && (
          <input
            type="number" inputMode="decimal" placeholder={extraNumber} autoFocus
            value={num} onChange={(e) => setNum(e.target.value)}
            className="mb-2 w-full rounded-xl bg-goblin-950 p-3"
          />
        )}
        <input
          type="text" autoFocus={!extraNumber} placeholder={title}
          value={text} onChange={(e) => setText(e.target.value)}
          className="mb-4 w-full rounded-xl bg-goblin-950 p-3"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">
            {t(lang, 'cancel')}
          </button>
          <button
            disabled={!valid}
            onClick={() => {
              if (extraNumber && onConfirmWithNumber) onConfirmWithNumber(text.trim(), Number(num));
              else onConfirm?.(text.trim());
            }}
            className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold disabled:opacity-40"
          >
            {t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
