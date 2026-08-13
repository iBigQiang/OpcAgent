/**
 * ApiKeyInput - Reusable API key entry form control
 *
 * Renders a password input for the API key, a preset selector for Base URL,
 * and an optional Model override field.
 *
 * Does NOT include layout wrappers or action buttons — the parent
 * controls placement via the form ID ("api-key-form") for submit binding.
 *
 * Used in: Onboarding CredentialsStep, Settings API dialog
 */

import { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Command as CommandPrimitive } from "cmdk"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from "@/components/ui/styled-dropdown"
import { cn } from "@/lib/utils"
import { Check, ChevronDown, Eye, EyeOff, FolderOpen, Loader2, RefreshCw, RotateCcw } from "lucide-react"
import { pickTierDefaults, resolveTierModels, type PiModelInfo } from "./tier-models"
import {
  getClaudeCliStatusMessage,
  hasSavedClaudeCliPath,
  shouldShowClaudeCliControls,
} from "./claude-cli-status"
import {
  resolveCustomEndpointPayload,
  resolveEditableApiKey,
  resolvePiAuthProviderForSubmit,
  resolvePresetStateForBaseUrlChange,
  PLATFORM_PROFILE_BY_PRESET,
  type PresetKey,
} from "./submit-helpers"

import {
  normalizeCustomEndpointUrl,
  type CustomEndpointApi,
  type CustomEndpointConfig,
  type LlmPlatformProfile,
} from '@config/llm-connections'
import type { ClaudeCliStatus } from '../../../shared/types'

export type ApiKeyStatus = 'idle' | 'validating' | 'success' | 'error'

export type { CustomEndpointApi }

export interface ApiKeySubmitData {
  apiKey: string
  baseUrl?: string
  connectionDefaultModel?: string
  models?: string[]
  piAuthProvider?: string
  modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
  /** Custom endpoint protocol — set when user configures an arbitrary API endpoint */
  customEndpoint?: CustomEndpointConfig
  /** Platform routing profile for a branded compatible endpoint. */
  platformProfile?: LlmPlatformProfile
}

export interface ApiKeyInputProps {
  /** Current validation status */
  status: ApiKeyStatus
  /** Error message to display when status is 'error' */
  errorMessage?: string
  /** Called when the form is submitted with the key and optional endpoint config */
  onSubmit: (data: ApiKeySubmitData) => void
  /** Form ID for external submit button binding (default: "api-key-form") */
  formId?: string
  /** Disable the input (e.g. during validation) */
  disabled?: boolean
  /** Pre-fill values when editing an existing connection */
  initialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    /** Pre-fill the protocol toggle for custom endpoints */
    customApi?: CustomEndpointApi
    /** Pre-fill a branded platform endpoint. */
    platformProfile?: LlmPlatformProfile
  }
}

interface Preset {
  key: PresetKey
  label: string
  labelKey?: string
  url: string
  placeholder?: string
  descriptionKey?: string
}

