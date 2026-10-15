import type { FastifyInstance } from 'fastify';

import { ADMIN_PASSWORD, cookieHeader, login } from './api';

/**
 * Фабрики тестовых данных.
 *
 * Каждый тест начинался с одинакового куска: год, группа, предмет, преподаватель,
 * назначение, ученик, зачисление, урок — тридцать-сорок строк, повторявшихся почти
 * дословно, с обязательным порядком (год раньше группы, назначение раньше урока). Знание
 * этого порядка было размазано по двум десяткам мест. Здесь оно в одном.
 *
 * **Зависимость от транспорта — через `ApiClient`.** Фабрики не зовут `app.inject`
 * напрямую, поэтому те же рецепты работы с данными можно направить на живой сервер (см.
 * `httpClient` ниже): инструмент наполнения стенда не будет вторым набором правил, который
 * разойдётся с тестами.
 */

/** Ответ сервера в том виде, который нужен фабрикам. */
export interface ApiResponse {
  status: number;
  body: string;
  /** Заголовок ответа: из него берём cookie сессии при входе. */
  cookie: string | null;
  json(): unknown;
}

/** Транспорт: тесты работают через `inject`, стенд — через сеть. */
export interface ApiClient {
  request(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    payload?: unknown;
    cookie?: string;
  }): Promise<ApiResponse>;
}

/** Транспорт для тестов: Fastify в памяти. */
export function injectClient(app: FastifyInstance): ApiClient {
  return {
    async request(input): Promise<ApiResponse> {
      /**
       * Приведение типа у `payload`: в фабриках он `unknown` (подходит и для сети), а
       * `inject` ждёт конкретный `InjectPayload`. Для живого сервера приведение не нужно —
       * там тело сериализуется в JSON.
       */
      const response = await app.inject({
        method: input.method as 'GET',
        url: input.url,
        ...(input.payload === undefined ? {} : { payload: input.payload as object }),
        ...(input.cookie === undefined ? {} : { headers: { cookie: input.cookie } }),
      });

      const sessionCookie = response.cookies.find((item) => item.name === 'edu_diary_session');
      const status = response.statusCode;
      const payload = response.body;

      return {
        status,
        body: payload,
        cookie: sessionCookie === undefined ? null : `${sessionCookie.name}=${sessionCookie.value}`,
        json: () => response.json() as unknown,
      };
    },
  };
}

/**
 * Транспорт для живого сервера.
 *
 * Тот же набор рецептов, но по сети: наполнение тестового стенда не должно быть отдельным
 * скриптом со своими правилами — иначе проверенное в тестах и созданное на стенде
 * разойдутся.
 */
