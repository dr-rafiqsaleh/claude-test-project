import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  // `npm run build:mobile` builds the Android and iOS apps' bundle. The app is
  // served from inside the phone, so "same origin" would mean the phone itself:
  // without a real API origin the build succeeds and every request goes nowhere.
  if (mode === 'mobile' && !loadEnv(mode, rootDir, 'VITE_').VITE_API_ORIGIN) {
    throw new Error(
      'VITE_API_ORIGIN is not set for the mobile build. Copy .env.mobile.example to .env.mobile and set it.',
    )
  }

  return {
    plugins: [react()],
    resolve: {
      alias: { '@': path.resolve(rootDir, './src') },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: 'http://localhost:8000', changeOrigin: true },
      },
    },
  }
})
