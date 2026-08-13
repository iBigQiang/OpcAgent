const { RuleTester } = require('eslint')
const rule = require('./no-direct-open-import.cjs')

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
})

tester.run('no-direct-open-import', rule, {
  valid: [
    { filename: '/repo/packages/shared/src/utils/open-url.ts', code: "const open = await import('open')" },
    { filename: 'D:\\repo\\packages\\shared\\src\\utils\\open-url.ts', code: "const open = await import('open')" },
    { filename: '/repo/consumer.ts', code: "import { openUrl } from './utils/open-url'" },
  ],
  invalid: [
    { filename: '/repo/consumer.ts', code: "const open = await import('open')", errors: [{ messageId: 'noDirectOpenImport' }] },
    { filename: 'D:\\repo\\consumer.ts', code: "import open from 'open'", errors: [{ messageId: 'noDirectOpenImport' }] },
  ],
})
