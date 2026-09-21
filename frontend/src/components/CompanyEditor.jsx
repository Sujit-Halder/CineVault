import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { FaPlus,FaTimes } from 'react-icons/fa';

const API=import.meta.env.VITE_API_URL;

// Edits canonical production companies as separate values with server-backed suggestions.
export default function CompanyEditor({ value=[],onChange }) {
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState([]);
  useEffect(() => { const timer=window.setTimeout(() => axios.get(`${API}/api/v1/catalogs/production-companies`,{ params:{ q:query } })
    .then((response) => setOptions(response.data.items)).catch(() => setOptions([])),200); return () => window.clearTimeout(timer); },[query]);
  const add=(name) => { const clean=String(name || '').trim().replace(/\s+/g,' '); if (!clean) return; if (!value.some((item) => item.toLowerCase() === clean.toLowerCase())) onChange([...value,clean]); setQuery(''); };
  // Removes one company only after confirming the specific stored name.
  const remove=(name) => { if (window.confirm(`Remove “${name}” from this entry?`)) onChange(value.filter((item) => item !== name)); };
  return <fieldset className="selector-field company-editor"><legend>Production Companies or Producer Name(s)</legend><p className="field-help">Add each company separately. Common corporate abbreviations are stored in their full form.</p><div className="company-entry-row"><input aria-label="Production company name" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(query); } }} placeholder="Search or enter a full company name" /><button type="button" className="secondary-action" onClick={() => add(query)}><FaPlus /> Add</button></div><div className="selected-chips">{value.map((name) => <button type="button" key={name} onClick={() => remove(name)}>{name} <FaTimes aria-hidden="true" /></button>)}</div>{query && <div className="option-list company-suggestions">{options.filter((option) => !value.includes(option.name)).slice(0,8).map((option) => <button type="button" key={option.id || option.name} onClick={() => add(option.name)}><span>{option.name}</span><small>{option.uses} title{option.uses === 1 ? '' : 's'}</small></button>)}</div>}</fieldset>;
}
