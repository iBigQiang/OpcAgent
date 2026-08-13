import { SYSTEM_COLOR_NAMES, type EntityColor, type SystemColorName } from './types.ts';

export function resolveEntityColor(color: EntityColor, isDark: boolean): string {
  if (typeof color === 'string') {
    const parsed = parseSystemColor(color);
    if (!parsed) return 'var(--foreground)';
    const cssVariable = `var(--${parsed.name})`;
    return parsed.opacity === undefined
      ? cssVariable
      : `color-mix(in oklch, ${cssVariable} ${parsed.opacity}%, transparent)`;
  }
  return isDark ? color.dark ?? color.light : color.light;
}

function parseSystemColor(value: string): { name: SystemColorName; opacity?: number } | null {
  const [name, opacityValue] = value.split('/');
  if (!name) return null;
  if (!(SYSTEM_COLOR_NAMES as readonly string[]).includes(name)) return null;
  if (opacityValue === undefined) return { name: name as SystemColorName };
  if (!/^\d+$/.test(opacityValue)) return null;
  const opacity = Number(opacityValue);
  if (opacity < 0 || opacity > 100) return null;
  return { name: name as SystemColorName, opacity };
}
