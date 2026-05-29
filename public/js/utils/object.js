export function getByPath(source, path) {
  return path.reduce((value, key) => value?.[key], source);
}
