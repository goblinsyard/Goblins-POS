import { Moon, Settings, Sun } from 'lucide-react';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

export function DisplaySettingsDialog({ onClose }: { onClose: () => void }) {
  const { lang, setLang, themeMode, setThemeMode, themeColor, setThemeColor } = usePos();

  const colors: Array<{
    id: 'goblin' | 'indigo' | 'rose' | 'amber' | 'slate';
    dotColor: string;
    labelKey: 'themeGoblin' | 'themeIndigo' | 'themeRose' | 'themeAmber' | 'themeSlate';
  }> = [
    { id: 'goblin', dotColor: 'bg-emerald-600', labelKey: 'themeGoblin' },
    { id: 'indigo', dotColor: 'bg-blue-600', labelKey: 'themeIndigo' },
    { id: 'rose', dotColor: 'bg-rose-600', labelKey: 'themeRose' },
    { id: 'amber', dotColor: 'bg-amber-500', labelKey: 'themeAmber' },
    { id: 'slate', dotColor: 'bg-slate-500', labelKey: 'themeSlate' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-goblin-900 border border-goblin-800 p-6 text-goblin-50 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-6 flex items-center gap-2 text-xl font-bold text-goblin-300 border-b border-goblin-800 pb-2">
          <Settings className="h-5 w-5" /> {t(lang, 'displaySettings')}
        </h2>

        {/* 1. Theme Mode */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-goblin-400">
            {t(lang, 'themeMode')}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setThemeMode('light')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all shadow-sm ${
                themeMode === 'light'
                  ? 'bg-goblin-600 text-white font-extrabold ring-2 ring-goblin-500/25 scale-[1.02]'
                  : 'bg-goblin-950 text-goblin-400 hover:bg-goblin-800 hover:text-goblin-200'
              }`}
            >
              <Sun className="h-4 w-4" /> {t(lang, 'lightMode')}
            </button>
            <button
              onClick={() => setThemeMode('dark')}
              className={`flex items-center justify-center gap-2 rounded-xl py-3 font-bold transition-all shadow-sm ${
                themeMode === 'dark'
                  ? 'bg-goblin-600 text-white font-extrabold ring-2 ring-goblin-500/25 scale-[1.02]'
                  : 'bg-goblin-950 text-goblin-400 hover:bg-goblin-800 hover:text-goblin-200'
              }`}
            >
              <Moon className="h-4 w-4" /> {t(lang, 'darkMode')}
            </button>
          </div>
        </div>

        {/* 2. Theme Colors */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-goblin-400">
            {t(lang, 'themeColor')}
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {colors.map((c) => (
              <button
                key={c.id}
                onClick={() => setThemeColor(c.id)}
                className={`flex items-center gap-2 rounded-xl p-2.5 text-xs font-semibold border transition-all text-start ${
                  themeColor === c.id
                    ? 'border-goblin-400 bg-goblin-950 text-goblin-300 font-bold scale-[1.02]'
                    : 'border-transparent bg-goblin-950/40 text-goblin-400 hover:bg-goblin-800/40'
                }`}
              >
                <span className={`h-4.5 w-4.5 rounded-full shadow-sm shrink-0 border border-black/15 ${c.dotColor}`} />
                <span className="truncate">{t(lang, c.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 3. Language Selector */}
        <div className="mb-8">
          <label className="mb-2 block text-sm font-semibold uppercase tracking-wider text-goblin-400">
            {lang === 'ar' ? 'اللغة' : 'Language'}
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setLang('en')}
              className={`rounded-xl py-2.5 font-bold transition-all shadow-sm ${
                lang === 'en'
                  ? 'bg-goblin-600 text-white font-extrabold scale-[1.02]'
                  : 'bg-goblin-950 text-goblin-400 hover:bg-goblin-800'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setLang('ar')}
              className={`rounded-xl py-2.5 font-bold transition-all shadow-sm ${
                lang === 'ar'
                  ? 'bg-goblin-600 text-white font-extrabold scale-[1.02]'
                  : 'bg-goblin-950 text-goblin-400 hover:bg-goblin-800'
              }`}
            >
              العربية
            </button>
          </div>
        </div>

        {/* 4. Close Button */}
        <button
          onClick={onClose}
          className="w-full rounded-xl bg-goblin-600 py-3.5 font-bold text-white shadow-md active:scale-95 transition-all text-center"
        >
          {t(lang, 'close')}
        </button>
      </div>
    </div>
  );
}
