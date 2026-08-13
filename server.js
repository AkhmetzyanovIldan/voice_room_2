const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Ваши настройки LiveKit Cloud
const LK_API_KEY = "APIGfJceZTESFgY";
const LK_API_SECRET = "i2w2iPVvc78CfUkHV8gOF7eFh2P66NNeB8fF9d1CpJCA";

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    // Генерация уникального identity на базе socket.id, чтобы исключить конфликты одинаковых имен
    socket.on('get-livekit-token', async ({ username, roomId }) => {
        const identity = `${username}_${socket.id}`;
        const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity });
        at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true });
        const token = await at.toJwt();
        // console.log("Сгенерированный токен (должен быть длинной строкой, а не [object Object]):", token);
        socket.emit('livekit-token', token);
    });

    socket.on('create-room', ({ roomName, username, photoUrl, maxSeats, hasChat }) => {
        let roomId = generateRoomCode();
        while (rooms[roomId]) { roomId = generateRoomCode(); }

        const seats = {};
        const max = parseInt(maxSeats) || 6;
        for (let i = 0; i < max; i++) { seats[i] = null; }

        rooms[roomId] = {
            name: roomName || 'Комната',
            maxSeats: max,
            hasChat: hasChat !== undefined ? hasChat : true,
            users: {},
            seats: seats
        };

        joinRoomLogic(socket, roomId, username, photoUrl);
    });

    socket.on('join-room', ({ roomId, username, photoUrl }) => {
        if (!rooms[roomId]) {
            socket.emit('error-msg', 'Комната не найдена!');
            return;
        }
        joinRoomLogic(socket, roomId, username, photoUrl);
    });

    function joinRoomLogic(socket, roomId, username, photoUrl) {
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.username = username || 'Гость';
        socket.data.photoUrl = photoUrl || '';

        const room = rooms[roomId];
        room.users[socket.id] = {
            id: socket.id,
            username: socket.data.username,
            photoUrl: socket.data.photoUrl,
            seat: null,
            mic: false
        };

        socket.emit('room-joined', { roomId, roomName: room.name });
        emitRoomUpdate(roomId);
    }

    socket.on('take-seat', (seatIndex) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.seats[seatIndex] === null) {
            for (let i = 0; i < room.maxSeats; i++) { if (room.seats[i] === socket.id) room.seats[i] = null; }
            room.seats[seatIndex] = socket.id;
            room.users[socket.id].seat = seatIndex;
            room.users[socket.id].mic = true;
            emitRoomUpdate(roomId);
        }
    });

    socket.on('leave-seat', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        for (let i = 0; i < room.maxSeats; i++) { if (room.seats[i] === socket.id) room.seats[i] = null; }
        if (room.users[socket.id]) { room.users[socket.id].seat = null; room.users[socket.id].mic = false; }
        emitRoomUpdate(roomId);
    });

    socket.on('toggle-media', ({ mic }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        if (room.users[socket.id]) {
            room.users[socket.id].mic = mic;
            emitRoomUpdate(roomId);
        }
    });

    socket.on('send-chat-message', (text) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        io.to(roomId).emit('chat-message', {
            username: socket.data.username,
            text: text.trim(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
    });

    function emitRoomUpdate(roomId) {
        const room = rooms[roomId];
        io.to(roomId).emit('update-room', {
            roomName: room.name,
            maxSeats: room.maxSeats,
            hasChat: room.hasChat,
            users: room.users,
            seats: room.seats
        });
    }

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            for (let i = 0; i < room.maxSeats; i++) { if (room.seats[i] === socket.id) room.seats[i] = null; }
            delete room.users[socket.id];
            if (Object.keys(room.users).length === 0) delete rooms[roomId];
            else emitRoomUpdate(roomId);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));