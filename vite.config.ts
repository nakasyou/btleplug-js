import { defineConfig } from 'vite-plus'

export default defineConfig({
  fmt: {
    ignorePatterns: ['dist/**', 'target/**', 'node_modules/**', 'index.js', 'native.d.ts'],
    semi: false,
    singleQuote: true,
    printWidth: 100,
  },
  lint: {
    ignorePatterns: ['dist/**', 'target/**', 'node_modules/**', 'index.js', 'native.d.ts'],
  },
  pack: {
    entry: ['src-js/index.ts'],
    dts: true,
    format: ['esm'],
    outDir: 'dist',
    sourcemap: true,
    clean: true,
    platform: 'node',
    deps: {
      neverBundle: ['node:module', 'node:process'],
    },
  },
})
