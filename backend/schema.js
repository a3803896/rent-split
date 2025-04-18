const Database = require('better-sqlite3');
const db = new Database('./data/rent.db');

db.exec(`

  -- 使用者資料表
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    active BOOLEAN DEFAULT 1,
    is_delete BOOLEAN DEFAULT 0,
    room_id INTEGER, -- 綁定房間 ID（可為 null）
    create_date TEXT DEFAULT (datetime('now'))
  );

  -- 房間資料表
  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  -- 款項主檔
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    category TEXT,
    amount REAL NOT NULL,
    payer_id INTEGER NOT NULL,
    note TEXT,
    archive BOOLEAN DEFAULT 0,
    is_delete BOOLEAN DEFAULT 0,
    split_by TEXT NOT NULL DEFAULT 'user', -- 'user' 或 'room'
    rooms       TEXT,   -- JSON string of splitRooms
    create_date TEXT DEFAULT (datetime('now'))
  );

  -- 款項對應使用者（分帳）
  CREATE TABLE IF NOT EXISTS payment_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    amount REAL,
    is_fixed BOOLEAN DEFAULT 0,
    is_delete BOOLEAN DEFAULT 0,
    create_date TEXT DEFAULT (datetime('now'))
  );

`);

console.log('📦 資料表初始化完成！');