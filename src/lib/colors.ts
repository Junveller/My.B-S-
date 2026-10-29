import type { ColorKey } from './types';

/** strong: 점·스와치, light: 블록 바탕, ink: 블록 글자, dark: 진한 막대 */
export const COLORS: Record<ColorKey, { strong: string; light: string; ink: string; dark: string; name: string }> = {
  yellow: { strong: '#F2DC7A', light: '#F5E9A8', ink: '#3D3500', dark: '#A88A12', name: '노랑' },
  blue: { strong: '#9DD0EA', light: '#BFE0F2', ink: '#0E3A52', dark: '#2F7FA8', name: '하늘' },
  green: { strong: '#7ACB98', light: '#BDE7CB', ink: '#0F3D22', dark: '#2F9E62', name: '초록' },
  orange: { strong: '#E8A16A', light: '#F3CDAE', ink: '#4A2205', dark: '#C76A25', name: '주황' },
  pink: { strong: '#EFA9C4', light: '#F7D3E1', ink: '#4F1530', dark: '#C2557F', name: '분홍' },
  purple: { strong: '#B9A8EA', light: '#DCD3F6', ink: '#2A1D5C', dark: '#6E58C6', name: '보라' },
  gray: { strong: '#B9B9C0', light: '#DCDCE0', ink: '#2A2A30', dark: '#6B6B76', name: '회색' },
};
/** 색상 고르기에 보이는 6가지 (회색은 대체용) */
export const COLOR_KEYS: ColorKey[] = ['yellow', 'blue', 'green', 'orange', 'pink', 'purple'];
export const colorOf = (k: ColorKey | undefined) => COLORS[k ?? 'gray'] ?? COLORS.gray;
