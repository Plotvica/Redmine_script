import { getCardType } from "../widget-catalog.js";
import { formatDateTime, formatNumber } from "../utils/format.js";
import { renderBarChart, renderFlowChart } from "./charts.js";
import { renderIssueList } from "./issues.js";
import { emptyState, errorState } from "./states.js";
import { renderIssueTable } from "./table.js";

const issueTrackerState = new Map();
const effortSortState = new Map();
const effortFilterState = new Map();

export function renderLoading(elements, title = "Дашборд") {
  elements.dashboardTitle.textContent = title;
  elements.generatedAt.textContent = "Завантажую...";
  elements.warnings.hidden = true;
  elements.metricsGrid.hidden = true;
  elements.widgetsGrid.replaceChildren(emptyState("Завантажую дашборд..."));
}

export function renderSetupError(elements, message) {
  elements.generatedAt.textContent = "Не завантажено";
  elements.warnings.hidden = false;
  elements.warnings.textContent = message || "Перевір налаштування Redmine.";
  elements.metricsGrid.hidden = true;
  elements.widgetsGrid.replaceChildren(errorState(message || "Не вдалося завантажити дашборд."));
}

export function renderDashboardData(elements, dashboardConfig, data, options = {}) {
  elements.dashboardTitle.textContent = dashboardConfig.name;
  elements.generatedAt.textContent = data?.generatedAt ? `Оновлено ${formatDateTime(data.generatedAt)}` : "Додай card";
  elements.metricsGrid.hidden = true;

  renderWarnings(elements.warnings, collectWarnings(options.cardData, data));
  renderCards(elements.widgetsGrid, dashboardConfig, data, options);
}

function renderCards(container, dashboardConfig, data, options) {
  container.replaceChildren();

  for (const card of dashboardConfig.cards) {
    const definition = getCardType(card.type);
    if (!definition) {
      continue;
    }

    const panel = document.createElement("article");
    panel.className = `panel ${card.size || definition.defaultSize}`;
    panel.dataset.cardId = card.id;
    if (options.mode === "edit") {
      panel.classList.add("editing");
    }

    panel.append(panelHeading(card.title || definition.title, definition.subtitle, options.mode));

    const body = document.createElement("div");
    body.className = bodyClass(definition.kind);
    panel.append(body);

    const cardData = options.cardData?.[card.id] || data;
    if (!cardData) {
      body.append(emptyState("Налаштуй фільтри card і натисни Refresh."));
    } else {
      renderCardBody(body, card, definition, cardData);
    }
    container.append(panel);
  }

  if (!container.children.length) {
    container.append(emptyState("Додай першу card у режимі Edit."));
  }
}

