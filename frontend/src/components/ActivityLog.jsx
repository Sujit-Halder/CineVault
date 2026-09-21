import React,{ useEffect,useMemo,useRef,useState } from 'react';
import axios from 'axios';
import { FaCheckCircle,FaChevronRight,FaDownload,FaExclamationTriangle,FaSearch,FaTimesCircle } from 'react-icons/fa';

const API=import.meta.env.VITE_API_URL;
const categories=['Library','Viewing','Security','Backup','Transfer','Assets','System'];

// Converts internal audit actions into concise descriptions suitable for a personal activity timeline.
function describe(event) {
  const title=event.subjectTitle ? `“${event.subjectTitle}”` : event.entityType || 'The system';
  const descriptions={
    create:`${title} was added to the library`,update:`${title} was updated`,trash:`${title} was moved to Trash`,restore:`${title} was restored`,
    'restore-merge':`${title} was merged during conflict resolution`,'restore-replace':`${title} replaced a conflicting active entry`,
    'permanent-delete':`${title} was permanently deleted`,favorite:`${title} favorite status changed`,bulk_update:'A reviewed bulk lifecycle update was applied',
    backup:'A verified database backup was created',export:'Library data was exported',import:'Library data was imported',
    'auth.login-succeeded':'Owner login succeeded','auth.login-failed':'A login attempt failed','auth.logout':'The owner logged out',
    'auth.access-denied':'A protected request was denied','auth.csrf-rejected':'A request failed CSRF validation','security.rate-limited':'A request was rate limited',
    'system.started':'The backend started','system.stopped':'The backend stopped',merge:'Production-company records were merged',canonical_merge:'Canonical metadata values were merged',
  };
  return descriptions[event.action] || `${title}: ${String(event.action || 'activity').replace(/[._-]+/g,' ')}`;
}

// Formats nested change values without exposing an unreadable block in the collapsed timeline.
const displayValue=(value) => value == null || value === '' ? 'Empty' : typeof value === 'object' ? JSON.stringify(value) : String(value);

// Formats activity timestamps with a readable long-form calendar date while retaining the exact event time.
const formatActivityTimestamp=(value) => new Intl.DateTimeFormat('en-US',{
  month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit',
}).format(new Date(value));

