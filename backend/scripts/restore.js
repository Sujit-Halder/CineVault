const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const logger = require('../logger');

// Validates the requested backup and restores it after preserving the active database.
function restoreBackup() {
    const source = process.argv[2] ? path.resolve(process.argv[2]) : '';
    if (!source || !fs.existsSync(source)) throw new Error('Provide an existing SQLite backup path');
    const verification = new DatabaseSync(source, { readOnly:true });
    const integrity = verification.prepare('PRAGMA integrity_check').get().integrity_check;
    verification.close();
    if (integrity !== 'ok') throw new Error(`Backup integrity check returned: ${integrity}`);
    const dataDirectory = process.env.MOVIE_TRACKER_DATA_DIR ? path.resolve(process.env.MOVIE_TRACKER_DATA_DIR) : path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDirectory,{ recursive:true });
    const lockFile=path.join(dataDirectory,'server.lock');
    if (fs.existsSync(lockFile)) {
        let running=true;
        try { const { pid }=JSON.parse(fs.readFileSync(lockFile,'utf8')); process.kill(pid,0); } catch { running=false; }
        if (running) throw new Error('Stop the backend before restoring a database backup');
        fs.unlinkSync(lockFile);
    }
    const active = path.join(dataDirectory, 'movie-tracker.sqlite');
    const preserved = `${active}.before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (fs.existsSync(active)) fs.copyFileSync(active, preserved, fs.constants.COPYFILE_EXCL);
    // Preserves and detaches sidecar files so a WAL from the previous database cannot be applied to the restored file.
    for (const suffix of ['-wal','-shm']) {
        const sidecar=`${active}${suffix}`;
        if (!fs.existsSync(sidecar)) continue;
        fs.copyFileSync(sidecar,`${preserved}${suffix}`,fs.constants.COPYFILE_EXCL);
        fs.unlinkSync(sidecar);
    }
    fs.copyFileSync(source, active);
    const restored = new DatabaseSync(active);
    restored.prepare(`INSERT INTO audit_log(action,entity_type,details_json,actor,outcome,metadata_json,created_at)
        VALUES(?,?,?,?,?,?,?)`).run('restore','database',JSON.stringify({ source:path.basename(source),preserved:path.basename(preserved),verified:true }),'cli','success','{}',new Date().toISOString());
    restored.close();
    logger.event('warn','database.restore.completed','SQLite database restored from a verified backup',{ source,preserved });
    console.log(`Database restored from ${source}`);
    console.log(`Previous database preserved at ${preserved}`);
}

restoreBackup();
