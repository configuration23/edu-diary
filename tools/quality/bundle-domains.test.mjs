import { describe, expect, it } from 'vitest';

import { findExternalReferences, stripNonExecutableComments } from './bundle-domains.mjs';

function kinds(content) {
  return findExternalReferences(content).map((reference) => `${reference.host}:${reference.kind}`);
}

describe('внешние домены в бандле', () => {
  it('находит подключение шрифтов с CDN', () => {
    const html = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">';
    expect(kinds(html)).toEqual(['fonts.googleapis.com:external']);
  });

  it('находит protocol-relative адрес', () => {
    expect(kinds('<script src="//cdn.example.org/lib.js"></script>')).toEqual([
      'cdn.example.org:external',
    ]);
  });

  it('находит адрес в CSS url()', () => {
    expect(kinds('.a{background:url(https://tracker.example.net/p.gif)}')).toEqual([
      'tracker.example.net:external',
    ]);
  });

  it('находит обращение через fetch в собранном коде', () => {
    expect(kinds('fetch("https://api.example.com/collect")')).toContain('api.example.com:external');
  });

  it('не считает нарушением локальные адреса', () => {
    expect(kinds('fetch("http://127.0.0.1:3000/api/health")')).toEqual([]);
    expect(kinds('new WebSocket("ws://localhost:3000")')).toEqual([]);
    expect(kinds('fetch("/api/health")')).toEqual([]);
  });

  it('разрешает пространство имён inline-SVG и ссылки в текстах сообщений', () => {
    expect(kinds('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toEqual(['www.w3.org:allowed']);
    expect(kinds('throw new Error("см. https://react.dev/errors/418")')).toEqual([
      'react.dev:allowed',
    ]);
  });

  it('разрешает идентификатор JSON Schema в строке', () => {
    expect(kinds('i.$schema=`https://json-schema.org/draft/2020-12/schema`')).toEqual([
      'json-schema.org:allowed',
    ]);
  });

  it('не считает нарушением шаблонную строку вместо адреса', () => {
    expect(kinds('const url = `http://${host}`;')).toEqual([]);
    expect(kinds('x = "http://[${e}]"')).toEqual([]);
  });

  it('не проверяет блочные комментарии CSS', () => {
    const banner = '/*! tailwindcss v4.3.3 | MIT License | https://tailwindcss.com */';
    expect(kinds(stripNonExecutableComments(banner, 'index.css'))).toEqual([]);
    expect(kinds(stripNonExecutableComments(banner, 'index.js'))).not.toEqual([]);
  });

  it('считает нарушением загрузку с разрешённого для текста хоста', () => {
    expect(kinds('<script src="https://react.dev/evil.js"></script>')).toEqual([
      'react.dev:external',
    ]);
  });

  it('не путает комментарий-разделитель с адресом', () => {
    expect(kinds('//# sourceMappingURL=main.js.map\n/* // not a host */')).toEqual([]);
  });

  it('дедуплицирует повторы', () => {
    const content = 'a("https://x.example.com/1") b("https://x.example.com/1")';
    expect(findExternalReferences(content)).toHaveLength(1);
  });
});