// Presents immutable backend audit events as a searchable and expandable activity timeline.
export default function ActivityLog({ onOpen,onClose }) {
  const [filters,setFilters]=useState({ search:'',category:'',outcome:'',from:'',to:'' });
  const [result,setResult]=useState({ events:[],total:0,page:1,pages:0 });
  const [page,setPage]=useState(1); const [loading,setLoading]=useState(true); const [error,setError]=useState('');
  const topRef=useRef(null);

  useEffect(() => {
    let active=true; const timer=window.setTimeout(async () => {
      setLoading(true); setError('');
      try { const response=await axios.get(`${API}/api/v1/audit`,{ params:{ ...filters,page,limit:30 } }); if (active) setResult(response.data); }
      catch(error) { if (active) setError(error.response?.data?.message || 'Activity could not be loaded'); }
      finally { if (active) setLoading(false); }
    },filters.search ? 250 : 0);
    return () => { active=false; window.clearTimeout(timer); };
  },[filters,page]);

  useEffect(() => { setPage(1); },[filters]);
  const changed=(event) => [...new Set([...Object.keys(event.before || {}),...Object.keys(event.after || {})])];
  const exportRows=useMemo(() => result.events.map((event) => ({ timestamp:event.createdAt,category:event.category,outcome:event.outcome,action:event.action,description:describe(event),actor:event.actor,requestId:event.requestId || '' })),[result.events]);
  const download=(format) => {
    const content=format === 'json' ? JSON.stringify(exportRows,null,2) : ['Timestamp,Category,Outcome,Action,Description,Actor,Request ID',...exportRows.map((row) => Object.values(row).map((value) => `"${String(value).replaceAll('"','""')}"`).join(','))].join('\n');
    const url=URL.createObjectURL(new Blob([content],{ type:format === 'json' ? 'application/json' : 'text/csv' })); const anchor=document.createElement('a');
    anchor.href=url; anchor.download=`cinevault-activity-page-${page}.${format}`; anchor.click(); URL.revokeObjectURL(url);
  };

  return <section className="activity-page" ref={topRef}>
    <header className="health-hero activity-hero"><div><span className="eyebrow">ACCOUNTABILITY & DIAGNOSTICS</span><h2>Activity</h2><p>Readable history of library changes, security events, backups, transfers, conflicts and failures.</p></div><button className="secondary-action" onClick={onClose}>Return to library</button></header>
    <div className="activity-filters">
      <label className="activity-search"><FaSearch /><input aria-label="Search activity" placeholder="Search title, action or request ID" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current,search:event.target.value }))} /></label>
      <select aria-label="Activity category" value={filters.category} onChange={(event) => setFilters((current) => ({ ...current,category:event.target.value }))}><option value="">All categories</option>{categories.map((category) => <option key={category}>{category}</option>)}</select>
      <select aria-label="Activity outcome" value={filters.outcome} onChange={(event) => setFilters((current) => ({ ...current,outcome:event.target.value }))}><option value="">All outcomes</option><option value="success">Successful</option><option value="failure">Failed</option></select>
      <label>From<input aria-label="Activity from date" type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current,from:event.target.value }))} /></label>
      <label>To<input aria-label="Activity to date" type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current,to:event.target.value }))} /></label>
      <button type="button" onClick={() => setFilters({ search:'',category:'',outcome:'',from:'',to:'' })}>Clear</button>
    </div>
    <div className="activity-toolbar"><strong>{result.total.toLocaleString()} recorded events</strong><button onClick={() => download('json')}><FaDownload /> JSON page</button><button onClick={() => download('csv')}><FaDownload /> CSV page</button></div>
    {error && <p className="health-message" role="alert">{error}</p>}
    {loading ? <div className="empty-state">Loading activity…</div> : !result.events.length ? <div className="empty-state">No activity matches these filters.</div> : <div className="activity-timeline">
      {result.events.map((event) => <details className={`activity-event activity-${event.severity}`} key={event.id}>
        <summary><span className="activity-icon">{event.outcome === 'failure' ? <FaTimesCircle /> : event.severity === 'warning' ? <FaExclamationTriangle /> : <FaCheckCircle />}</span><div><strong>{describe(event)}</strong><small>{formatActivityTimestamp(event.createdAt)} · {event.category} · {event.actor || 'system'}</small></div><span className={`activity-outcome outcome-${event.outcome}`}>{event.outcome}</span><FaChevronRight /></summary>
        <div className="activity-details">
          {event.entityId && event.entityType === 'content' && <button className="secondary-action" onClick={() => onOpen(event.entityId)}>Open title</button>}
          {changed(event).length > 0 && <section><h3>Changes</h3><dl>{changed(event).map((field) => <div key={field}><dt>{field}</dt><dd><span>{displayValue(event.before?.[field])}</span><b>→</b><span>{displayValue(event.after?.[field])}</span></dd></div>)}</dl></section>}
          {Object.keys(event.details || {}).length > 0 && <section><h3>Details</h3><dl>{Object.entries(event.details).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{displayValue(value)}</dd></div>)}</dl></section>}
          <footer><span>Action: {event.action}</span>{event.requestId && <span>Request: {event.requestId}</span>}<span>Event #{event.id}</span></footer>
        </div>
      </details>)}
    </div>}
    {result.pages > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => { setPage((value) => value - 1); topRef.current?.scrollIntoView(); }}>Previous</button><span>Page {page} of {result.pages}</span><button disabled={page === result.pages} onClick={() => { setPage((value) => value + 1); topRef.current?.scrollIntoView(); }}>Next</button></div>}
  </section>;
}
