import path from 'node:path';

import { EnvError, loadEnv, loadEnvFile, type AppEnv } from './env';
import { repositoryRoot } from './paths';

/**
 * Загрузка окружения при старте процесса.
 *
 * `.env` подхватывается только в режиме development — это удобство локального
 * запуска. В production и test переменные задаёт окружение (docker compose,
 * CI, systemd): иначе «пустой» секрет мог бы незаметно подставиться из файла.
 */
export function loadApplicationEnv(): AppEnv {
  const nodeEnv = process.env.NODE_ENV?.trim() ?? 'development';

  if (nodeEnv === 'development') {
    loadEnvFile(path.join(repositoryRoot(), '.env'));
  }

  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
