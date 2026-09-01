import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react()],
  publicDir: resolve(import.meta.dirname, 'public'),
  cacheDir: resolve(import.meta.dirname, 'node_modules/.vite'),
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: resolve(import.meta.dirname, '../dist/web'),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/info': 'http://localhost:3000',
      '/saudio': 'http://localhost:3000',
      '/admin': 'http://localhost:3000',
    },
  },
})
