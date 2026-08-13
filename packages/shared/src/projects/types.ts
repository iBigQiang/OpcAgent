/** Workspace-scoped project data persisted in projects/{slug}/config.json. */
export interface ProjectConfig {
  id: string;
  slug: string;
  name: string;
  description?: string;
  workingDirectory?: string;
  details?: string;
  colorTheme?: string;
  color?: string;
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
}

export interface ProjectAsset {
  filename: string;
  sizeBytes: number;
  mimeType: string;
  uploadedAt: number;
  absolutePath: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  workingDirectory?: string;
  details?: string;
  colorTheme?: string;
  color?: string;
}

export interface LoadedProject {
  config: ProjectConfig;
  folderPath: string;
  assetsPath: string;
  workspaceRootPath: string;
  workspaceId: string;
}

export interface ProjectPromptContext {
  /** MEMORY.md text, capped by loadProjectMemory(). */
  memoryContent?: string;
  /** File names only. Asset paths, metadata, and contents are never included. */
  assetFilenames: string[];
}
