import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { FloorZone } from '../../lib/types';

/**
 * Pick a destination table/room (for moving an order or a session).
 * Occupied tables are allowed for order moves — a table can hold several
 * open bills (e.g. food order joining a running billiards table).
 * Session moves block destinations that already have a live timer.
 */
export function ResourcePicker({
  title, excludeResourceId, blockActiveSessions, onPick, onClose,
}: {
  title: string;
  excludeResourceId?: string | null;
  blockActiveSessions?: boolean;
  onPick: (resourceId: string) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [zones, setZones] = useState<FloorZone[]>([]);

  useEffect(() => {
    void api<FloorZone[]>('/floor').then(setZones);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-lg font-bold">{title}</h2>
        {zones.map((zone) => (
          <div key={zone.id} className="mb-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-goblin-400">
              {lang === 'ar' && zone.nameAr ? zone.nameAr : zone.name}
            </p>
            <div className="grid grid-cols-3 gap-2">
              {zone.resources.map((res) => {
                const hasSession = res.sessions.some((s) => s.status === 'RUNNING' || s.status === 'PAUSED');
                const blocked = res.id === excludeResourceId || (blockActiveSessions && hasSession);
                const occupied = res.status === 'OCCUPIED' || res.orders.length > 0;
                return (
                  <button key={res.id} disabled={blocked}
                    onClick={() => onPick(res.id)}
                    className={`rounded-xl p-3 text-sm font-semibold ${blocked ? 'bg-goblin-950 opacity-40' : occupied ? 'bg-amber-800 active:bg-amber-700' : 'bg-goblin-700 active:bg-goblin-600'}`}>
                    {res.name}
                    <span className="block text-xs font-normal text-goblin-300">
                      {res.orders.length > 0
                        ? `${res.orders.length}× ${fmtMoney(res.orders.reduce((a, o) => a + o.totalCents, 0), lang)}`
                        : t(lang, res.status === 'FREE' ? 'free' : res.status === 'RESERVED' ? 'reserved' : res.status === 'NEEDS_CLEANING' ? 'cleaning' : 'occupied')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button onClick={onClose} className="mt-2 w-full rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
      </div>
    </div>
  );
}
