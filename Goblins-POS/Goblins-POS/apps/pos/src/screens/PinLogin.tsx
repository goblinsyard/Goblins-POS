import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { usePos } from '../lib/store';
import type { PinUser } from '../lib/types';

export function PinLogin() {
  const { loginPin, lang, setLang, themeColor, themeMode, setThemeColor, setThemeMode } = usePos();
  const [users, setUsers] = useState<PinUser[]>([]);
  const [selected, setSelected] = useState<PinUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    api<PinUser[]>('/auth/pin-users').then(setUsers).catch(() => {});
  }, []);

  async function submit(p: string) {
    if (!selected) return;
    try {
      await loginPin(selected.id, p);
    } catch {
      setError(true);
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
    <div className="flex h-screen items-center justify-center bg-goblin-950 text-goblin-50">
      <div className="w-full max-w-md p-6">
        <h1 className="mb-8 text-center text-3xl font-bold text-goblin-300">
          {t(lang, 'appName')}
        </h1>
        {!selected ? (
          <div className="grid grid-cols-2 gap-3">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => setSelected(u)}
                className="rounded-2xl bg-goblin-800 p-6 text-lg font-semibold shadow-lg active:bg-goblin-700"
              >
                {u.name}
                <div className="mt-1 text-sm font-normal text-goblin-300">{u.role.name}</div>
              </button>
            ))}
          </div>
        ) : (
          <div>
            <button className="mb-4 text-goblin-300" onClick={() => { setSelected(null); setPin(''); }}>
              ← {selected.name}
            </button>
            <div className={`mb-6 flex justify-center gap-3 ${error ? 'animate-pulse' : ''}`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-full ${i < pin.length ? (error ? 'bg-red-500' : 'bg-goblin-300') : 'bg-goblin-800'}`}
                />
              ))}
            </div>
            {error && <p className="mb-2 text-center text-red-400">{t(lang, 'wrongPin')}</p>}
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    if (k === '⌫') setPin(pin.slice(0, -1));
                    else if (k === '✓') void submit(pin);
                    else press(k);
                  }}
                  className="rounded-2xl bg-goblin-800 p-6 text-2xl font-bold active:bg-goblin-600"
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="mt-8 flex flex-col items-center gap-4 border-t border-goblin-800/40 pt-6">
          {/* Theme Color Selector */}
          <div className="flex items-center gap-2 bg-goblin-900/40 px-3 py-1.5 rounded-full border border-goblin-800/40 select-none">
            {(['goblin', 'indigo', 'rose', 'amber', 'slate'] as const).map((color) => {
              const bgClass =
                color === 'goblin' ? 'bg-emerald-600' :
                color === 'indigo' ? 'bg-blue-600' :
                color === 'rose' ? 'bg-rose-600' :
                color === 'amber' ? 'bg-amber-500' :
                'bg-slate-500';
              return (
                <button
                  key={color}
                  onClick={() => setThemeColor(color)}
                  className={`h-5.5 w-5.5 rounded-full transition-transform active:scale-90 ${bgClass} ${
                    themeColor === color ? 'ring-2 ring-goblin-300 ring-offset-2 ring-offset-goblin-950 scale-110' : 'opacity-70 hover:opacity-100'
                  }`}
                  title={color}
                />
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            {/* Language Toggle */}
            <button
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              className="rounded-xl bg-goblin-900 px-4 py-2 text-sm text-goblin-300 hover:text-goblin-100 transition-colors"
            >
              {lang === 'en' ? 'العربية' : 'English'}
            </button>

            {/* Light/Dark Toggle */}
            <button
              onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
              className="rounded-xl bg-goblin-900 px-4 py-2 text-sm text-goblin-300 hover:text-goblin-100 transition-colors"
            >
              {themeMode === 'light' ? '🌙 Dark' : '☀️ Light'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
