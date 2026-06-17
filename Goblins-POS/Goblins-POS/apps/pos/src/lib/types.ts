// Shapes returned by the API (subset the POS needs)

export interface SessionUser {
  id: string;
  name: string;
  role: string;
  language: string;
  permissions: string[];
}

export interface PinUser {
  id: string;
  name: string;
  role: { name: string };
}

export interface Modifier {
  exclusionGroup?: string | null;
  id: string;
  name: string;
  nameAr?: string | null;
  priceDeltaCents: number;
}

export interface ModifierGroup {
  id: string;
  name: string;
  nameAr?: string | null;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

export interface MenuItem {
  id: string;
  name: string;
  nameAr?: string | null;
  priceCents: number;
  is86ed: boolean;
  modifierGroups: { group: ModifierGroup }[];
  isFavorite?: boolean;
}

export interface Category {
  id: string;
  name: string;
  nameAr?: string | null;
  color?: string | null;
  items: MenuItem[];
  parentCategoryId?: string | null;
}

export interface FloorResource {
  id: string;
  type: 'RESTAURANT_TABLE' | 'BILLIARDS_TABLE' | 'PS_ROOM';
  name: string;
  status: 'FREE' | 'OCCUPIED' | 'RESERVED' | 'NEEDS_CLEANING';
  posX: number;
  posY: number;
  width: number;
  height: number;
  shape: string;
  capacity: number;
  orders: { id: string; number: number; totalCents: number; openedAt: string }[];
  sessions: SessionInfo[];
  ratePlan?: RatePlanInfo | null;
  reservations?: {
    id: string;
    startAt: string;
    guestName?: string | null;
    customer?: { name: string } | null;
  }[];
}

export interface SessionInfo {
  id: string;
  status: 'RUNNING' | 'PAUSED' | 'STOPPED' | 'CANCELLED';
  isMultiplayer: boolean;
  startedAt: string;
  orderId?: string | null;
  segments: { startedAt: string; endedAt: string | null; isMultiplayer: boolean }[];
  prepaidBlocks: { minutes: number; alertFired: boolean }[];
  ratePlan?: RatePlanInfo | null;
}

export interface RatePlanInfo {
  id: string;
  name: string;
  hourlyCents: number;
  hourlyMultiCents: number | null;
  minimumCents: number;
  roundToMinutes: number;
  roundingMode: string;
  graceMinutes: number;
  rules: {
    daysOfWeek: number[]; startTime: string; endTime: string;
    hourlyCents: number; hourlyMultiCents: number | null; priority: number;
  }[];
}

export interface FloorZone {
  id: string;
  name: string;
  nameAr?: string | null;
  resources: FloorResource[];
}

export interface OrderItemLine {
  id: string;
  description: string;
  quantity: string; // Decimal serialized
  unitCents: number;
  modifiersCents: number;
  lineCents: number;
  status: string;
  notes?: string | null;
  isTimeCharge: boolean;
  course?: number | null;
  seat?: number | null;
  modifiers: { id: string; name: string; priceCents: number }[];
}

export interface Order {
  id: string;
  number: number;
  type: string;
  status: string;
  resourceId?: string | null;
  resource?: FloorResource | null;
  session?: SessionInfo | null;
  customerId?: string | null;
  customer?: { id: string; name: string; phone: string; pointsBalance: number } | null;
  subtotalCents: number;
  discountCents: number;
  serviceChargeCents: number;
  taxCents: number;
  totalCents: number;
  paidCents: number;
  noService: boolean;
  noVat: boolean;
  items: OrderItemLine[];
  payments?: { id: string; amountCents: number; method?: { name: string; kind?: string } }[];
  seatCustomers?: OrderSeatCustomer[];
}

export interface OpenOrderSummary {
  id: string;
  number: number;
  type: string;
  totalCents: number;
  resource?: { name: string } | null;
  customer?: { name: string } | null;
}

export interface PaymentMethod {
  id: string;
  name: string;
  nameAr?: string | null;
  kind: 'CASH' | 'CARD' | 'WALLET' | 'LOYALTY_POINTS' | 'OTHER';
}

export interface Shift {
  id: string;
  status: 'OPEN' | 'CLOSED';
  floatCents: number;
  openedAt: string;
}

export interface ComboLine {
  id: string;
  itemId: string;
  item: MenuItem;
  quantity: number;
}

export interface Combo {
  id: string;
  name: string;
  nameAr?: string | null;
  priceCents: number;
  isActive: boolean;
  lines: ComboLine[];
}

export interface OrderSeatCustomer {
  id: string;
  orderId: string;
  seat: number;
  customerId: string;
  customer: { id: string; name: string; phone: string; pointsBalance: number };
}
