// UI logic — connects DOM with appSocket and appEvents
(function () {
  const appEvents = window.appEvents;
  const appSocket = window.appSocket;

  if (!appEvents || !appSocket) {
    console.error('appEvents or appSocket not initialized');
    return;
  }
  // DOM helpers
  const $ = (sel) => document.querySelector(sel);

  const lobby = $('#lobby');
  const roomSection = $('#room');
  const joinBtn = $('#join-btn');
  const roomCodeInput = $('#room-code-input');
  const usernameInput = $('#username-input');
  const createBtn = $('#create-room-btn');

  const roomTitleDisplay = $('#room-title-display');
  const roomCodeDisplay = $('#room-code-display');
  const usersCount = $('#users-count');
  const chatMessages = $('#chat-messages');
  const chatInput = $('#chat-input');
  const chatSendBtn = $('#chat-send-btn');
  const readyBtn = $('#ready-btn-game');
  const micBtn = $('#mic-btn');
  const audioBtn = $('#audio-btn');
  const seatActionBtn = $('#seat-action-btn');
  const listenersToggleBtn = $('#listeners-toggle-btn');

  let currentRoomId = null;
  let myId = null;
  let mySeat = null;
  let isAudioOn = true;
  let nightActionSubmitted = false;

  function getTelegramProfile() {
    const user = window.Telegram && window.Telegram.WebApp &&
      window.Telegram.WebApp.initDataUnsafe &&
      window.Telegram.WebApp.initDataUnsafe.user;
    if (!user) return { username: '', photoUrl: '' };
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ');
    return { username: name || user.username || '', photoUrl: user.photo_url || '' };
  }

  function getCurrentProfile() {
    const telegramProfile = getTelegramProfile();
    return {
      username: usernameInput && usernameInput.value.trim() || telegramProfile.username || 'Игрок',
      photoUrl: telegramProfile.photoUrl
    };
  }

  function getUserNameById(userId) {
    const users = window.__lastRoomState && window.__lastRoomState.users;
    return users && users[userId] ? users[userId].username : 'игрока';
  }

  function getEnabledRoles() {
    return Array.from(document.querySelectorAll('input[name="enabled-role"]:checked'))
      .map((input) => input.value);
  }

  function renderRoleOptions() {
    const roles = window.mafiaRoles || [];
    const groups = {
      mafia: document.getElementById('mafia-roles'),
      peaceful: document.getElementById('peaceful-roles')
    };
    roles.forEach((role) => {
      const group = groups[role.clan];
      if (!group) return;
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" name="enabled-role" value="${role.id}"${role.enabledByDefault ? ' checked' : ''}> ${role.name}`;
      group.appendChild(label);
    });
  }

  renderRoleOptions();

  const telegramProfile = getTelegramProfile();
  if (usernameInput && !usernameInput.value.trim() && telegramProfile.username) {
    usernameInput.value = telegramProfile.username;
  }

  // Helpers from former app.js
  function showError(msg) { const el = document.getElementById('error-box'); if (el) el.innerText = msg || ''; }

  function renderSeats(maxSeats, users, seatsData, currentSpeakerId, gameStatus) {
    const container = document.getElementById('table-container');
    if (!container) return;
    container.querySelectorAll('.seat').forEach(el => el.remove());

    const totalSeats = maxSeats % 2 === 0 ? maxSeats : maxSeats + 1;
    const rows = totalSeats / 2;
    const seatSize = 40;
    const rowGap = 8;
    const layoutHeight = rows * seatSize + (rows - 1) * rowGap;
    const startY = Math.max(0, (container.clientHeight - layoutHeight) / 2);

    for (let i = 0; i < totalSeats; i++) {
      const row = Math.floor(i / 2);
      const side = i % 2;
      const x = side === 0 ? 10 : container.clientWidth - seatSize - 10;
      const y = startY + row * (seatSize + rowGap);

      const seatEl = document.createElement('div');
      seatEl.className = 'seat';
      seatEl.id = `seat-${i}`;
      seatEl.style.left = `${x}px`;
      seatEl.style.top = `${y}px`;

      const isBlockedSeat = i >= maxSeats;
      const userIdInSeat = isBlockedSeat ? null : seatsData[i];
      if (isBlockedSeat) {
        seatEl.classList.add('blocked-seat');
        seatEl.innerText = '✕';
        seatEl.title = 'Место недоступно';
        seatEl.onclick = () => {};
        container.appendChild(seatEl);
        continue;
      }

      if (userIdInSeat) {
        const user = users[userIdInSeat];
        seatEl.classList.add('occupied');

        if (userIdInSeat === myId) seatEl.classList.add('my-seat');
        if (userIdInSeat === currentSpeakerId) seatEl.classList.add('active-speaker');

        if (user && user.photoUrl) {
          seatEl.innerHTML = `<img src="${user.photoUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
          seatEl.innerHTML = `<div style="overflow:hidden; text-overflow:ellipsis; width:100%; font-size:11px;"><b>${user ? user.username[0] : ''}</b></div>`;
        }

        if (user && !user.mic) seatEl.innerHTML += `<div style="position:absolute; bottom:0; right:0; font-size:10px;">🔇</div>`;
        if (user && user.isReady) seatEl.innerHTML += `<div style="position:absolute; top:0; right:0; font-size:10px; background:rgba(0,255,0,0.7); border-radius:50%; width:12px; height:12px; text-align:center; line-height:12px;">✓</div>`;
        if (user && user.isAlive === false) seatEl.innerHTML += `<div style="position:absolute; top:0; left:0; font-size:12px;">☠️</div>`;

        // If it's night and current user can act and is alive, clicking a seat is a night action
        const me = users && users[myId];
        const myRole = window.myRole; // private role stored from personal 'game-started' event
        if (gameStatus === 'day_voting' && me && me.isAlive) {
          seatEl.style.cursor = 'pointer';
          seatEl.onclick = () => {
            if (userIdInSeat !== myId && user && user.isAlive !== false) {
              appSocket.dayVote(userIdInSeat);
            }
          };
        } else if (gameStatus === 'night' && me && me.isAlive && myRole && ['mafia','doctor','cop'].includes(myRole)) {
          // clicking targets another player
          seatEl.style.cursor = 'pointer';
          seatEl.onclick = () => {
            if (userIdInSeat === myId) { console.log('night-action: cannot target self'); return; } // don't target self
            const actionType = myRole === 'mafia' ? 'mafia_kill' : myRole === 'doctor' ? 'doctor_heal' : myRole === 'cop' ? 'cop_check' : null;
            if (!actionType) return;
            if (!currentRoomId) { console.warn('no currentRoomId'); return; }
            if (nightActionSubmitted) return;
            const actionNames = {
              mafia_kill: 'стрелять в',
              doctor_heal: 'вылечить',
              cop_check: 'проверить'
            };
            const targetName = user ? user.username : 'этого игрока';
            if (!window.confirm(`${actionNames[actionType]} игрока «${targetName}»?`)) return;
            nightActionSubmitted = true;
            window.appSocket.socket.emit('night-action', { roomId: currentRoomId, targetId: userIdInSeat, actionType });
          };
        } else {
          // default click: take seat when empty; occupied seats do nothing outside night
          seatEl.onclick = () => { /* no-op for occupied seat */ };
        }

        // show if this seat is the one we selected this night
        if (window.myNightTargetId && window.myNightTargetId === userIdInSeat) {
          if (!seatEl.querySelector('.target-marker')) {
            const m = document.createElement('div'); m.className = 'target-marker'; m.style.position='absolute'; m.style.bottom='-6px'; m.style.left='50%'; m.style.transform='translateX(-50%)'; m.style.fontSize='10px'; m.innerText = '🎯 ВЫ'; seatEl.appendChild(m);
          }
        }

      } else {
        seatEl.classList.remove('occupied');
        seatEl.innerText = '+';
        seatEl.onclick = () => takeSeat(i);
      }

      container.appendChild(seatEl);
    }
  }

  function updateUI(users, seats, gameStatus) {
    const allUsers = Object.values(users || {});
    usersCount && (usersCount.innerText = `${allUsers.length} участников`);

    const seatedUserIds = Object.values(seats || {});
    const listeners = allUsers.filter(u => !seatedUserIds.includes(u.id));

    const listContainer = document.getElementById('listeners-list-content');
    if (listContainer) {
      listContainer.innerHTML = '';
      if (listeners.length === 0) listContainer.innerHTML = '<div class="listener-item" style="color:#666;">Нет слушателей</div>';
      else listeners.forEach(l => { const div = document.createElement('div'); div.className = 'listener-item'; div.innerText = `👤 ${l.username}`; listContainer.appendChild(div); });
    }

    const me = users && users[myId];
    if (me) {
      mySeat = me.seat;

      // show personal role in top corner if available (only visible to you)
      const playerRoleEl = document.getElementById('player-role');
      if (playerRoleEl) playerRoleEl.innerText = window.myRole ? `Вы - ${window.myRole}` : 'Вы - —';

      if (mySeat !== null) {
        const roleLabel = document.getElementById('role-label'); if (roleLabel) roleLabel.innerText = 'Режим: Спикер (за столом)';
        if (seatActionBtn) seatActionBtn.innerText = '🪑 Встать';

        // ready button behavior: visible in waiting, show 'Не готов' when active
        if (gameStatus === 'waiting') {
          if (readyBtn) readyBtn.style.display = 'inline-block';
          if (micBtn) micBtn.disabled = false;
          if (readyBtn) {
            if (me.isReady) {
              readyBtn.innerText = 'Не готов';
              readyBtn.classList.add('ready-on');
            } else {
              readyBtn.innerText = 'Готов к игре';
              readyBtn.classList.remove('ready-on');
            }
          }
        } else {
          if (readyBtn) readyBtn.style.display = 'none';
          if (gameStatus === 'day_speeches') {
            if (micBtn) micBtn.disabled = (window.appSocket.socket.id !== window.currentActiveSpeakerId);
          } else if (gameStatus === 'day_discussion') {
            if (micBtn) micBtn.disabled = false;
          } else if (gameStatus === 'night') {
            // during night, mics must be locked
            if (micBtn) micBtn.disabled = true;
          } else {
            if (micBtn) micBtn.disabled = true;
          }
        }
      } else {
        const roleLabel = document.getElementById('role-label'); if (roleLabel) roleLabel.innerText = 'Режим: Наблюдатель';
        if (seatActionBtn) seatActionBtn.innerText = '🪑 Сесть';
        if (micBtn) micBtn.disabled = true;
        if (readyBtn) readyBtn.style.display = 'none';

        if (window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) {
          window.lkRoom.localParticipant.setMicrophoneEnabled(false);
          updateMicButtonUI(false);
          appSocket.toggleMedia(false);
        }
      }
    }
  }

  // --- event handlers that call socket APIs ---
  function takeSeat(index) { appSocket.takeSeat(index); }
  function handleSeatAction() { if (mySeat !== null) { appSocket.leaveSeat(); } }
  function toggleReady() { appSocket.setReady(); }
  function sendChatMessage() { const input = chatInput; if (!input) return; const text = input.value.trim(); if (text.length > 0) { appSocket.sendChatMessage(text); input.value = ''; } }

  function updateMicButtonUI(isOn) { if (!micBtn) return; if (isOn) { micBtn.classList.add('active'); micBtn.innerText = '🎤 Мик: Вкл'; } else { micBtn.classList.remove('active'); micBtn.innerText = '🎤 Мик: Выкл'; } }

  async function toggleMic() {
    if (mySeat === null || !window.lkRoom) return;
    const micIsActive = micBtn && micBtn.classList.contains('active');
    const newStatus = !micIsActive;
    try { await window.lkRoom.localParticipant.setMicrophoneEnabled(newStatus); updateMicButtonUI(newStatus); appSocket.toggleMedia(newStatus); } catch (e) { console.error(e); }
  }

  function toggleAudio() {
    isAudioOn = !isAudioOn; document.querySelectorAll('audio').forEach(el => el.muted = !isAudioOn); if (audioBtn) { if (isAudioOn) { audioBtn.classList.add('active'); audioBtn.innerText = '🔊 Звук: Вкл'; } else { audioBtn.classList.remove('active'); audioBtn.innerText = '🔊 Звук: Выкл'; } }
  }

  function leaveRoom() { if (window.lkRoom) { window.lkRoom.disconnect(); window.lkRoom = null; } window.location.reload(); }

  // Expose some functions globally to support inline onclick attributes in index.html
  window.openSettingsModal = function () {
    const roomName = document.getElementById('room-name-input') && document.getElementById('room-name-input').value.trim();
    if (!roomName) { showError('Введите название комнаты'); return; }
    showError('');
    const overlay = document.getElementById('modal-overlay'); if (overlay) overlay.classList.remove('hidden');
  };

  window.confirmCreateRoom = function () {
    const roomName = document.getElementById('room-name-input') && document.getElementById('room-name-input').value.trim();
    const profile = getCurrentProfile();
    const username = profile.username;
    const photoUrl = profile.photoUrl;
    const maxSeats = document.getElementById('input-max-seats') && document.getElementById('input-max-seats').value;
    const hasChat = document.getElementById('input-has-chat') && document.getElementById('input-has-chat').checked;
    const enabledRoles = getEnabledRoles();
    const overlay = document.getElementById('modal-overlay'); if (overlay) overlay.classList.add('hidden');
    appSocket.createRoom({ roomName, username, photoUrl, maxSeats, hasChat, enabledRoles });
  };

  // make UI actions available globally too
  window.toggleReady = toggleReady;
  window.toggleMic = toggleMic;
  window.toggleAudio = toggleAudio;
  window.handleSeatAction = handleSeatAction;
  window.toggleListenersPanel = function () { const panel = document.getElementById('listeners-panel'); if (!panel) return; panel.classList.toggle('hidden'); const btn = document.getElementById('listeners-toggle-btn'); if (btn) btn.classList.toggle('active'); };
  window.leaveRoom = leaveRoom;

  // attach UI controls
  if (joinBtn) joinBtn.onclick = () => {
    const roomId = roomCodeInput.value.trim();
    const profile = getCurrentProfile();
    if (!roomId) return showError('Введите код комнаты');
    appSocket.joinRoom(roomId, profile.username, profile.photoUrl);
  };
  if (chatSendBtn) chatSendBtn.onclick = sendChatMessage;
  if (readyBtn) readyBtn.onclick = toggleReady;
  if (micBtn) micBtn.onclick = toggleMic;
  if (audioBtn) audioBtn.onclick = toggleAudio;
  if (seatActionBtn) seatActionBtn.onclick = handleSeatAction;
  if (listenersToggleBtn) listenersToggleBtn.onclick = () => { const panel = document.getElementById('listeners-panel'); if (!panel) return; panel.classList.toggle('hidden'); listenersToggleBtn.classList.toggle('active'); };

  // Wire appEvents to UI updates
  appEvents.on('room-joined', ({ roomId, roomName }) => {
    currentRoomId = roomId;
    myId = window.appSocket.socket.id;
    if (document.getElementById('modal-overlay')) document.getElementById('modal-overlay').classList.add('hidden');
    if (lobby) lobby.classList.add('hidden');
    if (roomSection) roomSection.classList.remove('hidden');
    if (roomTitleDisplay) roomTitleDisplay.innerText = roomName;
    if (roomCodeDisplay) roomCodeDisplay.innerText = roomId;

    // request livekit token
    const username = getCurrentProfile().username;
    appSocket.getLivekitToken(username, roomId);
  });

  appEvents.on('livekit-token', async (data) => {
    try {
      const token = data && data.token;
      const url = data && data.url;

      if (!token || !url) {
        throw new Error('Missing LiveKit token or URL');
      }

      if (window.lkRoom) await window.lkRoom.disconnect();
      const { Room, RoomEvent } = LivekitClient;
      const lkRoom = new Room();
      window.lkRoom = lkRoom;

      lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'audio') {
          const element = track.attach(); element.muted = !isAudioOn; element.dataset.participantId = participant.identity; document.body.appendChild(element);
        }
      });

      lkRoom.on(RoomEvent.TrackUnsubscribed, (track) => { if (track.kind === 'audio') track.detach().forEach(el => el.remove()); });

      await lkRoom.connect(url, token);
    } catch (error) { console.error('LiveKit connect error', error); showError('Не удалось подключиться к голосовому серверу'); }
  });

  // track my selected night target locally
  window.myNightTargetId = null;
  nightActionSubmitted = false;

  appEvents.on('update-room', ({ roomName, maxSeats, hasChat, users, seats, gameStatus, currentSpeakerId, votes }) => {
    if (roomTitleDisplay) roomTitleDisplay.innerText = roomName;
    const chatContainer = document.querySelector('.chat-container'); if (chatContainer) { if (hasChat === false) chatContainer.classList.add('hidden'); else chatContainer.classList.remove('hidden'); }
    // keep last room state for helpers
    window.__lastRoomState = { users, seats, gameStatus, votes };
    renderSeats(maxSeats, users, seats, currentSpeakerId, gameStatus);
    updateUI(users, seats, gameStatus);

  // Ensure local microphone follows server-authoritative state (do NOT emit toggle to server here)
  try {
    const me = users && users[myId];
    if (me && window.lkRoom && window.lkRoom.localParticipant) {
      const desired = !!me.mic;
      const local = !!window.lkRoom.localParticipant.isMicrophoneEnabled;
      if (desired !== local) {
        window.lkRoom.localParticipant.setMicrophoneEnabled(desired).then(() => { updateMicButtonUI(desired); }).catch(e => console.error('Failed to set local mic according to server state', e));
      }
    }
  } catch (e) { /* ignore errors */ }
  });

  appEvents.on('voting-started', ({ timeLeft }) => {
    const statusEl = document.getElementById('game-status-text');
    if (statusEl) statusEl.innerText = '🗳️ Голосование. Выберите игрока за столом.';
    const timerEl = document.getElementById('game-timer-text');
    if (timerEl) timerEl.innerText = `Голосование. Осталось: ${timeLeft}с`;
    if (micBtn) micBtn.disabled = true;
  });

  appEvents.on('day-vote-result', ({ eliminatedPlayerName, tie, winner }) => {
    const statusEl = document.getElementById('game-status-text');
    if (!statusEl) return;
    if (winner) {
      statusEl.innerText = winner === 'mafia' ? '🏁 Победил клан мафии.' : '🏁 Победил клан мирных.';
    } else if (tie || !eliminatedPlayerName) {
      statusEl.innerText = '⚖️ Голоса разделились. Никто не покинул игру.';
    } else {
      statusEl.innerText = `⚖️ Игрок ${eliminatedPlayerName} исключён.`;
    }
  });

  // acknowledge of night action from server (private)
  window.appSocket.socket.on('night-action-ack', ({ actionType, targetId, accepted }) => {
    console.log('night-action-ack', { actionType, targetId, accepted });
    if (accepted) {
      window.myNightTargetId = targetId;
      // immediate visual feedback: add marker to seat if present
      const idx = getSeatIndexByUserId(targetId);
      if (idx !== -1) {
        const targetEl = document.getElementById(`seat-${idx}`);
        if (targetEl) {
          const existing = targetEl.querySelector('.target-marker');
          if (!existing) {
            const m = document.createElement('div'); m.className = 'target-marker'; m.style.position='absolute'; m.style.bottom='-6px'; m.style.left='50%'; m.style.transform='translateX(-50%)'; m.style.fontSize='10px'; m.innerText = '🎯 ВЫ'; targetEl.appendChild(m);
          }
        }
        const targetName = getUserNameById(targetId);
        if (actionType === 'mafia_kill') alert(`Вы стреляли в игрока «${targetName}».`);
        if (actionType === 'doctor_heal') alert(`Вы лечили игрока «${targetName}».`);
      }
    } else {
      nightActionSubmitted = false;
      alert('Действие не принято: этой ночью вы уже действовали или действие недоступно.');
    }
  });

  appEvents.on('chat-message', ({ username, text, time }) => {
    if (!chatMessages) return; const msgEl = document.createElement('div'); msgEl.className = 'chat-msg'; msgEl.innerHTML = `<span class="time">${time}</span><span class="author">${username}</span>${text}`; chatMessages.appendChild(msgEl); chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  appEvents.on('game-started', (data) => {
    if (readyBtn) readyBtn.style.display = 'none';
    const statusEl = document.getElementById('game-status-text');
    if (data && data.role) {
      // personal role notification (private event)
      const role = data.role;
      const playerRoleEl = document.getElementById('player-role'); if (playerRoleEl) playerRoleEl.innerText = `Вы - ${role}`;
      window.myRole = role;
      if (statusEl) statusEl.innerText = `🎮 Игра началась — ваша роль: ${role}. Сейчас ночь.`;
    } else if (data && data.roomStatus) {
      if (statusEl) statusEl.innerText = '🎮 Игра началась! Идет фаза личных высказываний.';
    } else {
      if (statusEl) statusEl.innerText = '🎮 Игра началась!';
    }
  });

  appEvents.on('turn-changed', ({ activePlayerId, timeLeft }) => {
    window.currentActiveSpeakerId = activePlayerId;
    const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `Ход игрока. Осталось: ${timeLeft}с`;

    const isMeActive = (window.appSocket.socket.id === activePlayerId);
    if (isMeActive) { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerHTML = "🎯 <span style='color: #00e676;'>ВАШ ХОД! Вы можете говорить.</span>"; if (micBtn) micBtn.disabled = false; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.hasTurnMicStarted) { window.hasTurnMicStarted = true; window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } }
    else { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = '⏳ Очередь другого игрока.'; if (micBtn) micBtn.disabled = true; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(false).then(() => { updateMicButtonUI(false); appSocket.toggleMedia(false); }).catch(e => console.error(e)); } }
  });

  appEvents.on('timer-tick', ({ timeLeft }) => { const timerEl = document.getElementById('game-timer-text'); if (!timerEl) return; if (timerEl.innerText.includes('Обсуждение')) timerEl.innerText = `💬 Общее обсуждение. Осталось: ${timeLeft}с`; else timerEl.innerText = `⏱ Осталось времени: ${timeLeft}с`; });

  appEvents.on('discussion-started', ({ timeLeft }) => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerHTML = "💬 <span style='color: #00bcd4;'>ФАЗА ОБЩЕГО ОБСУЖДЕНИЯ! Микрофоны доступны.</span>"; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `💬 Общее обсуждение. Осталось: ${timeLeft}с`; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } });

  // Ночь — выключаем микрофоны у всех
  appEvents.on('night-started', ({ timeLeft }) => {
    // reset local night selection
    window.myNightTargetId = null;

    const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerHTML = "🌃 <span style='color: #607d8b;'>Ночь. Все микрофоны выключены.</span>";
    const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `🌃 Ночь. Осталось: ${timeLeft}с`;
    // выключаем локальный микрофон
    if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) {
      window.lkRoom.localParticipant.setMicrophoneEnabled(false).then(() => { updateMicButtonUI(false); appSocket.toggleMedia(false); }).catch(e => console.error(e));
    }
  });

  // Результаты ночи
  appEvents.on('night-result', ({ killedPlayerName, winner }) => {
    const statusEl = document.getElementById('game-status-text');
    if (winner) {
      if (statusEl) statusEl.innerText = winner === 'mafia' ? '🏁 Победил клан мафии.' : '🏁 Победил клан мирных.';
    } else if (killedPlayerName) {
      alert(`Этой ночью был убит: ${killedPlayerName}`);
      if (statusEl) statusEl.innerText = `🔪 Ночь завершена. Погиб: ${killedPlayerName}`;
    } else {
      alert('Прошла спокойная ночь');
      if (statusEl) statusEl.innerText = '🌙 Ночь прошла спокойно.';
    }
  });

  // Результат проверки комиссара (личное сообщение)
  appEvents.on('cop-result', ({ targetName, isMafia }) => {
    alert(`Игрок «${targetName || ''}» из клана ${isMafia ? 'мафии' : 'мирных'}.`);
  });

  appEvents.on('game-ended', () => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = '🏁 Игра окончена. Можете общаться или начать новую.'; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = 'Игра завершена'; if (mySeat !== null && readyBtn) { readyBtn.style.display = 'inline-block'; readyBtn.innerText = 'Готов к игре'; readyBtn.classList.remove('ready-on'); }
    // clear private role after game
    window.myRole = null; const playerRoleEl = document.getElementById('player-role'); if (playerRoleEl) playerRoleEl.innerText = 'Вы - —';
  });

})();