function renderCardBody(container, card, definition, data) {
  if (definition.kind === "metrics") {
    renderMetrics(container, data.metrics);
    return;
  }

  if (definition.kind === "issues") {
    renderIssueListWithTrackerFilter(container, data.lists[definition.listKey], definition.emptyText, {
      pageSize: definition.pageSize,
      stateKey: `${card.id}:${definition.listKey}`,
    });
    return;
  }

  if (definition.kind === "effort-table") {
    renderIssueEffortTable(container, data.tables?.issueEffort || [], card.id);
    return;
  }

  if (definition.kind === "movement") {
    renderSprintMovement(container, data.movement);
    return;
  }

  if (definition.kind === "timeline") {
    renderTimeline(container, data.timeline || []);
    return;
  }

  if (definition.kind === "table") {
    renderIssueTable(container, data.lists[definition.listKey], definition.emptyText);
    return;
  }

  if (definition.kind === "sprint-progress") {
    renderSprintProgress(container, data.metrics);
    return;
  }

  if (definition.kind === "flow") {
    renderFlowChart(container, data.flow?.[definition.flowKey] || [], {
      xLabel: "Дні",
      yLabel: "Кількість задач",
      summary: data.flow?.summary,
      idealSeries: definition.flowKey === "burndown" ? data.flow?.idealBurndown : [],
      onSummarySelect: (key) => openDrilldown({
        title: `${card.title}: ${flowSummaryLabel(key)}`,
        issues: flowSummaryIssues(data, key),
      }),
      onSelect: (item) => openDrilldown({
        title: `${card.title}: ${item.label}`,
        issues: flowPointIssues(data.lists.allIssues, definition.flowKey, item),
      }),
    });
    return;
  }

  if (definition.kind === "custom-field-chart") {
    const fieldKey = card.settings.customFieldKey || Object.keys(data.customFields || {})[0];
    const field = data.customFields?.[fieldKey];
    if (!field) {
      container.append(emptyState("Обери custom field у налаштуваннях card."));
      return;
    }
    renderBarChart(container, field.series, {
      chartType: card.chartType,
      onSelect: (item) => openDrilldown({
        title: `${field.name}: ${item.label}`,
        issues: filterIssues(data.lists.allIssues, "customField", item.label, { customFieldKey: fieldKey }),
      }),
    });
    return;
  }

  const series = data.charts[definition.seriesKey] || [];
  const timeDetailsKey = definition.timeDetailsKey || (definition.seriesKey === "timeByUser" ? "byUser" : "");
  renderBarChart(container, series, {
    suffix: definition.suffix || "",
    chartType: card.chartType,
    onSelect: timeDetailsKey
      ? (item) => openTimeDrilldown(data.timeDetails?.[timeDetailsKey]?.[item.label])
      : definition.drilldownField
      ? (item) => openDrilldown({
          title: `${card.title}: ${item.label}`,
          issues: filterIssues(data.lists[definition.drilldownList || "allIssues"], definition.drilldownField, item.label),
        })
      : null,
  });
}

function renderMetrics(container, metrics) {
  container.classList.add("metric-strip");
  container.append(
    metricCard("Усього задач", formatNumber(metrics.totalIssues)),
    metricCard("Відкриті", formatNumber(metrics.openIssues)),
    metricCard("Done", formatNumber(metrics.closedIssues)),
    metricCard("Прострочені", formatNumber(metrics.overdueIssues), "danger"),
    metricCard("Години", formatNumber(metrics.loggedHours)),
  );
}

function renderSprintProgress(container, metrics) {
  const total = Math.max(metrics.totalIssues, 1);
  const donePercent = Math.round((metrics.closedIssues / total) * 100);
  container.classList.add("sprint-progress");
  container.innerHTML = `
    <div class="progress-number">${donePercent}%</div>
    <div class="progress-track"><div style="width: ${donePercent}%"></div></div>
    <div class="progress-meta">
      <span>${formatNumber(metrics.closedIssues)} done</span>
      <span>${formatNumber(metrics.openIssues)} open</span>
    </div>
  `;
}

