#!/usr/bin/env node
// Сборка клиента должна идти в production-режиме.
//
// При NODE_ENV=development или test Vite подключает development-сборки
// зависимостей: в бандл попадают отладочные тексты с адресами документации, и
// проверка внешних доменов падает с непонятным сообщением (SECURITY.md §3.8).
// Лучше остановиться сразу и объяснить причину.

const nodeEnv = process.env.NODE_ENV?.trim() ?? '';

if (nodeEnv === '' || nodeEnv === 'production') {
  process.exit(0);
}

console.error(
  `NODE_ENV=${nodeEnv}: клиент собирается только в production-режиме —\n` +
    'иначе Vite подключит development-сборки зависимостей и в бандле появятся\n' +
    'адреса документации. Запустите сборку без NODE_ENV или с NODE_ENV=production.',
);
process.exit(1);
