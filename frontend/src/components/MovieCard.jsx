import React, { useState } from 'react';
import { FaEdit, FaHeart, FaPlay, FaRegHeart, FaTrash, FaTrashRestore } from 'react-icons/fa';

// Extracts a supported YouTube video identifier from a trailer URL.
function getYouTubeId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) return parsed.pathname.slice(1);
    if (parsed.pathname.includes('/shorts/')) return parsed.pathname.split('/shorts/')[1];
    return parsed.searchParams.get('v');
  } catch { return null; }
}

// Formats an ISO date using the viewer's locale.
function formatDate(value) {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle:'medium' }).format(date);
}

// Converts a stored ISO country code into the viewer's localized country name.
function countryName(code) {
  try { return new Intl.DisplayNames(undefined,{ type:'region' }).of(code) || code; } catch { return code; }
}

// Formats the elapsed calendar time since a viewing record.
// relativeWatchTime.js
// Localized, calendar-based "time ago" labels: today, yesterday, N days/weeks/months/years ago.
// Calendar logic only: 23:59 yesterday vs 00:01 today counts as a day apart, not "2 minutes".

// ---- Clock correction ---------------------------------------------------
let clockOffsetMs = 0;

/** Correct a wrong device clock using a trusted server time (ms since epoch). */
export function syncClock(serverTimeMs, { latencyMs = 0 } = {}) {
  if (!Number.isFinite(serverTimeMs)) return;
  clockOffsetMs = serverTimeMs + latencyMs - Date.now();
}

/** Reset to the raw device clock. */
export function resetClock() {
  clockOffsetMs = 0;
}

/**
 * Read the server time from a response's Date header (1 s resolution).
 * Compensates for half the round-trip time and the truncated second.
 * Cross-origin servers must send `Access-Control-Expose-Headers: Date`.
 */
export async function syncClockFromServer(url = '/', fetchImpl = globalThis.fetch) {
  try {
    const t0 = Date.now();
    const res = await fetchImpl(url, { method: 'HEAD', cache: 'no-store' });
    const t1 = Date.now();
    const header = res.headers.get('Date');
    if (!header) return false;
    const server = new Date(header).getTime();
    if (Number.isNaN(server)) return false;
    syncClock(server + 500, { latencyMs: (t1 - t0) / 2 }); // +500 ms: header is floored to the second
    return true;
  } catch {
    return false; // offline or blocked: keep the device clock
  }
}

// ---- Caches -------------------------------------------------------------
const rtfCache = new Map();
const dtfCache = new Map();

function getFormatters(locale) {
  const key = Array.isArray(locale) ? locale.join(',') : String(locale);
  let pair = rtfCache.get(key);
  if (!pair) {
    const make = (loc) => ({
      auto: new Intl.RelativeTimeFormat(loc, { numeric: 'auto' }), // "today", "yesterday"
      always: new Intl.RelativeTimeFormat(loc, { numeric: 'always' }), // "1 week ago"
    });
    try {
      pair = make(locale);
    } catch {
      pair = make('en'); // invalid locale tag
    }
    rtfCache.set(key, pair);
  }
  return pair;
}

// ---- Calendar helpers ---------------------------------------------------
/** Year, zero-based month and day of `date` in `timeZone` (device zone if omitted). */
function calendarParts(date, timeZone) {
  if (!timeZone) {
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate() };
  }
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    }); // throws RangeError on an invalid zone; the caller falls back
    dtfCache.set(timeZone, dtf);
  }
  const p = {};
  for (const { type, value } of dtf.formatToParts(date)) p[type] = Number(value);
  return { y: p.year, m: p.month - 1, d: p.day };
}

const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function toDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---- Main ---------------------------------------------------------------
/**
 * @param {string|number|Date} value  ISO timestamp, epoch ms or Date
 * @param {object} [options]
 * @param {string|string[]} [options.locale]  BCP 47 tag(s); default: browser language
 * @param {string} [options.timeZone]         IANA zone; default: device zone
 * @param {Date|number} [options.now]         override "now" (tests)
 * @returns {string} label, or '' when value is missing/invalid
 */
