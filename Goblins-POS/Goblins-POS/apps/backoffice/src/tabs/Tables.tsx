import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, TextInput, useLoad } from '../lib/ui';

interface AdminResource {
  id: string; name: string; nameAr?: string | null; type: string; capacity: number;
  shape: string; posX: number; posY: number; width: number; height: number;
  isActive: boolean; status: string;
  ratePlan?: { id: string; name: string } | null; ratePlanId?: string | null; zoneId?: string | null;
}
interface AdminZone { id: string; name: string; nameAr?: string | null; resources: AdminResource[] }
interface RatePlanRef { id: string; name: string }

const TYPES = [
  { value: 'RESTAURANT_TABLE', label: 'Restaurant table' },
  { value: 'BILLIARDS_TABLE', label: 'Billiards table' },
  { value: 'PS_ROOM', label: 'PlayStation room' },
];

const VIEWS = ['list', 'layout'] as const;

export function TablesView() {
  const { data: zones, error, reload } = useLoad(() => api<AdminZone[]>('/admin/zones'));
  const { data: ratePlans } = useLoad(() => api<RatePlanRef[]>('/admin/rate-plans'));
  const [view, setView] = useState<(typeof VIEWS)[number]>('list');
  const [editing, setEditing] = useState<AdminResource | null>(null);
  const [duplicating, setDuplicating] = useState<AdminResource | null>(null);
  const [creatingIn, setCreatingIn] = useState<AdminZone | null>(null);
  const [editingZone, setEditingZone] = useState<AdminZone | null>(null);
  const [newZoneOpen, setNewZoneOpen] = useState(false);
  const [err, setErr] = useState('');

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!zones) return <Spinner />;

  if (view === 'layout') {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Pills value={view} onChange={setView} options={VIEWS} />
          <p className="text-sm text-goblin-400">Drag tables to rearrange — positions save when you drop.</p>
        </div>
        {zones.map((zone) => (
          <ZoneCanvas key={zone.id} zone={zone} onEdit={setEditing} />
        ))}
        {editing && (
          <ResourceModal resource={editing} zones={zones} ratePlans={ratePlans ?? []}
            onClose={() => setEditing(null)}
            onDone={() => { setEditing(null); reload(); }} />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Pills value={view} onChange={setView} options={VIEWS} />
        <Btn kind="primary" onClick={() => setNewZoneOpen(true)}>+ New zone</Btn>
        <ErrorBanner message={err} />
      </div>
      {zones.map((zone) => (
        <div key={zone.id}>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-goblin-100">{zone.name}{zone.nameAr ? ` · ${zone.nameAr}` : ''}</h2>
              <button onClick={() => setEditingZone(zone)} className="text-xs text-goblin-400 hover:text-goblin-200 underline font-medium">
                Edit zone
              </button>
            </div>
            <Btn onClick={() => setCreatingIn(zone)}>+ Add table</Btn>
          </div>
          <div className="overflow-hidden rounded-xl bg-goblin-900 shadow">
            <table className="w-full text-sm">
              <thead className="bg-goblin-800 text-left text-goblin-300">
                <tr>
                  <th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Capacity</th>
                  <th className="p-3">Rate plan</th><th className="p-3">Position / size</th><th className="p-3">Status</th><th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {zone.resources.map((r) => (
                  <tr key={r.id} className={`border-t ${r.isActive ? '' : 'opacity-40'}`}>
                    <td className="p-3 font-semibold text-goblin-100">{r.name}{r.nameAr ? ` · ${r.nameAr}` : ''}</td>
                    <td className="p-3">{TYPES.find((t) => t.value === r.type)?.label ?? r.type}</td>
                    <td className="p-3">{r.capacity}</td>
                    <td className="p-3">{r.ratePlan?.name ?? '—'}</td>
                    <td className="p-3 font-mono text-xs text-goblin-300">
                      ({r.posX}, {r.posY}) {r.width}×{r.height} {r.shape}
                    </td>
                    <td className="p-3 text-xs">{r.isActive ? r.status : 'INACTIVE'}</td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <Btn onClick={() => setEditing(r)}>Edit</Btn>
                        <Btn onClick={() => setDuplicating(r)}>Duplicate</Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!zone.resources.length && <p className="p-4 text-sm text-goblin-400">No tables in this zone</p>}
          </div>
        </div>
      ))}
      {editing && (
        <ResourceModal resource={editing} zones={zones} ratePlans={ratePlans ?? []}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); setErr(''); reload(); }} />
      )}
      {duplicating && (
        <ResourceModal duplicateFrom={duplicating} zones={zones} ratePlans={ratePlans ?? []}
          onClose={() => setDuplicating(null)}
          onDone={() => { setDuplicating(null); setErr(''); reload(); }} />
      )}
      {creatingIn && (
        <ResourceModal zone={creatingIn} zones={zones} ratePlans={ratePlans ?? []}
          onClose={() => setCreatingIn(null)}
          onDone={() => { setCreatingIn(null); setErr(''); reload(); }} />
      )}
      {newZoneOpen && (
        <NewZoneModal onClose={() => setNewZoneOpen(false)} onDone={() => { setNewZoneOpen(false); reload(); }} />
      )}
      {editingZone && (
        <EditZoneModal zone={editingZone} onClose={() => setEditingZone(null)} onDone={() => { setEditingZone(null); reload(); }} />
      )}
    </div>
  );
}

