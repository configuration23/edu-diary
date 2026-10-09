import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Внешних ресурсов нет: шрифты, стили и скрипты — только из своего бандла
 * (SECURITY.md §3.8). Проверяется сборкой: `npm run build` падает, если в
 * собранных файлах появится адрес внешнего сервиса.
 *
 * `/api` проксируется на локальный API и в dev, и в preview — так же, как это
 * делает Caddy в compose.
 */
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3000',
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Хост задан явно: `localhost` на Windows может разрешаться в IPv6, из-за чего
  // предпросмотр оказывается недоступен по 127.0.0.1 (это ломает сквозные тесты).
  // Привязка к 127.0.0.1 также не открывает интерфейс разработки в локальную сеть.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: apiProxy,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
});
