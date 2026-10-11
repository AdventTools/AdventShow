import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import pkg from './package.json' with { type: 'json' }

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron({
      // Fără minificare în procesul principal: erorile din jurnalele trimise de
      // biserici trebuie să arate nume de funcții, nu litere.
      main: {
        entry: 'electron/main.ts',
        vite: { build: { minify: false } },
      },
      preload: {
        input: path.join(import.meta.dirname, 'electron/preload.ts'),
        vite: { build: { minify: false } },
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ],
})
