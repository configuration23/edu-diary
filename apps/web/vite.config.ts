import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Версия интерфейса берётся из корневого package.json при сборке.
 *
 * Она вшивается в бандл, чтобы на экране «Обзор» её можно было сравнить с
 * версией API: расхождение означает, что в браузере осталась старая сборка.
 */
const rootPackage = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
) as { version?: string };

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
  define: {
    __APP_VERSION__: JSON.stringify(rootPackage.version ?? '0.0.0'),
  },
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
    /**
     * Source maps не публикуем: по ним восстанавливается весь фронтенд, включая карту прав и
     * проверки паролей (находка F-05). Для отладки включается отдельно, не в сборке для сервера.
     */
    sourcemap: false,
    // Приложение внутреннее и небольшое: один бандл удобнее, чем дробление.
    // Порог поднят, чтобы предупреждение о размере не шумело в CI.
    chunkSizeWarningLimit: 900,
  },
});
