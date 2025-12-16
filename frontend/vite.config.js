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
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward the real client IP to Flask
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/preview': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/download': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/delete': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/file-info': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/metadata': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        }
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        ws: true,
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress?.replace('::ffff:', '') || req.connection.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
          proxy.on('error', (err) => {
            // Suppress ECONNRESET errors during development (common when Flask restarts)
            if (err.code !== 'ECONNRESET') {
              console.error('Proxy error:', err);
            }
          });
        }
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});

