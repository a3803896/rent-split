const Database = require('better-sqlite3');
const db = new Database('./data/rent.db'); // SQLite 檔案存於容器掛載資料夾

module.exports = db;