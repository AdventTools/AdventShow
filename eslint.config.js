import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Aceleași reguli ca vechiul .eslintrc.cjs. Din eslint-plugin-react-hooks 7 luăm doar
// cele două reguli clasice: restul setului „recommended" sunt reguli noi ale
// compilatorului React, care ar cere rescrierea unor componente care merg.
export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
)
