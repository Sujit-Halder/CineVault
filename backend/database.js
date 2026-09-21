const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const { normalizeCountryCodes, normalizeContentRatings, normalizeWatchSources, normalizeSubtype } = require('./catalogs');
const { normalizeSingleLineText, normalizeCommaSeparatedText, normalizeMultilineText } = require('./text-normalization');
const { fullCompanyName,companyKey } = require('./company-normalization');
const logger = require('./logger');

const DATA_DIR = process.env.MOVIE_TRACKER_DATA_DIR ? path.resolve(process.env.MOVIE_TRACKER_DATA_DIR) : path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const DATABASE_FILE = path.join(DATA_DIR, 'movie-tracker.sqlite');
const LEGACY_FILE = path.join(__dirname, 'movies.json');
const OFFICIAL_INDIAN_RATINGS = new Map([
    ['Phule','U'],['War 2','UA 16+'],['Maa','UA 16+'],['Kantara: Chapter 1','UA 16+'],
    ['Saiyaara','UA 16+'],['Lokah Chapter 1: Chandra','UA 16+'],['Jolly LLB 3','UA 16+'],
    ['Param Sundari','UA 13+'],['Maargan','UA 13+'],['Kannappa','UA 13+'],['Mirai','UA 16+'],['Thamma','UA 16+'],
]);

// Creates the application data directories when they are not present.
function ensureDirectories() {
    [DATA_DIR, BACKUP_DIR, EXPORT_DIR].forEach((directory) => fs.mkdirSync(directory, { recursive: true }));
}

// Returns a filesystem-safe timestamp for generated artifacts.
function fileTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

// Encrypts a verified backup for storage outside the application data directory.
function encryptBackupForMirror(source, destination, passphrase) {
    const salt=crypto.randomBytes(16);
    const iv=crypto.randomBytes(12);
    const key=crypto.scryptSync(passphrase,salt,32);
    const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
    const plaintext=fs.readFileSync(source);
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const tag=cipher.getAuthTag();
    const envelope=Buffer.concat([Buffer.from('CINEVAULT1'),salt,iv,tag,ciphertext]);
    fs.writeFileSync(destination,envelope,{ flag:'wx',mode:0o600 });

    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAuthTag(tag);
    const verified=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    if (!crypto.timingSafeEqual(crypto.createHash('sha256').update(plaintext).digest(),crypto.createHash('sha256').update(verified).digest())) {
        fs.unlinkSync(destination);
        throw new Error('Encrypted backup verification failed');
    }
}

// Applies count-based manual retention and calendar-based automatic retention to one backup directory.
function pruneBackups(directory,label,encrypted=false,protectedPath='') {
    const suffix=encrypted ? '.sqlite.cvbackup' : '.sqlite';
    const files=fs.readdirSync(directory).filter((name) => name.startsWith(`${label}.`) && name.endsWith(suffix))
        .map((name) => ({ name,path:path.join(directory,name),modified:fs.statSync(path.join(directory,name)).mtime }))
        .sort((a,b) => a.path === protectedPath ? -1 : b.path === protectedPath ? 1 : b.modified - a.modified);
    if (label === 'manual') {
        const limit=Number(process.env.MANUAL_BACKUP_RETENTION || 10);
        if (limit > 0) files.slice(limit).forEach((file) => fs.unlinkSync(file.path));
        return;
    }
    if (label !== 'automatic') return;
    const dailyDays=Math.max(0,Number(process.env.AUTOMATIC_DAILY_RETENTION_DAYS || 30));
    const monthlyMonths=Math.max(0,Number(process.env.AUTOMATIC_MONTHLY_RETENTION_MONTHS || 12));
    const now=Date.now(); const keep=new Set(); const days=new Set(); const months=new Set();
    files.forEach((file) => {
        const ageDays=(now-file.modified.getTime()) / 86400000;
        const day=file.modified.toISOString().slice(0,10); const month=day.slice(0,7);
        if (ageDays <= dailyDays) { if (!days.has(day)) { days.add(day); keep.add(file.path); } }
        else if (months.size < monthlyMonths && !months.has(month)) { months.add(month); keep.add(file.path); }
    });
    files.filter((file) => !keep.has(file.path)).forEach((file) => fs.unlinkSync(file.path));
}

// Copies the legacy JSON source into the backup directory before its first import.
function archiveLegacySource() {
    if (!fs.existsSync(LEGACY_FILE)) return null;
    const destination = path.join(BACKUP_DIR, `movies.pre-sqlite.${fileTimestamp()}.json`);
    fs.copyFileSync(LEGACY_FILE, destination, fs.constants.COPYFILE_EXCL);
    return destination;
}

