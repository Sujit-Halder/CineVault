const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const logger = require('./logger');

const DATA_DIR = process.env.MOVIE_TRACKER_DATA_DIR ? path.resolve(process.env.MOVIE_TRACKER_DATA_DIR) : path.join(__dirname, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const DATABASE_FILE = path.join(DATA_DIR, 'movie-tracker.sqlite');
const databaseExistedAtStartup = fs.existsSync(DATABASE_FILE);
const freshInstallation = !databaseExistedAtStartup;
let startupMigrationsComplete = false;

// Creates the minimum directory required to hold the runtime database.
function ensureDirectories() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

// Creates the consolidated relational schema used by clean installations and schema-v46 databases.
function createSchema(database) {
    database.exec(`
        PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS app_users(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'member',status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_login_at TEXT,deletion_scheduled_at TEXT,deletion_requested_at TEXT,CHECK(role IN ('owner','member')),CHECK(status IN ('active','disabled')));
        CREATE TABLE IF NOT EXISTS content_items(id TEXT PRIMARY KEY,type TEXT NOT NULL CHECK(type IN ('movie','series')),subtype TEXT NOT NULL DEFAULT '',title TEXT NOT NULL,original_title TEXT NOT NULL DEFAULT '',release_date TEXT,runtime_minutes INTEGER,personal_rating TEXT NOT NULL DEFAULT '',production_company TEXT NOT NULL DEFAULT '',poster_url TEXT NOT NULL DEFAULT '',trailer_url TEXT NOT NULL DEFAULT '',summary TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,series_start_date TEXT,series_end_date TEXT,series_continuing INTEGER NOT NULL DEFAULT 0,production_status TEXT NOT NULL DEFAULT 'Announced',release_status TEXT NOT NULL DEFAULT 'Unscheduled',owner_user_id TEXT REFERENCES app_users(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS seasons (
            id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
            season_number INTEGER,title TEXT NOT NULL DEFAULT '',release_date TEXT,poster_url TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,synopsis TEXT NOT NULL DEFAULT '',completion_status TEXT NOT NULL DEFAULT 'Not Started',production_status TEXT NOT NULL DEFAULT 'Announced',release_status TEXT NOT NULL DEFAULT 'Unscheduled',
            UNIQUE(series_id, season_number)
        );
        CREATE TABLE IF NOT EXISTS episodes (
            id TEXT PRIMARY KEY, season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            episode_number INTEGER, title TEXT NOT NULL, air_date TEXT, runtime_minutes INTEGER,
            watched INTEGER NOT NULL DEFAULT 0, watch_date TEXT, progress_seconds INTEGER NOT NULL DEFAULT 0,
            summary TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,episode_type TEXT NOT NULL DEFAULT 'Regular',
            UNIQUE(season_id, episode_number)
        );
        CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,canonical_name TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS content_credits(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,role TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(content_id,person_id,role));
        CREATE TABLE IF NOT EXISTS episode_credits(episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,person_id TEXT NOT NULL REFERENCES people(id) ON DELETE RESTRICT,role TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(episode_id,person_id,role));
        CREATE TABLE IF NOT EXISTS networks(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,canonical_name TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS content_networks(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,network_id TEXT NOT NULL REFERENCES networks(id) ON DELETE RESTRICT,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(content_id,network_id));
        CREATE TABLE IF NOT EXISTS metadata_terms(id INTEGER PRIMARY KEY,category TEXT NOT NULL,name TEXT NOT NULL COLLATE NOCASE,created_at TEXT NOT NULL,UNIQUE(category,name));
        CREATE TABLE IF NOT EXISTS content_metadata_terms(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,term_id INTEGER NOT NULL REFERENCES metadata_terms(id) ON DELETE RESTRICT,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(content_id,term_id));
        CREATE TABLE IF NOT EXISTS content_languages(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,language_tag TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(content_id,language_tag));
        CREATE TABLE IF NOT EXISTS content_countries(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,country_code TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(content_id,country_code));
        CREATE TABLE IF NOT EXISTS content_official_ratings(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,territory TEXT NOT NULL,code TEXT NOT NULL,display_order INTEGER NOT NULL DEFAULT 0,rating_system TEXT NOT NULL DEFAULT '',previous_code TEXT NOT NULL DEFAULT '',classification_basis TEXT NOT NULL DEFAULT '',classification_confidence TEXT NOT NULL DEFAULT '',PRIMARY KEY(content_id,territory));
        CREATE TABLE IF NOT EXISTS content_watch_sources(id TEXT PRIMARY KEY,content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,method TEXT NOT NULL,provider TEXT NOT NULL DEFAULT '',display_order INTEGER NOT NULL DEFAULT 0,UNIQUE(content_id,method,provider));
        CREATE TABLE IF NOT EXISTS watch_history(id TEXT PRIMARY KEY,content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,watched_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,language_tag TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS episode_watch_history(id TEXT PRIMARY KEY,episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,watched_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,language_tag TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS content_links(id TEXT PRIMARY KEY,content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,url TEXT NOT NULL,domain TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(content_id,url));
        CREATE TABLE IF NOT EXISTS production_companies(id TEXT PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,canonical_name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS production_company_aliases(alias TEXT PRIMARY KEY COLLATE NOCASE,company_id TEXT NOT NULL REFERENCES production_companies(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS production_company_merge_ignores(canonical_name TEXT PRIMARY KEY,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS content_production_companies(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,company_id TEXT NOT NULL REFERENCES production_companies(id) ON DELETE CASCADE,PRIMARY KEY(content_id,company_id));
        CREATE TABLE IF NOT EXISTS library_entries(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,personal_rating TEXT,favorite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,UNIQUE(user_id,content_id),CHECK(favorite IN (0,1)));
        CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,csrf_hash TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS auth_invitations(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE,token_hash TEXT NOT NULL UNIQUE,invited_by TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,accepted_at TEXT,created_at TEXT NOT NULL,verification_hash TEXT,verification_expires_at TEXT,verification_sent_at TEXT,verification_attempts INTEGER NOT NULL DEFAULT 0,delivery_status TEXT NOT NULL DEFAULT 'pending',delivery_message_id TEXT NOT NULL DEFAULT '',delivery_response TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS password_reset_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS account_deletion_challenges(user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,otp_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS ownership_transfer_challenges(owner_user_id TEXT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,target_user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,otp_hash TEXT NOT NULL,expires_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS security_rate_limits(scope TEXT NOT NULL,key_hash TEXT NOT NULL,window_started_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,key_hash));
        CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,asset_type TEXT NOT NULL CHECK(asset_type IN ('poster','trailer')),status TEXT NOT NULL DEFAULT 'broken',reason TEXT NOT NULL,asset_url TEXT NOT NULL,detected_at TEXT NOT NULL,read_at TEXT,resolved_at TEXT);
        CREATE TABLE IF NOT EXISTS asset_checks(content_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,asset_type TEXT NOT NULL,asset_url TEXT NOT NULL,status TEXT NOT NULL,last_checked_at TEXT NOT NULL,last_healthy_at TEXT,PRIMARY KEY(content_id,asset_type));
        CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,request_id TEXT,actor TEXT,outcome TEXT NOT NULL DEFAULT 'success',before_json TEXT,after_json TEXT,metadata_json TEXT NOT NULL DEFAULT '{}');
        CREATE VIRTUAL TABLE IF NOT EXISTS content_search USING fts5(content_id UNINDEXED,title,original_title,director,casts,production_company,summary);
        CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(type); CREATE INDEX IF NOT EXISTS idx_content_updated ON content_items(updated_at DESC); CREATE INDEX IF NOT EXISTS idx_content_title ON content_items(title COLLATE NOCASE); CREATE INDEX IF NOT EXISTS idx_content_owner_state ON content_items(owner_user_id,deleted_at,updated_at DESC); CREATE INDEX IF NOT EXISTS idx_content_production_status ON content_items(production_status); CREATE INDEX IF NOT EXISTS idx_content_release_status ON content_items(release_status);
        CREATE INDEX IF NOT EXISTS idx_content_credits_person ON content_credits(person_id,role,content_id); CREATE INDEX IF NOT EXISTS idx_episode_credits_person ON episode_credits(person_id,role,episode_id); CREATE INDEX IF NOT EXISTS idx_content_networks_network ON content_networks(network_id,content_id); CREATE INDEX IF NOT EXISTS idx_content_metadata_term ON content_metadata_terms(term_id,content_id); CREATE INDEX IF NOT EXISTS idx_metadata_terms_category_name ON metadata_terms(category,name); CREATE INDEX IF NOT EXISTS idx_content_languages_tag ON content_languages(language_tag,content_id); CREATE INDEX IF NOT EXISTS idx_content_countries_code ON content_countries(country_code,content_id); CREATE INDEX IF NOT EXISTS idx_content_ratings_code ON content_official_ratings(territory,code,content_id); CREATE INDEX IF NOT EXISTS idx_content_watch_sources_method ON content_watch_sources(method,provider,content_id);
        CREATE INDEX IF NOT EXISTS idx_watch_history_content_date ON watch_history(content_id,watched_at DESC); CREATE INDEX IF NOT EXISTS idx_episode_watch_history_episode_date ON episode_watch_history(episode_id,watched_at DESC); CREATE INDEX IF NOT EXISTS idx_content_links_content ON content_links(content_id); CREATE INDEX IF NOT EXISTS idx_content_company_content ON content_production_companies(content_id); CREATE INDEX IF NOT EXISTS idx_library_entries_user_deleted ON library_entries(user_id,deleted_at); CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expiry ON auth_sessions(user_id,expires_at); CREATE INDEX IF NOT EXISTS idx_auth_invitations_email ON auth_invitations(email,expires_at); CREATE INDEX IF NOT EXISTS idx_password_resets_user_expiry ON password_reset_tokens(user_id,expires_at); CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at,resolved_at); CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_active ON notifications(content_id,asset_type) WHERE resolved_at IS NULL; CREATE INDEX IF NOT EXISTS idx_season_production_status ON seasons(production_status); CREATE INDEX IF NOT EXISTS idx_season_release_status ON seasons(release_status);
        CREATE TRIGGER IF NOT EXISTS content_search_delete AFTER DELETE ON content_items BEGIN DELETE FROM content_search WHERE content_id=old.id; END;
        CREATE TRIGGER IF NOT EXISTS watch_history_language_required_insert BEFORE INSERT ON watch_history WHEN trim(new.language_tag)='' BEGIN SELECT RAISE(ABORT,'Watch language is required'); END;
        CREATE TRIGGER IF NOT EXISTS watch_history_language_required_update BEFORE UPDATE OF language_tag ON watch_history WHEN trim(new.language_tag)='' BEGIN SELECT RAISE(ABORT,'Watch language is required'); END;
        CREATE TRIGGER IF NOT EXISTS episode_watch_language_required_insert BEFORE INSERT ON episode_watch_history WHEN trim(new.language_tag)='' BEGIN SELECT RAISE(ABORT,'Episode watch language is required'); END;
        CREATE TRIGGER IF NOT EXISTS episode_watch_language_required_update BEFORE UPDATE OF language_tag ON episode_watch_history WHEN trim(new.language_tag)='' BEGIN SELECT RAISE(ABORT,'Episode watch language is required'); END;
    `);
    database.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(46,?)').run(new Date().toISOString());
}
// Historical migrations 1-45 were retired after every maintained database reached schema 46.
// Creates a verified SQLite snapshot in the rotating backup directory.
function createBackup(database, label = 'automatic') {
    if (freshInstallation && !startupMigrationsComplete && label.startsWith('pre-')) return null;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
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
if (databaseExistedAtStartup) {
    const hasVersionTable=database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='schema_migrations'").get();
    const version=hasVersionTable ? database.prepare('SELECT MAX(version) version FROM schema_migrations').get().version : null;
    if (version !== 46) {
        database.close();
        throw new Error(`This CineVault release requires schema 46; found ${version ?? 'an unversioned database'}. Upgrade a copy with the matching older release first.`);
    }
}
createSchema(database);
startupMigrationsComplete = true;

module.exports = { database,DATABASE_FILE,BACKUP_DIR,EXPORT_DIR,createBackup };