// Provider presets routed through the Pi SDK.
const PI_PROVIDER_PRESETS: Preset[] = [
  { key: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com', placeholder: 'sk-ant-...' },
  { key: 'openai', label: 'OpenAI', url: 'https://api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-eu', label: 'OpenAI EU', url: 'https://eu.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'openai-us', label: 'OpenAI US', url: 'https://us.api.openai.com/v1', placeholder: 'sk-...' },
  { key: 'google', label: 'Google AI Studio', url: 'https://generativelanguage.googleapis.com/v1beta', placeholder: 'AIza...' },
  { key: 'openrouter', label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-...' },
  { key: 'azure-openai-responses', label: 'Azure OpenAI', url: '' },
  { key: 'groq', label: 'Groq', url: 'https://api.groq.com/openai/v1', placeholder: 'gsk_...' },
  { key: 'mistral', label: 'Mistral', url: 'https://api.mistral.ai/v1' },
  { key: 'deepseek', label: 'DeepSeek', url: 'https://api.deepseek.com', placeholder: 'sk-...' },
  { key: 'xai', label: 'xAI (Grok)', url: 'https://api.x.ai/v1', placeholder: 'xai-...' },
  { key: 'cerebras', label: 'Cerebras', url: 'https://api.cerebras.ai/v1', placeholder: 'csk-...' },
  { key: 'zai', label: 'z.ai (GLM)', url: 'https://api.z.ai/api/coding/paas/v4' },
  { key: 'huggingface', label: 'Hugging Face', url: 'https://router.huggingface.co/v1', placeholder: 'hf_...' },
  { key: 'minimax-global', label: 'Minimax Global', url: 'https://api.minimax.io/anthropic' },
  { key: 'minimax-cn', label: 'Minimax CN', url: 'https://api.minimaxi.com/anthropic' },
  { key: 'kimi-coding', label: 'Kimi (Coding)', url: 'https://api.kimi.com/coding', placeholder: 'sk-kimi-...' },
  { key: 'vercel-ai-gateway', label: 'Vercel AI Gateway', url: 'https://ai-gateway.vercel.sh' },
  { key: 'manifest', label: 'Manifest', url: 'https://app.manifest.build/v1', placeholder: 'mnfst_...' },
  { key: 'agentrouter', label: 'AgentRouter', url: 'https://agentrouter.org/v1' },
  { key: 'anyrouter', label: 'AnyRouter-CC', url: 'https://anyrouter.top' },
  { key: 'anyrouter_pi', label: 'AnyRouter-Pi', url: 'https://anyrouter.top', descriptionKey: 'apiSetup.experimentalPiProfile' },
  { key: 'custom', label: '', labelKey: 'apiSetup.custom', url: '' },
]

const DEFAULT_ENDPOINT_PROVIDERS = new Set(['anthropic', 'openai', 'pi', 'google'])

/**
 * Presets without a Pi SDK provider entry that nonetheless expose a known
 * OpenAI-compatible protocol. They behave like 'custom' on submit (customEndpoint
 * gets pinned to openai-completions) but stay branded in the dropdown.
 */
const OPENAI_COMPAT_CUSTOM_URL_PRESETS: ReadonlySet<string> = new Set(['manifest'])

const COMPAT_CUSTOM_DEFAULTS = 'claude-opus-4-8, claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5'
const COMPAT_MINIMAX_DEFAULTS = 'MiniMax-M2.5, MiniMax-M2.5-highspeed'
const COMPAT_KIMI_DEFAULTS = 'k2p5, kimi-k2-thinking'
const AGENTROUTER_DEFAULTS = 'gpt-5.6-sol, claude-opus-5, claude-opus-4-8'
const ANYROUTER_DEFAULTS = 'claude-opus-5[1m], claude-fable-5[1m], claude-opus-4-8[1m]'

function getPresetForUrl(url: string, presets: Preset[]): PresetKey {
  const match = presets.find(p => p.key !== 'custom' && p.url === url)
  return match?.key ?? 'custom'
}

function parseModelList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

// ============================================================
// Pi model tier selection (for providers with many models)
// ============================================================

export function ApiKeyInput({
  status,
  errorMessage,
  onSubmit,
  formId = "api-key-form",
  disabled,
  initialValues,
}: ApiKeyInputProps) {
  const presets = PI_PROVIDER_PRESETS
  const defaultPreset = presets[0]

  // Compute initial preset: explicit (Pi piAuthProvider), derived from URL, or default
  const initialPreset = initialValues?.activePreset
    ?? initialValues?.platformProfile
    ?? (initialValues?.baseUrl ? getPresetForUrl(initialValues.baseUrl, presets) : defaultPreset.key)

  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState(resolveEditableApiKey(initialValues?.apiKey))
  const [showValue, setShowValue] = useState(false)
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? defaultPreset.url)
  const [activePreset, setActivePreset] = useState<PresetKey>(initialPreset)
  const [lastNonCustomPreset, setLastNonCustomPreset] = useState<PresetKey | null>(
    initialPreset !== 'custom' ? initialPreset : defaultPreset.key
  )
  const [connectionDefaultModel, setConnectionDefaultModel] = useState(initialValues?.connectionDefaultModel ?? '')
  const [customApi, setCustomApi] = useState<CustomEndpointApi>(initialValues?.customApi ?? 'openai-completions')
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  const [claudeCliStatus, setClaudeCliStatus] = useState<ClaudeCliStatus | null>(null)
  const [claudeCliError, setClaudeCliError] = useState<string | undefined>(undefined)
  const [isCheckingClaudeCli, setIsCheckingClaudeCli] = useState(false)
  const [isUpdatingClaudeCliPath, setIsUpdatingClaudeCliPath] = useState(false)


  // Pi model tier state (for providers with many models like OpenRouter, Vercel)
  const [piModels, setPiModels] = useState<PiModelInfo[]>([])
  const [piModelsLoading, setPiModelsLoading] = useState(false)
  const [bestModel, setBestModel] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [cheapModel, setCheapModel] = useState('')
  const [openTier, setOpenTier] = useState<string | null>(null)
  const [tierFilter, setTierFilter] = useState('')
  const [tierDropdownPosition, setTierDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const tierFilterInputRef = useRef<HTMLInputElement>(null)
  const hydratedTierProviderRef = useRef<string | null>(null)

  const isDisabled = disabled || status === 'validating'

  // Hide endpoint/model fields for providers with well-known endpoints handled by the SDK
  const isDefaultProviderPreset = DEFAULT_ENDPOINT_PROVIDERS.has(activePreset)
  const isPlatformProfilePreset = Boolean(PLATFORM_PROFILE_BY_PRESET[activePreset])
  const showsEditableProtocol = activePreset === 'custom' || activePreset === 'agentrouter'
  const shouldShowClaudeCli = shouldShowClaudeCliControls(activePreset)

  // Provider-specific placeholders from the active preset
  const activePresetObj = presets.find(p => p.key === activePreset)
  const apiKeyPlaceholder = activePresetObj?.placeholder ?? t('apiSetup.apiKeyPlaceholder')

  // Fetch Pi SDK models when a provider is selected in pi_api_key flow.
  // Returns all models sorted by cost (expensive-first) for the searchable tier dropdowns.
  const loadPiModels = useCallback(async (provider: string) => {
    if (!provider || provider === 'custom' || DEFAULT_ENDPOINT_PROVIDERS.has(provider) || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(provider) || PLATFORM_PROFILE_BY_PRESET[provider]) {
      setPiModels([])
      return
    }
    setPiModelsLoading(true)
    try {
      const result = await window.electronAPI.getPiProviderModels(provider)
      setPiModels(result.models)

      if (hydratedTierProviderRef.current !== provider) {
        const tiers = resolveTierModels(result.models, provider === initialPreset ? initialValues?.models : undefined)
        setBestModel(tiers.best)
        setDefaultModel(tiers.default_)
        setCheapModel(tiers.cheap)
        hydratedTierProviderRef.current = provider
      }
    } catch (err) {
      console.error('[ApiKeyInput] Failed to load models for', provider, err)
      setPiModels([])
    } finally {
      setPiModelsLoading(false)
    }
  }, [initialPreset, initialValues?.models])

  useEffect(() => {
    loadPiModels(activePreset)
  }, [activePreset, loadPiModels])

  const checkClaudeCli = useCallback(async () => {
    setIsCheckingClaudeCli(true)
    setClaudeCliError(undefined)
    try {
      setClaudeCliStatus(await window.electronAPI.checkClaudeCli())
    } catch (error) {
      setClaudeCliStatus(null)
      setClaudeCliError(error instanceof Error ? error.message : t('apiSetup.claudeCli.checkFailed'))
    } finally {
      setIsCheckingClaudeCli(false)
    }
  }, [t])

  useEffect(() => {
    if (shouldShowClaudeCli) {
      void checkClaudeCli()
      return
    }
    setClaudeCliStatus(null)
    setClaudeCliError(undefined)
  }, [shouldShowClaudeCli, checkClaudeCli])

  const handleBrowseClaudeCli = async () => {
    setIsUpdatingClaudeCliPath(true)
    setClaudeCliError(undefined)
    try {
      const path = await window.electronAPI.browseForClaudeCli()
      if (!path) return

      const result = await window.electronAPI.setClaudeCliPath(path)
      if (!result.success) {
        setClaudeCliError(result.error || t('apiSetup.claudeCli.savePathFailed'))
        return
      }
      await checkClaudeCli()
    } catch (error) {
      setClaudeCliError(error instanceof Error ? error.message : t('apiSetup.claudeCli.selectFailed'))
    } finally {
      setIsUpdatingClaudeCliPath(false)
    }
  }

  const handleClearClaudeCliPath = async () => {
    setIsUpdatingClaudeCliPath(true)
    setClaudeCliError(undefined)
    try {
      const result = await window.electronAPI.clearClaudeCliPath()
      if (!result.success) {
        setClaudeCliError(result.error || t('apiSetup.claudeCli.restoreFailed'))
        return
      }
      setClaudeCliStatus(result)
    } catch (error) {
      setClaudeCliError(error instanceof Error ? error.message : t('apiSetup.claudeCli.restoreFailed'))
    } finally {
      setIsUpdatingClaudeCliPath(false)
    }
  }

  // Whether to show 3 tier dropdowns instead of text input
  const hasPiModels = piModels.length > 0 && !isDefaultProviderPreset && activePreset !== 'custom'

  const handlePresetSelect = (preset: Preset) => {
    setActivePreset(preset.key)
    if (preset.key !== 'custom') {
      setLastNonCustomPreset(preset.key)
    }
    if (preset.key === 'custom') {
      setBaseUrl('')
    } else {
      setBaseUrl(preset.url)
    }
    setModelError(null)
    setEndpointError(null)
    if (preset.key === 'agentrouter') setCustomApi('openai-completions')
    // Pre-fill recommended model for Ollama; clear for all others
    // (Default provider presets hide the field entirely, others default to provider model IDs when empty)
    if (preset.key === 'ollama') {
      setConnectionDefaultModel('qwen3-coder')
    } else if (preset.key === 'openrouter' || preset.key === 'vercel-ai-gateway') {
      setConnectionDefaultModel(COMPAT_CUSTOM_DEFAULTS)
    } else if (preset.key === 'minimax-global' || preset.key === 'minimax-cn') {
      setConnectionDefaultModel(COMPAT_MINIMAX_DEFAULTS)
    } else if (preset.key === 'kimi-coding') {
      setConnectionDefaultModel(COMPAT_KIMI_DEFAULTS)
    } else if (preset.key === 'manifest') {
      setConnectionDefaultModel('auto')
    } else if (preset.key === 'agentrouter') {
      setConnectionDefaultModel(AGENTROUTER_DEFAULTS)
    } else if (preset.key === 'anyrouter' || preset.key === 'anyrouter_pi') {
      setConnectionDefaultModel(ANYROUTER_DEFAULTS)
    } else if (preset.key === 'custom' || OPENAI_COMPAT_CUSTOM_URL_PRESETS.has(preset.key)) {
      setConnectionDefaultModel(COMPAT_CUSTOM_DEFAULTS)
    } else {
      setConnectionDefaultModel('')
    }
  }

  const handleBaseUrlChange = (value: string) => {
    setBaseUrl(value)
    setEndpointError(null)
    const presetKey = getPresetForUrl(value, presets)
    const currentPresetObj = presets.find(p => p.key === activePreset)
    const nextPresetState = resolvePresetStateForBaseUrlChange({
      matchedPreset: presetKey,
      activePreset,
      activePresetHasEmptyUrl: currentPresetObj?.url === '',
      preserveActivePreset: isPlatformProfilePreset,
      lastNonCustomPreset,
    })
    setActivePreset(nextPresetState.activePreset)
    setLastNonCustomPreset(nextPresetState.lastNonCustomPreset)
    setModelError(null)
    if (!connectionDefaultModel.trim()) {
      if (presetKey === 'ollama') {
        setConnectionDefaultModel('qwen3-coder')
      } else if (presetKey === 'manifest') {
        setConnectionDefaultModel('auto')
      } else if (presetKey === 'minimax-global' || presetKey === 'minimax-cn') {
        setConnectionDefaultModel(COMPAT_MINIMAX_DEFAULTS)
      } else if (presetKey === 'kimi-coding') {
        setConnectionDefaultModel(COMPAT_KIMI_DEFAULTS)
      } else if (presetKey === 'agentrouter') {
        setConnectionDefaultModel(AGENTROUTER_DEFAULTS)
      } else if (presetKey === 'anyrouter' || presetKey === 'anyrouter_pi') {
        setConnectionDefaultModel(ANYROUTER_DEFAULTS)
      } else if (presetKey === 'openrouter' || presetKey === 'vercel-ai-gateway' || presetKey === 'custom') {
        setConnectionDefaultModel(COMPAT_CUSTOM_DEFAULTS)
      }
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const effectivePiAuthProvider = resolvePiAuthProviderForSubmit(activePreset, lastNonCustomPreset)

    // Pi API key flow with tier dropdowns — submit selected models
    if (hasPiModels) {
      if (!bestModel || !defaultModel || !cheapModel) {
        setModelError(t('apiSetup.selectEachTier'))
        return
      }
      const models: string[] = [bestModel, defaultModel, cheapModel]
      onSubmit({
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        connectionDefaultModel: bestModel,
        models,
        piAuthProvider: effectivePiAuthProvider,
        modelSelectionMode: 'userDefined3Tier',
      })
      return
    }

    const effectiveBaseUrl = baseUrl.trim()

    const parsedModels = parseModelList(connectionDefaultModel)

    const isUsingDefaultEndpoint = isDefaultProviderPreset || !effectiveBaseUrl
    const requiresModel = !isDefaultProviderPreset && !!effectiveBaseUrl
    if (requiresModel && parsedModels.length === 0) {
      setModelError(t('apiSetup.defaultModelRequired'))
      return
    }

    // Include custom endpoint protocol when user configured a custom base URL.
    // Branded openai-compat presets (e.g. Manifest) are pinned to openai-completions
    // and routed via the Pi SDK's openai adapter.
    const { customEndpoint, piAuthProvider: resolvedPiAuthProvider, platformProfile } = resolveCustomEndpointPayload({
      activePreset,
      baseUrl: effectiveBaseUrl,
      customApi,
      brandedOpenAiCompatPresets: OPENAI_COMPAT_CUSTOM_URL_PRESETS,
      fallbackPiAuthProvider: effectivePiAuthProvider,
    })

    let normalizedBaseUrl = effectiveBaseUrl
    if (customEndpoint && effectiveBaseUrl) {
      try {
        normalizedBaseUrl = normalizeCustomEndpointUrl(
          customEndpoint.api,
          effectiveBaseUrl,
          parsedModels[0],
        ).baseUrl
      } catch {
        setEndpointError(t('apiSetup.endpointInvalid'))
        return
      }
    }

    onSubmit({
      apiKey: apiKey.trim(),
      baseUrl: isUsingDefaultEndpoint ? undefined : normalizedBaseUrl,
      connectionDefaultModel: parsedModels[0],
      models: parsedModels.length > 0 ? parsedModels : undefined,
      piAuthProvider: resolvedPiAuthProvider,
      modelSelectionMode: parsedModels.length > 0 ? 'userDefined3Tier' : 'automaticallySyncedFromProvider',
      customEndpoint,
      ...(platformProfile ? { platformProfile } : {}),
    })
  }

  const tierConfigs = [
    { id: 'best', label: t('apiSetup.tiers.best'), desc: t('apiSetup.tiers.bestDesc'), value: bestModel, onChange: setBestModel },
    { id: 'balanced', label: t('apiSetup.tiers.balanced'), desc: t('apiSetup.tiers.balancedDesc'), value: defaultModel, onChange: setDefaultModel },
    { id: 'fast', label: t('apiSetup.tiers.fast'), desc: t('apiSetup.tiers.fastDesc'), value: cheapModel, onChange: setCheapModel },
  ]
  const activeTierConfig = openTier ? tierConfigs.find(tier => tier.id === openTier) : null
  const protocolOptions: Array<{ value: CustomEndpointApi; label: string; description: string }> = [
    { value: 'openai-completions', label: t('apiSetup.protocol.openAiChat'), description: '/chat/completions' },
    { value: 'openai-responses', label: t('apiSetup.protocol.openAiResponses'), description: '/responses' },
    { value: 'anthropic-messages', label: t('apiSetup.protocol.anthropicMessages'), description: '/v1/messages' },
    { value: 'google-generative-ai', label: t('apiSetup.protocol.googleGemini'), description: '/models/{model}:streamGenerateContent' },
  ]
  const endpointPreview = (() => {
    if (!baseUrl.trim() || !showsEditableProtocol) return null
    try {
      return normalizeCustomEndpointUrl(customApi, baseUrl, parseModelList(connectionDefaultModel)[0])
    } catch {
      return null
    }
  })()

  return (
    <form id={formId} onSubmit={handleSubmit} className="space-y-6">
      {/* API Key */}
      <div className="space-y-2">
        <Label htmlFor="api-key">{t('apiSetup.apiKey')}</Label>
        <div className={cn(
          "relative rounded-md shadow-minimal transition-colors",
          "bg-foreground-2 focus-within:bg-background"
        )}>
          <Input
            id="api-key"
            type={showValue ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyPlaceholder}
            className={cn(
              "pr-10 border-0 bg-transparent shadow-none",
              status === 'error' && "focus-visible:ring-destructive"
            )}
            disabled={isDisabled}
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowValue(!showValue)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            tabIndex={-1}
          >
            {showValue ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
      </div>

      {/* Endpoint/Provider Preset Selector - hidden when only one preset (e.g. Codex/OpenAI direct) */}
      {presets.length > 1 && (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="base-url">{t('apiSetup.endpoint')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className="flex h-6 items-center gap-1 rounded-[6px] bg-background shadow-minimal pl-2.5 pr-2 text-[12px] font-medium text-foreground/50 hover:bg-foreground/5 hover:text-foreground focus:outline-none"
            >
              {(() => {
                const preset = presets.find(p => p.key === activePreset)
                return preset?.labelKey ? t(preset.labelKey) : preset?.label
              })()}
              <ChevronDown className="size-2.5 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="end" className="z-floating-menu">
              {presets.map((preset) => (
                <StyledDropdownMenuItem
                  key={preset.key}
                  onClick={() => handlePresetSelect(preset)}
                  className="justify-between"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{preset.labelKey ? t(preset.labelKey) : preset.label}</span>
                    {preset.descriptionKey && (
                      <span className="text-[10px] font-normal text-foreground/40">{t(preset.descriptionKey)}</span>
                    )}
                  </span>
                  <Check className={cn("size-3", activePreset === preset.key ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Base URL input - hidden for default provider presets (Anthropic/OpenAI) */}
        {!isDefaultProviderPreset && (
          <>
            <div className={cn(
              "rounded-md shadow-minimal transition-colors",
              "bg-foreground-2 focus-within:bg-background"
            )}>
              <Input
                id="base-url"
                type="text"
                value={baseUrl}
                onChange={(e) => handleBaseUrlChange(e.target.value)}
                placeholder={t('apiSetup.endpointPlaceholder')}
                className="border-0 bg-transparent shadow-none"
                disabled={isDisabled}
              />
            </div>
            {showsEditableProtocol && (
              <p className="text-xs text-foreground/30">{t('apiSetup.endpointInputHelper')}</p>
            )}
            {endpointError && <p className="text-xs text-destructive">{endpointError}</p>}
          </>
        )}
      </div>
      )}

      {shouldShowClaudeCli && (
        <div className="space-y-2 rounded-md border border-border bg-foreground-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-sm">Claude Code CLI</Label>
              <p className={cn(
                'mt-1 text-xs',
                claudeCliError || (claudeCliStatus && !claudeCliStatus.found) ? 'text-destructive' : 'text-foreground/50',
              )}>
                {getClaudeCliStatusMessage(claudeCliStatus, t, claudeCliError)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void checkClaudeCli()}
              disabled={isCheckingClaudeCli || isUpdatingClaudeCliPath}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-minimal hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3', isCheckingClaudeCli && 'animate-spin')} />
              {t('apiSetup.claudeCli.recheck')}
            </button>
          </div>

          {claudeCliStatus?.path && (
            <p className="break-all text-xs text-foreground/50">
              {hasSavedClaudeCliPath(claudeCliStatus)
                ? t('apiSetup.claudeCli.savedPath')
                : t('apiSetup.claudeCli.detectedPath')}{' '}
              {claudeCliStatus.path}
            </p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => void handleBrowseClaudeCli()}
              disabled={isCheckingClaudeCli || isUpdatingClaudeCliPath}
              className="inline-flex items-center gap-1.5 rounded-[6px] bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-minimal hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FolderOpen className="size-3" />
              {t('common.browse')}
            </button>
            {hasSavedClaudeCliPath(claudeCliStatus) && (
              <button
                type="button"
                onClick={() => void handleClearClaudeCliPath()}
                disabled={isCheckingClaudeCli || isUpdatingClaudeCliPath}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-minimal hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="size-3" />
                {t('apiSetup.claudeCli.restoreAutomatic')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Protocol selector for generic custom endpoints and AgentRouter. */}
      {showsEditableProtocol && !isDefaultProviderPreset && (
        <div className="space-y-2">
          <Label>{t('apiSetup.protocol')}</Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isDisabled}
              className={cn(
                "flex h-9 w-full items-center justify-between rounded-md bg-foreground-2 px-3 text-sm shadow-minimal",
                "hover:bg-background focus:outline-none",
                isDisabled && "opacity-50 pointer-events-none",
              )}
            >
              <span>{protocolOptions.find(option => option.value === customApi)?.label}</span>
              <ChevronDown className="size-3 opacity-50" />
            </DropdownMenuTrigger>
            <StyledDropdownMenuContent align="start" className="z-floating-menu min-w-[280px]">
              {protocolOptions.map(option => (
                <StyledDropdownMenuItem
                  key={option.value}
                  onClick={() => {
                    setCustomApi(option.value)
                    setEndpointError(null)
                  }}
                  className="justify-between gap-4"
                >
                  <span className="flex min-w-0 flex-col">
                    <span>{option.label}</span>
                    <span className="font-mono text-[10px] font-normal text-foreground/40">{option.description}</span>
                  </span>
                  <Check className={cn("size-3 shrink-0", customApi === option.value ? "opacity-100" : "opacity-0")} />
                </StyledDropdownMenuItem>
              ))}
            </StyledDropdownMenuContent>
          </DropdownMenu>
          <p className="text-xs text-foreground/30">
            {t('apiSetup.protocolHelper')}
          </p>
          {endpointPreview && (
            <div className="space-y-1 rounded-md bg-foreground-2 px-3 py-2 text-xs">
              <p className="break-all text-foreground/50">
                <span className="font-medium text-foreground/70">{t('apiSetup.sdkBaseUrl')}:</span>{' '}
                {endpointPreview.baseUrl}
              </p>
              <p className="break-all text-foreground/50">
                <span className="font-medium text-foreground/70">{t('apiSetup.requestPreview')}:</span>{' '}
                {endpointPreview.requestPreviewUrl}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Model Selection — 3 tier dropdowns for Pi providers, text input for custom/compat */}
      {hasPiModels ? (
        <div className="space-y-3">
          {piModelsLoading ? (
            <div className="flex items-center gap-2 py-3 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              <span className="text-xs">{t("apiSetup.loadingModels")}</span>
            </div>
          ) : (
            <>
              {tierConfigs.map(({ id, label, desc, value }) => (
                <div key={id} className="space-y-1.5">
                  <Label className="text-muted-foreground font-normal text-xs">
                    {label}{' '}
                    <span className="text-foreground/30">· {desc}</span>
                  </Label>
                  <button
                    type="button"
                    disabled={isDisabled}
                    onClick={(e) => {
                      if (openTier === id) {
                        setOpenTier(null)
                        setTierFilter('')
                      } else {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTierDropdownPosition({ top: rect.bottom + 4, left: rect.left, width: rect.width })
                        setOpenTier(id)
                        setTierFilter('')
                        setTimeout(() => tierFilterInputRef.current?.focus(), 0)
                      }
                    }}
                    className={cn(
                      "flex h-9 w-full items-center justify-between rounded-md px-3 text-sm",
                      "bg-foreground-2 shadow-minimal transition-colors",
                      "hover:bg-background focus:outline-none focus:bg-background",
                      isDisabled && "opacity-50 pointer-events-none"
                    )}
                  >
                    <span className="truncate text-foreground">
                      {piModels.find(m => m.id === value)?.name ?? t('apiSetup.selectModel')}
                    </span>
                    <ChevronDown className="size-3 opacity-50 shrink-0" />
                  </button>
                </div>
              ))}
              {activeTierConfig && tierDropdownPosition && (
                <>
                  <div
                    className="fixed inset-0 z-floating-backdrop"
                    onClick={() => { setOpenTier(null); setTierFilter('') }}
                  />
                  <div
                    className="fixed z-floating-menu min-w-[200px] overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small"
                    style={{
                      top: tierDropdownPosition.top,
                      left: tierDropdownPosition.left,
                      width: tierDropdownPosition.width,
                    }}
                  >
                    <CommandPrimitive
                      className="min-w-[200px]"
                      shouldFilter={false}
                    >
                      <div className="border-b border-border/50 px-3 py-2">
                        <CommandPrimitive.Input
                          ref={tierFilterInputRef}
                          value={tierFilter}
                          onValueChange={setTierFilter}
                          placeholder={t("apiSetup.searchModels")}
                          autoFocus
                          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground placeholder:select-none"
                        />
                      </div>
                      <CommandPrimitive.List className="max-h-[240px] overflow-y-auto p-1">
                        {piModels
                          .filter(m => m.name.toLowerCase().includes(tierFilter.toLowerCase()))
                          .map((model) => (
                            <CommandPrimitive.Item
                              key={model.id}
                              value={model.id}
                              onSelect={() => {
                                activeTierConfig.onChange(model.id)
                                setOpenTier(null)
                                setTierFilter('')
                              }}
                              className={cn(
                                "flex cursor-pointer select-none items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-[13px]",
                                "outline-none data-[selected=true]:bg-foreground/5"
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="truncate">{model.name}</span>
                                {model.reasoning && (
                                  <span className="text-[10px] text-foreground/30 shrink-0">{t('apiSetup.reasoning')}</span>
                                )}
                              </div>
                              <Check className={cn("size-3 shrink-0", activeTierConfig.value === model.id ? "opacity-100" : "opacity-0")} />
                            </CommandPrimitive.Item>
                          ))}
                      </CommandPrimitive.List>
                    </CommandPrimitive>
                  </div>
                </>
              )}
              {modelError && (
                <p className="text-xs text-destructive">{modelError}</p>
              )}
            </>
          )}
        </div>
      ) : !isDefaultProviderPreset && (
        <div className="space-y-2">
          <Label htmlFor="connection-default-model" className="text-muted-foreground font-normal">
            {t('apiSetup.defaultModel')}{' '}
            <span className="text-foreground/30">
              · {baseUrl.trim() ? t('apiSetup.required') : t('apiSetup.optional')}
            </span>
          </Label>
          <div className={cn(
            "rounded-md shadow-minimal transition-colors",
            "bg-foreground-2 focus-within:bg-background",
            modelError && "ring-1 ring-destructive/40"
          )}>
            <Input
              id="connection-default-model"
              type="text"
              value={connectionDefaultModel}
              onChange={(e) => {
                setConnectionDefaultModel(e.target.value)
                setModelError(null)
              }}
              placeholder={t('apiSetup.modelListPlaceholder')}
              className="border-0 bg-transparent shadow-none"
              disabled={isDisabled}
            />
          </div>
          {modelError && (
            <p className="text-xs text-destructive">{modelError}</p>
          )}
          <p className="text-xs text-foreground/30">
            {t('apiSetup.modelListHelper')}
          </p>
          {(activePreset === 'custom' || !activePreset) && (
            <p className="text-xs text-foreground/30">
              {t('apiSetup.customModelHelper')}
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {status === 'error' && errorMessage && (
        <p className="text-sm text-destructive">{errorMessage}</p>
      )}
    </form>
  )
}
