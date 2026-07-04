import { useState } from 'react';
import { api, egp } from '../lib/api';
import { Btn, ErrorBanner, Field, Modal, Pills, Select, Spinner, Table, TextInput, useLoad } from '../lib/ui';
import { X } from 'lucide-react';

interface Uom { id: string; name?: string }
interface Ingredient {
  id: string; name: string; uom: Uom; uomId?: string;
  avgCostCents: string | number; isIntermediate: boolean; isPerishable: boolean;
  reorderPoint: string | number; reorderQty: string | number;
}
interface RecipeLine { id?: string; ingredientId: string; quantity: string | number; wastePct: string | number; ingredient?: Ingredient }
interface Recipe {
  id: string; name: string; yieldQty: string | number; deductLocationName: string;
  prepInstructions?: string | null; isActive: boolean;
  menuItem?: { id: string; name: string } | null;
  lines: RecipeLine[];
}
interface ManufacturingProcess {
  id: string; name: string; yieldQty: string | number; deductLocationName: string;
  prepInstructions?: string | null; isActive: boolean;
  outputIngredient?: Ingredient | null;
  lines: RecipeLine[];
}
interface MenuCat { id: string; name: string; items: { id: string; name: string; priceCents: number }[] }

const qty = (q: string | number) => Number(q).toLocaleString('en-EG', { maximumFractionDigits: 3 });

const SECTIONS = ['menu item recipes', 'manufacturing', 'ingredients'] as const;

export function RecipesView() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>('menu item recipes');
  const { data: recipes, error: err1, reload: reloadRecipes } = useLoad(() => api<Recipe[]>('/admin/recipes'));
  const { data: processes, error: err2, reload: reloadProcesses } = useLoad(() => api<ManufacturingProcess[]>('/admin/manufacturing-processes'));
  const { data: ingredients, reload: reloadIngredients } = useLoad(() => api<Ingredient[]>('/inventory/ingredients'));
  const { data: locations } = useLoad(() => api<{ id: string; name: string }[]>('/inventory/locations'));

  const error = err1 || err2;
  const reload = () => { reloadRecipes(); reloadProcesses(); };

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!recipes || !processes) return <Spinner />;
  return (
    <div>
      <div className="mb-4"><Pills value={section} onChange={setSection} options={SECTIONS} /></div>
      {section === 'menu item recipes' && (
        <MenuItemRecipes recipes={recipes} ingredients={ingredients ?? []} locations={locations ?? []} reload={reload} />
      )}
      {section === 'manufacturing' && (
        <Manufacturing processes={processes} ingredients={ingredients ?? []} locations={locations ?? []} reload={reload} />
      )}
      {section === 'ingredients' && (
        <Ingredients ingredients={ingredients ?? []} reload={reloadIngredients} />
      )}
    </div>
  );
}

// ---------- menu item recipes ----------

