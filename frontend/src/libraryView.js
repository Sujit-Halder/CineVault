export const VIEW_MODES=['cards','compact','table'];

// Keeps table selections limited to rows still present on the current page.
export function constrainSelection(selected,items) {
  const visible=new Set(items.map((item) => item.id));
  return selected.filter((id) => visible.has(id));
}

// Preserves only recognized table columns and falls back to the essential set.
export function normalizeColumns(columns,available) {
  const allowed=new Set(available);
  const normalized=Array.isArray(columns) ? [...new Set(columns.filter((column) => allowed.has(column)))] : [];
  return normalized.length ? normalized : available.slice(0,8);
}
