/**
 * Тема до первого кадра: берём последний выбор из хранилища.
 *
 * Вынесено из `index.html` в отдельный файл ради строгой CSP: встроенный скрипт требовал бы
 * `'unsafe-inline'` или хеша, а внешний файл обходится `script-src 'self'`.
 *
 * Ответ сессии придёт позже и перекроет значение — здесь важно только не показать светлый экран
 * тому, кто выбрал тёмный. Ошибки хранилища (приватный режим) молча игнорируем: без кэша будет
 * один мигающий кадр, это не поломка.
 */
(function () {
  try {
    var saved = localStorage.getItem('edu-diary:theme');
    var dark =
      saved === 'dark' ||
      (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.dataset.theme = 'dark';
  } catch (error) {
    /* хранилище недоступно — остаёмся на светлой по умолчанию */
  }
})();
