import { formatDate } from "../utils/format.js";
import { emptyState } from "./states.js";

const paginationState = new Map();

export function renderIssueList(container, issues, emptyText, options = {}) {
  container.replaceChildren();

  if (!issues?.length) {
    container.append(emptyState(emptyText));
    return;
  }

  const pageSize = options.pageSize || issues.length;
  const stateKey = options.stateKey || container.id || "issues";
  const pageCount = Math.max(1, Math.ceil(issues.length / pageSize));
  const currentPage = Math.min(paginationState.get(stateKey) || 1, pageCount);
  const visibleIssues = issues.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  for (const issue of visibleIssues) {
    const item = document.createElement("div");
    item.className = "issue-item";

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "issue-title";

    const link = document.createElement("a");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `#${issue.id} ${issue.subject}`;

    const status = document.createElement("span");
    status.className = "pill";
    status.textContent = issue.status || "Без статусу";

    const priority = document.createElement("span");
    priority.className = "pill";
    priority.textContent = issue.priority || "Без пріоритету";

    title.append(link, status, priority);

    const meta = document.createElement("div");
    meta.className = "issue-meta";
    meta.textContent = `${issue.project || "Без проєкту"} · ${issue.assignee || "Не призначено"} · ${issue.tracker || "Без трекера"}`;

    body.append(title, meta);

    const date = document.createElement("div");
    date.className = "issue-date";
    date.textContent = issue.dueDate
      ? `Дедлайн ${formatDate(issue.dueDate)}`
      : `Оновлено ${formatDate(issue.updatedOn)}`;

    item.append(body, date);
    container.append(item);
  }

  if (pageCount > 1) {
    container.append(paginationControls({
      currentPage,
      pageCount,
      total: issues.length,
      onChange(nextPage) {
        paginationState.set(stateKey, nextPage);
        renderIssueList(container, issues, emptyText, options);
      },
    }));
  }
}

function paginationControls({ currentPage, pageCount, total, onChange }) {
  const controls = document.createElement("div");
  controls.className = "pagination";

  const summary = document.createElement("span");
  summary.textContent = `${currentPage} / ${pageCount} · ${total} задач`;

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "Назад";
  previous.disabled = currentPage <= 1;
  previous.addEventListener("click", () => onChange(currentPage - 1));

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Далі";
  next.disabled = currentPage >= pageCount;
  next.addEventListener("click", () => onChange(currentPage + 1));

  controls.append(previous, summary, next);
  return controls;
}
