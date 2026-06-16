import { create } from 'zustand';
import { api, setTokens } from './api';
import type { SessionUser, Shift } from './types';

interface PosState {
  user: SessionUser | null;
  shift: Shift | null;
  screen: 'floor' | 'order';
  activeOrderId: string | null;
  lang: 'en' | 'ar';
  setLang: (lang: 'en' | 'ar') => void;
  themeMode: 'light' | 'dark';
  themeColor: 'goblin' | 'indigo' | 'rose' | 'amber' | 'slate';
  setThemeMode: (mode: 'light' | 'dark') => void;
  setThemeColor: (color: 'goblin' | 'indigo' | 'rose' | 'amber' | 'slate') => void;
  loginPin: (userId: string, pin: string) => Promise<void>;
  logout: () => void;
  refreshShift: () => Promise<void>;
  openOrder: (orderId: string) => void;
  toFloor: () => void;
}

// Helper to apply theme classes to HTML element
function applyTheme(mode: 'light' | 'dark', color: string) {
  if (mode === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
  const themes = ['theme-goblin', 'theme-indigo', 'theme-rose', 'theme-amber', 'theme-slate'];
  document.documentElement.classList.remove(...themes);
  document.documentElement.classList.add(`theme-${color}`);
}

// Sync initial application state
const initialMode = (localStorage.getItem('pos.themeMode') as 'light' | 'dark') ?? 'dark';
const initialColor = (localStorage.getItem('pos.themeColor') as any) ?? 'goblin';
applyTheme(initialMode, initialColor);

export const usePos = create<PosState>((set) => ({
  user: JSON.parse(sessionStorage.getItem('pos.user') ?? 'null'),
  shift: null,
  screen: 'floor',
  activeOrderId: null,
  lang: (localStorage.getItem('pos.lang') as 'en' | 'ar') ?? 'en',
  themeMode: initialMode,
  themeColor: initialColor,

  setThemeMode: (mode) => {
    localStorage.setItem('pos.themeMode', mode);
    set((state) => {
      applyTheme(mode, state.themeColor);
      return { themeMode: mode };
    });
  },

  setThemeColor: (color) => {
    localStorage.setItem('pos.themeColor', color);
    set((state) => {
      applyTheme(state.themeMode, color);
      return { themeColor: color };
    });
  },

  setLang: (lang) => {
    localStorage.setItem('pos.lang', lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    set({ lang });
  },

  loginPin: async (userId, pin) => {
    const res = await api<{ accessToken: string; refreshToken: string; user: SessionUser }>(
      '/auth/login/pin',
      { method: 'POST', body: { userId, pin } },
    );
    setTokens(res.accessToken, res.refreshToken);
    sessionStorage.setItem('pos.user', JSON.stringify(res.user));
    set({ user: res.user });
  },

  logout: () => {
    setTokens(null, null);
    sessionStorage.removeItem('pos.user');
    set({ user: null, screen: 'floor', activeOrderId: null });
  },

  refreshShift: async () => {
    const shift = await api<Shift | null>('/shifts/current');
    set({ shift });
  },

  openOrder: (orderId) => set({ screen: 'order', activeOrderId: orderId }),
  toFloor: () => set({ screen: 'floor', activeOrderId: null }),
}));

export function can(user: SessionUser | null, perm: string): boolean {
  return !!user?.permissions.includes(perm);
}
