import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL;
const COLORS = ['#d49352','#4b8fc8','#4ca66a','#9b5ec2','#d06455','#7f8c8d'];

// Converts an aggregate object into descending chart rows.
function rowsOf(values = {}, limit) {
  const rows = Object.entries(values).sort((a,b) => b[1] - a[1]);
  return limit ? rows.slice(0,limit) : rows;
}

// Renders an accessible horizontal distribution chart.
function BarChart({ title, values, limit = 12 }) {
  const rows = rowsOf(values,limit);
  const maximum = Math.max(...rows.map(([,value]) => value),1);
  return <section className="stat-panel"><h3>{title}</h3><div className="bar-chart">{rows.map(([label,value]) => <div className="bar-row" key={label}><span title={label}>{label}</span><div><i style={{ width:`${value / maximum * 100}%` }} /></div><strong>{value}</strong></div>)}</div></section>;
}

// Renders a compact pie chart with a matching textual legend.
function PieChart({ title, values }) {
  const rows = rowsOf(values);
  const total = rows.reduce((sum,[,value]) => sum + value,0) || 1;
  let cursor = 0;
  const stops = rows.map(([,value],index) => { const start=cursor; cursor += value / total * 100; return `${COLORS[index % COLORS.length]} ${start}% ${cursor}%`; });
  return <section className="stat-panel pie-panel"><h3>{title}</h3><div className="pie-layout"><div className="pie-chart" style={{ background:`conic-gradient(${stops.join(',')})` }} role="img" aria-label={`${title}: ${rows.map(([key,value]) => `${key} ${value}`).join(', ')}`} /><div className="pie-legend">{rows.map(([label,value],index) => <div key={label}><i style={{ background:COLORS[index % COLORS.length] }} /><span>{label}</span><strong>{value}</strong></div>)}</div></div></section>;
}

// Presents visual and written summaries calculated by the SQLite statistics endpoint.
export default function Statistics() {
  const [data,setData] = useState(null);
  const [error,setError] = useState('');
  useEffect(() => { axios.get(`${API}/api/v1/statistics`).then((response) => setData(response.data)).catch(() => setError('Statistics could not be loaded.')); },[]);
  const leadingGenre = useMemo(() => data ? rowsOf(data.genres,1)[0] : null,[data]);
  const leadingCountry = useMemo(() => data ? rowsOf(data.countries,1)[0] : null,[data]);
  if (error) return <section className="content-area"><div className="empty-state">{error}</div></section>;
  if (!data) return <section className="content-area"><div className="empty-state">Calculating library statistics…</div></section>;
  const summary = data.summary;
  return <section className="content-area statistics-page"><div className="statistics-heading"><span className="eyebrow">LIBRARY REPORT</span><h2>Your viewing collection at a glance</h2><p>Generated from active SQLite records and individual watch-history events.</p></div>
    <div className="summary-grid">
      {[
        ['Library titles',summary.total,'All active movie and series entries'],['Watched titles',summary.watchedTitles,'Titles with at least one movie or episode watch record'],['Watch sessions',summary.totalWatchSessions,'Movie watches plus individual episode watches'],['Rewatched titles',summary.rewatchedTitles,'Movies watched more than once and series completed more than once'],['Minutes watched',summary.totalMinutesWatched.toLocaleString(),'Runtime multiplied by every recorded movie or episode watch'],['Episodes watched',summary.episodesWatched,'Distinct episodes with at least one watch record'],['Episode sessions',summary.episodeWatchSessions,'All episode watch records, including rewatches'],['Complete series watches',summary.seriesWatchCycles,'Complete viewing cycles; each existing episode must be watched once per cycle'],['Rewatched episodes',summary.rewatchedEpisodes,'Episodes with more than one watch record'],['Completed seasons',summary.completedSeasons,'Seasons whose existing episodes have all been watched'],['Completed series',summary.completedSeries,'Series whose existing episodes have all been watched at least once'],['Series in progress',summary.partiallyWatchedSeries,'Series with some but not all existing episodes watched'],['Mode rating',summary.modePersonalRating ?? '—','Most frequently used personal rating'],['Rated titles',`${summary.ratedTitles} / ${summary.total}`,'Entries with a personal rating'],['Linked titles',`${summary.linkedTitles} / ${summary.total}`,'Entries with at least one content-location link'],
      ].map(([label,value,help]) => <article key={label} title={help}><span>{label}</span><strong>{value}</strong></article>)}
    </div>
    <div className="written-report"><h3>Written summary</h3><p>Your library contains <strong>{summary.total}</strong> active titles, with <strong>{summary.watchedTitles}</strong> titles watched across <strong>{summary.totalWatchSessions}</strong> recorded sessions. The most common personal rating is <strong>{summary.modePersonalRating || 'not yet available'}</strong>. {leadingGenre && <>The most represented genre is <strong>{leadingGenre[0]}</strong> ({leadingGenre[1]} titles).</>} {leadingCountry && <>The leading origin country is <strong>{leadingCountry[0]}</strong> ({leadingCountry[1]} titles).</>} The top three countries are <strong>{summary.topCountries.map((country) => `${country.code} (${country.total})`).join(', ') || 'not available'}</strong>.</p></div>
    <div className="statistics-grid"><PieChart title="Movies and series" values={data.types} /><PieChart title="Production status" values={data.productionStatuses} /><PieChart title="Release status" values={data.releaseStatuses} /><PieChart title="Viewing status" values={data.viewingStatuses} /><PieChart title="Series completion" values={data.seriesCompletion} /><BarChart title="Genres" values={data.genres} /><BarChart title="Presentation forms" values={data.presentationForms} /><BarChart title="Countries of origin" values={data.countries} /><BarChart title="Viewing by weekday" values={data.weekdayActivity} limit={7} /><BarChart title="Watch activity by month" values={data.watchActivity} limit={18} /><BarChart title="Library additions by month" values={data.libraryGrowth} limit={18} /><BarChart title="Runtime distribution" values={data.runtimeDistribution} limit={5} /><BarChart title="Release decades" values={data.releaseDecades} /><BarChart title="Personal ratings" values={data.personalRatings} /><BarChart title="Content classifications" values={data.contentRatings} /><BarChart title="Watching sources" values={data.sourceMethods} /><BarChart title="Linked domains" values={data.linkDomains} /></div>
  </section>;
}
