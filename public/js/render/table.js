import { formatDate } from "../utils/format.js";
import { emptyState } from "./states.js";

export function renderIssueTable(container, issues, emptyText) {
  container.replaceChildren();

  if (!issues?.length) {
    container.append(emptyState(emptyText));
    return;
  }

  const table = document.createElement("table");
  table.className = "issue-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th>ID</th>
        <th>Subject</th>
        <th>Status</th>
        <th>Assignee</th>
        <th>Updated</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const body = table.querySelector("tbody");
  for (const issue of issues.slice(0, 50)) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><a href="${issue.url}" target="_blank" rel="noreferrer">#${issue.id}</a></td>
      <td></td>
      <td></td>
      <td></td>
      <td>${formatDate(issue.updatedOn)}</td>
    `;
    row.children[1].textContent = issue.subject;
    row.children[2].textContent = issue.status || "Без статусу";
    row.children[3].textContent = issue.assignee || "Не призначено";
    body.append(row);
  }

  container.append(table);
}
