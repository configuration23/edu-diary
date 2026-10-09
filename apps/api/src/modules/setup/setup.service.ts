import { validatePassword } from '@edu-diary/domain';
import type { SetupCompleteRequestDto, SetupStatusResponseDto } from '@edu-diary/contracts';

import { SYSTEM_ACTOR, type AuditActor } from '../../shared/actor';
import type { Database } from '../../shared/db/client';
import type { DatabaseCheck, MigrationsCheck } from '@edu-diary/contracts';
import { readMigrationsState } from '../../shared/db/migrations-state';
import { AppError } from '../../shared/errors';
import type { AcademicsService } from '../academics';
import type { AuditService } from '../audit';
import type { RolesService, UsersService } from '../iam';
import { SETTING_KEYS, type SettingsService } from '../settings';

/**
 * Мастер первого запуска (ARCHITECTURE.md §9, ADR-014).
 *
 * Шаги мастера: проверка подключения к БД и миграций → учебное заведение →
 * учебный год и первый период → администратор → хранилище файлов. Параметры
 * подключения к БД задаются окружением (ADR-024), мастер их проверяет.
 *
 * Учёток по умолчанию не существует: единственный администратор создаётся здесь.
 */

export interface SetupService {
  status(): Promise<SetupStatusResponseDto>;
  /** Создаёт администратора и все начальные данные. Возвращает id администратора. */
  complete(input: SetupCompleteRequestDto, actor?: AuditActor): Promise<{ adminUserId: string }>;
}

export interface SetupServiceDependencies {
  db: Database;
  settings: SettingsService;
  users: UsersService;
  roles: RolesService;
  academics: AcademicsService;
  audit: AuditService;
}

export function createSetupService(dependencies: SetupServiceDependencies): SetupService {
  const { db, settings, users, roles, academics, audit } = dependencies;

  const readBranding = async () => {
    const [title, shortName, signature, logoDataUrl] = await Promise.all([
      settings.get<string | null>(SETTING_KEYS.brandingTitle),
      settings.get<string | null>(SETTING_KEYS.brandingShortName),
      settings.get<string | null>(SETTING_KEYS.brandingSignature),
      settings.get<string | null>(SETTING_KEYS.brandingLogo),
    ]);

    return { title, shortName, signature, logoDataUrl };
  };

  return {
    async status(): Promise<SetupStatusResponseDto> {
      const ping = await db.ping({ timeoutMs: 2000 });

      const migrations: MigrationsCheck = ping.ok
        ? await readMigrationsState(db)
        : { status: 'unknown', applied: 0, pending: 0 };

      const database: DatabaseCheck = {
        status: ping.ok ? 'ok' : 'error',
        latencyMs: ping.latencyMs,
        ...(ping.message === undefined ? {} : { message: ping.message }),
      };

      return {
        initialized: await settings.isInitialized(),
        checks: { database, migrations },
        branding: await readBranding(),
      };
    },

    async complete(input, actor = SYSTEM_ACTOR): Promise<{ adminUserId: string }> {
      if (await settings.isInitialized()) {
        throw new AppError('CONFLICT', 'Система уже настроена');
      }

      const passwordIssues = validatePassword(input.admin.password, {
        username: input.admin.username,
        fullName: input.admin.fullName,
      });

      if (passwordIssues.length > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          `Пароль администратора не соответствует требованиям: ${passwordIssues.join('; ')}`,
          { details: { issues: passwordIssues } },
        );
      }

      // Роли и права «из коробки» должны существовать до создания администратора.
      await roles.syncCatalog();

      const adminUserId = await db.transaction(async (tx) => {
        const admin = await users.create(
          {
            username: input.admin.username,
            fullName: input.admin.fullName,
            password: input.admin.password,
            ...(input.admin.email === undefined ? {} : { email: input.admin.email }),
            roles: ['admin'],
            mustChangePassword: false,
          },
          { actor, executor: tx },
        );

        const branding: Array<[string, unknown]> = [
          [SETTING_KEYS.brandingTitle, input.institution.title],
          [SETTING_KEYS.brandingShortName, input.institution.shortName ?? null],
          [SETTING_KEYS.brandingSignature, input.institution.signature ?? null],
          [SETTING_KEYS.brandingLogo, input.institution.logoDataUrl ?? null],
          [SETTING_KEYS.storageProvider, input.storage?.provider ?? 'local'],
          [SETTING_KEYS.storageLocalPath, input.storage?.path ?? null],
        ];

        for (const [key, value] of branding) {
          await settings.set(key, value, actor.userId, tx);
        }

        const year = await academics.createAcademicYear(
          {
            title: input.academicYear.title,
            startsOn: input.academicYear.startsOn,
            endsOn: input.academicYear.endsOn,
            isActive: true,
          },
          { actor, executor: tx },
        );

        await academics.createPeriod(
          {
            academicYearId: year.id,
            title: input.period.title,
            kind: input.period.kind,
            startsOn: input.period.startsOn,
            endsOn: input.period.endsOn,
          },
          { actor, executor: tx },
        );

        // Мастер закрывается навсегда (ARCHITECTURE.md §9.4).
        await settings.set(SETTING_KEYS.systemInitialized, true, actor.userId, tx);

        await audit.record(
          {
            action: 'setup_completed',
            entityKind: 'system',
            context: {
              institution: input.institution.title,
              academicYear: input.academicYear.title,
              storage: input.storage?.provider ?? 'local',
            },
          },
          actor,
          tx,
        );

        return admin.id;
      });

      return { adminUserId };
    },
  };
}
