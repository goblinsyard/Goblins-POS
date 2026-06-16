import { useState } from 'react';
import { fmtMoney, t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { MenuItem } from '../../lib/types';

export function ModifierDialog({
  item, onConfirm, onClose,
}: {
  item: MenuItem;
  onConfirm: (modifierIds: string[]) => void;
  onClose: () => void;
}) {
  const { lang } = usePos();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(groupMax: number, groupModIds: string[], id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      const inGroup = groupModIds.filter((m) => next.has(m));
      if (groupMax === 1) for (const m of inGroup) next.delete(m);
      else if (inGroup.length >= groupMax) return;
      next.add(id);
    }
    setSelected(next);
  }

  const valid = item.modifierGroups.every(({ group }) => {
    const count = group.modifiers.filter((m) => selected.has(m.id)).length;
    return count >= group.minSelect && count <= group.maxSelect;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-bold">{lang === 'ar' && item.nameAr ? item.nameAr : item.name}</h2>
        {item.modifierGroups.map(({ group }) => (
          <div key={group.id} className="mb-4">
            <h3 className="mb-2 text-sm font-semibold uppercase text-goblin-400">
              {lang === 'ar' && group.nameAr ? group.nameAr : group.name}
              {group.minSelect > 0 && <span className="text-red-400"> *</span>}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {group.modifiers.map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => toggle(group.maxSelect, group.modifiers.map((m) => m.id), mod.id)}
                  className={`rounded-xl p-3 text-start ${selected.has(mod.id) ? 'bg-goblin-500' : 'bg-goblin-800'}`}
                >
                  {lang === 'ar' && mod.nameAr ? mod.nameAr : mod.name}
                  {mod.priceDeltaCents > 0 && (
                    <span className="ms-1 block text-sm text-goblin-300">+{fmtMoney(mod.priceDeltaCents, lang)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">
            {t(lang, 'cancel')}
          </button>
          <button
            disabled={!valid}
            onClick={() => onConfirm([...selected])}
            className="flex-1 rounded-xl bg-goblin-500 py-3 font-bold text-white disabled:opacity-40"
          >
            {t(lang, 'add')}
          </button>
        </div>
      </div>
    </div>
  );
}