// Creates all tables and indexes required by the current schema version.
function createSchema(database) {
    database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        PRAGMA busy_timeout = 5000;
        CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS content_items (
            id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('movie','series')), subtype TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL, original_title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Announced',
            production_status TEXT NOT NULL DEFAULT 'Unknown', release_status TEXT NOT NULL DEFAULT 'Unscheduled',
            release_date TEXT,series_start_date TEXT,series_end_date TEXT,series_continuing INTEGER NOT NULL DEFAULT 0,series_network TEXT NOT NULL DEFAULT '',
            watch_date TEXT, runtime_minutes INTEGER, director TEXT NOT NULL DEFAULT '',
            casts TEXT NOT NULL DEFAULT '', personal_rating TEXT NOT NULL DEFAULT '', production_company TEXT NOT NULL DEFAULT '',
            poster_url TEXT NOT NULL DEFAULT '', trailer_url TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '',
            source_reference TEXT NOT NULL DEFAULT '', favorite INTEGER NOT NULL DEFAULT 0,
            genres_json TEXT NOT NULL DEFAULT '[]', languages_json TEXT NOT NULL DEFAULT '[]',
            awards_json TEXT NOT NULL DEFAULT '[]', tags_json TEXT NOT NULL DEFAULT '[]', countries_json TEXT NOT NULL DEFAULT '[]',
            content_ratings_json TEXT NOT NULL DEFAULT '[]', watch_sources_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS seasons (
            id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            season_number INTEGER, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Announced',
            production_status TEXT NOT NULL DEFAULT 'Unknown', release_status TEXT NOT NULL DEFAULT 'Unscheduled',
            release_date TEXT, poster_url TEXT NOT NULL DEFAULT '', synopsis TEXT NOT NULL DEFAULT '', completion_status TEXT NOT NULL DEFAULT 'Not Started', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(series_id, season_number)
        );
        CREATE TABLE IF NOT EXISTS episodes (
            id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            episode_number INTEGER, title TEXT NOT NULL, air_date TEXT, runtime_minutes INTEGER,
            watched INTEGER NOT NULL DEFAULT 0, watch_date TEXT, progress_seconds INTEGER NOT NULL DEFAULT 0,
            summary TEXT NOT NULL DEFAULT '', episode_type TEXT NOT NULL DEFAULT 'Regular', director TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(season_id, episode_number)
        );
        CREATE TABLE IF NOT EXISTS series_credits (
            id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            person_name TEXT NOT NULL, role TEXT NOT NULL, display_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            UNIQUE(series_id,person_name,role)
        );
        CREATE TABLE IF NOT EXISTS notifications (
            id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            asset_type TEXT NOT NULL CHECK(asset_type IN ('poster','trailer')), status TEXT NOT NULL DEFAULT 'broken',
            reason TEXT NOT NULL, asset_url TEXT NOT NULL, detected_at TEXT NOT NULL, read_at TEXT, resolved_at TEXT
        );
        CREATE TABLE IF NOT EXISTS asset_checks (
            content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,asset_type TEXT NOT NULL,
            asset_url TEXT NOT NULL,status TEXT NOT NULL,last_checked_at TEXT NOT NULL,last_healthy_at TEXT,
            PRIMARY KEY(content_id,asset_type)
        );
        CREATE TABLE IF NOT EXISTS watch_history (
            id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            watched_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS episode_watch_history (
            id TEXT PRIMARY KEY, episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
            watched_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_links (
            id TEXT PRIMARY KEY, content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            url TEXT NOT NULL, domain TEXT NOT NULL, created_at TEXT NOT NULL,
            UNIQUE(content_id,url)
        );
        CREATE TABLE IF NOT EXISTS production_companies (
            id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, canonical_name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS production_company_aliases (
            alias TEXT PRIMARY KEY COLLATE NOCASE,
            company_id TEXT NOT NULL REFERENCES production_companies(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS production_company_merge_ignores (
            canonical_name TEXT PRIMARY KEY,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_production_companies (
            content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            company_id TEXT NOT NULL REFERENCES production_companies(id) ON DELETE CASCADE,
            PRIMARY KEY(content_id,company_id)
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
            entity_id TEXT, details_json TEXT NOT NULL DEFAULT '{}', request_id TEXT, actor TEXT,
            outcome TEXT NOT NULL DEFAULT 'success', before_json TEXT, after_json TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_active ON notifications(content_id, asset_type) WHERE resolved_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(type);
        CREATE INDEX IF NOT EXISTS idx_content_updated ON content_items(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_content_title ON content_items(title COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, resolved_at);
        CREATE INDEX IF NOT EXISTS idx_watch_history_content_date ON watch_history(content_id,watched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_episode_watch_history_episode_date ON episode_watch_history(episode_id,watched_at DESC);
        CREATE INDEX IF NOT EXISTS idx_content_links_content ON content_links(content_id);
        CREATE INDEX IF NOT EXISTS idx_content_company_content ON content_production_companies(content_id);
    `);
    database.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(new Date().toISOString());
}

// Infers a territory for legacy rating codes when the original record omitted it.
function inferLegacyRatingTerritory(code) {
    if (['U', 'U/A', 'A', 'S'].includes(code)) return 'IND';
    return 'USA';
}

// Maps historical source labels to the current access-method catalog.
function mapLegacyWatchMethod(source) {
    const mapping = {
        Cinema: 'cinema', 'OTT Platform': 'subscription-streaming', YouTube: 'free-legal-streaming',
        'Free Streaming Site': 'free-streaming-legacy', 'Torrent Download': 'local-file-legacy',
        'Piracy Website': 'custom-legacy', 'File Transfer': 'local-file', 'TV Broadcast': 'broadcast-tv',
        'Blu-ray / DVD': 'physical-media', 'Online Rental': 'digital-rental',
        "Friend's Account": 'shared-access-legacy', 'Screening Event': 'festival-screening',
        'School / Institution': 'institutional', 'Hotel / Flight Entertainment': 'travel-entertainment', Other: 'other',
    };
    return mapping[source] || 'other';
}

// Applies a verified title-specific Indian certificate when one is available.
function applyOfficialIndianRating(title, ratings) {
    const code = OFFICIAL_INDIAN_RATINGS.get(String(title || '').trim());
    if (!code) return ratings;
    return ratings.map((rating) => rating.territory === 'IN'
        ? { territory:'IN',system:'Central Board of Film Certification',code,previousCode:rating.previousCode || rating.code,
            classificationBasis:'Official CBFC certificate',classificationConfidence:'high' }
        : rating);
}

// Converts a legacy movie record into the current content representation.
function normalizeLegacyMovie(movie) {
    const now = new Date().toISOString();
    return {
        id: movie.id, type: 'movie', subtype: 'Feature Film', title: movie.title || 'Untitled', originalTitle: '',
        status: movie.status || 'Announced', releaseDate: movie.releaseDate || null, watchDate: movie.watchDate || null,
        duration: movie.duration ? Number(movie.duration) || null : null, director: movie.director || '', casts: movie.casts || '',
        rating: movie.rating || '', productionCompany: movie.productionCompany || '', posterUrl: movie.posterUrl || '',
        trailerUrl: movie.trailerUrl || '', summary: movie.summary || '', sourceReference: movie.sourceReference || '',
        favorite: Boolean(movie.favorite), genres: Array.isArray(movie.genres) ? movie.genres : [],
        language: Array.isArray(movie.language) ? movie.language : [], awards: Array.isArray(movie.awards) ? movie.awards : [],
        tags: Array.isArray(movie.tags) ? movie.tags : [], countryOfOrigin: normalizeCountryCodes(Array.isArray(movie.countryOfOrigin) ? movie.countryOfOrigin : []),
        contentRatings: applyOfficialIndianRating(movie.title,normalizeContentRatings((Array.isArray(movie.contentRating) ? movie.contentRating : []).map((code) => ({ territory: inferLegacyRatingTerritory(code), code })))),
        watchSources: normalizeWatchSources((Array.isArray(movie.sourceOfWatch) ? movie.sourceOfWatch : []).map((provider) => ({ method: mapLegacyWatchMethod(provider), provider }))),
        creation: movie.creation || now, modification: movie.modification || movie.creation || now,
    };
}

// Inserts a normalized content item into SQLite.
function insertContent(database, item) {
    database.prepare(`INSERT INTO content_items (
        id,type,subtype,title,original_title,status,release_date,watch_date,runtime_minutes,director,casts,personal_rating,
        production_company,poster_url,trailer_url,summary,source_reference,favorite,genres_json,languages_json,awards_json,
        tags_json,countries_json,content_ratings_json,watch_sources_json,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        item.id,item.type,item.subtype,item.title,item.originalTitle,item.status,item.releaseDate,item.watchDate,item.duration,
        item.director,item.casts,item.rating,item.productionCompany,item.posterUrl,item.trailerUrl,item.summary,item.sourceReference,
        item.favorite ? 1 : 0,JSON.stringify(item.genres),JSON.stringify(item.language),JSON.stringify(item.awards),
        JSON.stringify(item.tags),JSON.stringify(item.countryOfOrigin),JSON.stringify(item.contentRatings),
        JSON.stringify(item.watchSources),item.creation,item.modification
    );
}

// Imports the legacy JSON dataset once and returns a verification report.
function migrateLegacyData(database) {
    const existing = database.prepare('SELECT COUNT(*) AS count FROM content_items').get().count;
    if (existing > 0 || !fs.existsSync(LEGACY_FILE)) return null;
    const source = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const report = { startedAt: new Date().toISOString(), source: LEGACY_FILE, sourceRecords: source.length, imported: 0, warnings: [], failures: [], archive: archiveLegacySource() };
    database.exec('BEGIN IMMEDIATE');
    try {
        source.forEach((movie, index) => {
            try { insertContent(database, normalizeLegacyMovie(movie)); report.imported += 1; }
            catch (error) { report.failures.push({ index, id: movie.id, title: movie.title, message: error.message }); }
        });
        if (report.failures.length) throw new Error(`${report.failures.length} records could not be imported`);
        database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); report.error = error.message; }
    report.completedAt = new Date().toISOString();
    report.databaseRecords = database.prepare('SELECT COUNT(*) AS count FROM content_items').get().count;
    report.integrity = database.prepare('PRAGMA integrity_check').get().integrity_check;
    const reportFile = path.join(EXPORT_DIR, `migration-report.${fileTimestamp()}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    report.reportFile = reportFile;
    return report;
}

// Normalizes stored origin countries and records schema migration version two.
function migrateCountryCodes(database, version, backupLabel) {
    const applied = database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version);
    if (applied) return null;
    const rows = database.prepare('SELECT id,countries_json FROM content_items').all();
    const changes = rows.map((row) => {
        let countries = [];
        try { countries = JSON.parse(row.countries_json || '[]'); } catch { countries = []; }
        const normalized = normalizeCountryCodes(countries);
        return { id:row.id, countries, normalized };
    }).filter((row) => JSON.stringify(row.countries) !== JSON.stringify(row.normalized));
    if (changes.length) createBackup(database, backupLabel);
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET countries_json=? WHERE id=?');
        changes.forEach((row) => update.run(JSON.stringify(row.normalized), row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version, new Date().toISOString());
        database.exec('COMMIT');
        return { version, examined:rows.length, changed:changes.length };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Adds structured correlation and before/after fields to the audit trail.
function migrateAuditSchema(database) {
    const version = 5;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const existingColumns = new Set(database.prepare('PRAGMA table_info(audit_log)').all().map((column) => column.name));
    const columns = [
        ['request_id','TEXT'],['actor','TEXT'],["outcome","TEXT NOT NULL DEFAULT 'success'"],
        ['before_json','TEXT'],['after_json','TEXT'],["metadata_json","TEXT NOT NULL DEFAULT '{}'"],
    ];
    const missing = columns.filter(([name]) => !existingColumns.has(name));
    if (missing.length) createBackup(database, 'pre-audit-schema');
    database.exec('BEGIN IMMEDIATE');
    try {
        missing.forEach(([name,type]) => database.exec(`ALTER TABLE audit_log ADD COLUMN ${name} ${type}`));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.exec('COMMIT');
        return { version, addedColumns:missing.map(([name]) => name) };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Normalizes stored rating territories and authorities while preserving historical certificate values.
function migrateContentRatings(database) {
    const version = 6;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,content_ratings_json FROM content_items').all();
    const changes = rows.map((row) => {
        let ratings = [];
        try { ratings = JSON.parse(row.content_ratings_json || '[]'); } catch { ratings = []; }
        const normalized = normalizeContentRatings(ratings);
        return { id:row.id, ratings, normalized };
    }).filter((row) => JSON.stringify(row.ratings) !== JSON.stringify(row.normalized));
    const backup = changes.length ? createBackup(database, 'pre-content-rating-normalization') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET content_ratings_json=? WHERE id=?');
        changes.forEach((row) => update.run(JSON.stringify(row.normalized), row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-ratings','database',JSON.stringify({ examined:rows.length,changed:changes.length }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),new Date().toISOString());
        database.exec('COMMIT');
        return { version, examined:rows.length, changed:changes.length, backup:backup ? path.basename(backup) : null };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Promotes imported viewing sources into the maintained source catalog while retaining their provider values.
function migrateWatchSources(database) {
    const version = 7;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,watch_sources_json FROM content_items').all();
    const changes = rows.map((row) => {
        let sources = [];
        try { sources = JSON.parse(row.watch_sources_json || '[]'); } catch { sources = []; }
        const normalized = normalizeWatchSources(sources);
        return { id:row.id, sources, normalized };
    }).filter((row) => JSON.stringify(row.sources) !== JSON.stringify(row.normalized));
    const backup = changes.length ? createBackup(database, 'pre-watch-source-normalization') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET watch_sources_json=? WHERE id=?');
        changes.forEach((row) => update.run(JSON.stringify(row.normalized), row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-watch-sources','database',JSON.stringify({ examined:rows.length,changed:changes.length }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),new Date().toISOString());
        database.exec('COMMIT');
        return { version, examined:rows.length, changed:changes.length, backup:backup ? path.basename(backup) : null };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Assigns current Indian age markers using official certificates and corroborating stored classifications.
function migrateHistoricalIndianRatings(database) {
    const version = 8;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,title,content_ratings_json FROM content_items').all();
    const changes = [];
    rows.forEach((row) => {
        let ratings = [];
        try { ratings = JSON.parse(row.content_ratings_json || '[]'); } catch { ratings = []; }
        if (!ratings.some((rating) => rating.territory === 'IN' && rating.code === 'U/A')) return;
        const officialCode = OFFICIAL_INDIAN_RATINGS.get(row.title.trim());
        const usCode = ratings.find((rating) => rating.territory === 'US')?.code;
        let code = officialCode;
        let basis = 'Official CBFC certificate';
        let confidence = 'high';
        if (!code) {
            if (['G','PG','TV-Y','TV-Y7','TV-G','TV-PG'].includes(usCode)) code = 'UA 7+';
            else if (['R','NC-17','TV-MA'].includes(usCode)) code = 'UA 16+';
            else code = 'UA 13+';
            basis = usCode ? `Severity cross-check from US ${usCode}` : 'Historical U/A baseline';
            confidence = usCode ? 'moderate' : 'conservative';
        }
        const normalized = ratings.map((rating) => rating.territory === 'IN' && rating.code === 'U/A'
            ? { territory:'IN',system:'Central Board of Film Certification',code,previousCode:'U/A',classificationBasis:basis,classificationConfidence:confidence }
            : rating);
        changes.push({ id:row.id, normalized, code, basis });
    });
    const backup = changes.length ? createBackup(database, 'pre-indian-age-marker-assignment') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET content_ratings_json=? WHERE id=?');
        changes.forEach((row) => update.run(JSON.stringify(row.normalized),row.id));
        const distribution = changes.reduce((totals,row) => ({ ...totals,[row.code]:(totals[row.code] || 0) + 1 }),{});
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('assign-indian-age-markers','database',JSON.stringify({ examined:rows.length,changed:changes.length,distribution }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),new Date().toISOString());
        database.exec('COMMIT');
        return { version,examined:rows.length,changed:changes.length,distribution,backup:backup ? path.basename(backup) : null };
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

// Moves single watch dates and valid source URLs into their maintained child tables.
function migrateWatchHistoryAndLinks(database) {
    const version = 9;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,title,watch_date,source_reference FROM content_items').all();
    const mismatches = [];
    const links = [];
    rows.forEach((row) => String(row.source_reference || '').split(/[|,\n]+/).map((value) => value.trim()).filter(Boolean).forEach((value) => {
        try {
            const url = new URL(value);
            if (!['http:','https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
            links.push({ contentId:row.id,url:url.href,domain:url.hostname.replace(/^www\./i,'').toLowerCase() });
        } catch { mismatches.push({ id:row.id,title:row.title,value }); }
    }));
    if (mismatches.length) return { version,blocked:true,mismatches };
    const watchRows = rows.filter((row) => row.watch_date);
    const backup = (watchRows.length || links.length) ? createBackup(database,'pre-watch-history-links') : null;
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const insertWatch = database.prepare('INSERT INTO watch_history(id,content_id,watched_at,created_at,updated_at) VALUES(?,?,?,?,?)');
        watchRows.forEach((row) => insertWatch.run(crypto.randomUUID(),row.id,row.watch_date,now,now));
        const insertLink = database.prepare('INSERT OR IGNORE INTO content_links(id,content_id,url,domain,created_at) VALUES(?,?,?,?,?)');
        links.forEach((link) => insertLink.run(crypto.randomUUID(),link.contentId,link.url,link.domain,now));
        database.exec("UPDATE content_items SET watch_date=NULL,source_reference=''");
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-watch-history-links','database',JSON.stringify({ examined:rows.length,watchDates:watchRows.length,links:links.length }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),now);
        database.exec('COMMIT');
        return { version,examined:rows.length,watchDates:watchRows.length,links:links.length,backup:backup ? path.basename(backup) : null };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
}

// Assigns deterministic five-minute timestamps to historical watch dates that contain no time.
function migrateMissingWatchTimes(database) {
    const version = 10;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare(`SELECT h.id,h.watched_at,c.created_at FROM watch_history h
        JOIN content_items c ON c.id=h.content_id ORDER BY substr(h.watched_at,1,10),c.created_at,c.id,h.id`).all();
    const missing = rows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.watched_at)
        || /T00:00(?::00(?:\.000)?)?(?:Z|[+-]00:00)?$/.test(row.watched_at));
    const counters = new Map();
    const changes = missing.map((row) => {
        const day = row.watched_at.slice(0,10);
        const position = (counters.get(day) || 0) + 1;
        counters.set(day,position);
        const [year,month,date] = day.split('-').map(Number);
        const watchedAt = new Date(year,month - 1,date,0,position * 5,0,0).toISOString();
        return { id:row.id,before:row.watched_at,watchedAt };
    });
    const backup = changes.length ? createBackup(database,'pre-watch-time-assignment') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE watch_history SET watched_at=?,updated_at=? WHERE id=?');
        const now = new Date().toISOString();
        changes.forEach((row) => update.run(row.watchedAt,now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('assign-watch-times','watch_history',JSON.stringify({ changed:changes.length,dates:counters.size,intervalMinutes:5 }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),now);
        database.exec('COMMIT');
        return { version,changed:changes.length,dates:counters.size,intervalMinutes:5,backup:backup ? path.basename(backup) : null };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
}

// Standardizes imported genre spelling while preserving every classification.
function migrateGenreNames(database) {
    const version = 11;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const aliases = new Map([['Coming Of Age','Coming of Age'],['Martial arts','Martial Arts'],['Road Flim','Road Film'],['Popaganda','Propaganda']]);
    const rows = database.prepare('SELECT id,genres_json FROM content_items').all();
    const changes = rows.map((row) => {
        let genres = [];
        try { genres = JSON.parse(row.genres_json || '[]'); } catch { genres = []; }
        const normalized = [...new Set(genres.map((genre) => aliases.get(genre) || genre))];
        return { id:row.id,genres,normalized };
    }).filter((row) => JSON.stringify(row.genres) !== JSON.stringify(row.normalized));
    const backup = changes.length ? createBackup(database,'pre-genre-name-normalization') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET genres_json=? WHERE id=?');
        changes.forEach((row) => update.run(JSON.stringify(row.normalized),row.id));
        const now = new Date().toISOString();
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-genre-names','database',JSON.stringify({ examined:rows.length,changed:changes.length,aliases:Object.fromEntries(aliases) }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),now);
        database.exec('COMMIT');
        return { version,examined:rows.length,changed:changes.length,backup:backup ? path.basename(backup) : null };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
}

// Converts stored subtype identifiers to maintained Title Case display labels.
function migrateContentSubtypes(database) {
    const version = 12;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,type,subtype FROM content_items').all();
    const changes = rows.map((row) => ({ ...row,normalized:normalizeSubtype(row.type,row.subtype) }))
        .filter((row) => row.subtype !== row.normalized);
    const backup = changes.length ? createBackup(database,'pre-subtype-normalization') : null;
    database.exec('BEGIN IMMEDIATE');
    try {
        const update = database.prepare('UPDATE content_items SET subtype=? WHERE id=?');
        changes.forEach((row) => update.run(row.normalized,row.id));
        const now = new Date().toISOString();
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-content-subtypes','database',JSON.stringify({ examined:rows.length,changed:changes.length }),
            'migration','success',JSON.stringify({ version,backup:backup ? path.basename(backup) : null }),now);
        database.exec('COMMIT');
        return { version,examined:rows.length,changed:changes.length,backup:backup ? path.basename(backup) : null };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
}

// Moves legacy episode completion dates into repeatable episode watch-history records.
function migrateEpisodeWatchHistory(database) {
    const version = 13;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows = database.prepare('SELECT id,watch_date,created_at FROM episodes WHERE watched=1 OR watch_date IS NOT NULL').all();
    const now = new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const insert = database.prepare('INSERT INTO episode_watch_history(id,episode_id,watched_at,created_at,updated_at) VALUES(?,?,?,?,?)');
        rows.forEach((row) => insert.run(crypto.randomUUID(),row.id,row.watch_date || row.created_at || now,now,now));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
            VALUES(?,?,?,?,?,?,?)`).run('normalize-episode-watch-history','episode_watch_history',JSON.stringify({ migrated:rows.length }),
            'migration','success',JSON.stringify({ version }),now);
        database.exec('COMMIT');
        return { version,migrated:rows.length };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
}

// Normalizes comma-separated production-company values into reusable relational records.
function migrateProductionCompanies(database) {
    const version=14;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare("SELECT id,production_company FROM content_items WHERE trim(production_company)<>''").all();
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const find=database.prepare('SELECT id,name FROM production_companies WHERE name=? COLLATE NOCASE');
        const insert=database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)');
        const link=database.prepare('INSERT OR IGNORE INTO content_production_companies(content_id,company_id) VALUES(?,?)');
        rows.forEach((row) => row.production_company.split(',').map((name) => name.trim().replace(/\s+/g,' ')).filter(Boolean).forEach((name) => {
            let company=find.get(name);
            if (!company) { const id=crypto.randomUUID(); insert.run(id,name,name.toLowerCase().replace(/[^a-z0-9]+/g,'')); company={ id }; }
            link.run(row.id,company.id);
        }));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,items:rows.length,companies:database.prepare('SELECT COUNT(*) count FROM production_companies').get().count };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Creates a synchronized full-text index for ranked library searching.
function migrateFullTextSearch(database) {
    const version=15;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(content_id UNINDEXED,title,original_title,director,casts,production_company,summary);
        INSERT INTO content_search(content_id,title,original_title,director,casts,production_company,summary)
            SELECT id,title,original_title,director,casts,production_company,summary FROM content_items;
        CREATE TRIGGER IF NOT EXISTS content_search_insert AFTER INSERT ON content_items BEGIN
            INSERT INTO content_search(content_id,title,original_title,director,casts,production_company,summary)
            VALUES(new.id,new.title,new.original_title,new.director,new.casts,new.production_company,new.summary); END;
        CREATE TRIGGER IF NOT EXISTS content_search_update AFTER UPDATE OF title,original_title,director,casts,production_company,summary ON content_items BEGIN
            DELETE FROM content_search WHERE content_id=old.id;
            INSERT INTO content_search(content_id,title,original_title,director,casts,production_company,summary)
            VALUES(new.id,new.title,new.original_title,new.director,new.casts,new.production_company,new.summary); END;
        CREATE TRIGGER IF NOT EXISTS content_search_delete AFTER DELETE ON content_items BEGIN
            DELETE FROM content_search WHERE content_id=old.id; END;`);
    const now=new Date().toISOString();
    database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
    return { version,indexed:database.prepare('SELECT COUNT(*) count FROM content_search').get().count };
}

// Rebuilds the main table without superseded single-value watch and source columns.
function removeLegacyContentColumns(database) {
    const version=16;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const backup=createBackup(database,'pre-legacy-column-removal');
    database.exec(`PRAGMA foreign_keys=OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE content_items_new (
            id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('movie','series')), subtype TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL, original_title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'Announced',
            release_date TEXT,series_start_date TEXT,series_end_date TEXT,series_continuing INTEGER NOT NULL DEFAULT 0,series_network TEXT NOT NULL DEFAULT '',
            runtime_minutes INTEGER, director TEXT NOT NULL DEFAULT '', casts TEXT NOT NULL DEFAULT '',
            personal_rating TEXT NOT NULL DEFAULT '', production_company TEXT NOT NULL DEFAULT '',poster_url TEXT NOT NULL DEFAULT '',
            trailer_url TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,
            genres_json TEXT NOT NULL DEFAULT '[]',languages_json TEXT NOT NULL DEFAULT '[]',awards_json TEXT NOT NULL DEFAULT '[]',
            tags_json TEXT NOT NULL DEFAULT '[]',countries_json TEXT NOT NULL DEFAULT '[]',content_ratings_json TEXT NOT NULL DEFAULT '[]',
            watch_sources_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT
        );
        INSERT INTO content_items_new(id,type,subtype,title,original_title,status,release_date,series_start_date,series_end_date,series_continuing,series_network,runtime_minutes,director,casts,
            personal_rating,production_company,poster_url,trailer_url,summary,favorite,genres_json,languages_json,awards_json,
            tags_json,countries_json,content_ratings_json,watch_sources_json,created_at,updated_at,deleted_at)
            SELECT id,type,subtype,title,original_title,status,release_date,NULL,NULL,0,'',runtime_minutes,director,casts,personal_rating,
            production_company,poster_url,trailer_url,summary,favorite,genres_json,languages_json,awards_json,tags_json,
            countries_json,content_ratings_json,watch_sources_json,created_at,updated_at,deleted_at FROM content_items;
        DROP TABLE content_items;
        ALTER TABLE content_items_new RENAME TO content_items;
        CREATE INDEX idx_content_type ON content_items(type);
        CREATE INDEX idx_content_status ON content_items(status);
        CREATE INDEX idx_content_updated ON content_items(updated_at DESC);
        CREATE INDEX idx_content_title ON content_items(title COLLATE NOCASE);
        CREATE TRIGGER content_search_insert AFTER INSERT ON content_items BEGIN INSERT INTO content_search(content_id,title,original_title,director,casts,production_company,summary) VALUES(new.id,new.title,new.original_title,new.director,new.casts,new.production_company,new.summary); END;
        CREATE TRIGGER content_search_update AFTER UPDATE OF title,original_title,director,casts,production_company,summary ON content_items BEGIN DELETE FROM content_search WHERE content_id=old.id; INSERT INTO content_search(content_id,title,original_title,director,casts,production_company,summary) VALUES(new.id,new.title,new.original_title,new.director,new.casts,new.production_company,new.summary); END;
        CREATE TRIGGER content_search_delete AFTER DELETE ON content_items BEGIN DELETE FROM content_search WHERE content_id=old.id; END;
        COMMIT;
        PRAGMA foreign_keys=ON;`);
    const now=new Date().toISOString();
    database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
    return { version,backup:path.basename(backup) };
}

// Adds explicit series chronology while retaining the original release date for title identity.
function migrateSeriesChronology(database) {
    const version=17;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const columns=new Set(database.prepare('PRAGMA table_info(content_items)').all().map((column) => column.name));
    if (!columns.has('series_start_date')) database.exec('ALTER TABLE content_items ADD COLUMN series_start_date TEXT');
    if (!columns.has('series_end_date')) database.exec('ALTER TABLE content_items ADD COLUMN series_end_date TEXT');
    if (!columns.has('series_continuing')) database.exec('ALTER TABLE content_items ADD COLUMN series_continuing INTEGER NOT NULL DEFAULT 0');
    database.exec("UPDATE content_items SET series_start_date=release_date WHERE type='series' AND series_start_date IS NULL");
    const now=new Date().toISOString();
    database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
    return { version,series:database.prepare("SELECT COUNT(*) count FROM content_items WHERE type='series'").get().count };
}

// Adds an optional broadcaster or platform network field for series metadata.
function migrateSeriesNetwork(database) {
    const version=18;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const columns=new Set(database.prepare('PRAGMA table_info(content_items)').all().map((column) => column.name));
    if (!columns.has('series_network')) database.exec("ALTER TABLE content_items ADD COLUMN series_network TEXT NOT NULL DEFAULT ''");
    const now=new Date().toISOString();
    database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
    return { version };
}

// Keeps only the most recently stored classification for each rating territory.
function migrateSingleRatingPerTerritory(database) {
    const version=19;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare("SELECT id,content_ratings_json FROM content_items WHERE content_ratings_json<>'[]'").all();
    const updates=[];
    rows.forEach((row) => {
        let current=[];
        try { current=JSON.parse(row.content_ratings_json || '[]'); } catch {}
        const normalized=normalizeContentRatings(current);
        if (JSON.stringify(current) !== JSON.stringify(normalized)) updates.push({ id:row.id,value:JSON.stringify(normalized) });
    });
    if (updates.length) createBackup(database,'pre-single-rating-per-territory');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET content_ratings_json=?,updated_at=? WHERE id=?');
        updates.forEach((row) => update.run(row.value,now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:updates.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Removes legacy voice-role suffixes and normalizes animated cast lists.
function migrateAnimatedVoiceCasts(database) {
    const version=20;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare(`SELECT id,casts FROM content_items WHERE EXISTS (
        SELECT 1 FROM json_each(content_items.genres_json) WHERE value IN ('Animation','Anime','Adult Animation','Stop Motion'))`).all();
    const updates=rows.map((row) => ({
        id:row.id,
        before:row.casts,
        casts:String(row.casts || '').replace(/\s*\(v\)/gi,'').split(',').map((name) => name.trim().replace(/\s+/g,' ')).filter(Boolean).join(', '),
    })).filter((row) => row.casts !== row.before);
    if (updates.length) createBackup(database,'pre-voice-cast-normalization');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET casts=?,updated_at=? WHERE id=?');
        updates.forEach((row) => update.run(row.casts,now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,scanned:rows.length,updated:updates.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Replaces redundant animation-specific movie formats with standard film formats.
function migrateAnimationMovieSubtypes(database) {
    const version=21;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare("SELECT id,subtype FROM content_items WHERE type='movie' AND subtype IN ('Animated Feature','Animation Feature','Animated Short','Short Animation')").all();
    if (rows.length) createBackup(database,'pre-animation-subtype-normalization');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET subtype=?,updated_at=? WHERE id=?');
        rows.forEach((row) => update.run(['Animated Short','Short Animation'].includes(row.subtype) ? 'Short Film' : 'Feature Film',now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:rows.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Normalizes user-entered metadata without changing punctuation or summary paragraph structure.
function migrateTextWhitespace(database) {
    const version=22;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const contentRows=database.prepare('SELECT id,title,original_title,director,casts,production_company,series_network,summary FROM content_items').all();
    const seasonRows=database.prepare('SELECT id,title FROM seasons').all();
    const episodeRows=database.prepare('SELECT id,title,summary FROM episodes').all();
    const contentUpdates=contentRows.map((row) => ({
        ...row,title:normalizeSingleLineText(row.title),original_title:normalizeSingleLineText(row.original_title),
        director:normalizeCommaSeparatedText(row.director),casts:normalizeCommaSeparatedText(row.casts),
        production_company:normalizeCommaSeparatedText(row.production_company),series_network:normalizeCommaSeparatedText(row.series_network),
        summary:normalizeMultilineText(row.summary),
    })).filter((row,index) => ['title','original_title','director','casts','production_company','series_network','summary']
        .some((field) => row[field] !== contentRows[index][field]));
    const seasonUpdates=seasonRows.map((row) => ({ ...row,title:normalizeSingleLineText(row.title) })).filter((row,index) => row.title !== seasonRows[index].title);
    const episodeUpdates=episodeRows.map((row) => ({ ...row,title:normalizeSingleLineText(row.title),summary:normalizeMultilineText(row.summary) }))
        .filter((row,index) => row.title !== episodeRows[index].title || row.summary !== episodeRows[index].summary);
    if (contentUpdates.length || seasonUpdates.length || episodeUpdates.length) createBackup(database,'pre-text-normalization');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const updateContent=database.prepare(`UPDATE content_items SET title=?,original_title=?,director=?,casts=?,production_company=?,series_network=?,summary=?,updated_at=? WHERE id=?`);
        contentUpdates.forEach((row) => updateContent.run(row.title,row.original_title,row.director,row.casts,row.production_company,row.series_network,row.summary,now,row.id));
        const updateSeason=database.prepare('UPDATE seasons SET title=?,updated_at=? WHERE id=?');
        seasonUpdates.forEach((row) => updateSeason.run(row.title,now,row.id));
        const updateEpisode=database.prepare('UPDATE episodes SET title=?,summary=?,updated_at=? WHERE id=?');
        episodeUpdates.forEach((row) => updateEpisode.run(row.title,row.summary,now,row.id));
        database.exec('DELETE FROM content_production_companies');
        const findCompany=database.prepare('SELECT id FROM production_companies WHERE name=? COLLATE NOCASE');
        const insertCompany=database.prepare('INSERT INTO production_companies(id,name,canonical_name) VALUES(?,?,?)');
        const linkCompany=database.prepare('INSERT OR IGNORE INTO content_production_companies(content_id,company_id) VALUES(?,?)');
        database.prepare("SELECT id,production_company FROM content_items WHERE trim(production_company)<>''").all().forEach((row) => {
            normalizeCommaSeparatedText(row.production_company).split(', ').filter(Boolean).forEach((name) => {
                let company=findCompany.get(name);
                if (!company) { company={ id:crypto.randomUUID() }; insertCompany.run(company.id,name,name.toLowerCase().replace(/[^a-z0-9]+/g,'')); }
                linkCompany.run(row.id,company.id);
            });
        });
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,content:contentUpdates.length,seasons:seasonUpdates.length,episodes:episodeUpdates.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Removes redundant watch-source provider labels and duplicate source pairs.
function migrateWatchSourceProviders(database) {
    const version=23;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare('SELECT id,watch_sources_json FROM content_items').all();
    const updates=[];
    rows.forEach((row) => {
        let current=[];
        try { current=JSON.parse(row.watch_sources_json || '[]'); } catch {}
        const normalized=normalizeWatchSources(current);
        if (JSON.stringify(current) !== JSON.stringify(normalized)) updates.push({ id:row.id,value:JSON.stringify(normalized) });
    });
    if (updates.length) createBackup(database,'pre-watch-source-provider-normalization');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET watch_sources_json=?,updated_at=? WHERE id=?');
        updates.forEach((row) => update.run(row.value,now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:updates.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Separates structural subtypes, presentation forms, narrative genres, and discovery tags.
function migratePresentationForms(database) {
    const version=24;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-presentation-form-migration');
    const columns=new Set(database.prepare('PRAGMA table_info(content_items)').all().map((column) => column.name));
    if (!columns.has('presentation_forms_json')) database.exec("ALTER TABLE content_items ADD COLUMN presentation_forms_json TEXT NOT NULL DEFAULT '[]'");
    const rows=database.prepare('SELECT id,type,subtype,genres_json,tags_json,presentation_forms_json FROM content_items').all();
    const now=new Date().toISOString();
    const presentationFamilies={
        Animation:['Animation','Anime','Adult Animation','Stop Motion'],
        Documentary:['Documentary','Biographical Documentary','Docudrama','Nature Documentary','Propaganda'],
        Experimental:['Experimental','Absurdist','Art Film','Surrealist'],
    };
    const movieSubtypeForms={
        'Documentary Feature':['Feature Film','Documentary'],'Documentary Short':['Short Film','Documentary'],
        'Experimental Film':['Feature Film','Experimental'],'Concert Film':['Feature Film','Concert'],
        'Compilation Film':['Feature Film','Compilation'],'Educational Film':['Feature Film','Educational'],
        'Anthology Film':['Feature Film',null],
    };
    const seriesSubtypeForms={
        'Scripted Series':['Regular Series',null],Miniseries:['Limited Series',null],
        'Animated Series':['Regular Series','Animation'],'Anime Series':['Regular Series','Anime'],
        'Documentary Series':['Regular Series','Documentary'],'Reality Series':['Regular Series','Reality'],
        'Variety Series':['Regular Series','Variety'],'Talk Show':['Regular Series','Talk'],
        'Game Show':['Regular Series','Game/Competition'],'Web Series':['Regular Series',null],
        'Educational Series':['Regular Series','Educational'],'News and Current Affairs':['Regular Series','News'],
    };
    database.exec('BEGIN IMMEDIATE');
    try {
        const update=database.prepare('UPDATE content_items SET subtype=?,genres_json=?,presentation_forms_json=?,tags_json=?,updated_at=? WHERE id=?');
        rows.forEach((row) => {
            let genres=[],tags=[],forms=[];
            try { genres=JSON.parse(row.genres_json || '[]'); } catch {}
            try { tags=JSON.parse(row.tags_json || '[]'); } catch {}
            try { forms=JSON.parse(row.presentation_forms_json || '[]'); } catch {}
            for (const [parent,members] of Object.entries(presentationFamilies)) {
                const selected=members.filter((value) => genres.includes(value));
                if (selected.length) {
                    const specific=selected.filter((value) => value !== parent);
                    forms.push(...(specific.length ? specific : [parent]));
                    genres=genres.filter((value) => !members.includes(value));
                }
            }
            let subtype=row.subtype;
            const mapping=row.type === 'series' ? seriesSubtypeForms[subtype] : movieSubtypeForms[subtype];
            if (mapping) { subtype=mapping[0]; if (mapping[1]) forms.push(mapping[1]); }
            if (genres.includes('Anthology')) {
                genres=genres.filter((value) => value !== 'Anthology');
                if (row.type === 'series') subtype='Anthology Series'; else tags.push('Anthology');
            }
            if (genres.includes('Television')) {
                genres=genres.filter((value) => value !== 'Television');
                if (row.type === 'movie' && !['Television Film','Television Special'].includes(subtype)) subtype='Television Film';
            }
            genres=genres.map((value) => value === 'Road Film' ? 'Road'
                : value === 'Psychological' ? 'Psychological Drama'
                    : value === 'Legal' ? 'Courtroom Drama'
                        : value === 'Techno-thriller' ? 'Techno-Thriller' : value);
            if (row.type === 'series' && !['Regular Series','Limited Series','Anthology Series'].includes(subtype)) subtype='Regular Series';
            if (row.type === 'movie' && !['Feature Film','Featurette','Short Film','Television Film','Television Special','Interactive Film'].includes(subtype)) subtype='Feature Film';
            genres=[...new Set(genres)]; forms=[...new Set(forms)]; tags=[...new Set(tags)];
            update.run(subtype,JSON.stringify(genres),JSON.stringify(forms),JSON.stringify(tags),now,row.id);
        });
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:rows.length,presentationAssignments:database.prepare(`SELECT COUNT(*) count FROM content_items,json_each(presentation_forms_json)`).get().count };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Assigns readable number-based titles to unnamed seasons and episodes.
function migrateSeriesStructureTitles(database) {
    const version=25;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const unnamedSeasons=database.prepare("SELECT id,season_number FROM seasons WHERE trim(title)='' ").all();
    const unnamedEpisodes=database.prepare("SELECT id,episode_number FROM episodes WHERE trim(title)='' ").all();
    if (unnamedSeasons.length || unnamedEpisodes.length) createBackup(database,'pre-series-structure-title-migration');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const updateSeason=database.prepare('UPDATE seasons SET title=?,updated_at=? WHERE id=?');
        unnamedSeasons.forEach((row) => updateSeason.run(`Season ${row.season_number}`,now,row.id));
        const updateEpisode=database.prepare('UPDATE episodes SET title=?,updated_at=? WHERE id=?');
        unnamedEpisodes.forEach((row) => updateEpisode.run(`Episode ${row.episode_number}`,now,row.id));
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,seasons:unnamedSeasons.length,episodes:unnamedEpisodes.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Expands corporate abbreviations and introduces persistent aliases for company-name resolution.
function migrateProductionCompanyAliases(database) {
    const version=26;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    database.exec(`CREATE TABLE IF NOT EXISTS production_company_aliases (
        alias TEXT PRIMARY KEY COLLATE NOCASE,company_id TEXT NOT NULL REFERENCES production_companies(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS production_company_merge_ignores (canonical_name TEXT PRIMARY KEY,created_at TEXT NOT NULL);`);
    const rows=database.prepare(`SELECT pc.id,pc.name,COUNT(cpc.content_id) uses FROM production_companies pc
        LEFT JOIN content_production_companies cpc ON cpc.company_id=pc.id GROUP BY pc.id ORDER BY uses DESC,pc.name`).all();
    const changed=rows.filter((row) => fullCompanyName(row.name) !== row.name);
    if (changed.length) createBackup(database,'pre-company-alias-migration');
    const now=new Date().toISOString();
    const groups=new Map();
    rows.forEach((row) => { const name=fullCompanyName(row.name); const key=name.toLowerCase(); const list=groups.get(key) || []; list.push({ ...row,fullName:name }); groups.set(key,list); });
    database.exec('BEGIN IMMEDIATE');
    try {
        const alias=database.prepare('INSERT OR IGNORE INTO production_company_aliases(alias,company_id,created_at) VALUES(?,?,?)');
        const move=database.prepare('INSERT OR IGNORE INTO content_production_companies(content_id,company_id) SELECT content_id,? FROM content_production_companies WHERE company_id=?');
        const removeLinks=database.prepare('DELETE FROM content_production_companies WHERE company_id=?');
        const removeCompany=database.prepare('DELETE FROM production_companies WHERE id=?');
        const updateCompany=database.prepare('UPDATE production_companies SET name=?,canonical_name=? WHERE id=?');
        groups.forEach((members) => {
            const keep=members[0];
            members.forEach((member) => alias.run(member.name,keep.id,now));
            members.slice(1).forEach((member) => { move.run(keep.id,member.id); removeLinks.run(member.id); removeCompany.run(member.id); });
            updateCompany.run(keep.fullName,companyKey(keep.fullName),keep.id);
        });
        database.prepare(`UPDATE content_items SET production_company=COALESCE((SELECT group_concat(pc.name,', ')
            FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
            WHERE cpc.content_id=content_items.id ORDER BY pc.name COLLATE NOCASE),'')`).run();
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,expanded:changed.length,companies:database.prepare('SELECT COUNT(*) count FROM production_companies').get().count };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Applies later full-name normalization refinements without discarding earlier aliases.
function migrateProductionCompanyFullNames(database) {
    const version=27;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const rows=database.prepare('SELECT id,name FROM production_companies').all();
    const updates=rows.map((row) => ({ ...row,fullName:fullCompanyName(row.name) })).filter((row) => row.fullName !== row.name);
    if (updates.length) createBackup(database,'pre-company-full-name-migration');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const alias=database.prepare('INSERT OR IGNORE INTO production_company_aliases(alias,company_id,created_at) VALUES(?,?,?)');
        const update=database.prepare('UPDATE production_companies SET name=?,canonical_name=? WHERE id=?');
        updates.forEach((row) => { alias.run(row.name,row.id,now); update.run(row.fullName,companyKey(row.fullName),row.id); });
        database.prepare(`UPDATE content_items SET production_company=COALESCE((SELECT group_concat(pc.name,', ')
            FROM content_production_companies cpc JOIN production_companies pc ON pc.id=cpc.company_id
            WHERE cpc.content_id=content_items.id ORDER BY pc.name COLLATE NOCASE),'')`).run();
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,expanded:updates.length };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Adds descriptive and completion metadata to seasons and editorial metadata to episodes.
function migrateSeriesEditorialMetadata(database) {
    const version=28;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-series-editorial-metadata-migration');
    const seasonColumns=new Set(database.prepare('PRAGMA table_info(seasons)').all().map((column) => column.name));
    const episodeColumns=new Set(database.prepare('PRAGMA table_info(episodes)').all().map((column) => column.name));
    database.exec('BEGIN IMMEDIATE');
    try {
        if (!seasonColumns.has('synopsis')) database.exec("ALTER TABLE seasons ADD COLUMN synopsis TEXT NOT NULL DEFAULT ''");
        if (!seasonColumns.has('completion_status')) database.exec("ALTER TABLE seasons ADD COLUMN completion_status TEXT NOT NULL DEFAULT 'Not Started'");
        if (!episodeColumns.has('episode_type')) database.exec("ALTER TABLE episodes ADD COLUMN episode_type TEXT NOT NULL DEFAULT 'Regular'");
        if (!episodeColumns.has('director')) database.exec("ALTER TABLE episodes ADD COLUMN director TEXT NOT NULL DEFAULT ''");
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.exec('COMMIT');
        return { version,seasons:database.prepare('SELECT COUNT(*) count FROM seasons').get().count,episodes:database.prepare('SELECT COUNT(*) count FROM episodes').get().count };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Synchronizes stored season completion with the authoritative episode watch histories.
function migrateSeasonCompletionStatus(database) {
    const version=29;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-season-completion-status-migration');
    const before=database.prepare("SELECT COUNT(*) count FROM seasons WHERE completion_status<>'Not Started'").get().count;
    database.exec('BEGIN IMMEDIATE');
    try {
        database.exec(`UPDATE seasons SET completion_status=CASE
            WHEN NOT EXISTS(SELECT 1 FROM episodes e JOIN episode_watch_history h ON h.episode_id=e.id WHERE e.season_id=seasons.id) THEN 'Not Started'
            WHEN NOT EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=seasons.id AND NOT EXISTS(SELECT 1 FROM episode_watch_history h WHERE h.episode_id=e.id))
                 AND EXISTS(SELECT 1 FROM episodes e WHERE e.season_id=seasons.id) THEN 'Completed'
            ELSE 'In Progress' END`);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.exec('COMMIT');
        return { version,seasons:database.prepare('SELECT COUNT(*) count FROM seasons').get().count,previouslyClassified:before };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Separates editorial production and public-release states and moves series-wide credits out of the movie director field.
function migrateLifecycleStatusesAndSeriesCredits(database) {
    const version=30;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-lifecycle-status-migration');
    const contentColumns=new Set(database.prepare('PRAGMA table_info(content_items)').all().map((column) => column.name));
    const seasonColumns=new Set(database.prepare('PRAGMA table_info(seasons)').all().map((column) => column.name));
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        if (!contentColumns.has('production_status')) database.exec("ALTER TABLE content_items ADD COLUMN production_status TEXT NOT NULL DEFAULT 'Unknown'");
        if (!contentColumns.has('release_status')) database.exec("ALTER TABLE content_items ADD COLUMN release_status TEXT NOT NULL DEFAULT 'Unscheduled'");
        if (!seasonColumns.has('production_status')) database.exec("ALTER TABLE seasons ADD COLUMN production_status TEXT NOT NULL DEFAULT 'Unknown'");
        if (!seasonColumns.has('release_status')) database.exec("ALTER TABLE seasons ADD COLUMN release_status TEXT NOT NULL DEFAULT 'Unscheduled'");
        database.exec(`CREATE TABLE IF NOT EXISTS series_credits (
            id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            person_name TEXT NOT NULL,role TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(series_id,person_name,role));
            CREATE INDEX IF NOT EXISTS idx_content_production_status ON content_items(production_status);
            CREATE INDEX IF NOT EXISTS idx_content_release_status ON content_items(release_status);
            CREATE INDEX IF NOT EXISTS idx_season_production_status ON seasons(production_status);
            CREATE INDEX IF NOT EXISTS idx_season_release_status ON seasons(release_status);
            CREATE INDEX IF NOT EXISTS idx_series_credits_series ON series_credits(series_id,display_order);`);
        database.exec(`UPDATE content_items SET
            production_status=CASE WHEN type='series' AND series_end_date IS NOT NULL THEN 'Completed' WHEN status='Announced' THEN 'Announced' WHEN status='Production Started' THEN 'Filming / Production' ELSE 'Unknown' END,
            release_status=CASE
                WHEN type='movie' AND status IN ('Released','Watched') THEN 'Released'
                WHEN type='movie' AND status='Trailer Only' THEN 'Upcoming'
                WHEN type='series' AND status='Trailer Only' THEN 'Upcoming'
                WHEN type='series' AND series_end_date IS NOT NULL THEN 'Ended'
                ELSE 'Unscheduled' END`);
        database.exec(`UPDATE seasons SET production_status=CASE WHEN status='Announced' THEN 'Announced' ELSE 'Unknown' END,
            release_status=CASE WHEN completion_status='Completed' OR EXISTS(
                SELECT 1 FROM episodes e JOIN episode_watch_history h ON h.episode_id=e.id WHERE e.season_id=seasons.id
            ) THEN 'Released' ELSE 'Unscheduled' END`);
        const bannen=database.prepare("SELECT id,director FROM content_items WHERE type='series' AND lower(trim(title))='the bannen way'").get();
        if (bannen) {
            const director=normalizeCommaSeparatedText(bannen.director) || 'Jesse Warren';
            database.prepare(`UPDATE episodes SET director=CASE WHEN trim(director)='' THEN ? ELSE director END,updated_at=?
                WHERE season_id IN (SELECT id FROM seasons WHERE series_id=?)`).run(director,now,bannen.id);
        }
        database.prepare("UPDATE content_items SET director='',updated_at=? WHERE type='series'").run(now);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,seriesDirectorsRemoved:database.prepare("SELECT COUNT(*) count FROM content_items WHERE type='series' AND trim(director)='' ").get().count,
            bannenEpisodesUpdated:bannen ? database.prepare('SELECT COUNT(*) count FROM episodes WHERE season_id IN (SELECT id FROM seasons WHERE series_id=?) AND director<>\'\'').get(bannen.id).count : 0 };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Refines migrated series lifecycle values when a stored finale date provides decisive evidence.
function migrateEndedSeriesLifecycle(database) {
    const version=31;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-ended-series-status-migration');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const result=database.prepare(`UPDATE content_items SET production_status='Completed',release_status='Ended',series_continuing=0,updated_at=?
            WHERE type='series' AND series_end_date IS NOT NULL AND trim(series_end_date)<>''`).run(now);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:result.changes };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Removes the superseded mixed-status columns after all values have been separated and verified.
function removeLegacyStatusColumns(database) {
    const version=32;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-legacy-status-removal');
    database.exec('BEGIN IMMEDIATE');
    try {
        database.exec(`DROP INDEX IF EXISTS idx_content_status;
            DROP INDEX IF EXISTS idx_season_status;
            ALTER TABLE content_items DROP COLUMN status;
            ALTER TABLE seasons DROP COLUMN status;`);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,new Date().toISOString());
        database.exec('COMMIT');
        return { version,removed:['content_items.status','seasons.status'] };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Replaces the removed placeholder production state with the first explicit confirmed lifecycle state.
function migrateUnknownProductionStatuses(database) {
    const version=33;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-production-status-normalization');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const content=database.prepare("UPDATE content_items SET production_status='Announced',updated_at=? WHERE production_status='Unknown'").run(now);
        const seasons=database.prepare("UPDATE seasons SET production_status='Announced',updated_at=? WHERE production_status='Unknown'").run(now);
        database.prepare(`INSERT INTO audit_log(action,entity_type,entity_id,details_json,actor,outcome,metadata_json,created_at)
            VALUES('bulk_update','content',NULL,?,'migration','success','{}',?)`).run(JSON.stringify({ field:'productionStatus',from:'Unknown',to:'Announced',contentUpdated:content.changes,seasonsUpdated:seasons.changes }),now);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,contentUpdated:content.changes,seasonsUpdated:seasons.changes };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Uses one inclusive active-production label for live-action filming and animation production.
function migrateFilmingProductionLabel(database) {
    const version=34;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    createBackup(database,'pre-filming-production-label-migration');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const content=database.prepare("UPDATE content_items SET production_status='Filming / Production',updated_at=? WHERE production_status='Filming'").run(now);
        const seasons=database.prepare("UPDATE seasons SET production_status='Filming / Production',updated_at=? WHERE production_status='Filming'").run(now);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,contentUpdated:content.changes,seasonsUpdated:seasons.changes };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Replaces the lifecycle-like series subtype with a stable structural classification.
function migrateRegularSeriesSubtype(database) {
    const version=35;
    if (database.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(version)) return null;
    const affected=database.prepare("SELECT COUNT(*) count FROM content_items WHERE type='series' AND subtype='Continuing Series'").get().count;
    if (affected) createBackup(database,'pre-regular-series-subtype-migration');
    const now=new Date().toISOString();
    database.exec('BEGIN IMMEDIATE');
    try {
        const result=database.prepare("UPDATE content_items SET subtype='Regular Series',updated_at=? WHERE type='series' AND subtype='Continuing Series'").run(now);
        database.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(version,now);
        database.exec('COMMIT');
        return { version,updated:result.changes };
    } catch(error) { database.exec('ROLLBACK'); throw error; }
}

// Creates a verified SQLite snapshot in the rotating backup directory.
function createBackup(database, label = 'automatic') {
    database.exec('PRAGMA wal_checkpoint(FULL)');
    const destination = path.join(BACKUP_DIR, `${label}.${fileTimestamp()}.sqlite`);
    database.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    const verification = new DatabaseSync(destination, { readOnly: true });
    const integrity = verification.prepare('PRAGMA integrity_check').get().integrity_check;
    verification.close();
    if (integrity !== 'ok') throw new Error(`Backup integrity check returned: ${integrity}`);
    pruneBackups(BACKUP_DIR,label,false,destination);
    if (process.env.BACKUP_MIRROR_DIR) {
        const mirror=path.resolve(process.env.BACKUP_MIRROR_DIR);
        fs.mkdirSync(mirror,{ recursive:true });
        const passphrase=process.env.BACKUP_ENCRYPTION_PASSPHRASE || '';
        if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE is required when BACKUP_MIRROR_DIR is configured');
        const mirrored=path.join(mirror,`${path.basename(destination)}.cvbackup`);
        encryptBackupForMirror(destination,mirrored,passphrase);
        pruneBackups(mirror,label,true,mirrored);
        logger.event('info','database.backup.mirrored','Encrypted backup copied to the configured off-device location',{
            label,filename:path.basename(mirrored),encryption:'AES-256-GCM',keyDerivation:'scrypt',bytes:fs.statSync(mirrored).size,
        });
    }
    logger.event('info','database.backup.completed','SQLite backup created and verified',{ label,filename:path.basename(destination),bytes:fs.statSync(destination).size,integrity });
    return destination;
}

ensureDirectories();
const database = new DatabaseSync(DATABASE_FILE);
createSchema(database);
const migrationReport = process.env.MOVIE_TRACKER_SKIP_LEGACY_IMPORT === '1' ? null : migrateLegacyData(database);
const countryMigrationReport = [
    migrateCountryCodes(database, 2, 'pre-country-normalization'),
    migrateCountryCodes(database, 3, 'pre-country-alias-normalization'),
    migrateCountryCodes(database, 4, 'pre-country-name-normalization'),
].filter(Boolean);
const auditMigrationReport = migrateAuditSchema(database);
const ratingMigrationReport = migrateContentRatings(database);
const watchSourceMigrationReport = migrateWatchSources(database);
const indianRatingMigrationReport = migrateHistoricalIndianRatings(database);
const watchDataMigrationReport = migrateWatchHistoryAndLinks(database);
const watchTimeMigrationReport = migrateMissingWatchTimes(database);
const genreMigrationReport = migrateGenreNames(database);
const subtypeMigrationReport = migrateContentSubtypes(database);
const episodeWatchMigrationReport = migrateEpisodeWatchHistory(database);
const productionCompanyMigrationReport = migrateProductionCompanies(database);
const fullTextMigrationReport = migrateFullTextSearch(database);
const legacyColumnMigrationReport = removeLegacyContentColumns(database);
const seriesChronologyMigrationReport = migrateSeriesChronology(database);
const seriesNetworkMigrationReport = migrateSeriesNetwork(database);
const singleRatingMigrationReport = migrateSingleRatingPerTerritory(database);
const voiceCastMigrationReport = migrateAnimatedVoiceCasts(database);
const animationSubtypeMigrationReport = migrateAnimationMovieSubtypes(database);
const textWhitespaceMigrationReport = migrateTextWhitespace(database);
const watchSourceProviderMigrationReport = migrateWatchSourceProviders(database);
const presentationFormMigrationReport = migratePresentationForms(database);
const seriesStructureTitleMigrationReport = migrateSeriesStructureTitles(database);
const productionCompanyAliasMigrationReport = migrateProductionCompanyAliases(database);
const productionCompanyFullNameMigrationReport = migrateProductionCompanyFullNames(database);
const seriesEditorialMetadataMigrationReport = migrateSeriesEditorialMetadata(database);
const seasonCompletionStatusMigrationReport = migrateSeasonCompletionStatus(database);
const lifecycleStatusMigrationReport = migrateLifecycleStatusesAndSeriesCredits(database);
const endedSeriesLifecycleMigrationReport = migrateEndedSeriesLifecycle(database);
const legacyStatusRemovalReport = removeLegacyStatusColumns(database);
const productionStatusNormalizationReport = migrateUnknownProductionStatuses(database);
const filmingProductionLabelReport = migrateFilmingProductionLabel(database);
const regularSeriesSubtypeReport = migrateRegularSeriesSubtype(database);
countryMigrationReport.forEach((report) => logger.event('info','database.migration.completed','Country normalization migration completed',report));
if (auditMigrationReport) logger.event('info','database.migration.completed','Audit schema migration completed',auditMigrationReport);
if (ratingMigrationReport) logger.event('info','database.migration.completed','Content rating normalization migration completed',ratingMigrationReport);
if (watchSourceMigrationReport) logger.event('info','database.migration.completed','Watch source normalization migration completed',watchSourceMigrationReport);
if (indianRatingMigrationReport) logger.event('info','database.migration.completed','Indian age-marker assignment migration completed',indianRatingMigrationReport);
if (watchDataMigrationReport && !watchDataMigrationReport.blocked) logger.event('info','database.migration.completed','Watch history and content-link migration completed',watchDataMigrationReport);
if (watchTimeMigrationReport) logger.event('info','database.migration.completed','Watch timestamp assignment migration completed',watchTimeMigrationReport);
if (genreMigrationReport) logger.event('info','database.migration.completed','Genre name normalization migration completed',genreMigrationReport);
if (subtypeMigrationReport) logger.event('info','database.migration.completed','Content subtype normalization migration completed',subtypeMigrationReport);
if (episodeWatchMigrationReport) logger.event('info','database.migration.completed','Episode watch-history migration completed',episodeWatchMigrationReport);
if (productionCompanyMigrationReport) logger.event('info','database.migration.completed','Production-company normalization migration completed',productionCompanyMigrationReport);
if (fullTextMigrationReport) logger.event('info','database.migration.completed','Full-text search migration completed',fullTextMigrationReport);
if (legacyColumnMigrationReport) logger.event('info','database.migration.completed','Legacy content columns removed',legacyColumnMigrationReport);
if (seriesChronologyMigrationReport) logger.event('info','database.migration.completed','Series chronology migration completed',seriesChronologyMigrationReport);
if (seriesNetworkMigrationReport) logger.event('info','database.migration.completed','Series network migration completed',seriesNetworkMigrationReport);
if (singleRatingMigrationReport) logger.event('info','database.migration.completed','Single rating per territory migration completed',singleRatingMigrationReport);
if (voiceCastMigrationReport) logger.event('info','database.migration.completed','Animated voice-cast migration completed',voiceCastMigrationReport);
if (animationSubtypeMigrationReport) logger.event('info','database.migration.completed','Animation movie subtype migration completed',animationSubtypeMigrationReport);
if (textWhitespaceMigrationReport) logger.event('info','database.migration.completed','Text whitespace normalization migration completed',textWhitespaceMigrationReport);
if (watchSourceProviderMigrationReport) logger.event('info','database.migration.completed','Watch-source provider normalization migration completed',watchSourceProviderMigrationReport);
if (presentationFormMigrationReport) logger.event('info','database.migration.completed','Presentation-form migration completed',presentationFormMigrationReport);
if (seriesStructureTitleMigrationReport) logger.event('info','database.migration.completed','Series structure title migration completed',seriesStructureTitleMigrationReport);
if (productionCompanyAliasMigrationReport) logger.event('info','database.migration.completed','Production-company alias migration completed',productionCompanyAliasMigrationReport);
if (productionCompanyFullNameMigrationReport) logger.event('info','database.migration.completed','Production-company full-name migration completed',productionCompanyFullNameMigrationReport);
if (seriesEditorialMetadataMigrationReport) logger.event('info','database.migration.completed','Series editorial metadata migration completed',seriesEditorialMetadataMigrationReport);
if (seasonCompletionStatusMigrationReport) logger.event('info','database.migration.completed','Season completion status migration completed',seasonCompletionStatusMigrationReport);
if (lifecycleStatusMigrationReport) logger.event('info','database.migration.completed','Lifecycle status and series-credit migration completed',lifecycleStatusMigrationReport);
if (endedSeriesLifecycleMigrationReport) logger.event('info','database.migration.completed','Ended-series lifecycle migration completed',endedSeriesLifecycleMigrationReport);
if (legacyStatusRemovalReport) logger.event('info','database.migration.completed','Legacy mixed-status columns removed',legacyStatusRemovalReport);
if (productionStatusNormalizationReport) logger.event('info','database.migration.completed','Unknown production statuses normalized',productionStatusNormalizationReport);
if (filmingProductionLabelReport) logger.event('info','database.migration.completed','Filming and production status label normalized',filmingProductionLabelReport);
if (regularSeriesSubtypeReport) logger.event('info','database.migration.completed','Regular series subtype migration completed',regularSeriesSubtypeReport);

module.exports = { database, DATABASE_FILE, BACKUP_DIR, EXPORT_DIR, createBackup, migrationReport, countryMigrationReport, auditMigrationReport, ratingMigrationReport, watchSourceMigrationReport, indianRatingMigrationReport, watchDataMigrationReport, watchTimeMigrationReport, genreMigrationReport, subtypeMigrationReport,episodeWatchMigrationReport,productionCompanyMigrationReport,fullTextMigrationReport,legacyColumnMigrationReport,seriesChronologyMigrationReport,seriesNetworkMigrationReport,singleRatingMigrationReport,voiceCastMigrationReport,animationSubtypeMigrationReport,textWhitespaceMigrationReport,watchSourceProviderMigrationReport,presentationFormMigrationReport,seriesStructureTitleMigrationReport,productionCompanyAliasMigrationReport,productionCompanyFullNameMigrationReport,seriesEditorialMetadataMigrationReport,seasonCompletionStatusMigrationReport,lifecycleStatusMigrationReport,endedSeriesLifecycleMigrationReport,legacyStatusRemovalReport,productionStatusNormalizationReport,filmingProductionLabelReport,regularSeriesSubtypeReport };
