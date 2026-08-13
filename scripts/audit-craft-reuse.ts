#!/usr/bin/env bun

/** Verify Lite lineage from pinned Git objects, with explicit restored feature coverage. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '..')
const craftSourceRoot = process.env.CRAFT_AGENT_SOURCE
  ? resolve(process.env.CRAFT_AGENT_SOURCE)
  : repoRoot
const jsonOutput = process.argv.includes('--json')
type Feature = { name: string; sourcePrefixes: string[]; requiredCurrent: string[]; testAnchors: string[] }
type RestoredManifest = { version: number; liteBaseline: string; productBaseline: string; restoredSource: string; integrationReview: Record<string, string>; features: Feature[] }
type OverrideEntry = { sha256: string; reason: string }
type RenameEntry = { to: string; reason: string }
type OverrideManifest = {
  version: number
  baselineCommit: string
  modified: Record<string, OverrideEntry>
  mkOnly: Record<string, OverrideEntry>
  renamed?: Record<string, RenameEntry>
}
const restored = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-restored-sources.json'), 'utf8')) as RestoredManifest
const overrides = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-source-overrides.json'), 'utf8')) as OverrideManifest
if (restored.version !== 1) throw new Error('Unsupported restored-source manifest version')
if (overrides.version !== 2 || overrides.baselineCommit !== restored.liteBaseline) throw new Error('Source override manifest must retain the historical Lite baseline')

function git(args: string[], root = repoRoot): string {
  const result = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim())
  return result.stdout.toString()
}
function tree(commit: string, root = repoRoot): Set<string> { return new Set(git(['ls-tree', '-r', '--name-only', '-z', commit], root).split('\0').filter(Boolean)) }
function worktree(): string[] { return git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean) }
function objectText(commit: string, path: string): string { return git(['show', `${commit}:${path}`], craftSourceRoot) }
function fileSha256(path: string): string {
  const content = readFileSync(resolve(repoRoot, path))
  const text = content.toString('utf8')
  const normalized = !content.includes(0) && Buffer.from(text, 'utf8').equals(content)
    ? Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8')
    : content
  return createHash('sha256').update(normalized).digest('hex')
}
function isRestored(path: string): boolean {
  return restored.features.some(feature =>
    feature.testAnchors.includes(path) || feature.sourcePrefixes.some(prefix => path === prefix || path.startsWith(prefix)),
  )
}

const restoreFiles = tree(restored.restoredSource, craftSourceRoot)
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
const changedFromProduct = new Set(git(['diff', '--name-only', '-z', restored.productBaseline, '--']).split('\0').filter(Boolean))
const deletedFromProduct = new Set(git(['diff', '--no-renames', '--name-only', '--diff-filter=D', '-z', restored.productBaseline, '--']).split('\0').filter(Boolean))
const addedFiles = files.filter(path => !productFiles.has(path))
const reviewed = new Set<string>()
const overrideEntries = { ...overrides.modified, ...overrides.mkOnly }
for (const path of [...changedFromProduct, ...addedFiles]) {
  if (deletedFromProduct.has(path)) continue
  if (path === 'scripts/craft-source-overrides.json') { reviewed.add(path); continue }
  const review = overrideEntries[path]
  if (!review?.reason.trim()) {
    errors.push(`unreviewed product-baseline change: ${path}`)
    continue
  }
  if (!existsSync(resolve(repoRoot, path))) {
    errors.push(`missing reviewed product-baseline file: ${path}`)
    continue
  }
  const actual = fileSha256(path)
  if (actual !== review.sha256) errors.push(`reviewed product-baseline hash mismatch: ${path}`)
  else reviewed.add(path)
}
for (const path of deletedFromProduct) {
  const rename = overrides.renamed?.[path]
  if (!rename?.reason.trim()) {
    errors.push(`unreviewed product-baseline removal: ${path}`)
    continue
  }
  if (!rename.to || !existsSync(resolve(repoRoot, rename.to))) {
    errors.push(`missing renamed destination for ${path}: ${rename.to || '<missing>'}`)
    continue
  }
  if (existsSync(resolve(repoRoot, path))) errors.push(`renamed source still exists: ${path}`)
  const destinationReview = overrideEntries[rename.to]
  if (!destinationReview?.reason.trim()) errors.push(`renamed destination is not hash-reviewed: ${rename.to}`)
  else if (fileSha256(rename.to) !== destinationReview.sha256) errors.push(`renamed destination hash mismatch: ${rename.to}`)
  reviewed.add(path)
}
for (const [path, reason] of Object.entries(restored.integrationReview)) {
  if (!reason.trim()) errors.push(`integration review has no reason: ${path}`)
  if (!changedFromProduct.has(path) && productFiles.has(path)) errors.push(`stale integration review entry: ${path}`)
  if (!existsSync(resolve(repoRoot, path))) errors.push(`missing integration review file: ${path}`)
}
const renameDestinations = new Set<string>()
for (const [path, rename] of Object.entries(overrides.renamed ?? {})) {
  if (!deletedFromProduct.has(path)) errors.push(`stale rename source: ${path}`)
  if (!rename.reason.trim()) errors.push(`rename has no reason: ${path}`)
  if (!rename.to || !existsSync(resolve(repoRoot, rename.to))) errors.push(`missing rename destination: ${path}`)
  if (renameDestinations.has(rename.to)) errors.push(`duplicate rename destination: ${rename.to}`)
  renameDestinations.add(rename.to)
}

if (errors.length) { console.error('Craft lineage audit failed:'); for (const error of errors) console.error(`- ${error}`); process.exit(1) }
const summary = { liteBaseline: restored.liteBaseline, productBaseline: restored.productBaseline, restoredSource: restored.restoredSource, restoredFeatures: restored.features.map(feature => feature.name), restoredCurrentFiles: restoredCurrent.length, reviewedIntegrationFiles: reviewed.size }
if (jsonOutput) console.log(JSON.stringify(summary, null, 2))
else {
  console.log('OPC Agent pinned Craft lineage audit')
  console.log(`Lite baseline: ${summary.liteBaseline}`)
  console.log(`Restored source: ${summary.restoredSource}`)
  console.log(`Explicit restored feature files: ${summary.restoredCurrentFiles}`)
  console.log(`Product-baseline integration files explicitly reviewed: ${summary.reviewedIntegrationFiles}`)
}
