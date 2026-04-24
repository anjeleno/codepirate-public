import { defineConfig } from 'vite'
import path from 'path'

// Extension host bundle — Node.js target, CommonJS output, vscode externalized
export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/extension.ts'),
      formats: ['cjs'],
      fileName: () => 'extension',
    },
    rollupOptions: {
      external: [
        'vscode',
        'path',
        'fs',
        'fs/promises',
        'os',
        'crypto',
        'stream',
        'http',
        'https',
        'url',
        'util',
        'events',
        'net',
        'tls',
        'child_process',
        'worker_threads',
        'assert',
        'buffer',
      ],
      output: {
        entryFileNames: 'extension.js',
      },
    },
    outDir: 'dist',
    sourcemap: true,
    minify: false,
    target: 'node20',
    emptyOutDir: false,
  },
})