export function relativeWatchTime(value, options = {}) {
  const then = toDate(value);
  if (!then) return '';

  const locale = options.locale ?? ((typeof navigator !== 'undefined' && navigator.language) || 'en');
  const now = toDate(options.now ?? Date.now() + clockOffsetMs);
  if (!now) return '';

  let tz = options.timeZone;
  let a, b;
  try {
    a = calendarParts(then, tz);
    b = calendarParts(now, tz);
  } catch {
    tz = undefined; // invalid time zone: use the device zone
    a = calendarParts(then, tz);
    b = calendarParts(now, tz);
  }

  const { auto, always } = getFormatters(locale);

  // Whole calendar days. UTC arithmetic on Y/M/D is exact, so DST can't skew it.
  const days = Math.max(0, (Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / 86400000);
  if (days < 2) return auto.format(-days, 'day'); // today, yesterday

  // Whole calendar months. The day-of-month is clamped to the current month's
  // length, so Jan 31 -> Feb 28 (or Mar 31 -> Apr 30) counts as a full month.
  let months = (b.y - a.y) * 12 + (b.m - a.m);
  if (b.d < Math.min(a.d, daysInMonth(b.y, b.m))) months--;

  if (months >= 12) return always.format(-Math.floor(months / 12), 'year');
  if (months >= 1) return always.format(-months, 'month');

  const weeks = Math.floor(days / 7);
  if (weeks >= 1) return always.format(-weeks, 'week');

  return auto.format(-days, 'day');
}

// Maps rating codes from supported territories to a shared maturity level.
function ratingLevel(rating = {}) {
  const normalized = String(rating.code || '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (rating.territory === 'IND' || rating.territory === 'IN') {
    if (normalized === 'A' || normalized === 'S') return 5;
  }
  const levels = {
    'G':1,'U':1,'L':1,'T':1,'ALL':1,'FSK 0':1,'TOUS PUBLICS':1,'A':1,
    'PG':2,'TV-Y':1,'TV-Y7':2,'TV-G':1,'6+':2,'7':2,'10':2,'FSK 6':2,'AA':1,
    'PG-13':3,'TV-PG':2,'TV-14':3,'12':3,'12A':3,'12+':3,'UA 7+':2,'UA 13+':3,'M':3,'14A':3,'B':3,'B15':3,'FSK 12':3,'PG12':3,'14':3,
    'R':4,'TV-MA':4,'15':4,'16':4,'16+':4,'18A':4,'MA 15+':4,'UA 16+':4,'FSK 16':4,'R15+':4,'19':4,'C':4,'-16':4,
    'NC-17':5,'18':5,'18+':5,'R18':5,'R 18+':5,'X 18+':5,'FSK 18':5,'R18+':5,'RESTRICTED':5,'D':5,'X':5,'-18':5,'S':5,'RC':5,
  };
  return levels[normalized] || 0;
}

// Returns the visual tone for the most restrictive rating on a content item.
function ratingTone(ratings = []) {
  const highest = ratings.reduce((level, rating) => Math.max(level, ratingLevel(rating)), 0);
  return ['unrated','general','guidance','teen','mature','restricted'][highest];
}

// Presents one movie or series with media, metadata, and primary actions.
const MovieCard = ({ movieData, catalogs, trashed = false, onEdit, onDelete, onToggleFavorite, onRestore, onPermanentDelete }) => {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const trailerId = getYouTubeId(movieData.trailerUrl);
  const ratings = movieData.contentRatings || [];
  const animatedContent=movieData.presentationForms?.some((item) => ['Animation','Anime','Adult Animation','Stop Motion'].includes(item));
  const sourceLabel=(method) => catalogs?.watchSources?.find((source) => source.id === method)?.label || method;
  const languageLabel=(tag) => catalogs?.languages?.find((language) => language.tag === tag)?.label || tag;
  const tone = ratingTone(ratings);
  const seriesEpisodes=movieData.seasons?.flatMap((season) => season.episodes || []) || [];
  const seriesWatchHistory=seriesEpisodes.flatMap((episode) => episode.watchHistory || []).sort((a,b) => new Date(b.watchedAt) - new Date(a.watchedAt));
  const effectiveWatchHistory=movieData.type === 'series' ? seriesWatchHistory : (movieData.watchHistory || []);
  const latestWatch=effectiveWatchHistory[0]?.watchedAt;
  const latestWatchLanguage=effectiveWatchHistory[0]?.languageTag ? languageLabel(effectiveWatchHistory[0].languageTag) : '';
  const watchedEpisodes=seriesEpisodes.filter((episode) => episode.watchHistory?.length > 0).length;
  const seriesWatchCount=seriesEpisodes.length > 0 ? Math.min(...seriesEpisodes.map((episode) => episode.watchHistory?.length || 0)) : 0;
  const seriesRuntime=seriesEpisodes.reduce((total,episode) => total + (Number(episode.duration) || 0),0);
  const displayRuntime=movieData.type === 'series' ? seriesRuntime : Number(movieData.duration || 0);

  return (
    <article className={`media-card rating-${tone}`} id={`title-${movieData.id}`}>
      <div className="poster-column">
        {movieData.posterUrl ? <img src={movieData.posterUrl} alt={`${movieData.title} poster`} loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} /> : <div className="poster-placeholder">No poster</div>}
        <span className="type-badge">{movieData.type} · {movieData.subtype}</span>
      </div>
      <div className="card-information">
        <div className="title-line">
          <div><h3>{movieData.title}</h3><div className="lifecycle-line" aria-label={`Production ${movieData.productionStatus}; release ${movieData.releaseStatus}; viewing ${movieData.viewingStatus}`}><span className="production-state" title={`Production status: ${movieData.productionStatus}`}><i aria-hidden="true" />{movieData.productionStatus}</span><span className="release-state" title={`Release status: ${movieData.releaseStatus}`}><i aria-hidden="true" />{movieData.releaseStatus}</span><span className="viewing-state" title={`Viewing status: ${movieData.viewingStatus}; calculated from saved watch dates`}><i aria-hidden="true" />{movieData.viewingStatus}</span></div></div>
          {!trashed && <button className="icon-action favorite" onClick={onToggleFavorite} aria-label="Toggle favorite" title={movieData.favorite ? 'Remove from favorites' : 'Add to favorites'}>{movieData.favorite ? <FaHeart /> : <FaRegHeart />}</button>}
        </div>
        <div className="metadata-row">
          {movieData.releaseDate && <span title={`${movieData.type === 'series' ? 'Series' : 'Movie'} release date: ${formatDate(movieData.releaseDate)}`}>{formatDate(movieData.releaseDate)}</span>}
          {latestWatch && movieData.type === 'movie' && <span title={`${effectiveWatchHistory.length} recorded movie watch${effectiveWatchHistory.length === 1 ? '' : 'es'}; latest at ${new Date(latestWatch).toLocaleString()}${latestWatchLanguage ? `; audio language ${latestWatchLanguage}` : ''}`}>Watched {effectiveWatchHistory.length}× · {formatDate(latestWatch)} · {relativeWatchTime(latestWatch)}{latestWatchLanguage && ` · ${latestWatchLanguage}`}</span>}
          {latestWatch && movieData.type === 'series' && <span title={`Latest episode watch: ${new Date(latestWatch).toLocaleString()}${latestWatchLanguage ? `; audio language ${latestWatchLanguage}` : ''}`}>Last episode watched {formatDate(latestWatch)} · {relativeWatchTime(latestWatch)}{latestWatchLanguage && ` · ${latestWatchLanguage}`}</span>}
          {displayRuntime > 0 && <span title={movieData.type === 'series' ? 'Sum of the runtimes of all existing episodes' : 'Movie runtime'}>{displayRuntime} min</span>}
          {movieData.language?.map((language) => <span key={language} title={`Original-production language: ${languageLabel(language)}`}>{languageLabel(language)}</span>)}
          {movieData.countryOfOrigin?.map((country) => <span key={country} title={`Origin country: ${countryName(country)} (${country})`}>{countryName(country)}</span>)}
          {ratings.map((rating, index) => <span title={`${rating.system || 'Official content rating'} · ${rating.territory} ${rating.code}`} key={`${rating.territory}-${rating.code}-${index}`}>{rating.territory} {rating.code}</span>)}
        </div>
        {(movieData.presentationForms?.length > 0 || movieData.genres?.length > 0) && <div className="genre-row classification-row">{movieData.presentationForms?.map((item) => <span className="presentation-form" key={`form-${item}`} title={`Presentation form: ${item}`}>{item}</span>)}{movieData.genres?.map((genre) => <span key={`genre-${genre}`} title={`Genre: ${genre}`}>{genre}</span>)}</div>}
        {movieData.tags?.length > 0 && <div className="tag-row">{movieData.tags.map((tag) => <span key={tag}>#{tag.toLowerCase().replace(/\s+/g, '_')}</span>)}</div>}
        {movieData.type === 'movie' && movieData.director && <p><strong>Director</strong> {movieData.director}</p>}
        {movieData.type === 'series' && movieData.seriesCredits?.length > 0 && <p title="Credits applying to the complete series"><strong>Series credits</strong> {movieData.seriesCredits.map((credit) => `${credit.name} · ${credit.role}`).join(' | ')}</p>}
        {movieData.type === 'series' && movieData.seriesNetwork && <p><strong>Network</strong> {movieData.seriesNetwork}</p>}
        {movieData.watchSources?.length > 0 && <p><strong>Watched via</strong> {movieData.watchSources.map((source) => `${sourceLabel(source.method)}${source.provider ? ` · ${source.provider}` : ''}`).join(' | ')}</p>}
        {movieData.casts && <p><strong>{animatedContent ? 'Voice Cast' : 'Cast'}</strong> {movieData.casts}</p>}
        {movieData.rating && <p><strong>special rating</strong> {movieData.rating}</p>}
        {movieData.awards?.length > 0 && <p><strong>Award</strong> {movieData.awards.join(' · ')}</p>}
        {movieData.contentLinks?.length > 0 && <div className="content-links"><strong>Search in</strong>{movieData.contentLinks.map((link) => <a key={link.id || link.url} href={link.url} target="_blank" rel="noreferrer" title={link.url}>{link.domain}</a>)}</div>}
        {movieData.summary && <div className="summary"><p>{expanded ? movieData.summary : `${movieData.summary.slice(0, 220)}${movieData.summary.length > 220 ? '…' : ''}`}</p>{movieData.summary.length > 220 && <button onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show less' : 'Read more'}</button>}</div>}
        {movieData.type === 'series' && <p className="series-summary" title="A complete series watch is counted only when every existing episode has been watched once"><strong>{movieData.seasons?.length || 0}</strong> seasons · <strong>{seriesEpisodes.length}</strong> episodes{watchedEpisodes > 0 && <> · <strong>{watchedEpisodes}</strong> watched</>}{seriesWatchCount > 0 && <> · series watched <strong>{seriesWatchCount}×</strong></>}</p>}
        {movieData.type === 'series' && movieData.seriesStartDate && <p className="series-dates"><strong>Run</strong> {formatDate(movieData.seriesStartDate)} — {movieData.seriesContinuing ? 'Ongoing' : movieData.seriesEndDate ? formatDate(movieData.seriesEndDate) : 'End date unknown'}</p>}
        {trashed && movieData.deletedAt && <p className="trash-date"><strong>Trashed</strong> {formatDate(movieData.deletedAt)}</p>}
        <small>Updated {formatDate(movieData.modification)}</small>
      </div>
      <div className="trailer-column">
        {trailerId ? playing ? <iframe src={`https://www.youtube.com/embed/${trailerId}?autoplay=1`} title={`${movieData.title} trailer`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen /> : (
          <button className="trailer-preview" onClick={() => setPlaying(true)} title="Play the embedded trailer"><img src={`https://img.youtube.com/vi/${trailerId}/hqdefault.jpg`} alt="" /><span><FaPlay /> Play trailer</span></button>
        ) : <div className="trailer-placeholder">Trailer unavailable</div>}
        <div className="card-actions">{trashed ? <><button onClick={onRestore} title="Return this entry to the library"><FaTrashRestore /> Restore</button><button className="danger" onClick={onPermanentDelete} title="Permanently delete this entry after creating a recovery backup"><FaTrash /> Delete forever</button></> : <><button onClick={onEdit} title="Edit this library entry"><FaEdit /> Edit</button><button className="danger" onClick={onDelete} title="Move this entry to recoverable trash"><FaTrash /> Trash</button></>}</div>
      </div>
    </article>
  );
};

export default MovieCard;
