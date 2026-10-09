import type { Database } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AuditService } from '../audit';
import type { AcademicsService } from '../academics';
import type { GuardiansRepository, GuardianLinkRow } from './iam.guardians.repository';
import type { MutationOptions } from './iam.users.service';

/**
 * Привязка «родитель ↔ ученик» (VISION.md §3.7).
 *
 * Ссылка на ученика проверяется через сервис модуля `academics`: модули не
 * ходят в таблицы друг друга напрямую.
 */

export interface LinkGuardianInput {
  studentId: string;
  guardianUserId: string;
  relation?: string | undefined;
}

export interface GuardiansService {
  listByStudent(studentId: string): Promise<GuardianLinkRow[]>;
  link(input: LinkGuardianInput, options: MutationOptions): Promise<GuardianLinkRow>;
  unlink(linkId: string, options: MutationOptions): Promise<void>;
  /** Ученики, привязанные к родителю: основа приватности (ADR-005). */
  studentIdsOfGuardian(guardianUserId: string): Promise<string[]>;
}

export interface GuardiansServiceDependencies {
  db: Database;
  guardians: GuardiansRepository;
  academics: AcademicsService;
  audit: AuditService;
}

export function createGuardiansService(
  dependencies: GuardiansServiceDependencies,
): GuardiansService {
  const { db, guardians, academics, audit } = dependencies;

  return {
    listByStudent(studentId) {
      return guardians.listByStudent(studentId);
    },

    async link(input, options): Promise<GuardianLinkRow> {
      const studentExists = await academics.studentExists(input.studentId);
      if (!studentExists) {
        throw new AppError('NOT_FOUND', 'Ученик не найден');
      }

      const existing = await guardians.findLink(input.studentId, input.guardianUserId);
      if (existing !== null) {
        throw new AppError('CONFLICT', 'Этот родитель уже привязан к ученику');
      }

      const created = await withTransaction(db, options.executor, async (tx) => {
        const row = await guardians.insert(
          {
            studentId: input.studentId,
            guardianUserId: input.guardianUserId,
            relation: input.relation ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'guardian_link',
            entityId: row.id,
            after: {
              studentId: input.studentId,
              guardianUserId: input.guardianUserId,
              relation: input.relation ?? null,
            },
          },
          options.actor,
          tx,
        );

        return row.id;
      });

      const link = await guardians.findById(created);
      if (link === null) throw new Error('Привязка не найдена после создания');
      return link;
    },

    async unlink(linkId, options): Promise<void> {
      const link = await guardians.findById(linkId);
      if (link === null) {
        throw new AppError('NOT_FOUND', 'Привязка не найдена');
      }

      await withTransaction(db, options.executor, async (tx) => {
        await guardians.remove(linkId, tx);

        await audit.record(
          {
            action: 'delete',
            entityKind: 'guardian_link',
            entityId: linkId,
            before: {
              studentId: link.studentId,
              guardianUserId: link.guardianUserId,
              relation: link.relation,
            },
          },
          options.actor,
          tx,
        );
      });
    },

    studentIdsOfGuardian(guardianUserId) {
      return guardians.studentIdsOfGuardian(guardianUserId);
    },
  };
}
