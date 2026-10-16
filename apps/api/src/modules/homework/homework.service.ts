import {
  fitsDuration,
  isAssignmentVisible,
  maxVisibleUntil,
  type AccessScope,
} from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import type { LessonRecord } from '../schedule';
import type { AssignmentWithContext, HomeworkRepository } from './homework.repository';

/**
 * Домашние задания: права и правила.
 *
 * Права проверяются **здесь**, а не в маршрутах: правило «чужой урок — не твоё дело» должно
 * действовать одинаково и в списке, и в правке, и в удалении. Ответ на чужой объект —
 * `404`, а не `403`: разница между «нет» и «нельзя» рассказывала бы о существовании чужих
 * заданий (то же решение, что в журнале).
 */

export interface HomeworkViewer {
  userId: string;
  permissions: ReadonlyMap<string, AccessScope>;
}

export interface HomeworkService {
  createAssignment(input: {
    viewer: HomeworkViewer;
    lessonId: string;
    text: string;
    dueOn: string | null;
    visibleUntil: string | null;
    links: readonly { url: string; title: string | null }[];
    fileIds: readonly string[];
  }): Promise<{ id: string }>;
  updateAssignment(input: {
    viewer: HomeworkViewer;
    assignmentId: string;
    text?: string;
    dueOn?: string | null;
    visibleUntil?: string | null;
    links?: readonly { url: string; title: string | null }[];
    fileIds?: readonly string[];
  }): Promise<void>;
  removeAssignment(input: { viewer: HomeworkViewer; assignmentId: string }): Promise<void>;
  /** Задание урока для журнала: доступно учителю урока и администратору. */
  getForLesson(input: { viewer: HomeworkViewer; lessonId: string }): Promise<HomeworkDetail | null>;
  /**
   * Задания, видимые ученику и представителю на дату.
   *
   * «Продолжительное» задание попадает в каждый урок предмета до своей даты — но сдаётся
   * один раз, поэтому в списке оно встречается **одним** заданием.
   */
  listVisible(input: {
    viewer: HomeworkViewer;
    studyGroupId: string;
    /** Уроки, в которых смотрим задания: пара «идентификатор — дата». */
    lessons: readonly { lessonId: string; lessonDate: string }[];
    onDate: string;
  }): Promise<HomeworkDetail[]>;
}

export interface HomeworkDetail {
  assignment: AssignmentWithContext;
  files: {
    id: string;
    originalName: string;
    sizeBytes: number;
    mimeType: string;
    isDeleted: boolean;
  }[];
  links: { id: string; url: string; title: string | null }[];
  submittedCount: number;
  studentCount: number;
}

export interface HomeworkServiceDependencies {
  repository: HomeworkRepository;
  /** Урок: права на задание определяются уроком. */
  findLesson: (lessonId: string) => Promise<LessonRecord | null>;
  /** Настройка предельной длительности продолжительного задания, в днях. */
  maxDurationDays: () => Promise<number>;
}

