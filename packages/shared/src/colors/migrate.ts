import type { EntityColor } from './types.ts';

const legacyColors: Record<string, EntityColor> = {
  'text-accent': 'accent',
  'text-info': 'info',
  'text-success': 'success',
  'text-error': 'destructive',
  'text-destructive': 'destructive',
  'text-foreground': 'foreground',
  'text-foreground/50': 'foreground/50',
  'text-foreground/60': 'foreground/60',
  'text-foreground/70': 'foreground/70',
  'text-foreground/80': 'foreground/80',
  'text-foreground/90': 'foreground/90',
  'text-warning': 'info',
};

export function migrateColorValue(value: unknown): { migrated: EntityColor; changed: boolean } | null {
  if (value === undefined || value === null || typeof value === 'object' || typeof value !== 'string') return null;
  const mapped = legacyColors[value];
  if (mapped) return { migrated: mapped, changed: true };
  const opacityMatch = /^text-foreground\/(\d+)$/.exec(value);
  if (opacityMatch) {
    const opacity = Math.min(100, Math.max(0, Number(opacityMatch[1])));
    return { migrated: `foreground/${opacity}` as EntityColor, changed: true };
  }
  if (/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/.test(value)) {
    return { migrated: { light: value }, changed: true };
  }
  return null;
}

export function migrateLabelColors(config: { labels: Array<{ color?: unknown; children?: unknown[] }> }): boolean {
  let changed = false;
  const visit = (labels: Array<{ color?: unknown; children?: unknown[] }>): void => {
    for (const label of labels) {
      const result = migrateColorValue(label.color);
      if (result) {
        label.color = result.migrated;
        changed = true;
      }
      if (Array.isArray(label.children)) visit(label.children as Array<{ color?: unknown; children?: unknown[] }>);
    }
  };
  visit(config.labels);
  return changed;
}
