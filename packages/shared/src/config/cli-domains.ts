export type CliDomainNamespace = 'workspace' | 'session' | 'connections' | 'config'

export interface CliDomainPolicy {
  namespace: CliDomainNamespace
  helpCommand: string
  workspacePathScopes: string[]
  readActions: string[]
  quickExamples: string[]
  /** Optional workspace-relative paths guarded for direct Bash operations */
  bashGuardPaths?: string[]
}

const POLICIES: Record<CliDomainNamespace, CliDomainPolicy> = {
  workspace: {
    namespace: 'workspace',
    helpCommand: 'opcagent --help',
    workspacePathScopes: [],
    readActions: ['list'],
    quickExamples: ['opcagent workspace list'],
  },
  session: {
    namespace: 'session',
    helpCommand: 'opcagent --help',
    workspacePathScopes: [],
    readActions: ['list', 'messages'],
    quickExamples: ['opcagent session list', 'opcagent session messages <id>'],
  },
  connections: {
    namespace: 'connections',
    helpCommand: 'opcagent --help',
    workspacePathScopes: [],
    readActions: ['list'],
    quickExamples: ['opcagent connections list'],
  },
  config: {
    namespace: 'config',
    helpCommand: 'opcagent --help',
    workspacePathScopes: [],
    readActions: ['validate'],
    quickExamples: ['opcagent config validate'],
  },
}

export const CLI_DOMAIN_POLICIES = POLICIES

export interface CliDomainScopeEntry {
  namespace: CliDomainNamespace
  scope: string
}

function dedupeScopes(scopes: string[]): string[] {
  return [...new Set(scopes)]
}

/**
 * Canonical workspace-relative path scopes owned by opcagent CLI domains.
 * Use these for file-path ownership checks to avoid drift across call sites.
 */
export const OPCAGENT_AGENTS_CLI_OWNED_WORKSPACE_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.workspacePathScopes)
)

/**
 * Canonical workspace-relative path scopes guarded for direct Bash operations.
 */
export const OPCAGENT_AGENTS_CLI_OWNED_BASH_GUARD_PATH_SCOPES = dedupeScopes(
  Object.values(POLICIES).flatMap(policy => policy.bashGuardPaths ?? [])
)

/**
 * Namespace-aware workspace scope entries for opcagent CLI owned paths.
 */
export const OPCAGENT_AGENTS_CLI_WORKSPACE_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => policy.workspacePathScopes.map(scope => ({ namespace: policy.namespace, scope })))

/**
 * Namespace-aware Bash guard scope entries.
 */
export const OPCAGENT_AGENTS_CLI_BASH_GUARD_SCOPE_ENTRIES: CliDomainScopeEntry[] = Object.values(POLICIES)
  .flatMap(policy => (policy.bashGuardPaths ?? []).map(scope => ({ namespace: policy.namespace, scope })))

export interface BashPatternRule {
  pattern: string
  comment: string
}

/**
 * Derive the canonical Explore-mode read-only opcagent bash patterns from
 * CLI domain policies. Keeps permissions regexes aligned with command metadata.
 */
export function getOPCAgentReadOnlyBashPatterns(): BashPatternRule[] {
  const namespaces = Object.keys(POLICIES) as CliDomainNamespace[]
  const namespaceAlternation = namespaces.join('|')

  const rules: BashPatternRule[] = namespaces.map((namespace) => {
    const policy = POLICIES[namespace]
    const actions = policy.readActions.join('|')
    return {
      pattern: `^opcagent\\s+${namespace}\\s+(${actions})\\b`,
      comment: `opcagent ${namespace} read-only operations`,
    }
  })

  rules.push(
    { pattern: '^opcagent\\s*$', comment: 'opcagent bare invocation (prints help)' },
    { pattern: `^opcagent\\s+(${namespaceAlternation})\\s*$`, comment: 'opcagent entity help' },
    { pattern: `^opcagent\\s+(${namespaceAlternation})\\s+--help\\b`, comment: 'opcagent entity help flags' },
    { pattern: '^opcagent\\s+--(help|version|discover)\\b', comment: 'opcagent global flags' },
  )

  return rules
}

export function getCliDomainPolicy(namespace: CliDomainNamespace): CliDomainPolicy {
  return POLICIES[namespace]
}