function MenuItemRecipes({ recipes, ingredients, locations, reload }: {
  recipes: Recipe[]; ingredients: Ingredient[]; locations: { id: string; name: string }[]; reload: () => void;
}) {
  const { data: menu } = useLoad(() => api<MenuCat[]>('/menu'));
  const [editing, setEditing] = useState<{ recipe?: Recipe; menuItem: { id: string; name: string } } | null>(null);
  const [simulating, setSimulating] = useState<{ recipe: Recipe; menuItem: { id: string; name: string; priceCents: number } } | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [recipeStatus, setRecipeStatus] = useState('all'); // all, with, without

  const byMenuItem = new Map(recipes.filter((r) => r.menuItem).map((r) => [r.menuItem!.id, r]));
  const items = (menu ?? []).flatMap((c) => c.items.map((i) => ({ ...i, category: c.name })));

  const categories = Array.from(new Set(items.map((i) => i.category)));

  const filteredItems = items.filter((item) => {
    const recipe = byMenuItem.get(item.id);
    
    // Category filter
    if (category && item.category !== category) return false;
    
    // Recipe status filter
    if (recipeStatus === 'with' && !recipe) return false;
    if (recipeStatus === 'without' && recipe) return false;
    
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchItemName = item.name.toLowerCase().includes(q);
      const matchIngredients = recipe
        ? recipe.lines.some((l) => l.ingredient?.name.toLowerCase().includes(q))
        : false;
      if (!matchItemName && !matchIngredients) return false;
    }
    
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3 bg-goblin-900 p-4 rounded-xl shadow-sm border border-goblin-800">
        <div className="w-64">
          <Field label="Search recipes">
            <TextInput value={search} onChange={setSearch} placeholder="Search item or ingredient..." />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Category">
            <Select value={category} onChange={setCategory} allowEmpty="All Categories"
              options={categories.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Recipe Status">
            <Select value={recipeStatus} onChange={setRecipeStatus}
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'with', label: 'Has Recipe' },
                { value: 'without', label: 'No Recipe' },
              ]} />
          </Field>
        </div>
        {(search || category || recipeStatus !== 'all') && (
          <Btn kind="ghost" onClick={() => { setSearch(''); setCategory(''); setRecipeStatus('all'); }}>Clear</Btn>
        )}
      </div>

      <Table headers={['Item', 'Category', 'Recipe', 'Theoretical cost', '']}
        rows={filteredItems.map((item) => {
          const recipe = byMenuItem.get(item.id);
          const cost = recipe
            ? recipe.lines.reduce((a, l) => a + Number(l.ingredient?.avgCostCents ?? 0) * Number(l.quantity) * (1 + Number(l.wastePct) / 100), 0)
            : null;
          return [
            item.name, item.category,
            recipe
              ? <div className="w-[300px] whitespace-normal break-words text-goblin-200">{recipe.lines.map((l) => `${qty(l.quantity)} ${l.ingredient?.uom.id ?? ''} ${l.ingredient?.name ?? ''}`).join(', ')}</div>
              : <span key="n" className="text-amber-600">no recipe — stock won’t deduct</span>,
            cost != null ? egp(Math.round(cost)) : '—',
            <span key="actions" className="flex gap-2">
              <Btn onClick={() => setEditing({ recipe, menuItem: item })}>{recipe ? 'Edit' : '+ Recipe'}</Btn>
              {recipe && (
                <Btn kind="default" onClick={() => setSimulating({ recipe, menuItem: item })}>Simulate</Btn>
              )}
            </span>,
          ];
        })} />
      {editing && (
        <RecipeFormModal
          title={`Recipe — ${editing.menuItem.name}`}
          recipe={editing.recipe}
          fixedTarget={{ menuItemId: editing.menuItem.id, defaultName: editing.menuItem.name }}
          ingredients={ingredients} locations={locations}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); reload(); }} />
      )}
      {simulating && (
        <SimulationModal
          menuItem={simulating.menuItem}
          recipe={simulating.recipe}
          onClose={() => setSimulating(null)}
          onDone={() => { setSimulating(null); reload(); }} />
      )}
    </div>
  );
}


// ---------- manufacturing (intermediates) ----------

function Manufacturing({ processes, ingredients, locations, reload }: {
  processes: ManufacturingProcess[]; ingredients: Ingredient[]; locations: { id: string; name: string }[]; reload: () => void;
}) {
  const [editing, setEditing] = useState<ManufacturingProcess | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');

  const filteredProcesses = processes.filter((r) => {
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = r.name.toLowerCase().includes(q);
      const matchOutput = r.outputIngredient?.name.toLowerCase().includes(q) ?? false;
      const matchInputs = r.lines.some((l) => l.ingredient?.name.toLowerCase().includes(q));
      if (!matchName && !matchOutput && !matchInputs) return false;
    }
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 bg-goblin-900 p-4 rounded-xl shadow-sm border border-goblin-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Search processes">
              <TextInput value={search} onChange={setSearch} placeholder="Search process or ingredient..." />
            </Field>
          </div>
          {search && (
            <Btn kind="ghost" onClick={() => setSearch('')}>Clear</Btn>
          )}
        </div>
        <div>
          <Btn kind="primary" onClick={() => setCreating(true)}>+ New manufacturing process</Btn>
        </div>
      </div>
      <Table headers={['Process', 'Produces', 'Per unit consumes', 'Deducts from', '']}
        rows={filteredProcesses.map((r) => [
          r.name,
          r.outputIngredient ? `${r.outputIngredient.name} (${r.outputIngredient.uom.id})` : '—',
          <div className="w-[300px] whitespace-normal break-words text-goblin-200">
            {r.lines.map((l) => `${qty(l.quantity)} ${l.ingredient?.uom.id ?? ''} ${l.ingredient?.name ?? ''}`).join(', ')}
          </div>,
          r.deductLocationName,
          <Btn key="e" onClick={() => setEditing(r)}>Edit</Btn>,
        ])} />
      <p className="mt-2 text-xs text-goblin-400">
        A manufacturing process turns raw stock into an intermediate ingredient. Run batches from Purchasing → Production.
      </p>
      {(editing || creating) && (
        <RecipeFormModal
          title={editing ? `Edit ${editing.name}` : 'New manufacturing process'}
          recipe={editing ?? undefined}
          intermediateTarget
          ingredients={ingredients} locations={locations}
          onClose={() => { setEditing(null); setCreating(false); }}
          onDone={() => { setEditing(null); setCreating(false); reload(); }} />
      )}
    </div>
  );
}

