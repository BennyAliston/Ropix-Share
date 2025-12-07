import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind to all interfaces so other devices on the LAN can access the dev server
    host: '0.0.0.0',
    // Prefer the configured port but allow Vite to pick another if it's taken
    port: 5173,
    strictPort: false,
    proxy: {
      '/upload': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/preview': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/download': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/delete': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/file-info': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/metadata': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

