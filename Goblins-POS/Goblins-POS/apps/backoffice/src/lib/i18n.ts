/**
 * Back-office i18n scaffold (EN/AR + RTL). Shell/nav/common strings are
 * translated; individual tab bodies remain English for now and can be
 * translated incrementally against this same dictionary + `t()` helper.
 *
 * `current` is a module-level value so leaf components (ui.tsx) can call `t(key)`
 * without prop-drilling; the App holds a `lang` state whose change re-renders the
 * tree, at which point `t()` reads the updated value.
 */
export type Lang = 'en' | 'ar';

let current: Lang = (localStorage.getItem('bo.lang') as Lang) || 'en';

export const getLang = (): Lang => current;

/** Apply <html dir> for the current language (RTL for Arabic). */
export function applyDir() {
  document.documentElement.dir = current === 'ar' ? 'rtl' : 'ltr';
  document.documentElement.lang = current;
}

export function setLang(l: Lang) {
  current = l;
  localStorage.setItem('bo.lang', l);
  applyDir();
}

type Dict = Record<string, string>;

const EN: Dict = {
  // brand / login
  brand: 'Goblins Yard', appName: 'Back Office',
  email: 'Email', password: 'Password', signIn: 'Sign in', loginFailed: 'Login failed',
  signOut: 'Sign out', darkMode: 'Dark mode', lightMode: 'Light mode',
  // sidebar sections
  Analytics: 'Analytics', Operations: 'Operations', Configuration: 'Configuration',
  // tabs
  Dashboard: 'Dashboard', Sales: 'Sales', Utilization: 'Utilization', 'P&L + Costs': 'P&L + Costs',
  Inventory: 'Inventory', Purchasing: 'Purchasing', Reservations: 'Reservations', Customers: 'Customers',
  Expenses: 'Expenses', Accounting: 'Accounting', Menu: 'Menu', Recipes: 'Recipes', Tables: 'Tables',
  'Rate plans': 'Rate plans', Staff: 'Staff', Settings: 'Settings', Audit: 'Audit',
  // shared ui
  loading: 'Loading…', noData: 'No data', search: 'Search...', selectOption: 'Select option',
  noMatches: 'No matching options found',
};

const AR: Dict = {
  brand: 'جوبلينز يارد', appName: 'الإدارة',
  email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'تسجيل الدخول', loginFailed: 'فشل تسجيل الدخول',
  signOut: 'تسجيل الخروج', darkMode: 'الوضع الداكن', lightMode: 'الوضع الفاتح',
  Analytics: 'التحليلات', Operations: 'العمليات', Configuration: 'التهيئة',
  Dashboard: 'لوحة التحكم', Sales: 'المبيعات', Utilization: 'الإشغال', 'P&L + Costs': 'الأرباح والتكاليف',
  Inventory: 'المخزون', Purchasing: 'المشتريات', Reservations: 'الحجوزات', Customers: 'العملاء',
  Expenses: 'المصروفات', Accounting: 'المحاسبة', Menu: 'القائمة', Recipes: 'الوصفات', Tables: 'الطاولات',
  'Rate plans': 'خطط الأسعار', Staff: 'الموظفون', Settings: 'الإعدادات', Audit: 'سجل التدقيق',
  loading: 'جارٍ التحميل…', noData: 'لا توجد بيانات', search: 'بحث...', selectOption: 'اختر',
  noMatches: 'لا توجد نتائج مطابقة',
};

const DICT: Record<Lang, Dict> = { en: EN, ar: AR };

/** Translate a key for the current language (falls back to EN, then the key). */
export function t(key: string): string {
  return DICT[current][key] ?? EN[key] ?? key;
}
