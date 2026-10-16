import { toIsoDate, type AccessScope } from '@edu-diary/domain';

import { AppError } from '../../shared/errors';
import type { LessonRecord } from '../schedule';
import type { AssignmentWithContext, HomeworkRepository } from './homework.repository';

/**
 * Домашние задания: права и правила.
 *
 * Модель: у задания есть **урок-срок** — до какого занятия оно задано. Дат нет: учитель
 * выбирает урок из ближайших занятий того же предмета и группы, а по умолчанию подставляется
 * **следующий урок** по расписанию. Так «долгая домашка и короткая рядом» не мешают друг
 * другу: у каждой свой срок, и они не затирают одна другую.
 *
 * Права проверяются здесь, а не в маршрутах: правило «чужой урок — не твоё дело» должно
 * действовать одинаково и в списке, и в правке, и в удалении. Ответ на чужой объект — `404`,
 * а не `403`: разница между «нет» и «нельзя» рассказывала бы о существовании чужих заданий.
 */

export interface HomeworkViewer {
  userId: string;
  permissions: ReadonlyMap<string, AccessScope>;
}

/** Файл и ссылка: то, что показывается вместе с заданием. */
export interface HomeworkAttachment {
  id: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
  isDeleted: boolean;
  /**
   * Когда файл загружен.
   *
   * Нужен контракту ответа, и без него маршрут отвечал 400: проверка схемы отклоняла
   * ответ, когда у задания были вложения. Дефект не был виден в тестах, потому что в них
   * задания создавались **без файлов**, и список вложений был пуст.
   */
  createdAt: string;
}

export interface HomeworkLinkView {
  id: string;
  url: string;
  title: string | null;
}

export interface HomeworkDetail {
  assignment: AssignmentWithContext;
  files: HomeworkAttachment[];
  links: HomeworkLinkView[];
  submittedCount: number;
  studentCount: number;
}

/**
 * Снимок задания для аудита.
 *
 * Для спора «это не я задавал» нужны факты: какие были урок и срок и менялся ли текст.
 * Полный текст задания в аудит не пишем: он уходит в журнал, который хранится долго, а для
 * разбора достаточно факта правки и длины.
 */
export interface HomeworkSnapshot {
  lessonId: string;
  dueLessonId: string;
  textLength: number;
  /** Сколько ссылок приложено: правку ссылок иначе в аудите не увидеть. */
  links: number;
  /** Сколько файлов приложено. */
  files: number;
}

/** Ближайший урок для списка выбора срока. */
export interface DueLessonOption {
  lessonId: string;
  lessonDate: string;
  pairNumber: number;
}

/** Отметка о задании для расписания: только счётчики. */
export interface LessonHomeworkFlag {
  lessonId: string;
  /** Задано **на** этом уроке: преподаватель видит, что уже ставил. */
  assignedHere: number;
  /** Нужно сдать **к** этому уроку: ученик видит, что задано на эту дату. */
  dueHere: number;
  /** Сколько заданий к этому уроку ученик уже сдал. */
  submittedHere: number;
}

export interface HomeworkService {
  createAssignment(input: {
    viewer: HomeworkViewer;
    lessonId: string;
    /** Урок-срок: `null` — следующий урок по расписанию. */
    dueLessonId: string | null;
    text: string;
    links: readonly { url: string; title: string | null }[];
    fileIds: readonly string[];
  }): Promise<{ id: string }>;
  updateAssignment(input: {
    viewer: HomeworkViewer;
    assignmentId: string;
    text?: string;
    dueLessonId?: string;
    /** Новый набор ссылок: `undefined` — не менять, пустой список — убрать все. */
    links?: readonly { url: string; title: string | null }[];
    /** Файлы, которые нужно **добавить** к заданию. */
    fileIds?: readonly string[];
    /**
     * Какие из **уже приложенных** файлов оставить.
     *
     * Передаётся полный список: так «убрать файл» выражается отсутствием в списке, и сервис
     * сам решает, что помечать удалённым. Отдельного «удали файл X» нет намеренно — иначе
     * форму пришлось бы учить двум разным операциям.
     */
    keepFileIds?: readonly string[];
  }): Promise<{ before: HomeworkSnapshot; after: HomeworkSnapshot }>;
  removeAssignment(input: {
    viewer: HomeworkViewer;
    assignmentId: string;
  }): Promise<{ removed: HomeworkSnapshot }>;
  /**
   * Что видно в уроке.
   *
   * `assignedHere` — задания, **заданные** на этом уроке: их правит учитель.
   * `dueHere` — задания, **сдать которые** нужно к этому уроку, включая заданные раньше:
   * это то, что проверяет учитель и видит ученик.
   */
  getForLesson(input: { viewer: HomeworkViewer; lessonId: string }): Promise<{
    assignedHere: HomeworkDetail[];
    dueHere: HomeworkDetail[];
  }>;
  /** Задания, сдать которые нужно к этим урокам: список ученика на дату. */
  listDue(input: {
    viewer: HomeworkViewer;
    dueLessonIds: readonly string[];
  }): Promise<HomeworkDetail[]>;
  /** Ближайшие уроки того же предмета и группы: из них учитель выбирает срок. */
  listDueOptions(input: { lesson: LessonRecord; limit?: number }): Promise<DueLessonOption[]>;
  /**
   * Отметки о задании для **расписания**.
   *
   * В расписании не нужен текст задания — нужно видеть, есть ли оно: ученику, что задано на
   * эту дату, преподавателю, что он в этот день уже ставил. Поэтому отдаём только счётчики, а
   * не сами задания: иначе расписание тянуло бы весь текст на каждое занятие недели.
   */
  listFlags(input: {
    viewer: HomeworkViewer;
    lessonIds: readonly string[];
  }): Promise<LessonHomeworkFlag[]>;
}

