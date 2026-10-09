import type { AuditActor } from '../../shared/actor';
import type { Database, Executor } from '../../shared/db/client';
import { withTransaction } from '../../shared/db/transaction';
import { AppError } from '../../shared/errors';
import type { AcademicsService } from '../academics';
import type { AuditService } from '../audit';
import type { GuardiansService, UsersService } from '../iam';
import type { SettingsService } from '../settings';
import type { ConsentRecord, PrivacyRepository } from './privacy.repository';

/**
 * Согласия и политика обработки персональных данных (ADR-021, SECURITY.md §3.5).
 *
 * Редакции политики хранятся в `setting` (ADR-003): видно, на какую редакцию
 * получено согласие. Согласие не удаляется — отзыв заполняет `revokedAt`.
 */

export const POLICY_SETTING_KEY = 'privacy.policy_editions';

export interface PolicyEdition {
  version: string;
  text: string;
  publishedAt: string;
  publishedByName: string | null;
}

export interface MutationOptions {
  actor: AuditActor;
  executor?: Executor | undefined;
}

export interface PrivacyService {
  getPolicy(): Promise<{ current: PolicyEdition | null; editions: PolicyEdition[] }>;
  publishPolicy(
    input: { version: string; text: string },
    options: MutationOptions,
  ): Promise<PolicyEdition>;
  currentPolicyVersion(): Promise<string | null>;
  listConsents(filters: {
    studentId?: string | undefined;
    active?: boolean | undefined;
    limit: number;
    offset: number;
  }): Promise<{ items: ConsentRecord[]; total: number }>;
  createConsent(
    input: {
      studentId: string;
      guardianUserId: string;
      grantedVia: 'paper' | 'electronic';
      documentRef?: string | undefined;
    },
    options: MutationOptions,
  ): Promise<ConsentRecord>;
  revokeConsent(id: string, reason: string, options: MutationOptions): Promise<void>;
  listStudentsWithoutConsent(): Promise<{
    items: Array<{ studentId: string; fullName: string; hasRevokedConsent: boolean }>;
    total: number;
  }>;
}

export interface PrivacyServiceDependencies {
  db: Database;
  privacy: PrivacyRepository;
  settings: SettingsService;
  academics: AcademicsService;
  guardians: GuardiansService;
  users: UsersService;
  audit: AuditService;
}

function parseEditions(value: unknown): PolicyEdition[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is PolicyEdition => {
    if (typeof item !== 'object' || item === null) return false;
    const candidate = item as Partial<PolicyEdition>;
    return typeof candidate.version === 'string' && typeof candidate.text === 'string';
  });
}

export function createPrivacyService(dependencies: PrivacyServiceDependencies): PrivacyService {
  const { db, privacy, settings, academics, guardians, users, audit } = dependencies;

  const readEditions = async (): Promise<PolicyEdition[]> =>
    parseEditions(await settings.get<unknown>(POLICY_SETTING_KEY));

  const currentPolicyVersion = async (): Promise<string | null> => {
    const editions = await readEditions();
    return editions.at(-1)?.version ?? null;
  };

  return {
    async getPolicy() {
      const editions = await readEditions();
      const current = editions.at(-1) ?? null;

      return { current, editions: [...editions].reverse() };
    },

    currentPolicyVersion,

    async publishPolicy(input, options): Promise<PolicyEdition> {
      const editions = await readEditions();

      if (editions.some((edition) => edition.version === input.version)) {
        throw new AppError('CONFLICT', `Редакция политики «${input.version}» уже опубликована`);
      }

      const edition: PolicyEdition = {
        version: input.version,
        text: input.text,
        publishedAt: new Date().toISOString(),
        publishedByName: options.actor.name,
      };

      await withTransaction(db, options.executor, async (tx) => {
        await settings.set(POLICY_SETTING_KEY, [...editions, edition], options.actor.userId, tx);

        await audit.record(
          {
            action: 'publish',
            entityKind: 'privacy_policy',
            after: { version: edition.version },
          },
          options.actor,
          tx,
        );
      });

      return edition;
    },

    listConsents(filters) {
      return privacy.listConsents(filters);
    },

    async createConsent(input, options): Promise<ConsentRecord> {
      const policyVersion = await currentPolicyVersion();
      if (policyVersion === null) {
        throw new AppError(
          'CONFLICT',
          'Сначала опубликуйте политику обработки персональных данных',
        );
      }

      if (!(await academics.studentExists(input.studentId))) {
        throw new AppError('NOT_FOUND', 'Ученик не найден');
      }

      const guardian = await users.getById(input.guardianUserId);
      if (guardian === null) {
        throw new AppError('NOT_FOUND', 'Законный представитель не найден');
      }

      const links = await guardians.listByStudent(input.studentId);
      if (!links.some((link) => link.guardianUserId === input.guardianUserId)) {
        throw new AppError(
          'CONFLICT',
          'Законный представитель не привязан к этому ученику: сначала оформите привязку',
        );
      }

      const existing = await privacy.findActiveConsentForStudent(input.studentId);
      if (existing !== null) {
        throw new AppError('CONFLICT', 'Действующее согласие по этому ученику уже есть');
      }

      const created = await withTransaction(db, options.executor, async (tx) => {
        const row = await privacy.insertConsent(
          {
            studentId: input.studentId,
            guardianUserId: input.guardianUserId,
            policyVersion,
            grantedVia: input.grantedVia,
            documentRef: input.documentRef ?? null,
          },
          tx,
        );

        await audit.record(
          {
            action: 'create',
            entityKind: 'consent',
            entityId: row.id,
            after: {
              studentId: input.studentId,
              guardianUserId: input.guardianUserId,
              policyVersion,
              grantedVia: input.grantedVia,
            },
          },
          options.actor,
          tx,
        );

        return row.id;
      });

      const record = await privacy.findConsent(created);
      if (record === null) throw new Error('Согласие не найдено после создания');
      return record;
    },

    async revokeConsent(id, reason, options): Promise<void> {
      const current = await privacy.findConsent(id);
      if (current === null) {
        throw new AppError('NOT_FOUND', 'Согласие не найдено');
      }

      if (current.revokedAt !== null) {
        throw new AppError('CONFLICT', 'Согласие уже отозвано');
      }

      await withTransaction(db, options.executor, async (tx) => {
        await privacy.revokeConsent(id, reason, tx);

        await audit.record(
          {
            action: 'update',
            entityKind: 'consent',
            entityId: id,
            before: { revokedAt: null },
            after: { revokedAt: new Date().toISOString(), reason },
          },
          options.actor,
          tx,
        );
      });
    },

    async listStudentsWithoutConsent() {
      const [{ items: students }, activeIds, anyIds] = await Promise.all([
        academics.listStudents({ limit: 1000, offset: 0 }),
        privacy.studentIdsWithActiveConsent(),
        privacy.studentIdsWithAnyConsent(),
      ]);

      const withActiveConsent = new Set(activeIds);
      const withAnyConsent = new Set(anyIds);

      const withoutConsent = students
        .filter((student) => !withActiveConsent.has(student.id))
        .map((student) => ({
          studentId: student.id,
          fullName: student.fullName,
          hasRevokedConsent: withAnyConsent.has(student.id),
        }));

      return { items: withoutConsent, total: withoutConsent.length };
    },
  };
}
