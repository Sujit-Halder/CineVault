import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API=import.meta.env.VITE_API_URL;

// Searches normalized production companies on demand without rendering the full catalog.
export default function RemoteCompanySelect({ value=[],onChange }) {
  const [query,setQuery]=useState(''); const [options,setOptions]=useState([]);
  useEffect(() => { const timer=window.setTimeout(() => axios.get(`${API}/api/v1/catalogs/production-companies`,{ params:{ q:query } }).then((response) => setOptions(response.data.items)).catch(() => setOptions([])),200); return () => window.clearTimeout(timer); },[query]);
  const toggle=(name) => onChange(value.includes(name) ? value.filter((item) => item !== name) : [...value,name]);
  return <fieldset className="selector-field"><legend>Production Companies or Producer Name(s)</legend><input aria-label="Search production companies" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search existing companies" /><div className="selected-chips">{value.map((name) => <button type="button" key={name} onClick={() => toggle(name)}>{name} ×</button>)}</div><div className="option-list">{options.map((option) => <label key={option.name} className={value.includes(option.name) ? 'selected-option' : ''}><input type="checkbox" checked={value.includes(option.name)} onChange={() => toggle(option.name)} /><span>{option.name} <small>({option.uses})</small></span></label>)}</div></fieldset>;
}
