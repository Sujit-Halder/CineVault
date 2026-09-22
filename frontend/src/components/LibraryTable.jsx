import React,{ useMemo,useState } from 'react';
import { FaEdit } from 'react-icons/fa';
import { MOVIE_RELEASE_STATUSES,PRODUCTION_STATUSES,SERIES_RELEASE_STATUSES } from '../statusOptions';
import { normalizeColumns,updatePageSelection } from '../libraryView';

const COLUMNS=[
  ['type','Type'],['subtype','Subtype'],['releaseDate','Release date'],['productionStatus','Production'],
  ['releaseStatus','Release'],['viewingStatus','Viewing'],['duration','Runtime'],['rating','Personal rating'],
  ['countryOfOrigin','Countries'],['genres','Genres'],['productionCompany','Production companies'],['modification','Updated'],
];

// Renders an audit-friendly library table with configurable columns and bounded bulk lifecycle editing.
export default function LibraryTable({ items,selected:controlledSelection,onSelectionChange,onEdit,onBulkUpdate,allowEditing=true }) {
  const available=COLUMNS.map(([key]) => key);
  const [columns,setColumns]=useState(() => { try { return normalizeColumns(JSON.parse(localStorage.getItem('cinevault-table-columns')),available); } catch { return normalizeColumns([],available); } });
  const [localSelection,setLocalSelection]=useState([]);
  const selected=controlledSelection ?? localSelection;
  const setSelection=onSelectionChange ?? setLocalSelection;
  const [bulkField,setBulkField]=useState('productionStatus'); const [bulkValue,setBulkValue]=useState('Completed');
  const selectedSet=useMemo(() => new Set(selected.map((item) => item.id)),[selected]);
  const mixedTypes=new Set(selected.map((item) => item.type)).size > 1;
  const releaseOptions=mixedTypes ? [...new Map([...MOVIE_RELEASE_STATUSES,...SERIES_RELEASE_STATUSES].map((item) => [item[0],item])).values()]
    : selected[0]?.type === 'series' ? SERIES_RELEASE_STATUSES : MOVIE_RELEASE_STATUSES;
  const options=bulkField === 'productionStatus' ? PRODUCTION_STATUSES : releaseOptions;
  const allPageSelected=items.length > 0 && items.every((item) => selectedSet.has(item.id));
  const togglePage=(checked) => setSelection(updatePageSelection(selected,items,checked));
  const toggleItem=(item,checked) => setSelection(checked
    ? [...selected.filter((entry) => entry.id !== item.id),{ id:item.id,type:item.type,title:item.title }]
    : selected.filter((entry) => entry.id !== item.id));
  const toggleColumn=(key) => setColumns((current) => { const next=current.includes(key) ? current.filter((item) => item !== key) : [...current,key]; localStorage.setItem('cinevault-table-columns',JSON.stringify(next)); return next; });
  const display=(item,key) => {
    const value=item[key]; if (Array.isArray(value)) return value.join(', '); if (key === 'duration') return value ? `${value} min` : '—';
    if (key === 'modification') return value ? new Date(value).toLocaleDateString() : '—'; return value || '—';
  };
  const moveRowFocus=(event) => { if (!['ArrowUp','ArrowDown'].includes(event.key)) return; const rows=[...event.currentTarget.querySelectorAll('tbody tr')]; const current=rows.indexOf(event.target.closest('tr')); const next=event.key === 'ArrowDown' ? Math.min(rows.length-1,current+1) : Math.max(0,current-1); if (current >= 0 && next !== current) { event.preventDefault(); rows[next].focus(); } };
  return <section className="table-workspace" aria-label="Compact library table">
    <details className="column-picker"><summary title="Choose which metadata columns appear in the table">Columns</summary><div>{COLUMNS.map(([key,label]) => <label key={key}><input type="checkbox" checked={columns.includes(key)} onChange={() => toggleColumn(key)} />{label}</label>)}</div></details>
    <div className="bulk-toolbar" aria-label="Selected title actions"><strong>{selected.length} selected across pages</strong>{allowEditing && <><select aria-label="Bulk field" value={bulkField} onChange={(event) => { const field=event.target.value; setBulkField(field); setBulkValue(field === 'productionStatus' ? 'Completed' : 'Released'); }}><option value="productionStatus">Production status</option><option value="releaseStatus">Release status</option></select><select aria-label="Bulk value" value={bulkValue} onChange={(event) => setBulkValue(event.target.value)}>{options.map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select><button disabled={!selected.length || (bulkField === 'releaseStatus' && mixedTypes)} title={mixedTypes && bulkField === 'releaseStatus' ? 'Select only movies or only series for a release-status update' : 'Apply this value to every selected row'} onClick={async () => { if (await onBulkUpdate(selected.map((item) => item.id),bulkField,bulkValue)) setSelection([]); }}>Apply</button></>} {selected.length > 0 && <button type="button" onClick={() => setSelection([])}>Clear selection</button>}</div>
    <div className="library-table-scroll"><table className="library-table" onKeyDown={moveRowFocus}><caption className="sr-only">Library titles. Selections remain active while moving between result pages.</caption><thead><tr><th><input aria-label="Select every title on this page" type="checkbox" checked={allPageSelected} onChange={(event) => togglePage(event.target.checked)} /></th><th>Title</th>{COLUMNS.filter(([key]) => columns.includes(key)).map(([key,label]) => <th key={key}>{label}</th>)}{allowEditing && <th><span className="sr-only">Actions</span></th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id} tabIndex="0" aria-label={`${item.title} metadata row`}><td><input aria-label={`Select ${item.title}`} type="checkbox" checked={selectedSet.has(item.id)} onChange={(event) => toggleItem(item,event.target.checked)} /></td><th scope="row">{item.title}</th>{COLUMNS.filter(([key]) => columns.includes(key)).map(([key]) => <td key={key} title={String(display(item,key))}>{display(item,key)}</td>)}{allowEditing && <td><button title={`Edit ${item.title}`} aria-label={`Edit ${item.title}`} onClick={() => onEdit(item)}><FaEdit /></button></td>}</tr>)}</tbody></table></div>
  </section>;
}
