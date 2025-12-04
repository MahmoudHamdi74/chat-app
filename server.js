const express = require('express');
const { Socket } = require('socket.io');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server);

app.set("view","view");
app.use(express.static("view"));
app.get('/', (req, res) => {
    res.render("index.html");
});


io.on('connection', socket =>{
    console.log("connection open");
    socket.on('send-message', ({ message, username }) =>{
        socket.broadcast.emit('send-message', { message, username });    
    })
    
})


server.listen(3000, () => {
    console.log('server running....');
});