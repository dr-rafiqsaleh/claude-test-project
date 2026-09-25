import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(rootDir, './src') },
  },
  server: {
    port: 5174,
    // The contact form posts to the PestBase API. In development that is the
    // backend on :8000, reached through this proxy so no CORS is involved.
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
