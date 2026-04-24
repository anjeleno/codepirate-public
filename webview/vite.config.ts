import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Webview bundle — IIFE format (not ES module).
// VS Code webview ES modules are blocked in SSH Remote environments due to strict
// CORS/MIME enforcement on the vscode-webview-resource: scheme. IIFE is a
// self-contained classic script — no module resolution, no crossorigin, works
// identically in local, SSH Remote, WSL, and container environments.
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, '../dist/webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        format: 'iife',
        name: 'CodePirateWebview',
        entryFileNames: 'assets/main.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
        inlineDynamicImports: true,
      },
    },
    sourcemap: true,
    minify: false,
  },
  base: './',
})
