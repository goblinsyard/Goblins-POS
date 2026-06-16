import { useState } from 'react';
import { api, egp, parseEgp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Table, TextInput, useLoad } from '../lib/ui';

interface TaxRate { id: string; name: string; isDefault: boolean }
interface MenuCat {
  id: string;
  name: string;
  nameAr?: string | null;
  color?: string | null;
  isActive?: boolean;
  parentCategoryId?: string | null;
  sortOrder?: number;
  items: {
    id: string;
    name: string;
    nameAr?: string | null;
    priceCents: number;
    is86ed: boolean;
    stationId?: string | null;
    taxRate?: TaxRate | null;
    isFavorite?: boolean;
  }[];
}

interface Modifier {
  id: string;
  groupId: string;
  name: string;
  nameAr?: string | null;
  priceDeltaCents: number;
  sortOrder: number;
  isActive: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  nameAr?: string | null;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  modifiers: Modifier[];
  items: { itemId: string; groupId: string; item: { name: string } }[];
}

const DEPARTMENTS = ['RESTAURANT', 'BAR', 'BILLIARDS', 'PLAYSTATION'];

export function MenuView() {
  const { data: menu, error, reload } = useLoad(() => api<MenuCat[]>('/menu'));
  const { data: stations } = useLoad(() => api<{ id: string; name: string }[]>('/kds/stations'));
  const [newItemCat, setNewItemCat] = useState<MenuCat | null>(null);
  const [duplicatingItem, setDuplicatingItem] = useState<any | null>(null);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [editCatOpen, setEditCatOpen] = useState<MenuCat | null>(null);
  const [actionErr, setActionErr] = useState('');

  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [draggedCatId, setDraggedCatId] = useState<string | null>(null);
  const [dragOverCatId, setDragOverCatId] = useState<string | null>(null);

  // Search & Filter States
  const [itemsSearch, setItemsSearch] = useState('');
  const [itemsStation, setItemsStation] = useState('');
  const [itemsStatus, setItemsStatus] = useState('all'); // all, active, 86ed, favorite, no-station

  async function handleDrop(targetId: string) {
    if (!draggedCatId || draggedCatId === targetId) return;
    if (!menu) return;

    const dragged = menu.find((c) => c.id === draggedCatId);
    const target = menu.find((c) => c.id === targetId);
    if (!dragged || !target) return;

    if (dragged.parentCategoryId !== target.parentCategoryId) return;

    const siblings = menu
      .filter((c) => c.parentCategoryId === dragged.parentCategoryId)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

    const draggedIdx = siblings.findIndex((c) => c.id === draggedCatId);
    const targetIdx = siblings.findIndex((c) => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const nextSiblings = [...siblings];
    nextSiblings.splice(draggedIdx, 1);
    nextSiblings.splice(targetIdx, 0, dragged);

    setActionErr('');
    try {
      await Promise.all(
        nextSiblings.map((c, idx) =>
          api(`/admin/menu/categories/${c.id}`, {
            method: 'PATCH',
            body: { sortOrder: idx },
          })
        )
      );
      reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Reordering failed');
    }
  }

  async function toggleFavorite(itemId: string, currentIsFavorite: boolean) {
    await run(() => api(`/admin/menu/items/${itemId}`, { method: 'PATCH', body: { isFavorite: !currentIsFavorite } }));
  }

  const [subTab, setSubTab] = useState<'items' | 'modifiers' | 'combos'>('items');
  const { data: groups, reload: reloadGroups } = useLoad(() => api<ModifierGroup[]>('/admin/modifiers/groups'));
  const { data: combos, reload: reloadCombos } = useLoad(() => api<Combo[]>('/admin/menu/combos'));
  const [groupModalOpen, setGroupModalOpen] = useState<{ group?: ModifierGroup } | null>(null);
  const [optionModalOpen, setOptionModalOpen] = useState<{ groupId: string; modifier?: Modifier } | null>(null);
  const [linkModalOpen, setLinkModalOpen] = useState<ModifierGroup | null>(null);
  const [comboModalOpen, setComboModalOpen] = useState<{ combo?: Combo } | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setActionErr('');
    try { await fn(); reload(); } catch (e) { setActionErr(e instanceof Error ? e.message : 'Failed'); }
  }

  async function toggle86(itemId: string, is86ed: boolean) {
    await run(() => api(`/menu/items/${itemId}/86`, { method: 'PATCH', body: { is86ed: !is86ed } }));
  }
  async function setPrice(itemId: string, current: number) {
    const input = prompt('New price (EGP):', String(current / 100));
    if (!input) return;
    const cents = parseEgp(input);
    if (cents == null || cents <= 0) { setActionErr('Invalid price'); return; }
    await run(() => api(`/admin/menu/items/${itemId}`, { method: 'PATCH', body: { priceCents: cents } }));
  }
  async function rename(itemId: string, current: string) {
    const input = prompt('New name:', current);
    if (!input) return;
    await run(() => api(`/admin/menu/items/${itemId}`, { method: 'PATCH', body: { name: input } }));
  }
  async function deleteItem(itemId: string, itemName: string) {
    if (!confirm(`Are you sure you want to delete or deactivate menu item "${itemName}"?`)) return;
    await run(() => api(`/admin/menu/items/${itemId}`, { method: 'DELETE' }));
  }

  // default tax rate from existing items, applied to newly created items
  const defaultTaxRateId = menu?.flatMap((c) => c.items).map((i) => i.taxRate).find((t) => t?.isDefault)?.id
    ?? menu?.flatMap((c) => c.items).find((i) => i.taxRate)?.taxRate?.id;

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <Pills
          value={subTab}
          onChange={setSubTab as any}
          options={[
            { value: 'items', label: 'Menu Items' },
            { value: 'modifiers', label: 'Modifiers & Extras' },
            { value: 'combos', label: 'Combo Meals' },
          ]}
        />
        {subTab === 'items' && <Btn kind="primary" onClick={() => setNewCatOpen(true)}>+ New category</Btn>}
        {subTab === 'modifiers' && <Btn kind="primary" onClick={() => setGroupModalOpen({})}>+ New group</Btn>}
        {subTab === 'combos' && <Btn kind="primary" onClick={() => setComboModalOpen({})}>+ New combo</Btn>}
      </div>

      <ErrorBanner message={actionErr} />

      {subTab === 'items' && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="w-64">
              <Field label="Search Menu Items">
                <TextInput value={itemsSearch} onChange={setItemsSearch} placeholder="Search item, category, or Arabic name..." />
              </Field>
            </div>
            <div className="w-48">
              <Field label="Kitchen/Bar Station">
                <Select value={itemsStation} onChange={setItemsStation} allowEmpty="All Stations"
                  options={(stations ?? []).map((s) => ({ value: s.id, label: s.name }))} />
              </Field>
            </div>
            <div className="w-48">
              <Field label="Status / Flags">
                <Select value={itemsStatus} onChange={setItemsStatus}
                  options={[
                    { value: 'all', label: 'All Items' },
                    { value: 'active', label: 'Active (Restored)' },
                    { value: '86ed', label: "86'ed (Deactivated)" },
                    { value: 'favorite', label: 'Favorites ★' },
                    { value: 'no-station', label: '⚠ No Station Assigned' },
                  ]} />
              </Field>
            </div>
            {(itemsSearch || itemsStation || itemsStatus !== 'all') && (
              <Btn kind="ghost" onClick={() => { setItemsSearch(''); setItemsStation(''); setItemsStatus('all'); }}>Clear</Btn>
            )}
          </div>
          {(() => {
            // Filtered categories and their items
            const filteredMenu = (menu ?? []).map((cat) => {
              const filteredItems = cat.items.filter((item) => {
                // Search query
                if (itemsSearch.trim()) {
                  const q = itemsSearch.toLowerCase();
                  const matchItemName = item.name.toLowerCase().includes(q) || (item.nameAr?.toLowerCase().includes(q) ?? false);
                  const matchCatName = cat.name.toLowerCase().includes(q) || (cat.nameAr?.toLowerCase().includes(q) ?? false);
                  if (!matchItemName && !matchCatName) return false;
                }
                // Station filter
                if (itemsStation && item.stationId !== itemsStation) return false;
                // Status filter
                if (itemsStatus !== 'all') {
                  if (itemsStatus === '86ed' && !item.is86ed) return false;
                  if (itemsStatus === 'active' && item.is86ed) return false;
                  if (itemsStatus === 'favorite' && !item.isFavorite) return false;
                  if (itemsStatus === 'no-station' && item.stationId) return false;
                }
                return true;
              });
              return { ...cat, items: filteredItems };
            });

            // Determine visibility of each category (including parent propagation)
            const visibleCatIds = new Set<string>();
            function checkVisibility(catId: string): boolean {
              if (visibleCatIds.has(catId)) return true;
              const cat = filteredMenu.find((c) => c.id === catId);
              if (!cat) return false;

              // If category itself has matching items
              if (cat.items.length > 0) {
                visibleCatIds.add(catId);
                return true;
              }

              // If search query is active and matches category name
              if (itemsSearch.trim()) {
                const q = itemsSearch.toLowerCase();
                if (cat.name.toLowerCase().includes(q) || (cat.nameAr?.toLowerCase().includes(q) ?? false)) {
                  visibleCatIds.add(catId);
                  return true;
                }
              }

              // Check subcategories
              const subCats = filteredMenu.filter((c) => c.parentCategoryId === catId);
              let subVisible = false;
              for (const sc of subCats) {
                if (checkVisibility(sc.id)) {
                  subVisible = true;
                }
              }

              if (subVisible) {
                visibleCatIds.add(catId);
                return true;
              }

              // If no filters are active, show everything
              if (!itemsSearch.trim() && !itemsStation && itemsStatus === 'all') {
                visibleCatIds.add(catId);
                return true;
              }

              return false;
            }

            if (menu) {
              filteredMenu.forEach((c) => checkVisibility(c.id));
            }

            // Root categories
            const rootCategories = filteredMenu.filter((c) => !c.parentCategoryId && visibleCatIds.has(c.id));
            // Subcategories
            const subCategories = filteredMenu.filter((c) => !!c.parentCategoryId && visibleCatIds.has(c.id));
            // Any subcategories whose parent doesn't exist in the menu list (orphans)
            const orphanSubcategories = subCategories.filter(
              (sc) => !filteredMenu.some((c) => c.id === sc.parentCategoryId && visibleCatIds.has(c.id))
            );
            const categoriesToRender = [...rootCategories, ...orphanSubcategories]
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

          function renderCategoryCard(cat: MenuCat, isSub = false) {
            const children = subCategories.filter((sc) => sc.parentCategoryId === cat.id)
              .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            const isCollapsed = collapsedCats[cat.id];
            const isDragOver = dragOverCatId === cat.id;

            return (
              <div
                key={cat.id}
                draggable={true}
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDraggedCatId(cat.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDragEnter={(e) => {
                  e.stopPropagation();
                  if (draggedCatId && draggedCatId !== cat.id && menu) {
                    const dragged = menu.find((c) => c.id === draggedCatId);
                    if (dragged && dragged.parentCategoryId === cat.parentCategoryId) {
                      setDragOverCatId(cat.id);
                    }
                  }
                }}
                onDragLeave={(e) => {
                  e.stopPropagation();
                  setDragOverCatId(null);
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  setDragOverCatId(null);
                  void handleDrop(cat.id);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  setDraggedCatId(null);
                  setDragOverCatId(null);
                }}
                className={`${isSub ? 'ml-8 border-l-2 border-slate-200 pl-4 mt-4' : 'mt-6'} transition-all ${
                  isDragOver ? 'border-2 border-indigo-400 border-dashed bg-indigo-50/10 rounded-xl p-2' : ''
                }`}
              >
                <div className="mb-2 flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-slate-400 cursor-grab active:cursor-grabbing font-bold mr-1 select-none text-base"
                      title="Drag to reorder siblings"
                    >
                      ⋮⋮
                    </span>
                    <button
                      type="button"
                      onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                      className="text-slate-400 hover:text-slate-600 font-mono text-[9px] w-4 h-4 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded border border-slate-200 select-none cursor-pointer"
                    >
                      {isCollapsed ? '▶' : '▼'}
                    </button>
                    {cat.color && (
                      <span className="h-4 w-4 rounded-full border border-slate-350" style={{ backgroundColor: cat.color }} />
                    )}
                    <h2
                      className="font-semibold text-slate-700 cursor-pointer select-none hover:text-slate-900"
                      onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))}
                    >
                      {cat.name} {cat.nameAr ? `(${cat.nameAr})` : ''}
                      {isSub && <span className="ml-2 text-xs text-slate-400 font-normal">(Subcategory)</span>}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setEditCatOpen(cat)}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 bg-white border border-slate-200 rounded px-2.5 py-1"
                    >
                      Edit Category
                    </button>
                    <Btn onClick={() => setNewItemCat(cat)}>+ Add item</Btn>
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className="overflow-hidden rounded-xl bg-white shadow border border-slate-150">
                      <table className="w-full text-sm">
                        <tbody>
                          {cat.items.map((i) => (
                            <tr key={i.id} className="border-t first:border-0 hover:bg-slate-50/50">
                              <td className={`p-3 ${i.is86ed ? 'text-red-400 line-through' : ''}`}>
                                <div className="flex items-center gap-1.5">
                                  {i.isFavorite && (
                                    <span className="text-amber-500 text-base font-bold animate-pulse" title="Favorite Item">
                                      ★
                                    </span>
                                  )}
                                  <span>
                                    {i.name} {i.nameAr ? `(${i.nameAr})` : ''}
                                  </span>
                                  {!i.stationId && (
                                    <span
                                      className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700"
                                      title="Without a station this item never appears on a kitchen/bar monitor"
                                    >
                                      ⚠ no station
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="p-3 font-mono">{egp(i.priceCents)}</td>
                              <td className="p-3 text-right">
                                <button
                                  onClick={() => void toggleFavorite(i.id, i.isFavorite ?? false)}
                                  className={`mr-2 rounded px-2.5 py-1 text-xs border font-medium transition ${
                                    i.isFavorite
                                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  {i.isFavorite ? '★ Unfav' : '☆ Fav'}
                                </button>
                                <button
                                  onClick={() => void rename(i.id, i.name)}
                                  className="mr-2 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                >
                                  Rename
                                </button>
                                <button
                                  onClick={() => void setPrice(i.id, i.priceCents)}
                                  className="mr-2 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                >
                                  Price
                                </button>
                                <button
                                  onClick={() => {
                                    setDuplicatingItem(i);
                                    setNewItemCat(cat);
                                  }}
                                  className="mr-2 rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                                >
                                  Duplicate
                                </button>
                                <button
                                  onClick={() => void deleteItem(i.id, i.name)}
                                  className="mr-2 rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs text-red-700 hover:bg-red-100"
                                >
                                  Delete
                                </button>
                                <button
                                  onClick={() => void toggle86(i.id, i.is86ed)}
                                  className={`rounded px-2.5 py-1 text-xs border font-medium transition ${
                                    i.is86ed
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
                                      : 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                                  }`}
                                >
                                  {i.is86ed ? 'Restore' : '86'}
                                </button>
                              </td>
                            </tr>
                          ))}
                          {!cat.items.length && (
                            <tr>
                              <td className="p-4 text-slate-400 text-center italic" colSpan={3}>
                                No items in this category
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {children.map((child) => renderCategoryCard(child, true))}
                  </>
                )}
              </div>
            );
          }

            const renderedCards = categoriesToRender.map((c) => renderCategoryCard(c, false));
            return renderedCards.length > 0 ? (
              renderedCards
            ) : (
              <p className="text-center text-sm text-slate-400 py-8 bg-white rounded-xl shadow-sm border border-slate-100 italic">
                No matching categories or items found.
              </p>
            );
          })()}
        </>
      )}
      {subTab === 'modifiers' && (
        <ModifiersView
          groups={groups ?? []}
          allItems={menu?.flatMap((c) => c.items) ?? []}
          reload={reloadGroups}
          setActionErr={setActionErr}
          groupModalOpen={groupModalOpen}
          setGroupModalOpen={setGroupModalOpen}
          optionModalOpen={optionModalOpen}
          setOptionModalOpen={setOptionModalOpen}
          linkModalOpen={linkModalOpen}
          setLinkModalOpen={setLinkModalOpen}
        />
      )}
      {subTab === 'combos' && (
        <CombosView
          combos={combos ?? []}
          allItems={menu?.flatMap((c) => c.items) ?? []}
          reload={reloadCombos}
          setComboModalOpen={setComboModalOpen}
          setActionErr={setActionErr}
        />
      )}

      {newCatOpen && (
        <CategoryFormModal categories={menu ?? []} onClose={() => setNewCatOpen(false)} onDone={() => { setNewCatOpen(false); reload(); }} />
      )}
      {editCatOpen && (
        <CategoryFormModal category={editCatOpen} categories={menu ?? []} onClose={() => setEditCatOpen(null)} onDone={() => { setEditCatOpen(null); reload(); }} />
      )}
      {newItemCat && (
        <NewItemModal
          category={newItemCat}
          duplicateFrom={duplicatingItem}
          stations={stations ?? []}
          defaultTaxRateId={defaultTaxRateId}
          onClose={() => {
            setNewItemCat(null);
            setDuplicatingItem(null);
          }}
          onDone={() => {
            setNewItemCat(null);
            setDuplicatingItem(null);
            reload();
          }}
        />
      )}
      {comboModalOpen && (
        <ComboFormModal
          combo={comboModalOpen.combo}
          allItems={menu?.flatMap((c) => c.items) ?? []}
          onClose={() => setComboModalOpen(null)}
          onDone={() => {
            setComboModalOpen(null);
            reloadCombos();
          }}
        />
      )}
    </div>
  );
}

interface ComboLine {
  id: string;
  itemId: string;
  item: { name: string };
  quantity: number;
}

interface Combo {
  id: string;
  name: string;
  nameAr?: string | null;
  priceCents: number;
  isActive: boolean;
  lines: ComboLine[];
}

function CombosView({
  combos,
  allItems,
  reload,
  setComboModalOpen,
  setActionErr,
}: {
  combos: Combo[];
  allItems: any[];
  reload: () => void;
  setComboModalOpen: (val: { combo?: Combo } | null) => void;
  setActionErr: (err: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [componentItemId, setComponentItemId] = useState('');

  const filteredCombos = combos.filter((c) => {
    // 1. Component Item Filter
    if (componentItemId && !c.lines.some((l) => l.itemId === componentItemId)) return false;

    // 2. Search Filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchComboName = c.name.toLowerCase().includes(q) || (c.nameAr?.toLowerCase().includes(q) ?? false);
      const matchComponent = c.lines.some((l) => l.item?.name.toLowerCase().includes(q));
      if (!matchComboName && !matchComponent) return false;
    }

    return true;
  });
  async function deleteCombo(id: string) {
    if (!confirm('Are you sure you want to delete this combo?')) return;
    setActionErr('');
    try {
      await api(`/admin/menu/combos/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="w-64">
          <Field label="Search Combos">
            <TextInput value={search} onChange={setSearch} placeholder="Search combo name or component..." />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Component Item">
            <Select value={componentItemId} onChange={setComponentItemId} allowEmpty="All Components"
              options={allItems.map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
        </div>
        {(search || componentItemId) && (
          <Btn kind="ghost" onClick={() => { setSearch(''); setComponentItemId(''); }}>Clear</Btn>
        )}
      </div>

      <Table
        headers={['Name', 'Price', 'Components', 'Actions']}
        rows={filteredCombos.map((c) => [
          <div key="name">
            <div className="font-semibold text-slate-800">{c.name}</div>
            {c.nameAr && <div className="text-xs text-slate-400">{c.nameAr}</div>}
          </div>,
          egp(c.priceCents),
          c.lines.map((l) => `${l.quantity}× ${l.item?.name || 'Item'}`).join(', ') || '—',
          <div key={c.id} className="flex gap-2">
            <Btn onClick={() => setComboModalOpen({ combo: c })}>Edit</Btn>
            <Btn kind="danger" onClick={() => void deleteCombo(c.id)}>Delete</Btn>
          </div>,
        ])}
      />
      {filteredCombos.length === 0 && (
        <p className="text-sm text-slate-400 mt-2">
          {combos.length === 0 ? 'No combos defined yet.' : 'No matching combos found.'}
        </p>
      )}
    </div>
  );
}

function ComboFormModal({
  combo,
  allItems,
  onClose,
  onDone,
}: {
  combo?: Combo;
  allItems: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(combo?.name ?? '');
  const [nameAr, setNameAr] = useState(combo?.nameAr ?? '');
  const [price, setPrice] = useState(String((combo?.priceCents ?? 0) / 100));
  const [lines, setLines] = useState<{ itemId: string; quantity: number }[]>(
    combo?.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })) ?? [{ itemId: '', quantity: 1 }]
  );
  const [err, setErr] = useState('');

  function addLine() {
    setLines([...lines, { itemId: '', quantity: 1 }]);
  }

  function updateLine(index: number, field: 'itemId' | 'quantity', value: any) {
    const next = [...lines];
    next[index] = { ...next[index]!, [field]: value };
    setLines(next);
  }

  function removeLine(index: number) {
    setLines(lines.filter((_, i) => i !== index));
  }

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    const cents = parseEgp(price);
    if (cents == null || cents < 0) { setErr('Invalid price'); return; }
    const validLines = lines.filter((l) => l.itemId && l.quantity > 0);
    if (validLines.length === 0) { setErr('At least one component item is required'); return; }

    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() || undefined,
      priceCents: cents,
      lines: validLines,
    };

    try {
      if (combo) {
        await api(`/admin/menu/combos/${combo.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/menu/combos', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save combo');
    }
  }

  return (
    <Modal title={combo ? `Edit Combo: ${combo.name}` : 'New Combo Meal'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
        <Field label="Combo Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Combo Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Price (EGP)"><TextInput type="number" value={price} onChange={setPrice} /></Field>
        
        <div className="border-t border-slate-100 pt-3">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-semibold text-slate-700">Components</h3>
            <Btn onClick={addLine}>+ Add Item</Btn>
          </div>
          
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <div className="flex-1">
                  <Select
                    value={line.itemId}
                    onChange={(v) => updateLine(idx, 'itemId', v)}
                    allowEmpty="— pick item —"
                    options={allItems.map((i) => ({ value: i.id, label: i.name }))}
                  />
                </div>
                <div className="w-20">
                  <input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', parseInt(e.target.value, 10) || 1)}
                    className="w-full rounded-lg border border-slate-300 p-1.5 text-sm"
                    min="1"
                  />
                </div>
                <Btn kind="danger" onClick={() => removeLine(idx)}>✕</Btn>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3 flex justify-end">
          <Btn kind="primary" onClick={() => void submit()}>{combo ? 'Save Combo' : 'Create Combo'}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ModifiersView({
  groups,
  allItems,
  reload,
  setActionErr,
  groupModalOpen,
  setGroupModalOpen,
  optionModalOpen,
  setOptionModalOpen,
  linkModalOpen,
  setLinkModalOpen,
}: {
  groups: ModifierGroup[];
  allItems: any[];
  reload: () => void;
  setActionErr: (err: string) => void;
  groupModalOpen: any;
  setGroupModalOpen: any;
  optionModalOpen: any;
  setOptionModalOpen: any;
  linkModalOpen: any;
  setLinkModalOpen: any;
}) {
  const [search, setSearch] = useState('');
  const [linkedItemId, setLinkedItemId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive

  const filteredGroups = groups.filter((g) => {
    // 1. Status Filter
    if (statusFilter === 'active' && !g.isActive) return false;
    if (statusFilter === 'inactive' && g.isActive) return false;

    // 2. Linked Item Filter
    if (linkedItemId && !g.items.some((i) => i.itemId === linkedItemId)) return false;

    // 3. Search Filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchGroupName = g.name.toLowerCase().includes(q) || (g.nameAr?.toLowerCase().includes(q) ?? false);
      const matchOptionName = g.modifiers.some((m) => m.name.toLowerCase().includes(q) || (m.nameAr?.toLowerCase().includes(q) ?? false));
      const matchLinkedItem = g.items.some((i) => i.item?.name.toLowerCase().includes(q));
      if (!matchGroupName && !matchOptionName && !matchLinkedItem) return false;
    }

    return true;
  });

  async function toggleGroupActive(group: ModifierGroup) {
    setActionErr('');
    try {
      await api(`/admin/modifiers/groups/${group.id}`, {
        method: 'PATCH',
        body: { isActive: !group.isActive },
      });
      reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to toggle group');
    }
  }

  async function deleteOption(id: string) {
    if (!window.confirm('Are you sure you want to delete this option?')) return;
    setActionErr('');
    try {
      await api(`/admin/modifiers/${id}`, { method: 'DELETE' });
      reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to delete option');
    }
  }

  async function toggleOptionActive(opt: Modifier) {
    setActionErr('');
    try {
      await api(`/admin/modifiers/${opt.id}`, {
        method: 'PATCH',
        body: { isActive: !opt.isActive },
      });
      reload();
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : 'Failed to toggle option');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
        <div className="w-64">
          <Field label="Search Modifiers">
            <TextInput value={search} onChange={setSearch} placeholder="Search group, option, or linked item..." />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Linked Menu Item">
            <Select value={linkedItemId} onChange={setLinkedItemId} allowEmpty="All Linked Items"
              options={allItems.map((i) => ({ value: i.id, label: i.name }))} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Status">
            <Select value={statusFilter} onChange={setStatusFilter}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]} />
          </Field>
        </div>
        {(search || linkedItemId || statusFilter !== 'all') && (
          <Btn kind="ghost" onClick={() => { setSearch(''); setLinkedItemId(''); setStatusFilter('all'); }}>Clear</Btn>
        )}
      </div>

      <Table
        headers={['Group', 'Limits', 'Linked Items', 'Options / Variants', 'Status', '']}
        rows={filteredGroups.map((g) => {
          const linkedItemNames = g.items.map((i) => i.item?.name).join(', ') || '—';
          return [
            <div key="name">
              <div className="font-semibold text-slate-800">{g.name}</div>
              {g.nameAr && <div className="text-xs text-slate-400">{g.nameAr}</div>}
            </div>,
            <span key="limits" className="text-xs text-slate-500 font-mono">
              Min: {g.minSelect} / Max: {g.maxSelect}
            </span>,
            <div key="items" className="max-w-[150px] text-xs truncate" title={linkedItemNames}>
              {linkedItemNames}
            </div>,
            <div key="options" className="space-y-1">
              {g.modifiers.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-4 text-xs bg-slate-50 border border-slate-100 rounded px-2 py-1">
                  <span className={m.isActive ? 'text-slate-700 font-medium' : 'text-slate-400 line-through'}>
                    {m.name} {m.nameAr ? `(${m.nameAr})` : ''} — <span className="font-semibold">{m.priceDeltaCents >= 0 ? '+' : ''}{egp(m.priceDeltaCents)}</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setOptionModalOpen({ groupId: g.id, modifier: m })} className="text-blue-600 hover:text-blue-800 font-semibold">Edit</button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => void toggleOptionActive(m)} className={m.isActive ? 'text-amber-600 hover:text-amber-800' : 'text-emerald-600 hover:text-emerald-800'}>
                      {m.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <span className="text-slate-300">|</span>
                    <button onClick={() => void deleteOption(m.id)} className="text-red-600 hover:text-red-800">Delete</button>
                  </div>
                </div>
              ))}
              {!g.modifiers.length && <span className="text-xs text-slate-400 italic">No options defined</span>}
            </div>,
            <span key="status" className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${g.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
              {g.isActive ? 'active' : 'inactive'}
            </span>,
            <div key="actions" className="flex flex-col gap-1 w-28">
              <Btn onClick={() => setGroupModalOpen({ group: g })}>Edit Group</Btn>
              <Btn onClick={() => setLinkModalOpen(g)}>Link Items</Btn>
              <Btn kind="primary" onClick={() => setOptionModalOpen({ groupId: g.id })}>+ Add Option</Btn>
              <Btn kind={g.isActive ? 'danger' : 'default'} onClick={() => void toggleGroupActive(g)}>
                {g.isActive ? 'Disable' : 'Enable'}
              </Btn>
            </div>
          ];
        })}
      />

      {groupModalOpen && (
        <GroupFormModal
          group={groupModalOpen.group}
          onClose={() => setGroupModalOpen(null)}
          onDone={() => {
            setGroupModalOpen(null);
            reload();
          }}
        />
      )}

      {optionModalOpen && (
        <OptionFormModal
          groupId={optionModalOpen.groupId}
          modifier={optionModalOpen.modifier}
          onClose={() => setOptionModalOpen(null)}
          onDone={() => {
            setOptionModalOpen(null);
            reload();
          }}
        />
      )}

      {linkModalOpen && (
        <LinkItemsModal
          group={linkModalOpen}
          allItems={allItems}
          onClose={() => setLinkModalOpen(null)}
          onDone={() => {
            setLinkModalOpen(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function GroupFormModal({
  group,
  onClose,
  onDone,
}: {
  group?: ModifierGroup;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [nameAr, setNameAr] = useState(group?.nameAr ?? '');
  const [minSelect, setMinSelect] = useState(String(group?.minSelect ?? 0));
  const [maxSelect, setMaxSelect] = useState(String(group?.maxSelect ?? 1));
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    const min = parseInt(minSelect, 10);
    const max = parseInt(maxSelect, 10);
    if (isNaN(min) || isNaN(max) || min < 0 || max < min) {
      setErr('Invalid select limits');
      return;
    }

    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() || undefined,
      minSelect: min,
      maxSelect: max,
    };

    try {
      if (group) {
        await api(`/admin/modifiers/groups/${group.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/modifiers/groups', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save group');
    }
  }

  return (
    <Modal title={group ? `Edit Group: ${group.name}` : 'New Modifier Group'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Group Name (e.g. Size, Extras)"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Group Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Min Choices"><TextInput type="number" value={minSelect} onChange={setMinSelect} /></Field>
          <Field label="Max Choices"><TextInput type="number" value={maxSelect} onChange={setMaxSelect} /></Field>
        </div>
        <Btn kind="primary" onClick={() => void submit()}>{group ? 'Save' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}

function OptionFormModal({
  groupId,
  modifier,
  onClose,
  onDone,
}: {
  groupId: string;
  modifier?: Modifier;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(modifier?.name ?? '');
  const [nameAr, setNameAr] = useState(modifier?.nameAr ?? '');
  const [priceDelta, setPriceDelta] = useState(String((modifier?.priceDeltaCents ?? 0) / 100));
  const [sortOrder, setSortOrder] = useState(String(modifier?.sortOrder ?? 0));
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    const cents = parseEgp(priceDelta);
    if (cents == null) {
      setErr('Invalid price');
      return;
    }
    const sort = parseInt(sortOrder, 10);
    if (isNaN(sort)) {
      setErr('Invalid sort order');
      return;
    }

    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() || undefined,
      priceDeltaCents: cents,
      sortOrder: sort,
    };

    try {
      if (modifier) {
        await api(`/admin/modifiers/${modifier.id}`, { method: 'PATCH', body });
      } else {
        await api(`/admin/modifiers/groups/${groupId}/modifiers`, { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save option');
    }
  }

  return (
    <Modal title={modifier ? `Edit Option: ${modifier.name}` : 'New Option / Variant'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Option Name (e.g. Large, Extra Cheese)"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Option Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Price Delta (EGP, e.g. +15 or -5)"><TextInput type="number" value={priceDelta} onChange={setPriceDelta} /></Field>
        <Field label="Sort Order"><TextInput type="number" value={sortOrder} onChange={setSortOrder} /></Field>
        <Btn kind="primary" onClick={() => void submit()}>{modifier ? 'Save' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}

function LinkItemsModal({
  group,
  allItems,
  onClose,
  onDone,
}: {
  group: ModifierGroup;
  allItems: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const initialSelected = group.items.map((i) => i.itemId);
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [search, setSearch] = useState('');
  const [err, setErr] = useState('');

  const filteredItems = allItems.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  function toggleItem(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }

  async function submit() {
    try {
      await api(`/admin/modifiers/groups/${group.id}/items`, {
        method: 'PATCH',
        body: { itemIds: selected },
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to link items');
    }
  }

  return (
    <Modal title={`Link Menu Items to Group: ${group.name}`} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-4">
        <TextInput value={search} onChange={setSearch} placeholder="Search menu items…" />
        
        <div className="max-h-[50vh] overflow-y-auto border border-slate-100 rounded-xl p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
          {filteredItems.map((item) => {
            const isChecked = selected.includes(item.id);
            return (
              <label key={item.id} className={`flex items-center gap-2 p-2 rounded-lg border text-sm cursor-pointer hover:bg-slate-50 transition ${isChecked ? 'bg-emerald-50/55 border-emerald-300 text-emerald-900' : 'bg-white border-slate-200 text-slate-700'}`}>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleItem(item.id)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
                />
                <span className="truncate">{item.name}</span>
              </label>
            );
          })}
          {!filteredItems.length && <p className="col-span-full text-slate-400 text-center py-4">No matching items</p>}
        </div>

        <div className="flex justify-between items-center pt-2">
          <span className="text-xs text-slate-500 font-medium">{selected.length} items selected</span>
          <div className="flex gap-2">
            <Btn onClick={() => setSelected([])} kind="ghost">Select None</Btn>
            <Btn onClick={() => setSelected(allItems.map((i) => i.id))} kind="ghost">Select All</Btn>
            <Btn kind="primary" onClick={() => void submit()}>Save Changes</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CategoryFormModal({
  category,
  categories,
  onClose,
  onDone,
}: {
  category?: MenuCat;
  categories: MenuCat[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [nameAr, setNameAr] = useState(category?.nameAr ?? '');
  const [color, setColor] = useState(category?.color ?? '');
  const [parentCategoryId, setParentCategoryId] = useState<string>(category?.parentCategoryId ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [err, setErr] = useState('');

  const parentOptions = categories
    .filter((c) => !c.parentCategoryId && c.id !== category?.id)
    .map((c) => ({ value: c.id, label: c.name }));

  async function submit() {
    if (!name.trim()) {
      setErr('Name is required');
      return;
    }
    const body = {
      name: name.trim(),
      nameAr: nameAr.trim() || undefined,
      color: color.trim() || null,
      parentCategoryId: parentCategoryId || null,
      isActive,
    };

    try {
      if (category) {
        await api(`/admin/menu/categories/${category.id}`, { method: 'PATCH', body });
      } else {
        await api('/admin/menu/categories', { method: 'POST', body });
      }
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    }
  }

  const COLOR_PRESETS = [
    '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', 
    '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899', 
    '#64748b', '#78716c'
  ];

  return (
    <Modal title={category ? `Edit Category: ${category.name}` : 'New Category'} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Color Selection">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full border-2 transition ${color === c ? 'border-slate-800 scale-110' : 'border-slate-200 hover:scale-105'}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <div className="flex items-center gap-1.5 ml-2">
                <input
                  type="color"
                  value={color && color.startsWith('#') && color.length === 7 ? color : '#3b82f6'}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded border border-slate-300 p-0"
                  title="Custom color"
                />
                <span className="text-xs text-slate-500 font-mono">{color || 'No color'}</span>
              </div>
            </div>
            {color && (
              <button
                type="button"
                onClick={() => setColor('')}
                className="text-xs text-red-600 hover:text-red-800 underline font-medium"
              >
                Clear Color (No Color)
              </button>
            )}
          </div>
        </Field>
        <Field label="Parent Category">
          <Select
            value={parentCategoryId}
            onChange={setParentCategoryId}
            options={[{ value: '', label: 'None (Root Category)' }, ...parentOptions]}
          />
        </Field>
        {category && (
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-slate-305 text-emerald-700 focus:ring-emerald-500"
            />
            <span>Active Category</span>
          </label>
        )}
        <Btn kind="primary" onClick={() => void submit()}>{category ? 'Save' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}

function NewItemModal({ category, duplicateFrom, stations, defaultTaxRateId, onClose, onDone }: {
  category: { id: string; name: string }; duplicateFrom?: any; stations: { id: string; name: string }[];
  defaultTaxRateId?: string; onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(duplicateFrom ? `${duplicateFrom.name} (Copy)` : '');
  const [nameAr, setNameAr] = useState(duplicateFrom ? (duplicateFrom.nameAr ?? '') : '');
  const [price, setPrice] = useState(duplicateFrom ? String(duplicateFrom.priceCents / 100) : '');
  const [department, setDepartment] = useState(duplicateFrom?.department ?? 'RESTAURANT');
  const [stationId, setStationId] = useState(duplicateFrom?.stationId ?? (stations[0]?.id ?? ''));
  const [isFavorite, setIsFavorite] = useState(duplicateFrom?.isFavorite ?? false);
  const [err, setErr] = useState('');

  async function submit() {
    const priceCents = parseEgp(price);
    if (!name.trim() || priceCents == null || priceCents <= 0) { setErr('Name and a positive price are required'); return; }
    try {
      await api('/admin/menu/items', {
        method: 'POST',
        body: {
          categoryId: category.id, name: name.trim(), nameAr: nameAr.trim() || undefined,
          priceCents, department, stationId: stationId || stations[0]?.id, taxRateId: defaultTaxRateId,
          isFavorite,
        },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  return (
    <Modal title={duplicateFrom ? `Duplicate ${duplicateFrom.name}` : `New item in ${category.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Price (EGP)"><TextInput value={price} onChange={setPrice} type="number" /></Field>
        <Field label="Department">
          <Select value={department} onChange={setDepartment} options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} />
        </Field>
        <Field label="Station (kitchen routing — required to reach the monitors)">
          <Select value={stationId} onChange={setStationId}
            options={stations.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer py-1">
          <input
            type="checkbox"
            checked={isFavorite}
            onChange={(e) => setIsFavorite(e.target.checked)}
            className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-500"
          />
          <span>Add to Favorites (POS Quick Access)</span>
        </label>
        <Btn kind="primary" onClick={() => void submit()}>Create item</Btn>
      </div>
    </Modal>
  );
}