function renderIssueEffortTable(container, rows, cardId) {
  container.replaceChildren();

  if (!rows.length) {
    container.append(emptyState("Немає задач для effort-таблиці."));
    return;
  }

  const sortKey = effortSortState.get(cardId) || "spent_desc";
  const filters = normalizeEffortFilters(effortFilterState.get(cardId));
  const filteredRows = filterEffortRows(rows, filters);
  const toolbar = document.createElement("div");
  toolbar.className = "table-toolbar";

  toolbar.append(
    effortMultiSelect("Типи", uniqueValues(rows, "tracker"), filters.trackers, (values) => {
      effortFilterState.set(cardId, { ...filters, trackers: values });
      renderIssueEffortTable(container, rows, cardId);
    }),
    effortMultiSelect("Статуси", uniqueValues(rows, "status"), filters.statuses, (values) => {
      effortFilterState.set(cardId, { ...filters, statuses: values });
      renderIssueEffortTable(container, rows, cardId);
    }),
    effortMultiSelect("Пріоритети", uniqueValues(rows, "priority"), filters.priorities, (values) => {
      effortFilterState.set(cardId, { ...filters, priorities: values });
      renderIssueEffortTable(container, rows, cardId);
    }),
    effortMultiSelect("Виконавці", uniqueValues(rows, "assignee"), filters.assignees, (values) => {
      effortFilterState.set(cardId, { ...filters, assignees: values });
      renderIssueEffortTable(container, rows, cardId);
    }),
  );

  const label = document.createElement("label");
  label.textContent = "Сортування";
  const select = document.createElement("select");
  select.append(
    new Option("Витрачено: спадання", "spent_desc"),
    new Option("Тип задачі", "tracker"),
    new Option("Виконавець", "assignee"),
    new Option("Статус", "status"),
    new Option("Пріоритет", "priority"),
  );
  select.value = sortKey;
  select.addEventListener("change", () => {
    effortSortState.set(cardId, select.value);
    renderIssueEffortTable(container, rows, cardId);
  });
  label.append(select);
  toolbar.append(label);

  const count = document.createElement("span");
  count.className = "table-count";
  count.textContent = `${formatNumber(filteredRows.length)} з ${formatNumber(rows.length)}`;
  toolbar.append(count);

  const table = document.createElement("table");
  table.className = "issue-table effort-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Задача</th>
        <th>Тип</th>
        <th>Статус</th>
        <th>Пріоритет</th>
        <th>Виконавець</th>
        <th>Оцінка</th>
        <th>Витрачено</th>
        <th>Залишок</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  for (const issue of sortEffortRows(filteredRows, sortKey).slice(0, 80)) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="${issue.url}" target="_blank" rel="noreferrer">#${issue.id}</a></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
      <td>${formatNumber(issue.estimatedHours)}h</td>
      <td>${formatNumber(issue.spentHours)}h</td>
      <td>${formatNumber(issue.remainingHours)}h</td>
    `;
    row.children[1].textContent = issue.subject;
    row.children[2].textContent = issue.tracker || "Без типу";
    row.children[3].textContent = issue.status || "Без статусу";
    row.children[4].textContent = issue.priority || "Без пріоритету";
    row.children[5].textContent = issue.assignee || "Не призначено";
    body.append(row);
  }

  container.append(toolbar, table);
}

function effortMultiSelect(label, values, selectedValues, onChange) {
  const selected = new Set(selectedValues || []);
  const details = document.createElement("details");
  details.className = "multi-filter";

  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.textContent = label;
  const counter = document.createElement("b");
  counter.textContent = selected.size ? String(selected.size) : "Усі";
  summary.append(title, counter);

  const menu = document.createElement("div");
  menu.className = "multi-filter-menu";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Усі";
  clear.addEventListener("click", () => onChange([]));
  menu.append(clear);

  for (const value of values) {
    const row = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selected.has(value);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selected.add(value);
      } else {
        selected.delete(value);
      }
      onChange([...selected]);
    });
    const text = document.createElement("span");
    text.textContent = value;
    row.append(checkbox, text);
    menu.append(row);
  }

  details.append(summary, menu);
  return details;
}

function normalizeEffortFilters(filters = {}) {
  return {
    trackers: Array.isArray(filters.trackers) ? filters.trackers : [],
    statuses: Array.isArray(filters.statuses) ? filters.statuses : [],
    priorities: Array.isArray(filters.priorities) ? filters.priorities : [],
    assignees: Array.isArray(filters.assignees) ? filters.assignees : [],
  };
}

function filterEffortRows(rows, filters) {
  return rows.filter((row) => (
    matchesSelected(row.tracker, filters.trackers)
    && matchesSelected(row.status, filters.statuses)
    && matchesSelected(row.priority, filters.priorities)
    && matchesSelected(row.assignee, filters.assignees)
  ));
}

function matchesSelected(value, selected) {
  return !selected.length || selected.includes(String(value || ""));
}

function uniqueValues(rows, key) {
  return [...new Set(rows.map((row) => String(row[key] || "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function sortEffortRows(rows, sortKey) {
  const sorted = [...rows];
  if (sortKey === "tracker") {
    return sorted.sort((a, b) => compareText(a.tracker, b.tracker) || compareText(a.status, b.status) || b.spentHours - a.spentHours);
  }
  if (sortKey === "assignee") {
    return sorted.sort((a, b) => compareText(a.assignee, b.assignee) || compareText(a.tracker, b.tracker) || b.spentHours - a.spentHours);
  }
  if (sortKey === "status") {
    return sorted.sort((a, b) => compareText(a.status, b.status) || compareText(a.tracker, b.tracker) || b.spentHours - a.spentHours);
  }
  if (sortKey === "priority") {
    return sorted.sort((a, b) => compareText(a.priority, b.priority) || compareText(a.status, b.status) || b.spentHours - a.spentHours);
  }
  return sorted.sort((a, b) => b.spentHours - a.spentHours || b.estimatedHours - a.estimatedHours || a.id - b.id);
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function renderSprintMovement(container, movement = {}) {
  container.replaceChildren();

  const added = movement.addedIssues || [];
  const removed = movement.removedIssues || [];
  container.classList.add("movement-card");

  const summary = document.createElement("div");
  summary.className = "movement-summary";
  summary.append(metricCard("Додано", formatNumber(added.length)), metricCard("Вилучено", formatNumber(removed.length), removed.length ? "danger" : ""));

  const lists = document.createElement("div");
  lists.className = "movement-lists";
  lists.append(movementList("Додано", added), movementList("Вилучено", removed));

  container.append(summary, lists);
}

function movementList(title, issues) {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading);

  if (!issues.length) {
    section.append(emptyState("Немає задач."));
    return section;
  }

  const list = document.createElement("div");
  list.className = "compact-issue-list";
  for (const issue of issues.slice(0, 10)) {
    const link = document.createElement("a");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${issue.id} ${issue.subject}`;
    list.append(link);
  }
  section.append(list);
  return section;
}

