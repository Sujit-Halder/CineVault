export const VIEW_MODES=['cards','compact','table'];

// Adds or removes one result page without discarding selections made on other pages.
export function updatePageSelection(selected,items,checked) {
  const pageIds=new Set(items.map((item) => item.id));
  if (!checked) return selected.filter((item) => !pageIds.has(item.id));
  return [...new Map([...selected,...items.map((item) => ({ id:item.id,type:item.type,title:item.title }))].map((item) => [item.id,item])).values()];
}

// Preserves only recognized table columns and falls back to the essential set.
export function normalizeColumns(columns,available) {
  const allowed=new Set(available);
  const normalized=Array.isArray(columns) ? [...new Set(columns.filter((column) => allowed.has(column)))] : [];
  return normalized.length ? normalized : available.slice(0,8);
}
