// In-memory stand-in for expo-sqlite on the web harness: enough for the offline mirror to open.
const rows = new Map();
const db = { execAsync: async () => {}, runAsync: async () => ({ changes: 0 }), getAllAsync: async () => [], getFirstAsync: async () => null, withTransactionAsync: async (fn) => fn() };
module.exports = { openDatabaseAsync: async () => db, openDatabaseSync: () => db };
