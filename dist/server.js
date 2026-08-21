"use strict";
// Initial TypeScript migration of server entrypoint
// This file mirrors server/index.js behavior for development with ts-node-dev.
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const http = require("http");
const { Server } = require('socket.io');
const path = require('path');
const { AccessToken } = require('livekit-server-sdk');
const config = require('../server/config');
const roomSocket_1 = require("./sockets/roomSocket");
const gameEngine_1 = require("./game/gameEngine");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
// serve static files from root/public
app.use(express.static(path.join(__dirname, '..', 'public')));
const gameEngine = (0, gameEngine_1.createGameEngine)(io);
(0, roomSocket_1.registerRoomSocket)(io, gameEngine);
const PORT = config.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
