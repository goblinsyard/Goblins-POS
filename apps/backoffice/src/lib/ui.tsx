import { ReactNode, useEffect, useState, useRef, useMemo } from 'react';

export function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <p className="text-xs uppercase tracking-wide text-slate-400">{title}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow">
      <div className="overflow-x-auto">
        <table className="w-full min-w-max text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>{headers.map((h) => <th key={h} className="p-3 capitalize">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="p-3">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="p-4 text-sm text-slate-400">No data</p>}
    </div>
  );
}

export function Spinner() {
  return <p className="p-8 text-slate-400">Loading…</p>;
}

export function ErrorBanner({ message }: { message: string }) {
  if (!message) return null;
  return <p className="mb-3 rounded-lg bg-red-100 p-2 text-sm text-red-700">{message}</p>;
}

export function Btn({ children, onClick, kind = 'default', disabled }: {
  children: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean;
}) {
  const styles = {
    default: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
    primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
    danger: 'bg-red-100 text-red-700 hover:bg-red-200',
    ghost: 'text-slate-500 hover:bg-slate-100',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 ${styles[kind]}`}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-slate-400">{label}</span>
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
      className="w-full rounded-lg border border-slate-300 p-2 text-sm disabled:bg-slate-50 disabled:text-slate-400" />
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
        className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white p-2 text-left text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
      >
        <span className="truncate whitespace-pre">
          {selectedOption ? selectedOption.label : (allowEmpty ?? 'Select option')}
        </span>
        <span className="pointer-events-none ml-2 flex items-center text-slate-500">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg flex flex-col">
          <div className="border-b p-2 bg-slate-50">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="overflow-y-auto max-h-48 divide-y divide-slate-100">
            {allowEmpty != null && !search && (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-semibold text-slate-400 hover:bg-slate-50 transition-colors ${
                  value === '' ? 'bg-slate-100 text-slate-700' : ''
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
                className={`w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 transition-colors whitespace-pre ${
                  o.value === value ? 'bg-emerald-50 text-emerald-800 font-semibold' : ''
                }`}
              >
                {o.label}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="p-3 text-center text-xs text-slate-400">
                No matching options found
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className={`max-h-[90vh] w-full ${wide ? 'max-w-3xl' : 'max-w-md'} overflow-auto rounded-2xl bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded-lg px-2 text-slate-400 hover:bg-slate-100">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 mt-6 font-semibold text-slate-700 first:mt-0">{children}</h2>;
}

export function Pills<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: readonly T[] | { value: T; label: string }[];
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {opts.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1.5 text-sm capitalize ${o.value === value ? 'bg-emerald-700 text-white' : 'bg-white'}`}>
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
