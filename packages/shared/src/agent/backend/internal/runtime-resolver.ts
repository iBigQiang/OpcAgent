import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { BackendHostRuntimeContext } from '../types.ts';

export interface ResolvedBackendRuntimePaths {
  interceptorBundlePath?: string;
  piServerPath?: string;
  nodeRuntimePath?: string;
  bundledRuntimePath?: string;
  claudeExecutablePath?: string;
  claudeExecutableSource?: ClaudeExecutableSource;
}

export type ClaudeExecutableSource = 'persisted' | 'host-override' | 'common-install' | 'path' | 'project-local';

export interface ClaudeExecutableValidation {
  valid: boolean;
  path?: string;
  version?: string;
  error?: string;
}

export interface ResolvedBackendHostTooling {
  ripgrepPath?: string;
}

function firstExistingPath(candidates: string[]): string | undefined {
  return candidates.find(candidate => existsSync(candidate));
}

function isBunExecutablePath(candidate: string): boolean {
  const name = basename(candidate).toLowerCase();
  return name === 'bun' || name === 'bun.exe';
}

function firstExistingBunPath(candidates: string[]): string | undefined {
  return firstExistingPath(candidates.filter(isBunExecutablePath));
}

function resolveUpwards(base: string, relativePath: string, maxLevels = 4): string | undefined {
  let directory = resolve(base);
  for (let level = 0; level <= maxLevels; level++) {
    const candidate = join(directory, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function resolveBundledRuntimePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
  const bundled = firstExistingBunPath([
    ...(hostRuntime.resourcesPath ? [join(hostRuntime.resourcesPath, 'vendor', 'bun', binary)] : []),
    join(hostRuntime.appRootPath, 'vendor', 'bun', binary),
    ...(!hostRuntime.isPackaged && process.env.OPCAGENT_BUN ? [process.env.OPCAGENT_BUN] : []),
  ]);
  if (bundled) return bundled;
  if (hostRuntime.isPackaged) return undefined;
  try {
    const command = process.platform === 'win32' ? 'where.exe' : 'which';
    const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const system = execFileSync(command, [executable], { encoding: 'utf-8' });
    return firstExistingBunPath(system.split(/\r?\n/).map(path => path.trim()).filter(Boolean));
  } catch {
    return undefined;
  }
}

function resolveInterceptorBundlePath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  if (hostRuntime.interceptorBundlePath && existsSync(hostRuntime.interceptorBundlePath)) {
    return hostRuntime.interceptorBundlePath;
  }
  if (!hostRuntime.isPackaged) {
    const source = resolveUpwards(
      hostRuntime.appRootPath,
      join('packages', 'shared', 'src', 'unified-network-interceptor.ts'),
      10,
    );
    if (source) return source;
  }
  return resolveUpwards(hostRuntime.appRootPath, join('dist', 'interceptor.cjs'))
    ?? resolveUpwards(hostRuntime.appRootPath, join('apps', 'electron', 'dist', 'interceptor.cjs'));
}

function resolvePiServerPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  if (hostRuntime.isPackaged) {
    return firstExistingPath([
      join(hostRuntime.appRootPath, 'resources', 'pi-agent-server', 'index.js'),
      join(hostRuntime.appRootPath, 'dist', 'resources', 'pi-agent-server', 'index.js'),
    ]);
  }
  return resolveUpwards(
    hostRuntime.appRootPath,
    join('packages', 'pi-agent-server', 'dist', 'index.js'),
  );
}

export function isClaudeExecutablePath(filePath: string): boolean {
  const name = basename(filePath.trim()).toLowerCase();
  return process.platform === 'win32'
    ? name === 'claude.exe'
    : name === 'claude';
}

/** Validate the file shape and run a short, shell-free `--version` probe. */
export function validateClaudeExecutablePath(filePath: string, timeoutMs = 3_000): ClaudeExecutableValidation {
  const path = filePath.trim();
  if (!isClaudeExecutablePath(path)) {
    return {
      valid: false,
      error: process.platform === 'win32'
        ? 'Path must point to the native claude.exe. Claude .cmd/.bat shims are not supported; upgrade Claude Code or select its bin\\claude.exe.'
        : 'Path must point to claude',
    };
  }
  try {
    if (!statSync(path).isFile()) return { valid: false, error: 'Path must point to a file' };
  } catch {
    return { valid: false, error: 'File does not exist at the specified path' };
  }
  try {
    const isWindowsScript = process.platform === 'win32' && /\.cmd$|\.bat$/i.test(path);
    const output = isWindowsScript
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', path, '--version'], { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync(path, ['--version'], { encoding: 'utf-8', timeout: timeoutMs, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return { valid: true, path, version: output.trim().split(/\r?\n/, 1)[0] || undefined };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: `Claude Code did not respond to --version: ${message.slice(0, 240)}` };
  }
}

function claudeNames(): string[] {
  return process.platform === 'win32' ? ['claude.exe'] : ['claude'];
}