/** Visual per-zone editor: drag tables; geometry saves on drop. Double-click opens the edit form. */
function ZoneCanvas({ zone, onEdit }: { zone: AdminZone; onEdit: (r: AdminResource) => void }) {
  const [geom, setGeom] = useState<Record<string, { x: number; y: number; w: number; h: number }>>(
    Object.fromEntries(zone.resources.map((r) => [r.id, { x: r.posX, y: r.posY, w: r.width, h: r.height }])),
  );
  const geomRef = useRef(geom);
  geomRef.current = geom;
  const drag = useRef<{
    mode: 'move' | 'resize';
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const [err, setErr] = useState('');
  const [savedFlash, setSavedFlash] = useState('');

  useEffect(() => {
    setGeom(Object.fromEntries(zone.resources.map((r) => [r.id, { x: r.posX, y: r.posY, w: r.width, h: r.height }])));
  }, [zone]);

  function downMove(e: React.PointerEvent, r: AdminResource) {
    if ((e.target as Element).closest('.resize-handle')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = geomRef.current[r.id] ?? { x: r.posX, y: r.posY, w: r.width, h: r.height };
    drag.current = {
      mode: 'move',
      id: r.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: g.x,
      origY: g.y,
      origW: g.w,
      origH: g.h,
    };
  }

  function downResize(e: React.PointerEvent, r: AdminResource) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const g = geomRef.current[r.id] ?? { x: r.posX, y: r.posY, w: r.width, h: r.height };
    drag.current = {
      mode: 'resize',
      id: r.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: g.x,
      origY: g.y,
      origW: g.w,
      origH: g.h,
    };
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;

    const grid = 20;

    if (d.mode === 'move') {
      const rawX = d.origX + e.clientX - d.startX;
      const rawY = d.origY + e.clientY - d.startY;
      const snappedX = Math.max(0, Math.round(rawX / grid) * grid);
      const snappedY = Math.max(0, Math.round(rawY / grid) * grid);

      setGeom((cur) => ({
        ...cur,
        [d.id]: {
          ...cur[d.id]!,
          x: snappedX,
          y: snappedY,
        },
      }));
    } else if (d.mode === 'resize') {
      const rawW = d.origW + e.clientX - d.startX;
      const rawH = d.origH + e.clientY - d.startY;
      const snappedW = Math.max(40, Math.round(rawW / grid) * grid);
      const snappedH = Math.max(40, Math.round(rawH / grid) * grid);

      setGeom((cur) => ({
        ...cur,
        [d.id]: {
          ...cur[d.id]!,
          w: snappedW,
          h: snappedH,
        },
      }));
    }
  }

  async function up() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const g = geomRef.current[d.id];
    if (!g) return;
    setErr('');
    try {
      await api(`/floor/resources/${d.id}/geometry`, {
        method: 'PATCH',
        body: { posX: g.x, posY: g.y, width: g.w, height: g.h }
      });
      setSavedFlash(d.id);
      setTimeout(() => setSavedFlash(''), 800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    }
  }

  const height = Math.max(240, ...zone.resources.map((r) => (geom[r.id]?.y ?? r.posY) + (geom[r.id]?.h ?? r.height))) + 30;
  return (
    <div>
      <h2 className="mb-2 font-semibold text-goblin-100">{zone.name}</h2>
      <ErrorBanner message={err} />
      <div className="relative w-full overflow-auto rounded-xl bg-goblin-900/90 shadow" style={{ height }}>
        {zone.resources.map((r) => {
          const g = geom[r.id] ?? { x: r.posX, y: r.posY, w: r.width, h: r.height };
          return (
            <div key={r.id}
              onPointerDown={(e) => downMove(e, r)} onPointerMove={move} onPointerUp={() => void up()}
              onDoubleClick={() => onEdit(r)}
              title={`${r.name} — drag to move, drag corner to resize, double-click to edit`}
              className={`absolute flex cursor-grab select-none items-center justify-center border-2 text-xs font-semibold text-white active:cursor-grabbing ${savedFlash === r.id ? 'border-yellow-300' : 'border-goblin-600'} ${r.shape === 'circle' ? 'rounded-full' : 'rounded-lg'} ${r.isActive ? 'bg-goblin-600' : 'bg-goblin-800 opacity-60'}`}
              style={{ left: g.x, top: g.y, width: g.w, height: g.h, touchAction: 'none' }}>
              {r.name}
              
              <div
                onPointerDown={(e) => downResize(e, r)}
                className="resize-handle absolute right-0 bottom-0 w-4 h-4 cursor-se-resize bg-goblin-900/20 hover:bg-goblin-900/50 rounded-tl-md flex items-center justify-center text-[9px] text-white/70 select-none"
                style={{ touchAction: 'none' }}
              >
                ⇲
              </div>
            </div>
          );
        })}
        {!zone.resources.length && <p className="p-4 text-sm text-goblin-400/60">No tables in this zone</p>}
      </div>
    </div>
  );
}

function NewZoneModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [err, setErr] = useState('');
  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    try {
      await api('/admin/zones', { method: 'POST', body: { name: name.trim(), nameAr: nameAr.trim() || undefined } });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }
  return (
    <Modal title="New zone" onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Btn kind="primary" onClick={() => void submit()}>Create zone</Btn>
      </div>
    </Modal>
  );
}

