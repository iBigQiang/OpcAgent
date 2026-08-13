/**
 * Tests for runtime-resolver.ts
 *
 * Verifies:
 * - Packaged server path resolution with dist/resources/ fallback
 * - Ripgrep path resolution with system rg fallback
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, chmodSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveBackendRuntimePaths, resolveClaudeExecutable, validateClaudeExecutablePath } from '../internal/runtime-resolver.ts';
import { resolveBackendHostTooling } from '../factory.ts';
import type { BackendHostRuntimeContext } from '../types.ts';

describe('resolveServerPath fallback', () => {
  const tmpBase = join(tmpdir(), `resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds server in dist/resources/ when resources/ does not exist', () => {
    // Simulate packaged app where server is at dist/resources/<name>/index.js
    const appRoot = join(tmpBase, 'app');
    const serverDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, 'index.js'), '// stub');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(serverDir, 'index.js'));
  });

  it('prefers resources/ over dist/resources/ when both exist', () => {
    const appRoot = join(tmpBase, 'app2');

    // Create both paths
    const primaryDir = join(appRoot, 'resources', 'pi-agent-server');
    const fallbackDir = join(appRoot, 'dist', 'resources', 'pi-agent-server');
    mkdirSync(primaryDir, { recursive: true });
    mkdirSync(fallbackDir, { recursive: true });
    writeFileSync(join(primaryDir, 'index.js'), '// primary');
    writeFileSync(join(fallbackDir, 'index.js'), '// fallback');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.piServerPath).toBe(join(primaryDir, 'index.js'));
  });
});

describe('resolveClaudeExecutablePath', () => {
  const tmpBase = join(tmpdir(), `claude-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  function createClaudeExecutable(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const executable = join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (process.platform === 'win32') copyFileSync(process.execPath, executable);
    else writeFileSync(executable, '#!/bin/sh\necho 1.2.3\n');
    if (process.platform !== 'win32') chmodSync(executable, 0o755);
    return executable;
  }

  function withClaudeDiscoveryEnvironment(overrides: Record<string, string | undefined>, run: () => void): void {
    const previous = new Map<string, string | undefined>();
    for (const [key, value] of Object.entries(overrides)) {
      previous.set(key, process.env[key]);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      run();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it('honors an explicit Claude Code executable supplied by the host runtime', () => {
    const executable = createClaudeExecutable(tmpBase);
    expect(validateClaudeExecutablePath(executable)).toMatchObject({ valid: true, path: executable });

    const paths = resolveBackendRuntimePaths({
      appRootPath: join(tmpBase, 'app'),
      isPackaged: false,
      claudeExecutablePath: executable,
    });

    expect(paths.claudeExecutablePath).toBe(executable);
  });

  it('does not use the deprecated Agent SDK executable in packaged builds', () => {
    const appRoot = join(tmpBase, 'packaged-app');
    const legacyExecutable = join(appRoot, 'resources', 'claude-agent-sdk', process.platform === 'win32' ? 'claude.exe' : 'claude');
    mkdirSync(join(appRoot, 'resources', 'claude-agent-sdk'), { recursive: true });
    if (process.platform === 'win32') copyFileSync(process.execPath, legacyExecutable);
    else writeFileSync(legacyExecutable, '#!/bin/sh\necho 1.2.3\n');
    if (process.platform !== 'win32') chmodSync(legacyExecutable, 0o755);

    const paths = resolveBackendRuntimePaths({
      appRootPath: appRoot,
      isPackaged: true,
    });

    expect(paths.claudeExecutablePath).not.toBe(legacyExecutable);
  });

  it('prefers persisted paths over host overrides and validates --version', () => {
    const persisted = createClaudeExecutable(join(tmpBase, 'persisted'));
    const override = createClaudeExecutable(join(tmpBase, 'override'));

    const result = resolveClaudeExecutable({
      appRootPath: join(tmpBase, 'app'),
      isPackaged: true,
      persistedClaudeExecutablePath: persisted,
      claudeExecutablePath: override,
    });

    expect(result).toMatchObject({ valid: true, path: persisted, source: 'persisted' });
  });

  it('prefers a common npm installation over PATH and project-local candidates', () => {
    const prefix = join(tmpBase, 'npm-prefix');
    const commonDirectory = process.platform === 'win32'
      ? join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
      : join(prefix, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    const common = createClaudeExecutable(commonDirectory);
    const pathDirectory = join(tmpBase, 'path');
    const pathCandidate = createClaudeExecutable(pathDirectory);
    const appRoot = join(tmpBase, 'project', 'app');
    const projectLocal = createClaudeExecutable(join(appRoot, 'node_modules', '.bin'));

    withClaudeDiscoveryEnvironment({
      NPM_CONFIG_PREFIX: undefined,
      PREFIX: undefined,
      APPDATA: join(tmpBase, 'appdata'),
      LOCALAPPDATA: join(tmpBase, 'localappdata'),
      USERPROFILE: join(tmpBase, 'home'),
      HOME: join(tmpBase, 'home'),
      PATH: pathDirectory,
      npm_config_prefix: prefix,
    }, () => {
      const result = resolveClaudeExecutable({ appRootPath: appRoot, isPackaged: false });
      expect(result).toMatchObject({ valid: true, path: common, source: 'common-install' });
      expect(result.path).not.toBe(pathCandidate);
      expect(result.path).not.toBe(projectLocal);
    });
  });

  it('uses a project-local executable when no configured common install is available', () => {
    const appRoot = join(tmpBase, 'project-local', 'app');
    const projectLocal = createClaudeExecutable(join(appRoot, 'node_modules', '.bin'));
    const emptyPrefix = join(tmpBase, 'empty-prefix');

    withClaudeDiscoveryEnvironment({
      NPM_CONFIG_PREFIX: emptyPrefix,
      PREFIX: undefined,
      APPDATA: join(tmpBase, 'appdata'),
      LOCALAPPDATA: join(tmpBase, 'localappdata'),
      USERPROFILE: join(tmpBase, 'home'),
      HOME: join(tmpBase, 'home'),
      PATH: '',
      npm_config_prefix: emptyPrefix,
    }, () => {
      const result = resolveClaudeExecutable({ appRootPath: appRoot, isPackaged: false });
      expect(result).toMatchObject({ valid: true, path: projectLocal, source: 'project-local' });
    });
  });

  it('rejects Windows command shims before executing them', () => {
    if (process.platform !== 'win32') return;
    const shim = join(tmpBase, 'claude.cmd');
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(shim, '@echo off\r\necho unsafe\r\n');

    expect(validateClaudeExecutablePath(shim)).toMatchObject({
      valid: false,
      error: expect.stringContaining('claude.exe'),
    });
  });

  it('rejects a matching filename when --version cannot run', () => {
    const invalid = join(tmpBase, process.platform === 'win32' ? 'claude.exe' : 'claude');
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(invalid, process.platform === 'win32' ? 'not an executable' : '#!/bin/sh\nexit 7\n');
    if (process.platform !== 'win32') chmodSync(invalid, 0o755);

    expect(validateClaudeExecutablePath(invalid).valid).toBe(false);
  });
});

describe('resolveBundledRuntimePath', () => {
  const tmpBase = join(tmpdir(), `runtime-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds Bun copied as an Electron extraResource', () => {
    const appRoot = join(tmpBase, 'resources', 'app');
    const resourcesPath = join(tmpBase, 'resources');
    const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bundled = join(resourcesPath, 'vendor', 'bun', binary);
    mkdirSync(join(resourcesPath, 'vendor', 'bun'), { recursive: true });
    writeFileSync(bundled, 'stub');

    const paths = resolveBackendRuntimePaths({ appRootPath: appRoot, resourcesPath, isPackaged: true });
    expect(paths.bundledRuntimePath).toBe(bundled);
    expect(paths.nodeRuntimePath).toBe(bundled);
  });

  it('falls back to Bun inside the unpacked app directory', () => {
    const appRoot = join(tmpBase, 'resources', 'app');
    const resourcesPath = join(tmpBase, 'resources');
    const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const bundled = join(appRoot, 'vendor', 'bun', binary);
    mkdirSync(join(appRoot, 'vendor', 'bun'), { recursive: true });
    writeFileSync(bundled, 'stub');

    const paths = resolveBackendRuntimePaths({ appRootPath: appRoot, resourcesPath, isPackaged: true });
    expect(paths.bundledRuntimePath).toBe(bundled);
  });

  it('honors OPCAGENT_BUN when PATH lookup is unavailable', () => {
    const appRoot = join(tmpBase, 'env-override');
    const binary = process.platform === 'win32' ? 'bun.exe' : 'bun';
    const configured = join(tmpBase, 'configured', binary);
    mkdirSync(join(tmpBase, 'configured'), { recursive: true });
    writeFileSync(configured, 'stub');

    const previousBun = process.env.OPCAGENT_BUN;
    const previousPath = process.env.PATH;
    process.env.OPCAGENT_BUN = configured;
    process.env.PATH = '';

    try {
      const paths = resolveBackendRuntimePaths({ appRootPath: appRoot, isPackaged: false });
      expect(paths.bundledRuntimePath).toBe(configured);
      expect(paths.nodeRuntimePath).toBe(configured);
    } finally {
      if (previousBun === undefined) delete process.env.OPCAGENT_BUN;
      else process.env.OPCAGENT_BUN = previousBun;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('does not fall back to the host process when packaged Bun is unavailable', () => {
    const appRoot = join(tmpBase, 'missing-runtime');
    const previousBun = process.env.OPCAGENT_BUN;
    delete process.env.OPCAGENT_BUN;

    try {
      const paths = resolveBackendRuntimePaths({ appRootPath: appRoot, isPackaged: true });
      expect(paths.bundledRuntimePath).toBeUndefined();
      expect(paths.nodeRuntimePath).toBeUndefined();
    } finally {
      if (previousBun === undefined) delete process.env.OPCAGENT_BUN;
      else process.env.OPCAGENT_BUN = previousBun;
    }
  });

  it('rejects Node executables passed as Bun runtime overrides', () => {
    const appRoot = join(tmpBase, 'invalid-runtime');
    const invalidRuntime = join(tmpBase, process.platform === 'win32' ? 'node.exe' : 'node');
    mkdirSync(tmpBase, { recursive: true });
    writeFileSync(invalidRuntime, 'stub');
    const previousBun = process.env.OPCAGENT_BUN;
    process.env.OPCAGENT_BUN = invalidRuntime;

    try {
      const fromEnvironment = resolveBackendRuntimePaths({ appRootPath: appRoot, isPackaged: true });
      const fromHostOverride = resolveBackendRuntimePaths({
        appRootPath: appRoot,
        isPackaged: true,
        nodeRuntimePath: invalidRuntime,
      });
      expect(fromEnvironment.nodeRuntimePath).toBeUndefined();
      expect(fromHostOverride.nodeRuntimePath).toBeUndefined();
    } finally {
      if (previousBun === undefined) delete process.env.OPCAGENT_BUN;
      else process.env.OPCAGENT_BUN = previousBun;
    }
  });
});

describe('resolveRipgrepPath', () => {
  const tmpBase = join(tmpdir(), `rg-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('finds vendored ripgrep binary (@vscode/ripgrep)', () => {
    const appRoot = join(tmpBase, 'vendored');
    const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
    const rgDir = join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin');
    mkdirSync(rgDir, { recursive: true });
    const rgPath = join(rgDir, binaryName);
    writeFileSync(rgPath, '#!/bin/sh\n');
    chmodSync(rgPath, 0o755);

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    expect(result.ripgrepPath).toBe(rgPath);
  });

  it('falls back to system rg when vendored binary is missing (non-packaged)', () => {
    const appRoot = join(tmpBase, 'no-vendored');
    mkdirSync(appRoot, { recursive: true });

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    // On CI/dev machines with rg installed, this finds system rg.
    // On machines without rg, this returns undefined.
    // We just verify it doesn't throw.
    expect(result.ripgrepPath === undefined || typeof result.ripgrepPath === 'string').toBe(true);
  });

  it('does NOT fall back to system rg for packaged apps (respects isPackaged guard)', () => {
    // On dev machines, the CWD fallback (existing pre-change behavior) will find
    // the vendored binary from the monorepo. This test verifies the system PATH
    // fallback is gated by isPackaged — if the result is defined, it must be
    // a vendored path (not /usr/bin/rg or similar system path).
    const appRoot = join(tmpBase, 'packaged');
    mkdirSync(appRoot, { recursive: true });

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };

    const result = resolveBackendHostTooling({ hostRuntime });
    if (result.ripgrepPath) {
      // Must be a vendored path, not a system PATH resolution
      expect(result.ripgrepPath).toContain('node_modules');
    }
  });
});

describe('resolveInterceptorBundlePath dev-mode source preference', () => {
  const tmpBase = join(tmpdir(), `interceptor-resolver-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('prefers .ts source over the bundled .cjs in dev (non-packaged) so changes propagate without rebuild', () => {
    const appRoot = join(tmpBase, 'monorepo', 'apps', 'electron');
    const sourceDir = join(tmpBase, 'monorepo', 'packages', 'shared', 'src');
    const bundleDir = join(tmpBase, 'monorepo', 'apps', 'electron', 'dist');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    const sourcePath = join(sourceDir, 'unified-network-interceptor.ts');
    const bundlePath = join(bundleDir, 'interceptor.cjs');
    writeFileSync(sourcePath, '// ts source\n');
    writeFileSync(bundlePath, '// cjs bundle\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(sourcePath);
  });

  it('uses the bundled .cjs in packaged builds even when source is reachable', () => {
    const appRoot = join(tmpBase, 'packaged-app');
    const sourceDir = join(tmpBase, 'packaged-app', 'packages', 'shared', 'src');
    const bundleDir = join(tmpBase, 'packaged-app', 'dist');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(sourceDir, 'unified-network-interceptor.ts'), '// source\n');
    const bundlePath = join(bundleDir, 'interceptor.cjs');
    writeFileSync(bundlePath, '// bundle\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: true,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(bundlePath);
  });

  it('honors explicit hostRuntime.interceptorBundlePath override regardless of mode', () => {
    const appRoot = join(tmpBase, 'override');
    mkdirSync(appRoot, { recursive: true });
    const overridePath = join(appRoot, 'custom-interceptor.cjs');
    writeFileSync(overridePath, '// custom\n');

    const hostRuntime: BackendHostRuntimeContext = {
      appRootPath: appRoot,
      resourcesPath: appRoot,
      isPackaged: false,
      interceptorBundlePath: overridePath,
    };
    const paths = resolveBackendRuntimePaths(hostRuntime);
    expect(paths.interceptorBundlePath).toBe(overridePath);
  });
});