function getPathCandidates(): string[] {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const names = claudeNames();
  const candidates: string[] = [];
  for (const name of names) {
    try {
      const found = execFileSync(command, [name], { encoding: 'utf-8', timeout: 2_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      candidates.push(...found.split(/\r?\n/).map(value => value.trim()).filter(Boolean));
    } catch {
      // Continue: a single PATH spelling may not be registered in PATHEXT.
    }
  }
  return candidates;
}

function getConfiguredNpmPrefix(): string | undefined {
  const configured = process.env.npm_config_prefix
    || process.env.NPM_CONFIG_PREFIX
    || process.env.PREFIX;
  if (configured) return configured;

  try {
    const output = process.platform === 'win32'
      ? execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', 'prefix', '-g'], { encoding: 'utf-8', timeout: 2_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      : execFileSync('npm', ['prefix', '-g'], { encoding: 'utf-8', timeout: 2_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const prefix = output.trim();
    return prefix || undefined;
  } catch {
    return undefined;
  }
}

function getCommonClaudeCandidates(): string[] {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || '';
  const localAppData = process.env.LOCALAPPDATA || '';
  const npmPrefixes = [
    getConfiguredNpmPrefix(),
    appData ? join(appData, 'npm') : undefined,
    home ? join(home, '.npm-global') : undefined,
  ].filter((value): value is string => Boolean(value));
  const candidates: string[] = [];
  const addBin = (directory: string) => candidates.push(...claudeNames().map(name => join(directory, name)));
  for (const prefix of npmPrefixes) {
    addBin(process.platform === 'win32' ? prefix : join(prefix, 'bin'));
    candidates.push(process.platform === 'win32'
      ? join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
      : join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'));
  }
  if (process.platform === 'win32') {
    for (const directory of [
      localAppData && join(localAppData, 'pnpm'),
      appData && join(appData, 'pnpm'),
      home && join(home, '.bun', 'bin'),
      home && join(home, '.volta', 'bin'),
      localAppData && join(localAppData, 'Volta', 'bin'),
      home && join(home, 'scoop', 'shims'),
      localAppData && join(localAppData, 'Programs', 'Claude Code'),
      process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Claude Code'),
    ].filter((value): value is string => Boolean(value))) addBin(directory);
  } else {
    for (const directory of [
      home && join(home, '.local', 'bin'),
      home && join(home, '.bun', 'bin'),
      home && join(home, '.volta', 'bin'),
      '/usr/local/bin',
      '/opt/homebrew/bin',
    ].filter(Boolean) as string[]) addBin(directory);
  }
  return candidates;
}

function getProjectLocalClaudeCandidates(appRootPath: string): string[] {
  const candidates: string[] = [];
  let directory = resolve(appRootPath);
  for (let level = 0; level <= 10; level++) {
    candidates.push(...claudeNames().map(name => join(directory, 'node_modules', '.bin', name)));
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return candidates;
}

function firstVerifiedClaudePath(candidates: string[]): ClaudeExecutableValidation | undefined {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = process.platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(key)) continue;
    seen.add(key);
    const validation = validateClaudeExecutablePath(candidate);
    if (validation.valid) return validation;
  }
  return undefined;
}

export function resolveClaudeExecutable(hostRuntime: BackendHostRuntimeContext): (ClaudeExecutableValidation & { source?: ClaudeExecutableSource }) {
  const sources: Array<{ source: ClaudeExecutableSource; candidates: string[] }> = [
    { source: 'persisted', candidates: hostRuntime.persistedClaudeExecutablePath ? [hostRuntime.persistedClaudeExecutablePath] : [] },
    { source: 'host-override', candidates: hostRuntime.claudeExecutablePath ? [hostRuntime.claudeExecutablePath] : [] },
    { source: 'common-install', candidates: getCommonClaudeCandidates() },
    { source: 'path', candidates: getPathCandidates() },
    { source: 'project-local', candidates: getProjectLocalClaudeCandidates(hostRuntime.appRootPath) },
  ];
  for (const entry of sources) {
    const result = firstVerifiedClaudePath(entry.candidates);
    if (result) return { ...result, source: entry.source };
  }
  return { valid: false, error: 'Claude Code executable was not found or failed its --version check' };
}

function resolveRipgrepPath(hostRuntime: BackendHostRuntimeContext): string | undefined {
  const binary = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const relative = join('node_modules', '@vscode', 'ripgrep', 'bin', binary);
  const vendored = resolveUpwards(hostRuntime.appRootPath, relative, 10)
    ?? (existsSync(join(process.cwd(), relative)) ? join(process.cwd(), relative) : undefined);
  if (vendored || hostRuntime.isPackaged) return vendored;
  try {
    const command = process.platform === 'win32' ? 'where' : 'which';
    const system = execFileSync(command, ['rg'], { encoding: 'utf-8' }).trim();
    return system && existsSync(system) ? system : undefined;
  } catch {
    return undefined;
  }
}

export function resolveBackendRuntimePaths(
  hostRuntime: BackendHostRuntimeContext,
): ResolvedBackendRuntimePaths {
  const explicitRuntimePath = hostRuntime.nodeRuntimePath
    ? firstExistingBunPath([hostRuntime.nodeRuntimePath])
    : undefined;
  const bundledRuntimePath = explicitRuntimePath ?? resolveBundledRuntimePath(hostRuntime);
  const claude = resolveClaudeExecutable(hostRuntime);
  return {
    interceptorBundlePath: resolveInterceptorBundlePath(hostRuntime),
    piServerPath: resolvePiServerPath(hostRuntime),
    nodeRuntimePath: bundledRuntimePath,
    bundledRuntimePath,
    claudeExecutablePath: claude.path,
    claudeExecutableSource: claude.source,
  };
}

export function resolveBackendHostTooling(
  hostRuntime: BackendHostRuntimeContext,
): ResolvedBackendHostTooling {
  return { ripgrepPath: resolveRipgrepPath(hostRuntime) };
}
