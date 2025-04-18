const express = require('express');
const cors = require('cors');
const db = require('./database');
const app = express();
app.use(cors());
app.use(express.json());

app.get('/users', (req, res) => {
    const users = db.prepare('SELECT * FROM users WHERE is_delete = 0').all();
    res.json(users);
});

app.post('/users', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '名字是必填欄位' });

    const stmt = db.prepare('INSERT INTO users (name) VALUES (?)');
    const result = stmt.run(name);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/users/:id', (req, res) => {
    const id = req.params.id;
    const stmt = db.prepare('UPDATE users SET is_delete = 1 WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到此住戶' });
    }
    res.json({ success: true });
});

app.post('/users/:id/assign-room', (req, res) => {
    const userId = req.params.id
    const { roomId } = req.body

    if (!roomId) {
        return res.status(400).json({ error: '請提供 roomId' })
    }

    try {
        const stmt = db.prepare('UPDATE users SET room_id = ? WHERE id = ?')
        const info = stmt.run(roomId, userId)

        if (info.changes === 0) {
            return res.status(404).json({ error: '找不到這個 user' })
        }
        return res.json({ success: true })
    } catch (e) {
        console.error(e)
        return res.status(500).json({ error: '資料庫錯誤' })
    }
})

app.post('/users/:id/unbind-room', (req, res) => {
    const id = req.params.id;
    const stmt = db.prepare('UPDATE users SET room_id = NULL WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到住戶' });
    }
    res.json({ success: true });
});

app.get('/rooms', (req, res) => {
    const rooms = db.prepare('SELECT * FROM rooms').all();
    const users = db.prepare('SELECT id, name, room_id FROM users WHERE is_delete = 0').all();
    const result = rooms.map(room => ({
        ...room,
        users: users.filter(u => u.room_id === room.id)
    }));
    res.json(result);
});

app.post('/rooms', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '房間名稱為必填' });
    const stmt = db.prepare('INSERT INTO rooms (name) VALUES (?)');
    const result = stmt.run(name);
    res.json({ success: true, id: result.lastInsertRowid });
});

app.delete('/rooms/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const userCount = db.prepare('SELECT COUNT(*) AS total FROM users WHERE room_id = ? AND is_delete = 0').get(id).total;
    if (userCount > 0) {
        return res.status(400).json({ error: '此房間尚有綁定住戶，無法刪除' });
    }
    const stmt = db.prepare('DELETE FROM rooms WHERE id = ?');
    const result = stmt.run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到房間' });
    }
    res.json({ success: true });
});

app.get('/payments', (req, res) => {
    const payments = db.prepare(`
    SELECT 
      payments.id,
      payments.date,
      payments.category,
      payments.amount,
      payments.payer_id,
      payments.note,
      users.name AS payer_name
    FROM payments
    JOIN users ON users.id = payments.payer_id
    WHERE payments.is_delete = 0
    AND payments.archive = 0
    ORDER BY payments.date DESC
  `).all();

    res.json(payments);
});

app.get('/payments-with-users', (req, res) => {
    const isArchived = req.query.archived === '1';

    const payments = db.prepare(`
      SELECT 
        p.id,
        p.date,
        p.category,
        p.amount,
        p.note,
        p.payer_id,
        p.split_by,
        p.rooms,
        u.name AS payer_name
      FROM payments p
      JOIN users u ON u.id = p.payer_id
      WHERE p.is_delete = 0
        AND p.archive = ?
      ORDER BY p.date DESC
    `).all(isArchived ? 1 : 0);

    const paymentUsers = db.prepare(`
      SELECT 
        pu.payment_id,
        pu.user_id,
        pu.amount,
        u.name   AS user_name,
        u.room_id
      FROM payment_users pu
      JOIN users u ON u.id = pu.user_id
      WHERE pu.is_delete = 0
    `).all();

    const grouped = {};
    for (const pu of paymentUsers) {
        (grouped[pu.payment_id] ||= []).push({
            id: pu.user_id,
            name: pu.user_name,
            amount: pu.amount,
            room_id: pu.room_id
        });
    }

    const getRoomName = db.prepare(`SELECT name FROM rooms WHERE id = ?`);

    const result = payments.map(p => {
        const allSplits = grouped[p.id] || [];

        if (p.split_by === 'user') {
            return {
                ...p,
                split_users: allSplits,
                split_per_room: null
            };
        }

        let split_per_room = [];
        try {
            const roomIds = JSON.parse(p.rooms || '[]');
            split_per_room = roomIds.map(rid => {
                const row = getRoomName.get(rid);
                const roomName = row ? row.name : '未知房間';

                const users = allSplits
                    .filter(u => u.room_id === rid)
                    .map(u => ({ id: u.id, name: u.name, amount: u.amount }));

                return { room_id: rid, room_name: roomName, users };
            });
        } catch (err) {
            console.error('解析 p.rooms 失敗', err);
        }

        return {
            ...p,
            split_users: allSplits,
            split_per_room
        };
    });

    res.json(result);
});