function EditZoneModal({ zone, onClose, onDone }: { zone: AdminZone; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(zone.name);
  const [nameAr, setNameAr] = useState(zone.nameAr ?? '');
  const [sortOrder, setSortOrder] = useState(String(zone.resources[0]?.zoneId ? (zone as any).sortOrder ?? 0 : 0));
  const [err, setErr] = useState('');

  useEffect(() => {
    // Get the actual sortOrder (the custom field)
    setName(zone.name);
    setNameAr(zone.nameAr ?? '');
    setSortOrder(String((zone as any).sortOrder ?? 0));
  }, [zone]);

  async function submit() {
    if (!name.trim()) { setErr('Name is required'); return; }
    const order = Number(sortOrder);
    if (!Number.isInteger(order)) { setErr('Sort order must be an integer'); return; }
    try {
      await api(`/admin/zones/${zone.id}`, {
        method: 'PATCH',
        body: { name: name.trim(), nameAr: nameAr.trim() || null, sortOrder: order },
      });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  async function handleDelete() {
    if (!confirm(`Are you sure you want to delete zone "${zone.name}"?`)) return;
    try {
      await api(`/admin/zones/${zone.id}`, { method: 'DELETE' });
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={`Edit Zone: ${zone.name}`} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        <Field label="Sort Order (determines order in POS & Admin)"><TextInput value={sortOrder} onChange={setSortOrder} type="number" /></Field>
        <div className="flex justify-between items-center pt-2">
          <Btn kind="danger" onClick={() => void handleDelete()}>Delete Zone</Btn>
          <Btn kind="primary" onClick={() => void submit()}>Save Changes</Btn>
        </div>
      </div>
    </Modal>
  );
}

/** Create (zone given) or edit (resource given) a table/room. */
function ResourceModal({ resource, duplicateFrom, zone, zones, ratePlans, onClose, onDone }: {
  resource?: AdminResource; duplicateFrom?: AdminResource; zone?: AdminZone; zones: AdminZone[]; ratePlans: RatePlanRef[];
  onClose: () => void; onDone: () => void;
}) {
  const source = resource || duplicateFrom;
  const [name, setName] = useState(duplicateFrom ? `${source?.name} (Copy)` : (source?.name ?? ''));
  const [nameAr, setNameAr] = useState(duplicateFrom ? '' : (source?.nameAr ?? ''));
  const [type, setType] = useState(source?.type ?? 'RESTAURANT_TABLE');
  const [zoneId, setZoneId] = useState(source?.zoneId ?? zone?.id ?? '');
  const [capacity, setCapacity] = useState(String(source?.capacity ?? 4));
  const [shape, setShape] = useState(source?.shape ?? 'rect');
  const [ratePlanId, setRatePlanId] = useState(source?.ratePlan?.id ?? source?.ratePlanId ?? '');
  const [posX, setPosX] = useState(duplicateFrom ? String((source?.posX ?? 20) + 20) : String(source?.posX ?? 20));
  const [posY, setPosY] = useState(duplicateFrom ? String((source?.posY ?? 20) + 20) : String(source?.posY ?? 20));
  const [width, setWidth] = useState(String(source?.width ?? 80));
  const [height, setHeight] = useState(String(source?.height ?? 80));
  const [active, setActive] = useState(source?.isActive ?? true);
  const [err, setErr] = useState('');

  const needsRatePlan = type !== 'RESTAURANT_TABLE';

  async function submit() {
    if (!name.trim() || !zoneId) { setErr('Name and zone are required'); return; }
    if (needsRatePlan && !ratePlanId) { setErr('Billiards/PS need a rate plan for the timer'); return; }
    const geometry = { posX: Number(posX), posY: Number(posY), width: Number(width), height: Number(height) };
    if (Object.values(geometry).some((n) => !Number.isFinite(n))) { setErr('Geometry must be numeric'); return; }
    try {
      if (resource) {
        await api(`/admin/resources/${resource.id}`, { method: 'PATCH', body: {
          name: name.trim(), nameAr: nameAr.trim() || null, type, zoneId,
          capacity: Math.max(1, Math.round(Number(capacity)) || 1), shape,
          ratePlanId: ratePlanId || null, isActive: active,
        } });
        await api(`/floor/resources/${resource.id}/geometry`, { method: 'PATCH', body: geometry });
      } else {
        await api('/admin/resources', { method: 'POST', body: {
          name: name.trim(), nameAr: nameAr.trim() || undefined, type, zoneId,
          capacity: Math.max(1, Math.round(Number(capacity)) || 1), shape,
          ratePlanId: ratePlanId || undefined, ...geometry,
        } });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={resource ? `Edit ${resource.name}` : (duplicateFrom ? `Duplicate ${duplicateFrom.name}` : `New table in ${zone?.name}`)} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
          <Field label="Name (Arabic)"><TextInput value={nameAr} onChange={setNameAr} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={type} onChange={setType} options={TYPES} />
          </Field>
          <Field label="Zone">
            <Select value={zoneId} onChange={setZoneId}
              options={zones.map((z) => ({ value: z.id, label: z.name }))} />
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Capacity"><TextInput value={capacity} onChange={setCapacity} type="number" /></Field>
          <Field label="Shape">
            <Select value={shape} onChange={setShape}
              options={[{ value: 'rect', label: 'Rectangle' }, { value: 'circle', label: 'Circle' }]} />
          </Field>
        </div>
        {needsRatePlan && (
          <Field label="Rate plan (time billing)">
            <Select value={ratePlanId} onChange={setRatePlanId} allowEmpty="— pick —"
              options={ratePlans.map((p) => ({ value: p.id, label: p.name }))} />
          </Field>
        )}
        <div className="grid grid-cols-4 gap-3">
          <Field label="X"><TextInput value={posX} onChange={setPosX} type="number" /></Field>
          <Field label="Y"><TextInput value={posY} onChange={setPosY} type="number" /></Field>
          <Field label="Width"><TextInput value={width} onChange={setWidth} type="number" /></Field>
          <Field label="Height"><TextInput value={height} onChange={setHeight} type="number" /></Field>
        </div>
        {resource && (
          <label className="flex items-center gap-2 text-sm text-goblin-200">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active (visible on the POS floor)
          </label>
        )}
        <Btn kind="primary" onClick={() => void submit()}>{resource ? 'Save' : 'Create table'}</Btn>
      </div>
    </Modal>
  );
}
