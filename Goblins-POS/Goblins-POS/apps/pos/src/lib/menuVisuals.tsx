import type { LucideIcon } from 'lucide-react';
import {
  Beef, CakeSlice, Coffee, CookingPot, CupSoda, Drumstick, Flame, GlassWater, IceCreamCone, Leaf,
  Milk, Pizza, Salad, Sandwich, Soup, Sparkles, UtensilsCrossed, Wine, Zap,
} from 'lucide-react';
import type { Category, MenuItem } from './types';

/** Picks an icon for a category from its English name (falls back to a plate). */
const RULES: [RegExp, LucideIcon][] = [
  [/coffee|espresso|latte|frap/i, Coffee],
  [/tea|hot drink|matcha|chocolate/i, Coffee],
  [/milkshake|shake/i, Milk],
  [/smoothie|juice|cocktail|lemonade/i, GlassWater],
  [/soda|soft|flavor/i, CupSoda],
  [/energy/i, Zap],
  [/bar|drink/i, Wine],
  [/ice.?cream|gelato/i, IceCreamCone],
  [/dessert|cake|sweet|waffle|crepe/i, CakeSlice],
  [/pizza/i, Pizza],
  [/sandwich|burger|wrap/i, Sandwich],
  [/salad/i, Salad],
  [/soup/i, Soup],
  [/chicken|wing/i, Drumstick],
  [/meat|beef|grill|steak/i, Beef],
  [/pasta|main|breakfast|dinner|egyptian|ramadan/i, CookingPot],
  [/shisha|hookah/i, Flame],
  [/extra|topping|add/i, Sparkles],
  [/staff|vegan|veg/i, Leaf],
];

export function iconFor(name: string): LucideIcon {
  for (const [re, icon] of RULES) if (re.test(name)) return icon;
  return UtensilsCrossed;
}

const FALLBACK_COLORS = ['#2f7d4f', '#8a5a2b', '#3a6ea5', '#9b3f5c', '#6b5bb5', '#b07a1f', '#2f8a8a', '#a14a2a'];

/** item id → { icon, color } using the item's own category, colour inherited from the nearest parent that has one. */
export function buildItemVisuals(menu: Category[]): Map<string, { Icon: LucideIcon; color: string }> {
  const byId = new Map(menu.map((c) => [c.id, c]));
  const colorOf = (c: Category | undefined, depth = 0): string | null => {
    if (!c || depth > 4) return null;
    return c.color || colorOf(c.parentCategoryId ? byId.get(c.parentCategoryId) : undefined, depth + 1);
  };
  const out = new Map<string, { Icon: LucideIcon; color: string }>();
  menu.forEach((c, i) => {
    const color = colorOf(c) ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!;
    const Icon = iconFor(c.name);
    c.items.forEach((item: MenuItem) => { if (!out.has(item.id)) out.set(item.id, { Icon, color }); });
  });
  return out;
}
