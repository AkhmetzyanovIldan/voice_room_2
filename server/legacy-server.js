const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Load secrets from server config or environment (do not hardcode secrets here)
const config = require('./config');
const LK_API_KEY = config.LK_API_KEY;
const LK_API_SECRET = config.LK_API_SECRET;
const LIVEKIT_URL = config.LIVEKIT_URL;

if (!LK_API_KEY || !LK_API_SECRET || !LIVEKIT_URL) {
    console.warn('LiveKit configuration missing in legacy-server.js — get-livekit-token will return null token');
}

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
        // отправляем токен и URL LiveKit-кластера клиенту
        socket.emit('livekit-token', { token, url: LIVEKIT_URL });
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
            seats: seats,
            // Свойства игровой логики
            gameStatus: 'waiting', // waiting, playing, discussion
            currentTurnIndex: 0,
            turnOrder: [],
            timer: null
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
            mic: false,
            isReady: false
        };

        socket.emit('room-joined', { roomId, roomName: room.name });
        emitRoomUpdate(roomId);
    }

    socket.on('take-seat', (seatIndex) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        
        // Во время игры занимать места нельзя
        if (room.gameStatus !== 'waiting') return;

        if (room.seats[seatIndex] === null) {
            for (let i = 0; i < room.maxSeats; i++) { 
                if (room.seats[i] === socket.id) room.seats[i] = null; 
            }
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
        
        if (room.gameStatus !== 'waiting') return;

        for (let i = 0; i < room.maxSeats; i++) { 
            if (room.seats[i] === socket.id) room.seats[i] = null; 
        }
        if (room.users[socket.id]) { 
            room.users[socket.id].seat = null; 
            room.users[socket.id].mic = false; 
            room.users[socket.id].isReady = false;
        }
        emitRoomUpdate(roomId);
    });

    // Обработка кнопки «Готов»
    socket.on('set-ready', () => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (room.gameStatus !== 'waiting') return;
        const user = room.users[socket.id];
        
        // Готовыми могут быть только те, кто сидит за столом
        if (user && user.seat !== null) {
            user.isReady = !user.isReady;
            emitRoomUpdate(roomId);

            // Собираем всех пользователей, сидевших за столом
            const seatedUsers = Object.values(room.users).filter(u => u.seat !== null);
            
            // Если за столом есть хотя бы 1 игрок и все они нажали «Готов» — запускаем игру
            if (seatedUsers.length > 0 && seatedUsers.every(u => u.isReady)) {
                startPlayingPhase(roomId);
            }
        }
    });

    socket.on('toggle-media', ({ mic }) => {
        const roomId = socket.data.roomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const user = room.users[socket.id];
        
        // Только сидящие за столом могут переключать микрофон (наблюдатели — нет)
        if (!user || user.seat === null) return;

        // Правила:
        // - В фазе 'playing' менять состояние микрофона может только текущий активный игрок (socket.id === activePlayer.id).
        // - В фазе 'discussion' или 'waiting' — любой сидящий может менять свой микрофон.
        if (room.gameStatus === 'playing') {
            const activePlayer = room.turnOrder && room.turnOrder[room.currentTurnIndex];
            if (!activePlayer) return;
            if (activePlayer.id !== socket.id) {
                return;
            }
        }

        user.mic = mic;
        emitRoomUpdate(roomId);
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

    // function emitRoomUpdate(roomId) {
    //     const room = rooms[roomId];
    //     if (!room) return;

    //     let currentSpeakerId = null;
    //     if (room.gameStatus === 'playing' && room.turnOrder && room.turnOrder[room.currentTurnIndex]) {
    //         currentSpeakerId = room.turnOrder[room.currentTurnIndex].id;
    //     }

    //     io.to(roomId).emit('update-room', {
    //         roomName: room.name,
    //         maxSeats: room.maxSeats,
    //         hasChat: room.hasChat,
    //         users: room.users,
    //         seats: room.seats,
    //         gameStatus: room.gameStatus,
    //         currentSpeakerId: currentSpeakerId
    //     });
    // }

    socket.on('disconnect', () => {
        const roomId = socket.data.roomId;
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            for (let i = 0; i < room.maxSeats; i++) { 
                if (room.seats[i] === socket.id) room.seats[i] = null; 
            }
            delete room.users[socket.id];
            
            if (Object.keys(room.users).length === 0) {
                clearInterval(room.timer);
                delete rooms[roomId];
            } else {
                // Если игра шла и вышел активный игрок — проверяем состояние
                emitRoomUpdate(roomId);
            }
        }
    });
});

// --- ИГРОВЫЕ ФУНКЦИИ СЕРВЕРА ---

function startPlayingPhase(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameStatus = 'playing';
    
    // Формируем порядок хода по порядку занятых мест за столом (от 0 до maxSeats)
    room.turnOrder = [];
    for (let i = 0; i < room.maxSeats; i++) {
        const userId = room.seats[i];
        if (userId && room.users[userId]) {
            room.turnOrder.push(room.users[userId]);
        }
    }

    room.currentTurnIndex = 0;
    io.to(roomId).emit('game-started', { roomStatus: room.gameStatus });
    startTurn(roomId);
}

function startTurn(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    // Если все игроки по очереди высказались — переходим к общему обсуждению
    if (room.currentTurnIndex >= room.turnOrder.length) {
        startDiscussionPhase(roomId);
        return;
    }

    const activePlayer = room.turnOrder[room.currentTurnIndex];
    let timeLeft = 15; // 15 секунд на слово каждого игрока (можете изменить)

    io.to(roomId).emit('turn-changed', {
        activePlayerId: activePlayer.id,
        timeLeft
    });

    clearInterval(room.timer);
    room.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            io.to(roomId).emit('timer-tick', { timeLeft });
        } else {
            clearInterval(room.timer);
            room.currentTurnIndex++;
            startTurn(roomId);
        }
    }, 1000);
}

function startDiscussionPhase(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameStatus = 'discussion';
    let timeLeft = 30; // 30 секунд общего обсуждения (можете изменить)

    io.to(roomId).emit('discussion-started', { timeLeft });

    clearInterval(room.timer);
    room.timer = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            io.to(roomId).emit('timer-tick', { timeLeft });
        } else {
            clearInterval(room.timer);
            endGame(roomId);
        }
    }, 1000);
}

function emitRoomUpdate(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    let currentSpeakerId = null;
    if (room.gameStatus === 'playing' && room.turnOrder && room.turnOrder[room.currentTurnIndex]) {
        currentSpeakerId = room.turnOrder[room.currentTurnIndex].id;
    }

    io.to(roomId).emit('update-room', {
        roomName: room.name,
        maxSeats: room.maxSeats,
        hasChat: room.hasChat,
        users: room.users,
        seats: room.seats,
        gameStatus: room.gameStatus,
        currentSpeakerId: currentSpeakerId
    });
}

function endGame(roomId) {
    const room = rooms[roomId];
    if (!room) return;

    room.gameStatus = 'waiting';
    // Сбрасываем готовность всех пользователей
    Object.values(room.users).forEach(u => u.isReady = false);

    io.to(roomId).emit('game-ended');
    emitRoomUpdate(roomId);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));