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
  const createBtn = $('#create-room-btn');
  const joinRoomBtn = $('#join-room-btn');
  const modalOverlay = $('#modal-overlay');
  const createRoomModal = $('#create-room-modal');
  const joinRoomModal = $('#join-room-modal');
  const createUsernameInput = $('#create-username-input');
  const joinUsernameInput = $('#join-username-input');
  const joinRoomCodeInput = $('#join-room-code-input');

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
  const chatToggleBtn = $('#chat-toggle-btn');
  const chatCloseBtn = $('#chat-close-btn');
  const roomMenuBtn = $('#room-menu-btn');
  const roomMenuModal = $('#room-menu-modal');
  const menuCloseBtn = $('#menu-close-btn');
  const menuLeaveBtn = $('#menu-leave-btn');
  const roleCardBtn = $('#role-card-btn');
  const roleCardValue = $('#role-card-value');
  const roleModal = $('#role-modal');
  const roleModalValue = $('#role-modal-value');
  const roleCloseBtn = $('#role-close-btn');

  let currentRoomId = null;
  let myId = null;
  let mySeat = null;
  let isAudioOn = true;
  let nightActionSubmitted = false;
  let hasVotedThisPhase = false;
  let myRole = null;

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
    const preferredName = (createUsernameInput && createUsernameInput.value.trim()) ||
      (joinUsernameInput && joinUsernameInput.value.trim()) ||
      telegramProfile.username ||
      'Игрок';
    return {
      username: preferredName,
      photoUrl: telegramProfile.photoUrl
    };
  }

  function syncProfileInputs() {
    const telegramProfile = getTelegramProfile();
    const defaultName = telegramProfile.username || 'Игрок';
    if (createUsernameInput && !createUsernameInput.value.trim()) createUsernameInput.value = defaultName;
    if (joinUsernameInput && !joinUsernameInput.value.trim()) joinUsernameInput.value = defaultName;
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

  syncProfileInputs();

  // Helpers from former app.js
  function showError(msg) { const el = document.getElementById('error-box'); if (el) el.innerText = msg || ''; }

  function renderSeats(maxSeats, users, seatsData, currentSpeakerId, gameStatus) {
    const container = document.getElementById('table-container');
    if (!container) return;
    container.querySelectorAll('.seat-wrap, .seat').forEach(el => el.remove());

    const totalSeats = maxSeats;
    const leftColumnSeats = Math.ceil(totalSeats / 2);
    const rows = leftColumnSeats;
    const seatSize = 58;
    const rowGap = 12;
    const layoutHeight = rows * (seatSize + 18) + (rows - 1) * rowGap;
    const startY = Math.max(0, (container.clientHeight - layoutHeight) / 2);

    for (let i = 0; i < totalSeats; i++) {
      const side = i < leftColumnSeats ? 0 : 1;
      const row = side === 0 ? i : i - leftColumnSeats;
      const wrap = document.createElement('div');
      wrap.className = 'seat-wrap';
      wrap.style.left = `${side === 0 ? 4 : container.clientWidth - 76}px`;
      wrap.style.top = `${startY + row * (seatSize + 18 + rowGap)}px`;

      const seatEl = document.createElement('div');
      seatEl.className = 'seat';
      seatEl.id = `seat-${i}`;
      seatEl.style.top = '0px';
      const numberEl = document.createElement('div');
      numberEl.className = 'seat-number';
      numberEl.textContent = String(i + 1);
      wrap.appendChild(numberEl);

      const isBlockedSeat = i >= maxSeats;
      const userIdInSeat = isBlockedSeat ? null : seatsData[i];
      if (isBlockedSeat) {
        seatEl.classList.add('blocked-seat');
        seatEl.innerText = '✕';
        seatEl.title = 'Место недоступно';
        seatEl.onclick = () => {};
        wrap.appendChild(seatEl); container.appendChild(wrap);
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

        if (gameStatus === 'waiting' && userIdInSeat === myId && user && user.isReady) {
          seatEl.innerHTML += '<div class="seat-vote-check seat-ready-check">✓</div>';
        }
        if (gameStatus !== 'waiting' && user && user.isAlive === false) {
          seatEl.innerHTML += '<div class="seat-dead-cross">×</div>';
        }

        // If it's night and current user can act and is alive, clicking a seat is a night action
        const me = users && users[myId];
        const myRole = window.myRole; // private role stored from personal 'game-started' event
        if (gameStatus === 'day_voting' && me && me.isAlive) {
          seatEl.style.cursor = 'pointer';
          seatEl.onclick = () => {
            if (hasVotedThisPhase) return;
            if (userIdInSeat !== myId && user && user.isAlive !== false) {
              appSocket.dayVote(userIdInSeat);
            }
          };
        } else if (gameStatus === 'night' && me && me.isAlive && myRole && ['mafia','doctor','cop'].includes(myRole)) {
          // clicking targets another player
          seatEl.style.cursor = 'pointer';
          seatEl.onclick = () => {
            if (userIdInSeat === myId && myRole !== 'doctor') { console.log('night-action: cannot target self'); return; }
            if (userIdInSeat === myId && window.__lastRoomState && window.__lastRoomState.doctorSelfHealUsedLastNight) {
              console.log('night-action: doctor self-heal is available every other night');
              return;
            }
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

        if (gameStatus === 'day_voting' && window.__lastRoomState && window.__lastRoomState.votes) {
          const myVote = window.__lastRoomState.votes[myId];
          if (myVote === userIdInSeat) {
            seatEl.classList.add('selected-vote');
            seatEl.insertAdjacentHTML('beforeend', '<div class="seat-vote-check">✓</div>');
          }
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

      const nameEl = document.createElement('div');
      nameEl.className = 'seat-name';
      nameEl.textContent = userIdInSeat && users[userIdInSeat] ? users[userIdInSeat].username : '';
      wrap.appendChild(seatEl);
      wrap.appendChild(nameEl);
      container.appendChild(wrap);
    }
  }

  function updateUI(users, seats, gameStatus) {
    const allUsers = Object.values(users || {});
    usersCount && (usersCount.innerText = `${allUsers.length} участников`);

    const seatedUserIds = Object.values(seats || {});
    const listeners = allUsers.filter(u => !seatedUserIds.includes(u.id));
    const listenersCount = document.getElementById('listeners-count-label');
    if (listenersCount) listenersCount.innerText = String(listeners.length);

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
          } else if (gameStatus === 'last_words') {
            if (micBtn) micBtn.disabled = (window.__lastRoomState && window.__lastRoomState.lastWordPlayerId !== myId);
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
  function handleSeatAction() {
    if (mySeat !== null) appSocket.leaveSeat();
    else {
      const state = window.__lastRoomState;
      const seats = state && state.seats ? state.seats : [];
      const freeSeat = Object.keys(seats).find(index => seats[index] === null);
      if (freeSeat !== undefined) appSocket.takeSeat(Number(freeSeat));
    }
    closeRoomMenu();
  }
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

  function leaveRoom() {
    if (window.lkRoom) { window.lkRoom.disconnect(); window.lkRoom = null; }
    if (window.appSocket.socket.connected) {
      window.appSocket.socket.disconnect();
      window.appSocket.socket.connect();
    }
    if (roomSection) roomSection.classList.add('hidden');
    if (lobby) lobby.classList.remove('hidden');
    currentRoomId = null; myId = null; mySeat = null; hasVotedThisPhase = false;
    closeRoomMenu();
  }

  function closeRoomMenu() { if (roomMenuModal) roomMenuModal.classList.add('hidden'); }
  function toggleRoomMenu() { if (roomMenuModal) roomMenuModal.classList.toggle('hidden'); }
  function toggleChatDrawer(force) {
    const chat = document.getElementById('chat-container');
    if (!chat) return;
    chat.classList.toggle('hidden', typeof force === 'boolean' ? !force : !chat.classList.contains('hidden'));
  }

  function updateRoleCard() {
    if (roleCardValue) roleCardValue.innerText = myRole ? 'Нажмите, чтобы открыть' : 'Скрыто';
  }

  function openRoleCard() {
    if (roleModalValue) roleModalValue.innerText = myRole || 'Роль ещё не назначена';
    if (roleModal) roleModal.classList.remove('hidden');
  }

  function openModal(modal) {
    showError('');
    if (modalOverlay) modalOverlay.classList.remove('hidden');
    if (createRoomModal) createRoomModal.classList.toggle('hidden', modal !== createRoomModal);
    if (joinRoomModal) joinRoomModal.classList.toggle('hidden', modal !== joinRoomModal);
    syncProfileInputs();
  }

  function closeModal() {
    if (modalOverlay) modalOverlay.classList.add('hidden');
    if (createRoomModal) createRoomModal.classList.add('hidden');
    if (joinRoomModal) joinRoomModal.classList.add('hidden');
  }

  window.openSettingsModal = function () {
    openModal(createRoomModal);
  };

  window.openJoinRoomModal = function () {
    openModal(joinRoomModal);
  };

  window.closeModal = closeModal;

  window.confirmCreateRoom = function () {
    const profile = getCurrentProfile();
    const username = profile.username.trim();
    const photoUrl = profile.photoUrl;
    const maxSeats = document.getElementById('input-max-seats') && document.getElementById('input-max-seats').value;
    const hasChat = document.getElementById('input-has-chat') && document.getElementById('input-has-chat').checked;
    const enabledRoles = getEnabledRoles();
    if (!username) {
      showError('Введите ваше имя');
      return;
    }
    closeModal();
    appSocket.createRoom({ roomName: 'Комната', username, photoUrl, maxSeats, hasChat, enabledRoles });
  };

  window.confirmJoinRoom = function () {
    const roomId = (joinRoomCodeInput && joinRoomCodeInput.value.trim()) || '';
    const username = (joinUsernameInput && joinUsernameInput.value.trim()) || getCurrentProfile().username;
    if (!roomId) {
      showError('Введите код комнаты');
      return;
    }
    if (!username) {
      showError('Введите ваше имя');
      return;
    }
    closeModal();
    appSocket.joinRoom(roomId, username, getCurrentProfile().photoUrl);
  };

  // make UI actions available globally too
  window.toggleReady = toggleReady;
  window.toggleMic = toggleMic;
  window.toggleAudio = toggleAudio;
  window.handleSeatAction = handleSeatAction;
  window.toggleListenersPanel = function () { const panel = document.getElementById('listeners-panel'); if (!panel) return; panel.classList.toggle('hidden'); const btn = document.getElementById('listeners-toggle-btn'); if (btn) btn.classList.toggle('active'); };
  window.leaveRoom = leaveRoom;

  // attach UI controls
  if (createBtn) createBtn.onclick = () => openModal(createRoomModal);
  if (joinRoomBtn) joinRoomBtn.onclick = () => openModal(joinRoomModal);
  if (joinBtn) joinBtn.onclick = () => window.confirmJoinRoom();
  if (chatSendBtn) chatSendBtn.onclick = sendChatMessage;
  if (readyBtn) readyBtn.onclick = toggleReady;
  if (micBtn) micBtn.onclick = toggleMic;
  if (audioBtn) audioBtn.onclick = toggleAudio;
  if (seatActionBtn) seatActionBtn.onclick = handleSeatAction;
  if (listenersToggleBtn) listenersToggleBtn.onclick = () => { const panel = document.getElementById('listeners-panel'); if (!panel) return; panel.classList.toggle('hidden'); listenersToggleBtn.classList.toggle('active'); };
  if (roomMenuBtn) roomMenuBtn.onclick = toggleRoomMenu;
  if (menuCloseBtn) menuCloseBtn.onclick = closeRoomMenu;
  if (menuLeaveBtn) menuLeaveBtn.onclick = leaveRoom;
  if (roleCardBtn) roleCardBtn.onclick = openRoleCard;
  if (roleCloseBtn) roleCloseBtn.onclick = () => roleModal && roleModal.classList.add('hidden');
  if (seatActionBtn) seatActionBtn.onclick = handleSeatAction;
  if (chatToggleBtn) chatToggleBtn.onclick = () => toggleChatDrawer();
  if (chatCloseBtn) chatCloseBtn.onclick = () => toggleChatDrawer(false);

  // Wire appEvents to UI updates
  appEvents.on('room-joined', ({ roomId, roomName }) => {
    currentRoomId = roomId;
    myId = window.appSocket.socket.id;
    closeModal();
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

  appEvents.on('update-room', ({ roomName, maxSeats, hasChat, users, seats, gameStatus, currentSpeakerId, votes, lastWordPlayerId, doctorSelfHealUsedLastNight }) => {
    if (roomTitleDisplay) roomTitleDisplay.innerText = roomName;
    const chatContainer = document.querySelector('.chat-container'); if (chatContainer && hasChat === false) chatContainer.classList.add('hidden');
    // keep last room state for helpers
    window.__lastRoomState = { users, seats, gameStatus, votes: votes || {}, lastWordPlayerId, doctorSelfHealUsedLastNight };
    if (gameStatus !== 'day_voting') hasVotedThisPhase = false;
    if (gameStatus === 'day_voting' && votes && Object.prototype.hasOwnProperty.call(votes, myId)) hasVotedThisPhase = true;
    renderSeats(maxSeats, users, seats, currentSpeakerId, gameStatus);
    updateUI(users, seats, gameStatus);
    renderVoting(votes || {}, users || {}, seats || {}, gameStatus === 'day_voting');

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
    hasVotedThisPhase = false;
    document.getElementById('voting-paper')?.classList.remove('hidden');
    const statusEl = document.getElementById('game-status-text');
    if (statusEl) statusEl.innerText = '🗳️ Голосование. Выберите игрока за столом.';
    const timerEl = document.getElementById('game-timer-text');
    if (timerEl) timerEl.innerText = `Голосование. Осталось: ${timeLeft}с`;
    if (micBtn) micBtn.disabled = true;
  });

  function renderVoting(votes, users, seats, active) {
    const paper = document.getElementById('voting-paper');
    const list = document.getElementById('vote-results-list');
    if (!paper || !list) return;
    paper.classList.toggle('hidden', !active);
    if (!active) return;
    const groups = {};
    Object.entries(votes).forEach(([voterId, targetId]) => {
      const targetSeat = users[targetId] && users[targetId].seat;
      const voterSeat = users[voterId] && users[voterId].seat;
      if (targetSeat === null || targetSeat === undefined || voterSeat === null || voterSeat === undefined) return;
      (groups[targetSeat] ||= []).push(voterSeat + 1);
    });
    list.innerHTML = Object.keys(groups).sort((a,b) => Number(a)-Number(b)).map(target => `<div class="vote-row"><span class="vote-target ${users[myId] && users[myId].seat === Number(target) ? 'mine' : ''}">${Number(target) + 1}</span><b>←</b>${groups[target].sort((a,b)=>a-b).map(v => `<span class="vote-voter ${users[myId] && users[myId].seat === v - 1 ? 'mine' : ''}">${v}</span>`).join('')}</div>`).join('') || '<em>голосов пока нет</em>';
  }

  appEvents.on('day-vote-ack', ({ accepted, reason }) => {
    if (accepted) hasVotedThisPhase = true;
    else if (reason === 'already-voted') hasVotedThisPhase = true;
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
      myRole = role;
      updateRoleCard();
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

  appEvents.on('last-word-started', ({ playerId, playerName, timeLeft }) => {
    const isSpeaker = window.appSocket.socket.id === playerId;
    const statusEl = document.getElementById('game-status-text');
    const timerEl = document.getElementById('game-timer-text');
    if (statusEl) statusEl.innerText = isSpeaker ? '🗣️ Ваше последнее слово.' : `🗣️ Последнее слово игрока «${playerName}».`;
    if (timerEl) timerEl.innerText = `Последнее слово. Осталось: ${timeLeft}с`;
    if (micBtn) micBtn.disabled = !isSpeaker;
  });

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
    window.myRole = null; myRole = null; updateRoleCard(); const playerRoleEl = document.getElementById('player-role'); if (playerRoleEl) playerRoleEl.innerText = 'Вы - —';
  });

})();
