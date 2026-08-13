/**
 * ESLint Configuration for Electron App
 *
 * Uses flat config format (ESLint 9+).
 * Includes custom navigation rule to enforce navigate() usage.
 */

import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import noDirectNavigationState from './eslint-rules/no-direct-navigation-state.cjs'
import noLocalStorage from './eslint-rules/no-localstorage.cjs'
import noDirectPlatformCheck from './eslint-rules/no-direct-platform-check.cjs'
import noHardcodedPathSeparator from './eslint-rules/no-hardcoded-path-separator.cjs'
import noDirectFileOpen from './eslint-rules/no-direct-file-open.cjs'
import noHardcodedZIndex from './eslint-rules/no-hardcoded-z-index.cjs'
import noNonstandardShadows from './eslint-rules/no-nonstandard-shadows.cjs'

export default [
  // Ignore patterns
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      '*.cjs',
      'eslint-rules/**',
    ],
  },

  // TypeScript/React files
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      // Custom plugin for OPC Agent rules
      'opcagent': {
        rules: {
          'no-direct-navigation-state': noDirectNavigationState,
          'no-localstorage': noLocalStorage,
        },
      },
      // Custom plugin for platform detection rules
      'opcagent-platform': {
        rules: {
          'no-direct-platform-check': noDirectPlatformCheck,
        },
      },
      // Custom plugin for cross-platform path rules
      'opcagent-paths': {
        rules: {
          'no-hardcoded-path-separator': noHardcodedPathSeparator,
        },
      },
      // Custom plugin for link interceptor enforcement
      'opcagent-links': {
        rules: {
          'no-direct-file-open': noDirectFileOpen,
        },
      },
      // Upstream Craft renderer files retain Craft's inline rule names.
      'craft-links': {
        rules: {
          'no-direct-file-open': noDirectFileOpen,
        },
      },
      // Custom style rules
      'opcagent-styles': {
        rules: {
          'no-hardcoded-z-index': noHardcodedZIndex,
          'no-nonstandard-shadows': noNonstandardShadows,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // React Hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Custom OPCAgent rules
      'opcagent/no-direct-navigation-state': 'error',
      'opcagent/no-localstorage': 'warn',

      // Custom platform detection rule
      'opcagent-platform/no-direct-platform-check': 'error',

      // Custom cross-platform path rule
      'opcagent-paths/no-hardcoded-path-separator': 'warn',

      // Custom link interceptor rule — prevents bypassing in-app file preview
      'opcagent-links/no-direct-file-open': 'error',

      // Custom style rule — use z-index token scale instead of hardcoded literals
      'opcagent-styles/no-hardcoded-z-index': 'error',

      // Custom style rule — enforce approved shadow classes/tokens only
      'opcagent-styles/no-nonstandard-shadows': ['error', {
        allowedClasses: [
          'shadow-none',
          'shadow-xs',
          'shadow-minimal',
          'shadow-tinted',
          'shadow-thin',
          'shadow-middle',
          'shadow-strong',
          'shadow-panel-focused',
          'shadow-modal-small',
          'shadow-bottom-border',
          'shadow-bottom-border-thin',
        ],
        allowInlineNone: true,
      }],

      // Enforce centralized action registry for keyboard shortcuts
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'react-hotkeys-hook',
            message: 'Use useAction from @/actions instead. See actions/index.ts'
          }
        ],
      }],
    },
  },

  // The renderer is source-synced from Craft and validated by the upstream
  // source-drift check. Do not rewrite it to satisfy OPC Agent-only style rules.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    rules: {
      'opcagent/no-localstorage': 'off',
      'opcagent-links/no-direct-file-open': 'off',
      'craft-links/no-direct-file-open': 'off',
      'opcagent-styles/no-nonstandard-shadows': 'off',
    },
  },

  // Temporary exceptions for unresolved shadow migrations.
  {
    files: [
      'src/main/browser-pane-manager.ts',
      'src/shared/browser-live-fx.ts',
      'src/renderer/components/KeyboardShortcutsDialog.tsx',
      'src/renderer/playground/**/*.{ts,tsx}',
    ],
    rules: {
      'opcagent-styles/no-nonstandard-shadows': 'off',
    },
  },

  // Enforce backend abstraction boundary in Electron main process.
  {
    files: ['src/main/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: '@opcagent/shared/codex',
            message: 'Use provider-agnostic APIs from @opcagent/shared/agent/backend instead.',
          },
          {
            name: '@opcagent/shared/agent/pi-agent',
            message: 'Provider backends must stay behind @opcagent/shared/agent/backend.',
          },
        ],
      }],
    },
  },

  // Keep main model fetchers provider-agnostic (delegate to shared backend APIs only).
  {
    files: ['src/main/model-fetchers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "CallExpression[callee.name='fetch']",
          message: 'Do not call provider APIs directly in Electron model fetchers. Delegate to fetchBackendModels() from @opcagent/shared/agent/backend.',
        },
        {
          selector: "ImportDeclaration[source.value='@earendil-works/pi-ai']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
        {
          selector: "ImportDeclaration[source.value='@earendil-works/pi-coding-agent']",
          message: 'Provider SDK usage must stay in backend drivers under packages/shared/src/agent/backend/internal/drivers.',
        },
      ],
    },
  },
]
