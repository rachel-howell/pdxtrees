import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // served from https://<user>.github.io/pdxtrees/
  base: '/pdxtrees/',
  plugins: [react()],
})
