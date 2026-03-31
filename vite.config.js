import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
