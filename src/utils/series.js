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
    groups.set(key, (groups.get(key) || 0) + Number(item.hours || 0));
  }
  return toSortedSeries(groups, true).map((item) => ({ ...item, value: roundHours(item.value) }));
}

function toSortedSeries(groups, numeric = false) {
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value: numeric ? Number(value) : value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function sumHours(entries) {
  return entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
}

function roundHours(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

module.exports = { groupCount, groupHours, roundHours, sumHours };
