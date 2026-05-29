import { formatNumber } from "../utils/format.js";
import { emptyState } from "./states.js";

export function renderBarChart(container, series, options = {}) {
  container.replaceChildren();

  if (!series?.length) {
    container.append(emptyState("Немає даних для цього зрізу."));
    return;
  }

  if (options.chartType === "donut" || options.chartType === "pie") {
    renderDonutChart(container, series, options);
    return;
  }

  const max = Math.max(...series.map((item) => Number(item.value || 0)), 1);

  for (const item of series) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "bar-row";
    row.disabled = !options.onSelect;
    row.addEventListener("click", () => options.onSelect?.(item));

    const label = document.createElement("div");
    label.className = "bar-label";
    label.title = item.label;
    label.textContent = item.label;

    const track = document.createElement("div");
    track.className = "bar-track";

    const fill = document.createElement("div");
    fill.className = "bar-fill";
    fill.style.setProperty("--bar-width", `${Math.max(4, (Number(item.value) / max) * 100)}%`);

    const value = document.createElement("div");
    value.className = "bar-value";
    value.textContent = `${formatNumber(item.value)}${options.suffix || ""}`;

    track.append(fill);
    row.append(label, track, value);
    container.append(row);
  }
}

function renderDonutChart(container, series, options) {
  const total = series.reduce((sum, item) => sum + Number(item.value || 0), 0);
  const wrapper = document.createElement("div");
  wrapper.className = "donut-layout";

  const donut = document.createElement("div");
  donut.className = options.chartType === "pie" ? "donut pie" : "donut";
  donut.style.setProperty("--donut-bg", conicGradient(series));
  const center = document.createElement("span");
  center.textContent = formatNumber(total);
  donut.append(center);

  const legend = document.createElement("div");
  legend.className = "donut-legend";

  for (const [index, item] of series.slice(0, 10).entries()) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = !options.onSelect;
    button.addEventListener("click", () => options.onSelect?.(item));
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = colorForLabel(item.label, index);
    const text = document.createElement("span");
    text.textContent = `${item.label}: ${formatNumber(item.value)}${options.suffix || ""}`;
    button.append(swatch, text);
    legend.append(button);
  }

  wrapper.append(donut, legend, donutInsights(series, total));
  container.append(wrapper);
}

function donutInsights(series, total) {
  const panel = document.createElement("div");
  panel.className = "donut-insights";

  const heading = document.createElement("strong");
  heading.textContent = "Розподіл";
  panel.append(heading);

  for (const [index, item] of [...series].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 6).entries()) {
    const percent = total ? Math.round((Number(item.value || 0) / total) * 100) : 0;
    const row = document.createElement("div");
    row.className = "donut-insight-row";
    row.style.setProperty("--slice-color", colorForLabel(item.label, index));
    row.innerHTML = `
      <span></span>
      <b>${formatNumber(item.value)}</b>
      <em>${percent}%</em>
      <i style="--bar-width: ${percent}%"></i>
    `;
    row.querySelector("span").textContent = item.label;
    panel.append(row);
  }

  return panel;
}

function conicGradient(series) {
  const total = Math.max(series.reduce((sum, item) => sum + Number(item.value || 0), 0), 1);
  let cursor = 0;

  return `conic-gradient(${series.map((item, index) => {
    const start = cursor;
    cursor += (Number(item.value || 0) / total) * 100;
    return `${colorForLabel(item.label, index)} ${start}% ${cursor}%`;
  }).join(", ")})`;
}

function colorForLabel(label, index) {
  const colors = ["#1264a3", "#2d9c6b", "#d98c21", "#c2413a", "#6f5bd4", "#64748b", "#0e7490", "#be185d"];
  const priorityColors = {
    urgent: "#dc2626",
    high: "#f97316",
    hight: "#f97316",
    normal: "#eab308",
    medium: "#eab308",
    low: "#2563eb",
  };
  return priorityColors[String(label || "").trim().toLowerCase()] || colors[index % colors.length];
}

export function renderFlowChart(container, series, options = {}) {
  container.replaceChildren();

  if (!series?.length) {
    container.append(emptyState("Немає даних для графіка."));
    return;
  }

  const width = 640;
  const height = 250;
  const padding = 38;
  const idealSeries = options.idealSeries || [];
  const max = Math.max(
    ...series.map((item) => Number(item.value || 0)),
    ...idealSeries.map((item) => Number(item.value || 0)),
    1,
  );
  const pointData = series.map((item, index) => {
    const x = padding + (index / Math.max(series.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (Number(item.value || 0) / max) * (height - padding * 2);
    return { item, x, y };
  });
  const points = pointData.map((point) => `${point.x},${point.y}`).join(" ");
  const idealPoints = idealSeries.map((item, index) => {
    const x = padding + (index / Math.max(idealSeries.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (Number(item.value || 0) / max) * (height - padding * 2);
    return `${x},${y}`;
  }).join(" ");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.classList.add("flow-chart");
  svg.innerHTML = `
    <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="currentColor" stroke-opacity="0.18"></line>
    <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="currentColor" stroke-opacity="0.18"></line>
    ${idealPoints ? `<polyline points="${idealPoints}" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="7 7" stroke-opacity="0.35" stroke-linecap="round" stroke-linejoin="round"></polyline>` : ""}
    <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></polyline>
    <text x="${padding}" y="${height - 18}">${series[0].label}</text>
    <text x="${width - padding}" y="${height - 18}" text-anchor="end">${series[series.length - 1].label}</text>
    <text x="${padding}" y="${padding - 12}">${max}</text>
    <text x="${width / 2}" y="${height - 2}" text-anchor="middle">${options.xLabel || "Дні"}</text>
    <text x="12" y="${height / 2}" transform="rotate(-90 12 ${height / 2})" text-anchor="middle">${options.yLabel || "Кількість задач"}</text>
  `;

  for (const point of pointData) {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", point.x);
    circle.setAttribute("cy", point.y);
    circle.setAttribute("r", 8);
    circle.classList.add("flow-point");
    circle.addEventListener("click", () => options.onSelect?.(point.item));
    svg.append(circle);
  }

  if (options.summary) {
    container.append(flowSummary(options.summary, options.onSummarySelect));
  }
  container.append(svg);
}

function flowSummary(summary, onSelect) {
  const wrap = document.createElement("div");
  wrap.className = "flow-summary";
  wrap.append(
    flowMetric("Усього", summary.total, "total", onSelect),
    flowMetric("Готово", summary.completed, "completed", onSelect),
    flowMetric("Залишилось", summary.remaining, "remaining", onSelect),
    flowMetric("Період", `${summary.startDate || ""} - ${summary.endDate || ""}`),
  );
  return wrap;
}

function flowMetric(label, value, key, onSelect) {
  const item = key && onSelect ? document.createElement("button") : document.createElement("span");
  if (item.tagName === "BUTTON") {
    item.type = "button";
    item.addEventListener("click", () => onSelect(key));
  }
  const title = document.createElement("b");
  title.textContent = label;
  const number = document.createElement("strong");
  number.textContent = value;
  item.append(title, number);
  return item;
}
