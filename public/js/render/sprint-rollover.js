export function openSprintRolloverPreview(preview, { projectName, unitName, onConfirm }) {
  document.querySelector(".sprint-rollover-backdrop")?.remove();

  const backdrop = document.createElement("div");
  backdrop.className = "drilldown-backdrop sprint-rollover-backdrop";

  const modal = document.createElement("section");
  modal.className = "drilldown-modal sprint-rollover-modal";

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = "Перенесення задач";
  const close = modalButton("Закрити", () => backdrop.remove());
  header.append(heading, close);

  const route = document.createElement("div");
  route.className = "rollover-route";
  route.append(
    sprintBox("З попереднього", preview.sourceSprint),
    routeArrow(),
    sprintBox("У поточний", preview.targetSprint),
  );

  const context = document.createElement("p");
  context.className = "rollover-context";
  context.textContent = `${projectName} · ${unitName} · знайдено ${preview.issues.length} задач`;

  const note = document.createElement("p");
  note.className = "rollover-note";
  note.textContent = "Переносяться лише незакриті задачі. For Deploy переноситься; Done, Rejected та інші закриті статуси залишаються у попередньому sprint.";

  const content = document.createElement("div");
  content.className = "rollover-content";
  content.append(renderIssueTable(preview.issues));

  const error = document.createElement("div");
  error.className = "rollover-error";
  error.hidden = true;

  const actions = document.createElement("footer");
  actions.className = "modal-actions";
  const cancel = modalButton("Скасувати", () => backdrop.remove());
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary-button";
  confirm.textContent = `Перенести ${preview.issues.length} задач`;
  confirm.disabled = !preview.issues.length;
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    cancel.disabled = true;
    close.disabled = true;
    confirm.textContent = "Переношу...";
    error.hidden = true;

    try {
      const result = await onConfirm(preview.issues.map((issue) => issue.id));
      renderResult(modal, result, backdrop);
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
      confirm.disabled = false;
      cancel.disabled = false;
      close.disabled = false;
      confirm.textContent = `Перенести ${preview.issues.length} задач`;
    }
  });
  actions.append(cancel, confirm);

  modal.append(header, route, context, note, content, error, actions);
  backdrop.append(modal);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      backdrop.remove();
    }
  });
  document.body.append(backdrop);
}

function renderResult(modal, result, backdrop) {
  modal.replaceChildren();

  const header = document.createElement("header");
  const heading = document.createElement("h3");
  heading.textContent = "Перенесення завершено";
  const close = modalButton("Закрити", () => backdrop.remove());
  header.append(heading, close);

  const summary = document.createElement("div");
  summary.className = "rollover-result";
  summary.append(
    resultMetric("Перенесено", result.moved?.length || 0, "success"),
    resultMetric("Пропущено", result.skipped?.length || 0),
    resultMetric("Помилки", result.failed?.length || 0, result.failed?.length ? "danger" : ""),
  );

  const details = document.createElement("div");
  details.className = "rollover-result-details";

  if (result.skipped?.length) {
    details.append(resultList("Пропущені", result.skipped, (item) => `#${item.id} ${item.subject}: ${item.reason}`));
  }
  if (result.failed?.length) {
    details.append(resultList("Помилки", result.failed, (item) => `#${item.id}: ${item.error}`));
  }

  const actions = document.createElement("footer");
  actions.className = "modal-actions";
  actions.append(modalButton("Готово", () => backdrop.remove(), "primary-button"));

  modal.append(header, summary);
  if (details.children.length) {
    modal.append(details);
  }
  modal.append(actions);
}

function renderIssueTable(issues) {
  if (!issues.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "У попередньому sprint немає незакритих задач за вибраними фільтрами.";
    return empty;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "issue-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Задача</th>
        <th>Тип</th>
        <th>Статус</th>
        <th>Виконавець</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  for (const issue of issues) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="${issue.url}" target="_blank" rel="noreferrer">#${issue.id}</a></td>
      <td></td>
      <td></td>
      <td></td>
      <td></td>
    `;
    row.children[1].textContent = issue.subject;
    row.children[2].textContent = issue.tracker || "Без типу";
    row.children[3].textContent = issue.status || "Без статусу";
    row.children[4].textContent = issue.assignee || "Не призначено";
    body.append(row);
  }

  wrapper.append(table);
  return wrapper;
}

function sprintBox(label, sprint) {
  const box = document.createElement("div");
  box.className = "rollover-sprint";
  const caption = document.createElement("span");
  caption.textContent = label;
  const name = document.createElement("strong");
  name.textContent = sprint.name;
  const dates = document.createElement("small");
  dates.textContent = `${sprint.startDate} — ${sprint.endDate}`;
  box.append(caption, name, dates);
  return box;
}

function routeArrow() {
  const arrow = document.createElement("span");
  arrow.className = "rollover-arrow";
  arrow.textContent = "→";
  arrow.setAttribute("aria-hidden", "true");
  return arrow;
}

function resultMetric(label, value, tone = "") {
  const item = document.createElement("div");
  item.className = tone ? `rollover-result-metric ${tone}` : "rollover-result-metric";
  const caption = document.createElement("span");
  caption.textContent = label;
  const count = document.createElement("strong");
  count.textContent = String(value);
  item.append(caption, count);
  return item;
}

function resultList(title, items, format) {
  const section = document.createElement("section");
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = format(item);
    list.append(row);
  }
  section.append(heading, list);
  return section;
}

function modalButton(label, onClick, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.className = className;
  button.addEventListener("click", onClick);
  return button;
}
