const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const server = require('http').createServer(app);

const FRONTEND_URLS = (process.env.FRONTEND_URL || '').split(',').map(s => s.trim()).filter(Boolean);

const io = require('socket.io')(server, {
    cors: {
        origin: (origin, cb) => {
            if (!origin) return cb(null, true);
            if (FRONTEND_URLS.length === 0) return cb(null, true);
            if (FRONTEND_URLS.includes(origin) || /\.vercel\.app$/.test(origin)) return cb(null, true);
            return cb(null, true);
        },
        methods: ['GET', 'POST']
    }
});

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'chat-app-backend' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const users = new Map();
const histories = new Map();
const roomOf = (a, b) => [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');

const HISTORY_FILE = path.join(__dirname, 'chat-history.json');
function loadHistories() {
    try {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const obj = JSON.parse(raw);
        Object.entries(obj).forEach(([room, msgs]) => {
            if (Array.isArray(msgs)) histories.set(room, msgs.slice(-500));
        });
        console.log('loaded history rooms: ' + histories.size);
    } catch (e) { console.log('no saved history yet'); }
}
let saveTimer = null;
function saveHistories() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(Object.fromEntries(histories)));
        } catch (e) { console.log('history save failed: ' + e.message); }
    }, 500);
}
loadHistories();

const liveSockets = (entry) => {
    entry.sockets.forEach(id => { if (!io.sockets.sockets.has(id)) entry.sockets.delete(id); });
    return entry.sockets;
};

io.on('connection', socket =>{
    console.log("connection open");
    socket.on('send-message', ({ message, username }) =>{
        socket.broadcast.emit('send-message', { message, username });
    })
    socket.on('register', ({ username }, cb) => {
        username = String(username || '').trim();
        if (!username) return cb && cb({ ok: false, error: 'empty' });
        const key = username.toLowerCase();
        const existing = users.get(key);
        if (existing && liveSockets(existing).size > 0 && ![...existing.sockets].includes(socket.id)) {
            return cb && cb({ ok: false, error: 'taken' });
        }
        socket.data.username = username;
        socket.join('user:' + key);
        if (!users.has(key)) users.set(key, { name: username, sockets: new Set() });
        users.get(key).name = username;
        users.get(key).sockets.add(socket.id);
        io.emit('users-online', [...users.values()].map(u => u.name));
        cb && cb({ ok: true });
    })
    socket.on('get-history', ({ withUser }, cb) => {
        const me = socket.data.username;
        if (!me || !withUser) return cb && cb([]);
        cb(histories.get(roomOf(me, withUser)) || []);
    })
    socket.on('private-message', ({ to, message, id }) => {
        const from = socket.data.username;
        message = String(message || '').trim();
        to = String(to || '').trim();
        if (!from || !to || !message) return;
        const msg = { id: String(id || ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7))), from, to, message: message.slice(0, 2000), at: Date.now() };
        const room = roomOf(from, to);
        if (!histories.has(room)) histories.set(room, []);
        if (!histories.get(room).some(m => m.id === msg.id)) histories.get(room).push(msg);
        if (histories.get(room).length > 500) histories.set(room, histories.get(room).slice(-500));
        saveHistories();
        io.to('user:' + to.toLowerCase()).emit('private-message', msg);
    })
    socket.on('edit-message', ({ withUser, id, message }, cb) => {
        const me = socket.data.username;
        message = String(message || '').trim().slice(0, 2000);
        if (!me || !withUser || !id || !message) return cb && cb({ ok: false });
        const room = roomOf(me, withUser);
        const msg = (histories.get(room) || []).find(m => m.id === id);
        if (!msg || msg.from !== me) return cb && cb({ ok: false });
        msg.message = message;
        msg.edited = true;
        saveHistories();
        io.to('user:' + withUser.toLowerCase()).emit('message-edited', { ...msg });
        cb && cb({ ok: true });
    })
    socket.on('delete-message', ({ withUser, id }, cb) => {
        const me = socket.data.username;
        if (!me || !withUser || !id) return cb && cb({ ok: false });
        const room = roomOf(me, withUser);
        const arr = histories.get(room) || [];
        const idx = arr.findIndex(m => m.id === id);
        if (idx < 0 || arr[idx].from !== me) return cb && cb({ ok: false });
        const [msg] = arr.splice(idx, 1);
        saveHistories();
        io.to('user:' + withUser.toLowerCase()).emit('message-deleted', { id, from: msg.from, to: msg.to });
        cb && cb({ ok: true });
    })
    socket.on('logout', () => {
        const username = socket.data.username;
        if (!username) return;
        socket.data.username = null;
        socket.leave('user:' + username.toLowerCase());
        const entry = users.get(username.toLowerCase());
        if (entry) {
            entry.sockets.delete(socket.id);
            if (liveSockets(entry).size === 0) users.delete(username.toLowerCase());
        }
        io.emit('users-online', [...users.values()].map(u => u.name));
    })
    socket.on('disconnect', () => {
        const username = socket.data.username;
        if (!username) return;
        const entry = users.get(username.toLowerCase());
        if (!entry) return;
        entry.sockets.delete(socket.id);
        if (liveSockets(entry).size === 0) {
            users.delete(username.toLowerCase());
            io.emit('users-online', [...users.values()].map(u => u.name));
        }
    })
})

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('server running on port ' + PORT);
});
