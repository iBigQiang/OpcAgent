/**
 * Centralized path configuration for OPCAgent.
 *
 * Supports multi-instance development via CONFIG_DIR environment variable.
 * When running from a numbered development folder, the instance detector
 * script sets CONFIG_DIR to ~/.opcagent-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.opcagent/
 * Instance 1 (-1 suffix): ~/.opcagent-1/
 * Instance 2 (-2 suffix): ~/.opcagent-2/
 */

import { homedir } from 'os';
import { join } from 'path';

export function getConfigDir(): string {
  return process.env.CONFIG_DIR || join(homedir(), '.opcagent');
}

// Allow override via environment variable for multi-instance dev
// Falls back to default ~/.opcagent/ for production and non-numbered dev folders
export const CONFIG_DIR = getConfigDir();
