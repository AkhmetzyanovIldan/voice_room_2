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

  // Helpers from former app.js
  function showError(msg) { const el = document.getElementById('error-box'); if (el) el.innerText = msg || ''; }

  function renderSeats(maxSeats, users, seatsData, currentSpeakerId) {
    const container = document.getElementById('table-container');
    if (!container) return;
    container.querySelectorAll('.seat').forEach(el => el.remove());

    const radius = 95;
    const centerX = 130;
    const centerY = 130;

    for (let i = 0; i < maxSeats; i++) {
      const angle = (i * 2 * Math.PI) / maxSeats - Math.PI / 2;
      const x = centerX + radius * Math.cos(angle) - 20;
      const y = centerY + radius * Math.sin(angle) - 20;

      const seatEl = document.createElement('div');
      seatEl.className = 'seat';
      seatEl.id = `seat-${i}`;
      seatEl.style.left = `${x}px`;
      seatEl.style.top = `${y}px`;
      seatEl.onclick = () => takeSeat(i);

      const userIdInSeat = seatsData[i];
      if (userIdInSeat) {
        const user = users[userIdInSeat];
        seatEl.classList.add('occupied');

        if (userIdInSeat === currentSpeakerId) seatEl.classList.add('active-speaker');

        if (user && user.photoUrl) {
          seatEl.innerHTML = `<img src="${user.photoUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        } else {
          seatEl.innerHTML = `<div style="overflow:hidden; text-overflow:ellipsis; width:100%; font-size:11px;"><b>${user ? user.username[0] : ''}</b></div>`;
        }

        if (user && !user.mic) seatEl.innerHTML += `<div style="position:absolute; bottom:0; right:0; font-size:10px;">🔇</div>`;
        if (user && user.isReady) seatEl.innerHTML += `<div style="position:absolute; top:0; right:0; font-size:10px; background:rgba(0,255,0,0.7); border-radius:50%; width:12px; height:12px; text-align:center; line-height:12px;">✓</div>`;
      } else {
        seatEl.classList.remove('occupied');
        seatEl.innerText = '+';
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

      if (mySeat !== null) {
        const roleLabel = document.getElementById('role-label'); if (roleLabel) roleLabel.innerText = 'Режим: Спикер (за столом)';
        if (seatActionBtn) seatActionBtn.innerText = '🪑 Встать';

        if (gameStatus === 'waiting') { if (readyBtn) readyBtn.style.display = 'inline-block'; if (micBtn) micBtn.disabled = false; }
        else { if (readyBtn) readyBtn.style.display = 'none'; if (gameStatus === 'playing') { if (micBtn) micBtn.disabled = (window.appSocket.socket.id !== window.currentActiveSpeakerId); } else if (gameStatus === 'discussion') { if (micBtn) micBtn.disabled = false; } }
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
    const username = document.getElementById('username-input') && document.getElementById('username-input').value.trim() || 'Игрок';
    const photoUrl = '';
    const maxSeats = document.getElementById('input-max-seats') && document.getElementById('input-max-seats').value;
    const hasChat = document.getElementById('input-has-chat') && document.getElementById('input-has-chat').checked;
    const overlay = document.getElementById('modal-overlay'); if (overlay) overlay.classList.add('hidden');
    appSocket.createRoom({ roomName, username, photoUrl, maxSeats, hasChat });
  };

  // make UI actions available globally too
  window.toggleReady = toggleReady;
  window.toggleMic = toggleMic;
  window.toggleAudio = toggleAudio;
  window.handleSeatAction = handleSeatAction;
  window.toggleListenersPanel = function () { const panel = document.getElementById('listeners-panel'); if (!panel) return; panel.classList.toggle('hidden'); const btn = document.getElementById('listeners-toggle-btn'); if (btn) btn.classList.toggle('active'); };
  window.leaveRoom = leaveRoom;

  // attach UI controls
  if (joinBtn) joinBtn.onclick = () => { const roomId = roomCodeInput.value.trim(); const username = usernameInput.value.trim() || 'Игрок'; if (!roomId) return showError('Введите код комнаты'); const photoUrl = ''; appSocket.joinRoom(roomId, username, photoUrl); };
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
    const username = usernameInput && usernameInput.value.trim() || 'Игрок';
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

  appEvents.on('update-room', ({ roomName, maxSeats, hasChat, users, seats, gameStatus, currentSpeakerId }) => {
    if (roomTitleDisplay) roomTitleDisplay.innerText = roomName;
    const chatContainer = document.querySelector('.chat-container'); if (chatContainer) { if (hasChat === false) chatContainer.classList.add('hidden'); else chatContainer.classList.remove('hidden'); }
    renderSeats(maxSeats, users, seats, currentSpeakerId);
    updateUI(users, seats, gameStatus);
  });

  appEvents.on('chat-message', ({ username, text, time }) => {
    if (!chatMessages) return; const msgEl = document.createElement('div'); msgEl.className = 'chat-msg'; msgEl.innerHTML = `<span class="time">${time}</span><span class="author">${username}</span>${text}`; chatMessages.appendChild(msgEl); chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  appEvents.on('game-started', ({ roomStatus }) => { if (readyBtn) readyBtn.style.display = 'none'; const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = '🎮 Игра началась! Идет фаза личных высказываний.'; });

  appEvents.on('turn-changed', ({ activePlayerId, timeLeft }) => {
    window.currentActiveSpeakerId = activePlayerId;
    const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `Ход игрока. Осталось: ${timeLeft}с`;

    const isMeActive = (window.appSocket.socket.id === activePlayerId);
    if (isMeActive) { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerHTML = "🎯 <span style='color: #00e676;'>ВАШ ХОД! Вы можете говорить.</span>"; if (micBtn) micBtn.disabled = false; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.hasTurnMicStarted) { window.hasTurnMicStarted = true; window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } }
    else { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = '⏳ Очередь другого игрока.'; if (micBtn) micBtn.disabled = true; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(false).then(() => { updateMicButtonUI(false); appSocket.toggleMedia(false); }).catch(e => console.error(e)); } }
  });

  appEvents.on('timer-tick', ({ timeLeft }) => { const timerEl = document.getElementById('game-timer-text'); if (!timerEl) return; if (timerEl.innerText.includes('Обсуждение')) timerEl.innerText = `💬 Общее обсуждение. Осталось: ${timeLeft}с`; else timerEl.innerText = `⏱ Осталось времени: ${timeLeft}с`; });

  appEvents.on('discussion-started', ({ timeLeft }) => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerHTML = "💬 <span style='color: #00bcd4;'>ФАЗА ОБЩЕГО ОБСУЖДЕНИЯ! Микрофоны доступны.</span>"; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `💬 Общее обсуждение. Осталось: ${timeLeft}с`; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } });

  appEvents.on('game-ended', () => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = '🏁 Игра окончена. Можете общаться или начать новую.'; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = 'Игра завершена'; if (mySeat !== null && readyBtn) { readyBtn.style.display = 'inline-block'; readyBtn.innerText = 'Готов к игре'; readyBtn.classList.remove('ready-on'); } });

})();
