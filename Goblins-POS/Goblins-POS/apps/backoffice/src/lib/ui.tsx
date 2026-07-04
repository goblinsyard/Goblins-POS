import { ReactNode, useEffect, useState, useRef, useMemo } from 'react';
import { X } from 'lucide-react';
import { t } from './i18n';

export function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-goblin-900 p-4 shadow ring-1 ring-goblin-700">
      <p className="text-xs uppercase tracking-wide text-goblin-400">{title}</p>
      <p className="mt-1 text-xl font-bold text-goblin-50">{value}</p>
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-goblin-900 shadow ring-1 ring-goblin-700">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm text-goblin-100">
          <thead className="bg-goblin-800 text-left text-goblin-300">
            <tr>{headers.map((h) => <th key={h} className="p-3 capitalize">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-goblin-700">{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="p-4 text-sm text-goblin-400">{t('noData')}</p>}
    </div>
  );
}

export function Spinner() {
  return <p className="p-8 text-goblin-400">{t('loading')}</p>;
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <p className="mb-3 rounded-lg bg-red-500/15 p-2 text-sm text-red-500">{message}</p>;
}

export function Btn({ children, onClick, kind = 'default', disabled }: {
  children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean;
}) {
  const styles = {
    default: 'bg-goblin-800 text-goblin-100 hover:bg-goblin-700',
    primary: 'bg-goblin-600 text-white hover:bg-goblin-500',
    danger: 'bg-red-500/15 text-red-500 hover:bg-red-500/25',
    ghost: 'text-goblin-300 hover:bg-goblin-800',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:opacity-40 ${styles[kind]}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-goblin-400">{label}</span>
      {children}
    </label>
  );
}

export function TextInput({ value, onChange, type = 'text', placeholder, disabled, autoComplete }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string; disabled?: boolean; autoComplete?: string;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} disabled={disabled} autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-goblin-700 bg-goblin-900 p-2 text-sm text-goblin-50 placeholder:text-goblin-400 focus:border-goblin-500 focus:outline-none focus:ring-1 focus:ring-goblin-500 disabled:bg-goblin-800 disabled:text-goblin-400" />
  );
}

export function Select({ value, onChange, options, allowEmpty }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; allowEmpty?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const term = search.toLowerCase().trim();
    if (!term) return options;
    return options.filter((o) => o.label.toLowerCase().includes(term));
  }, [options, search]);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    if (!isOpen) {
      setSearch('');
    }
  }, [isOpen]);

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-goblin-700 bg-goblin-900 p-2 text-left text-sm text-goblin-50 shadow-sm focus:border-goblin-500 focus:outline-none focus:ring-1 focus:ring-goblin-500"
      >
        <span className="truncate whitespace-pre">
          {selectedOption ? selectedOption.label : (allowEmpty ?? t('selectOption'))}
        </span>
        <span className="pointer-events-none ml-2 flex items-center text-goblin-400">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 w-full overflow-hidden rounded-lg border border-goblin-700 bg-goblin-900 shadow-lg flex flex-col">
          <div className="border-b border-goblin-700 p-2 bg-goblin-800">
            <input
              type="text"
              placeholder={t('search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-goblin-700 bg-goblin-900 px-2 py-1.5 text-xs text-goblin-50 focus:border-goblin-500 focus:outline-none focus:ring-1 focus:ring-goblin-500"
            />
          </div>
          <div className="overflow-y-auto max-h-48 divide-y divide-goblin-800">
            {allowEmpty != null && !search && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-semibold text-goblin-400 hover:bg-goblin-800 transition-colors ${
                  value === '' ? 'bg-goblin-800 text-goblin-100' : ''
                }`}
              >
                {allowEmpty}
              </button>
            )}
            {filteredOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs text-goblin-100 hover:bg-goblin-800 transition-colors whitespace-pre ${
                  o.value === value ? 'bg-goblin-800 text-goblin-50 font-semibold' : ''
                }`}
              >
                {o.label}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="p-3 text-center text-xs text-goblin-400">
                {t('noMatches')}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Modal({ title, children, onClose, wide }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 animate-fade-in" onClick={onClose}>
      <div className={`max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-auto rounded-2xl bg-goblin-900 p-6 shadow-xl ring-1 ring-goblin-700`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-goblin-50">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 text-goblin-400 hover:bg-goblin-800"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-6 font-semibold text-goblin-100 first:mt-0">{children}</h2>;
}

export function Pills<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: readonly T[] | { value: T; label: string }[];
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opts.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${o.value === value ? 'bg-goblin-600 text-white' : 'bg-goblin-800 text-goblin-100 hover:bg-goblin-700'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Load data once (or when deps change); exposes error + reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): {
  data: T | null; error: string; reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    fn().then((d) => live && setData(d)).catch((e) => live && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => { live = false; };
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}
