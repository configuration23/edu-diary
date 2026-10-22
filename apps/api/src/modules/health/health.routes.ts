import type { FastifyInstance } from 'fastify';

import { collectHealth, type HealthDependencies } from './health.service';

/** HTTP-слой модуля: только маршруты, вся логика — в сервисе. */
export function registerHealthRoutes(app: FastifyInstance, dependencies: HealthDependencies): void {
  app.get('/health', async (request, reply) => {
    /** Подробности — только вошедшим: снаружи достаточно `status`. */
    const report = await collectHealth(dependencies, request.auth !== null);
    reply.status(report.httpStatus);
    return report.body;
  });
}
