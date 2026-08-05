const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Хранилище комнат: roomId -> { name, maxSeats, hasChat, users: {}, seats: {} }
const rooms = {};

function generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Создать комнату
    socket.on('create-room', ({ roomName, username, photoUrl, maxSeats, hasChat }) => {
        let roomId = generateRoomCode();
        while (rooms[roomId]) {
            roomId = generateRoomCode();
        }

        const seats = {};
        const max = parseInt(maxSeats) || 6;
        for (let i = 0; i < max; i++) {
            seats[i] = null;
        }

        rooms[roomId] = {
            name: roomName || 'Комната',
            maxSeats: max,
            hasChat: hasChat !== undefined ? hasChat : true,
            users: {},
            seats: seats
        };

        joinRoomLogic(socket, roomId, username, photoUrl);
    });

    // Войти в комнату
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
        socket.data.photoUrl = photoUrl || ''; // Сохраняем ссылку на фото

        const room = rooms[roomId];
        room.users[socket.id] = {
            id: socket.id,
            username: socket.data.username,
            photoUrl: socket.data.photoUrl, // Передаем в общую структуру
            seat: null,
            mic: false,
            audio: true
        };

        socket.emit('room-joined', { roomId, roomName: room.name });
        emitRoomUpdate(roomId);
    }

    // Сесть за стол
    socket.on('take-seat', (seatIndex) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        if (room.seats[seatIndex] !== undefined && room.seats[seatIndex] === null) {
            for (let i = 0; i < room.maxSeats; i++) {
                if (room.seats[i] === socket.id) room.seats[i] = null;
            }
            room.seats[seatIndex] = socket.id;
            room.users[socket.id].seat = seatIndex;
            room.users[socket.id].mic = true;
            emitRoomUpdate(roomId);
        }
    });

    // Встать со стола
    socket.on('leave-seat', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        const room = rooms[roomId];
        for (let i = 0; i < room.maxSeats; i++) {
            if (room.seats[i] === socket.id) room.seats[i] = null;
        }
        if (room.users[socket.id]) {
            room.users[socket.id].seat = null;
            room.users[socket.id].mic = false;
        }
        emitRoomUpdate(roomId);
    });

    // Переключение медиа
    socket.on('toggle-media', ({ mic, audio }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;

        if (mic !== undefined) rooms[roomId].users[socket.id].mic = mic;
        if (audio !== undefined) rooms[roomId].users[socket.id].audio = audio;
        emitRoomUpdate(roomId);
    });

    // Обработка отправки сообщения в чат
    socket.on('send-chat-message', (text) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const username = socket.data.username || 'Гость';
        
        if (text && text.trim().length > 0) {
            io.to(roomId).emit('chat-message', {
                username,
                text: text.trim(),
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
        }
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

    // Отключение
    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            for (let i = 0; i < room.maxSeats; i++) {
                if (room.seats[i] === socket.id) room.seats[i] = null;
            }
            delete room.users[socket.id];

            if (Object.keys(room.users).length === 0) {
                delete rooms[roomId];
            } else {
                emitRoomUpdate(roomId);
            }
        }
        console.log('User disconnected:', socket.id);
    });

    // --- WebRTC Signaling ---
    socket.on('webrtc-offer', ({ targetId, offer }) => {
        io.to(targetId).emit('webrtc-offer', { senderId: socket.id, offer });
    });

    socket.on('webrtc-answer', ({ targetId, answer }) => {
        io.to(targetId).emit('webrtc-answer', { senderId: socket.id, answer });
    });

    socket.on('webrtc-ice-candidate', ({ targetId, candidate }) => {
        io.to(targetId).emit('webrtc-ice-candidate', { senderId: socket.id, candidate });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));