function renderTimeline(container, days = []) {
  container.replaceChildren();
  container.classList.add("timeline-card");

  if (!days.length) {
    container.append(emptyState("Немає подій у вибраному періоді."));
    return;
  }

  const list = document.createElement("div");
  list.className = "timeline-list";

  for (const day of days.slice(0, 20)) {
    const item = document.createElement("section");
    item.className = "timeline-day";

    const marker = document.createElement("div");
    marker.className = "timeline-marker";

    const content = document.createElement("div");
    content.className = "timeline-content";

    const heading = document.createElement("div");
    heading.className = "timeline-heading";
    const date = document.createElement("strong");
    date.textContent = day.date;
    const total = document.createElement("span");
    total.textContent = `${formatNumber(day.total)} подій`;
    heading.append(date, total);

    const groups = document.createElement("div");
    groups.className = "timeline-groups";
    groups.append(
      timelineGroup("Створено", day.created, "created", day.date),
      timelineGroup("Готово", day.completed, "completed", day.date),
      timelineGroup("Оновлено", day.updated, "updated", day.date),
    );

    content.append(heading, groups);
    item.append(marker, content);
    list.append(item);
  }

  container.append(list);
}

function timelineGroup(label, issues = [], tone, date) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `timeline-group ${tone}`;
  button.disabled = !issues.length;
  button.addEventListener("click", () => openDrilldown({ title: `${date}: ${label}`, issues }));

  const title = document.createElement("span");
  title.textContent = label;
  const value = document.createElement("strong");
  value.textContent = formatNumber(issues.length);
  button.append(title, value);

  return button;
}

function collectWarnings(cardData, fallbackData) {
  const warnings = [];
  const datasets = Object.values(cardData || {});

  if (fallbackData) {
    datasets.push(fallbackData);
  }

  for (const data of datasets) {
    if (data?.warnings?.timeEntries) {
      warnings.push(`Time entries недоступні: ${data.warnings.timeEntries}`);
    }
    if (data?.warnings?.movement) {
      warnings.push(`Sprint movement: ${data.warnings.movement}`);
    }
  }

  return [...new Set(warnings)];
}

