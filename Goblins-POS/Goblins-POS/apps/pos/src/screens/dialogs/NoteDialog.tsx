import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

const FALLBACK = 'No sugar|بدون سكر, Less sugar|سكر خفيف, No ice|بدون ثلج, Extra ice|ثلج زيادة, Takeaway cup|كوب تيك أواي, Extra spicy|حار زيادة';
let cached: string | null = null;

/** Parses the `pos.quickNotes` setting: "English|عربي, English|عربي". */
function parseChips(raw: string): { en: string; ar: string }[] {
  return raw.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [en, ar] = p.split('|').map((x) => x.trim());
    return { en: en ?? '', ar: ar || en || '' };
  }).filter((c) => c.en);
}

/**
 * Kitchen note for one order line: tap chips to add common requests, or type
 * anything. The note is shown on the KDS ticket and the receipt line.
 */
export function NoteDialog({ title, initial, onConfirm, onClose }: {
  title: string;
  initial: string;
  onConfirm: (notes: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [chips, setChips] = useState(parseChips(cached ?? FALLBACK));
  const [text, setText] = useState(initial);

  useEffect(() => {
    if (cached) return;
    api<Record<string, unknown>>('/settings')
      .then((s) => {
        const raw = typeof s['pos.quickNotes'] === 'string' ? (s['pos.quickNotes'] as string) : '';
        if (raw.trim()) { cached = raw; setChips(parseChips(raw)); }
      })
      .catch(() => {});
  }, []);

  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  const label = (c: { en: string; ar: string }) => (lang === 'ar' ? c.ar : c.en);
  const has = (c: { en: string; ar: string }) => parts.includes(c.en) || parts.includes(c.ar);

  function toggle(c: { en: string; ar: string }) {
    const next = has(c) ? parts.filter((p) => p !== c.en && p !== c.ar) : [...parts, label(c)];
    setText(next.join(', '));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-goblin-800 bg-goblin-900 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.en} onClick={() => toggle(c)}
              className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition-all active:scale-95 ${
                has(c) ? 'border-amber-400 bg-amber-600 text-white' : 'border-goblin-700 bg-goblin-950 text-goblin-200 hover:bg-goblin-800'
              }`}>
              {label(c)}
            </button>
          ))}
        </div>
        <input
          type="text" value={text} onChange={(e) => setText(e.target.value)}
          placeholder={lang === 'ar' ? 'أو اكتب ملاحظة…' : 'Or type a note…'}
          className="mb-4 w-full rounded-xl bg-goblin-950 p-3"
          onKeyDown={(e) => { if (e.key === 'Enter') void onConfirm(text.trim()); }}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
          {initial && (
            <button onClick={() => void onConfirm('')} className="flex-1 rounded-xl bg-red-950/50 py-3 text-red-300">
              {lang === 'ar' ? 'مسح' : 'Clear'}
            </button>
          )}
          <button onClick={() => void onConfirm(text.trim())} className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold">
            {t(lang, 'confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
