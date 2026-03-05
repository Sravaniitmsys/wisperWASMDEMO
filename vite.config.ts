import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      // Enable SharedArrayBuffer for multi-threaded WASM performance.
      // 'credentialless' allows cross-origin model fetches from HuggingFace CDN.
      // Remove these headers if you encounter CORS issues with model loading.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  optimizeDeps: {
    // Exclude transformers.js from pre-bundling (contains WASM files)
    exclude: ['@huggingface/transformers'],
  },
  worker: {
    format: 'es',
  },
})
