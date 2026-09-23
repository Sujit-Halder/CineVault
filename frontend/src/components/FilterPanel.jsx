import React, { useEffect, useRef, useState } from 'react';
import { FaBookmark, FaTimes } from 'react-icons/fa';
import MultiSelect from './MultiSelect';
import RemoteCompanySelect from './RemoteCompanySelect';
import { MOVIE_RELEASE_STATUSES,MOVIE_VIEWING_STATUSES,PRODUCTION_STATUSES,SERIES_RELEASE_STATUSES,SERIES_VIEWING_STATUSES } from '../statusOptions';

// Presents library filters in an accessible slide-over panel.
const FilterPanel = ({ filters, catalogs, awards, tags, ratings, lockedViewingStatus, lockedType, onChange, onClose }) => {
  const [presets,setPresets]=useState(() => { try { return JSON.parse(localStorage.getItem('cinevault-filter-presets') || '{}'); } catch { return {}; } });
  const drawerRef=useRef(null);

  useEffect(() => { const previous=document.activeElement; drawerRef.current?.focus(); const key=(event) => { if (event.key === 'Escape') onClose(); if (event.key === 'Tab') { const controls=[...drawerRef.current.querySelectorAll('button,input,select,textarea,a[href]')].filter((item) => !item.disabled); if (!controls.length) return; const first=controls[0]; const last=controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }; window.addEventListener('keydown',key); return () => { window.removeEventListener('keydown',key); previous?.focus(); }; },[onClose]);
  const countryOptions = catalogs.countries.map((country) => ({ value:country.code, label:`${country.name} (${country.code})` }));
  const languageOptions = ['Arabic','Bengali','Chinese','English','French','German','Hindi','Italian','Japanese','Korean','Portuguese','Russian','Spanish','Tamil','Telugu','Thai'].map((value) => ({ value,label:value }));
  const optionList = (values) => values.map((value) => ({ value,label:value }));
  const currentYear = new Date().getFullYear();
  const releaseYears = Array.from({ length:currentYear + 5 - 1888 + 1 },(_,index) => currentYear + 5 - index);
  const effectiveType = lockedType || filters.type;
  const movieSubtypes = catalogs.subtypes?.movie || [];
  const seriesSubtypes = catalogs.subtypes?.series || [];
  const subtypeDescription=(subtype) => catalogs.subtypeDescriptions?.[subtype] || '';
  const sourceOptions = catalogs.watchSources.map((source) => ({ value:source.id,label:source.label }));

  // Updates one filter while preserving all other filter selections.
  const update = (name, value) => onChange({ ...filters, [name]:value });

  // Restores every filter to its neutral state.
  const clear = () => onChange({ type:'',subtype:'',productionStatus:'',releaseStatus:'',viewingStatus:'',genres:[],presentationForms:[],languages:[],tags:[],rating:'',awards:[],countries:[],releaseYear:'',productionCompanies:[],watchSources:[],linkDomains:[] });

  // Saves the current filter combination under a reusable local name.
  const savePreset=() => { const name=window.prompt('Name this filter preset'); if (!name?.trim()) return; const next={ ...presets,[name.trim()]:filters }; setPresets(next); localStorage.setItem('cinevault-filter-presets',JSON.stringify(next)); };

  // Loads or removes a saved filter preset selected by name.
  const choosePreset=(value) => { if (value) onChange({ ...filters,...presets[value] }); };

  return (
    <div className="filter-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="filter-drawer" ref={drawerRef} tabIndex="-1" role="dialog" aria-modal="true" aria-label="Library filters">
        <div className="panel-heading"><div><span className="eyebrow">REFINE LIBRARY</span><h2>Filters</h2></div><button onClick={onClose} aria-label="Close filters"><FaTimes /></button></div>
        <div className="filter-scroll">
          <div className="preset-controls"><span className="filter-label">Saved presets</span><select aria-label="Saved filter presets" defaultValue="" onChange={(event) => choosePreset(event.target.value)}><option value="">Choose a saved filter</option>{Object.keys(presets).map((name) => <option key={name}>{name}</option>)}</select></div>
          <label className="filter-label">Content type<select disabled={Boolean(lockedType)} value={effectiveType} onChange={(event) => onChange({ ...filters,type:event.target.value,subtype:'' })}><option value="">Movies and series</option><option value="movie">Movies</option><option value="series">Series</option></select>{lockedType && <small>This view is fixed to {lockedType === 'movie' ? 'movies' : 'series'}.</small>}</label>
          <label className="filter-label" title={subtypeDescription(filters.subtype) || 'Filter by structural content subtype'}>Subtype<select title={subtypeDescription(filters.subtype) || 'Filter by structural content subtype'} value={filters.subtype} onChange={(event) => update('subtype',event.target.value)}><option value="" title="Do not filter by subtype">{effectiveType ? `All ${effectiveType} subtypes` : 'All movie and series subtypes'}</option>{effectiveType === 'movie' && movieSubtypes.map((subtype) => <option key={subtype} title={subtypeDescription(subtype)}>{subtype}</option>)}{effectiveType === 'series' && seriesSubtypes.map((subtype) => <option key={subtype} title={subtypeDescription(subtype)}>{subtype}</option>)}{!effectiveType && <><optgroup label="Movie subtypes">{movieSubtypes.map((subtype) => <option key={`movie-${subtype}`} value={subtype} title={subtypeDescription(subtype)}>{subtype}</option>)}</optgroup><optgroup label="Series subtypes">{seriesSubtypes.map((subtype) => <option key={`series-${subtype}`} value={subtype} title={subtypeDescription(subtype)}>{subtype}</option>)}</optgroup></>}</select>{filters.subtype && <small>{subtypeDescription(filters.subtype)}</small>}</label>
          <label className="filter-label" title="Filter by creative and production progress">Production status<select title={PRODUCTION_STATUSES.find(([value]) => value === filters.productionStatus)?.[1] || 'Show every production stage'} value={filters.productionStatus} onChange={(event) => update('productionStatus',event.target.value)}><option value="" title="Do not filter by production stage">All production statuses</option>{PRODUCTION_STATUSES.map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select></label>
          <label className="filter-label" title="Filter by public release lifecycle">Release status<select title="Choose a public release lifecycle state" value={filters.releaseStatus} onChange={(event) => update('releaseStatus',event.target.value)}><option value="" title="Do not filter by release lifecycle">All release statuses</option>{(effectiveType === 'series' ? SERIES_RELEASE_STATUSES : effectiveType === 'movie' ? MOVIE_RELEASE_STATUSES : [...new Map([...MOVIE_RELEASE_STATUSES,...SERIES_RELEASE_STATUSES].map((item) => [item[0],item])).values()]).map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select></label>
          <label className="filter-label" title="Viewing status is calculated from saved movie and episode watch dates">Viewing status<select title="Choose a calculated viewing state" disabled={Boolean(lockedViewingStatus)} value={lockedViewingStatus || filters.viewingStatus} onChange={(event) => update('viewingStatus',event.target.value)}><option value="" title="Do not filter by viewing progress">All viewing statuses</option>{(effectiveType === 'series' ? SERIES_VIEWING_STATUSES : effectiveType === 'movie' ? MOVIE_VIEWING_STATUSES : [...MOVIE_VIEWING_STATUSES,...SERIES_VIEWING_STATUSES]).map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select>{lockedViewingStatus && <small>This view contains watched movies only.</small>}</label>
          <label className="filter-label">Release year<select value={filters.releaseYear} onChange={(event) => update('releaseYear',event.target.value)}><option value="">Any year</option>{releaseYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
          <label className="filter-label">Personal rating<select value={filters.rating} onChange={(event) => update('rating', event.target.value)}><option value="">Any rating</option><option value="__unrated__">Not rated</option>{ratings.map((rating) => <option key={rating}>{rating}</option>)}</select></label>
          <p className="filter-rule-note">Multiple selections use strict AND matching. A title must contain every selected value.</p>
          <MultiSelect label="Presentation forms" help="Show titles containing every selected production or presentation form" options={effectiveType ? (catalogs.presentationForms?.[effectiveType] || []) : [...(catalogs.presentationForms?.movie || []),...(catalogs.presentationForms?.series || []).filter((group) => !(catalogs.presentationForms?.movie || []).some((movieGroup) => movieGroup.name === group.name))]} grouped value={filters.presentationForms} onChange={(value) => update('presentationForms',value)} />
          <MultiSelect label="Genres and subgenres" options={catalogs.genres} grouped value={filters.genres} onChange={(value) => update('genres', value)} />
          <MultiSelect label="Languages" help="Show titles containing every selected language" options={languageOptions} value={filters.languages} onChange={(value) => update('languages', value)} />
          <MultiSelect label="Tags" options={optionList(tags)} value={filters.tags} onChange={(value) => update('tags', value)} />
          <MultiSelect label="Awards" options={optionList(awards)} value={filters.awards} onChange={(value) => update('awards', value)} />
          <MultiSelect label="Origin countries" help="Show titles associated with every selected production country" options={countryOptions} value={filters.countries} onChange={(value) => update('countries', value)} />
          <RemoteCompanySelect value={filters.productionCompanies} onChange={(value) => update('productionCompanies',value)} />
          <MultiSelect label="Watching sources" options={sourceOptions} value={filters.watchSources} onChange={(value) => update('watchSources',value)} />
          <MultiSelect label="Find-title link domains" options={optionList(catalogs.linkDomains || [])} value={filters.linkDomains} onChange={(value) => update('linkDomains',value)} />
        </div>
        <div className="filter-actions"><button className="filter-clear-action" onClick={clear}>Clear all</button><button className="filter-preset-action" type="button" onClick={savePreset} title="Save the current filters in this browser"><FaBookmark aria-hidden="true" />Save preset</button><button className="primary-action filter-results-action" onClick={onClose}>Show results</button></div>
      </aside>
    </div>
  );
};

export default FilterPanel;
