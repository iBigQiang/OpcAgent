#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getOPCAgentReadOnlyBashPatterns } from './cli-domains.ts'

interface AllowedBashEntry {
  pattern: string
  comment?: string
}

interface PermissionsConfig {
  version?: string
  allowedBashPatterns?: AllowedBashEntry[]
  [key: string]: unknown
}

function isOPCAgentPattern(entry: AllowedBashEntry): boolean {
  return typeof entry.pattern === 'string' && entry.pattern.startsWith('^opcagent\\s')
}

function syncOPCAgentPatterns(config: PermissionsConfig): PermissionsConfig {
  const patterns = config.allowedBashPatterns ?? []
  const firstIndex = patterns.findIndex(isOPCAgentPattern)

  const without = patterns.filter(entry => !isOPCAgentPattern(entry))
  const generated = getOPCAgentReadOnlyBashPatterns()

  const insertAt = firstIndex >= 0 ? firstIndex : without.length
  const nextAllowedBashPatterns = [
    ...without.slice(0, insertAt),
    ...generated,
    ...without.slice(insertAt),
  ]

  return {
    ...config,
    allowedBashPatterns: nextAllowedBashPatterns,
  }
}

function main() {
  const targetPath = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), 'apps/electron/resources/permissions/default.json')

  const config = JSON.parse(readFileSync(targetPath, 'utf-8')) as PermissionsConfig
  const nextConfig = syncOPCAgentPatterns(config)

  writeFileSync(targetPath, `${JSON.stringify(nextConfig, null, 2)}\n`, 'utf-8')
  process.stdout.write(`Synced opcagent bash patterns in ${targetPath}\n`)
}

if (import.meta.main) {
  main()
}
