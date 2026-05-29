import { CARD_TYPES } from "../widget-catalog.js";

export function renderDashboardTabs(container, dashboards, currentDashboardId) {
  container.replaceChildren();

  for (const dashboard of dashboards) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = dashboard.id === currentDashboardId ? "dashboard-tab active" : "dashboard-tab";
    button.dataset.dashboardId = dashboard.id;
    button.textContent = dashboard.name;
    container.append(button);
  }
}

export function renderTemplateList(container, templates) {
  container.replaceChildren();

  for (const template of templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-button";
    button.dataset.templateId = template.id;
    button.textContent = template.name;
    container.append(button);
  }
}

export function renderCardTypeSelect(select) {
  select.replaceChildren();

  for (const card of CARD_TYPES) {
    select.append(new Option(card.title, card.id));
  }
}

export function renderCardEditorList(container, dashboard, metadata, getCardMetadata = () => metadata) {
  container.replaceChildren();

  for (const card of dashboard.cards) {
    const definition = CARD_TYPES.find((item) => item.id === card.type);
    if (!definition) {
      continue;
    }
    const cardMetadata = getCardMetadata(card) || metadata;

    const item = document.createElement("article");
    item.className = "card-editor";
    item.dataset.cardId = card.id;

    const title = document.createElement("input");
    title.value = card.title;
    title.maxLength = 80;
    title.dataset.cardAction = "title";

    const row = document.createElement("div");
    row.className = "card-editor-row";

    const size = document.createElement("select");
    size.dataset.cardAction = "size";
    size.append(new Option("Small", "small"), new Option("Medium", "medium"), new Option("Wide", "wide"));
    size.value = card.size;

    const chartType = document.createElement("select");
    chartType.dataset.cardAction = "chartType";
    chartType.append(new Option("Bar", "bar"), new Option("Pie", "pie"), new Option("Donut", "donut"));
    chartType.value = card.chartType;
    chartType.hidden = !["chart", "custom-field-chart"].includes(definition.kind);

    row.append(size, chartType);
    item.append(title, row);

    if (definition.kind === "custom-field-chart") {
      item.append(customFieldSelect(card, cardMetadata.customFields));
    }

    item.append(cardScopeEditor(card, cardMetadata, definition));

    const actions = document.createElement("div");
    actions.className = "card-actions";
    actions.append(
      editorButton("↑", "up", "Підняти"),
      editorButton("↓", "down", "Опустити"),
      editorButton("Видалити", "delete", "Видалити картку"),
    );
    item.append(actions);
    container.append(item);
  }
}

function cardScopeEditor(card, metadata, definition) {
  const wrapper = document.createElement("div");
  wrapper.className = "card-scope";

  const grid = document.createElement("div");
  grid.className = "card-filter-grid";

  grid.append(
    scopedSelect("Проєкт", "scope.projectId", metadata.projects || [], "Усі проєкти", card.scope.projectId),
    scopedPeriod(card, isTimeCard(definition) ? "Період часу" : "Період"),
    scopedSelect("Людина", "scope.filters.assigneeId", metadata.users || [], "Усі виконавці", card.scope.filters.assigneeId),
    scopedMultiSelect("Люди для часу", "scope.filters.timeUserIds", metadata.users || [], card.scope.filters.timeUserIds || []),
    scopedSelect("Автор", "scope.filters.authorId", metadata.users || [], "Усі автори", card.scope.filters.authorId),
    scopedMultiSelect("Типи задач", "scope.filters.trackerIds", metadata.trackers || [], selectedIds(card.scope.filters, "trackerIds", "trackerId")),
    scopedSelect("Пріоритет", "scope.filters.priorityId", metadata.priorities || [], "Усі пріоритети", card.scope.filters.priorityId),
    scopedStatusSelect(metadata.statuses || [], card.scope.filters.statusId || "*"),
    scopedSelect("Sprint", "scope.period.sprintId", metadata.sprints || [], "Без sprint", card.scope.period.sprintId),
    scopedSelect("Версія", "scope.period.versionId", metadata.versions || [], "Без версії", card.scope.period.versionId),
  );

  for (const field of (metadata.customFields || []).filter((item) => item.isFilter)) {
    grid.append(scopedCustomField(field, card.scope.filters.customFields[field.key] || ""));
  }

  wrapper.append(grid);
  return wrapper;
}