export function httpClient(baseUrl: string): ApiClient {
  return {
    async request(input) {
      const response = await fetch(`${baseUrl}${input.url}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          ...(input.payload === undefined ? {} : { 'content-type': 'application/json' }),
          ...(input.cookie === undefined ? {} : { cookie: input.cookie }),
        },
        ...(input.payload === undefined ? {} : { body: JSON.stringify(input.payload) }),
      });

      const body = await response.text();

      return {
        status: response.status,
        body,
        cookie: response.headers.get('set-cookie'),
        json: () => JSON.parse(body) as unknown,
      };
    },
  };
}

/**
 * Логин из метки прогона.
 *
 * Логин допускает только строчные латинские буквы, цифры, точку, дефис и подчёркивание
 * (политика учётных записей). Метка прогона в тестах бывает на русском («АН»), и фабрика
 * сама приводит её к допустимому виду — иначе создание пользователя падало на валидации.
 * Если после очистки не осталось букв, добавляем счётчик, чтобы логин не оказался пустым.
 */
function usernameSlug(run: string): string {
  const cleaned = run
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[-._]+|[-._]+$/g, '');

  return cleaned === '' ? String(Date.now()).slice(-6) : cleaned;
}

/** Ошибка подготовки данных: сразу видно, какой шаг не прошёл. */
async function expectStatus(
  response: ApiResponse,
  expected: number[],
  what: string,
): Promise<void> {
  if (expected.includes(response.status)) return;
  throw new Error(`${what}: ${String(response.status)} ${response.body}`);
}

function idOf(response: ApiResponse): string {
  return (response.json() as { id: string }).id;
}

export interface FactoryContext {
  client: ApiClient;
  /** Cookie администратора: подготовка данных идёт от его имени. */
  adminCookie: string;
}

export function factories(client: ApiClient, adminCookie: string): FactoryContext {
  return { client, adminCookie };
}

/** Год, внутри которого можно заводить группы и занятия. */
export async function createAcademicYear(
  context: FactoryContext,
  input: { title?: string; startsOn: string; endsOn: string; isActive?: boolean },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/academic-years',
    cookie: context.adminCookie,
    payload: {
      title: input.title ?? `Учебный год ${String(Date.now()).slice(-6)}`,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      isActive: input.isActive ?? true,
    },
  });

  await expectStatus(response, [201], 'Учебный год не создан');
  return { id: idOf(response) };
}

/**
 * Группа.
 *
 * Границы группы — **внутри учебного года**: сервер это проверяет, и тест, создавший
 * группу шире года, получал отказ. Поэтому по умолчанию берём границы года.
 */
export async function createGroup(
  context: FactoryContext,
  input: {
    academicYearId: string;
    name: string;
    startsOn: string;
    endsOn: string;
  },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/groups',
    cookie: context.adminCookie,
    payload: input,
  });

  await expectStatus(response, [201], 'Группа не создана');
  return { id: idOf(response) };
}

export async function createSubject(
  context: FactoryContext,
  input: { name: string; shortName?: string; kind?: 'mandatory' | 'optional' },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/subjects',
    cookie: context.adminCookie,
    payload: {
      name: input.name,
      shortName: input.shortName ?? 'ПР',
      kind: input.kind ?? 'mandatory',
    },
  });

  await expectStatus(response, [201], 'Предмет не создан');
  return { id: idOf(response) };
}

/** Учётная запись преподавателя: возвращается вместе с cookie — под ней можно войти. */
export async function createTeacher(
  context: FactoryContext,
  input: { username: string; fullName: string; password: string },
): Promise<{ id: string; cookie: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/users',
    cookie: context.adminCookie,
    payload: { ...input, roles: ['teacher'] },
  });

  await expectStatus(response, [201], 'Преподаватель не создан');

  const user = response.json() as { id: string };
  const cookies = await context.client.request({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username: input.username, password: input.password },
  });
  const cookie = cookies.cookie ?? '';

  return { id: user.id, cookie };
}

/** Ученик вместе с учётной записью: иначе не проверить его собственные экраны. */
export async function createStudentWithAccount(
  context: FactoryContext,
  input: { fullName: string; username: string; password: string },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/students',
    cookie: context.adminCookie,
    payload: {
      fullName: input.fullName,
      account: { username: input.username, password: input.password },
    },
  });

  await expectStatus(response, [201], 'Ученик не создан');
  return { id: idOf(response) };
}

export async function enrollStudent(
  context: FactoryContext,
  input: { studyGroupId: string; studentId: string; joinedOn: string },
): Promise<void> {
  const response = await context.client.request({
    method: 'POST',
    url: `/api/groups/${input.studyGroupId}/enrollments`,
    cookie: context.adminCookie,
    payload: { studentId: input.studentId, joinedOn: input.joinedOn },
  });

  await expectStatus(response, [201], 'Ученик не зачислен');
}

/** Назначение «преподаватель ↔ предмет ↔ группа»: без него занятие не создать. */
export async function createAssignment(
  context: FactoryContext,
  input: {
    teacherUserId: string;
    subjectId: string;
    studyGroupId: string;
    startsOn: string;
  },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/assignments',
    cookie: context.adminCookie,
    payload: input,
  });

  await expectStatus(response, [201], 'Назначение не создано');
  return { id: idOf(response) };
}

export async function createLesson(
  context: FactoryContext,
  input: {
    studyGroupId: string;
    subjectId: string;
    teacherUserId: string;
    lessonDate: string;
    pairNumber: number;
    timeStart?: string;
    timeEnd?: string;
  },
): Promise<{ id: string }> {
  const response = await context.client.request({
    method: 'POST',
    url: '/api/lessons',
    cookie: context.adminCookie,
    payload: {
      ...input,
      timeStart: input.timeStart ?? '08:30',
      timeEnd: input.timeEnd ?? '10:00',
    },
  });

  await expectStatus(response, [201], 'Урок не создан');
  return { id: idOf(response) };
}

/**
 * Готовый «учебный контекст» одним вызовом: год, группа, предмет, преподаватель,
 * назначение, ученик и занятие.
 *
 * Именно этот набор повторялся в тестах чаще всего. Что не нужно — не создаётся: ученик и
 * занятие по флагам.
 */
export async function createLessonContext(
  context: FactoryContext,
  input: {
    /** Уникальный суффикс: повторный прогон не должен упираться в занятые имена. */
    run: string;
    yearStartsOn: string;
    yearEndsOn: string;
    groupName?: string;
    subjectName?: string;
    /** Имя ученика: тесты иногда проверяют его в ответе. */
    studentName?: string;
    /** Пароли: политика требует длину и отсутствие логина в пароле. */
    teacherPassword?: string;
    studentPassword?: string;
    withStudent?: boolean;
    lessonDate?: string;
    /** День начала генерации, если нужен готовый урок на конкретную дату. */
  },
): Promise<{
  year: { id: string };
  group: { id: string };
  subject: { id: string };
  teacher: { id: string; cookie: string };
  assignment: { id: string };
  student?: { id: string };
  lesson?: { id: string };
}> {
  const year = await createAcademicYear(context, {
    title: `Год ${input.run}`,
    startsOn: input.yearStartsOn,
    endsOn: input.yearEndsOn,
  });

  const group = await createGroup(context, {
    academicYearId: year.id,
    name: input.groupName ?? `ГР-${input.run}`,
    startsOn: input.yearStartsOn,
    endsOn: input.yearEndsOn,
  });

  const subject = await createSubject(context, {
    name: input.subjectName ?? `Предмет ${input.run}`,
  });

  /** Логины — из допустимых символов: метка прогона бывает русской. */
  const slug = usernameSlug(input.run);

  const teacher = await createTeacher(context, {
    username: `prepod-${slug}`,
    fullName: `Преподаватель ${input.run}`,
    password: input.teacherPassword ?? 'kolledzh-prepodavatel-2025',
  });

  const assignment = await createAssignment(context, {
    teacherUserId: teacher.id,
    subjectId: subject.id,
    studyGroupId: group.id,
    startsOn: input.yearStartsOn,
  });

  const result: {
    year: { id: string };
    group: { id: string };
    subject: { id: string };
    teacher: { id: string; cookie: string };
    assignment: { id: string };
    student?: { id: string };
    lesson?: { id: string };
  } = { year, group, subject, teacher, assignment };

  if (input.withStudent === true) {
    const student = await createStudentWithAccount(context, {
      fullName: input.studentName ?? `Ученик ${input.run}`,
      username: `uchenik-${slug}`,
      password: input.studentPassword ?? 'kolledzh-uchenik-2025',
    });

    await enrollStudent(context, {
      studyGroupId: group.id,
      studentId: student.id,
      joinedOn: input.yearStartsOn,
    });

    result.student = student;
  }

  if (input.lessonDate !== undefined) {
    result.lesson = await createLesson(context, {
      studyGroupId: group.id,
      subjectId: subject.id,
      teacherUserId: teacher.id,
      lessonDate: input.lessonDate,
      pairNumber: 1,
    });
  }

  return result;
}

export { ADMIN_PASSWORD, cookieHeader, login };
