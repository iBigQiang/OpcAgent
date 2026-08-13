#!/usr/bin/env bun

/** Ensure Lite test coverage remains accounted for and restored features keep explicit tests. */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '..')
const restored = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-restored-sources.json'), 'utf8')) as { liteBaseline: string; restoredSource: string; features: Array<{ name: string; testAnchors: string[] }> }
function git(args: string[]): string { const result = Bun.spawnSync(['git', '-C', repoRoot, ...args], { stdout: 'pipe', stderr: 'pipe' }); if (result.exitCode !== 0) throw new Error(result.stderr.toString()); return result.stdout.toString() }
function isTest(path: string): boolean { return /\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(path) || path.endsWith('.isolated.ts') }
const liteTests = git(['ls-tree', '-r', '--name-only', '-z', restored.liteBaseline]).split('\0').filter(isTest)
const errors: string[] = []
for (const feature of restored.features) for (const test of feature.testAnchors) if (!existsSync(resolve(repoRoot, test))) errors.push(`${feature.name}: missing restored test anchor ${test}`)
// Lite's original cut-down gate stays active: every Lite test is present or is
// covered by the existing, reviewed source override deletion manifest.
const overrides = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-source-overrides.json'), 'utf8')) as { deleted: Record<string, string> }
for (const test of liteTests) if (!existsSync(resolve(repoRoot, test)) && !overrides.deleted[test]) errors.push(`unreviewed Lite test removal: ${test}`)
if (errors.length) { console.error('Craft retained-test coverage failed:'); for (const error of errors) console.error(`- ${error}`); process.exit(1) }
console.log(`Craft retained-test coverage verified from pinned Lite baseline (${liteTests.length} Lite tests, ${restored.features.length} restored features)`)
