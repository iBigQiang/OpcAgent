#!/usr/bin/env bun

/** Keep the Lite renderer boundary pinned while requiring restored UI lineage. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dir, '..')
const craftSourceRoot = process.env.CRAFT_AGENT_SOURCE
  ? resolve(process.env.CRAFT_AGENT_SOURCE)
  : repoRoot
const rendererRoot = 'apps/electron/src/renderer'
const restored = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-restored-sources.json'), 'utf8')) as { liteBaseline: string; productBaseline: string; restoredSource: string; integrationReview: Record<string, string>; features: Array<{ name: string; sourcePrefixes: string[]; requiredCurrent: string[]; testAnchors: string[] }> }
const manifest = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-ui-overrides.json'), 'utf8')) as { version: number; files: Record<string, { sha256: string; reason: string }> }
const sourceOverrides = JSON.parse(readFileSync(resolve(import.meta.dir, 'craft-source-overrides.json'), 'utf8')) as { modified: Record<string, { sha256: string; reason: string }>; mkOnly: Record<string, { sha256: string; reason: string }> }
if (manifest.version !== 2) throw new Error('Unsupported Craft UI override manifest version')
function git(args: string[], root = repoRoot): string { const result = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' }); if (result.exitCode !== 0) throw new Error(result.stderr.toString()); return result.stdout.toString() }
function tree(commit: string, root = repoRoot): Set<string> { return new Set(git(['ls-tree', '-r', '--name-only', '-z', commit], root).split('\0').filter(Boolean)) }
function list(dir: string): string[] { return readdirSync(resolve(repoRoot, dir), { withFileTypes: true }).flatMap(entry => { const path = `${dir}/${entry.name}`; return entry.isDirectory() ? list(path) : [path] }) }
function restoredUi(path: string): boolean { return restored.features.some(feature => feature.testAnchors.includes(path) || feature.sourcePrefixes.some(prefix => path === prefix || path.startsWith(prefix))) }
function sha256(path: string): string {
  const content = readFileSync(resolve(repoRoot, path))
  const text = content.toString('utf8')
  const normalized = !content.includes(0) && Buffer.from(text, 'utf8').equals(content)
    ? Buffer.from(text.replaceAll('\r\n', '\n'), 'utf8')
    : content
  return createHash('sha256').update(normalized).digest('hex')
}

const source = tree(restored.restoredSource, craftSourceRoot)
const product = tree(restored.productBaseline)
const files = list(rendererRoot)
const changedFromProduct = new Set(git(['diff', '--name-only', restored.productBaseline, '--', rendererRoot]).split('\n').filter(Boolean))
const errors: string[] = []
for (const feature of restored.features) {
  const relevant = feature.sourcePrefixes.some(prefix => prefix.startsWith(rendererRoot) && [...source].some(path => path === prefix || path.startsWith(prefix)))
  if (!relevant) continue
  for (const path of feature.requiredCurrent.filter(path => path.startsWith(rendererRoot))) {
    if (!existsSync(resolve(repoRoot, path))) errors.push(`${feature.name}: missing restored UI anchor ${path}`)
    if (!source.has(path) || !git(['show', `${restored.restoredSource}:${path}`], craftSourceRoot).length) errors.push(`${feature.name}: UI anchor lacks restored-source content ${path}`)
  }
}
for (const path of files) {
  if (restoredUi(path)) continue
  if (!changedFromProduct.has(path) && product.has(path)) continue
  const review = sourceOverrides.modified[path] ?? sourceOverrides.mkOnly[path]
  if (!review?.reason.trim()) errors.push(`unreviewed product-baseline renderer change: ${path}`)
  else if (sha256(path) !== review.sha256) errors.push(`reviewed renderer hash mismatch: ${path}`)
}
for (const [path, review] of Object.entries(restored.integrationReview)) {
  if (!path.startsWith(`${rendererRoot}/`)) continue
  if (!review.trim()) errors.push(`renderer integration review has no reason: ${path}`)
  if (!changedFromProduct.has(path) && product.has(path)) errors.push(`stale renderer integration review entry: ${path}`)
}
if (errors.length) { console.error('Craft Lite renderer boundary failed:'); for (const error of errors) console.error(`- ${error}`); process.exit(1) }
console.log(`Craft renderer boundary verified from product baseline ${restored.productBaseline} (${files.length} files; restored source ${restored.restoredSource})`)