// ---------- shared recipe form ----------

function RecipeFormModal({ title, recipe, fixedTarget, intermediateTarget, ingredients, locations, onClose, onDone }: {
  title: string;
  recipe?: Recipe | ManufacturingProcess;
  fixedTarget?: { menuItemId: string; defaultName: string };
  intermediateTarget?: boolean;
  ingredients: Ingredient[]; locations: { id: string; name: string }[];
  onClose: () => void; onDone: () => void;
}) {
  const [name, setName] = useState(recipe?.name ?? fixedTarget?.defaultName ?? '');
  const [outputIngredientId, setOutputIngredientId] = useState((recipe as ManufacturingProcess)?.outputIngredient?.id ?? '');
  const [yieldQty, setYieldQty] = useState(String(Number(recipe?.yieldQty ?? 1)));
  const [deductLocationName, setDeductLocationName] = useState(recipe?.deductLocationName ?? 'Kitchen');
  const [prep, setPrep] = useState(recipe?.prepInstructions ?? '');
  const [lines, setLines] = useState<{ ingredientId: string; quantity: string; wastePct: string }[]>(
    recipe?.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(Number(l.quantity)), wastePct: String(Number(l.wastePct)) }))
    ?? [{ ingredientId: '', quantity: '', wastePct: '0' }],
  );
  const [err, setErr] = useState('');

  const intermediates = ingredients.filter((i) => i.isIntermediate);
  const costPreview = lines.reduce((a, l) => {
    const ing = ingredients.find((i) => i.id === l.ingredientId);
    if (!ing || !Number(l.quantity)) return a;
    return a + Number(ing.avgCostCents) * Number(l.quantity) * (1 + (Number(l.wastePct) || 0) / 100);
  }, 0);

  function setLine(i: number, patch: Partial<{ ingredientId: string; quantity: string; wastePct: string }>) {
    setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    const parsed = lines
      .filter((l) => l.ingredientId)
      .map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity), wastePct: Number(l.wastePct) || 0 }));
    if (!name.trim() || !parsed.length || parsed.some((l) => !(l.quantity > 0))) {
      setErr('Name and lines with positive quantities are required'); return;
    }
    if (intermediateTarget && !recipe && !outputIngredientId) {
      setErr('Pick the intermediate ingredient this process produces'); return;
    }
    try {
      if (recipe) {
        const url = intermediateTarget ? `/admin/manufacturing-processes/${recipe.id}` : `/admin/recipes/${recipe.id}`;
        await api(url, { method: 'PATCH', body: {
          name: name.trim(), yieldQty: Number(yieldQty) || 1, deductLocationName,
          prepInstructions: prep.trim() || undefined, lines: parsed,
        } });
      } else {
        if (intermediateTarget) {
          await api('/admin/manufacturing-processes', { method: 'POST', body: {
            name: name.trim(),
            outputIngredientId,
            yieldQty: Number(yieldQty) || 1, deductLocationName,
            prepInstructions: prep.trim() || undefined, lines: parsed,
          } });
        } else {
          await api('/admin/recipes', { method: 'POST', body: {
            name: name.trim(),
            menuItemId: fixedTarget?.menuItemId,
            yieldQty: Number(yieldQty) || 1, deductLocationName,
            prepInstructions: prep.trim() || undefined, lines: parsed,
          } });
        }
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={title} onClose={onClose} wide>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Recipe name"><TextInput value={name} onChange={setName} /></Field>
          <Field label={intermediateTarget ? 'Yield per batch (output units)' : 'Yield (portions)'}>
            <TextInput value={yieldQty} onChange={setYieldQty} type="number" />
          </Field>
        </div>
        {intermediateTarget && !recipe && (
          <Field label="Produces (intermediate ingredient)">
            <Select value={outputIngredientId} onChange={setOutputIngredientId} allowEmpty="— pick —"
              options={intermediates.map((i) => ({ value: i.id, label: `${i.name} (${i.uom.id})` }))} />
          </Field>
        )}
        {intermediateTarget && !recipe && !intermediates.length && (
          <p className="text-xs text-amber-600">No intermediate ingredients yet — create one in the Ingredients section first (mark it “intermediate”).</p>
        )}
        <Field label="Stock deducts from">
          <Select value={deductLocationName} onChange={setDeductLocationName}
            options={(locations.length ? locations.map((l) => l.name) : ['Kitchen', 'Bar']).map((n) => ({ value: n, label: n }))} />
        </Field>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-goblin-400">
            Ingredients (per {intermediateTarget ? 'one output unit' : 'one portion'})
          </p>
          {lines.map((l, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_100px_90px_32px] items-center gap-2">
              <Select value={l.ingredientId} onChange={(v) => setLine(i, { ingredientId: v })} allowEmpty="— ingredient —"
                options={ingredients.map((x) => ({ value: x.id, label: `${x.name} (${x.uom.id})${x.isIntermediate ? ' ⚗' : ''}` }))} />
              <TextInput value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} type="number" placeholder="qty" />
              <TextInput value={l.wastePct} onChange={(v) => setLine(i, { wastePct: v })} type="number" placeholder="waste %" />
              <button onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}
                className="rounded-lg bg-goblin-800 py-2 text-goblin-400 hover:bg-red-50 hover:text-red-600"><X className="h-4 w-4" /></button>
            </div>
          ))}
          <Btn onClick={() => setLines((cur) => [...cur, { ingredientId: '', quantity: '', wastePct: '0' }])}>+ Line</Btn>
        </div>
        <Field label="Prep instructions (optional)"><TextInput value={prep} onChange={setPrep} /></Field>
        <div className="flex items-center gap-3">
          <Btn kind="primary" onClick={() => void submit()}>{recipe ? 'Save recipe' : 'Create recipe'}</Btn>
          <span className="text-sm text-goblin-300">Theoretical cost: <b>{egp(Math.round(costPreview))}</b></span>
        </div>
      </div>
    </Modal>
  );
}

