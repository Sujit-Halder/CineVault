import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FaPlus, FaTrash } from 'react-icons/fa';
import MultiSelect from './MultiSelect';
import CompanyEditor from './CompanyEditor';
import { AWARDS, PERSONAL_RATINGS, TAGS } from '../catalogOptions';
import { MOVIE_RELEASE_STATUSES,PRODUCTION_STATUSES,SEASON_RELEASE_STATUSES,SERIES_RELEASE_STATUSES } from '../statusOptions';

const EMPTY_FORM = {
  type:'movie',subtype:'Feature Film',title:'',originalTitle:'',productionStatus:'Announced',releaseStatus:'Unscheduled',releaseDate:'',seriesStartDate:'',seriesEndDate:'',seriesContinuing:false,seriesNetwork:'',duration:'',
  director:'',seriesCredits:[],casts:'',rating:'',language:[],genres:[],countryOfOrigin:[],contentRatings:[],watchSources:[],
  awards:[],tags:[],presentationForms:[],productionCompany:'',productionCompanies:[],posterUrl:'',trailerUrl:'',summary:'',favorite:false,seasons:[],watchHistory:[],contentLinks:[],
};

const FALLBACK_EPISODE_TYPES = ['Regular','Pilot','Backdoor Pilot','Season Premiere','Midseason Premiere','Midseason Finale','Season Finale','Series Finale','Special','Holiday Special','Recap','Clip Show','Crossover','Two-Part Episode','Bonus','Webisode','Minisode','Unaired Episode'];
const SERIES_CREDIT_ROLES=['Creator','Co-Creator','Developer','Showrunner','Executive Producer','Producer','Head Writer','Series Director','Original Work Creator','Other'];

// Returns the local calendar date represented by a stored date or timestamp.
const calendarDateValue = (value) => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value).slice(0,10);
  const part = (number) => String(number).padStart(2,'0');
  return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
};

// Groups related metadata into a compact, independently collapsible editor step.
const EditorSection=({ title,description,defaultOpen=false,children }) => <details className="editor-section" open={defaultOpen}><summary><span><strong>{title}</strong><small>{description}</small></span><span className="section-toggle" aria-hidden="true">+</span></summary><div className="editor-section-body">{children}</div></details>;

// Buffers keyboard date editing and commits only after the native control is finished.
const BufferedDateInput = ({ value,onCommit,...props }) => {
  const displayValue=calendarDateValue(value);
  const [draft,setDraft]=useState(displayValue);
  const editing=useRef(false);
  useEffect(() => { if (!editing.current) setDraft(displayValue); },[displayValue]);
  return <input {...props} type="date" value={draft} onFocus={() => { editing.current=true; }} onChange={(event) => setDraft(event.target.value)}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
    onBlur={(event) => { editing.current=false; const completed=event.currentTarget.value; setDraft(completed); onCommit(completed); }} />;
};

// Returns today's date in the browser's local calendar for date-input limits.
const localToday = () => {
  const now=new Date(); const part=(value) => String(value).padStart(2,'0');
  return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
};

