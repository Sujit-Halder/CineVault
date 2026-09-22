const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { database, EXPORT_DIR, createBackup: createDatabaseBackup } = require('./database');
const { normalizeCountryCodes, normalizeContentRatings, normalizeWatchSources, normalizeSubtype,normalizePresentationForms,getCatalogs,EPISODE_TYPES } = require('./catalogs');
const { normalizeSingleLineText, normalizeCommaSeparatedText, normalizeMultilineText } = require('./text-normalization');
const { fullCompanyName,companyKey } = require('./company-normalization');

// Parses a stored JSON value and returns a safe fallback when it is malformed.
function parseJson(value, fallback = []) {
    try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

const PRODUCTION_STATUSES=['Rumored','Announced','In Development','Pre-Production','Filming / Production','Post-Production','Completed','Canceled','Shelved'];
const MOVIE_RELEASE_STATUSES=['Unscheduled','Upcoming','Released','Canceled','Withheld'];
const SERIES_RELEASE_STATUSES=['Unknown','Unscheduled','Upcoming','Airing','Between Seasons','Hiatus','Returning','Ended','Canceled'];
const SEASON_RELEASE_STATUSES=['Unscheduled','Upcoming','Airing','Released','Canceled'];

// Calculates viewing progress exclusively from movie or episode viewing records.
function viewingStatus(type,watchHistory=[],seasons=[]) {
    if (type === 'movie') return watchHistory.length ? 'Watched' : 'Not Watched';
    const episodes=seasons.flatMap((season) => season.episodes || []);
    const watched=episodes.filter((episode) => episode.watchHistory?.length).length;
    if (!watched) return 'Not Started';
    return episodes.length && watched === episodes.length ? 'Completed' : 'In Progress';
}

// Returns ordered whole-series creative and production credits.
function getSeriesCredits(seriesId) {
    return database.prepare('SELECT id,person_name,role FROM series_credits WHERE series_id=? ORDER BY display_order,person_name COLLATE NOCASE').all(seriesId)
        .map((row) => ({ id:row.id,name:row.person_name,role:row.role }));
}

// Converts a database row into the API content representation.
function mapContentRow(row,related = {}) {
    if (!row) return null;
    const contentRatings = parseJson(row.content_ratings_json);
    const watchSources = parseJson(row.watch_sources_json);
    return {
        id: row.id, type: row.type, subtype: row.subtype, title: row.title, originalTitle: row.original_title,
        productionStatus:row.production_status || 'Announced',releaseStatus:row.release_status || 'Unscheduled', releaseDate: row.release_date || '', watchDate: row.latest_watch_date || '',
        seriesStartDate:row.series_start_date || '',seriesEndDate:row.series_end_date || '',seriesContinuing:Boolean(row.series_continuing),
        seriesNetwork:row.series_network || '',
        duration: row.runtime_minutes == null ? '' : String(row.runtime_minutes), director: row.director, casts: row.casts,
        rating: row.personal_rating, productionCompany: row.production_company,
        productionCompanies:related.productionCompanies ?? getProductionCompanyNames(row.id),posterUrl: row.poster_url,
        trailerUrl: row.trailer_url, summary: row.summary,
        favorite: Boolean(row.favorite), genres: parseJson(row.genres_json),presentationForms:parseJson(row.presentation_forms_json),language: parseJson(row.languages_json),
        awards: parseJson(row.awards_json), tags: parseJson(row.tags_json), countryOfOrigin: parseJson(row.countries_json),
        contentRatings, watchSources, watchHistory:related.watchHistory || getWatchHistory(row.id), contentLinks:related.contentLinks || getContentLinks(row.id),
        creation: row.created_at, modification: row.updated_at, deletedAt:row.deleted_at || null,
        seriesCredits:related.seriesCredits ?? (row.type === 'series' ? getSeriesCredits(row.id) : []),
        viewingStatus:viewingStatus(row.type,related.watchHistory || getWatchHistory(row.id),related.seasons || (row.type === 'series' ? getSeriesStructure(row.id) : [])),
        ...(related.seasons ? { seasons:related.seasons } : {}),
    };
}

// Hydrates a page of content with two batched child queries instead of querying per card.
function hydrateContentRows(rows) {
    if (!rows.length) return [];
    const placeholders=rows.map(() => '?').join(',');
    const histories=new Map(rows.map((row) => [row.id,[]]));
    const links=new Map(rows.map((row) => [row.id,[]]));
    const companies=new Map(rows.map((row) => [row.id,[]]));
    const credits=new Map(rows.map((row) => [row.id,[]]));
    const seriesStructures=getSeriesStructures(rows.filter((row) => row.type === 'series').map((row) => row.id));
    database.prepare(`SELECT id,content_id,watched_at FROM watch_history WHERE content_id IN (${placeholders}) ORDER BY watched_at DESC`).all(...rows.map((row) => row.id))
        .forEach((row) => histories.get(row.content_id).push({ id:row.id,watchedAt:row.watched_at }));
    database.prepare(`SELECT id,content_id,url,domain FROM content_links WHERE content_id IN (${placeholders}) ORDER BY domain,url`).all(...rows.map((row) => row.id))
        .forEach((row) => links.get(row.content_id).push({ id:row.id,url:row.url,domain:row.domain }));
    database.prepare(`SELECT cpc.content_id,pc.name FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
        WHERE cpc.content_id IN (${placeholders}) ORDER BY pc.name COLLATE NOCASE`).all(...rows.map((row) => row.id))
        .forEach((row) => companies.get(row.content_id).push(row.name));
    database.prepare(`SELECT series_id,id,person_name,role FROM series_credits WHERE series_id IN (${placeholders}) ORDER BY display_order,person_name COLLATE NOCASE`).all(...rows.map((row) => row.id))
        .forEach((row) => credits.get(row.series_id).push({ id:row.id,name:row.person_name,role:row.role }));
    return rows.map((row) => mapContentRow(row,{ watchHistory:histories.get(row.id),contentLinks:links.get(row.id),
        productionCompanies:companies.get(row.id),seriesCredits:credits.get(row.id),seasons:row.type === 'series' ? seriesStructures.get(row.id) || [] : undefined }));
}

// Normalizes a title for duplicate comparison.
function normalizeTitle(title = '') {
    return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Groups rotating Jalshamoviez hostnames under one stable service label.
function normalizeLinkDomain(domain = '') {
    const value = String(domain).trim().toLowerCase().replace(/^www\./, '');
    return /^jals?hamoviez\d*\.(?:com|click)$/.test(value) ? 'jalshamoviez' : value;
}

// Produces a punctuation-insensitive key for reviewable human-name and provider variants.
function canonicalValueKey(value='') { return normalizeSingleLineText(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,''); }

// Returns the calendar date represented by a timestamp in the library's local timezone.
function localCalendarDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return '';
    return new Intl.DateTimeFormat('en-CA', {
        timeZone:process.env.MOVIE_TRACKER_TIME_ZONE || 'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit',
    }).format(date);
}

// Verifies that a YYYY-MM-DD value represents a real Gregorian calendar date.
function isCalendarDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    const [year,month,day]=String(value).split('-').map(Number);
    const date=new Date(Date.UTC(year,month - 1,day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Resolves submitted company names through full-name expansion, aliases, and canonical keys.
function normalizeSubmittedCompanies(payload) {
    const raw=Array.isArray(payload.productionCompanies) ? payload.productionCompanies : String(payload.productionCompany || '').split(',');
    const find=database.prepare(`SELECT pc.name FROM production_companies pc WHERE pc.name=? COLLATE NOCASE OR pc.canonical_name=?
        OR EXISTS(SELECT 1 FROM production_company_aliases a WHERE a.company_id=pc.id AND a.alias=? COLLATE NOCASE)
        ORDER BY CASE WHEN pc.name=? COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1`);
    const aliases=[];
    const names=[];
    raw.map((value) => normalizeSingleLineText(value)).filter(Boolean).forEach((submittedName) => {
        const expanded=fullCompanyName(submittedName);
        const name=find.get(expanded,companyKey(expanded),submittedName,expanded)?.name || expanded;
        if (!names.includes(name)) names.push(name);
        aliases.push({ alias:submittedName,name });
    });
    return { names,aliases };
}

// Builds a validated persistence record from an API payload.
function normalizePayload(payload, existing = {}) {
    if (Object.hasOwn(payload,'contentRating') || Object.hasOwn(payload,'sourceOfWatch')) {
        throw Object.assign(new Error('Use contentRatings and watchSources structured fields'), { status:400 });
    }
    const now = new Date().toISOString();
    const today = localCalendarDate(now);
    const type = payload.type === 'series' ? 'series' : 'movie';
    const cleanText = (value) => String(value ?? '').trim();
    const cleanList = (values) => [...new Set((Array.isArray(values) ? values : []).map(cleanText).filter(Boolean))];
    const cleanCommaList = normalizeCommaSeparatedText;
    const genres=cleanList(payload.genres);
    const presentationForms=normalizePresentationForms(type,payload.presentationForms);
    const animated=presentationForms.some((form) => ['Animation','Anime','Adult Animation','Stop Motion'].includes(form));
    const casts=cleanCommaList(animated ? cleanText(payload.casts).replace(/\s*\(v\)/gi,'') : payload.casts);
    const requireLength = (value,label,maximum) => {
        if (String(value || '').length > maximum) throw Object.assign(new Error(`${label} must be ${maximum} characters or fewer`),{ status:400 });
    };
    requireLength(payload.title,'Title',300); requireLength(payload.originalTitle,'Original title',300);
    requireLength(payload.director,'Director or creator',1000); requireLength(payload.casts,'Cast',5000);
    requireLength(payload.productionCompany,'Production companies',3000); requireLength(payload.summary,'Summary',20000);
    requireLength(payload.seriesNetwork,'Network',500);
    const legacyStatus=cleanText(payload.status);
    const legacyProduction={ Announced:'Announced','Production Started':'Filming / Production',Filming:'Filming / Production' };
    const legacyRelease={ 'Trailer Only':'Upcoming',Released:'Released',Watched:type === 'movie' ? 'Released' : 'Unknown' };
    const productionStatus=PRODUCTION_STATUSES.includes(cleanText(payload.productionStatus)) ? cleanText(payload.productionStatus)
        : legacyProduction[legacyStatus] || (existing.productionStatus === 'Unknown' ? 'Announced' : existing.productionStatus) || 'Announced';
    const releaseStatuses=type === 'series' ? SERIES_RELEASE_STATUSES : MOVIE_RELEASE_STATUSES;
    const releaseStatus=releaseStatuses.includes(cleanText(payload.releaseStatus)) ? cleanText(payload.releaseStatus)
        : legacyRelease[legacyStatus] || existing.releaseStatus || 'Unscheduled';
    const released=type === 'movie' ? releaseStatus === 'Released' : ['Airing','Between Seasons','Hiatus','Returning','Ended'].includes(releaseStatus);
    const trailerAvailable=!['Unscheduled','Unknown'].includes(releaseStatus);
    const releaseDate=type === 'series' ? (cleanText(payload.seriesStartDate) || cleanText(payload.releaseDate) || null) : (cleanText(payload.releaseDate) || null);
    const runtimeAvailable = released || Boolean(releaseDate && releaseDate <= today);
    const submittedRatings = released && Array.isArray(payload.contentRatings) ? payload.contentRatings : (existing.contentRatings || []);
    const contentRatings = normalizeContentRatings(submittedRatings);
    const seriesEndDate=cleanText(payload.seriesEndDate);
    if (releaseDate && !isCalendarDate(releaseDate)) throw Object.assign(new Error('Release date must be a real calendar date'),{ status:400 });
    if (releaseDate && releaseDate > today) throw Object.assign(new Error('Release date cannot be in the future'),{ status:400 });
    for (const [label,value] of [['Series start date',cleanText(payload.seriesStartDate)],['Series end date',seriesEndDate]]) {
        if (value && !isCalendarDate(value)) throw Object.assign(new Error(`${label} must be a real calendar date`),{ status:400 });
        if (value && value > today) throw Object.assign(new Error(`${label} cannot be in the future`),{ status:400 });
    }
    if (type === 'series' && seriesEndDate && !releaseDate) {
        throw Object.assign(new Error('Add the series release date before its end date'),{ status:400 });
    }
    if (type === 'series' && seriesEndDate && seriesEndDate <= releaseDate) {
        throw Object.assign(new Error('Series end date must be later than its release date'),{ status:400 });
    }
    if (type === 'series' && releaseStatus === 'Ended' && !seriesEndDate) {
        throw Object.assign(new Error('End date is required when a series is not ongoing'),{ status:400 });
    }
    const submittedRuntime = runtimeAvailable ? payload.duration : (existing.duration ?? '');
    const numericRuntime = submittedRuntime === '' || submittedRuntime == null ? null : Number(submittedRuntime);
    if (numericRuntime != null && (!Number.isInteger(numericRuntime) || numericRuntime < 1 || numericRuntime > 100000)) {
        throw Object.assign(new Error('Runtime must be a positive whole number of minutes'),{ status:400 });
    }
    for (const [label,value] of [['Poster URL',trailerAvailable ? payload.posterUrl : ''],['Trailer URL',trailerAvailable ? payload.trailerUrl : '']]) {
        const normalizedValue=cleanText(value);
        if (!normalizedValue) continue;
        try { const url=new URL(normalizedValue); if (!['http:','https:'].includes(url.protocol)) throw new Error(); }
        catch { throw Object.assign(new Error(`${label} must be a valid HTTP or HTTPS URL`),{ status:400 }); }
    }
    const submittedSources = Array.isArray(payload.watchSources) ? payload.watchSources : (existing.watchSources || []);
    const watchSources = normalizeWatchSources(submittedSources);
    const watchHistory = (type === 'movie' && Array.isArray(payload.watchHistory) ? payload.watchHistory : (existing.watchHistory || [])).map((entry) => ({
        id:entry.id || crypto.randomUUID(),watchedAt:String(entry.watchedAt || '').trim(),
    })).filter((entry) => entry.watchedAt && !Number.isNaN(Date.parse(entry.watchedAt)));
    if (watchHistory.some((entry) => /^\d{4}-\d{2}-\d{2}/.test(entry.watchedAt) && !isCalendarDate(entry.watchedAt.slice(0,10)))) {
        throw Object.assign(new Error('Watch dates must be real calendar dates'),{ status:400 });
    }
    if (watchHistory.some((entry) => Date.parse(entry.watchedAt) > Date.now())) {
        throw Object.assign(new Error('Watch dates and times cannot be in the future'),{ status:400 });
    }
    if (watchHistory.some((entry) => localCalendarDate(entry.watchedAt) < releaseDate)) {
        throw Object.assign(new Error('Watch dates cannot be earlier than the release date'),{ status:400 });
    }
    const existingSeasons=Array.isArray(existing.seasons) ? existing.seasons : [];
    const seasons = (Array.isArray(payload.seasons) ? payload.seasons : []).map((season) => {
        const existingSeason=existingSeasons.find((item) => item.id === season.id)
            || existingSeasons.find((item) => Number(item.seasonNumber) === Number(season.seasonNumber));
        return { ...season,episodes:(season.episodes || []).map((episode) => {
            const existingEpisode=existingSeason?.episodes?.find((item) => item.id === episode.id)
                || existingSeason?.episodes?.find((item) => Number(item.episodeNumber) === Number(episode.episodeNumber));
            return { ...episode,airDate:episode.airDate || season.releaseDate || '',duration:runtimeAvailable ? episode.duration : (existingEpisode?.duration ?? ''),
                watchHistory:Array.isArray(episode.watchHistory)
                    ? episode.watchHistory : (existingEpisode?.watchHistory || []) };
        }) };
    });
    seasons.forEach((season) => {
        if (season.releaseDate && !isCalendarDate(season.releaseDate)) throw Object.assign(new Error('Season premiere dates must be real calendar dates'),{ status:400 });
        if (season.releaseDate && season.releaseDate > today) throw Object.assign(new Error('Season premiere dates cannot be in the future'),{ status:400 });
        const episodeNumbers=(season.episodes || []).map((episode) => Number(episode.episodeNumber));
        if (new Set(episodeNumbers).size !== episodeNumbers.length) throw Object.assign(new Error('Episode numbers must be unique within a season'),{ status:400 });
        (season.episodes || []).forEach((episode) => {
            if (episode.airDate && !isCalendarDate(episode.airDate)) throw Object.assign(new Error('Episode release dates must be real calendar dates'),{ status:400 });
            if (episode.airDate && !releaseDate) {
                throw Object.assign(new Error('Add the series release date before an episode release date'),{ status:400 });
            }
            if (episode.airDate && episode.airDate < releaseDate) {
                throw Object.assign(new Error('Episode release dates cannot be earlier than the series release date'),{ status:400 });
            }
            if (episode.airDate && season.releaseDate && episode.airDate < season.releaseDate) {
                throw Object.assign(new Error('Episode air dates cannot be earlier than the season premiere date'),{ status:400 });
            }
            if (episode.airDate && episode.airDate > today) throw Object.assign(new Error('Episode release dates cannot be in the future'),{ status:400 });
            const earliestWatchDate = episode.airDate || releaseDate;
            const episodeHistory = Array.isArray(episode.watchHistory) ? episode.watchHistory : [];
            if (episodeHistory.some((entry) => /^\d{4}-\d{2}-\d{2}/.test(String(entry.watchedAt || '')) && !isCalendarDate(String(entry.watchedAt).slice(0,10)))) {
                throw Object.assign(new Error('Episode watch dates must be real calendar dates'),{ status:400 });
            }
            const earlyEpisodeWatch = episodeHistory.find((entry) => localCalendarDate(entry.watchedAt) < earliestWatchDate);
            if (earlyEpisodeWatch) {
                throw Object.assign(new Error(`Episode watch date ${localCalendarDate(earlyEpisodeWatch.watchedAt)} cannot be earlier than release date ${earliestWatchDate}`),{ status:400 });
            }
            if (episodeHistory.some((entry) => Date.parse(entry.watchedAt) > Date.now())) {
                throw Object.assign(new Error('Episode watch dates and times cannot be in the future'),{ status:400 });
            }
        });
    });
    const seasonNumbers=seasons.map((season) => Number(season.seasonNumber));
    if (new Set(seasonNumbers).size !== seasonNumbers.length) throw Object.assign(new Error('Season numbers must be unique'),{ status:400 });
    const hasEpisodeHistory = seasons.some((season) =>
        (season.episodes || []).some((episode) => Array.isArray(episode.watchHistory) && episode.watchHistory.length > 0));
    const watched=type === 'movie' ? watchHistory.length > 0 : hasEpisodeHistory;
    if (watched && !releaseDate) throw Object.assign(new Error('Release date is required after a viewing is recorded'),{ status:400 });
    const contentLinks = (Array.isArray(payload.contentLinks) ? payload.contentLinks : (existing.contentLinks || [])).map((entry) => {
        try {
            const url = new URL(String(typeof entry === 'string' ? entry : entry.url || '').trim());
            if (!['http:','https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
            return { id:entry.id || crypto.randomUUID(),url:url.href,domain:url.hostname.replace(/^www\./i,'').toLowerCase() };
        } catch { throw Object.assign(new Error('Every content link must be a valid HTTP or HTTPS URL'),{ status:400 }); }
    });
    const normalizedCompanies=normalizeSubmittedCompanies(payload);
    const productionCompanies=normalizedCompanies.names;
    return {
        id: payload.id || existing.id || crypto.randomUUID(), type,
        subtype:normalizeSubtype(type,cleanText(payload.subtype)), title:normalizeSingleLineText(payload.title),
        originalTitle:normalizeSingleLineText(payload.originalTitle), productionStatus,releaseStatus,
        releaseDate,
        seriesStartDate:type === 'series' ? releaseDate : null,
        seriesEndDate:type === 'series' && releaseStatus === 'Ended' ? (seriesEndDate || null) : null,
        seriesContinuing:type === 'series' && ['Airing','Between Seasons','Hiatus','Returning'].includes(releaseStatus),
        seriesNetwork:type === 'series' ? cleanCommaList(payload.seriesNetwork) : '',
        duration:numericRuntime,
        director:type === 'movie' ? cleanCommaList(payload.director) : '',seriesCredits:type === 'series' ? (Array.isArray(payload.seriesCredits) ? payload.seriesCredits : existing.seriesCredits || []).map((credit) => ({
            id:credit.id || crypto.randomUUID(),name:normalizeSingleLineText(credit.name),role:normalizeSingleLineText(credit.role),
        })).filter((credit) => credit.name && credit.role) : [], casts, rating:watched ? cleanText(payload.rating) : cleanText(existing.rating),
        productionCompanies,productionCompanyAliases:normalizedCompanies.aliases,productionCompany:productionCompanies.join(', '), posterUrl:trailerAvailable ? cleanText(payload.posterUrl) : cleanText(existing.posterUrl),
        trailerUrl:trailerAvailable ? cleanText(payload.trailerUrl) : cleanText(existing.trailerUrl), summary:normalizeMultilineText(payload.summary), favorite:Boolean(payload.favorite),
        genres,presentationForms,language:cleanList(payload.language),
        awards:watched ? cleanList(payload.awards) : cleanList(existing.awards), tags:watched ? cleanList(payload.tags) : cleanList(existing.tags),
        countryOfOrigin: normalizeCountryCodes(Array.isArray(payload.countryOfOrigin) ? payload.countryOfOrigin : []), contentRatings,
        watchSources:watched ? watchSources : (existing.watchSources || []),watchHistory,
        contentLinks:watched ? contentLinks : (existing.contentLinks || []),seasons,
        creation: existing.creation || payload.creation || now, modification: now,
    };
}

// Returns values in the order used by content insert statements.
function persistenceValues(item) {
    return [item.id,item.type,item.subtype,item.title,item.originalTitle,item.productionStatus,item.releaseStatus,item.releaseDate,item.seriesStartDate,item.seriesEndDate,item.seriesContinuing ? 1 : 0,item.seriesNetwork,item.duration,
        item.director,item.casts,item.rating,item.productionCompany,item.posterUrl,item.trailerUrl,item.summary,
        item.favorite ? 1 : 0,JSON.stringify(item.genres),JSON.stringify(item.presentationForms),JSON.stringify(item.language),JSON.stringify(item.awards),
        JSON.stringify(item.tags),JSON.stringify(item.countryOfOrigin),JSON.stringify(item.contentRatings),
        JSON.stringify(item.watchSources),item.creation,item.modification];
}

// Returns paginated content and the total result count.
function getContent(query = {}) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const clauses = [query.trashed === 'true' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
    const parameters = [];
    if (query.type && ['movie', 'series'].includes(query.type)) { clauses.push('type = ?'); parameters.push(query.type); }
    if (query.subtype) { clauses.push('subtype = ?'); parameters.push(query.subtype); }
    if (query.favorite === 'true') clauses.push('favorite = 1');
    if (query.watchLater === 'true') clauses.push(`NOT EXISTS (SELECT 1 FROM watch_history wh WHERE wh.content_id=content_items.id)
        AND NOT EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id JOIN episode_watch_history h ON h.episode_id=e.id WHERE s.series_id=content_items.id)`);
    if (query.productionStatus) { clauses.push('production_status = ?'); parameters.push(query.productionStatus); }
    if (query.releaseStatus) { clauses.push('release_status = ?'); parameters.push(query.releaseStatus); }
    if (query.viewingStatus) {
        if (query.viewingStatus === 'Watched') clauses.push("type='movie' AND EXISTS (SELECT 1 FROM watch_history wh WHERE wh.content_id=content_items.id)");
        else if (query.viewingStatus === 'Not Watched') clauses.push("type='movie' AND NOT EXISTS (SELECT 1 FROM watch_history wh WHERE wh.content_id=content_items.id)");
        else if (query.viewingStatus === 'Not Started') clauses.push("type='series' AND NOT EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id JOIN episode_watch_history h ON h.episode_id=e.id WHERE s.series_id=content_items.id)");
        else if (query.viewingStatus === 'In Progress') clauses.push("type='series' AND EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id JOIN episode_watch_history h ON h.episode_id=e.id WHERE s.series_id=content_items.id) AND EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id WHERE s.series_id=content_items.id AND NOT EXISTS (SELECT 1 FROM episode_watch_history h WHERE h.episode_id=e.id))");
        else if (query.viewingStatus === 'Completed') clauses.push("type='series' AND EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id WHERE s.series_id=content_items.id) AND NOT EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id WHERE s.series_id=content_items.id AND NOT EXISTS (SELECT 1 FROM episode_watch_history h WHERE h.episode_id=e.id))");
    }
    if (query.rating === '__unrated__') clauses.push("trim(personal_rating) = ''");
    else if (query.rating) { clauses.push('personal_rating = ?'); parameters.push(query.rating); }
    if (query.releaseYear) { clauses.push("substr(release_date, 1, 4) = ?"); parameters.push(String(query.releaseYear)); }
    const jsonFilters = [['genres','genres_json'],['presentationForms','presentation_forms_json'],['languages','languages_json'],['tags','tags_json'],['awards','awards_json'],['countries','countries_json']];
    jsonFilters.forEach(([queryName, column]) => {
        const values = String(query[queryName] || '').split(',').filter(Boolean);
        if (values.length) {
            clauses.push(`(${values.map(() => `EXISTS (SELECT 1 FROM json_each(content_items.${column}) WHERE lower(CAST(value AS TEXT)) = lower(?))`).join(' AND ')})`);
            parameters.push(...values);
        }
    });
    const productionCompanies = String(query.productionCompanies || '').split(',').map((value) => value.trim()).filter(Boolean);
    productionCompanies.forEach((company) => {
        clauses.push(`EXISTS (SELECT 1 FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
            WHERE cpc.content_id=content_items.id AND pc.name=? COLLATE NOCASE)`);
        parameters.push(company);
    });
    const watchSources = String(query.watchSources || '').split(',').filter(Boolean);
    watchSources.forEach((source) => {
        clauses.push("EXISTS (SELECT 1 FROM json_each(content_items.watch_sources_json) WHERE lower(json_extract(value, '$.method')) = lower(?))");
        parameters.push(source);
    });
    const linkDomains = String(query.linkDomains || '').split(',').filter(Boolean);
    linkDomains.forEach((domain) => {
        if (domain === 'jalshamoviez') {
            clauses.push("EXISTS (SELECT 1 FROM content_links WHERE content_id=content_items.id AND (lower(domain) LIKE 'jalshamoviez%.com' OR lower(domain) LIKE 'jalshamoviez%.click' OR lower(domain) LIKE 'jalsamoviez%.com' OR lower(domain) LIKE 'jalsamoviez%.click'))");
        } else {
            clauses.push('EXISTS (SELECT 1 FROM content_links WHERE content_id=content_items.id AND lower(domain)=lower(?))');
            parameters.push(domain);
        }
    });
    if (query.sort === 'releaseDate') clauses.push("release_date IS NOT NULL AND release_date <> ''");
    if (query.sort === 'watchDate') clauses.push(`(
        EXISTS (SELECT 1 FROM watch_history wh WHERE wh.content_id=content_items.id)
        OR EXISTS (SELECT 1 FROM seasons s JOIN episodes e ON e.season_id=s.id
            JOIN episode_watch_history ewh ON ewh.episode_id=e.id WHERE s.series_id=content_items.id)
    )`);
    if (query.search) {
        const terms=String(query.search).match(/[\p{L}\p{N}]+/gu) || [];
        if (terms.length) {
            clauses.push(`(id IN (SELECT content_id FROM content_search WHERE content_search MATCH ?)
                OR EXISTS(SELECT 1 FROM series_credits sc WHERE sc.series_id=content_items.id AND (sc.person_name LIKE ? OR sc.role LIKE ?)))`);
            parameters.push(terms.map((term) => `"${term}"*`).join(' AND '),`%${String(query.search).trim()}%`,`%${String(query.search).trim()}%`);
        }
    }
    const where = clauses.join(' AND ');
    const allowedSort = { creation:'created_at', releaseDate:'release_date', duration:'runtime_minutes',
        watchDate:`MAX(
            COALESCE((SELECT MAX(watched_at) FROM watch_history WHERE content_id=content_items.id),''),
            COALESCE((SELECT MAX(ewh.watched_at) FROM seasons s JOIN episodes e ON e.season_id=s.id
                JOIN episode_watch_history ewh ON ewh.episode_id=e.id WHERE s.series_id=content_items.id),'')
        )`, modification:'updated_at' };
    const sort = allowedSort[query.sort] || 'updated_at';
    const order = query.order === 'ascending' ? 'ASC' : 'DESC';
    const categoryOrder = order;
    const titleOrder = `CASE
        WHEN trim(title) GLOB '[A-Za-z]*' THEN 2
        WHEN trim(title) GLOB '[0-9]*' THEN 1
        ELSE 0
      END ${categoryOrder},
      CASE WHEN trim(title) GLOB '[0-9]*' THEN CAST(trim(title) AS INTEGER) END ${order},
      trim(title) COLLATE NOCASE ${order}`;
    const orderBy = query.sort === 'title' ? titleOrder : `${sort} ${order}`;
    const total = database.prepare(`SELECT COUNT(*) AS count FROM content_items WHERE ${where}`).get(...parameters).count;
    const rows = database.prepare(`SELECT content_items.*,(SELECT MAX(watched_at) FROM watch_history WHERE content_id=content_items.id) latest_watch_date FROM content_items WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
        .all(...parameters, limit, (page - 1) * limit);
    return { items:hydrateContentRows(rows), total, page, limit, pages: Math.ceil(total / limit) };
}

// Returns filter choices derived from values currently stored in active library entries.
function getFilterCatalogs() {
    const linkDomains = new Set(database.prepare(`SELECT DISTINCT domain FROM content_links l JOIN content_items c ON c.id=l.content_id
        WHERE c.deleted_at IS NULL AND trim(domain) <> ''`).all().map((row) => normalizeLinkDomain(row.domain)).filter(Boolean));
    return {
        linkDomains:[...linkDomains].sort((a,b) => a.localeCompare(b,undefined,{ sensitivity:'base' })),
    };
}

// Searches normalized production companies for lightweight autocomplete selectors.
function searchProductionCompanies(query='') {
    const pattern=`%${String(query).trim()}%`;
    return database.prepare(`SELECT pc.id,pc.name,COUNT(DISTINCT cpc.content_id) uses FROM production_companies pc
        LEFT JOIN content_production_companies cpc ON cpc.company_id=pc.id
        WHERE pc.name LIKE ? OR EXISTS(SELECT 1 FROM production_company_aliases a WHERE a.company_id=pc.id AND a.alias LIKE ?)
        GROUP BY pc.id ORDER BY uses DESC,pc.name COLLATE NOCASE LIMIT 50`).all(pattern,pattern);
}

// Replaces normalized production-company links for one content item.
function replaceProductionCompanies(contentId,value='',submittedAliases=[]) {
    database.prepare('DELETE FROM content_production_companies WHERE content_id=?').run(contentId);
    const submitted=Array.isArray(value) ? value : String(value).split(',');
    const names=[...new Set(submitted.map(fullCompanyName).filter(Boolean))];
    const find=database.prepare(`SELECT pc.id,pc.name FROM production_companies pc WHERE pc.name=? COLLATE NOCASE OR pc.canonical_name=?
        OR EXISTS(SELECT 1 FROM production_company_aliases a WHERE a.company_id=pc.id AND a.alias=? COLLATE NOCASE)
        ORDER BY CASE WHEN pc.name=? COLLATE NOCASE THEN 0 ELSE 1 END LIMIT 1`);
    const insert=database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)');
    const alias=database.prepare('INSERT OR IGNORE INTO production_company_aliases(alias,company_id,created_at) VALUES(?,?,?)');
    const link=database.prepare('INSERT OR IGNORE INTO content_production_companies(content_id,company_id) VALUES(?,?)');
    names.forEach((name) => {
        let company=find.get(name,companyKey(name),name,name);
        if (!company) { company={ id:crypto.randomUUID(),name }; insert.run(company.id,name,companyKey(name)); }
        alias.run(name,company.id,new Date().toISOString());
        link.run(contentId,company.id);
        submittedAliases.filter((entry) => entry.name === name).forEach((entry) => alias.run(entry.alias,company.id,new Date().toISOString()));
    });
}

// Returns canonical production-company names linked to one title.
function getProductionCompanyNames(contentId) {
    return database.prepare(`SELECT pc.name FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
        WHERE cpc.content_id=? ORDER BY pc.name COLLATE NOCASE`).all(contentId).map((row) => row.name);
}

// Returns every active content item for exports and compatibility endpoints.
function getMovies() {
    return hydrateContentRows(database.prepare('SELECT content_items.*,(SELECT MAX(watched_at) FROM watch_history WHERE content_id=content_items.id) latest_watch_date FROM content_items WHERE deleted_at IS NULL ORDER BY updated_at DESC').all());
}

// Returns one content item by its stable identifier.
function getById(id) {
    const item = mapContentRow(database.prepare('SELECT content_items.*,(SELECT MAX(watched_at) FROM watch_history WHERE content_id=content_items.id) latest_watch_date FROM content_items WHERE id = ? AND deleted_at IS NULL').get(id));
    if (item?.type === 'series') item.seasons = getSeriesStructure(id);
    return item;
}

// Returns one content item regardless of its active or trashed state.
function getAnyById(id) {
    const item=mapContentRow(database.prepare('SELECT content_items.*,(SELECT MAX(watched_at) FROM watch_history WHERE content_id=content_items.id) latest_watch_date FROM content_items WHERE id=?').get(id));
    if (item?.type === 'series') item.seasons=getSeriesStructure(id);
    return item;
}

// Returns every recorded viewing date for one title in reverse chronological order.
function getWatchHistory(contentId) {
    return database.prepare('SELECT id,watched_at FROM watch_history WHERE content_id=? ORDER BY watched_at DESC').all(contentId)
        .map((row) => ({ id:row.id,watchedAt:row.watched_at }));
}

// Returns every validated external location for one title.
function getContentLinks(contentId) {
    return database.prepare('SELECT id,url,domain FROM content_links WHERE content_id=? ORDER BY domain,url').all(contentId);
}

// Synchronizes watch dates and external links while preserving row identities and creation times.
function replaceWatchData(contentId, watchHistory = [], contentLinks = []) {
    const now = new Date().toISOString();
    const existingWatches=new Map(database.prepare('SELECT id,watched_at FROM watch_history WHERE content_id=?').all(contentId).map((row) => [row.id,row]));
    const retainedWatchIds=[];
    const updateWatch=database.prepare('UPDATE watch_history SET watched_at=?,updated_at=? WHERE id=? AND content_id=?');
    const insertWatch = database.prepare('INSERT INTO watch_history(id,content_id,watched_at,created_at,updated_at) VALUES(?,?,?,?,?)');
    watchHistory.forEach((entry) => {
        let id=entry.id;
        if (existingWatches.has(id)) {
            retainedWatchIds.push(id);
            if (existingWatches.get(id).watched_at !== entry.watchedAt) updateWatch.run(entry.watchedAt,now,id,contentId);
            return;
        }
        if (!id || database.prepare('SELECT 1 FROM watch_history WHERE id=?').get(id)) id=crypto.randomUUID();
        retainedWatchIds.push(id); insertWatch.run(id,contentId,entry.watchedAt,now,now);
    });
    if (retainedWatchIds.length) database.prepare(`DELETE FROM watch_history WHERE content_id=? AND id NOT IN (${retainedWatchIds.map(() => '?').join(',')})`).run(contentId,...retainedWatchIds);
    else database.prepare('DELETE FROM watch_history WHERE content_id=?').run(contentId);

    const uniqueLinks=[...new Map(contentLinks.map((entry) => [entry.url.toLowerCase(),entry])).values()];
    const existingLinks=new Map(database.prepare('SELECT id,url,domain FROM content_links WHERE content_id=?').all(contentId).map((row) => [row.id,row]));
    const retainedLinkIds=[];
    const updateLink=database.prepare('UPDATE content_links SET url=?,domain=? WHERE id=? AND content_id=?');
    const insertLink = database.prepare('INSERT INTO content_links(id,content_id,url,domain,created_at) VALUES(?,?,?,?,?)');
    uniqueLinks.forEach((entry) => {
        let id=entry.id;
        if (existingLinks.has(id)) {
            retainedLinkIds.push(id);
            const existing=existingLinks.get(id);
            if (existing.url !== entry.url || existing.domain !== entry.domain) updateLink.run(entry.url,entry.domain,id,contentId);
            return;
        }
        if (!id || database.prepare('SELECT 1 FROM content_links WHERE id=?').get(id)) id=crypto.randomUUID();
        retainedLinkIds.push(id); insertLink.run(id,contentId,entry.url,entry.domain,now);
    });
    if (retainedLinkIds.length) database.prepare(`DELETE FROM content_links WHERE content_id=? AND id NOT IN (${retainedLinkIds.map(() => '?').join(',')})`).run(contentId,...retainedLinkIds);
    else database.prepare('DELETE FROM content_links WHERE content_id=?').run(contentId);
}

// Loads complete season, episode, and episode-history trees for multiple series in three bounded queries.
function getSeriesStructures(seriesIds=[]) {
    const ids=[...new Set(seriesIds.filter(Boolean))]; const structures=new Map(ids.map((id) => [id,[]]));
    if (!ids.length) return structures;
    const seriesPlaceholders=ids.map(() => '?').join(',');
    const seasons=database.prepare(`SELECT * FROM seasons WHERE series_id IN (${seriesPlaceholders}) ORDER BY series_id,season_number`).all(...ids);
    if (!seasons.length) return structures;
    const seasonIds=seasons.map((season) => season.id); const seasonPlaceholders=seasonIds.map(() => '?').join(',');
    const episodes=database.prepare(`SELECT * FROM episodes WHERE season_id IN (${seasonPlaceholders}) ORDER BY season_id,episode_number`).all(...seasonIds);
    const histories=new Map(episodes.map((episode) => [episode.id,[]]));
    if (episodes.length) {
        const episodePlaceholders=episodes.map(() => '?').join(',');
        database.prepare(`SELECT id,episode_id,watched_at FROM episode_watch_history WHERE episode_id IN (${episodePlaceholders}) ORDER BY watched_at DESC`).all(...episodes.map((episode) => episode.id))
            .forEach((row) => histories.get(row.episode_id).push({ id:row.id,watchedAt:row.watched_at }));
    }
    const episodesBySeason=new Map(seasonIds.map((id) => [id,[]]));
    episodes.forEach((episode) => {
        const watchHistory=histories.get(episode.id) || [];
        episodesBySeason.get(episode.season_id).push({ id:episode.id,episodeNumber:episode.episode_number,title:episode.title,airDate:episode.air_date || '',
            duration:episode.runtime_minutes == null ? '' : String(episode.runtime_minutes),watched:watchHistory.length > 0,
            watchDate:watchHistory[0]?.watchedAt || '',progressSeconds:episode.progress_seconds,summary:episode.summary,
            episodeType:episode.episode_type || 'Regular',director:episode.director || '',watchHistory });
    });
    seasons.forEach((season) => {
        const seasonEpisodes=episodesBySeason.get(season.id) || [];
        structures.get(season.series_id).push({ id:season.id,seasonNumber:season.season_number,title:season.title,
            productionStatus:season.production_status || 'Announced',releaseStatus:season.release_status || 'Unscheduled',releaseDate:season.release_date || '',
            posterUrl:season.poster_url,synopsis:season.synopsis || '',completionStatus:season.completion_status || 'Not Started',episodes:seasonEpisodes,
            knownRuntime:seasonEpisodes.reduce((sum,episode) => sum + (Number(episode.duration) || 0),0) });
    });
    return structures;
}

// Returns seasons and episodes for one series with computed runtime totals.
function getSeriesStructure(seriesId) { return getSeriesStructures([seriesId]).get(seriesId) || []; }

// Replaces a series structure with the submitted seasons and episodes.
function replaceSeriesStructure(seriesId, seasons = []) {
    database.prepare('DELETE FROM seasons WHERE series_id=?').run(seriesId);
    const now = new Date().toISOString();
    seasons.forEach((season, seasonIndex) => {
        const seasonId = season.id || crypto.randomUUID();
        const seasonNumber=season.seasonNumber === '' || season.seasonNumber == null ? seasonIndex + 1 : Number(season.seasonNumber);
        const seasonEpisodes=season.episodes || [];
        const watchedEpisodeCount=seasonEpisodes.filter((episode) => (Array.isArray(episode.watchHistory) && episode.watchHistory.length > 0) || episode.watched).length;
        const completionStatus=watchedEpisodeCount === 0 ? 'Not Started'
            : watchedEpisodeCount === seasonEpisodes.length && seasonEpisodes.length > 0 ? 'Completed' : 'In Progress';
        const seasonProduction=PRODUCTION_STATUSES.includes(season.productionStatus) ? season.productionStatus : 'Announced';
        const seasonRelease=SEASON_RELEASE_STATUSES.includes(season.releaseStatus) ? season.releaseStatus : 'Unscheduled';
        database.prepare(`INSERT INTO seasons(id,series_id,season_number,title,production_status,release_status,release_date,poster_url,synopsis,completion_status,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(seasonId,seriesId,seasonNumber,normalizeSingleLineText(season.title) || `Season ${seasonNumber}`,
            seasonProduction,seasonRelease,String(season.releaseDate || '').trim() || null,String(season.posterUrl || '').trim(),
            normalizeMultilineText(season.synopsis),completionStatus,now,now);
        seasonEpisodes.forEach((episode, episodeIndex) => {
            const episodeId = episode.id || crypto.randomUUID();
            const episodeNumber=episode.episodeNumber === '' || episode.episodeNumber == null ? episodeIndex + 1 : Number(episode.episodeNumber);
            const submittedEpisodeHistory = Array.isArray(episode.watchHistory) ? episode.watchHistory
                : (episode.watched ? [{ watchedAt:episode.watchDate || now }] : []);
            const episodeHistory = submittedEpisodeHistory.map((entry) => ({
                id:entry.id || crypto.randomUUID(),watchedAt:String(entry.watchedAt || '').trim(),
            })).filter((entry) => entry.watchedAt && !Number.isNaN(Date.parse(entry.watchedAt)));
            const episodeType=EPISODE_TYPES.includes(episode.episodeType) ? episode.episodeType : 'Regular';
            database.prepare(`INSERT INTO episodes(id,season_id,episode_number,title,air_date,runtime_minutes,watched,watch_date,
                progress_seconds,summary,episode_type,director,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
                episodeId,seasonId,episodeNumber,
                normalizeSingleLineText(episode.title) || `Episode ${episodeNumber}`,String(episode.airDate || '').trim() || null,
                episode.duration === '' || episode.duration == null ? null : Number(episode.duration),episodeHistory.length ? 1 : 0,
                episodeHistory[0]?.watchedAt || null,Number(episode.progressSeconds) || 0,normalizeMultilineText(episode.summary),episodeType,
                normalizeCommaSeparatedText(episode.director),now,now);
            const insertWatch = database.prepare('INSERT INTO episode_watch_history(id,episode_id,watched_at,created_at,updated_at) VALUES(?,?,?,?,?)');
            episodeHistory.forEach((entry) => insertWatch.run(entry.id,episodeId,entry.watchedAt,now,now));
        });
    });
}

// Replaces ordered whole-series credits while preserving movie directors separately.
function replaceSeriesCredits(seriesId,credits=[]) {
    database.prepare('DELETE FROM series_credits WHERE series_id=?').run(seriesId);
    const now=new Date().toISOString();
    const insert=database.prepare('INSERT INTO series_credits(id,series_id,person_name,role,display_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?)');
    credits.forEach((credit,index) => insert.run(credit.id || crypto.randomUUID(),seriesId,credit.name,credit.role,index,now,now));
}

// Writes one immutable structured audit entry.
function writeAudit(action, entityType, entityId, details = {}, context = {}) {
    database.prepare(`INSERT INTO audit_log(
        action,entity_type,entity_id,details_json,request_id,actor,outcome,before_json,after_json,metadata_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(
        action,entityType,entityId || null,JSON.stringify(details),context.requestId || null,context.actor || 'system',
        context.outcome || 'success',context.before ? JSON.stringify(context.before) : null,
        context.after ? JSON.stringify(context.after) : null,JSON.stringify(context.metadata || {}),new Date().toISOString(),
    );
}

// Returns only fields whose values changed between two content states.
function changedContent(existing, updated) {
    const fields = ['type','subtype','title','originalTitle','productionStatus','releaseStatus','viewingStatus','releaseDate','seriesStartDate','seriesEndDate','seriesContinuing','seriesNetwork','duration','director','seriesCredits','casts','rating',
        'productionCompany','posterUrl','trailerUrl','summary','favorite','genres','presentationForms','language','awards','tags',
        'countryOfOrigin','contentRatings','watchSources','watchHistory','contentLinks'];
    const before = {};
    const after = {};
    fields.forEach((key) => {
        const previous = existing[key] == null ? '' : existing[key];
        const next = updated[key] == null ? '' : updated[key];
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
            before[key] = existing[key];
            after[key] = updated[key];
        }
    });
    return { before, after, fields:Object.keys(after) };
}

// Runs a group of database operations atomically.
function runTransaction(operation) {
    if (database.isTransaction) return operation();
    database.exec('BEGIN IMMEDIATE');
    try {
        const result = operation();
        database.exec('COMMIT');
        return result;
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Inserts a new movie or series and records the operation.
function addContent(payload, context = {}) {
    const item = normalizePayload(payload);
    if (!item.title) throw Object.assign(new Error('Title is required'), { status: 400 });
    const duplicate = database.prepare("SELECT id FROM content_items WHERE lower(trim(title))=? AND ifnull(release_date,'')=? AND type=? AND deleted_at IS NULL")
        .get(normalizeTitle(item.title),item.releaseDate || '',item.type);
    if (duplicate) throw Object.assign(new Error('A title with this release date already exists'), { status: 409 });
    runTransaction(() => {
        database.prepare(`INSERT INTO content_items (id,type,subtype,title,original_title,production_status,release_status,release_date,series_start_date,series_end_date,series_continuing,series_network,runtime_minutes,
            director,casts,personal_rating,production_company,poster_url,trailer_url,summary,favorite,genres_json,presentation_forms_json,
            languages_json,awards_json,tags_json,countries_json,content_ratings_json,watch_sources_json,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(...persistenceValues(item));
        if (item.type === 'series') { replaceSeriesStructure(item.id, item.seasons); replaceSeriesCredits(item.id,item.seriesCredits); }
        replaceWatchData(item.id,item.watchHistory,item.contentLinks);
        replaceProductionCompanies(item.id,item.productionCompanies,item.productionCompanyAliases);
        writeAudit('create', 'content', item.id, { title:item.title,type:item.type }, { ...context, after:item });
    });
    return getById(item.id);
}

// Marks matching asset notifications resolved after a URL changes.
function resolveAssetNotifications(contentId, posterUrl, trailerUrl) {
    database.prepare(`UPDATE notifications SET resolved_at=? WHERE content_id=? AND resolved_at IS NULL
        AND ((asset_type='poster' AND asset_url<>?) OR (asset_type='trailer' AND asset_url<>?))`)
        .run(new Date().toISOString(), contentId, posterUrl, trailerUrl);
}

// Updates an existing content item and records the changed entity.
function updateContent(payload, context = {}) {
    const existing = getById(payload.id);
    if (!existing) throw Object.assign(new Error('Content item not found'), { status: 404 });
    const item = normalizePayload(payload, existing);
    if (!item.title) throw Object.assign(new Error('Title is required'), { status: 400 });
    const duplicate=database.prepare("SELECT id FROM content_items WHERE lower(trim(title))=? AND ifnull(release_date,'')=? AND type=? AND id<>? AND deleted_at IS NULL")
        .get(normalizeTitle(item.title),item.releaseDate || '',item.type,item.id);
    if (duplicate) throw Object.assign(new Error('Another title with this release date already exists'),{ status:409 });
    const values = persistenceValues(item);
    runTransaction(() => {
        database.prepare(`UPDATE content_items SET type=?,subtype=?,title=?,original_title=?,production_status=?,release_status=?,release_date=?,series_start_date=?,series_end_date=?,series_continuing=?,series_network=?,runtime_minutes=?,
            director=?,casts=?,personal_rating=?,production_company=?,poster_url=?,trailer_url=?,summary=?,favorite=?,genres_json=?,presentation_forms_json=?,
            languages_json=?,awards_json=?,tags_json=?,countries_json=?,content_ratings_json=?,watch_sources_json=?,updated_at=? WHERE id=?`)
            .run(...values.slice(1,29),item.modification,item.id);
        if (item.type === 'series') { replaceSeriesStructure(item.id, item.seasons); replaceSeriesCredits(item.id,item.seriesCredits); }
        replaceWatchData(item.id,item.watchHistory,item.contentLinks);
        replaceProductionCompanies(item.id,item.productionCompanies,item.productionCompanyAliases);
        resolveAssetNotifications(item.id, item.posterUrl, item.trailerUrl);
        const changes = changedContent(existing, item);
        writeAudit('update', 'content', item.id, { title:item.title,changedFields:changes.fields }, { ...context,before:changes.before,after:changes.after });
    });
    return getById(item.id);
}

// Applies one reviewed lifecycle value to a bounded selection of active titles.
function bulkUpdateContent(payload,context={}) {
    const ids=[...new Set((Array.isArray(payload.ids) ? payload.ids : []).map(String).filter(Boolean))];
    if (!ids.length) throw Object.assign(new Error('Select at least one title'),{ status:400 });
    if (ids.length > 100) throw Object.assign(new Error('Bulk updates are limited to 100 titles at a time'),{ status:400 });
    const field=payload.field; const value=String(payload.value || '').trim();
    if (!['productionStatus','releaseStatus'].includes(field)) throw Object.assign(new Error('Only production or release status can be updated in bulk'),{ status:400 });
    if (field === 'productionStatus' && !PRODUCTION_STATUSES.includes(value)) throw Object.assign(new Error('Choose a valid production status'),{ status:400 });
    const placeholders=ids.map(() => '?').join(',');
    const rows=database.prepare(`SELECT id,type FROM content_items WHERE id IN (${placeholders}) AND deleted_at IS NULL`).all(...ids);
    if (rows.length !== ids.length) throw Object.assign(new Error('One or more selected titles are no longer active'),{ status:409 });
    if (field === 'releaseStatus' && rows.some((row) => !(row.type === 'series' ? SERIES_RELEASE_STATUSES : MOVIE_RELEASE_STATUSES).includes(value))) {
        throw Object.assign(new Error('The selected release status is not valid for every selected content type'),{ status:400 });
    }
    const column=field === 'productionStatus' ? 'production_status' : 'release_status'; const now=new Date().toISOString();
    return runTransaction(() => {
        const result=database.prepare(`UPDATE content_items SET ${column}=?,updated_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`).run(value,now,...ids);
        writeAudit('bulk_update','content',null,{ field,value,ids,updated:result.changes },{ ...context,after:{ [field]:value } });
        return { updated:result.changes,field,value };
    });
}

// Moves a content item into the recoverable trash state.
function deleteContent(id, context = {}) {
    const item = getById(id);
    if (!item) throw Object.assign(new Error('Content item not found'), { status: 404 });
    const now = new Date().toISOString();
    database.prepare('UPDATE content_items SET deleted_at=?,updated_at=? WHERE id=?').run(now, now, id);
    writeAudit('trash', 'content', id, { title:item.title }, { ...context,before:{ deleted:false },after:{ deleted:true,deletedAt:now } });
    return item;
}

// Restores a trashed content item after resolving any active identity conflict.
function restoreContent(id, resolution = '', context = {}) {
    const item = getAnyById(id);
    if (!item || !item.deletedAt) throw Object.assign(new Error('Trashed content item not found'), { status:404 });
    const conflictRow=database.prepare("SELECT id FROM content_items WHERE lower(trim(title))=? AND ifnull(release_date,'')=? AND type=? AND id<>? AND deleted_at IS NULL")
        .get(normalizeTitle(item.title),item.releaseDate || '',item.type,id);
    if (conflictRow && !['replace','merge'].includes(resolution)) {
        const conflict=getById(conflictRow.id);
        throw Object.assign(new Error('An active entry already has the same type, title, and release date'),{
            status:409,code:'RESTORE_CONFLICT',details:{ conflict:{ id:conflict.id,title:conflict.title,type:conflict.type,releaseDate:conflict.releaseDate } },
        });
    }
    const now = new Date().toISOString();
    if (conflictRow && resolution === 'merge') {
        const active=getById(conflictRow.id);
        const union=(first=[],second=[]) => [...new Map([...first,...second].map((value) => [typeof value === 'object' ? JSON.stringify(value) : value,value])).values()];
        const mergeHistory=(first=[],second=[]) => [...new Map([...first,...second].map((entry) => [entry.watchedAt,entry])).values()];
        const mergeLinks=(first=[],second=[]) => [...new Map([...first,...second].map((entry) => [entry.url.toLowerCase(),entry])).values()];
        const backupFile=createDatabaseBackup(database,'pre-restore-merge');
        runTransaction(() => {
            updateContent({ ...active,
                originalTitle:active.originalTitle || item.originalTitle,duration:active.duration || item.duration,director:active.director || item.director,
                casts:active.casts || item.casts,rating:active.rating || item.rating,productionCompany:active.productionCompany || item.productionCompany,
                posterUrl:active.posterUrl || item.posterUrl,trailerUrl:active.trailerUrl || item.trailerUrl,summary:active.summary || item.summary,
                seriesNetwork:active.seriesNetwork || item.seriesNetwork,genres:union(active.genres,item.genres),language:union(active.language,item.language),
                awards:union(active.awards,item.awards),tags:union(active.tags,item.tags),countryOfOrigin:union(active.countryOfOrigin,item.countryOfOrigin),
                contentRatings:union(active.contentRatings,item.contentRatings),watchSources:union(active.watchSources,item.watchSources),
                watchHistory:mergeHistory(active.watchHistory,item.watchHistory),contentLinks:mergeLinks(active.contentLinks,item.contentLinks),
                seasons:active.seasons?.length ? active.seasons : item.seasons,favorite:active.favorite || item.favorite,
            },context);
            database.prepare('DELETE FROM content_items WHERE id=?').run(id);
            writeAudit('restore-merge','content',active.id,{ mergedFrom:id,title:item.title,backupFile:path.basename(backupFile) },context);
        });
        return { item:getById(active.id),resolution:'merge',backupFile };
    }
    runTransaction(() => {
        if (conflictRow) database.prepare('UPDATE content_items SET deleted_at=?,updated_at=? WHERE id=?').run(now,now,conflictRow.id);
        database.prepare('UPDATE content_items SET deleted_at=NULL,updated_at=? WHERE id=?').run(now,id);
        writeAudit(conflictRow ? 'restore-replace' : 'restore','content',id,{ title:item.title,replacedId:conflictRow?.id || null },{
            ...context,before:{ deleted:true,deletedAt:item.deletedAt },after:{ deleted:false },
        });
    });
    return { item:getById(id),resolution:conflictRow ? 'replace' : 'restore' };
}

// Permanently removes a trashed content item after creating a verified recovery backup.
function permanentlyDeleteContent(id, context = {}) {
    const item = getAnyById(id);
    if (!item || !item.deletedAt) throw Object.assign(new Error('Trashed content item not found'), { status:404 });
    const backupFile = createDatabaseBackup(database,'pre-permanent-delete');
    runTransaction(() => {
        database.prepare('DELETE FROM content_items WHERE id=?').run(id);
        writeAudit('permanent-delete','content',id,{ title:item.title,backupFile:path.basename(backupFile) },{
            ...context,before:{ title:item.title,type:item.type,deletedAt:item.deletedAt },after:{ permanentlyDeleted:true },
        });
    });
    return { item,backupFile };
}

// Reverses the favorite flag for a content item.
function toggleFavorite(id, context = {}) {
    const item = getById(id);
    if (!item) throw Object.assign(new Error('Content item not found'), { status: 404 });
    database.prepare('UPDATE content_items SET favorite=?,updated_at=? WHERE id=?').run(item.favorite ? 0 : 1, new Date().toISOString(), id);
    writeAudit('favorite', 'content', id, { title:item.title }, { ...context,before:{ favorite:item.favorite },after:{ favorite:!item.favorite } });
    return getById(id);
}

// Returns active notifications with their associated content titles.
function getNotifications() {
    return database.prepare(`SELECT n.*,c.title FROM notifications n JOIN content_items c ON c.id=n.content_id
        WHERE n.resolved_at IS NULL ORDER BY n.detected_at DESC`).all().map((row) => ({
        id:row.id,contentId:row.content_id,title:row.title,assetType:row.asset_type,status:row.status,reason:row.reason,
        assetUrl:row.asset_url,detectedAt:row.detected_at,read:Boolean(row.read_at),
    }));
}

// Marks one notification as read.
function markNotificationRead(id, context = {}) {
    const notification = database.prepare('SELECT content_id,asset_type,read_at FROM notifications WHERE id=?').get(id);
    const readAt = new Date().toISOString();
    database.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=?').run(readAt, id);
    if (notification && !notification.read_at) writeAudit('read', 'notification', id, { contentId:notification.content_id,assetType:notification.asset_type }, { ...context,after:{ readAt } });
}

// Builds a portable representation of the active library.
function buildExportPayload() {
    return { schemaVersion:5, exportedAt:new Date().toISOString(), content:getMovies(),
        seasons:database.prepare('SELECT * FROM seasons ORDER BY series_id,season_number').all(),
        episodes:database.prepare('SELECT * FROM episodes ORDER BY season_id,episode_number').all(),
        watchHistory:database.prepare('SELECT * FROM watch_history ORDER BY watched_at').all(),
        episodeWatchHistory:database.prepare('SELECT * FROM episode_watch_history ORDER BY watched_at').all(),
        contentLinks:database.prepare('SELECT * FROM content_links ORDER BY domain,url').all(),
        seriesCredits:database.prepare('SELECT * FROM series_credits ORDER BY series_id,display_order').all() };
}

// Builds aggregate library statistics without sending the full collection to the browser.
function getStatistics() {
    const rows = database.prepare(`SELECT content_items.*,
        (SELECT COUNT(*) FROM watch_history WHERE content_id=content_items.id) watch_count
        FROM content_items WHERE deleted_at IS NULL`).all();
    const count = (target,key,amount = 1) => { if (key) target[key] = (target[key] || 0) + amount; };
    const types = {},genres = {},presentationForms = {},countries = {},productionStatuses = {},releaseStatuses = {},viewingStatuses = {},personalRatings = {},releaseDecades = {};
    let watchedTitles = 0,totalWatchSessions = 0,totalMinutesWatched = 0,rewatchedTitles = 0,ratedTitles = 0;
    rows.forEach((row) => {
        count(types,row.type); count(productionStatuses,row.production_status); count(releaseStatuses,row.release_status);
        if (row.type === 'movie') count(viewingStatuses,row.watch_count ? 'Watched' : 'Not Watched');
        parseJson(row.genres_json).forEach((value) => count(genres,value));
        parseJson(row.presentation_forms_json).forEach((value) => count(presentationForms,value));
        parseJson(row.countries_json).forEach((value) => count(countries,value));
        if (row.release_date) count(releaseDecades,`${Math.floor(Number(row.release_date.slice(0,4)) / 10) * 10}s`);
        if (row.personal_rating) {
            count(personalRatings,row.personal_rating);
            ratedTitles += 1;
        }
        if (row.type === 'movie') {
            if (row.watch_count) watchedTitles += 1;
            if (row.watch_count > 1) rewatchedTitles += 1;
            totalWatchSessions += row.watch_count;
            totalMinutesWatched += (row.runtime_minutes || 0) * row.watch_count;
        }
    });
    const seriesViewing = database.prepare(`SELECT c.id,
        COUNT(DISTINCT e.id) episode_count,
        COUNT(DISTINCT CASE WHEN eh.id IS NOT NULL THEN e.id END) watched_episode_count,
        COUNT(eh.id) episode_sessions,
        COALESCE(MIN(CASE WHEN e.id IS NOT NULL THEN (SELECT COUNT(*) FROM episode_watch_history cycle_history WHERE cycle_history.episode_id=e.id) END),0) complete_watch_count,
        COALESCE(SUM(CASE WHEN eh.id IS NOT NULL THEN e.runtime_minutes ELSE 0 END),0) minutes
        FROM content_items c LEFT JOIN seasons s ON s.series_id=c.id LEFT JOIN episodes e ON e.season_id=s.id
        LEFT JOIN episode_watch_history eh ON eh.episode_id=e.id
        WHERE c.deleted_at IS NULL AND c.type='series' GROUP BY c.id`).all();
    let episodesWatched = 0,episodeWatchSessions = 0,seriesWatchCycles = 0,rewatchedEpisodes = 0,completedSeries = 0,partiallyWatchedSeries = 0;
    seriesViewing.forEach((series) => {
        const preciseSessions = series.episode_sessions;
        if (preciseSessions) watchedTitles += 1;
        totalWatchSessions += preciseSessions;
        episodeWatchSessions += preciseSessions;
        seriesWatchCycles += series.complete_watch_count;
        episodesWatched += series.watched_episode_count;
        totalMinutesWatched += series.minutes;
        if (series.complete_watch_count > 1) rewatchedTitles += 1;
        if (series.episode_count > 0 && series.watched_episode_count === series.episode_count) completedSeries += 1;
        else if (series.watched_episode_count > 0) partiallyWatchedSeries += 1;
        count(viewingStatuses,!series.watched_episode_count ? 'Not Started' : series.watched_episode_count === series.episode_count && series.episode_count > 0 ? 'Completed' : 'In Progress');
    });
    rewatchedEpisodes = database.prepare(`SELECT COUNT(*) count FROM (SELECT eh.episode_id FROM episode_watch_history eh
        JOIN episodes e ON e.id=eh.episode_id JOIN seasons s ON s.id=e.season_id JOIN content_items c ON c.id=s.series_id
        WHERE c.deleted_at IS NULL GROUP BY eh.episode_id HAVING COUNT(*)>1)`).get().count;
    const completedSeasons = database.prepare(`SELECT COUNT(*) count FROM (SELECT s.id,COUNT(DISTINCT e.id) episode_total,
        COUNT(DISTINCT CASE WHEN eh.id IS NOT NULL THEN e.id END) watched_total FROM seasons s
        JOIN content_items c ON c.id=s.series_id LEFT JOIN episodes e ON e.season_id=s.id
        LEFT JOIN episode_watch_history eh ON eh.episode_id=e.id WHERE c.deleted_at IS NULL
        GROUP BY s.id HAVING COUNT(DISTINCT e.id)>0
            AND COUNT(DISTINCT CASE WHEN eh.id IS NOT NULL THEN e.id END)=COUNT(DISTINCT e.id))`).get().count;
    const watchActivity = {};
    database.prepare(`SELECT month,COUNT(*) count FROM (
        SELECT strftime('%Y-%m',h.watched_at,'localtime') month FROM watch_history h JOIN content_items c ON c.id=h.content_id WHERE c.deleted_at IS NULL AND c.type='movie'
        UNION ALL SELECT strftime('%Y-%m',eh.watched_at,'localtime') FROM episode_watch_history eh JOIN episodes e ON e.id=eh.episode_id JOIN seasons s ON s.id=e.season_id JOIN content_items c ON c.id=s.series_id WHERE c.deleted_at IS NULL
        ) GROUP BY month ORDER BY month`).all()
        .forEach((row) => { watchActivity[row.month] = row.count; });
    const weekdayActivity = { Monday:0,Tuesday:0,Wednesday:0,Thursday:0,Friday:0,Saturday:0,Sunday:0 };
    const weekdayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    database.prepare(`SELECT weekday,COUNT(*) count FROM (
        SELECT strftime('%w',h.watched_at,'localtime') weekday FROM watch_history h JOIN content_items c ON c.id=h.content_id WHERE c.deleted_at IS NULL AND c.type='movie'
        UNION ALL SELECT strftime('%w',eh.watched_at,'localtime') FROM episode_watch_history eh JOIN episodes e ON e.id=eh.episode_id JOIN seasons s ON s.id=e.season_id JOIN content_items c ON c.id=s.series_id WHERE c.deleted_at IS NULL
        ) GROUP BY weekday`).all()
        .forEach((row) => { weekdayActivity[weekdayNames[Number(row.weekday)]] = row.count; });
    const libraryGrowth = {};
    database.prepare(`SELECT strftime('%Y-%m',created_at,'localtime') month,COUNT(*) count FROM content_items
        WHERE deleted_at IS NULL GROUP BY month ORDER BY month`).all().forEach((row) => { libraryGrowth[row.month] = row.count; });
    const runtimeDistribution = { 'Under 60 min':0,'60–89 min':0,'90–119 min':0,'120–149 min':0,'150+ min':0 };
    rows.forEach((row) => {
        if (row.runtime_minutes == null) return;
        if (row.runtime_minutes < 60) runtimeDistribution['Under 60 min'] += 1;
        else if (row.runtime_minutes < 90) runtimeDistribution['60–89 min'] += 1;
        else if (row.runtime_minutes < 120) runtimeDistribution['90–119 min'] += 1;
        else if (row.runtime_minutes < 150) runtimeDistribution['120–149 min'] += 1;
        else runtimeDistribution['150+ min'] += 1;
    });
    const sourceMethods = {},linkDomains = {},contentRatings = {};
    rows.forEach((row) => {
        parseJson(row.watch_sources_json).forEach((source) => count(sourceMethods,source.method));
        parseJson(row.content_ratings_json).forEach((rating) => count(contentRatings,`${rating.territory} ${rating.code}`));
    });
    database.prepare(`SELECT domain,COUNT(*) count FROM content_links l JOIN content_items c ON c.id=l.content_id
        WHERE c.deleted_at IS NULL GROUP BY domain ORDER BY count DESC`).all().forEach((row) => count(linkDomains,normalizeLinkDomain(row.domain),row.count));
    const modePersonalRating = Object.entries(personalRatings).sort((a,b) => b[1] - a[1])[0]?.[0] || null;
    const topCountries = Object.entries(countries).sort((a,b) => b[1] - a[1]).slice(0,3).map(([code,total]) => ({ code,total }));
    const linkedTitles = database.prepare(`SELECT COUNT(DISTINCT l.content_id) count FROM content_links l
        JOIN content_items c ON c.id=l.content_id WHERE c.deleted_at IS NULL`).get().count;
    return { generatedAt:new Date().toISOString(),summary:{ total:rows.length,watchedTitles,totalWatchSessions,totalMinutesWatched,
        rewatchedTitles,ratedTitles,linkedTitles,modePersonalRating,topCountries,countries:Object.keys(countries).length,
        episodesWatched,episodeWatchSessions,seriesWatchCycles,rewatchedEpisodes,completedSeasons,completedSeries,partiallyWatchedSeries },
        types,genres,presentationForms,countries,productionStatuses,releaseStatuses,viewingStatuses,personalRatings,releaseDecades,watchActivity,weekdayActivity,libraryGrowth,runtimeDistribution,
        sourceMethods,linkDomains,contentRatings,seriesCompletion:{ Completed:completedSeries,'In progress':partiallyWatchedSeries,
            'Not started':Math.max(0,seriesViewing.length - completedSeries - partiallyWatchedSeries) } };
}

// Builds an actionable data-quality report without exposing full library records.
function getDataHealth() {
    const checks=[
        ['missingPosters','Entries without posters',"trim(poster_url)=''"],
        ['missingReleaseDates','Entries without release dates',"release_date IS NULL OR release_date=''"],
        ['watchedWithoutRuntime','Watched movies without runtime',"type='movie' AND runtime_minutes IS NULL AND EXISTS(SELECT 1 FROM watch_history h WHERE h.content_id=content_items.id)"],
        ['seriesWithoutSeasons','Series without seasons',"type='series' AND NOT EXISTS(SELECT 1 FROM seasons s WHERE s.series_id=content_items.id)"],
        ['emptyProductionCompanies','Entries without production companies',"trim(production_company)=''"],
    ];
    const results={};
    checks.forEach(([key,label,where]) => {
        const items=database.prepare(`SELECT id,title FROM content_items WHERE deleted_at IS NULL AND (${where}) ORDER BY title COLLATE NOCASE LIMIT 100`).all();
        results[key]={ label,count:database.prepare(`SELECT COUNT(*) count FROM content_items WHERE deleted_at IS NULL AND (${where})`).get().count,items };
    });
    const emptySeasons=database.prepare(`SELECT c.id,c.title,s.season_number FROM seasons s JOIN content_items c ON c.id=s.series_id
        WHERE c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id) ORDER BY c.title COLLATE NOCASE,s.season_number LIMIT 100`).all();
    results.seasonsWithoutEpisodes={ label:'Seasons without episodes',count:database.prepare(`SELECT COUNT(*) count FROM seasons s JOIN content_items c ON c.id=s.series_id
        WHERE c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=s.id)`).get().count,items:emptySeasons };
    const incompleteCompanyWhere="lower(pc.name) IN ('company','limited','incorporated','corporation','private','limited liability company','limited liability partnership','public limited company','limited partnership')";
    results.incompleteProductionCompanyNames={ label:'Titles with incomplete company names',items:database.prepare(`SELECT DISTINCT c.id,c.title,pc.name company
        FROM content_items c JOIN content_production_companies cpc ON cpc.content_id=c.id JOIN production_companies pc ON pc.id=cpc.company_id
        WHERE c.deleted_at IS NULL AND ${incompleteCompanyWhere} ORDER BY c.title COLLATE NOCASE LIMIT 100`).all() };
    results.incompleteProductionCompanyNames.count=database.prepare(`SELECT COUNT(DISTINCT c.id) count FROM content_items c
        JOIN content_production_companies cpc ON cpc.content_id=c.id JOIN production_companies pc ON pc.id=cpc.company_id
        WHERE c.deleted_at IS NULL AND ${incompleteCompanyWhere}`).get().count;
    results.duplicateTitles={ label:'Possible duplicate titles',items:database.prepare(`SELECT type,lower(trim(title)) key,group_concat(id,char(31)) ids,group_concat(title,char(31)) titles,COUNT(*) count
        FROM content_items WHERE deleted_at IS NULL GROUP BY type,lower(trim(title)),ifnull(release_date,'') HAVING COUNT(*)>1 ORDER BY count DESC LIMIT 100`).all()
        .map((row) => ({ ...row,items:row.ids.split(String.fromCharCode(31)).map((id,index) => ({ id,title:row.titles.split(String.fromCharCode(31))[index] })) })) };
    results.duplicateTitles.count=results.duplicateTitles.items.length;
    const activeRows=database.prepare('SELECT id,title,type,release_status,release_date,series_end_date,series_network,genres_json,presentation_forms_json,languages_json,tags_json,awards_json,countries_json,content_ratings_json,watch_sources_json,poster_url,trailer_url FROM content_items WHERE deleted_at IS NULL').all();
    const urlIssues=[]; const unrated=[]; const unrecognized=[]; const lifecycleIssues=[]; const sourceIssues=[];
    const catalogs=getCatalogs();
    const flatten=(groups=[]) => new Set(groups.flatMap((group) => [group.name,...(group.children || [])]));
    const knownGenres=flatten(catalogs.genres); const knownPresentations={ movie:flatten(catalogs.presentationForms.movie),series:flatten(catalogs.presentationForms.series) };
    const knownCountries=new Set(catalogs.countries.map((country) => country.code));
    const knownRatings=new Map(catalogs.ratingSystems.map((system) => [system.territory,new Set(system.codes)]));
    const validUrl=(value) => { if (!value) return true; try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } };
    activeRows.forEach((row) => {
        if (!validUrl(row.poster_url)) urlIssues.push({ id:row.id,title:row.title,field:'Poster URL' });
        if (!validUrl(row.trailer_url)) urlIssues.push({ id:row.id,title:row.title,field:'Trailer URL' });
        const ratings=parseJson(row.content_ratings_json);
        if (['Released','Airing','Between Seasons','Hiatus','Returning','Ended'].includes(row.release_status) && !ratings.length) unrated.push({ id:row.id,title:row.title });
        const invalidValues=[];
        parseJson(row.genres_json).filter((value) => !knownGenres.has(value)).forEach((value) => invalidValues.push(`genre: ${value}`));
        parseJson(row.presentation_forms_json).filter((value) => !knownPresentations[row.type]?.has(value)).forEach((value) => invalidValues.push(`presentation: ${value}`));
        parseJson(row.countries_json).filter((value) => !knownCountries.has(value)).forEach((value) => invalidValues.push(`country: ${value}`));
        ratings.filter((rating) => !knownRatings.get(rating.territory)?.has(rating.code)).forEach((rating) => invalidValues.push(`rating: ${rating.territory} ${rating.code}`));
        if (invalidValues.length) unrecognized.push({ id:row.id,title:row.title,values:invalidValues.join(', ') });
        if (row.type === 'series' && row.release_status === 'Ended' && !row.series_end_date) lifecycleIssues.push({ id:row.id,title:row.title,issue:'Ended without an end date' });
        parseJson(row.watch_sources_json).filter((source) => !source.method).forEach(() => sourceIssues.push({ id:row.id,title:row.title,issue:'Watching source without a method' }));
    });
    const resultList=(label,items) => ({ label,count:items.length,items:items.slice(0,100) });
    results.invalidUrls=resultList('Entries with invalid URLs',urlIssues);
    results.unclassifiedRatings=resultList('Released entries without official ratings',unrated);
    results.unrecognizedCatalogValues=resultList('Entries with unrecognized catalog values',unrecognized);
    results.inconsistentSeriesLifecycle=resultList('Series with inconsistent lifecycle dates',lifecycleIssues);
    results.incompleteWatchingSources=resultList('Entries with incomplete watching sources',sourceIssues);
    const episodeIssues=database.prepare(`SELECT c.id,c.title,COUNT(*) issue_count FROM content_items c JOIN seasons s ON s.series_id=c.id JOIN episodes e ON e.season_id=s.id
        WHERE c.deleted_at IS NULL AND (e.runtime_minutes IS NULL OR e.air_date IS NULL OR trim(e.air_date)='') GROUP BY c.id,c.title ORDER BY c.title COLLATE NOCASE`).all();
    results.incompleteEpisodes={ label:'Series with episodes missing runtime or release date',count:episodeIssues.length,items:episodeIssues };
    const validCreditRoles=new Set(['Creator','Co-Creator','Developer','Showrunner','Executive Producer','Producer','Head Writer','Series Director','Original Work Creator','Other']);
    const creditIssues=database.prepare(`SELECT c.id,c.title,sc.person_name,sc.role FROM series_credits sc JOIN content_items c ON c.id=sc.series_id WHERE c.deleted_at IS NULL`).all()
        .filter((credit) => !validCreditRoles.has(credit.role));
    results.unrecognizedSeriesCredits=resultList('Series credits with unrecognized roles',creditIssues);
    const canonicalGroups=[];
    const collectVariants=(category,label,records) => {
        const groups=new Map();
        records.forEach((record) => {
            const value=normalizeSingleLineText(record.value); const key=canonicalValueKey(value);
            if (!key || !value) return;
            const group=groups.get(key) || new Map(); const current=group.get(value) || { value,count:0,titles:[] };
            current.count += 1; if (record.id && current.titles.length < 12 && !current.titles.some((item) => item.id === record.id)) current.titles.push({ id:record.id,title:record.title });
            group.set(value,current); groups.set(key,group);
        });
        groups.forEach((variants,key) => { if (variants.size > 1) canonicalGroups.push({ category,label,key,variants:[...variants.values()].sort((a,b) => b.count-a.count || a.value.localeCompare(b.value)),preferred:[...variants.values()].sort((a,b) => b.count-a.count)[0].value }); });
    };
    collectVariants('watchProvider','Watching-source providers',activeRows.flatMap((row) => parseJson(row.watch_sources_json).filter((source) => source.provider).map((source) => ({ id:row.id,title:row.title,value:source.provider }))));
    collectVariants('network','Series networks',activeRows.filter((row) => row.type === 'series').flatMap((row) => String(row.series_network || '').split(',').map((value) => ({ id:row.id,title:row.title,value }))));
    collectVariants('creditName','Series-credit names',database.prepare(`SELECT c.id,c.title,sc.person_name value FROM series_credits sc JOIN content_items c ON c.id=sc.series_id WHERE c.deleted_at IS NULL`).all());
    results.canonicalSuggestions=canonicalGroups;
    const companies=database.prepare(`SELECT pc.id,pc.name,pc.canonical_name,COUNT(DISTINCT cpc.content_id) uses
        FROM production_companies pc LEFT JOIN content_production_companies cpc ON cpc.company_id=pc.id
        GROUP BY pc.id ORDER BY uses DESC,pc.name COLLATE NOCASE`).all();
    const ignored=new Set(database.prepare('SELECT canonical_name FROM production_company_merge_ignores').all().map((row) => row.canonical_name));
    const groups=new Map(); companies.forEach((company) => { const list=groups.get(company.canonical_name) || []; list.push(company); groups.set(company.canonical_name,list); });
    const companyTitles=database.prepare(`SELECT c.id,c.title FROM content_production_companies cpc
        JOIN content_items c ON c.id=cpc.content_id WHERE cpc.company_id=? AND c.deleted_at IS NULL ORDER BY c.title COLLATE NOCASE LIMIT 12`);
    results.companySuggestions=[...groups.entries()].filter(([key,members]) => members.length > 1 && !ignored.has(key)).map(([key,members]) => ({
        key,preferred:members[0].name,companies:members.map((company) => ({ ...company,titles:companyTitles.all(company.id) })),
    }));
    return { generatedAt:new Date().toISOString(),checks:results };
}

// Applies a confirmed canonical spelling to provider, network, or series-credit records.
function mergeCanonicalValues(payload,context={}) {
    const category=String(payload.category || ''); const preferred=normalizeSingleLineText(payload.preferred);
    const variants=[...new Set((Array.isArray(payload.variants) ? payload.variants : []).map(normalizeSingleLineText).filter(Boolean))];
    if (!['watchProvider','network','creditName'].includes(category) || !preferred || variants.length < 2) throw Object.assign(new Error('Choose a supported category, canonical value, and at least two variants'),{ status:400 });
    const selected=new Set(variants.map((value) => value.toLocaleLowerCase())); const backupFile=createDatabaseBackup(database,'pre-canonical-merge'); const now=new Date().toISOString();
    let updated=0;
    runTransaction(() => {
        if (category === 'watchProvider') database.prepare('SELECT id,watch_sources_json FROM content_items WHERE deleted_at IS NULL').all().forEach((row) => {
            const sources=parseJson(row.watch_sources_json); let changed=false;
            sources.forEach((source) => { if (selected.has(normalizeSingleLineText(source.provider).toLocaleLowerCase())) { source.provider=preferred; changed=true; } });
            if (changed) { database.prepare('UPDATE content_items SET watch_sources_json=?,updated_at=? WHERE id=?').run(JSON.stringify(normalizeWatchSources(sources)),now,row.id); updated += 1; }
        });
        if (category === 'network') database.prepare("SELECT id,series_network FROM content_items WHERE type='series' AND deleted_at IS NULL").all().forEach((row) => {
            const values=String(row.series_network || '').split(',').map(normalizeSingleLineText).filter(Boolean); const replaced=values.map((value) => selected.has(value.toLocaleLowerCase()) ? preferred : value);
            if (replaced.some((value,index) => value !== values[index])) { database.prepare('UPDATE content_items SET series_network=?,updated_at=? WHERE id=?').run(normalizeCommaSeparatedText(replaced.join(',')),now,row.id); updated += 1; }
        });
        if (category === 'creditName') { const placeholders=variants.map(() => '?').join(','); updated=database.prepare(`UPDATE series_credits SET person_name=?,updated_at=? WHERE lower(person_name) IN (${placeholders})`).run(preferred,now,...variants.map((value) => value.toLocaleLowerCase())).changes; }
        writeAudit('canonical_merge',category,null,{ preferred,variants,updated,backup:path.basename(backupFile) },context);
    });
    return { category,preferred,updated,backupFile };
}

// Merges reviewed company aliases into one canonical record and refreshes affected titles.
function mergeProductionCompanies(payload,context={}) {
    const selectedKeepId=String(payload.keepId || '');
    const selectedMergeIds=[...new Set((Array.isArray(payload.mergeIds) ? payload.mergeIds : []).map(String).filter((id) => id && id !== selectedKeepId))];
    const selectedKeep=database.prepare('SELECT * FROM production_companies WHERE id=?').get(selectedKeepId);
    if (!selectedKeep || !selectedMergeIds.length) throw Object.assign(new Error('Choose one company to keep and at least one alias to merge'),{ status:400 });
    const selectedMerging=selectedMergeIds.map((id) => database.prepare('SELECT * FROM production_companies WHERE id=?').get(id));
    if (selectedMerging.some((company) => !company)) throw Object.assign(new Error('One of the selected company records no longer exists'),{ status:404 });
    const preferredName=fullCompanyName(payload.preferredName || selectedKeep.name);
    if (!preferredName) throw Object.assign(new Error('A full canonical company name is required'),{ status:400 });
    const preferredOwner=database.prepare('SELECT * FROM production_companies WHERE name=? COLLATE NOCASE').get(preferredName);
    const selected=[selectedKeep,...selectedMerging];
    const keep=preferredOwner || selectedKeep;
    const merging=[...new Map([...selected,...(preferredOwner ? [] : [])].filter((company) => company.id !== keep.id).map((company) => [company.id,company])).values()];
    const mergeIds=merging.map((company) => company.id);
    const keepId=keep.id;
    const affectedIds=[keepId,...mergeIds];
    const affected=[...new Set(database.prepare(`SELECT content_id FROM content_production_companies WHERE company_id IN (${affectedIds.map(() => '?').join(',')})`).all(...affectedIds).map((row) => row.content_id))];
    const backupFile=createDatabaseBackup(database,'pre-company-merge');
    runTransaction(() => {
        const alias=database.prepare(`INSERT INTO production_company_aliases(alias,company_id,created_at) VALUES(?,?,?)
            ON CONFLICT(alias) DO UPDATE SET company_id=excluded.company_id`);
        [...selected,...(preferredOwner ? [preferredOwner] : [])].forEach((company) => alias.run(company.name,keepId,new Date().toISOString()));
        const move=database.prepare('INSERT OR IGNORE INTO content_production_companies(content_id,company_id) SELECT content_id,? FROM content_production_companies WHERE company_id=?');
        mergeIds.forEach((id) => move.run(keepId,id));
        mergeIds.forEach((id) => database.prepare('DELETE FROM content_production_companies WHERE company_id=?').run(id));
        mergeIds.forEach((id) => database.prepare('DELETE FROM production_companies WHERE id=?').run(id));
        database.prepare('UPDATE production_companies SET name=?,canonical_name=? WHERE id=?').run(preferredName,companyKey(preferredName),keepId);
        alias.run(preferredName,keepId,new Date().toISOString());
        const names=database.prepare(`SELECT pc.name FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
            WHERE cpc.content_id=? ORDER BY pc.name COLLATE NOCASE`);
        const update=database.prepare('UPDATE content_items SET production_company=?,updated_at=? WHERE id=?');
        const now=new Date().toISOString();
        affected.forEach((id) => update.run(names.all(id).map((row) => row.name).join(', '),now,id));
        database.prepare('DELETE FROM production_company_merge_ignores WHERE canonical_name=?').run(companyKey(preferredName));
        writeAudit('merge','production-company',keepId,{ preferredName,merged:merging.map((company) => company.name),affectedTitles:affected.length,backup:path.basename(backupFile) },context);
    });
    return { company:{ id:keepId,name:preferredName },merged:merging.length,affectedTitles:affected.length,
        reusedExistingCanonical:Boolean(preferredOwner && preferredOwner.id !== selectedKeepId),backupFile };
}

// Dismisses one reviewed duplicate suggestion without changing company or title data.
function dismissProductionCompanySuggestion(key,context={}) {
    const canonical=String(key || '').trim();
    if (!canonical) throw Object.assign(new Error('A company suggestion key is required'),{ status:400 });
    database.prepare('INSERT OR REPLACE INTO production_company_merge_ignores(canonical_name,created_at) VALUES(?,?)').run(canonical,new Date().toISOString());
    writeAudit('dismiss-merge-suggestion','production-company',null,{ canonicalName:canonical },context);
    return { canonicalName:canonical };
}

// Reconstructs nested series and history data from a portable export payload.
function importItems(payload) {
    if (!payload || !Array.isArray(payload.content)) throw Object.assign(new Error('Select a valid CineVault JSON export'),{ status:400 });
    return payload.content.map((item) => {
        if (item.type !== 'series') return item;
        const seasons=(payload.seasons || []).filter((season) => season.series_id === item.id).map((season) => ({
            id:season.id,seasonNumber:season.season_number,title:season.title,status:season.status,releaseDate:season.release_date || '',posterUrl:season.poster_url || '',
            synopsis:season.synopsis || '',completionStatus:season.completion_status || 'Not Started',
            episodes:(payload.episodes || []).filter((episode) => episode.season_id === season.id).map((episode) => ({
                id:episode.id,episodeNumber:episode.episode_number,title:episode.title,airDate:episode.air_date || '',duration:episode.runtime_minutes ?? '',
                progressSeconds:episode.progress_seconds || 0,summary:episode.summary || '',episodeType:episode.episode_type || 'Regular',director:episode.director || '',watchHistory:(payload.episodeWatchHistory || [])
                    .filter((history) => history.episode_id === episode.id).map((history) => ({ id:history.id,watchedAt:history.watched_at })),
            })),
        }));
        return { ...item,seasons };
    });
}

// Compares an export with the active library without changing stored data.
function previewImport(payload) {
    const items=importItems(payload);
    const rows=items.map((item) => {
        const match=database.prepare("SELECT id,title FROM content_items WHERE lower(trim(title))=? AND ifnull(release_date,'')=? AND type=? AND deleted_at IS NULL")
            .get(normalizeTitle(item.title),item.releaseDate || '',item.type === 'series' ? 'series' : 'movie');
        return { importId:item.id,title:item.title || 'Untitled',type:item.type || 'movie',releaseDate:item.releaseDate || '',existingId:match?.id || null,conflict:Boolean(match) };
    });
    return { schemaVersion:payload.schemaVersion || 1,total:rows.length,newItems:rows.filter((row) => !row.conflict).length,
        conflicts:rows.filter((row) => row.conflict).length,items:rows };
}

// Applies reviewed import decisions after creating one verified recovery backup.
function applyImport(payload,decisions = {},context = {}) {
    const items=importItems(payload); const backup=createDatabaseBackup(database,'pre-json-import');
    const result={ added:0,replaced:0,merged:0,skipped:0,backup:path.basename(backup) };
    items.forEach((incoming) => {
        const existingRow=database.prepare("SELECT id FROM content_items WHERE lower(trim(title))=? AND ifnull(release_date,'')=? AND type=? AND deleted_at IS NULL")
            .get(normalizeTitle(incoming.title),incoming.releaseDate || '',incoming.type === 'series' ? 'series' : 'movie');
        if (!existingRow) { addContent({ ...incoming,id:crypto.randomUUID() },context); result.added += 1; return; }
        const decision=decisions[incoming.id] || 'skip';
        if (decision === 'skip') { result.skipped += 1; return; }
        const existing=getById(existingRow.id);
        if (decision === 'replace') { updateContent({ ...incoming,id:existing.id },context); result.replaced += 1; return; }
        const union=(first=[],second=[]) => [...new Map([...first,...second].map((value) => [typeof value === 'object' ? JSON.stringify(value) : value,value])).values()];
        updateContent({ ...existing,
            genres:union(existing.genres,incoming.genres),presentationForms:union(existing.presentationForms,incoming.presentationForms),language:union(existing.language,incoming.language),awards:union(existing.awards,incoming.awards),
            tags:union(existing.tags,incoming.tags),countryOfOrigin:union(existing.countryOfOrigin,incoming.countryOfOrigin),
            contentRatings:union(existing.contentRatings,incoming.contentRatings),watchSources:union(existing.watchSources,incoming.watchSources),
            watchHistory:union(existing.watchHistory,incoming.watchHistory),contentLinks:union(existing.contentLinks,incoming.contentLinks),
            seasons:existing.seasons?.length ? existing.seasons : incoming.seasons,
        },context); result.merged += 1;
    });
    writeAudit('import','library',null,result,context);
    return result;
}

// Creates a portable JSON export and returns its filesystem location.
function exportJson(context = {}) {
    const payload = buildExportPayload();
    fs.mkdirSync(EXPORT_DIR,{ recursive:true });
    const file = path.join(EXPORT_DIR, `cinevault.${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    writeAudit('export', 'library', null, { format:'json',destination:'server',filename:path.basename(file),contentCount:payload.content.length }, context);
    return file;
}

// Creates a verified backup from the active application database.
function createBackup(context = {}) {
    const file = createDatabaseBackup(database, context.actor === 'cli' ? 'manual' : 'automatic');
    writeAudit('backup', 'database', null, { filename:path.basename(file),bytes:fs.statSync(file).size,verified:true }, context);
    return file;
}

// Exposes structured audit recording for non-content application events.
function recordAudit(action, entityType, entityId, details = {}, context = {}) {
    writeAudit(action, entityType, entityId, details, context);
}

// Returns a filtered page of structured audit events for diagnostics.
function getAudit(query = {}) {
    const limit = Math.min(200,Math.max(1,Number(query.limit) || 50));
    const page = Math.max(1,Number(query.page) || 1);
    const clauses = ['1=1'];
    const parameters = [];
    for (const [queryName,column] of [['action','action'],['entityId','entity_id'],['outcome','outcome']]) {
        if (query[queryName]) { clauses.push(`${column}=?`); parameters.push(query[queryName]); }
    }
    const categoryPrefixes={ Library:['create','update','trash','restore','permanent-delete','favorite','bulk_update','merge','canonical'],Viewing:['watch'],Security:['auth.','security.'],Backup:['backup'],Transfer:['export','import'],Assets:['asset'],System:['system.','database.','migration'] };
    if (query.category && categoryPrefixes[query.category]) {
        const parts=categoryPrefixes[query.category].map(() => 'action LIKE ?'); clauses.push(`(${parts.join(' OR ')})`);
        categoryPrefixes[query.category].forEach((prefix) => parameters.push(`${prefix}%`));
    }
    if (query.search) {
        const value=`%${String(query.search).trim()}%`;
        clauses.push(`(action LIKE ? OR entity_type LIKE ? OR ifnull(entity_id,'') LIKE ? OR details_json LIKE ? OR ifnull(before_json,'') LIKE ? OR ifnull(after_json,'') LIKE ? OR ifnull(request_id,'') LIKE ?)`);
        parameters.push(value,value,value,value,value,value,value);
    }
    if (query.from) { clauses.push('created_at>=?'); parameters.push(`${query.from}T00:00:00.000Z`); }
    if (query.to) { clauses.push('created_at<=?'); parameters.push(`${query.to}T23:59:59.999Z`); }
    const where = clauses.join(' AND ');
    const total = database.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`).get(...parameters).count;
    const rows = database.prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...parameters,limit,(page - 1) * limit);
    return { total,page,limit,pages:Math.ceil(total / limit),events:rows.map((row) => {
        const details=parseJson(row.details_json,{}); const before=parseJson(row.before_json,null); const after=parseJson(row.after_json,null);
        const action=row.action; const category=action.startsWith('auth.') || action.startsWith('security.') ? 'Security'
            : action.startsWith('asset') ? 'Assets' : action.includes('backup') ? 'Backup' : action.includes('export') || action.includes('import') ? 'Transfer'
                : action.startsWith('system.') || action.startsWith('database.') || row.entity_type === 'operation' || row.entity_type === 'database' || row.actor === 'migration' ? 'System'
                    : action.includes('watch') ? 'Viewing' : 'Library';
        return { id:row.id,action,category,severity:row.outcome === 'failure' ? 'error' : action.includes('trash') || action.includes('delete') ? 'warning' : 'info',
            entityType:row.entity_type,entityId:row.entity_id,subjectTitle:details.title || before?.title || after?.title || details.conflict?.title || '',requestId:row.request_id,
            actor:row.actor,outcome:row.outcome,details,before,after,metadata:parseJson(row.metadata_json,{}),createdAt:row.created_at };
    }) };
}

module.exports = { getContent,getMovies,getById,addContent,updateContent,bulkUpdateContent,deleteContent,restoreContent,permanentlyDeleteContent,toggleFavorite,
    getNotifications,markNotificationRead,buildExportPayload,exportJson,createBackup,recordAudit,getAudit,getStatistics,getDataHealth,mergeCanonicalValues,previewImport,applyImport,getFilterCatalogs,searchProductionCompanies,mergeProductionCompanies,dismissProductionCompanySuggestion,normalizeTitle };
