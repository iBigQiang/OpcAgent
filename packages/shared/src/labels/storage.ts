/**
 * Label Storage
 *
 * Filesystem-based storage for workspace label configurations.
 * Labels are stored at {workspaceRootPath}/labels/config.json
 *
 * Hierarchy: Labels form a nested JSON tree. IDs are simple slugs.
 * New workspaces are seeded with default labels (Development + Content groups).
 * Labels are visual by color only (colored circles in the UI).
 */

import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { WorkspaceLabelConfig, LabelConfig } from './types.ts';
import { flattenLabels, findLabelById } from './tree.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import { migrateColorValue, migrateLabelColors } from '../colors/migrate.ts';
import { isValidEntityColor } from '../colors/validate.ts';
import { debug } from '../utils/debug.ts';
import { validateAutoLabelRule } from './auto/validation.ts';

const LABEL_CONFIG_DIR = 'labels';
const LABEL_CONFIG_FILE = 'labels/config.json';

function emptyLabelConfig(): WorkspaceLabelConfig {
  return { version: 1, labels: [] };
}

function isValidLabelConfig(config: unknown): config is WorkspaceLabelConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const value = config as Record<string, unknown>;
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1 || !Array.isArray(value.labels)) return false;

  const ids = new Set<string>();
  const visit = (labels: unknown[]): boolean => labels.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const label = raw as Record<string, unknown>;
    if (!isValidLabelIdFormat(label.id as string) || ids.has(label.id as string)) return false;
    if (typeof label.name !== 'string' || !label.name.trim()) return false;
    if (label.color !== undefined && !isValidEntityColor(label.color) && !migrateColorValue(label.color)) return false;
    if (label.valueType !== undefined && !['string', 'number', 'date', 'link'].includes(label.valueType as string)) return false;
    if (label.autoRules !== undefined) {
      if (!Array.isArray(label.autoRules) || !label.autoRules.every((rule) => {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
        const entry = rule as Record<string, unknown>;
        if (typeof entry.pattern !== 'string' || (entry.flags !== undefined && typeof entry.flags !== 'string')) return false;
        return validateAutoLabelRule(entry.pattern, entry.flags as string | undefined).valid;
      })) return false;
    }
    ids.add(label.id as string);
    return label.children === undefined || (Array.isArray(label.children) && visit(label.children));
  });

  return visit(value.labels);
}

/**
 * Get default label configuration.
 * Provides a starter set of labels organized into two complementary color families:
 * - Development (blue family): Code, Bug, Automation
 * - Content (purple family): Writing, Research, Design
 * Plus flat valued labels: Priority (number), Project (string)
 *
 * Children use hue-shifted shades of their parent color to show visual hierarchy.
 */
export function getDefaultLabelConfig(): WorkspaceLabelConfig {
  return {
    version: 1,
    labels: [
      {
        id: 'development',
        name: 'Development',
        color: { light: '#3B82F6', dark: '#60A5FA' },
        children: [
          {
            id: 'code',
            name: 'Code',
            color: { light: '#4F46E5', dark: '#818CF8' }, // indigo shift
          },
          {
            id: 'bug',
            name: 'Bug',
            color: { light: '#0EA5E9', dark: '#38BDF8' }, // sky shift
          },
          {
            id: 'automation',
            name: 'Automation',
            color: { light: '#06B6D4', dark: '#22D3EE' }, // cyan shift
          },
        ],
      },
      {
        id: 'content',
        name: 'Content',
        color: { light: '#8B5CF6', dark: '#A78BFA' },
        children: [
          {
            id: 'writing',
            name: 'Writing',
            color: { light: '#7C3AED', dark: '#C4B5FD' }, // deeper violet
          },
          {
            id: 'research',
            name: 'Research',
            color: { light: '#A855F7', dark: '#C084FC' }, // lighter purple
          },
          {
            id: 'design',
            name: 'Design',
            color: { light: '#D946EF', dark: '#E879F9' }, // fuchsia shift
          },
        ],
      },
      {
        id: 'priority',
        name: 'Priority',
        color: { light: '#F59E0B', dark: '#FBBF24' },
        valueType: 'number',
      },
      {
        id: 'project',
        name: 'Project',
        color: 'foreground/50',
        valueType: 'string',
      },
    ],
  };
}

