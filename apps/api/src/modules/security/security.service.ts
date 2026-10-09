import type { SecuritySeverityDto } from '@edu-diary/contracts';

import { SYSTEM_ACTOR, type AuditActor } from '../../shared/actor';
import type { Executor } from '../../shared/db/client';
import type {
  SecurityEventRecord,
  SecurityListFilters,
  SecurityRepository,
} from './security.repository';

/**
 * События безопасности (SECURITY.md §3.7).
 *
 * Правила: всплеск неудачных входов, блокировка учётной записи, изменение прав,
 * доступ вне области действия. Задача модуля — показать событие в админке, а не
 * «похоронить» его в логах.
 */

/** Сколько подряд неудачных входов считаются всплеском. */
export const FAILED_LOGIN_BURST_THRESHOLD = 5;

export interface SecurityEventInput {
  kind: string;
  severity: SecuritySeverityDto;
  actor?: AuditActor;
  details?: unknown;
}

export interface SecurityService {
  record(input: SecurityEventInput, executor?: Executor): Promise<void>;
  list(filters: SecurityListFilters): Promise<{ items: SecurityEventRecord[]; total: number }>;
  findById(id: string): Promise<SecurityEventRecord | null>;
  acknowledge(
    id: string,
    input: { resolution: string | null; actor: AuditActor },
    executor?: Executor,
  ): Promise<void>;
  /** Вызывается модулем auth при неудачном входе. */
  onFailedLogin(
    input: {
      username: string;
      failedCount: number;
      lockedUntil: Date | null;
      actor: AuditActor;
    },
    executor?: Executor,
  ): Promise<void>;
  /** Вызывается модулем iam при изменении набора ролей пользователя. */
  onRolesChanged(
    input: { targetUserId: string; roles: readonly string[]; actor: AuditActor },
    executor?: Executor,
  ): Promise<void>;
  /** Доступ вне области действия: попытка увидеть чужие данные. */
  onAccessDenied(
    input: { reason: string; actor: AuditActor; details?: unknown },
    executor?: Executor,
  ): Promise<void>;
}

export function createSecurityService(repository: SecurityRepository): SecurityService {
  const record = async (input: SecurityEventInput, executor?: Executor): Promise<void> => {
    const actor = input.actor ?? SYSTEM_ACTOR;

    await repository.insert(
      {
        kind: input.kind,
        severity: input.severity,
        actorUserId: actor.userId,
        actorName: actor.name,
        ip: actor.ip,
        details: input.details ?? null,
      },
      executor,
    );
  };

  return {
    record,

    list(filters) {
      return repository.list(filters);
    },

    findById(id) {
      return repository.findById(id);
    },

    async acknowledge(id, input, executor): Promise<void> {
      await repository.acknowledge(
        id,
        { acknowledgedBy: input.actor.userId, resolution: input.resolution },
        executor,
      );
    },

    async onFailedLogin(input, executor): Promise<void> {
      // События могут совпасть: пятая неудачная попытка и всплеск, и блокировка.
      if (input.failedCount === FAILED_LOGIN_BURST_THRESHOLD) {
        await record(
          {
            kind: 'failed_login_burst',
            severity: 'warning',
            actor: input.actor,
            details: { username: input.username, failedCount: input.failedCount },
          },
          executor,
        );
      }

      if (input.lockedUntil !== null) {
        await record(
          {
            kind: 'account_locked',
            severity: 'warning',
            actor: input.actor,
            details: {
              username: input.username,
              failedCount: input.failedCount,
              lockedUntil: input.lockedUntil.toISOString(),
            },
          },
          executor,
        );
      }
    },

    async onRolesChanged(input, executor): Promise<void> {
      await record(
        {
          kind: 'role_changed',
          severity: 'info',
          actor: input.actor,
          details: { targetUserId: input.targetUserId, roles: [...input.roles] },
        },
        executor,
      );
    },

    async onAccessDenied(input, executor): Promise<void> {
      await record(
        {
          kind: 'access_out_of_scope',
          severity: 'warning',
          actor: input.actor,
          details: {
            reason: input.reason,
            ...(typeof input.details === 'object' && input.details !== null ? input.details : {}),
          },
        },
        executor,
      );
    },
  };
}
