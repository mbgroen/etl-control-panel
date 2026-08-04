import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Recharts and its d3 dependencies are heavy; splitting them keeps the
    // initial shell small so the login screen paints fast on a LAN.
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    port: 5173,
    // During development the SPA runs on Vite while the API runs on the Node
    // server, so both are proxied to keep the browser on a single origin —
    // otherwise the session cookie (SameSite=Strict) would not be sent.
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