function renderIssueListWithTrackerFilter(container, issues, emptyText, options) {
  container.replaceChildren();

  const trackers = [...new Set((issues || []).map((issue) => issue.tracker).filter(Boolean))].sort();
  const stateKey = `tracker:${options.stateKey}`;
  const activeTracker = issueTrackerState.get(stateKey) || "";

  if (trackers.length > 1) {
    const tabs = document.createElement("div");
    tabs.className = "inline-tabs";
    tabs.append(trackerTab("Усі", "", activeTracker, stateKey, () => renderIssueListWithTrackerFilter(container, issues, emptyText, options)));
    for (const tracker of trackers) {
      tabs.append(trackerTab(tracker, tracker, activeTracker, stateKey, () => renderIssueListWithTrackerFilter(container, issues, emptyText, options)));
    }
    container.append(tabs);
  }

  const list = document.createElement("div");
  list.className = "issue-list";
  const filteredIssues = activeTracker
    ? (issues || []).filter((issue) => issue.tracker === activeTracker)
    : issues;

  renderIssueList(list, filteredIssues, emptyText, options);
  container.append(list);
}

function trackerTab(label, value, activeValue, stateKey, rerender) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = value === activeValue ? "active" : "";
  button.textContent = label;
  button.addEventListener("click", () => {
    issueTrackerState.set(stateKey, value);
    rerender();
  });
  return button;
}

function renderWarnings(container, warningMessages) {
  const messages = warningMessages || [];

  container.hidden = !messages.length;
  container.textContent = messages.join(" ");
}

function filterIssues(issues, field, value, options = {}) {
  if (!Array.isArray(issues)) {
    return [];
  }

  if (field === "customField") {
    return issues.filter((issue) => (issue.customFields?.[options.customFieldKey]?.value || "Без значення") === value);
  }

  if (field === "ageBucket") {
    return issues;
  }

  return issues.filter((issue) => (issue[field] || `Без ${field}`) === value);
}

function flowPointIssues(issues, flowKey, item) {
  const issuesById = issuesByIdMap(issues);
  if (Array.isArray(item.issueIds)) {
    return item.issueIds.map((id) => issuesById.get(Number(id))).filter(Boolean);
  }

  const pointDate = new Date(item.label);
  if (Number.isNaN(pointDate.getTime())) {
    return [];
  }

  if (flowKey === "burnup") {
    return issues.filter((issue) => {
      const doneOn = issueCompletionDate(issue);
      return doneOn.getTime() > 0 && doneOn < startOfDay(pointDate);
    });
  }

  return issues.filter((issue) => {
    const doneOn = issueCompletionDate(issue);
    return doneOn.getTime() <= 0 || doneOn >= startOfDay(pointDate);
  });
}

function flowSummaryIssues(data, key) {
  const issues = data.lists?.allIssues || [];
  const summary = data.flow?.summary || {};
  const issuesById = issuesByIdMap(issues);

  if (key === "completed" && Array.isArray(summary.completedIssueIds)) {
    return summary.completedIssueIds.map((id) => issuesById.get(Number(id))).filter(Boolean);
  }

  if (key === "remaining" && Array.isArray(summary.remainingIssueIds)) {
    return summary.remainingIssueIds.map((id) => issuesById.get(Number(id))).filter(Boolean);
  }

  if (key === "total" && Array.isArray(summary.totalIssueIds)) {
    return summary.totalIssueIds.map((id) => issuesById.get(Number(id))).filter(Boolean);
  }

  const endDate = data.flow?.summary?.endDate || data.flow?.burndown?.at(-1)?.label;
  const periodEnd = endOfDay(new Date(endDate));

  if (key === "completed") {
    return issues.filter((issue) => {
      const doneOn = issueCompletionDate(issue);
      return doneOn.getTime() > 0 && doneOn <= periodEnd;
    });
  }

  if (key === "remaining") {
    return issues.filter((issue) => {
      const doneOn = issueCompletionDate(issue);
      return doneOn.getTime() <= 0 || doneOn > periodEnd;
    });
  }

  return issues;
}

