/** 主题切换：持久化到 localStorage，同步到 <html data-theme> */

export const THEMES = [
  { id: 'vermilion', label: '朱砂', desc: '炭黑 · 朱砂' },
  { id: 'bamboo', label: '竹青', desc: '墨绿 · 竹青' },
  { id: 'indigo', label: '月白', desc: '靛蓝 · 月白' },
  { id: 'sandalwood', label: '檀木', desc: '深棕 · 暖木' },
  { id: 'stealth', label: '素白', desc: '黑白 · 摸鱼' }
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const KEY = 'chess-theme';

export function isThemeId(value: string | null): value is ThemeId {
  return THEMES.some((t) => t.id === value);
}

export function currentTheme(): ThemeId {
  if (typeof document === 'undefined') return 'vermilion';
  const stored = localStorage.getItem(KEY);
  return isThemeId(stored) ? stored : 'vermilion';
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 隐私模式等禁用存储时，本次会话内仍生效
  }
}
