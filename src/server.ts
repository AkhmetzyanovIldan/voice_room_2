// Initial TypeScript migration of server entrypoint
// This file mirrors server/index.js behavior for development with ts-node-dev.

import express = require('express');
import http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');

const config = require('../server/config');

import { registerRoomSocket } from './sockets/roomSocket';
import { createGameEngine } from './game/gameEngine';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// serve static files from root/public
app.use(express.static(path.join(__dirname, '..', 'public')));

const gameEngine = createGameEngine(io);
registerRoomSocket(io, gameEngine);

const PORT = config.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));