// Provides a structured editor for movie metadata and series seasons and episodes.
const MovieForm = ({ onClose, onSubmit, initialData, catalogs }) => {
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(initialData || {}), contentRatings:initialData?.contentRatings || [],presentationForms:initialData?.presentationForms || [],watchSources:initialData?.watchSources || [],productionCompanies:initialData?.productionCompanies || String(initialData?.productionCompany || '').split(',').map((name) => name.trim()).filter(Boolean), seasons:initialData?.seasons || [],watchHistory:initialData?.watchHistory || [],contentLinks:initialData?.contentLinks || [] }));
  const [ratingTerritory, setRatingTerritory] = useState(catalogs.ratingSystems[0]?.territory || 'US');
  const [ratingCode, setRatingCode] = useState('');
  const [watchError,setWatchError] = useState('');
  const [sourceError,setSourceError] = useState('');
  const dialogRef=useRef(null);
  const initialSnapshot=useRef(JSON.stringify({ ...EMPTY_FORM,...(initialData || {}),contentRatings:initialData?.contentRatings || [],presentationForms:initialData?.presentationForms || [],watchSources:initialData?.watchSources || [],productionCompanies:initialData?.productionCompanies || String(initialData?.productionCompany || '').split(',').map((name) => name.trim()).filter(Boolean),seasons:initialData?.seasons || [],watchHistory:initialData?.watchHistory || [],contentLinks:initialData?.contentLinks || [] }));
  const countryOptions = useMemo(() => catalogs.countries.map((country) => ({ value:country.code, label:`${country.name} (${country.code})` })), [catalogs.countries]);
  const activeRatingSystem = catalogs.ratingSystems.find((system) => system.territory === ratingTerritory);
  const animatedContent=form.presentationForms.some((item) => ['Animation','Anime','Adult Animation','Stop Motion'].includes(item));
  const dirty=JSON.stringify(form) !== initialSnapshot.current;
  const dirtyRef=useRef(dirty);
  const onCloseRef=useRef(onClose);
  dirtyRef.current=dirty;
  onCloseRef.current=onClose;
  const today=localToday();
  const episodeTypes=catalogs.episodeTypes || FALLBACK_EPISODE_TYPES;
  const languageOptions=(catalogs.languages || []).map((language) => ({ value:language.tag,label:language.label }));
  const defaultWatchLanguage=form.language.length === 1 ? form.language[0] : '';
  const hasEpisodeWatch=form.seasons.some((season) => season.episodes?.some((episode) => episode.watchHistory?.length));
  const missingEpisodeWatchLanguages=form.seasons.reduce((total,season) => total + (season.episodes || []).reduce((episodeTotal,episode) => episodeTotal + (episode.watchHistory || []).filter((entry) => !entry.languageTag).length,0),0);
  const watched=form.type === 'movie' ? form.watchHistory.length > 0 : hasEpisodeWatch;
  const released=form.type === 'movie' ? form.releaseStatus === 'Released' : ['Airing','Between Seasons','Hiatus','Returning','Ended'].includes(form.releaseStatus);
  const trailerAvailable=!['Unscheduled','Unknown'].includes(form.releaseStatus) || Boolean(form.trailerUrl);
  const effectiveReleaseDate=form.type === 'series' ? form.seriesStartDate : form.releaseDate;
  const runtimeAvailable=released || Boolean(effectiveReleaseDate && effectiveReleaseDate <= today);

  // Protects unsaved editor changes and keeps keyboard focus inside the dialog workflow.
  useEffect(() => {
    const previous=document.activeElement;
    dialogRef.current?.focus();
    const beforeUnload=(event) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue=''; } };
    const keyDown=(event) => {
      if (event.key === 'Escape' && (!dirtyRef.current || window.confirm('Discard unsaved changes?'))) onCloseRef.current();
      if (event.key === 'Tab') { const controls=[...dialogRef.current.querySelectorAll('button,input,select,textarea,a[href]')].filter((item) => !item.disabled); if (!controls.length) return; const first=controls[0]; const last=controls.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    window.addEventListener('beforeunload',beforeUnload); window.addEventListener('keydown',keyDown);
    return () => { window.removeEventListener('beforeunload',beforeUnload); window.removeEventListener('keydown',keyDown); previous?.focus(); };
  },[]);

  // Closes the editor after confirming that intentional unsaved work may be discarded.
  const requestClose=() => { if (!dirty || window.confirm('Discard unsaved changes?')) onClose(); };

  // Runs a destructive form edit only after the user confirms its exact scope.
  const confirmRemoval=(message,action) => { if (window.confirm(message)) action(); };

  // Combines a selected calendar date with the current local time as an ISO timestamp.
  const watchTimestamp = (dateValue) => {
    if (!dateValue) return '';
    const now = new Date();
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
  };

  // Updates one scalar form property.
  const update = (name, value) => setForm((current) => ({ ...current, [name]:value }));

  // Adds an editable watching-source method and optional provider pair.
  const addSource = () => {
    setSourceError('');
    update('watchSources',[...form.watchSources,{ method:'',provider:'' }]);
  };

  // Updates one watching-source pair without affecting the other sources.
  const updateSource = (index,patch) => update('watchSources',form.watchSources.map((source,itemIndex) => itemIndex === index
    ? { ...(typeof source === 'string' ? { method:source,provider:'' } : source),...patch } : source));

  // Removes one watching-source pair.
  const removeSource = (index) => confirmRemoval('Remove this watching source from the entry?',() => update('watchSources',form.watchSources.filter((_,itemIndex) => itemIndex !== index)));

  // Adds an editable viewing record using the current local date and time.
  const addWatch = () => { setWatchError(''); update('watchHistory',[...form.watchHistory,{ watchedAt:new Date().toISOString(),languageTag:defaultWatchLanguage }]); };

  // Changes one viewing date while preserving its time component when possible.
  const updateWatch = (index,dateValue) => update('watchHistory',form.watchHistory.map((entry,itemIndex) => itemIndex === index
    ? { ...entry,watchedAt:watchTimestamp(dateValue) } : entry));

  // Removes one incorrect viewing record from the submitted history.
  const removeWatch = (index) => confirmRemoval('Delete this movie watch record?',() => update('watchHistory',form.watchHistory.filter((_,itemIndex) => itemIndex !== index)));

  // Adds a blank external content-location input.
  const addLink = () => update('contentLinks',[...form.contentLinks,{ url:'' }]);

  // Changes one external content-location URL.
  const updateLink = (index,url) => update('contentLinks',form.contentLinks.map((entry,itemIndex) => itemIndex === index ? { ...entry,url } : entry));

  // Removes one external content-location URL.
  const removeLink = (index) => confirmRemoval('Remove this find-title link?',() => update('contentLinks',form.contentLinks.filter((_,itemIndex) => itemIndex !== index)));

  // Adds the selected territory-specific content rating.
  const addRating = () => {
    if (!ratingCode) return;
    update('contentRatings', [...form.contentRatings.filter((rating) => rating.territory !== ratingTerritory), { territory:ratingTerritory, system:activeRatingSystem?.authority || 'Custom', code:ratingCode }]);
    setRatingCode('');
  };

  // Removes one content rating by its list position.
  const removeRating = (index) => confirmRemoval('Remove this official content rating?',() => update('contentRatings', form.contentRatings.filter((_, itemIndex) => itemIndex !== index)));

  // Adds an empty season to the series structure.
  const addSeason = () => update('seasons', [...form.seasons, { seasonNumber:form.seasons.length + 1,title:'',productionStatus:'Announced',releaseStatus:'Unscheduled',releaseDate:'',posterUrl:'',synopsis:'',completionStatus:'Not Started',episodes:[] }]);

  // Adds an ordered whole-series credit with a clearly identified responsibility.
  const addSeriesCredit=() => update('seriesCredits',[...form.seriesCredits,{ name:'',role:'Creator' }]);

  // Updates one whole-series credit without affecting episode directors.
  const updateSeriesCredit=(index,patch) => update('seriesCredits',form.seriesCredits.map((credit,itemIndex) => itemIndex === index ? { ...credit,...patch } : credit));

  // Removes one whole-series credit.
  const removeSeriesCredit=(index) => confirmRemoval('Delete this whole-series credit?',() => update('seriesCredits',form.seriesCredits.filter((_,itemIndex) => itemIndex !== index)));

  // Updates one season while preserving the remaining series structure.
  const updateSeason = (index, patch) => update('seasons', form.seasons.map((season, itemIndex) => itemIndex === index ? { ...season, ...patch } : season));

  // Returns whether a season has reached the lifecycle stage required to contain episodes.
  const seasonAcceptsEpisodes = (season) => season.productionStatus === 'Completed'
    && ['Airing','Released'].includes(season.releaseStatus) && Boolean(season.releaseDate);

  // Returns whether a production option is compatible with the season's release state.
  const seasonProductionAllowed = (season, value) => {
    if (season.episodes?.length) return value === 'Completed';
    if (['Airing','Released'].includes(season.releaseStatus)) return value === 'Completed';
    if (season.releaseStatus === 'Upcoming') return ['Announced','In Development','Pre-Production','Filming / Production','Post-Production','Completed'].includes(value);
    if (season.releaseStatus === 'Canceled') return ['Canceled','Shelved','Completed'].includes(value);
    return true;
  };

  // Returns whether a release option is compatible with the season's production state.
  const seasonReleaseAllowed = (season, value) => {
    if (season.episodes?.length) return ['Airing','Released'].includes(value);
    if (['Airing','Released'].includes(value)) return season.productionStatus === 'Completed';
    if (value === 'Upcoming') return ['Announced','In Development','Pre-Production','Filming / Production','Post-Production','Completed'].includes(season.productionStatus);
    if (value === 'Canceled') return ['Canceled','Shelved','Completed'].includes(season.productionStatus);
    return true;
  };

  // Removes one season from the series structure.
  const removeSeason = (index) => {
    const season=form.seasons[index];
    confirmRemoval(`Delete ${season.title || `Season ${season.seasonNumber || index + 1}`} and every episode and watch record inside it?`,() => update('seasons', form.seasons.filter((_, itemIndex) => itemIndex !== index)));
  };

  // Resizes a season's episode list while preserving every existing episode record.
  const setEpisodeCount = (seasonIndex, value) => {
    const season=form.seasons[seasonIndex];
    if (!seasonAcceptsEpisodes(season)) return;
    const episodes=[...(season.episodes || [])];
    const count=Math.min(1000,Math.max(episodes.length,Number(value) || 0));
    while (episodes.length < count) {
      const episodeNumber=episodes.length + 1;
      episodes.push({ episodeNumber,title:'',episodeType:'Regular',director:'',duration:'',airDate:season.releaseDate || '',summary:'',watchHistory:[] });
    }
    updateSeason(seasonIndex,{ episodes:episodes.slice(0,count) });
  };

  // Sets the season premiere and synchronizes the airing date of every episode in that season.
  const updateSeasonPremiere = (seasonIndex, releaseDate) => {
    const season=form.seasons[seasonIndex];
    updateSeason(seasonIndex,{ releaseDate,episodes:(season.episodes || []).map((episode) => ({ ...episode,airDate:releaseDate })) });
  };

  // Derives season completion directly from episode watch histories.
  const seasonCompletionStatus = (season) => {
    const episodes=season.episodes || [];
    const watchedCount=episodes.filter((episode) => episode.watchHistory?.length > 0).length;
    if (!watchedCount) return 'Not Started';
    return watchedCount === episodes.length && episodes.length > 0 ? 'Completed' : 'In Progress';
  };

  // Updates one episode within a selected season.
  const updateEpisode = (seasonIndex, episodeIndex, patch) => {
    const season = form.seasons[seasonIndex];
    updateSeason(seasonIndex, { episodes:season.episodes.map((episode, itemIndex) => itemIndex === episodeIndex ? { ...episode, ...patch } : episode) });
  };

  // Removes one episode from a selected season.
  const removeEpisode = (seasonIndex, episodeIndex) => {
    const season = form.seasons[seasonIndex];
    const episode=season.episodes[episodeIndex];
    confirmRemoval(`Delete ${episode.title || `Episode ${episode.episodeNumber || episodeIndex + 1}`} and all of its watch records?`,() => updateSeason(seasonIndex, { episodes:season.episodes.filter((_, itemIndex) => itemIndex !== episodeIndex) }));
  };

  // Adds a viewing event to one episode using the current local date and time.
  const addEpisodeWatch = (seasonIndex,episodeIndex) => {
    setWatchError('');
    const episode = form.seasons[seasonIndex].episodes[episodeIndex];
    updateEpisode(seasonIndex,episodeIndex,{ watchHistory:[...(episode.watchHistory || []),{ watchedAt:new Date().toISOString(),languageTag:defaultWatchLanguage }] });
  };

  // Changes one episode viewing date while retaining the repeatable history record.
  const updateEpisodeWatch = (seasonIndex,episodeIndex,watchIndex,dateValue) => {
    const episode = form.seasons[seasonIndex].episodes[episodeIndex];
    updateEpisode(seasonIndex,episodeIndex,{ watchHistory:(episode.watchHistory || []).map((entry,index) => index === watchIndex
      ? { ...entry,watchedAt:watchTimestamp(dateValue) } : entry) });
  };

  // Removes one incorrect episode viewing event.
  const removeEpisodeWatch = (seasonIndex,episodeIndex,watchIndex) => {
    const episode = form.seasons[seasonIndex].episodes[episodeIndex];
    confirmRemoval(`Delete this watch record for ${episode.title || `Episode ${episode.episodeNumber || episodeIndex + 1}`}?`,() => updateEpisode(seasonIndex,episodeIndex,{ watchHistory:(episode.watchHistory || []).filter((_,index) => index !== watchIndex) }));
  };

  // Assigns one confirmed audio language to every legacy episode viewing that has no language.
  const fillMissingEpisodeWatchLanguages = (languageTag) => {
    if (!languageTag) return;
    setForm((current) => ({ ...current,seasons:current.seasons.map((season) => ({ ...season,episodes:(season.episodes || []).map((episode) => ({
      ...episode,watchHistory:(episode.watchHistory || []).map((entry) => entry.languageTag ? entry : { ...entry,languageTag }),
    })) })) }));
  };

  // Validates and submits the complete editor state.
  const submit = (event) => {
    event.preventDefault();
    const sourceKeys=(watched ? form.watchSources : []).filter((source) => source.method || String(source.provider || '').trim()).map((source) => `${source.method}\u0000${String(source.provider || '').trim().toLowerCase()}`);
    if (new Set(sourceKeys).size !== sourceKeys.length) {
      setSourceError('Each watching method and provider combination must be unique.');
      return;
    }
    onSubmit(form);
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className="editor-modal" ref={dialogRef} tabIndex="-1" role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <div className="panel-heading"><div><span className="eyebrow">LIBRARY ENTRY</span><h2 id="editor-title">{initialData ? 'Edit title' : 'Add a title'}</h2></div><button type="button" title="Close the editor; unsaved changes require confirmation" onClick={requestClose}>Close</button></div>
        <form onSubmit={submit}>
          {watchError && form.type === 'series' && <p className="field-error form-alert" role="alert">{watchError}</p>}
          <EditorSection title="Identity & lifecycle" description="Title, format, dates, production, release and viewing state" defaultOpen>
          <div className="form-grid">
            <label className="span-two">Title<input required value={form.title} onChange={(event) => update('title', event.target.value)} /></label>
            <label className="span-two">Original title<input value={form.originalTitle} onChange={(event) => update('originalTitle', event.target.value)} /></label>
            <label>Content type<select value={form.type} onChange={(event) => { const type = event.target.value; setForm((current) => ({ ...current,type,subtype:catalogs.subtypes?.[type]?.[0] || '',releaseStatus:'Unscheduled',presentationForms:[],duration:type === 'movie' ? current.duration : '',director:type === 'movie' ? current.director : '',watchHistory:type === 'movie' ? current.watchHistory : [],seriesStartDate:type === 'series' ? (current.seriesStartDate || current.releaseDate) : '',seriesEndDate:type === 'series' ? current.seriesEndDate : '',seriesContinuing:false,seriesNetwork:type === 'series' ? current.seriesNetwork : '',seriesCredits:type === 'series' ? current.seriesCredits : [],seasons:type === 'series' ? current.seasons : [] })); }}><option value="movie">Movie</option><option value="series">Series</option></select></label>
            <label title={catalogs.subtypeDescriptions?.[form.subtype] || 'Choose the structural subtype'}>Subtype<select title={catalogs.subtypeDescriptions?.[form.subtype] || 'Choose the structural subtype'} value={form.subtype} onChange={(event) => update('subtype', event.target.value)}>{(catalogs.subtypes?.[form.type] || []).map((item) => <option key={item} title={catalogs.subtypeDescriptions?.[item] || ''}>{item}</option>)}</select><small>{catalogs.subtypeDescriptions?.[form.subtype]}</small></label>
            <label title="Where the title is in its creative and production process">Production status<select title={PRODUCTION_STATUSES.find(([value]) => value === form.productionStatus)?.[1]} value={form.productionStatus} onChange={(event) => update('productionStatus',event.target.value)}>{PRODUCTION_STATUSES.map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select></label>
            <label title="Where the title is in its public release lifecycle">Release status<select title={(form.type === 'series' ? SERIES_RELEASE_STATUSES : MOVIE_RELEASE_STATUSES).find(([value]) => value === form.releaseStatus)?.[1]} value={form.releaseStatus} onChange={(event) => update('releaseStatus',event.target.value)}>{(form.type === 'series' ? SERIES_RELEASE_STATUSES : MOVIE_RELEASE_STATUSES).map(([value,description]) => <option key={value} value={value} title={description}>{value}</option>)}</select></label>
            {form.type === 'movie' && <label title={watched ? "A release date is required because this movie has been watched" : "The movie's official release date, when known"}>Release date {watched && <small>required</small>}<input required={watched} type="date" max={today} value={form.releaseDate} onChange={(event) => update('releaseDate', event.target.value)} /></label>}
            {form.type === 'series' && <fieldset className="timeline-editor span-two"><legend title="The premiere date identifies the series and is required after an episode has been watched">Series timeline</legend><div className="timeline-fields"><label title={watched ? 'Required because this series has an episode viewing' : 'The series premiere date, when known'}>Release date {watched && <small>required</small>}<input required={watched} type="date" max={today} value={form.seriesStartDate} onChange={(event) => setForm((current) => ({ ...current,seriesStartDate:event.target.value,releaseDate:event.target.value,seriesEndDate:event.target.value ? current.seriesEndDate : '' }))} /></label>{form.releaseStatus === 'Ended' && <label title="Required for an ended series and later than its release date">End date<input type="date" min={form.seriesStartDate || undefined} max={today} required value={form.seriesEndDate} onChange={(event) => update('seriesEndDate',event.target.value)} /></label>}</div></fieldset>}
            {form.type === 'movie' && <label title="One or more movie directors, separated by commas">Director(s)<input value={form.director} onChange={(event) => update('director', event.target.value)} /></label>}
            {form.type === 'series' && <label>Network<input value={form.seriesNetwork} onChange={(event) => update('seriesNetwork',event.target.value)} placeholder="Network or streaming platform" /></label>}
            {form.type === 'movie' && <label title={runtimeAvailable ? 'The complete running time in minutes' : 'Available when the title is released or its release date has arrived'}>Runtime in minutes {!runtimeAvailable && <small className="lifecycle-note">Available after release</small>}<input disabled={!runtimeAvailable} type="number" min="1" value={form.duration} onChange={(event) => update('duration', event.target.value)} /></label>}
            <CompanyEditor value={form.productionCompanies} onChange={(productionCompanies) => setForm((current) => ({ ...current,productionCompanies,productionCompany:productionCompanies.join(', ') }))} />
            <label title="Calculated from saved movie or episode watch dates">Viewing status<input readOnly value={form.type === 'movie' ? (watched ? 'Watched' : 'Not Watched') : (!watched ? 'Not Started' : form.seasons.every((season) => seasonCompletionStatus(season) === 'Completed') ? 'Completed' : 'In Progress')} /></label>
            <label title={watched ? 'Your personal assessment after watching this title' : 'Available after the title is marked Watched'}>Personal rating {!watched && <small className="lifecycle-note">Watched titles only</small>}<select disabled={!watched} value={form.rating} onChange={(event) => update('rating', event.target.value)}><option value="">Not rating</option>{PERSONAL_RATINGS.map((rating) => <option key={rating}>{rating}</option>)}</select></label>
            <label className="span-two">{animatedContent ? 'Voice Cast' : 'Cast'}<input value={form.casts} onChange={(event) => update('casts', event.target.value)} /></label>
          </div>
          </EditorSection>

          <EditorSection title="Classification & credits" description="Presentation, genre, languages, countries, credits, awards, tags and ratings">
          <div className="catalog-grid">
            <MultiSelect label="Presentation forms" help="Select how the work is produced or presented; available choices depend on movie or series type" options={catalogs.presentationForms?.[form.type] || []} grouped value={form.presentationForms} onChange={(value) => update('presentationForms',value)} />
            <MultiSelect label="Genres and subgenres" options={catalogs.genres} grouped value={form.genres} onChange={(value) => update('genres', value)} />
            <MultiSelect label="Languages" help="Languages used in the title's original production" options={languageOptions} value={form.language} onChange={(value) => update('language', value)} />
            <MultiSelect label="Origin countries" help="Select every official production country; cards show full country names" options={countryOptions} value={form.countryOfOrigin} onChange={(value) => update('countryOfOrigin', value)} />
            <MultiSelect disabled={!watched} label="Awards" help={watched ? 'Awards received by this title' : 'Available for watched titles only'} options={AWARDS.map((value) => ({ value,label:value }))} value={form.awards} onChange={(value) => update('awards', value)} />
            <MultiSelect disabled={!watched} label="Tags" help={watched ? 'Personal discovery and viewing tags' : 'Available for watched titles only'} options={TAGS.map((value) => ({ value,label:value }))} value={form.tags} onChange={(value) => update('tags', value)} />
          </div>

          {form.type === 'series' && <fieldset className="series-editor"><legend title="People credited across the complete series rather than individual episodes">Series credits</legend><button type="button" className="secondary-action" title="Add a creator, developer, showrunner, producer, or other whole-series credit" onClick={addSeriesCredit}><FaPlus /> Add series credit</button>{form.seriesCredits.map((credit,index) => <div className="source-input-row" key={credit.id || index}><label title="Person credited across the series">Name<input value={credit.name} onChange={(event) => updateSeriesCredit(index,{ name:event.target.value })} /></label><label title="The person's whole-series responsibility">Role<select value={credit.role} onChange={(event) => updateSeriesCredit(index,{ role:event.target.value })}>{SERIES_CREDIT_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label><button type="button" title={`Delete only the ${credit.role || 'series'} credit for ${credit.name || 'this person'}`} onClick={() => removeSeriesCredit(index)}><FaTrash /></button></div>)}</fieldset>}

          <fieldset className="rating-editor" disabled={!released} aria-disabled={!released} title={released ? 'Official age or content classification issued for each selected country or service' : 'Available after the title is released'}><legend>Official content ratings{!released && ' · released titles only'}</legend><div className="rating-controls"><select title="Choose the country or streaming-service rating authority" value={ratingTerritory} onChange={(event) => { setRatingTerritory(event.target.value); setRatingCode(''); }}>{catalogs.ratingSystems.map((system) => <option key={system.territory} value={system.territory}>{system.territory} · {system.authority}</option>)}</select><select title="Choose the official classification code" value={ratingCode} onChange={(event) => setRatingCode(event.target.value)}><option value="">Choose rating</option>{activeRatingSystem?.codes.map((code) => <option key={code}>{code}</option>)}</select><button type="button" title="Set this rating; an existing rating for the same territory will be replaced" onClick={addRating}>Set rating</button></div><div className="selected-chips">{form.contentRatings.map((rating, index) => <button type="button" title={`Remove ${rating.territory} ${rating.code}`} key={`${rating.territory}-${rating.code}-${index}`} onClick={() => removeRating(index)}>{rating.territory} {rating.code} ×</button>)}</div></fieldset>
          </EditorSection>

          <EditorSection title="Artwork & synopsis" description="Poster, trailer and the title summary">
          <div className="form-grid">
            <label title={trailerAvailable ? 'Official poster image URL' : 'Available from Trailer Only status'}>Poster URL {!trailerAvailable && <small>available from Trailer Only</small>}<input disabled={!trailerAvailable} type="url" value={form.posterUrl} onChange={(event) => update('posterUrl', event.target.value)} /></label>
            <label title={trailerAvailable ? 'Official trailer URL' : 'Available after a trailer has been released'}>Trailer URL {!trailerAvailable && <small>not released</small>}<input disabled={!trailerAvailable} type="url" value={form.trailerUrl} onChange={(event) => update('trailerUrl', event.target.value)} placeholder={trailerAvailable ? 'https://youtube.com/…' : 'Available from Trailer Only status'} /></label>
            <label className="span-two">Summary<textarea rows="5" value={form.summary} onChange={(event) => update('summary', event.target.value)} /></label>
          </div>
          </EditorSection>

          <EditorSection title="Viewing" description="Watch timeline and the services or formats used">
          {form.type === 'movie' && <fieldset className="series-editor" disabled={!form.releaseDate} title={form.releaseDate ? 'Add a date to mark this movie watched; remove every date to return it to Not Watched' : 'Add the release date before recording a viewing'}><legend>Watch timeline · viewing status is calculated</legend><button type="button" title="Add a viewing date; this changes viewing status to Watched" className="secondary-action" onClick={addWatch}><FaPlus /> Add watch date</button>{watchError && <p className="field-error" role="alert">{watchError}</p>}{form.watchHistory.map((entry,index) => <div className="history-row" key={entry.id || index}><BufferedDateInput title="The date this movie was watched" aria-label="Watch date" min={form.releaseDate || undefined} max={today} value={entry.watchedAt} onCommit={(dateValue) => updateWatch(index,dateValue)} /><select required title="Required audio language used for this viewing" aria-label="Watched in" value={entry.languageTag || ''} onChange={(event) => update('watchHistory',form.watchHistory.map((item,itemIndex) => itemIndex === index ? { ...item,languageTag:event.target.value } : item))}><option value="">Choose watched-in language · required</option>{languageOptions.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select><button type="button" title="Delete only this movie watch record" onClick={() => removeWatch(index)} aria-label="Remove watch date"><FaTrash /></button></div>)}</fieldset>}

          <fieldset className="series-editor source-editor" disabled={!watched} title={watched ? 'Record how and where this title was watched' : 'Available after the title is marked Watched'}><legend>Watching sources{!watched && ' · watched titles only'}</legend><button type="button" className="secondary-action" onClick={addSource}><FaPlus /> Add source</button>{sourceError && <p className="field-error" role="alert">{sourceError}</p>}{form.watchSources.map((source,index) => { const record=typeof source === 'string' ? { method:source,provider:'' } : source; const label=catalogs.watchSources.find((item) => item.id === record.method)?.label || 'selected method'; return <div className="source-input-row" key={`${index}-${record.method}`}><label>Method<select aria-label={`Watching method ${index + 1}`} value={record.method} onChange={(event) => { setSourceError(''); updateSource(index,{ method:event.target.value,provider:event.target.value ? record.provider : '' }); }}><option value="">Choose method</option>{catalogs.watchSources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{record.method && <label>Provider <small>optional</small><input aria-label={`Watching provider ${index + 1}`} value={record.provider || ''} onChange={(event) => { setSourceError(''); updateSource(index,{ provider:event.target.value }); }} placeholder={`Specific ${label.toLowerCase()} provider`} /></label>}<button type="button" onClick={() => removeSource(index)} aria-label={`Remove ${label} source`} title={`Remove ${label} source`}><FaTrash /></button></div>; })}</fieldset>
          </EditorSection>

          {form.type === 'series' && <EditorSection title="Seasons & episodes" description="Add seasons in batches, then open only the episode you need">
          {form.type === 'series' && <fieldset className="series-editor">
            <legend>Seasons and episodes</legend>
            <button type="button" className="secondary-action" title="Add a new season to this series" onClick={addSeason}><FaPlus /> Add season</button>
            {missingEpisodeWatchLanguages > 0 && <label title="Assign one confirmed audio language only to episode watch records that are currently missing it">Fill {missingEpisodeWatchLanguages} missing watched-in language{missingEpisodeWatchLanguages === 1 ? '' : 's'}<select value="" required onChange={(event) => fillMissingEpisodeWatchLanguages(event.target.value)}><option value="">Choose language</option>{languageOptions.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select></label>}
            {form.seasons.map((season, seasonIndex) => <details className="season-block" key={season.id || seasonIndex}>
              <summary className="season-card-header" title={`Expand or collapse Season ${season.seasonNumber || seasonIndex + 1}`}>
                <div><span className="eyebrow">SEASON {season.seasonNumber || seasonIndex + 1}</span><strong>{season.title || `Season ${season.seasonNumber || seasonIndex + 1}`}</strong></div>
                <small>{season.episodes?.length || 0} episode{season.episodes?.length === 1 ? '' : 's'}</small>
                <span className={`completion-badge completion-${seasonCompletionStatus(season).toLowerCase().replace(' ','-')}`} title="Calculated from episode watch dates">{seasonCompletionStatus(season)}</span>
              </summary>
              <div className="season-panel">
              <button className="section-delete" type="button" title={`Delete Season ${season.seasonNumber || seasonIndex + 1} and every episode and watch record inside it`} onClick={() => removeSeason(seasonIndex)} aria-label={`Remove season ${season.seasonNumber}`}><FaTrash /> Delete season</button>
              <div className="season-identity-grid"><label title="The season's unique number within this series">Season number<input title="Enter the season number" aria-label="Season number" type="number" min="0" value={season.seasonNumber} onChange={(event) => updateSeason(seasonIndex,{ seasonNumber:event.target.value })} /></label><label title="The official or descriptive season title">Season title<input title="Enter the season title; a blank value becomes Season followed by its number" aria-label="Season title" placeholder={`Season ${season.seasonNumber || seasonIndex + 1}`} value={season.title} onChange={(event) => updateSeason(seasonIndex,{ title:event.target.value })} /></label></div>
              <div className="season-meta-grid"><label title="The season's production-stage status">Production status<select title={PRODUCTION_STATUSES.find(([value]) => value === (season.productionStatus || 'Announced'))?.[1]} value={season.productionStatus || 'Announced'} onChange={(event) => updateSeason(seasonIndex,{ productionStatus:event.target.value })}>{PRODUCTION_STATUSES.map(([value,description]) => <option key={value} value={value} disabled={!seasonProductionAllowed(season,value)} title={description}>{value}</option>)}</select></label><label title="The season's public release status">Release status<select title={SEASON_RELEASE_STATUSES.find(([value]) => value === (season.releaseStatus || 'Unscheduled'))?.[1]} value={season.releaseStatus || 'Unscheduled'} onChange={(event) => updateSeason(seasonIndex,{ releaseStatus:event.target.value })}>{SEASON_RELEASE_STATUSES.map(([value,description]) => <option key={value} value={value} disabled={!seasonReleaseAllowed(season,value)} title={description}>{value}</option>)}</select></label></div>
              <div className="season-meta-grid"><label title="The date this season premiered">Premiere date<BufferedDateInput title="The complete date is copied to every episode in this season after editing is finished" aria-label="Season premiere date" min={form.seriesStartDate || undefined} max={today} value={season.releaseDate || ''} onCommit={(dateValue) => updateSeasonPremiere(seasonIndex,dateValue)} /></label><label title="A direct HTTP or HTTPS link to this season's poster">Season poster URL<input title="Enter the season-specific poster image URL" type="url" placeholder="https://example.com/season-poster.jpg" value={season.posterUrl || ''} onChange={(event) => updateSeason(seasonIndex,{ posterUrl:event.target.value })} /></label></div>
              <label className="season-synopsis" title="A summary describing this season as a whole">Season synopsis<textarea title="Enter the season synopsis" rows="3" value={season.synopsis || ''} onChange={(event) => updateSeason(seasonIndex,{ synopsis:event.target.value })} /></label>
              <label className="episode-count" title={seasonAcceptsEpisodes(season) ? 'Increase this number to generate episode entries; remove individual episodes with their delete button' : 'Set a premiere date, Completed production, and Airing or Released status before adding episodes'}>Number of episodes<input type="number" min={season.episodes?.length || 0} max="1000" disabled={!seasonAcceptsEpisodes(season)} value={season.episodes?.length || 0} onChange={(event) => setEpisodeCount(seasonIndex,event.target.value)} />{!seasonAcceptsEpisodes(season) && <small>Available after production is Completed and the season is Airing or Released with a premiere date.</small>}</label>
              <div className="episode-list">
              {season.episodes?.map((episode, episodeIndex) => <details className="episode-block" key={episode.id || episodeIndex}>
                <summary className="episode-collapse-header" title={`Expand or collapse Episode ${episode.episodeNumber || episodeIndex + 1}`}>
                  <span className="episode-number">E{episode.episodeNumber || episodeIndex + 1}</span>
                  <strong>{episode.title || `Episode ${episode.episodeNumber || episodeIndex + 1}`}</strong>
                  <small>{episode.episodeType || 'Regular'}{episode.airDate ? ` · ${episode.airDate}` : ''}</small>
                  <span className={episode.watchHistory?.length ? 'episode-seen' : 'episode-unseen'}>{episode.watchHistory?.length ? `${episode.watchHistory.length} watched` : 'Not watched'}</span>
                </summary>
                <div className="episode-panel">
                <div className="episode-primary-row">
                  <label title="The episode's unique number within this season">No.<input title="Enter the episode number" aria-label="Episode number" type="number" min="0" value={episode.episodeNumber} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ episodeNumber:event.target.value })} /></label>
                  <label title="The official or descriptive episode title">Episode title<input title="Enter the episode title; a blank value becomes Episode followed by its number" aria-label="Episode title" placeholder={`Episode ${episode.episodeNumber || episodeIndex + 1}`} value={episode.title} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ title:event.target.value })} /></label>
                  <label title="Classifies the episode's structural role in the season">Episode type<select title="Choose the episode's structural or scheduling role" value={episode.episodeType || 'Regular'} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ episodeType:event.target.value })}>{episodeTypes.map((type) => <option key={type} title={`Classify this episode as ${type}`}>{type}</option>)}</select></label>
                  <button type="button" title={`Delete Episode ${episode.episodeNumber || episodeIndex + 1} and all of its watch records`} onClick={() => removeEpisode(seasonIndex,episodeIndex)} aria-label="Remove episode"><FaTrash /></button>
                </div>
                <div className="episode-detail-row">
                  <label title="One or more episode directors, separated by commas">Director(s)<input title="Enter episode director names separated by commas" value={episode.director || ''} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ director:event.target.value })} /></label>
                  <label title="The episode's original release or broadcast date">Air date<BufferedDateInput title="Enter the complete episode air date" aria-label="Episode release date" min={season.releaseDate || form.seriesStartDate || undefined} max={today} value={episode.airDate || ''} onCommit={(dateValue) => updateEpisode(seasonIndex,episodeIndex,{ airDate:dateValue })} /></label>
                  <label title="The complete episode running time in minutes">Runtime<input title={runtimeAvailable ? 'Enter the runtime in minutes' : 'Runtime becomes editable after release'} aria-label="Episode runtime" disabled={!runtimeAvailable} type="number" min="1" placeholder="Minutes" value={episode.duration} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ duration:event.target.value })} /></label>
                </div>
                <label className="episode-summary" title="A concise synopsis of this episode">Episode summary<textarea title="Enter the episode summary" rows="2" value={episode.summary || ''} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ summary:event.target.value })} /></label>
                <div className="episode-watch-history" title={episode.airDate || season.releaseDate || form.seriesStartDate ? 'Add a date to mark this episode seen; season and series viewing statuses update automatically' : 'Add an episode, season, or series release date before recording a viewing'}><button title="Add a watch date; this episode then counts as seen" disabled={!(episode.airDate || season.releaseDate || form.seriesStartDate)} type="button" onClick={() => addEpisodeWatch(seasonIndex,episodeIndex)}><FaPlus /> Add episode watch</button>{(episode.watchHistory || []).map((entry,watchIndex) => <div className="history-row" key={entry.id || watchIndex}><BufferedDateInput title="The date this episode was watched" aria-label={`Episode ${episode.episodeNumber} watch date`} min={episode.airDate || season.releaseDate || form.seriesStartDate || undefined} max={today} value={entry.watchedAt} onCommit={(dateValue) => updateEpisodeWatch(seasonIndex,episodeIndex,watchIndex,dateValue)} /><select required title="Required audio language used for this episode viewing" aria-label={`Episode ${episode.episodeNumber} watched in`} value={entry.languageTag || ''} onChange={(event) => updateEpisode(seasonIndex,episodeIndex,{ watchHistory:(episode.watchHistory || []).map((item,index) => index === watchIndex ? { ...item,languageTag:event.target.value } : item) })}><option value="">Choose watched-in language · required</option>{languageOptions.map((language) => <option key={language.value} value={language.value}>{language.label}</option>)}</select><button title="Delete only this episode watch record" type="button" onClick={() => removeEpisodeWatch(seasonIndex,episodeIndex,watchIndex)} aria-label="Remove episode watch"><FaTrash /></button></div>)}</div>
                </div>
              </details>)}
              </div>
              </div>
            </details>)}
          </fieldset>}
          </EditorSection>}

          <EditorSection title="Availability" description={`Links where this ${form.type} can be found`}>
          <fieldset className="series-editor" disabled={!watched} title={watched ? `Links where this ${form.type} can be found` : `Available after the ${form.type} is marked Watched`}><legend>Where to find this {form.type}{!watched && ' · watched titles only'}</legend><button type="button" className="secondary-action" onClick={addLink}><FaPlus /> Add link</button>{form.contentLinks.map((entry,index) => <div className="link-input-row" key={entry.id || index}><input required={watched} aria-label={`${form.type} link`} type="url" placeholder={`https://example.com/${form.type}`} value={entry.url} onChange={(event) => updateLink(index,event.target.value)} /><button type="button" onClick={() => removeLink(index)} aria-label={`Remove ${form.type} link`}><FaTrash /></button></div>)}</fieldset>
          </EditorSection>

          <div className="modal-actions"><button type="button" title="Discard or close without saving" onClick={requestClose}>Cancel</button><button className="primary-action" title={initialData ? 'Validate and save all changes to this entry' : 'Validate and add this entry to the library'} type="submit">{initialData ? 'Save changes' : 'Add to library'}</button></div>
        </form>
      </section>
    </div>
  );
};

export default MovieForm;
