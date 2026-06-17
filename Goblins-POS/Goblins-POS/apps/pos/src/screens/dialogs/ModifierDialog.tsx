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

  /**
   * For a given group, returns the set of exclusionGroup tags that are currently
   * "locked in" by the current selection. Any modifier whose exclusionGroup
   * does NOT match the locked tag is dimmed/disabled.
   */
  function getLockedExclusionGroup(groupModIds: string[], modifiers: any[]): string | null {
    for (const mod of modifiers) {
      if (mod.exclusionGroup && selected.has(mod.id)) {
        return mod.exclusionGroup;
      }
    }
    return null;
  }

  function toggle(groupMax: number, groupModIds: string[], modifiers: any[], id: string) {
    const mod = modifiers.find((m) => m.id === id);
    if (!mod) return;

    const next = new Set(selected);

    if (next.has(id)) {
      // Deselect
      next.delete(id);
    } else {
      // Check if this modifier is blocked by an exclusion group conflict
      const lockedGroup = getLockedExclusionGroup(groupModIds, modifiers);
      if (lockedGroup && mod.exclusionGroup && mod.exclusionGroup !== lockedGroup) {
        // Blocked — different exclusion group is active
        return;
      }

      const inGroup = groupModIds.filter((m) => next.has(m));
      if (groupMax === 1) {
        for (const m of inGroup) next.delete(m);
      } else if (inGroup.length >= groupMax) {
        return;
      }
      next.add(id);
    }
    setSelected(next);
  }

  function isDisabled(groupModIds: string[], modifiers: any[], mod: any): boolean {
    if (!mod.isActive) return true;
    const lockedGroup = getLockedExclusionGroup(groupModIds, modifiers);
    if (lockedGroup && mod.exclusionGroup && mod.exclusionGroup !== lockedGroup) {
      return true;
    }
    return false;
  }

  const valid = item.modifierGroups.every(({ group }) => {
    const count = group.modifiers.filter((m: any) => selected.has(m.id)).length;
    return count >= group.minSelect && count <= group.maxSelect;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-xl font-bold">{lang === 'ar' && item.nameAr ? item.nameAr : item.name}</h2>

        {item.modifierGroups.map(({ group }) => {
          const groupModIds = group.modifiers.map((m: any) => m.id);
          const lockedGroup = getLockedExclusionGroup(groupModIds, group.modifiers);

          return (
            <div key={group.id} className="mb-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase text-goblin-400">
                  {lang === 'ar' && group.nameAr ? group.nameAr : group.name}
                  {group.minSelect > 0 && <span className="text-red-400"> *</span>}
                </h3>
                {group.maxSelect > 1 && (
                  <span className="text-xs text-goblin-500">
                    {group.minSelect === group.maxSelect
                      ? `${t(lang, 'choose')} ${group.maxSelect}`
                      : `${t(lang, 'up_to')} ${group.maxSelect}`}
                  </span>
                )}
              </div>

              {/* Show exclusion hint when one group is locked in */}
              {lockedGroup && group.modifiers.some((m: any) => m.exclusionGroup && m.exclusionGroup !== lockedGroup) && (
                <p className="mb-2 text-xs text-amber-400/80 italic">
                  {lang === 'ar'
                    ? '* اختيار واحد فقط من كل نوع'
                    : '* Cannot mix with other option types'}
                </p>
              )}

              <div className="grid grid-cols-2 gap-2">
                {group.modifiers.map((mod: any) => {
                  const sel = selected.has(mod.id);
                  const dim = isDisabled(groupModIds, group.modifiers, mod) && !sel;

                  return (
                    <button
                      key={mod.id}
                      onClick={() => toggle(group.maxSelect, groupModIds, group.modifiers, mod.id)}
                      disabled={dim}
                      className={[
                        'rounded-xl p-3 text-start transition-all',
                        sel
                          ? 'bg-goblin-500 ring-2 ring-goblin-300'
                          : dim
                          ? 'bg-goblin-800/40 opacity-40 cursor-not-allowed'
                          : 'bg-goblin-800 hover:bg-goblin-700',
                      ].join(' ')}
                    >
                      <span className={dim ? 'line-through text-goblin-500' : ''}>
                        {lang === 'ar' && mod.nameAr ? mod.nameAr : mod.name}
                      </span>
                      {mod.priceDeltaCents > 0 && (
                        <span className="ms-1 block text-sm text-goblin-300">
                          +{fmtMoney(mod.priceDeltaCents, lang)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

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