function scopedPeriod(card, label = "Період") {
  const wrap = document.createElement("div");
  wrap.className = "card-period";

  const mode = document.createElement("select");
  mode.dataset.cardAction = "scope.period.mode";
  mode.append(
    new Option("Останні N днів", "last_days"),
    new Option("Власний період", "custom"),
    new Option("Період спринта", "sprint"),
  );
  mode.value = card.scope.period.mode;

  const days = document.createElement("input");
  days.type = "number";
  days.min = "1";
  days.max = "3650";
  days.value = card.scope.period.days || 30;
  days.dataset.cardAction = "scope.period.days";

  const from = document.createElement("input");
  from.type = "date";
  from.value = card.scope.period.from || "";
  from.dataset.cardAction = "scope.period.from";

  const to = document.createElement("input");
  to.type = "date";
  to.value = card.scope.period.to || "";
  to.dataset.cardAction = "scope.period.to";

  wrap.append(labelWrap(label, mode), labelWrap("Днів", days), labelWrap("З", from), labelWrap("До", to));
  return wrap;
}

function isTimeCard(definition) {
  return String(definition?.seriesKey || "").toLowerCase().includes("time")
    || String(definition?.seriesKey || "").toLowerCase().includes("worklog");
}

function scopedSelect(label, action, items, emptyLabel, value, emptyValue = "") {
  const select = document.createElement("select");
  select.dataset.cardAction = action;
  select.append(new Option(emptyLabel, emptyValue));

  for (const item of items) {
    select.append(new Option(item.name, item.id));
  }

  select.value = [...select.options].some((option) => option.value === value) ? value : emptyValue;
  return labelWrap(label, select);
}

function scopedMultiSelect(label, action, items, values) {
  const select = document.createElement("select");
  select.dataset.cardAction = action;
  select.multiple = true;
  select.size = Math.min(Math.max(items.length, 3), 5);
  const selected = new Set(values || []);

  for (const item of items) {
    const option = new Option(item.name, item.id);
    option.selected = selected.has(String(item.id));
    select.append(option);
  }

  return labelWrap(label, select);
}

function selectedIds(source = {}, listKey, singleKey) {
  const list = Array.isArray(source[listKey]) ? source[listKey].filter(Boolean) : [];
  if (list.length) {
    return list.map(String);
  }
  return source[singleKey] ? [String(source[singleKey])] : [];
}

function scopedStatusSelect(items, value) {
  const select = document.createElement("select");
  select.dataset.cardAction = "scope.filters.statusId";
  select.append(new Option("Відкриті", "open"), new Option("Усі статуси", "*"));

  for (const item of items) {
    select.append(new Option(item.name, item.id));
  }

  select.value = [...select.options].some((option) => option.value === value) ? value : "*";
  return labelWrap("Статус", select);
}

function scopedCustomField(field, value) {
  const control = field.possibleValues.length ? document.createElement("select") : document.createElement("input");
  control.dataset.cardAction = `scope.filters.customFields.${field.key}`;

  if (control.tagName === "SELECT") {
    control.append(new Option(`Усі: ${field.name}`, ""));
    for (const option of field.possibleValues) {
      control.append(new Option(option.label, option.value));
    }
  } else {
    control.type = field.format === "date" ? "date" : "text";
    control.placeholder = field.name;
  }

  control.value = value;
  return labelWrap(field.name, control);
}

function labelWrap(text, control) {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = text;
  label.append(title, control);
  return label;
}

export function syncDashboardForm(elements, dashboard) {
  elements.dashboardName.value = dashboard.name;
}

export function syncModeButtons(elements, mode) {
  elements.viewModeButton.classList.toggle("active", mode === "view");
  elements.editModeButton.classList.toggle("active", mode === "edit");
  elements.dashboardForm.classList.toggle("edit-mode", mode === "edit");
  elements.cardEditorList.hidden = mode !== "edit";
  elements.cardTypeSelect.closest(".add-card-row").hidden = mode !== "edit";
}

function customFieldSelect(card, fields) {
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.textContent = "Поле для графіка";

  const select = document.createElement("select");
  select.dataset.cardAction = "customFieldKey";
  select.append(new Option("Обери поле", ""));

  for (const field of fields || []) {
    select.append(new Option(field.name, field.key));
  }

  select.value = card.settings.customFieldKey || "";
  label.append(title, select);
  return label;
}

function editorButton(text, action, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.cardAction = action;
  button.title = title;
  button.textContent = text;
  return button;
}
