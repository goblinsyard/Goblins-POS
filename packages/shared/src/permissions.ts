/**
 * Permission catalog — single source of truth for RBAC.
 * Stable string IDs stored in the DB; grouped for the back-office matrix UI.
 */

export const PERMISSIONS = {
  // POS
  'pos.use': 'Use the POS terminal',
  'order.create': 'Create orders',
  'order.void': 'Void orders / items',
  'order.transfer': 'Transfer orders between tables',
  'order.split': 'Split & merge bills',
  'discount.apply': 'Apply discounts',
  'price.override': 'Override item prices',
  'payment.take': 'Take payments',
  'payment.refund': 'Issue refunds',
  'drawer.open_no_sale': 'Open drawer without a sale',
  'shift.open': 'Open a shift',
  'shift.close': 'Close a shift (Z report)',
  'shift.x_report': 'Run X report',
  // Sessions
  'session.start': 'Start billiards/PS sessions',
  'session.stop': 'Stop sessions',
  'session.transfer': 'Transfer sessions between resources',
  // KDS
  'kds.use': 'Use kitchen/bar display',
  'kds.bump': 'Bump / recall tickets',
  // Inventory
  'inventory.view': 'View stock levels',
  'inventory.adjust': 'Adjust stock',
  'inventory.transfer': 'Transfer between stores',
  'inventory.count': 'Perform stock counts',
  'inventory.waste': 'Log waste',
  'purchase.manage': 'Manage purchase orders & receiving',
  'production.manage': 'Create production orders',
  // Menu & settings
  'menu.manage': 'Manage menu, modifiers, pricing',
  'menu.86': "Mark items unavailable (86)",
  'rateplan.manage': 'Manage billiards/PS rate plans',
  'settings.manage': 'Manage business settings & printers',
  'staff.manage': 'Manage staff & roles',
  // CRM / reservations
  'customer.view': 'View customer profiles',
  'customer.manage': 'Edit customers & loyalty',
  'reservation.manage': 'Manage reservations',
  // Money & reports
  'expense.manage': 'Enter & manage expenses',
  'accounting.manage': 'Manage Chart of Accounts and Ledgers',
  'report.view': 'View reports',
  'report.financial': 'View financial reports (P&L)',
  'audit.view': 'View audit log',
} as const;

export type PermissionId = keyof typeof PERMISSIONS;

export const PERMISSION_GROUPS: Record<string, PermissionId[]> = {
  POS: [
    'pos.use', 'order.create', 'order.void', 'order.transfer', 'order.split',
    'discount.apply', 'price.override', 'payment.take', 'payment.refund',
    'drawer.open_no_sale', 'shift.open', 'shift.close', 'shift.x_report',
  ],
  Sessions: ['session.start', 'session.stop', 'session.transfer'],
  KDS: ['kds.use', 'kds.bump'],
  Inventory: [
    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
    'inventory.waste', 'purchase.manage', 'production.manage',
  ],
  Settings: ['menu.manage', 'menu.86', 'rateplan.manage', 'settings.manage', 'staff.manage'],
  CRM: ['customer.view', 'customer.manage', 'reservation.manage'],
  Finance: ['expense.manage', 'accounting.manage', 'report.view', 'report.financial', 'audit.view'],
};

/** Default role → permission matrix used by the seed. Owner gets everything. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionId[] | 'ALL'> = {
  Owner: 'ALL',
  Manager: [
    'pos.use', 'order.create', 'order.void', 'order.transfer', 'order.split',
    'discount.apply', 'price.override', 'payment.take', 'payment.refund',
    'drawer.open_no_sale', 'shift.open', 'shift.close', 'shift.x_report',
    'session.start', 'session.stop', 'session.transfer',
    'kds.use', 'kds.bump',
    'inventory.view', 'inventory.adjust', 'inventory.transfer', 'inventory.count',
    'inventory.waste', 'purchase.manage', 'production.manage',
    'menu.manage', 'menu.86', 'rateplan.manage',
    'customer.view', 'customer.manage', 'reservation.manage',
    'expense.manage', 'accounting.manage', 'report.view', 'report.financial', 'audit.view',
  ],
  Cashier: [
    'pos.use', 'order.create', 'order.split', 'payment.take',
    'shift.open', 'shift.close', 'shift.x_report',
    'session.start', 'session.stop',
    'customer.view', 'reservation.manage',
  ],
  Waiter: [
    'pos.use', 'order.create', 'order.split', 'order.transfer',
    'session.start', 'customer.view', 'reservation.manage',
  ],
  Kitchen: ['kds.use', 'kds.bump', 'inventory.view', 'inventory.waste', 'production.manage'],
  Bar: ['kds.use', 'kds.bump', 'inventory.view', 'inventory.waste', 'production.manage'],
  Steward: ['kds.use'],
};