// ---------- ingredients ----------

function Ingredients({ ingredients, reload }: { ingredients: Ingredient[]; reload: () => void }) {
  const [modalOpen, setModalOpen] = useState<{ open: boolean; ingredient?: Ingredient }>({ open: false });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all'); // all, raw, intermediate, perishable
  const [uomFilter, setUomFilter] = useState('');

  const uoms = Array.from(new Set(ingredients.map((i) => i.uom.id)));

  const filteredIngredients = ingredients.filter((i) => {
    // Type filter
    if (typeFilter === 'raw' && i.isIntermediate) return false;
    if (typeFilter === 'intermediate' && !i.isIntermediate) return false;
    if (typeFilter === 'perishable' && !i.isPerishable) return false;
    
    // UOM filter
    if (uomFilter && i.uom.id !== uomFilter) return false;
    
    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      if (!i.name.toLowerCase().includes(q)) return false;
    }
    
    return true;
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 bg-goblin-900 p-4 rounded-xl shadow-sm border border-goblin-800">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Field label="Search ingredients">
              <TextInput value={search} onChange={setSearch} placeholder="Search name..." />
            </Field>
          </div>
          <div className="w-48">
            <Field label="Type">
              <Select value={typeFilter} onChange={setTypeFilter}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'raw', label: 'Raw Stock' },
                  { value: 'intermediate', label: 'Intermediate' },
                  { value: 'perishable', label: 'Perishable' },
                ]} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Unit">
              <Select value={uomFilter} onChange={setUomFilter} allowEmpty="All Units"
                options={uoms.map((u) => ({ value: u, label: u }))} />
            </Field>
          </div>
          {(search || typeFilter !== 'all' || uomFilter) && (
            <Btn kind="ghost" onClick={() => { setSearch(''); setTypeFilter('all'); setUomFilter(''); }}>Clear</Btn>
          )}
        </div>
        <div>
          <Btn kind="primary" onClick={() => setModalOpen({ open: true })}>+ New ingredient</Btn>
        </div>
      </div>
      <Table headers={['Ingredient', 'Unit', 'Avg cost', 'Reorder at', 'Flags', '']}
        rows={filteredIngredients.map((i) => [
          i.name, i.uom.id, egp(Math.round(Number(i.avgCostCents))), qty(i.reorderPoint),
          [i.isIntermediate ? '⚗ intermediate' : '', i.isPerishable ? '⏳ perishable' : ''].filter(Boolean).join(' '),
          <Btn key="edit" onClick={() => setModalOpen({ open: true, ingredient: i })}>Edit</Btn>,
        ])} />
      {modalOpen.open && (
        <IngredientModal
          ingredient={modalOpen.ingredient}
          onClose={() => setModalOpen({ open: false })}
          onDone={() => { setModalOpen({ open: false }); reload(); }} />
      )}
    </div>
  );
}

