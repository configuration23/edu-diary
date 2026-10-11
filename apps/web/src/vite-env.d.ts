/// <reference types="vite/client" />

/**
 * Версия приложения, вшитая при сборке (`vite.config.ts` берёт её из корневого
 * `package.json`). На экране «Обзор» сравнивается с версией API: расхождение
 * означает, что в браузере осталась старая сборка.
 */
declare const __APP_VERSION__: string;
