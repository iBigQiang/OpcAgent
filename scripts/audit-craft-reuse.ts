#!/usr/bin/env bun

/** Verify Lite lineage from pinned Git objects, with explicit restored feature coverage. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '..')
const jsonOutput = process.argv.includes('--json')
type Feature = { name: string; sourcePrefixes: string[]; requiredCurrent: string[]; testAnchors: string[] }
type RestoredManifest = { version: number; liteBaseline: string; productBaseline: string; restoredSource: string; integrationReview: Record<string, string>; features: Feature[] }
const restored = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-restored-sources.json'), 'utf8')) as RestoredManifest
const overrides = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-source-overrides.json'), 'utf8')) as { version: number; baselineCommit: string }
if (restored.version !== 1) throw new Error('Unsupported restored-source manifest version')
if (overrides.version !== 2 || overrides.baselineCommit !== restored.liteBaseline) throw new Error('Source override manifest must retain the historical Lite baseline')

function git(args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', repoRoot, ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim())
  return result.stdout.toString()
}
function tree(commit: string): Set<string> { return new Set(git(['ls-tree', '-r', '--name-only', '-z', commit]).split('\0').filter(Boolean)) }
function worktree(): string[] { return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean) }
function objectText(commit: string, path: string): string { return git(['show', `${commit}:${path}`]) }
function isRestored(path: string): boolean {
  return restored.features.some(feature =>
    feature.testAnchors.includes(path) || feature.sourcePrefixes.some(prefix => path === prefix || path.startsWith(prefix)),
  )
}

const restoreFiles = tree(restored.restoredSource)
const productFiles = tree(restored.productBaseline)
const files = worktree().filter(path => existsSync(resolve(repoRoot, path)))
const errors: string[] = []
for (const feature of restored.features) {
  for (const prefix of feature.sourcePrefixes) {
    const sourced = [...restoreFiles].find(path => path === prefix || path.startsWith(prefix))
    if (!sourced) {
      errors.push(`${feature.name}: missing restored-source lineage for ${prefix}`)
      continue
    }
    if (!objectText(restored.restoredSource, sourced).length) errors.push(`${feature.name}: empty restored-source object ${sourced}`)
  }
  for (const path of [...feature.requiredCurrent, ...feature.testAnchors]) {
    if (!existsSync(resolve(repoRoot, path))) errors.push(`${feature.name}: missing required current coverage anchor ${path}`)
  }
}

const restoredCurrent = files.filter(isRestored)
const changedFromProduct = new Set(git(['diff', '--name-only', restored.productBaseline, '--']).split('\n').filter(Boolean))
const addedFiles = files.filter(path => !productFiles.has(path))
const reviewed = new Set<string>()
for (const path of [...changedFromProduct, ...addedFiles]) {
  if (isRestored(path)) { reviewed.add(path); continue }
  const reason = restored.integrationReview[path]
  if (!reason?.trim()) errors.push(`unreviewed product-baseline change: ${path}`)
  else reviewed.add(path)
}
for (const [path, reason] of Object.entries(restored.integrationReview)) {
  if (!reason.trim()) errors.push(`integration review has no reason: ${path}`)
  if (!changedFromProduct.has(path) && productFiles.has(path)) errors.push(`stale integration review entry: ${path}`)
  if (!existsSync(resolve(repoRoot, path))) errors.push(`missing integration review file: ${path}`)
}

if (errors.length) { console.error('Craft lineage audit failed:'); for (const error of errors) console.error(`- ${error}`); process.exit(1) }
const summary = { liteBaseline: restored.liteBaseline, productBaseline: restored.productBaseline, restoredSource: restored.restoredSource, restoredFeatures: restored.features.map(feature => feature.name), restoredCurrentFiles: restoredCurrent.length, reviewedIntegrationFiles: reviewed.size }
if (jsonOutput) console.log(JSON.stringify(summary, null, 2))
else {
  console.log('MkAgent pinned Craft lineage audit')
  console.log(`Lite baseline: ${summary.liteBaseline}`)
  console.log(`Restored source: ${summary.restoredSource}`)
  console.log(`Explicit restored feature files: ${summary.restoredCurrentFiles}`)
  console.log(`Product-baseline integration files explicitly reviewed: ${summary.reviewedIntegrationFiles}`)
}
