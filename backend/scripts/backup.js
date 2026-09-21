const { createBackup } = require('../model');

// Creates one integrity-checked SQLite backup from the active database.
function runBackup() {
    const destination = createBackup({ actor:'cli',metadata:{ command:'npm run backup' } });
    console.log(`Backup created: ${destination}`);
}

runBackup();
