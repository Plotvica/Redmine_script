# Redmine Dashboards

Локальний конструктор дашбордів для Redmine. Можна створювати кілька дашбордів, стартувати з шаблонів, перемикати View/Edit mode і додавати cards. Дані, період і фільтри налаштовуються на рівні кожної card, а не всього дашборда.

API-ключ зберігається тільки у локальному `.env`. Браузер працює з локальним Node.js сервером, а сервер звертається до Redmine REST API.

## Запуск

```powershell
npm start
```

Потім відкрий:

```text
http://localhost:4173
```

## .env

```env
REDMINE_URL=https://redmine.company.com
REDMINE_API_KEY=your-redmine-api-key
PORT=4173
REDMINE_PAGE_LIMIT=100
REDMINE_METADATA_SAMPLE_LIMIT=100
```

`REDMINE_PAGE_LIMIT` - це розмір однієї сторінки Redmine API, а не загальний ліміт. Застосунок проходить всі сторінки до `total_count`.

`REDMINE_METADATA_SAMPLE_LIMIT` використовується тільки для швидкого fallback-пошуку custom fields із останніх задач, якщо `/custom_fields.json` недоступний.

## Custom fields без admin API

Якщо Redmine повертає `403` на `/custom_fields.json`, скопіюй `redmine-fields.example.json` у `redmine-fields.json` і пропиши потрібні поля вручну:

```json
{
  "customFields": [
    {
      "id": 12,
      "name": "Posbox_Unit",
      "format": "list",
      "isFilter": true,
      "possibleValues": ["Unit A", "Unit B"]
    }
  ]
}
```

Після цього поле буде доступне як фільтр `cf_12` і як card типу `Custom field breakdown`.

## Як тягнуться дані

Сервер читає `.env` і додає до Redmine-запитів заголовок `X-Redmine-API-Key`.

Основний запит задач:

```text
GET /issues.json?status_id=*&sort=updated_on:desc&offset=0&limit=100
```

Далі сервер збільшує `offset`, доки не забере весь `total_count`.

Фільтри задач передаються напряму в Redmine API:

- `project_id`
- `tracker_id` для типу задачі
- `status_id` для статусу
- `assigned_to_id` для виконавця
- `fixed_version_id` для спринта/version
- `updated_on` для обраного періоду
- `cf_x` для custom fields, наприклад `Posbox_Unit` або `Координатор`, якщо вони налаштовані у Redmine як filterable custom fields

Metadata для селектів тягнеться з:

- `/projects.json`
- `/trackers.json`
- `/issue_statuses.json`
- `/enumerations/issue_priorities.json`
- `/users.json`
- `/projects/:project_id/memberships.json` as a fallback for assignee filters
- `/custom_fields.json`
- `/projects/:project_id/versions.json`

`/users.json` і `/custom_fields.json` у Redmine можуть вимагати admin privileges. Якщо API-ключ не має доступу, додаток не падає, але відповідні фільтри будуть недоступні.

## Що вже є

- Dashboard Hub: створення кількох дашбордів і створення з шаблонів
- View/Edit mode
- Add card
- налаштування card title, size, chart type, custom field і власних per-card фільтрів
- JSON persistence у `data/dashboards.json` плюс localStorage fallback
- перемикання між дашбордами
- ClickUp-like period mode на кожній card: останні N днів, власний date range, період спринта/version
- per-card фільтри за проєктом, виконавцем, автором, типом задачі, пріоритетом, статусом, sprint/version і custom fields
- віджети: metrics, bar/pie/donut charts, issue list, table, sprint progress, burndown, burnup, time spent, overdue by assignee, custom field breakdown
- drill-down: клік по сегменту chart відкриває список задач
- overdue list з пагінацією по 10 задач

## Per-card filters

У режимі `Edit` кожна card має власні фільтри project, period, assignee, author, tracker, priority, status, sprint/version і custom fields. Один дашборд може містити cards з різними джерелами і різними фільтрами.

## Чому custom fields можуть не показуватись

У цьому Redmine `/custom_fields.json` може повертати `403 Forbidden`. Тому застосунок має fallback: він інферить custom fields із самих задач, бо `/issues.json` повертає `custom_fields` у кожній задачі. Щоб не гальмувати старт, fallback сканує тільки останні `REDMINE_METADATA_SAMPLE_LIMIT` задач і кешує результат на 10 хвилин. Проєктна metadata також домішує вже знайдені глобальні custom fields, щоб картки не втрачали поля на кшталт `Posbox_Unit`, якщо вони не трапилися у короткій вибірці конкретного проєкту. Щоб пришвидшити або уточнити це, можна:

- задати `REDMINE_METADATA_SAMPLE_LIMIT=1000` у `.env`
- або вручну описати поля в `redmine-fields.json`
- віджети задач за статусом, пріоритетом, виконавцем і віком
- списки прострочених задач і задач без оновлень понад 14 днів
- time entries за користувачем і активністю

## API links

- Redmine REST API: https://www.redmine.org/projects/redmine/wiki/Rest_api
- Issues API: https://www.redmine.org/projects/redmine/wiki/Rest_Issues
- Custom Fields API: https://www.redmine.org/projects/redmine/wiki/Rest_CustomFields
- Users API: https://www.redmine.org/projects/redmine/wiki/Rest_Users
- Versions API: https://www.redmine.org/projects/redmine/wiki/Rest_Versions
- ClickUp Dashboard reference: https://help.clickup.com/hc/en-us/articles/14237901038231-Create-a-Dashboard

## Перевірка

```powershell
npm run check
```
