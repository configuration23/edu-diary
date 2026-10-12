#!/usr/bin/env node
/**
 * Демонстрационные данные: `npm run seed:demo`.
 *
 * Сидер идёт через публичный API — тем же путём, что и браузер. Так он не
 * дублирует правила доступа и проверки, а любая поломка правил сразу видна на
 * демо-данных. Настроенная установка предполагается заранее: сидер не заменяет
 * мастер настройки.
 *
 * Повторный запуск безопасен: уже созданные записи находятся по имени и
 * переиспользуются, дубли не появляются.
 *
 * Безопасность:
 *   • в production не запускается;
 *   • пароль администратора берётся из окружения и в вывод не попадает.
 *
 * Переменные окружения: SEED_API_URL (по умолчанию http://127.0.0.1:3000),
 * SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD.
 */

const API_URL = (process.env.SEED_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN_USERNAME = process.env.SEED_ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

const YEAR_TITLE = 'Демонстрационный год';
const GROUP_NAME = 'ДЕМО-21';
const PASSWORD = 'demo-uchenik-2026';

if (process.env.NODE_ENV === 'production') {
  console.error('Отказ: демонстрационные данные не создаются в production.');
  process.exit(1);
}

if (ADMIN_USERNAME === undefined || ADMIN_PASSWORD === undefined) {
  console.error('Нужны SEED_ADMIN_USERNAME и SEED_ADMIN_PASSWORD — логин и пароль администратора.');
  process.exit(1);
}

/** Куки сессии: без библиотек, один заголовок. */
let sessionCookie = '';

async function request(method, path, body) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(sessionCookie === '' ? {} : { cookie: sessionCookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  const session = setCookie.find((value) => value.startsWith('edu_diary_session='));
  if (session !== undefined) sessionCookie = session.split(';')[0];

  const text = await response.text();
  const payload = text === '' ? null : JSON.parse(text);

  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;
    throw new Error(`${method} ${path} → ${response.status}: ${message}`);
  }

  return payload;
}

/** Даты считаются от сегодняшнего дня: демонстрационные данные всегда «живые». */
function shiftDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const counts = {
  students: 0,
  groups: 0,
  subjects: 0,
  rooms: 0,
  assignments: 0,
  links: 0,
  bells: 0,
  entries: 0,
  lessons: 0,
};
const reused = [];

async function findOrCreate(label, find, create) {
  const existing = await find();
  if (existing !== undefined) {
    reused.push(label);
    return existing;
  }
  return create();
}

/** Логины и имена: список для поиска уже созданного. */
async function findUserByUsername(username) {
  const users = await request('GET', `/api/users?search=${encodeURIComponent(username)}&limit=200`);
  return users.items.find((user) => user.username === username);
}

async function main() {
  console.log(`Демонстрационные данные → ${API_URL}`);

  await request('POST', '/api/auth/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  // 1. Учебный год и период.
  const years = await request('GET', '/api/academic-years');
  const year = await findOrCreate(
    'учебный год',
    () => years.items.find((item) => item.title === YEAR_TITLE),
    () =>
      request('POST', '/api/academic-years', {
        title: YEAR_TITLE,
        startsOn: shiftDays(-120),
        endsOn: shiftDays(600),
        isActive: false,
      }),
  );

  const periods = await request('GET', `/api/periods?academicYearId=${year.id}`);
  await findOrCreate(
    'период',
    () => periods.items.find((item) => item.title === 'Первый семестр'),
    () =>
      request('POST', '/api/periods', {
        academicYearId: year.id,
        title: 'Первый семестр',
        kind: 'semester',
        startsOn: shiftDays(-120),
        endsOn: shiftDays(60),
      }),
  );

  // 2. Ученики: карточка и учётная запись одной операцией.
  const studentSeeds = [
    { fullName: 'Демин Артём Сергеевич', username: 'demin-as' },
    { fullName: 'Ковалёва Мария Игоревна', username: 'kovaleva-mi' },
    { fullName: 'Соколов Илья Дмитриевич', username: 'sokolov-id' },
    { fullName: 'Ершова Полина Андреевна', username: 'ershova-pa' },
  ];

  const students = [];
  for (const seed of studentSeeds) {
    const student = await findOrCreate(
      `ученик ${seed.fullName}`,
      async () => {
        const list = await request(
          'GET',
          `/api/students?search=${encodeURIComponent(seed.fullName)}`,
        );
        return list.items.find((item) => item.fullName === seed.fullName);
      },
      async () => {
        const created = await request('POST', '/api/students', {
          fullName: seed.fullName,
          birthDate: shiftDays(-6200),
          account: { username: seed.username, password: PASSWORD },
        });
        counts.students += 1;
        return created;
      },
    );
    students.push(student);
  }

  // 3. Законный представитель и привязка.
  const guardian = await findOrCreate(
    'представитель',
    () => findUserByUsername('demina-ev'),
    async () => {
      const account = await request('POST', '/api/users', {
        username: 'demina-ev',
        fullName: 'Демина Елена Викторовна',
        password: 'demo-roditel-2026',
        roles: ['parent'],
      });
      return account;
    },
  );

  const links = await request('GET', '/api/guardian-links?limit=200');
  const hasLink = links.items.some((link) => link.studentId === students[0].id);
  if (!hasLink) {
    await request('POST', `/api/students/${students[0].id}/guardians`, {
      guardianUserId: guardian.id,
      relation: 'mother',
    });
    counts.links += 1;
  } else {
    reused.push('связь представителя');
  }

  // 4. Группа и зачисление всех четырёх учеников.
  const groups = await request('GET', `/api/groups?search=${encodeURIComponent(GROUP_NAME)}`);
  const group = await findOrCreate(
    'группа',
    () => groups.items.find((item) => item.name === GROUP_NAME),
    async () => {
      const created = await request('POST', '/api/groups', {
        academicYearId: year.id,
        name: GROUP_NAME,
        course: 2,
        specialty: 'Информационные системы',
        startsOn: shiftDays(-120),
        endsOn: shiftDays(600),
      });
      counts.groups += 1;
      return created;
    },
  );

  const composition = await request('GET', `/api/groups/${group.id}/students`);
  for (const student of students) {
    const enrolled = composition.items.some(
      (item) => item.studentName === student.fullName && item.leftOn === null,
    );
    if (enrolled) continue;

    await request('POST', `/api/groups/${group.id}/enrollments`, {
      studentId: student.id,
      joinedOn: shiftDays(-100),
    });
  }

  // 5. Справочники.
  const subjects = [];
  for (const [name, shortName] of [
    ['Основы программирования', 'ОП'],
    ['Базы данных', 'БД'],
  ]) {
    const list = await request('GET', '/api/subjects');
    subjects.push(
      await findOrCreate(
        `предмет ${name}`,
        () => list.items.find((item) => item.name === name),
        async () => {
          const created = await request('POST', '/api/subjects', {
            name,
            shortName,
            kind: 'mandatory',
          });
          counts.subjects += 1;
          return created;
        },
      ),
    );
  }

  const rooms = await request('GET', '/api/rooms');
  const room = await findOrCreate(
    'аудитория',
    () => rooms.items.find((item) => item.name === 'ДЕМО-кабинет 101'),
    async () => {
      const created = await request('POST', '/api/rooms', {
        name: 'ДЕМО-кабинет 101',
        capacity: 24,
        note: 'Демонстрационная аудитория',
      });
      counts.rooms += 1;
      return created;
    },
  );

  // 6. Преподаватель и назначение.
  const teacher = await findOrCreate(
    'преподаватель',
    () => findUserByUsername('prepod-demo'),
    () =>
      request('POST', '/api/users', {
        username: 'prepod-demo',
        fullName: 'Никитин Пётр Олегович',
        password: 'demo-prepod-2026',
        roles: ['teacher'],
      }),
  );

  const assignments = await request('GET', '/api/assignments');
  const hasAssignment = assignments.items.some(
    (item) => item.studyGroupId === group.id && item.subjectId === subjects[0].id,
  );
  if (!hasAssignment) {
    await request('POST', '/api/assignments', {
      teacherUserId: teacher.id,
      subjectId: subjects[0].id,
      studyGroupId: group.id,
      startsOn: shiftDays(-90),
      hoursPlanned: 72,
    });
    counts.assignments += 1;
  } else {
    reused.push('назначение');
  }

  // Идентификатор нужен расписанию: шаблон ссылается на назначение.
  const allAssignments = await request('GET', '/api/assignments');
  const assignment = allAssignments.items.find(
    (item) => item.studyGroupId === group.id && item.subjectId === subjects[0].id,
  );
  if (assignment === undefined) {
    throw new Error('Назначение не найдено: без него расписание не составить');
  }

  // 7. Звонки, занятие в расписании и уроки на ближайший период.
  //
  // Показываем полный путь Этапа 3: справочник задаёт время пары, шаблон ставит
  // занятие в сетку, генерация порождает уроки по датам. Всё идемпотентно:
  // повторный запуск не дублирует ни звонки, ни занятия, ни уроки.
  const bells = await request('GET', '/api/bells');
  const wantsBells = [
    { pairNumber: 1, timeStart: '08:30', timeEnd: '10:00', breakMinutes: 10 },
    { pairNumber: 2, timeStart: '10:10', timeEnd: '11:40', breakMinutes: 10 },
    { pairNumber: 3, timeStart: '12:10', timeEnd: '13:40', breakMinutes: 10 },
  ];
  for (const bell of wantsBells) {
    const existing = bells.items.find((item) => item.pairNumber === bell.pairNumber);
    if (existing === undefined) {
      await request('PUT', '/api/bells', bell);
      counts.bells += 1;
    } else {
      if (!reused.includes('звонки')) reused.push('звонки');
    }
  }

  const entries = await request('GET', `/api/schedule?studyGroupId=${group.id}`);
  const hasEntry = entries.items.some((item) => item.pairNumber === 2 && item.dayOfWeek === 2);
  if (!hasEntry) {
    await request('POST', '/api/schedule', {
      assignmentId: assignment.id,
      roomId: room.id,
      dayOfWeek: 2,
      pairNumber: 2,
      // Время не указываем: сервер берёт его из звонков.
      validFrom: shiftDays(-30),
    });
    counts.entries += 1;
  } else {
    reused.push('занятие в расписании');
  }

  const lessons = await request('GET', `/api/lessons?studyGroupId=${group.id}`);
  if (lessons.items.length === 0) {
    const generated = await request('POST', '/api/lessons/generate', {
      studyGroupId: group.id,
      from: shiftDays(0),
      to: shiftDays(30),
    });
    counts.lessons = generated.created;
  } else {
    reused.push('уроки');
  }

  console.log(
    `Создано: учеников ${counts.students}, групп ${counts.groups}, предметов ${counts.subjects}, ` +
      `аудиторий ${counts.rooms}, назначений ${counts.assignments}, связей ${counts.links}, ` +
      `звонков ${counts.bells}, занятий ${counts.entries}, уроков ${counts.lessons}.`,
  );
  if (reused.length > 0) console.log(`Уже было (переиспользовано): ${reused.join(', ')}.`);
  console.log(`Вход ученика: demin-as / ${PASSWORD}`);
  console.log('Вход преподавателя: prepod-demo / demo-prepod-2026');
  console.log('Вход законного представителя: demina-ev / demo-roditel-2026');
}

main().catch((error) => {
  console.error('Демонстрационные данные не созданы.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
