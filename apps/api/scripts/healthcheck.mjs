// Healthcheck для docker compose: без внешних утилит, только Node.
const port = process.env.PORT ?? '3000';
const url = `http://127.0.0.1:${port}/api/health`;

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) {
    console.error(`healthcheck: ${url} ответил ${response.status}`);
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error(
    `healthcheck: ${url} недоступен — ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
}
