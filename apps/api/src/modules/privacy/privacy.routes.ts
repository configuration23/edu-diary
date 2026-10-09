import {
  createConsentRequestSchema,
  listConsentsQuerySchema,
  listConsentsResponseSchema,
  policyResponseSchema,
  publishPolicyRequestSchema,
  revokeConsentRequestSchema,
  studentsWithoutConsentResponseSchema,
  type ConsentDto,
} from '@edu-diary/contracts';
import type { FastifyInstance } from 'fastify';

import { actorFromRequest } from '../../shared/actor';
import { requireAuth, requirePermission } from '../../shared/guards';
import type { ConsentRecord } from './privacy.repository';
import type { PrivacyService } from './privacy.service';

function toDto(record: ConsentRecord): ConsentDto {
  return {
    id: record.id,
    studentId: record.studentId,
    studentName: record.studentName,
    guardianUserId: record.guardianUserId,
    guardianName: record.guardianName,
    policyVersion: record.policyVersion,
    grantedAt: record.grantedAt.toISOString(),
    grantedVia: record.grantedVia as ConsentDto['grantedVia'],
    documentRef: record.documentRef,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    revokedReason: record.revokedReason,
  };
}

export function registerPrivacyRoutes(app: FastifyInstance, privacy: PrivacyService): void {
  // Политику видит любой вошедший: она нужна и родителю, и сотруднику.
  app.get('/privacy-policy', { preHandler: requireAuth() }, async () => {
    const policy = await privacy.getPolicy();
    return policyResponseSchema.parse(policy);
  });

  app.put(
    '/privacy-policy',
    { preHandler: requirePermission('policy:write', 'all') },
    async (request) => {
      const body = publishPolicyRequestSchema.parse(request.body);
      await privacy.publishPolicy(body, { actor: actorFromRequest(request) });

      return policyResponseSchema.parse(await privacy.getPolicy());
    },
  );

  app.get(
    '/consents',
    { preHandler: requirePermission('consents:read', 'all') },
    async (request) => {
      const query = listConsentsQuerySchema.parse(request.query);

      const { items, total } = await privacy.listConsents({
        studentId: query.studentId,
        active: query.active,
        limit: query.limit,
        offset: query.offset,
      });

      return listConsentsResponseSchema.parse({ items: items.map(toDto), total });
    },
  );

  app.get(
    '/consents/missing',
    { preHandler: requirePermission('consents:read', 'all') },
    async () => {
      const result = await privacy.listStudentsWithoutConsent();
      return studentsWithoutConsentResponseSchema.parse(result);
    },
  );

  app.post(
    '/consents',
    { preHandler: requirePermission('consents:write', 'all') },
    async (request, reply) => {
      const body = createConsentRequestSchema.parse(request.body);
      const created = await privacy.createConsent(body, { actor: actorFromRequest(request) });

      reply.status(201);
      return toDto(created);
    },
  );

  app.post(
    '/consents/:id/revoke',
    { preHandler: requirePermission('consents:write', 'all') },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = revokeConsentRequestSchema.parse(request.body);

      await privacy.revokeConsent(id, body.reason, { actor: actorFromRequest(request) });

      return { ok: true };
    },
  );
}