export function createHomeworkService(dependencies: HomeworkServiceDependencies): HomeworkService {
  const { repository, findLesson, maxDurationDays } = dependencies;

  const has = (viewer: HomeworkViewer, permission: string): boolean =>
    viewer.permissions.has(permission);

  const scopeOf = (viewer: HomeworkViewer, permission: string): AccessScope | undefined =>
    viewer.permissions.get(permission);

  /** Администратор: видит и правит задания любой группы. */
  const seesAll = (viewer: HomeworkViewer): boolean =>
    scopeOf(viewer, 'homework:review') === 'all' || scopeOf(viewer, 'homework:write') === 'all';

  /**
   * Может ли роль **ставить** задания.
   *
   * Ученик тоже имеет homework:write, но с областью own — это отправка решения, а не
   * постановка задания. Поэтому смотрим область: ssigned (свой урок) и ll.
   */
  const canWriteAssignments = (viewer: HomeworkViewer): boolean => {
    const scope = scopeOf(viewer, 'homework:write');
    return scope === 'assigned' || scope === 'all';
  };

  /**
   * Может ли смотрящий ставить задание в этот урок.
   *
   * Преподаватель — только в **свой** урок: проверяем `teacherUserId`, а не членство в
   * группе. Замена переносит это поле, поэтому заменяющий получает права автоматически, а
   * «преподаватель группы» без этого урока — нет. Так же сделано в журнале.
   */
  const canManageLesson = (viewer: HomeworkViewer, lesson: LessonRecord): boolean => {
    if (seesAll(viewer)) return true;
    if (scopeOf(viewer, 'homework:write') !== 'assigned') return false;
    return lesson.teacherUserId === viewer.userId;
  };

  const requireLesson = async (lessonId: string): Promise<LessonRecord> => {
    const lesson = await findLesson(lessonId);
    if (lesson === null) throw new AppError('NOT_FOUND', 'Урок не найден');
    return lesson;
  };

  const requireManage = async (viewer: HomeworkViewer, lessonId: string): Promise<LessonRecord> => {
    const lesson = await requireLesson(lessonId);
    if (!canManageLesson(viewer, lesson)) {
      // `404`, а не `403`: чужие задания не должны выдавать своё существование.
      throw new AppError('NOT_FOUND', 'Урок не найден');
    }

    return lesson;
  };

  /**
   * Проверить срок и «видно до».
   *
   * Ограничение длительности задаётся настройкой, а не константой: без предела задание
   * легко растянуть на весь год, и оно будет висеть в каждом уроке. Срок сдачи раньше даты
   * урока тоже отклоняем — задание «сдать вчера» бессмысленно.
   */
  const assertDates = async (input: {
    lessonDate: string;
    dueOn: string | null;
    visibleUntil: string | null;
  }): Promise<void> => {
    if (input.dueOn !== null && input.dueOn < input.lessonDate) {
      throw new AppError('VALIDATION_FAILED', 'Срок сдачи раньше даты урока');
    }

    if (input.visibleUntil === null) return;

    if (input.visibleUntil < input.lessonDate) {
      throw new AppError('VALIDATION_FAILED', 'Дата видимости раньше даты урока');
    }

    const limit = await maxDurationDays();
    if (
      !fitsDuration({
        lessonDate: input.lessonDate,
        visibleUntil: input.visibleUntil,
        maxDays: limit,
      })
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Задание видно не дольше ${String(limit)} дней: до ${maxVisibleUntil(input.lessonDate, limit)}`,
      );
    }
  };

  const detailOf = async (assignments: AssignmentWithContext[]): Promise<HomeworkDetail[]> => {
    const ids = assignments.map((assignment) => assignment.id);
    const [files, links, submitted] = await Promise.all([
      repository.listFiles(ids),
      repository.listLinks(ids),
      repository.countSubmissions(ids),
    ]);

    return Promise.all(
      assignments.map(async (assignment) => ({
        assignment,
        files: files
          .filter((file) => file.assignmentId === assignment.id)
          .map((file) => ({
            id: file.id,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            isDeleted: file.deletedAt !== null,
          })),
        links: links
          .filter((link) => link.assignmentId === assignment.id)
          .map((link) => ({ id: link.id, url: link.url, title: link.title })),
        submittedCount: submitted.get(assignment.id) ?? 0,
        studentCount: await repository.countStudents(
          assignment.studyGroupId,
          assignment.lessonDate,
        ),
      })),
    );
  };

  return {
    async createAssignment(input) {
      /**
       * Право проверяем **по области**, а не по наличию.
       *
       * `homework:write` есть и у ученика — с областью `own`: это отправка решения. Ставить
       * задание вправе только преподаватель (`assigned`) и администратор (`all`). Проверка
       * «право есть» пропустила бы ученика, и он упёрся бы в `404` по чужому уроку вместо
       * честного отказа.
       */
      if (!canWriteAssignments(input.viewer)) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:write');
      }

      const lesson = await requireManage(input.viewer, input.lessonId);

      if (input.text.trim() === '' && input.links.length === 0 && input.fileIds.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Задание пустое: нужен текст, ссылка или файл');
      }

      await assertDates({
        lessonDate: lesson.lessonDate,
        dueOn: input.dueOn,
        visibleUntil: input.visibleUntil,
      });

      const existing = await repository.findByLessonId(input.lessonId);
      if (existing !== null) {
        throw new AppError('CONFLICT', 'К этому уроку задание уже задано');
      }

      const created = await repository.createAssignment({
        lessonId: input.lessonId,
        text: input.text,
        dueOn: input.dueOn,
        visibleUntil: input.visibleUntil,
        createdBy: input.viewer.userId,
      });

      if (input.fileIds.length > 0) {
        await repository.addFiles(created.id, input.fileIds);
      }
      if (input.links.length > 0) {
        await repository.replaceLinks(created.id, input.links);
      }

      return created;
    },

    async updateAssignment(input) {
      const assignment = await repository.findAssignment(input.assignmentId);
      if (assignment === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      await requireManage(input.viewer, assignment.lessonId);

      await assertDates({
        lessonDate: assignment.lessonDate,
        dueOn: input.dueOn === undefined ? assignment.dueOn : input.dueOn,
        visibleUntil:
          input.visibleUntil === undefined ? assignment.visibleUntil : input.visibleUntil,
      });

      await repository.updateAssignment(input.assignmentId, {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.dueOn === undefined ? {} : { dueOn: input.dueOn }),
        ...(input.visibleUntil === undefined ? {} : { visibleUntil: input.visibleUntil }),
      });

      if (input.links !== undefined) {
        await repository.replaceLinks(input.assignmentId, input.links);
      }
      if (input.fileIds !== undefined) {
        await repository.addFiles(input.assignmentId, input.fileIds);
      }
    },

    async removeAssignment(input) {
      const assignment = await repository.findAssignment(input.assignmentId);
      if (assignment === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      await requireManage(input.viewer, assignment.lessonId);
      await repository.softDeleteAssignment(input.assignmentId, input.viewer.userId);
    },

    async getForLesson(input) {
      if (!has(input.viewer, 'homework:read')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:read');
      }

      const assignment = await repository.findByLessonId(input.lessonId);
      if (assignment === null) return null;

      /**
       * Ученику и представителю задание своего урока доступно: ограничение — уроки своей
       * группы, их отбирает вызывающая сторона. Преподавателю чужой урок не показываем.
       */
      const maySeeAsStaff =
        seesAll(input.viewer) ||
        (scopeOf(input.viewer, 'homework:read') === 'assigned' &&
          assignment.lessonTeacherUserId === input.viewer.userId);
      const maySeeAsOwn = scopeOf(input.viewer, 'homework:read') === 'own';

      if (!maySeeAsStaff && !maySeeAsOwn) {
        throw new AppError('NOT_FOUND', 'Урок не найден');
      }

      const [detail] = await detailOf([assignment]);
      return detail ?? null;
    },

    async listVisible(input) {
      if (!has(input.viewer, 'homework:read')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:read');
      }

      /**
       * Ученику и представителю задания **своей** группы: список уроков приходит от
       * вызывающей стороны, которая уже проверила доступ к группе.
       */
      const candidates = await repository.listCandidates({
        studyGroupId: input.studyGroupId,
        lessonIds: input.lessons.map((lesson) => lesson.lessonId),
        onDate: input.onDate,
      });

      /**
       * Точную видимость решает домен: своё задание видно всегда, продолжительное — в
       * уроках того же предмета до своей даты, но **не раньше**, чем его задали.
       *
       * Поэтому проверяем кандидата против **каждого** урока из запроса: задание,
       * поставленное на 8-е, не должно появиться в уроке 1-го.
       */
      const visible = candidates.filter((candidate) =>
        input.lessons.some((lesson) =>
          isAssignmentVisible({
            assignmentLessonId: candidate.lessonId,
            assignmentLessonDate: candidate.lessonDate,
            visibleUntil: candidate.visibleUntil,
            lessonId: lesson.lessonId,
            lessonDate: lesson.lessonDate,
          }),
        ),
      );

      return detailOf(visible);
    },
  };
}
