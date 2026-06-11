function groupCount(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return toSortedSeries(groups);
}

function groupHours(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, (groups.get(key) || 0) + parseHours(item.hours));
  }
  return toSortedSeries(groups, true).map((item) => ({ ...item, value: roundHours(item.value) }));
}

function toSortedSeries(groups, numeric = false) {
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value: numeric ? Number(value) : value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function sumHours(entries) {
  return entries.reduce((sum, entry) => sum + parseHours(entry.hours), 0);
}

function roundHours(value) {
  return Math.round(parseHours(value) * 10) / 10;
}

function parseHours(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  const text = String(value ?? "").trim();
  if (!text) {
    return 0;
  }

  const normalized = text.replace(",", ".");
  const fraction = normalized.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    return denominator ? numerator / denominator : 0;
  }

  const time = normalized.match(/^(-?\d+):(\d{1,2})$/);
  if (time) {
    const hours = Number(time[1]);
    const minutes = Number(time[2]);
    return hours + (minutes / 60);
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

module.exports = { groupCount, groupHours, parseHours, roundHours, sumHours };
