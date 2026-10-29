import type { ColorKey } from './types';

export const COLORS: Record<ColorKey, { strong: string; light: string; name: string }> = {
  yellow: { strong: '#F2DC7A', light: '#F5E9A8', name: '노랑' },
  blue: { strong: '#9DD0EA', light: '#BFE0F2', name: '파랑' },
  green: { strong: '#7ACB98', light: '#BDE7CB', name: '초록' },
  orange: { strong: '#E8A16A', light: '#F3CBA9', name: '주황' },
  purple: { strong: '#B4A8EC', light: '#D9D2F7', name: '보라' },
  pink: { strong: '#EBA2B9', light: '#F5CFDB', name: '분홍' },
  gray: { strong: '#B9B9C0', light: '#DCDCE0', name: '회색' },
};
export const COLOR_KEYS = Object.keys(COLORS) as ColorKey[];
export const colorOf = (k: ColorKey | undefined) => COLORS[k ?? 'gray'] ?? COLORS.gray;
