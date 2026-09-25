const { AsyncLocalStorage } = require('node:async_hooks');

const storage=new AsyncLocalStorage();

// Validates a browser-supplied IANA timezone before using it in calendar operations.
function normalizeTimeZone(value) {
    if (typeof value !== 'string' || !value || value.length > 100) return 'UTC';
    try { return new Intl.DateTimeFormat('en-US',{ timeZone:value }).resolvedOptions().timeZone; }
    catch { return 'UTC'; }
}

// Runs one API request with its authenticated account and browser timezone available to model operations.
function runWithAccount(account,operation,timeZone='UTC') { return storage.run({ account,timeZone:normalizeTimeZone(timeZone) },operation); }

// Returns the account attached to the current API request, if one exists.
function currentAccount() { return storage.getStore()?.account || null; }

// Returns the current request's browser timezone or UTC for non-browser operations.
function currentTimeZone() { return storage.getStore()?.timeZone || 'UTC'; }

module.exports={ runWithAccount,currentAccount,currentTimeZone,normalizeTimeZone };
