const { exportJson } = require('../model');

// Creates one portable JSON export from the active database.
function runExport() {
    console.log(`Export created: ${exportJson({ actor:'cli',metadata:{ command:'npm run export' } })}`);
}

runExport();
