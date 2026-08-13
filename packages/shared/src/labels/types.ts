import type { EntityColor } from '../colors/types.ts';

export interface AutoLabelRule {
  pattern: string;
  flags?: string;
  valueTemplate?: string;
  description?: string;
}

export interface LabelConfig {
  id: string;
  name: string;
  color?: EntityColor;
  children?: LabelConfig[];
  valueType?: 'string' | 'number' | 'date' | 'link';
  autoRules?: AutoLabelRule[];
}

export interface WorkspaceLabelConfig {
  version: number;
  labels: LabelConfig[];
}

export interface CreateLabelInput {
  name: string;
  color?: EntityColor;
  parentId?: string;
  valueType?: LabelConfig['valueType'];
}

export interface UpdateLabelInput {
  name?: string;
  color?: EntityColor;
  valueType?: LabelConfig['valueType'];
  autoRules?: AutoLabelRule[];
}

export interface ParsedLabelEntry {
  id: string;
  rawValue?: string;
  value?: string | number | Date;
}
