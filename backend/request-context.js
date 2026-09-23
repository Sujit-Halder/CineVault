const { AsyncLocalStorage } = require('node:async_hooks');

const storage=new AsyncLocalStorage();

// Runs one API request with its authenticated account available to model operations.
function runWithAccount(account,operation) { return storage.run({ account },operation); }

// Returns the account attached to the current API request, if one exists.
function currentAccount() { return storage.getStore()?.account || null; }

module.exports={ runWithAccount,currentAccount };