/**
 * Load workspace label configuration.
 * Pure read of workspace label configuration.
 * Missing workspaces receive in-memory defaults; malformed configuration fails closed.
 */
export function loadLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return getDefaultLabelConfig();
  }

  try {
    const config = readJsonFileSync<WorkspaceLabelConfig>(configPath);
    if (!isValidLabelConfig(config)) throw new Error('Invalid label config');
    return config;
  } catch (error) {
    debug('[loadLabelConfig] Failed to parse config:', error);
    return emptyLabelConfig();
  }
}

/** Persist default labels only when a workspace has not been initialized yet. */
export function initializeLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);
  if (existsSync(configPath)) return loadLabelConfig(workspaceRootPath);
  const defaults = getDefaultLabelConfig();
  saveLabelConfig(workspaceRootPath, defaults);
  return defaults;
}

/** Explicitly migrate legacy label colors and persist only when the data changes. */
export function migrateLabelConfig(workspaceRootPath: string): WorkspaceLabelConfig {
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);
  if (!existsSync(configPath)) return loadLabelConfig(workspaceRootPath);
  try {
    const config = readJsonFileSync<WorkspaceLabelConfig>(configPath);
    if (!config || typeof config !== 'object' || !Array.isArray(config.labels)) return emptyLabelConfig();
    if (migrateLabelColors(config) && isValidLabelConfig(config)) saveLabelConfig(workspaceRootPath, config);
    return isValidLabelConfig(config) ? config : emptyLabelConfig();
  } catch (error) {
    debug('[migrateLabelConfig] Failed to migrate config:', error);
    return emptyLabelConfig();
  }
}

/**
 * Save workspace label configuration to disk.
 * Creates the labels directory if missing.
 */
export function saveLabelConfig(
  workspaceRootPath: string,
  config: WorkspaceLabelConfig
): void {
  const labelDir = join(workspaceRootPath, LABEL_CONFIG_DIR);
  const configPath = join(workspaceRootPath, LABEL_CONFIG_FILE);

  if (!existsSync(labelDir)) {
    mkdirSync(labelDir, { recursive: true });
  }

  try {
    if (!isValidLabelConfig(config)) throw new Error('Invalid label config');
    atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    debug('[saveLabelConfig] Failed to save config:', error);
    throw error;
  }
}

/**
 * Get the label tree (root-level labels with nested children).
 * Primary accessor for the UI — returns the tree structure as-is from config.
 */
export function listLabels(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return config.labels;
}

/**
 * Get all labels as a flat list (tree flattened depth-first).
 * Useful for lookups, session label validation, and non-hierarchical display.
 */
export function listLabelsFlat(workspaceRootPath: string): LabelConfig[] {
  const config = loadLabelConfig(workspaceRootPath);
  return flattenLabels(config.labels);
}

/**
 * Get a single label by ID (searches the entire tree).
 * Returns null if not found.
 */
export function getLabel(
  workspaceRootPath: string,
  labelId: string
): LabelConfig | null {
  const config = loadLabelConfig(workspaceRootPath);
  return findLabelById(config.labels, labelId) || null;
}

/**
 * Check if a label ID exists in this workspace (searches entire tree)
 */
export function isValidLabelId(
  workspaceRootPath: string,
  labelId: string
): boolean {
  const config = loadLabelConfig(workspaceRootPath);
  return !!findLabelById(config.labels, labelId);
}

/**
 * Validate label ID format.
 * Simple slug: lowercase alphanumeric + hyphens, no leading/trailing hyphens.
 * Examples: "bug", "frontend", "my-label"
 */
export function isValidLabelIdFormat(labelId: string): boolean {
  if (!labelId) return false;
  const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return SLUG_PATTERN.test(labelId);
}
