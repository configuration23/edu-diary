import { describe, expect, it } from 'vitest';

import { scanText } from './scan-secrets.mjs';

// Значения собираются из частей, чтобы сканер не находил собственные примеры.
const fakeAwsKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
const fakeGithubToken = ['ghp', '_', 'A'.repeat(36)].join('');

describe('поиск секретов', () => {
  it('находит ключ доступа AWS', () => {
    const findings = scanText(`const key = '${fakeAwsKey}';`, 'src/config.ts');
    expect(findings.map((finding) => finding.rule)).toContain('aws-access-key-id');
  });

  it('находит токен GitHub', () => {
    const findings = scanText(`token: ${fakeGithubToken}`, 'deploy.sh');
    expect(findings.map((finding) => finding.rule)).toContain('github-token');
  });

  it('находит приватный ключ', () => {
    const findings = scanText('-----BEGIN RSA PRIVATE KEY-----\nMIIE', 'key.pem');
    expect(findings.map((finding) => finding.rule)).toContain('private-key-block');
  });

  it('находит длинный литерал в «секретном» присваивании', () => {
    const findings = scanText(`const apiKey = "Zx9Qw8Er7Ty6Ui5Op4";`, 'src/client.ts');
    expect(findings.map((finding) => finding.rule)).toContain('hardcoded-secret-assignment');
  });

  it('не срабатывает на примерах и подстановках из окружения', () => {
    const cases = [
      'const password = "change-me-postgres-password";',
      'SESSION_SECRET=change-me-session-secret-with-more-than-32-characters',
      'const token = "${TOKEN}";',
      'const secret = process.env.SESSION_SECRET;',
      'const apiKey = "PLACEHOLDER_VALUE";',
      'password: "unit-test-password-value-here"',
    ];

    for (const content of cases) {
      expect(scanText(content, 'src/config.ts'), content).toEqual([]);
    }
  });

  it('в markdown проверяет только точные шаблоны', () => {
    expect(scanText('apiKey = "Zx9Qw8Er7Ty6Ui5Op4"', 'docs/notes.md')).toEqual([]);
    expect(scanText(`ключ ${fakeAwsKey} в примере`, 'docs/notes.md').length).toBe(1);
  });

  it('маскирует найденное значение', () => {
    const [finding] = scanText(`const key = '${fakeAwsKey}';`, 'src/config.ts');
    expect(finding?.masked).not.toContain(fakeAwsKey);
    expect(finding?.masked.startsWith('AKIA')).toBe(true);
  });

  it('указывает номер строки', () => {
    const [finding] = scanText(`первая\nвторая\nconst key = '${fakeAwsKey}';`, 'src/config.ts');
    expect(finding?.line).toBe(3);
  });
});
