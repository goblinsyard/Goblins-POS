import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtMoney, t } from '../lib/i18n';
import { can, usePos } from '../lib/store';
import type { Category, MenuItem, Order, PaymentMethod, Combo, OrderItemLine } from '../lib/types';
import { CustomerDialog, FeedbackDialog } from './dialogs/CustomerDialog';
import { MergeDialog } from './dialogs/MergeDialog';
import { ModifierDialog } from './dialogs/ModifierDialog';
import { PayDialog } from './dialogs/PayDialog';
import { PromptDialog } from './dialogs/PromptDialog';
import { ReceiptDialog } from './dialogs/ReceiptDialog';
import { RefundDialog } from './dialogs/RefundDialog';
import { ResourcePicker } from './dialogs/ResourcePicker';
import { SplitDialog } from './dialogs/SplitDialog';
import { SessionPanel } from './SessionPanel';
import { AdminPinDialog } from './dialogs/AdminPinDialog';
import { QuantityDialog } from './dialogs/QuantityDialog';
import { DisplaySettingsDialog } from './dialogs/DisplaySettingsDialog';

export function OrderScreen() {
  const { user, lang, activeOrderId, openOrder, toFloor } = usePos();
  const [menu, setMenu] = useState<Category[]>([]);
  const [activeParentCat, setActiveParentCat] = useState<string>('favorites');
  const [activeSubCat, setActiveSubCat] = useState<string | null>(null);
  const [activeSubSubCat, setActiveSubSubCat] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [modItem, setModItem] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null); // orderItemId
  const [discounting, setDiscounting] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [voidingOrder, setVoidingOrder] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [course, setCourse] = useState(1);
  const [seat, setSeat] = useState(0); // 0 = whole table; >0 = that seat's tab
  const [error, setError] = useState('');
  const [mobileTab, setMobileTab] = useState<'menu' | 'cart'>('menu');

  const [combos, setCombos] = useState<Combo[]>([]);
  const [seatCustomerOpen, setSeatCustomerOpen] = useState(false);
  const [movingItem, setMovingItem] = useState<OrderItemLine | null>(null);
  const [movingItemTablePicker, setMovingItemTablePicker] = useState(false);
  const [splittingTimeItem, setSplittingTimeItem] = useState<OrderItemLine | null>(null);
  const [selectedTimeSeats, setSelectedTimeSeats] = useState<number[]>([]);
  const [pinAction, setPinAction] = useState<'service' | 'vat' | null>(null);
  const [quantityEditingItem, setQuantityEditingItem] = useState<OrderItemLine | null>(null);
  const [commentingItem, setCommentingItem] = useState<OrderItemLine | null>(null);
  const [displaySettingsOpen, setDisplaySettingsOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!activeOrderId) return;
    setOrder(await api<Order>(`/orders/${activeOrderId}`));
  }, [activeOrderId]);

  useEffect(() => {
    api<Category[]>('/menu').then((m) => {
      setMenu(m);
      setActiveParentCat('favorites');
      setActiveSubCat(null);
      setActiveSubSubCat(null);
    });
    api<PaymentMethod[]>('/payment-methods').then(setMethods);
    api<Combo[]>('/admin/menu/combos').then((c) => setCombos(c.filter((x) => x.isActive))).catch(() => {});
    void reload();
  }, [reload]);

  async function addItem(item: MenuItem, modifierIds: string[] = []) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/items`, {
        method: 'POST',
        body: { items: [{ itemId: item.id, quantity: 1, modifierIds, ...(course > 1 ? { course } : {}), ...(seat > 0 ? { seat } : {}) }] },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function addCombo(combo: Combo) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/combos`, {
        method: 'POST',
        body: { comboId: combo.id, ...(course > 1 ? { course } : {}), ...(seat > 0 ? { seat } : {}) },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function moveItemToSeat(orderItemId: string, targetSeat: number | null) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/items/${orderItemId}/move`, {
        method: 'POST',
        body: { seat: targetSeat },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to move item');
    }
  }

  async function moveItemToTable(orderItemId: string, targetResourceId: string) {
    setError('');
    try {
      const zones = await api<Category[]>('/floor') as any; // FloorZone
      let targetRes: any = null;
      for (const z of zones) {
        const r = z.resources.find((res: any) => res.id === targetResourceId);
        if (r) {
          targetRes = r;
          break;
        }
      }
      if (!targetRes) throw new Error('Target table not found');

      let targetOrderId = targetRes.orders?.[0]?.id;
      if (!targetOrderId) {
        const oType = targetRes.type === 'BILLIARDS_TABLE' ? 'BILLIARDS' : targetRes.type === 'PS_ROOM' ? 'PS_ROOM' : 'DINE_IN';
        const newOrder = await api<Order>('/orders', {
          method: 'POST',
          body: { type: oType, resourceId: targetResourceId },
        });
        targetOrderId = newOrder.id;
      }

      const updated = await api<Order>(`/orders/${activeOrderId}/items/${orderItemId}/move`, {
        method: 'POST',
        body: { targetOrderId },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to transfer item');
    }
  }

  async function splitTimeCharge(orderItemId: string, seatsList: number[]) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/items/${orderItemId}/split-time`, {
        method: 'POST',
        body: { seats: seatsList },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to split time charge');
    }
  }

  function tapItem(item: MenuItem) {
    if (item.is86ed) return;
    if (item.modifierGroups.length > 0) setModItem(item);
    else void addItem(item);
  }

  async function voidItem(orderItemId: string, reason: string) {
    const updated = await api<Order>(`/orders/${activeOrderId}/void-item`, {
      method: 'POST',
      body: { orderItemId, reason },
    });
    setOrder(updated);
  }

  async function voidWholeOrder(reason: string) {
    setError('');
    try {
      await api(`/orders/${activeOrderId}/void`, { method: 'POST', body: { reason } });
      toFloor();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function applyDiscount(value: number, kind: 'PERCENT' | 'FIXED', reasonCode: string) {
    const updated = await api<Order>(`/orders/${activeOrderId}/discount`, {
      method: 'POST',
      body: { kind, value, reasonCode },
    });
    setOrder(updated);
  }

  async function toggleServiceDirect(approverPin?: string) {
    const updated = await api<Order>(`/orders/${activeOrderId}/tax-service`, {
      method: 'POST',
      body: { noService: !order!.noService, ...(approverPin ? { approverPin } : {}) },
    });
    setOrder(updated);
    setPinAction(null);
  }

  async function toggleVatDirect(approverPin?: string) {
    const updated = await api<Order>(`/orders/${activeOrderId}/tax-service`, {
      method: 'POST',
      body: { noVat: !order!.noVat, ...(approverPin ? { approverPin } : {}) },
    });
    setOrder(updated);
    setPinAction(null);
  }

  function handleToggleService() {
    setError('');
    if (can(user, 'discount.apply')) {
      void toggleServiceDirect();
    } else {
      setPinAction('service');
    }
  }

  function handleToggleVat() {
    setError('');
    if (can(user, 'discount.apply')) {
      void toggleVatDirect();
    } else {
      setPinAction('vat');
    }
  }

  async function handleUpdateItemNote(orderItemId: string, notes: string) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/items/${orderItemId}/note`, {
        method: 'POST',
        body: { notes },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update note');
    }
  }

  async function handleUpdateItemQuantity(orderItemId: string, quantity: number) {
    setError('');
    try {
      const updated = await api<Order>(`/orders/${activeOrderId}/items/${orderItemId}/quantity`, {
        method: 'POST',
        body: { quantity },
      });
      setOrder(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update quantity');
    }
  }

  async function transferTo(resourceId: string) {
    setError('');
    setMoving(false);
    try {
      // an active timer must move together with the order — the sessions endpoint does both
      const session = await api<{ id: string; status: string } | null>(`/sessions/by-order/${activeOrderId}`);
      if (session && (session.status === 'RUNNING' || session.status === 'PAUSED')) {
        await api(`/sessions/${session.id}/transfer`, { method: 'POST', body: { toResourceId: resourceId } });
      } else {
        await api(`/orders/${activeOrderId}/transfer`, { method: 'POST', body: { toResourceId: resourceId } });
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function fireCourse(c: number) {
    setError('');
    setActionsOpen(false);
    try {
      await api(`/kds/orders/${activeOrderId}/fire`, { method: 'POST', body: { course: c } });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function showReceipt() {
    const res = await api<{ text: string }>(`/orders/${activeOrderId}/receipt`);
    setReceipt(res.text);
  }

  // leaving an untouched order cancels it so the table doesn't stay occupied
  function leave() {
    const activeItems = order ? order.items.filter((i) => i.status !== 'VOIDED') : [];
    if (order && order.status === 'OPEN' && activeItems.length === 0) {
      void api(`/orders/${order.id}/abandon`, { method: 'POST' }).catch(() => {});
    }
    toFloor();
  }

  if (!order) return <div className="flex h-screen items-center justify-center bg-goblin-950 text-goblin-50">…</div>;

  const isSessionOrder = order.type === 'BILLIARDS' || order.type === 'PS_ROOM';
  const isPaid = order.status === 'PAID';
  const hasPayments = (order.payments ?? []).some((p) => p.amountCents > 0);
  const laterCourses = [...new Set(
    order.items.filter((i) => i.status !== 'VOIDED' && (i.course ?? 1) > 1).map((i) => i.course as number),
  )].sort((a, b) => a - b);

  // seat tabs: always offer one empty seat beyond the highest in use (cap 8)
  const usedSeats = order.items.filter((i) => i.status !== 'VOIDED').map((i) => i.seat ?? 0);
  const seatTabs = Array.from({ length: Math.min(8, Math.max(2, Math.max(0, ...usedSeats) + 1)) }, (_, i) => i + 1);
  const visibleItems = seat === 0 ? order.items : order.items.filter((l) => (l.seat ?? 0) === seat);
  const seatItems = order.items.filter((l) => l.status !== 'VOIDED' && !l.isTimeCharge && (l.seat ?? 0) === seat);
  const otherItems = order.items.filter((l) => l.status !== 'VOIDED' && (l.seat ?? 0) !== seat);
  const seatCents = seatItems.reduce((a, l) => a + l.lineCents, 0);

  async function splitSeat() {
    setError('');
    try {
      const res = await api<{ child: { id: string } }>(`/orders/${order!.id}/split`, {
        method: 'POST', body: { orderItemIds: seatItems.map((l) => l.id) },
      });
      setSeat(0);
      openOrder(res.child.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  return (
    <div className="flex h-screen bg-goblin-950 text-goblin-50 flex-col md:flex-row overflow-hidden">
      {/* left: menu */}
      <div className={`flex-1 flex-col h-full max-h-screen overflow-hidden ${mobileTab === 'menu' ? 'flex' : 'hidden md:flex'}`}>
        <header className="flex items-center gap-2 border-b border-goblin-800 px-3 py-2">
          <button onClick={leave} className="rounded-xl bg-goblin-800 px-4 py-2">
            ← {t(lang, 'floor')}
          </button>
          <h1 className="text-lg font-bold">
            {t(lang, 'order')} #{order.number}
            <span className="ml-2 text-sm font-normal text-goblin-400">{order.type.replace('_', ' ')}</span>
          </h1>
          {isPaid && <span className="rounded bg-goblin-600 px-2 py-1 text-sm font-bold text-white">{t(lang, 'paid')}</span>}
          <div className="ms-auto flex items-center gap-2">
            <button
              onClick={() => setDisplaySettingsOpen(true)}
              className="rounded-xl bg-goblin-800 px-3 py-2 hover:bg-goblin-750 transition-colors"
              title={lang === 'ar' ? 'إعدادات العرض' : 'Display Settings'}
            >
              🎨
            </button>
            <button onClick={() => setCustomerOpen(true)}
              className={`rounded-xl px-4 py-2 ${order.customer ? 'bg-goblin-600 font-semibold text-white' : 'bg-goblin-800'}`}>
              👤 {order.customer ? order.customer.name : t(lang, 'customer')}
            </button>
            <button onClick={() => setActionsOpen(true)} className="rounded-xl bg-goblin-800 px-4 py-2">
              ⋯ {t(lang, 'actions')}
            </button>
          </div>
        </header>

        {error && <div className="bg-red-900/60 px-4 py-2 text-red-200">{error}</div>}

        {isSessionOrder && <SessionPanel order={order} onChanged={reload} />}

        {/* Categories and Grid layout container */}
        <div className="flex flex-1 overflow-hidden">
          {/* Category Sidebar */}
          <aside className="w-36 md:w-44 bg-goblin-900 border-e border-goblin-800 flex flex-col overflow-y-auto p-2 gap-1.5 shrink-0 select-none">
            {/* Course Selector */}
            {!isPaid && (
              <div className="flex items-center justify-between bg-goblin-950/40 rounded-xl p-1.5 mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-goblin-400 ps-1">
                  {lang === 'ar' ? 'ترتيب' : 'Course'}
                </span>
                <div className="flex gap-1">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCourse(n)}
                      className={`h-7 w-7 rounded-lg text-xs font-bold transition-all ${
                        course === n ? 'bg-goblin-500 text-white' : 'bg-goblin-900 text-goblin-400 hover:text-goblin-200'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Favorites virtual category */}
            <button
              onClick={() => {
                setActiveParentCat('favorites');
                setActiveSubCat(null);
                setActiveSubSubCat(null);
              }}
              className={`w-full text-left rounded-xl px-2.5 py-2 text-sm font-semibold transition-all ${
                activeParentCat === 'favorites' ? 'bg-amber-600 text-white font-bold' : 'bg-goblin-950/40 text-goblin-300 hover:bg-goblin-800'
              }`}
            >
              ★ {lang === 'ar' ? 'المفضلة' : 'Favorites'}
            </button>

            {/* Combos virtual category */}
            <button
              onClick={() => {
                setActiveParentCat('combos');
                setActiveSubCat(null);
                setActiveSubSubCat(null);
              }}
              className={`w-full text-left rounded-xl px-2.5 py-2 text-sm font-semibold transition-all ${
                activeParentCat === 'combos' ? 'bg-indigo-600 text-white font-bold' : 'bg-goblin-950/40 text-goblin-300 hover:bg-goblin-800'
              }`}
            >
              ★ {lang === 'ar' ? 'الوجبات المشتركة' : 'Combos'}
            </button>

            {/* Parent categories */}
            {menu
              .filter((c) => !c.parentCategoryId)
              .map((c) => {
                const isParentActive = activeParentCat === c.id;
                const subCats = menu.filter((sub) => sub.parentCategoryId === c.id);
                return (
                  <div key={c.id} className="space-y-1">
                    <button
                      onClick={() => {
                        setActiveParentCat(c.id);
                        if (c.items && c.items.length > 0) {
                          setActiveSubCat(c.id);
                        } else if (subCats.length > 0) {
                          setActiveSubCat(subCats[0]?.id || null);
                        } else {
                          setActiveSubCat(null);
                        }
                        setActiveSubSubCat(null);
                      }}
                      className={`w-full text-left rounded-xl px-2.5 py-2 text-sm font-semibold transition-all flex items-center justify-between ${
                        isParentActive ? 'bg-goblin-700 text-white font-bold' : 'bg-goblin-950/40 text-goblin-300 hover:bg-goblin-800'
                      }`}
                      style={
                        isParentActive && c.color
                          ? { backgroundColor: c.color }
                          : c.color
                          ? { borderLeft: `3px solid ${c.color}` }
                          : undefined
                      }
                    >
                      <span className="truncate">{lang === 'ar' && c.nameAr ? c.nameAr : c.name}</span>
                      {subCats.length > 0 && (
                        <span className="text-[8px] opacity-65">{isParentActive ? '▼' : '▶'}</span>
                      )}
                    </button>

                    {isParentActive && subCats.length > 0 && (
                      <div className="ps-2 border-l border-goblin-800 ms-1.5 space-y-1 my-1">
                        {c.items && c.items.length > 0 && (
                          <button
                            onClick={() => {
                              setActiveSubCat(c.id);
                              setActiveSubSubCat(null);
                            }}
                            className={`w-full text-left rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${
                              activeSubCat === c.id ? 'bg-goblin-800 text-emerald-400 font-semibold' : 'text-goblin-400 hover:bg-goblin-800/40'
                            }`}
                          >
                            • {lang === 'ar' ? 'عام' : 'General'}
                          </button>
                        )}
                        {subCats.map((sc) => {
                          const isSubActive = activeSubCat === sc.id;
                          const subSubCats = menu.filter((sub) => sub.parentCategoryId === sc.id);
                          return (
                            <div key={sc.id} className="space-y-1">
                              <button
                                onClick={() => {
                                  setActiveSubCat(sc.id);
                                  setActiveSubSubCat(null);
                                }}
                                className={`w-full text-left rounded-lg px-2 py-1.5 text-xs font-medium transition-all flex items-center justify-between ${
                                  isSubActive ? 'bg-goblin-800 text-emerald-400 font-semibold' : 'text-goblin-400 hover:bg-goblin-800/40'
                                }`}
                              >
                                <span className="truncate">{lang === 'ar' && sc.nameAr ? sc.nameAr : sc.name}</span>
                                {subSubCats.length > 0 && (
                                  <span className="text-[7px] opacity-65">{isSubActive ? '▼' : '▶'}</span>
                                )}
                              </button>

                              {isSubActive && subSubCats.length > 0 && (
                                <div className="ps-2 border-l border-goblin-700 ms-1 space-y-1">
                                  <button
                                    onClick={() => setActiveSubSubCat(null)}
                                    className={`w-full text-left rounded px-1.5 py-1 text-[10px] font-medium transition-all ${
                                      activeSubSubCat === null ? 'text-emerald-500 font-semibold' : 'text-goblin-500 hover:text-goblin-300'
                                    }`}
                                  >
                                    - {lang === 'ar' ? 'الكل' : 'All'}
                                  </button>
                                  {subSubCats.map((ssc) => (
                                    <button
                                      key={ssc.id}
                                      onClick={() => setActiveSubSubCat(ssc.id)}
                                      className={`w-full text-left rounded px-1.5 py-1 text-[10px] font-medium transition-all ${
                                        activeSubSubCat === ssc.id ? 'text-emerald-500 font-semibold' : 'text-goblin-500 hover:text-goblin-300'
                                      }`}
                                    >
                                      - {lang === 'ar' && ssc.nameAr ? ssc.nameAr : ssc.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
          </aside>

          {/* Right items grid area */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Menu Items Grid */}
            <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-auto p-3 sm:grid-cols-3 lg:grid-cols-4">
              {(() => {
                if (activeParentCat === 'combos') {
                  return combos.map((combo) => (
                    <button
                      key={combo.id}
                      onClick={() => void addCombo(combo)}
                      disabled={isPaid}
                      className="flex min-h-20 flex-col items-center justify-center rounded-xl p-2 text-center shadow transition-all bg-goblin-800 hover:bg-goblin-750 active:bg-goblin-600"
                    >
                      <span className="font-semibold leading-tight">
                        {lang === 'ar' && combo.nameAr ? combo.nameAr : combo.name}
                      </span>
                      <span className="mt-1 text-sm text-goblin-300">{fmtMoney(combo.priceCents, lang)}</span>
                    </button>
                  ));
                }

                const itemsToDisplay = (() => {
                  if (activeParentCat === 'favorites') {
                    // Extract favorites across all categories without duplicates
                    const uniqueFavorites = new Map<string, MenuItem>();
                    menu.forEach((c) => {
                      c.items.forEach((item) => {
                        if (item.isFavorite) {
                          uniqueFavorites.set(item.id, item);
                        }
                      });
                    });
                    return Array.from(uniqueFavorites.values());
                  } else {
                    const subCats = menu.filter((c) => c.parentCategoryId === activeParentCat);
                    if (subCats.length > 0) {
                      // If we are explicitly displaying the parent's general items
                      if (activeSubCat === activeParentCat) {
                        const currentParent = menu.find((c) => c.id === activeParentCat);
                        return currentParent ? currentParent.items : [];
                      }

                      const currentSub = subCats.find((c) => c.id === activeSubCat) || subCats[0];
                      if (!currentSub) return [];

                      // If a specific Level 3 subcategory is selected, return its items directly
                      if (activeSubSubCat) {
                        const selectedSSC = menu.find((c) => c.id === activeSubSubCat);
                        return selectedSSC ? selectedSSC.items : [];
                      }

                      // By default (or if "All" is active), return items of this subcategory
                      // plus items of any of its children categories (Level 3)
                      let items = [...currentSub.items];
                      const level3Cats = menu.filter((c) => c.parentCategoryId === currentSub.id);
                      for (const l3 of level3Cats) {
                        items.push(...l3.items);
                      }
                      return items;
                    } else {
                      const currentParent = menu.find((c) => c.id === activeParentCat);
                      return currentParent ? currentParent.items : [];
                    }
                  }
                })();

                return itemsToDisplay.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => tapItem(item)}
                    disabled={isPaid || item.is86ed}
                    className={`flex min-h-20 flex-col items-center justify-center rounded-xl p-2 text-center shadow transition-all ${
                      item.is86ed
                        ? 'bg-goblin-900 opacity-40 line-through'
                        : 'bg-goblin-800 hover:bg-goblin-750 active:bg-goblin-600'
                    }`}
                  >
                    <span className="font-semibold leading-tight">
                      {lang === 'ar' && item.nameAr ? item.nameAr : item.name}
                    </span>
                    <span className="mt-1 text-sm text-goblin-300">{fmtMoney(item.priceCents, lang)}</span>
                  </button>
                ));
              })()}
            </div>

            {/* Mobile Cart Toggle Button */}
            <div className="md:hidden p-3 border-t border-goblin-800 bg-goblin-900">
              <button
                onClick={() => setMobileTab('cart')}
                className="w-full rounded-xl bg-goblin-600 py-3.5 font-bold text-center flex justify-between px-4 text-sm text-white hover:bg-goblin-500 transition-colors"
              >
                <span>🛒 {lang === 'ar' ? 'عرض الطلب' : 'View Order'} ({order.items.length})</span>
                <span>{fmtMoney(order.totalCents, lang)}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* right: cart */}
      <div className={`w-full md:w-80 flex-col h-full max-h-screen overflow-hidden border-s border-goblin-800 bg-goblin-900/50 ${mobileTab === 'cart' ? 'flex' : 'hidden md:flex'}`}>
        {/* Mobile Back to Menu Header */}
        <div className="md:hidden p-3 border-b border-goblin-800 bg-goblin-900 flex items-center justify-between">
          <button
            onClick={() => setMobileTab('menu')}
            className="rounded-xl bg-goblin-800 px-4 py-2 text-sm font-semibold active:bg-goblin-700"
          >
            ← {lang === 'ar' ? 'العودة للمنيو' : 'Back to Menu'}
          </button>
          <span className="font-bold text-goblin-300">#{order.number}</span>
        </div>
        {(order.resourceId || order.type === 'DINE_IN' || order.type === 'BILLIARDS' || order.type === 'PS_ROOM') && (
          <div className="border-b border-goblin-800">
            <div className="flex gap-1 overflow-x-auto p-2">
              <button onClick={() => setSeat(0)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${seat === 0 ? 'bg-goblin-500' : 'bg-goblin-900 text-goblin-400'}`}>
                {t(lang, 'wholeTable')}
              </button>
              {seatTabs.map((n) => (
                <button key={n} onClick={() => setSeat(n)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${seat === n ? 'bg-goblin-500' : 'bg-goblin-900 text-goblin-400'}`}>
                  {t(lang, 'seat')} {n}
                </button>
              ))}
            </div>
            {seat > 0 && (
              <div className="flex items-center justify-between bg-goblin-950/20 px-3 py-2 text-xs">
                <span className="font-semibold text-goblin-400">Seat Customer:</span>
                <button
                  onClick={() => setSeatCustomerOpen(true)}
                  className="rounded bg-goblin-800 px-2.5 py-1 font-bold hover:bg-goblin-750"
                >
                  👤 {order.seatCustomers?.find((sc) => sc.seat === seat)?.customer?.name || 'Assign'}
                </button>
              </div>
            )}
          </div>
        )}
        <div className="flex-1 overflow-auto p-2">
          {visibleItems.map((line) => (
            <div
              key={line.id}
              className={`mb-1 rounded-lg p-2 ${line.status === 'VOIDED' ? 'opacity-40 line-through' : 'bg-goblin-900'}`}
            >
              <div className="flex justify-between">
                <span>
                  {Number(line.quantity) !== 1 && <b>{Number(line.quantity)}× </b>}
                  {line.description}
                  {(line.course ?? 1) > 1 && <span className="ms-1 rounded bg-goblin-700 px-1 text-xs">C{line.course}</span>}
                  {seat === 0 && (line.seat ?? 0) > 0 && <span className="ms-1 rounded bg-sky-900 px-1 text-xs">S{line.seat}</span>}
                </span>
                <span>{fmtMoney(line.lineCents, lang)}</span>
              </div>
              {line.modifiers.map((m) => (
                <div key={m.id} className="ms-3 text-sm text-goblin-400">
                  + {m.name} {m.priceCents > 0 && fmtMoney(m.priceCents, lang)}
                </div>
              ))}
              {line.notes && <div className="ms-3 text-sm italic text-goblin-400">{line.notes}</div>}
              {!isPaid && line.status !== 'VOIDED' && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!line.isTimeCharge && can(user, 'order.void') && (
                    <button onClick={() => setVoiding(line.id)} className="rounded-lg bg-red-950/40 text-red-400 border border-red-900/30 px-2.5 py-1 text-xs font-semibold hover:bg-red-900/30 transition-all active:scale-95">
                      {t(lang, 'voidItem')}
                    </button>
                  )}
                  {!line.isTimeCharge && (
                    <button onClick={() => setMovingItem(line)} className="rounded-lg bg-sky-950/40 text-sky-400 border border-sky-900/30 px-2.5 py-1 text-xs font-semibold hover:bg-sky-900/30 transition-all active:scale-95">
                      {lang === 'ar' ? 'نقل' : 'Move'}
                    </button>
                  )}
                  {!line.isTimeCharge && (
                    <button onClick={() => setQuantityEditingItem(line)} className="rounded-lg bg-emerald-950/40 text-emerald-400 border border-emerald-900/30 px-2.5 py-1 text-xs font-semibold hover:bg-emerald-900/30 transition-all active:scale-95">
                      {lang === 'ar' ? 'كمية' : 'Qty'}
                    </button>
                  )}
                  {!line.isTimeCharge && (
                    <button onClick={() => setCommentingItem(line)} className="rounded-lg bg-amber-950/40 text-amber-400 border border-amber-900/30 px-2.5 py-1 text-xs font-semibold hover:bg-amber-900/30 transition-all active:scale-95">
                      {lang === 'ar' ? 'تعليق' : 'Comment'}
                    </button>
                  )}
                  {line.isTimeCharge && (
                    <button onClick={() => {
                      setSplittingTimeItem(line);
                      setSelectedTimeSeats([]);
                    }} className="rounded-lg bg-sky-950/40 text-sky-400 border border-sky-900/30 px-2.5 py-1 text-xs font-semibold hover:bg-sky-900/30 transition-all active:scale-95">
                      {lang === 'ar' ? 'تقسيم الوقت' : 'Split Time'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-1 border-t border-goblin-800 p-3 font-mono text-sm">
          {seat > 0 && (
            <>
              <Row k={`${t(lang, 'seat')} ${seat}`} v={fmtMoney(seatCents, lang)} />
              {!isPaid && seatItems.length > 0 && otherItems.length > 0 && can(user, 'order.split') && (
                <button onClick={() => void splitSeat()}
                  className="w-full rounded-lg bg-goblin-700 py-2 font-sans text-xs font-semibold">
                  ⑂ {t(lang, 'splitSeat')}
                </button>
              )}
            </>
          )}
          <Row k={t(lang, 'subtotal')} v={fmtMoney(order.subtotalCents, lang)} />
          {order.discountCents > 0 && <Row k={t(lang, 'discount')} v={`-${fmtMoney(order.discountCents, lang)}`} />}
          {(order.serviceChargeCents > 0 || order.noService) && (
            <div className="flex justify-between text-goblin-300">
              <span>{t(lang, 'service')}{order.noService ? ` (${lang === 'ar' ? 'ملغاة' : 'Removed'})` : ''}</span>
              <div className="flex items-center gap-2">
                <span>{fmtMoney(order.serviceChargeCents, lang)}</span>
                {!isPaid && (
                  <button
                    onClick={handleToggleService}
                    className="text-xs font-sans text-goblin-400 hover:text-red-400 underline"
                  >
                    {order.noService ? t(lang, 'addService') : t(lang, 'removeService')}
                  </button>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-between text-goblin-300">
            <span>{t(lang, 'vat')}{order.noVat ? ` (${lang === 'ar' ? 'ملغاة' : 'Removed'})` : ''}</span>
            <div className="flex items-center gap-2">
              <span>{fmtMoney(order.taxCents, lang)}</span>
              {!isPaid && (
                <button
                  onClick={handleToggleVat}
                  className="text-xs font-sans text-goblin-400 hover:text-red-400 underline"
                >
                  {order.noVat ? t(lang, 'addVat') : t(lang, 'removeVat')}
                </button>
              )}
            </div>
          </div>
          <div className="flex justify-between border-t border-goblin-700 pt-1 text-lg font-bold">
            <span>{t(lang, 'total')}</span>
            <span>{fmtMoney(order.totalCents, lang)}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 pt-0">
          {!isPaid && order.items.some((i) => i.status === 'PENDING') && (
            <button
              onClick={() => void api(`/kds/orders/${order.id}/send`, { method: 'POST' })
                .then(reload)
                .catch((e) => setError(e instanceof Error ? e.message : 'Send failed'))}
              className="col-span-2 rounded-xl bg-amber-600 py-3 font-bold text-white active:bg-amber-500"
            >
              ➤ {t(lang, 'send')}
            </button>
          )}
          {!isPaid && can(user, 'discount.apply') && (
            <button onClick={() => setDiscounting(true)} className="rounded-xl bg-goblin-800 py-3">
              {t(lang, 'discount')}
            </button>
          )}
          <button onClick={() => void showReceipt()} className="rounded-xl bg-goblin-800 py-3">
            {t(lang, 'receipt')}
          </button>
          {isPaid && (
            <button onClick={() => setFeedbackOpen(true)} className="rounded-xl bg-goblin-800 py-3">
              ★ {t(lang, 'feedback')}
            </button>
          )}
          {!isPaid && can(user, 'payment.take') && (
            <button
              onClick={() => {
                if (order.totalCents === 0) {
                  void api(`/orders/${order.id}/pay`, {
                    method: 'POST',
                    body: { payments: [] },
                  })
                    .then(async () => {
                      await reload();
                      await showReceipt();
                    })
                    .catch((e) => setError(e instanceof Error ? e.message : 'Checkout failed'));
                } else {
                  setPaying(true);
                }
              }}
              disabled={order.items.filter((i) => i.status !== 'VOIDED').length === 0}
              className="col-span-2 rounded-xl bg-goblin-500 py-4 text-xl font-bold text-white active:bg-goblin-400 disabled:opacity-40"
            >
              {order.totalCents === 0 ? (lang === 'ar' ? 'إنهاء الطلب' : 'Checkout') : `${t(lang, 'pay')} ${fmtMoney(order.totalCents - order.paidCents, lang)}`}
            </button>
          )}
        </div>
      </div>

      {actionsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setActionsOpen(false)}>
          <div className="w-full max-w-sm space-y-2 rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-lg font-bold">{t(lang, 'actions')} — #{order.number}</h2>
            {!isPaid && can(user, 'order.split') && order.items.filter((i) => i.status !== 'VOIDED' && !i.isTimeCharge).length > 1 && (
              <ActionBtn onClick={() => { setActionsOpen(false); setSplitting(true); }}>⑂ {t(lang, 'splitBill')}</ActionBtn>
            )}
            {!isPaid && can(user, 'order.split') && (
              <ActionBtn onClick={() => { setActionsOpen(false); setMerging(true); }}>⇥ {t(lang, 'mergeInto')}</ActionBtn>
            )}
            {!isPaid && order.resourceId && can(user, 'order.transfer') && (
              <ActionBtn onClick={() => { setActionsOpen(false); setMoving(true); }}>⇄ {t(lang, 'moveTable')}</ActionBtn>
            )}
            {laterCourses.map((c) => (
              <ActionBtn key={c} onClick={() => void fireCourse(c)}>🔥 {t(lang, 'fireCourse')} (C{c})</ActionBtn>
            ))}
            {hasPayments && can(user, 'payment.refund') && (
              <ActionBtn danger onClick={() => { setActionsOpen(false); setRefunding(true); }}>↩ {t(lang, 'refund')}</ActionBtn>
            )}
            {!isPaid && !hasPayments && can(user, 'order.void') && (
              <ActionBtn danger onClick={() => { setActionsOpen(false); setVoidingOrder(true); }}>✕ {t(lang, 'voidOrder')}</ActionBtn>
            )}
            <button onClick={() => setActionsOpen(false)} className="mt-2 w-full rounded-xl bg-goblin-800 py-3">
              {t(lang, 'close')}
            </button>
          </div>
        </div>
      )}

      {modItem && (
        <ModifierDialog
          item={modItem}
          onConfirm={(ids) => { void addItem(modItem, ids); setModItem(null); }}
          onClose={() => setModItem(null)}
        />
      )}
      {paying && (
        <PayDialog
          order={order}
          methods={methods}
          onPaid={async () => { setPaying(false); await reload(); await showReceipt(); }}
          onClose={() => setPaying(false)}
        />
      )}
      {receipt && <ReceiptDialog text={receipt} onClose={() => setReceipt(null)} />}
      {voiding && (
        <PromptDialog
          title={t(lang, 'voidReason')}
          onConfirm={(reason) => { void voidItem(voiding, reason); setVoiding(null); }}
          onClose={() => setVoiding(null)}
        />
      )}
      {voidingOrder && (
        <PromptDialog
          title={t(lang, 'voidOrder')}
          onConfirm={(reason) => { void voidWholeOrder(reason); setVoidingOrder(false); }}
          onClose={() => setVoidingOrder(false)}
        />
      )}
      {discounting && (
        <PromptDialog
          title={t(lang, 'discountReason')}
          extraNumber="%"
          onConfirmWithNumber={(reason, pct) => {
            void applyDiscount(Math.round(pct * 100), 'PERCENT', reason);
            setDiscounting(false);
          }}
          onClose={() => setDiscounting(false)}
        />
      )}
      {splitting && (
        <SplitDialog order={order}
          onSplit={(childId) => { setSplitting(false); openOrder(childId); }}
          onClose={() => setSplitting(false)} />
      )}
      {merging && (
        <MergeDialog sourceOrderId={order.id}
          onMerged={(targetId) => { setMerging(false); openOrder(targetId); }}
          onClose={() => setMerging(false)} />
      )}
      {moving && (
        <ResourcePicker title={t(lang, 'moveTable')} excludeResourceId={order.resourceId}
          onPick={(rid) => void transferTo(rid)}
          onClose={() => setMoving(false)} />
      )}
      {refunding && (
        <RefundDialog order={order}
          onDone={async () => { setRefunding(false); await reload(); }}
          onClose={() => setRefunding(false)} />
      )}
      {customerOpen && (
        <CustomerDialog order={order}
          onChanged={() => void reload()}
          onClose={() => setCustomerOpen(false)} />
      )}
      {feedbackOpen && <FeedbackDialog orderId={order.id} onClose={() => setFeedbackOpen(false)} />}
      {seatCustomerOpen && (
        <CustomerDialog
          order={order}
          seat={seat}
          onChanged={() => void reload()}
          onClose={() => setSeatCustomerOpen(false)}
        />
      )}
      {movingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setMovingItem(null)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Move Item</h2>
            <p className="text-sm text-goblin-300">Select target seat or table for:<br/><b>{movingItem.description}</b></p>
            
            <div>
              <p className="mb-2 text-xs font-semibold text-goblin-400 uppercase">Seats</p>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={async () => {
                    await moveItemToSeat(movingItem.id, null);
                    setMovingItem(null);
                  }}
                  className="rounded-lg bg-goblin-800 py-2 text-xs font-semibold hover:bg-goblin-750"
                >
                  Whole Table
                </button>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                  <button
                    key={s}
                    onClick={async () => {
                      await moveItemToSeat(movingItem.id, s);
                      setMovingItem(null);
                    }}
                    className="rounded-lg bg-goblin-800 py-2 text-xs font-semibold hover:bg-goblin-750"
                  >
                    Seat {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="border-t border-goblin-800 pt-3">
              <button
                onClick={() => {
                  setMovingItemTablePicker(true);
                }}
                className="w-full rounded-xl bg-sky-700 py-3 font-bold hover:bg-sky-650"
              >
                ⇄ Transfer to Another Table
              </button>
            </div>

            <button onClick={() => setMovingItem(null)} className="w-full rounded-xl bg-goblin-800 py-3 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}
      {movingItemTablePicker && movingItem && (
        <ResourcePicker
          title="Select Destination Table"
          excludeResourceId={order.resourceId}
          onPick={async (rid) => {
            setMovingItemTablePicker(false);
            await moveItemToTable(movingItem.id, rid);
            setMovingItem(null);
          }}
          onClose={() => setMovingItemTablePicker(false)}
        />
      )}
      {splittingTimeItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setSplittingTimeItem(null)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-goblin-900 border border-goblin-800 p-5 text-goblin-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold">Split Time Charge</h2>
            <p className="text-sm text-goblin-300">Select seats to share this time charge:</p>
            
            <div className="grid grid-cols-2 gap-2">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => {
                const isSelected = selectedTimeSeats.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedTimeSeats(selectedTimeSeats.filter((x) => x !== s));
                      } else {
                        setSelectedTimeSeats([...selectedTimeSeats, s]);
                      }
                    }}
                    className={`rounded-lg py-2 text-sm font-semibold border transition-all ${
                      isSelected ? 'bg-goblin-500 border-goblin-400' : 'bg-goblin-800 border-transparent text-goblin-300'
                    }`}
                  >
                    Seat {s}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 border-t border-goblin-800 pt-3">
              <button onClick={() => setSplittingTimeItem(null)} className="flex-1 rounded-xl bg-goblin-800 py-3 text-sm">
                Cancel
              </button>
              <button
                disabled={selectedTimeSeats.length === 0}
                onClick={async () => {
                  await splitTimeCharge(splittingTimeItem.id, selectedTimeSeats);
                  setSplittingTimeItem(null);
                }}
                className="flex-1 rounded-xl bg-sky-700 py-3 font-bold hover:bg-sky-650 disabled:opacity-40"
              >
                Confirm Split
              </button>
            </div>
          </div>
        </div>
      )}
      {pinAction && (
        <AdminPinDialog
          onConfirm={async (pin) => {
            if (pinAction === 'service') {
              await toggleServiceDirect(pin);
            } else if (pinAction === 'vat') {
              await toggleVatDirect(pin);
            }
          }}
          onClose={() => setPinAction(null)}
        />
      )}
      {quantityEditingItem && (
        <QuantityDialog
          initialValue={Number(quantityEditingItem.quantity)}
          description={quantityEditingItem.description}
          onConfirm={async (val) => {
            await handleUpdateItemQuantity(quantityEditingItem.id, val);
            setQuantityEditingItem(null);
          }}
          onClose={() => setQuantityEditingItem(null)}
        />
      )}
      {commentingItem && (
        <PromptDialog
          title={t(lang, 'itemComment')}
          onConfirm={async (notes) => {
            await handleUpdateItemNote(commentingItem.id, notes);
            setCommentingItem(null);
          }}
          onClose={() => setCommentingItem(null)}
        />
      )}
      {displaySettingsOpen && (
        <DisplaySettingsDialog onClose={() => setDisplaySettingsOpen(false)} />
      )}
    </div>
  );
}

function ActionBtn({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick}
      className={`w-full rounded-xl py-3 text-start ps-4 font-semibold ${danger ? 'bg-red-900/60 text-red-200' : 'bg-goblin-800'}`}>
      {children}
    </button>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-goblin-300">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
}