export interface HomeworkServiceDependencies {
  repository: HomeworkRepository;
  findLesson: (lessonId: string) => Promise<LessonRecord | null>;
  /** Уроки группы в периоде: из них выбирается следующий урок и строится список срока. */
  listLessonsForGroup: (studyGroupId: string, from: string, to: string) => Promise<LessonRecord[]>;
}

export function createHomeworkService(dependencies: HomeworkServiceDependencies): HomeworkService {
  const { repository, findLesson, listLessonsForGroup } = dependencies;

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
   * У ученика `homework:write` есть, но с областью `own` — это отправка решения, а не
   * постановка задания. Поэтому смотрим область: `assigned` (свой урок) и `all`.
   */
  const canWriteAssignments = (viewer: HomeworkViewer): boolean => {
    const scope = scopeOf(viewer, 'homework:write');
    return scope === 'assigned' || scope === 'all';
  };

  /**
   * Может ли смотрящий распоряжаться заданиями этого урока.
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
    /**
     * Сначала право, потом урок. Иначе роль **без права** получала бы «Урок не найден»:
     * отсутствие права не должно выглядеть как отсутствие объекта, а разные ответы
     * рассказывали бы о существовании чужих уроков.
     */
    if (!canWriteAssignments(viewer)) {
      throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:write');
    }

    const lesson = await requireLesson(lessonId);
    if (!canManageLesson(viewer, lesson)) {
      // `404`, а не `403`: чужие задания не должны выдавать своё существование.
      throw new AppError('NOT_FOUND', 'Урок не найден');
    }

    return lesson;
  };

  /**
   * Ближайшие уроки того же предмета и группы, начиная со следующего после данного.
   *
   * Список нужен вместо полей с датами: датами оперировать неудобно, и учитель указывает
   * совсем другие числа. Здесь он выбирает занятие — то же, что видит в расписании.
   */
  const nextLessons = async (lesson: LessonRecord, limit = 5): Promise<LessonRecord[]> => {
    /** Берём с запасом: после праздников и отменённых занятий уроков может не быть неделями. */
    const horizon = addDays(lesson.lessonDate, 120);

    const lessons = await listLessonsForGroup(lesson.studyGroupId, lesson.lessonDate, horizon);

    return lessons
      .filter(
        (candidate) =>
          candidate.subjectId === lesson.subjectId && candidate.lessonDate > lesson.lessonDate,
      )
      .sort((a, b) =>
        a.lessonDate === b.lessonDate
          ? a.pairNumber - b.pairNumber
          : a.lessonDate.localeCompare(b.lessonDate),
      )
      .slice(0, limit);
  };

  const detailOf = async (assignments: AssignmentWithContext[]): Promise<HomeworkDetail[]> => {
    const ids = assignments.map((assignment) => assignment.id);
    const [files, links, submitted] = await Promise.all([
      repository.listFiles(ids),
      repository.listLinks(ids),
      repository.countSubmissions(ids),
    ]);

    const details: HomeworkDetail[] = [];
    for (const assignment of assignments) {
      details.push({
        assignment,
        /**
         * Помеченные удалёнными **не показываем**: файл убран, и в задании его быть не
         * должно. Пометка остаётся в базе — по ней видно, что файл был.
         */
        files: files
          .filter((file) => file.assignmentId === assignment.id && file.deletedAt === null)
          .map((file) => ({
            id: file.id,
            originalName: file.originalName,
            sizeBytes: file.sizeBytes,
            mimeType: file.mimeType,
            isDeleted: file.deletedAt !== null,
            createdAt: file.createdAt.toISOString(),
          })),
        links: links
          .filter((link) => link.assignmentId === assignment.id)
          .map((link) => ({ id: link.id, url: link.url, title: link.title })),
        submittedCount: submitted.get(assignment.id) ?? 0,
        studentCount: await repository.countStudents(
          assignment.studyGroupId,
          assignment.dueLessonDate,
        ),
      });
    }

    return details;
  };

  return {
    async createAssignment(input) {
      const lesson = await requireManage(input.viewer, input.lessonId);

      if (input.text.trim() === '' && input.links.length === 0 && input.fileIds.length === 0) {
        throw new AppError('VALIDATION_FAILED', 'Задание пустое: нужен текст, ссылка или файл');
      }

      /**
       * Урок-срок: выбранный, а по умолчанию — **следующий урок** того же предмета. Если
       * следующего нет (последнее занятие, каникулы, конец периода), сроком становится этот
       * же урок: выдумывать дату за расписание не нужно.
       */
      let dueLessonId = input.dueLessonId ?? '';
      if (dueLessonId !== '') {
        const due = await requireLesson(dueLessonId);
        if (due.studyGroupId !== lesson.studyGroupId || due.subjectId !== lesson.subjectId) {
          throw new AppError(
            'VALIDATION_FAILED',
            'Срок должен быть уроком того же предмета и группы',
          );
        }
        if (due.lessonDate < lesson.lessonDate) {
          throw new AppError('VALIDATION_FAILED', 'Срок раньше урока, на котором задано задание');
        }
      } else {
        const [next] = await nextLessons(lesson, 1);
        dueLessonId = next?.id ?? lesson.id;
      }

      const created = await repository.createAssignment({
        lessonId: input.lessonId,
        dueLessonId,
        text: input.text,
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

      if (input.dueLessonId !== undefined) {
        const due = await requireLesson(input.dueLessonId);
        if (due.lessonDate < assignment.lessonDate) {
          throw new AppError('VALIDATION_FAILED', 'Срок раньше урока, на котором задано задание');
        }
      }

      /**
       * Считаем ссылки и файлы **до** правки: без этого в аудите не видно, что учитель
       * поправил ссылку или приложил картинку, — а именно это он и меняет чаще всего.
       */
      const [existingFiles, existingLinks] = await Promise.all([
        repository.listFiles([input.assignmentId]),
        repository.listLinks([input.assignmentId]),
      ]);

      const before = snapshotOf(assignment, {
        links: existingLinks.length,
        files: existingFiles.filter((file) => file.deletedAt === null).length,
      });

      await repository.updateAssignment(input.assignmentId, {
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.dueLessonId === undefined ? {} : { dueLessonId: input.dueLessonId }),
      });

      /**
       * Ссылки **заменяются целиком**: учитель правит список, а не отдельные ссылки, и так
       * видно, что в задании осталось. Пустой список означает «ссылок нет».
       */
      if (input.links !== undefined) {
        await repository.replaceLinks(input.assignmentId, input.links);
      }

      /** Файлы **добавляются**: уже приложенные остаются, если их не убрали в форме. */
      if (input.fileIds !== undefined && input.fileIds.length > 0) {
        await repository.addFiles(input.assignmentId, input.fileIds);
      }

      /**
       * Убранные в форме файлы помечаем удалёнными. Файлы **не стираем**: в базе остаётся
       * пометка, и видно, что файл был и его убрали. Так же сделано с отметками (ADR-011).
       *
       * Помечаем **только уже привязанные** к заданию файлы: без этого, зная чужой
       * идентификатор, можно было бы пометить файл другого задания — проверка стоит в
       * запросе репозитория.
       */
      let removedCount = 0;

      if (input.keepFileIds !== undefined) {
        const keep = new Set([...input.keepFileIds, ...(input.fileIds ?? [])]);
        const removed = existingFiles
          .filter((file) => file.deletedAt === null && !keep.has(file.id))
          .map((file) => file.id);

        removedCount = removed.length;

        await repository.softDeleteFiles({
          assignmentId: input.assignmentId,
          fileIds: removed,
          actorUserId: input.viewer.userId,
        });
      }

      /**
       * Снимок «после» строим из **того, что просили изменить**, а не повторным чтением: так
       * в аудите видно именно намерение правки, и лишнего запроса не нужно.
       */
      return {
        before,
        after: {
          lessonId: before.lessonId,
          dueLessonId: input.dueLessonId ?? before.dueLessonId,
          /** Текст не меняли — длина остаётся прежней; меняли — берём новую. */
          textLength: input.text === undefined ? before.textLength : input.text.length,
          links: input.links === undefined ? before.links : input.links.length,
          files: Math.max(0, before.files - removedCount + (input.fileIds?.length ?? 0)),
        },
      };
    },

    async removeAssignment(input) {
      const assignment = await repository.findAssignment(input.assignmentId);
      if (assignment === null) throw new AppError('NOT_FOUND', 'Задание не найдено');

      await requireManage(input.viewer, assignment.lessonId);
      await repository.softDeleteAssignment(input.assignmentId, input.viewer.userId);

      return { removed: snapshotOf(assignment) };
    },

    async getForLesson(input) {
      if (!has(input.viewer, 'homework:read')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:read');
      }

      const lesson = await requireLesson(input.lessonId);

      /**
       * Ученику и представителю задания своего урока доступны: ограничение — уроки своей
       * группы, их отбирает вызывающая сторона. Преподавателю чужой урок не показываем.
       */
      const staffScope =
        scopeOf(input.viewer, 'homework:review') ?? scopeOf(input.viewer, 'homework:write');
      const canSeeAsStaff =
        staffScope === 'all' ||
        (staffScope === 'assigned' && lesson.teacherUserId === input.viewer.userId);
      const canSeeAsOwn = scopeOf(input.viewer, 'homework:read') === 'own';

      if (!canSeeAsStaff && !canSeeAsOwn) {
        throw new AppError('NOT_FOUND', 'Урок не найден');
      }

      const [assigned, due] = await Promise.all([
        repository.listByLessonId(input.lessonId),
        repository.listByDueLessonId(input.lessonId),
      ]);

      return {
        assignedHere: await detailOf(assigned),
        dueHere: await detailOf(due),
      };
    },

    async listDue(input) {
      if (!has(input.viewer, 'homework:read')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:read');
      }

      const assignments = await repository.listByDueLessonIds(input.dueLessonIds);
      return detailOf(assignments);
    },

    async listDueOptions(input) {
      const lessons = await nextLessons(input.lesson, input.limit ?? 5);

      return lessons.map((lesson) => ({
        lessonId: lesson.id,
        lessonDate: lesson.lessonDate,
        pairNumber: lesson.pairNumber,
      }));
    },

    async listFlags(input) {
      if (!has(input.viewer, 'homework:read')) {
        throw new AppError('FORBIDDEN', 'Недостаточно прав: homework:read');
      }

      if (input.lessonIds.length === 0) return [];

      const [assigned, due] = await Promise.all([
        repository.listByLessonIdsAssigned(input.lessonIds),
        repository.listByDueLessonIds(input.lessonIds),
      ]);

      /** Сколько заданий к этому уроку ученик уже сдал: ему важно видеть «сдано». */
      const submitted = await repository.countSubmissionsByViewer({
        assignmentIds: due.map((assignment) => assignment.id),
        viewerUserId: input.viewer.userId,
      });

      const assignedCount = new Map<string, number>();
      for (const assignment of assigned) {
        assignedCount.set(assignment.lessonId, (assignedCount.get(assignment.lessonId) ?? 0) + 1);
      }

      const dueCount = new Map<string, number>();
      for (const assignment of due) {
        dueCount.set(assignment.dueLessonId, (dueCount.get(assignment.dueLessonId) ?? 0) + 1);
      }

      return input.lessonIds.map((lessonId) => ({
        lessonId,
        assignedHere: assignedCount.get(lessonId) ?? 0,
        dueHere: dueCount.get(lessonId) ?? 0,
        submittedHere: due
          .filter((assignment) => assignment.dueLessonId === lessonId)
          .filter((assignment) => submitted.has(assignment.id)).length,
      }));
    },
  };
}

/** Снимок задания для аудита. */
function snapshotOf(
  assignment: AssignmentWithContext,
  counts: { links: number; files: number } = { links: 0, files: 0 },
): HomeworkSnapshot {
  return {
    lessonId: assignment.lessonId,
    dueLessonId: assignment.dueLessonId,
    textLength: assignment.text.length,
    links: counts.links,
    files: counts.files,
  };
}

/** Прибавить дни к календарной дате: нужно для горизонта поиска уроков. */
function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return toIsoDate(value);
}