app.post('/payments', (req, res) => {
    const {
        date,
        category,
        amount,
        payer_id,
        note,
        split_by = 'user',
        splitUsers = [],
        splitRooms = []
    } = req.body;

    if (!date || !amount || !payer_id) {
        return res.status(400).json({ error: '資料不完整，請確認 date/amount/payer_id' });
    }
    if (split_by === 'user' && (!splitUsers.length)) {
        return res.status(400).json({ error: '人頭分帳時，請提供 splitUsers 陣列' });
    }
    if (split_by === 'room' && (!splitRooms.length)) {
        return res.status(400).json({ error: '房間分帳時，請提供 splitRooms 陣列' });
    }

    const insertPayment = db.prepare(`
      INSERT INTO payments (
        date, category, amount, payer_id, note, split_by, rooms
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const { lastInsertRowid: payment_id } = insertPayment.run(
        date,
        category || '',
        amount,
        payer_id,
        note || '',
        split_by,
        split_by === 'room'
            ? JSON.stringify(splitRooms)
            : null
    );

    const insertUserSplit = db.prepare(`
      INSERT INTO payment_users (
        payment_id, user_id, amount, is_fixed
      ) VALUES (?, ?, ?, 1)
    `);

    const doSplit = db.transaction(() => {
        if (split_by === 'user') {
            const perUser = parseFloat((amount / splitUsers.length).toFixed(2));
            for (const uid of splitUsers) {
                insertUserSplit.run(payment_id, uid, perUser);
            }

        } else {
            const perRoom = parseFloat((amount / splitRooms.length).toFixed(2));
            const stmtSel = db.prepare('SELECT id FROM users WHERE room_id = ?');

            for (const rid of splitRooms) {
                const usersInRoom = stmtSel.all(rid).map(r => r.id);
                if (!usersInRoom.length) continue;

                const perInRoom = parseFloat((perRoom / usersInRoom.length).toFixed(2));
                for (const uid of usersInRoom) {
                    insertUserSplit.run(payment_id, uid, perInRoom);
                }
            }
        }
    });

    try {
        doSplit();
        return res.json({ success: true, id: payment_id });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: '分帳時發生錯誤' });
    }
});

app.delete('/payments/:id', (req, res) => {
    const id = req.params.id;
    const deletePayment = db.prepare('UPDATE payments SET is_delete = 1 WHERE id = ?');
    const result = deletePayment.run(id);

    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到這筆款項' });
    }

    const deleteSplits = db.prepare('UPDATE payment_users SET is_delete = 1 WHERE payment_id = ?');
    deleteSplits.run(id);

    res.json({ success: true });
});

app.get('/summary', (req, res) => {
    const users = db.prepare(`SELECT id, name FROM users WHERE is_delete = 0`).all();

    const summary = {};
    for (const user of users) {
        summary[user.id] = {
            name: user.name,
            paid: 0,
            owed: 0
        };
    }

    const paidRows = db.prepare(`
    SELECT payer_id, SUM(amount) AS total FROM payments
    WHERE is_delete = 0 AND archive = 0
    GROUP BY payer_id
  `).all();

    for (const row of paidRows) {
        if (summary[row.payer_id]) {
            summary[row.payer_id].paid = row.total;
        }
    }

    const owedRows = db.prepare(`
        SELECT pu.user_id, SUM(pu.amount) AS total
        FROM payment_users pu
        JOIN payments p ON p.id = pu.payment_id
        WHERE pu.is_delete = 0 AND p.is_delete = 0 AND p.archive = 0
        GROUP BY pu.user_id
      `).all();

    for (const row of owedRows) {
        if (summary[row.user_id]) {
            summary[row.user_id].owed = row.total;
        }
    }

    const result = Object.values(summary).map(user => ({
        name: user.name,
        paid: parseFloat(user.paid || 0),
        owed: parseFloat(user.owed || 0),
        net: parseFloat((user.paid - user.owed).toFixed(2))
    }));

    res.json(result);
});

app.post('/payments/:id/archive', (req, res) => {
    const id = req.params.id;
    const result = db.prepare('UPDATE payments SET archive = 1 WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到款項' });
    }
    res.json({ success: true });
});

app.post('/payments/:id/unarchive', (req, res) => {
    const id = req.params.id;
    const result = db.prepare('UPDATE payments SET archive = 0 WHERE id = ?').run(id);
    if (result.changes === 0) {
        return res.status(404).json({ error: '找不到款項' });
    }
    res.json({ success: true });
});

app.delete('/payments/:id', (req, res) => {
    const { id } = req.params;
    const stmt = db.prepare('UPDATE payments SET is_delete = 1 WHERE id = ?');
    try {
        stmt.run(id);
        return res.json({ success: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: '刪除失敗' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