function issuesByIdMap(issues) {
  return new Map((issues || []).map((issue) => [Number(issue.id), issue]));
}

function flowSummaryLabel(key) {
  return {
    total: "Усього",
    completed: "Готово",
    remaining: "Залишилось",
  }[key] || "Задачі";
}

function issueCompletionDate(issue) {
  if (!isIssueDone(issue)) {
    return new Date(0);
  }

  if (issue.closedOn) {
    return new Date(issue.closedOn);
  }
  return new Date(issue.updatedOn || 0);
}

function startOfDay(date) {
  const next = new Date(date);
  next.setUTCHours(0, 0, 0, 0);
  return next;
}

function isIssueDone(issue) {
  return ["done", "for deploy"].includes(String(issue.status || "").trim().toLowerCase());
}

function endOfDay(date) {
  const next = new Date(date);
  next.setUTCHours(23, 59, 59, 999);
  return next;
}

function openDrilldown({ title, issues }) {
  const existing = document.querySelector(".drilldown-backdrop");
  existing?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "drilldown-backdrop";

  const modal = document.createElement("section");
  modal.className = "drilldown-modal";

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${issues.length})`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => backdrop.remove());
  header.append(heading, close);

  const list = document.createElement("div");
  list.className = "issue-list";
  renderIssueList(list, issues, "Задач не знайдено.", { pageSize: 10, stateKey: `drilldown:${title}` });

  modal.append(header, list);
  backdrop.append(modal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });
  document.body.append(backdrop);
}

function openTimeDrilldown(details) {
  if (!details) {
    return;
  }

  const existing = document.querySelector(".drilldown-backdrop");
  existing?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "drilldown-backdrop";

  const modal = document.createElement("section");
  modal.className = "drilldown-modal";

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = `${details.user}: ${formatNumber(details.totalHours)}h`;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => backdrop.remove());
  header.append(heading, close);

  const table = document.createElement("table");
  table.className = "issue-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>Дата</th>
        <th>Задача</th>
        <th>Активність</th>
        <th>Години</th>
        <th>Коментар</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  for (const entry of details.entries || []) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${entry.spentOn || ""}</td>
      <td></td>
      <td></td>
      <td>${formatNumber(entry.hours)}h</td>
      <td></td>
    `;
    const issueCell = row.children[1];
    if (entry.issueUrl) {
      const link = document.createElement("a");
      link.href = entry.issueUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = entry.issueSubject ? `${entry.issue} ${entry.issueSubject}` : entry.issue;
      issueCell.append(link);
    } else {
      issueCell.textContent = entry.issueSubject ? `${entry.issue} ${entry.issueSubject}` : entry.issue;
    }
    row.children[2].textContent = entry.activity || "";
    row.children[4].textContent = entry.comments || "";
    body.append(row);
  }

  modal.append(header, table);
  backdrop.append(modal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });
  document.body.append(backdrop);
}

function metricCard(label, value, tone = "") {
  const card = document.createElement("article");
  card.className = tone ? `metric ${tone}` : "metric";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  card.append(labelNode, valueNode);
  return card;
}

function panelHeading(title, subtitle, mode) {
  const heading = document.createElement("div");
  heading.className = "panel-heading";

  const titleNode = document.createElement("h3");
  titleNode.textContent = title;

  const subtitleNode = document.createElement("span");
  subtitleNode.textContent = mode === "edit" ? "Edit mode" : subtitle || "";

  heading.append(titleNode, subtitleNode);
  return heading;
}

function bodyClass(kind) {
  if (kind === "issues") {
    return "issue-list";
  }
  if (kind === "metrics") {
    return "metric-strip";
  }
  if (kind === "table" || kind === "effort-table") {
    return "table-wrap";
  }
  if (kind === "movement") {
    return "movement-card";
  }
  if (kind === "timeline") {
    return "timeline-card";
  }
  return "bar-chart";
}