function IngredientModal({ ingredient, onClose, onDone }: {
  ingredient?: Ingredient;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: uoms } = useLoad(() => api<Uom[]>('/admin/uoms'));
  const [name, setName] = useState(ingredient?.name ?? '');
  const [uomId, setUomId] = useState(ingredient?.uomId ?? ingredient?.uom?.id ?? '');
  const [intermediate, setIntermediate] = useState(ingredient?.isIntermediate ?? false);
  const [perishable, setPerishable] = useState(ingredient?.isPerishable ?? false);
  const [reorderPoint, setReorderPoint] = useState(ingredient ? String(Number(ingredient.reorderPoint)) : '0');
  const [reorderQty, setReorderQty] = useState(ingredient ? String(Number(ingredient.reorderQty)) : '0');
  const [err, setErr] = useState('');

  async function submit() {
    if (!name.trim() || !uomId) { setErr('Name and unit are required'); return; }
    try {
      if (ingredient) {
        await api(`/admin/ingredients/${ingredient.id}`, { method: 'PATCH', body: {
          name: name.trim(), uomId,
          isIntermediate: intermediate, isPerishable: perishable,
          reorderPoint: Number(reorderPoint) || 0, reorderQty: Number(reorderQty) || 0,
        } });
      } else {
        await api('/admin/ingredients', { method: 'POST', body: {
          name: name.trim(), uomId,
          isIntermediate: intermediate, isPerishable: perishable,
          reorderPoint: Number(reorderPoint) || 0, reorderQty: Number(reorderQty) || 0,
        } });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  }

  return (
    <Modal title={ingredient ? "Edit ingredient" : "New ingredient"} onClose={onClose}>
      <ErrorBanner message={err} />
      <div className="space-y-3">
        <Field label="Name"><TextInput value={name} onChange={setName} /></Field>
        <Field label="Unit of measure">
          <Select value={uomId} onChange={setUomId} allowEmpty="— pick —"
            options={(uoms ?? []).map((u) => ({ value: u.id, label: u.name ? `${u.id} — ${u.name}` : u.id }))} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder point"><TextInput value={reorderPoint} onChange={setReorderPoint} type="number" /></Field>
          <Field label="Reorder qty"><TextInput value={reorderQty} onChange={setReorderQty} type="number" /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-goblin-200">
          <input type="checkbox" checked={intermediate} onChange={(e) => setIntermediate(e.target.checked)} />
          Intermediate (produced in-house by a manufacturing process)
        </label>
        <label className="flex items-center gap-2 text-sm text-goblin-200">
          <input type="checkbox" checked={perishable} onChange={(e) => setPerishable(e.target.checked)} />
          Perishable (expiry tracked on receiving)
        </label>
        <Btn kind="primary" onClick={() => void submit()}>{ingredient ? 'Save' : 'Create'}</Btn>
      </div>
    </Modal>
  );
}


function SimulationModal({ menuItem, recipe, onClose, onDone }: {
  menuItem: { id: string; name: string; priceCents: number };
  recipe: Recipe;
  onClose: () => void;
  onDone: () => void;
}) {
  const [simulatedPrice, setSimulatedPrice] = useState(String(menuItem.priceCents / 100));
  const [lines, setLines] = useState<{ ingredientId: string; quantity: string; wastePct: string; name: string; uom: string; avgCostCents: number }[]>(
    recipe.lines.map((l) => ({
      ingredientId: l.ingredientId,
      quantity: String(Number(l.quantity)),
      wastePct: String(Number(l.wastePct)),
      name: l.ingredient?.name ?? 'Unknown',
      uom: l.ingredient?.uom.id ?? '',
      avgCostCents: Number(l.ingredient?.avgCostCents ?? 0)
    }))
  );
  
  const [costOverrides, setCostOverrides] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const originalCost = recipe.lines.reduce(
    (a, l) => a + Number(l.ingredient?.avgCostCents ?? 0) * Number(l.quantity) * (1 + Number(l.wastePct) / 100), 
    0
  );
  const originalMargin = menuItem.priceCents - originalCost;
  const originalFoodCostPct = menuItem.priceCents > 0 ? (originalCost / menuItem.priceCents) * 100 : 0;

  const simulatedCost = lines.reduce((a, l) => {
    const override = costOverrides[l.ingredientId];
    const unitCostCents = override ? Math.round(Number(override) * 100) : l.avgCostCents;
    const qty = Number(l.quantity) || 0;
    const waste = Number(l.wastePct) || 0;
    return a + unitCostCents * qty * (1 + waste / 100);
  }, 0);

  const simPriceCents = Math.round(Number(simulatedPrice) * 100) || 0;
  const simulatedMargin = simPriceCents - simulatedCost;
  const simulatedFoodCostPct = simPriceCents > 0 ? (simulatedCost / simPriceCents) * 100 : 0;

  function updateLineQty(index: number, val: string) {
    setLines(cur => cur.map((l, i) => i === index ? { ...l, quantity: val } : l));
  }

  function updateCostOverride(ingId: string, val: string) {
    setCostOverrides(cur => ({ ...cur, [ingId]: val }));
  }

  async function applySimulatedPrice() {
    if (simPriceCents <= 0) {
      setErr('Simulated price must be positive');
      return;
    }
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      await api(`/admin/menu/items/${menuItem.id}`, {
        method: 'PATCH',
        body: { priceCents: simPriceCents }
      });
      setMsg('Simulated price applied successfully to active menu!');
      setTimeout(() => {
        onDone();
      }, 1500);
    } catch (e: any) {
      setErr(e.message || 'Failed to apply price');
      setBusy(false);
    }
  }

  async function saveSimulatedRecipe() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const parsed = lines.map(l => ({
        ingredientId: l.ingredientId,
        quantity: Number(l.quantity) || 0,
        wastePct: Number(l.wastePct) || 0
      }));
      if (parsed.some(l => l.quantity <= 0)) {
        throw new Error('All ingredients must have positive quantities');
      }
      await api(`/admin/recipes/${recipe.id}`, {
        method: 'PATCH',
        body: { lines: parsed }
      });
      setMsg('Simulated recipe quantities saved successfully!');
      setTimeout(() => {
        onDone();
      }, 1500);
    } catch (e: any) {
      setErr(e.message || 'Failed to save recipe');
      setBusy(false);
    }
  }

  let barColor = 'bg-goblin-500';
  let barText = 'Excellent (<= 30%)';
  if (simulatedFoodCostPct > 40) {
    barColor = 'bg-red-500';
    barText = 'Critical (> 40%)';
  } else if (simulatedFoodCostPct > 30) {
    barColor = 'bg-amber-500';
    barText = 'Average (30% - 40%)';
  }

  return (
    <Modal title={`Cost & Margin Simulator — ${menuItem.name}`} onClose={onClose} wide>
      <ErrorBanner message={err} />
      {msg && <p className="mb-3 rounded bg-goblin-700 p-2 text-goblin-500 font-semibold">{msg}</p>}

      <div className="grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <h3 className="font-semibold text-goblin-100 text-sm border-b pb-1">1. Adjust Recipe Quantities & Material Costs</h3>
          <div className="space-y-3">
            {lines.map((l, idx) => {
              const currentOverride = costOverrides[l.ingredientId] ?? '';
              const origCostEgp = (l.avgCostCents / 100).toFixed(2);
              return (
                <div key={l.ingredientId} className="grid grid-cols-[2fr_1fr_1fr] gap-3 items-center bg-goblin-800 p-2.5 rounded-lg border">
                  <div>
                    <span className="font-semibold text-goblin-100 text-xs block truncate">{l.name}</span>
                    <span className="text-[10px] text-goblin-400">Current Cost: {origCostEgp} EGP/{l.uom}</span>
                  </div>
                  
                  <Field label={`Qty (${l.uom})`}>
                    <TextInput value={l.quantity} onChange={(v) => updateLineQty(idx, v)} type="number" />
                  </Field>
                  
                  <Field label="Override Cost (EGP)">
                    <TextInput value={currentOverride} onChange={(v) => updateCostOverride(l.ingredientId, v)} type="number" placeholder={origCostEgp} />
                  </Field>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 bg-goblin-800 p-4 rounded-xl border self-start">
          <h3 className="font-semibold text-goblin-100 text-sm border-b pb-1">2. Simulated Margins</h3>
          
          <div className="space-y-3">
            <Field label="Selling Price (EGP)">
              <TextInput value={simulatedPrice} onChange={setSimulatedPrice} type="number" />
            </Field>

            <div className="space-y-2 text-xs divide-y">
              <div className="flex justify-between py-1.5">
                <span className="text-goblin-300 font-sans">Theoretical Cost</span>
                <span className="font-semibold text-goblin-50 font-mono">
                  {egp(Math.round(simulatedCost))}
                  <span className="text-[10px] text-goblin-400 block text-right font-normal font-sans">
                    Prev: {egp(Math.round(originalCost))}
                  </span>
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-goblin-300 font-sans">Gross Margin</span>
                <span className={`font-semibold font-mono ${simulatedMargin < 0 ? 'text-red-600' : 'text-goblin-500'}`}>
                  {egp(Math.round(simulatedMargin))}
                  <span className="text-[10px] text-goblin-400 block text-right font-normal font-sans">
                    Prev: {egp(Math.round(originalMargin))}
                  </span>
                </span>
              </div>
              <div className="flex justify-between py-1.5">
                <span className="text-goblin-300 font-sans">Food Cost %</span>
                <span className="font-semibold text-goblin-50 font-mono">
                  {simulatedFoodCostPct.toFixed(1)}%
                  <span className="text-[10px] text-goblin-400 block text-right font-normal font-sans">
                    Prev: {originalFoodCostPct.toFixed(1)}%
                  </span>
                </span>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex justify-between text-[10px] text-goblin-300 mb-1">
                <span>Food Cost Status</span>
                <span>{barText}</span>
              </div>
              <div className="w-full bg-goblin-700 h-2.5 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${barColor} transition-all duration-300`} 
                  style={{ width: `${Math.min(100, simulatedFoodCostPct)}%` }} 
                />
              </div>
            </div>

            <div className="space-y-2 pt-4 border-t">
              <button 
                onClick={applySimulatedPrice} 
                disabled={busy} 
                className="w-full rounded-xl bg-goblin-600 hover:bg-goblin-700 text-white font-semibold py-2.5 text-xs text-center transition">
                Apply Price to Active Menu
              </button>
              <button 
                onClick={saveSimulatedRecipe} 
                disabled={busy} 
                className="w-full rounded-xl bg-goblin-900 hover:bg-goblin-950 text-white font-semibold py-2.5 text-xs text-center transition font-sans">
                Save Recipe Quantities
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
