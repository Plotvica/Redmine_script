const MAX_TABLE_ROWS = 200;

export function buildMarkdownReport({
  dashboard,
  cardData = {},
  context = {},
  projects = [],
  metadataByProject = {},
}) {
  const lines = [];
  const generatedAt = context.generatedAt || newestGeneratedAt(cardData) || new Date().toISOString();

  lines.push(`# ${cleanText(dashboard?.name || "Redmine dashboard")}`);
  lines.push("");
  lines.push(`> Звіт сформовано ${formatDateTime(generatedAt)}. Дані отримані з Redmine.`);
  lines.push("");
  lines.push("| Параметр | Значення |");
  lines.push("| --- | --- |");
  lines.push(`| Проєкт | ${tableText(context.project || "Усі проєкти")} |`);
  lines.push(`| Posbox_Unit | ${tableText(context.unit || "Усі Unit")} |`);
  lines.push(`| Sprint | ${tableText(context.sprint || "Усі sprint")} |`);
  if (context.period) {
    lines.push(`| Період | ${tableText(context.period)} |`);
  }
  lines.push("");

  const warnings = collectWarnings(cardData);
  if (warnings.length) {
    lines.push("## Попередження");
    lines.push("");
    for (const warning of warnings) {
      lines.push(`> ${cleanText(warning)}`);
    }
    lines.push("");
  }

  for (const card of dashboard?.cards || []) {
    const data = cardData[card.id];
    lines.push("---");
    lines.push("");
    lines.push(`## ${cleanText(card.title || card.type || "Картка")}`);
    lines.push("");

    if (!data) {
      lines.push("_Дані для картки не завантажені._");
      lines.push("");
      continue;
    }

    const metadata = metadataForCard(card, data, metadataByProject);
    const scope = describeScope(card, data, metadata, projects);
    if (scope.length) {
      lines.push(`> ${scope.join(" · ")}`);
      lines.push("");
    }

    lines.push(...renderCard(card, data));
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("_Згенеровано Redmine Dashboard Builder._");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function downloadMarkdownReport(markdown, filename) {
  const blob = new Blob([`\uFEFF${markdown}`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function markdownFilename(name, date = new Date()) {
  const safeName = String(name || "redmine-report")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "redmine-report";
  return `${safeName}-${date.toISOString().slice(0, 10)}.md`;
}

function renderCard(card, data) {
  if (card.type === "metrics") {
    return renderMetrics(data.metrics);
  }
  if (card.type === "burndown" || card.type === "burnup") {
    return renderFlow(data.flow, card.type);
  }
  if (card.type === "sprint-progress") {
    return renderSprintProgress(data.metrics);
  }
  if (card.type === "effort-table") {
    return renderEffortTable(data.tables?.issueEffort || []);
  }
  if (card.type === "sprint-movement") {
    return renderMovement(data.movement);
  }
  if (card.type === "sprint-timeline") {
    return renderTimeline(data.timeline || []);
  }
  if (card.type === "overdue" || card.type === "stale" || card.type === "recent-table") {
    const listKey = {
      overdue: "overdueIssues",
      stale: "staleIssues",
      "recent-table": "recentlyUpdated",
    }[card.type];
    return renderIssueTable(data.lists?.[listKey] || []);
  }
  if (card.type === "custom-field") {
    const fieldKey = card.settings?.customFieldKey || Object.keys(data.customFields || {})[0];
    const field = data.customFields?.[fieldKey];
    return field
      ? renderSeries(field.series || [])
      : ["_Custom field для картки не вибрано._"];
  }

  const seriesKey = {
    status: "byStatus",
    assignees: "byAssignee",
    priority: "byPriority",
    tracker: "byTracker",
    authors: "byAuthor",
    versions: "byVersion",
    aging: "aging",
    "overdue-by-assignee": "overdueByAssignee",
    "time-user": "timeByUser",
    "pos-worklog-user": "posWorklogByUser",
    "time-activity": "timeByActivity",
    "time-project": "timeByProject",
  }[card.type];

  return seriesKey
    ? renderSeries(data.charts?.[seriesKey] || [], isTimeCard(card.type) ? "h" : "")
    : ["_Цей тип картки поки не має Markdown-представлення._"];
}

function renderMetrics(metrics = {}) {
  return markdownTable(
    ["Метрика", "Значення"],
    [
      ["Усього задач", metrics.totalIssues],
      ["Відкриті", metrics.openIssues],
      ["Готові", metrics.closedIssues],
      ["Прострочені", metrics.overdueIssues],
      ["Без руху", metrics.staleIssues],
      ["Затрекано", `${formatNumber(metrics.loggedHours)}h`],
      ["POS_Worklog", `${formatNumber(metrics.posWorklogHours)}h`],
    ],
  );
}

function renderSprintProgress(metrics = {}) {
  const total = Number(metrics.totalIssues || 0);
  const done = Number(metrics.closedIssues || 0);
  const percent = total ? Math.round((done / total) * 100) : 0;
  return [
    `**${percent}% завершено**`,
    "",
    progressBar(percent),
    "",
    ...markdownTable(
      ["Усього", "Готово", "Залишилось"],
      [[total, done, Math.max(total - done, 0)]],
    ),
  ];
}

function renderFlow(flow = {}, type) {
  const summary = flow.summary || {};
  const series = flow[type] || [];
  const lines = [
    ...markdownTable(
      ["Усього", "Готово", "Залишилось"],
      [[summary.total || 0, summary.completed || 0, summary.remaining || 0]],
    ),
    "",
  ];

  if (!series.length) {
    return [...lines, "_Немає даних за період._"];
  }

  const idealByDate = new Map((flow.idealBurndown || []).map((item) => [item.label, item.value]));
  const headers = type === "burndown"
    ? ["Дата", "Залишилось", "Готово", "Ідеальний залишок"]
    : ["Дата", "Готово", "Залишилось", "Усього"];
  const rows = series.map((item) => (
    type === "burndown"
      ? [item.label, item.value, item.completed ?? Math.max(Number(item.total || 0) - Number(item.value || 0), 0), idealByDate.get(item.label) ?? ""]
      : [item.label, item.value, item.remaining ?? Math.max(Number(item.total || 0) - Number(item.value || 0), 0), item.total || summary.total || 0]
  ));

  return [...lines, ...markdownTable(headers, rows)];
}

function renderSeries(series, suffix = "") {
  if (!series.length) {
    return ["_Немає даних._"];
  }

  const total = series.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const rows = series.map((item) => {
    const value = Number(item.value || 0);
    const percent = total ? Math.round((value / total) * 100) : 0;
    return suffix
      ? [item.label, `${formatNumber(value)}${suffix}`, progressBar(total ? (value / total) * 100 : 0)]
      : [item.label, formatNumber(value), `${percent}%`, progressBar(percent)];
  });

  return markdownTable(
    suffix ? ["Категорія", "Значення", "Співвідношення"] : ["Категорія", "Кількість", "Частка", "Співвідношення"],
    rows,
  );
}

function renderIssueTable(issues) {
  if (!issues.length) {
    return ["_Задач не знайдено._"];
  }

  const rows = issues.slice(0, MAX_TABLE_ROWS).map((issue) => [
    issueLink(issue),
    issue.tracker || "",
    issue.status || "",
    issue.priority || "",
    issue.assignee || "Не призначено",
    issue.dueDate || issue.updatedOn || "",
  ]);
  return withRowLimitNote(
    markdownTable(["Задача", "Тип", "Статус", "Пріоритет", "Виконавець", "Дата"], rows),
    issues.length,
  );
}

function renderEffortTable(rows) {
  if (!rows.length) {
    return ["_Немає даних про оцінку та витрачений час._"];
  }

  const tableRows = rows.slice(0, MAX_TABLE_ROWS).map((issue) => [
    issueLink(issue),
    issue.tracker || "",
    issue.status || "",
    issue.priority || "",
    issue.assignee || "Не призначено",
    `${formatNumber(issue.estimatedHours)}h`,
    `${formatNumber(issue.spentHours)}h`,
    `${formatNumber(issue.remainingHours)}h`,
  ]);
  return withRowLimitNote(
    markdownTable(
      ["Задача", "Тип", "Статус", "Пріоритет", "Виконавець", "Оцінка", "Витрачено", "Залишок"],
      tableRows,
    ),
    rows.length,
  );
}

function renderMovement(movement = {}) {
  const added = movement.addedIssues || [];
  const removed = movement.removedIssues || [];
  return [
    ...markdownTable(["Додано", "Вилучено"], [[added.length, removed.length]]),
    "",
    "### Додані задачі",
    "",
    ...renderCompactIssueList(added),
    "",
    "### Вилучені задачі",
    "",
    ...renderCompactIssueList(removed),
  ];
}

function renderTimeline(days) {
  if (!days.length) {
    return ["_Подій за вибраний період немає._"];
  }

  const rows = [];
  for (const day of days) {
    appendTimelineRows(rows, day.date, "Створено", day.created);
    appendTimelineRows(rows, day.date, "Готово", day.completed);
    appendTimelineRows(rows, day.date, "Оновлено", day.updated);
  }
  return markdownTable(["Дата", "Подія", "Задачі"], rows.slice(0, MAX_TABLE_ROWS));
}

function appendTimelineRows(rows, date, event, issues = []) {
  if (!issues.length) {
    return;
  }
  rows.push([date, `${event} (${issues.length})`, issues.map(issueLink).join("<br>")]);
}

function renderCompactIssueList(issues) {
  if (!issues.length) {
    return ["_Немає задач._"];
  }
  return issues.slice(0, MAX_TABLE_ROWS).map((issue) => `- ${issueLink(issue)} — ${cleanText(issue.status || "")}`);
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.map(tableText).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(tableText).join(" | ")} |`),
  ];
}

function withRowLimitNote(lines, total) {
  if (total <= MAX_TABLE_ROWS) {
    return lines;
  }
  return [...lines, "", `_Показано ${MAX_TABLE_ROWS} із ${total} записів._`];
}

function describeScope(card, data, metadata, projects) {
  const filters = data.filters || {};
  const period = filters.period || {};
  const parts = [];
  const projectId = String(filters.projectId || card.scope?.projectId || "");
  const projectName = optionName(projects, projectId);
  if (projectName) {
    parts.push(`Проєкт: **${cleanText(projectName)}**`);
  }

  if (period.from && period.to) {
    parts.push(`Період: **${period.from} — ${period.to}**`);
  }

  const sprintId = String(card.scope?.period?.sprintId || filters.sprintId || "");
  const sprintName = optionName(metadata.sprints, sprintId) || filters.sprintName;
  if (sprintName) {
    parts.push(`Sprint: **${cleanText(sprintName)}**`);
  }

  const trackerIds = normalizeIds(filters.trackerIds?.length ? filters.trackerIds : filters.trackerId);
  const trackers = trackerIds.map((id) => optionName(metadata.trackers, id)).filter(Boolean);
  if (trackers.length) {
    parts.push(`Типи: **${trackers.map(cleanText).join(", ")}**`);
  }

  const statusName = optionName(metadata.statuses, filters.statusId);
  if (statusName) {
    parts.push(`Статус: **${cleanText(statusName)}**`);
  }

  for (const [key, value] of Object.entries(filters.customFields || {})) {
    const field = (metadata.customFields || []).find((item) => item.key === key || String(item.id) === key.replace(/^cf_/, ""));
    parts.push(`${cleanText(field?.name || key)}: **${cleanText(value)}**`);
  }

  return parts;
}

function metadataForCard(card, data, metadataByProject) {
  const projectId = String(data?.filters?.projectId || card.scope?.projectId || "");
  return metadataByProject[projectId] || metadataByProject[""] || {};
}

function optionName(items = [], id) {
  const value = String(id || "");
  if (!value || value === "*" || value === "open") {
    return value === "open" ? "Відкриті" : "";
  }
  const item = items.find((entry) => String(entry.id ?? entry.value) === value);
  return item?.name || item?.label || "";
}

function normalizeIds(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return items.map((item) => String(item).trim()).filter(Boolean);
}

function collectWarnings(cardData) {
  const warnings = [];
  for (const data of Object.values(cardData || {})) {
    if (data?.warnings?.timeEntries) {
      warnings.push(`Time entries недоступні: ${data.warnings.timeEntries}`);
    }
    if (data?.warnings?.movement) {
      warnings.push(`Sprint movement: ${data.warnings.movement}`);
    }
  }
  return [...new Set(warnings)];
}

function newestGeneratedAt(cardData) {
  return Object.values(cardData || {})
    .map((data) => data?.generatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
}

function issueLink(issue) {
  const label = `#${issue.id} ${cleanText(issue.subject || "")}`.trim();
  return issue.url ? `[${escapeLinkLabel(label)}](${encodeURI(issue.url)})` : label;
}

function progressBar(percent) {
  const normalized = Math.max(0, Math.min(100, Number(percent || 0)));
  const filled = Math.round(normalized / 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function isTimeCard(type) {
  return ["time-user", "pos-worklog-user", "time-activity", "time-project"].includes(type);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return cleanText(value);
  }
  return new Intl.DateTimeFormat("uk-UA", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 }).format(Number(value || 0));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function tableText(value) {
  return cleanText(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>");
}

function escapeLinkLabel(value) {
  return cleanText(value).replace(/[[\]]/g, "\\$&");
}
