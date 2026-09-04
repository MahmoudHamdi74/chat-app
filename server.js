const express = require('express');
const { Socket } = require('socket.io');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

app.use(express.static("view"));
app.get('/', (req, res) => {
    res.sendFile(__dirname + "/view/index.html");
});


const users = new Map();
const histories = new Map();
const roomOf = (a, b) => [String(a).toLowerCase(), String(b).toLowerCase()].sort().join('|');

io.on('connection', socket =>{
    console.log("connection open");
    socket.on('send-message', ({ message, username }) =>{
        socket.broadcast.emit('send-message', { message, username });    
    })
    socket.on('register', ({ username }) => {
        username = String(username || '').trim();
        if (!username) return;
        socket.data.username = username;
        socket.join('user:' + username.toLowerCase());
        if (!users.has(username.toLowerCase())) users.set(username.toLowerCase(), { name: username, sockets: new Set() });
        users.get(username.toLowerCase()).name = username;
        users.get(username.toLowerCase()).sockets.add(socket.id);
        io.emit('users-online', [...users.values()].map(u => u.name));
    })
    socket.on('get-history', ({ withUser }, cb) => {
        const me = socket.data.username;
        if (!me || !withUser) return cb && cb([]);
        cb(histories.get(roomOf(me, withUser)) || []);
    })
    socket.on('private-message', ({ to, message }) => {
        const from = socket.data.username;
        message = String(message || '').trim();
        to = String(to || '').trim();
        if (!from || !to || !message) return;
        const msg = { from, to, message: message.slice(0, 2000), at: Date.now() };
        const room = roomOf(from, to);
        if (!histories.has(room)) histories.set(room, []);
        histories.get(room).push(msg);
        if (histories.get(room).length > 500) histories.set(room, histories.get(room).slice(-500));
        io.to('user:' + to.toLowerCase()).emit('private-message', msg);
    })
    socket.on('disconnect', () => {
        const username = socket.data.username;
        if (!username) return;
        const entry = users.get(username.toLowerCase());
        if (!entry) return;
        entry.sockets.delete(socket.id);
        if (entry.sockets.size === 0) {
            users.delete(username.toLowerCase());
            io.emit('users-online', [...users.values()].map(u => u.name));
        }
    })
})


server.listen(3000, () => {
    console.log('server running....');
});