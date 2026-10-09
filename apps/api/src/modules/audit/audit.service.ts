import type { AuditActor } from '../../shared/actor';
import type { Executor } from '../../shared/db/client';
import type { AuditListFilters, AuditRecord, AuditRepository } from './audit.repository';

/**
 * Журнал изменений и доступа (ADR-012, ADR-017).
 *
 * Модуль не умеет изменять и удалять записи: такого метода нет ни в сервисе, ни
 * в репозитории, ни в API. Это и есть техническая гарантия неизменяемости.
 */

export interface AuditEntryInput {
  action: string;
  entityKind: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  context?: unknown;
  /** true — доступ к персональным данным (просмотр карточки, выгрузка). */
  isAccess?: boolean;
}

export interface AuditService {
  /** Пишет запись; вызывается в той же транзакции, что и изменение. */
  record(entry: AuditEntryInput, actor: AuditActor, executor?: Executor): Promise<void>;
  list(filters: AuditListFilters): Promise<{ items: AuditRecord[]; total: number }>;
  countSince(action: string, since: Date): Promise<number>;
}

export function createAuditService(repository: AuditRepository): AuditService {
  return {
    async record(entry, actor, executor): Promise<void> {
      await repository.insert(
        {
          actorUserId: actor.userId,
          actorName: actor.name,
          actorIp: actor.ip,
          action: entry.action,
          entityKind: entry.entityKind,
          entityId: entry.entityId ?? null,
          before: entry.before ?? null,
          after: entry.after ?? null,
          context: entry.context ?? null,
          isAccess: entry.isAccess ?? false,
        },
        executor,
      );
    },

    list(filters) {
      return repository.list(filters);
    },

    countSince(action, since) {
      return repository.countSince(action, since);
    },
  };
}
