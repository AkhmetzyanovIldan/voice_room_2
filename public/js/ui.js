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
  let pendingAction = null;

  function addEventFeedItem(message, type = 'info') {
    const feed = document.getElementById('event-feed');
    const list = document.getElementById('event-feed-list');
    if (!feed || !list) return;
    const item = document.createElement('div');
    item.className = `event-feed-item ${type === 'alert' ? 'alert' : type === 'success' ? 'success' : ''}`.trim();
    item.textContent = message;
    list.appendChild(item);
    while (list.children.length > 7) list.removeChild(list.firstChild);
    feed.classList.remove('hidden');
    list.scrollTop = list.scrollHeight;
  }

  function clearPhaseUI() {
    const votingPaper = document.getElementById('voting-paper');
    const eventFeed = document.getElementById('event-feed');
    if (votingPaper) votingPaper.classList.add('hidden');
    if (eventFeed) eventFeed.classList.add('hidden');
    const list = document.getElementById('event-feed-list');
    if (list) list.innerHTML = '';
    const modal = document.getElementById('action-confirm-modal');
    if (modal) modal.classList.add('hidden');
    pendingAction = null;
    hasVotedThisPhase = false;
    nightActionSubmitted = false;
    window.myNightTargetId = null;
  }

  function getChatAllowed() {
    if (!window.__lastRoomState || !myId) return true;
    const me = window.__lastRoomState.users && window.__lastRoomState.users[myId];
    if (!me) return true;
    const gameStatus = window.__lastRoomState.gameStatus;
    if (gameStatus !== 'waiting' && me.seat !== null) return false;
    if (gameStatus === 'waiting') return true;
    return false;
  }

  function renderActionConfirm({ title, message, onConfirm }) {
    const modal = document.getElementById('action-confirm-modal');
    const text = document.getElementById('action-confirm-text');
    const confirmBtn = document.getElementById('action-confirm-yes');
    const cancelBtn = document.getElementById('action-confirm-no');
    if (!modal || !text || !confirmBtn || !cancelBtn) return;
    pendingAction = { onConfirm };
    text.textContent = message || title || 'Вы уверены?';
    modal.classList.remove('hidden');
    confirmBtn.onclick = () => {
      modal.classList.add('hidden');
      if (pendingAction && pendingAction.onConfirm) pendingAction.onConfirm();
      pendingAction = null;
    };
    cancelBtn.onclick = () => {
      modal.classList.add('hidden');
      pendingAction = null;
    };
  }

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

    const signature = JSON.stringify({ maxSeats, seatsData, currentSpeakerId, gameStatus, targetId: window.myNightTargetId });
    if (container.dataset.seatSignature === signature && container.querySelector('.seat-wrap')) return;
    container.dataset.seatSignature = signature;
    container.querySelectorAll('.seat-wrap, .seat').forEach(el => el.remove());

    const totalSeats = maxSeats;
    const leftColumnSeats = Math.ceil(totalSeats / 2);
    const rightColumnSeats = totalSeats - leftColumnSeats;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const statusPanel = document.querySelector('.game-status-panel');
    const controlsPanel = document.querySelector('.controls');
    const room = document.getElementById('room');
    if (room && statusPanel && controlsPanel) {
      const roomTop = room.getBoundingClientRect().top;
      const statusBottom = statusPanel.getBoundingClientRect().bottom - roomTop;
      const controlsTop = controlsPanel.getBoundingClientRect().top - roomTop;
      const layoutHeight = Math.max(230, controlsTop - statusBottom - 24);
      container.style.height = `${layoutHeight}px`;
    }

    const nameHeight = 18;
    const gapBetweenAvatarAndName = 8;
    const gapBetweenPlayers = 10;
    const maxAvatarSize = 58;
    const requiredSeat = gapBetweenAvatarAndName + nameHeight + gapBetweenPlayers;
    const layoutHeight = container.clientHeight || 320;
    const availableHeight = Math.max(0, layoutHeight - 16);
    const minAvatarSize = clamp((availableHeight / 4) - requiredSeat, 26, maxAvatarSize);
    const maxPlayersInColumn = Math.max(4, Math.max(leftColumnSeats, rightColumnSeats));
    const sharedAvatarSize = clamp((availableHeight / maxPlayersInColumn) - requiredSeat, 26, maxAvatarSize);
    const sharedSeatHeight = sharedAvatarSize + requiredSeat;
    const topOffset = Math.max(18, (availableHeight - (Math.max(leftColumnSeats, rightColumnSeats) * sharedSeatHeight)) / 2 + 18);
    const columnWidth = Math.max(72, sharedAvatarSize + 18);

    const leftLayout = { avatarSize: sharedAvatarSize, seatHeight: sharedSeatHeight, topOffset, wrapWidth: columnWidth };
    const rightLayout = { avatarSize: sharedAvatarSize, seatHeight: sharedSeatHeight, topOffset, wrapWidth: columnWidth };

    for (let i = 0; i < totalSeats; i++) {
      const side = i < leftColumnSeats ? 0 : 1;
      const row = side === 0 ? i : i - leftColumnSeats;
      const columnConfig = side === 0 ? leftLayout : rightLayout;
      const wrap = document.createElement('div');
      wrap.className = 'seat-wrap';
      wrap.style.position = 'absolute';
      wrap.style.left = `${side === 0 ? 12 : Math.max(12, container.clientWidth - columnConfig.wrapWidth - 12)}px`;
      wrap.style.top = `${columnConfig.topOffset + row * columnConfig.seatHeight}px`;
      wrap.style.width = `${columnConfig.wrapWidth}px`;
      wrap.style.height = `${columnConfig.seatHeight}px`;
      wrap.style.transform = 'none';

      const seatEl = document.createElement('div');
      seatEl.className = 'seat';
      seatEl.id = `seat-${i}`;
      seatEl.style.top = '0px';
      seatEl.style.left = '0px';
      seatEl.style.width = `${columnConfig.avatarSize}px`;
      seatEl.style.height = `${columnConfig.avatarSize}px`;
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
          seatEl.innerHTML = `<img src="${user.photoUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover; display:block;">`;
        } else {
          seatEl.innerHTML = '';
          seatEl.textContent = '';
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
            renderActionConfirm({
              title: 'Подтверждение действия',
              message: `${actionNames[actionType]} игрока «${targetName}»?`,
              onConfirm: () => {
                nightActionSubmitted = true;
                window.appSocket.socket.emit('night-action', { roomId: currentRoomId, targetId: userIdInSeat, actionType });
              }
            });
          };
        } else {
          // default click: take seat when empty; occupied seats do nothing outside night
          seatEl.onclick = () => { /* no-op for occupied seat */ };
        }

        if (gameStatus === 'day_voting' && window.__lastRoomState && window.__lastRoomState.votes) {
          const myVote = window.__lastRoomState.votes[myId];
          if (myVote === userIdInSeat) {
            seatEl.classList.add('selected-vote');
            if (!seatEl.querySelector('.seat-vote-check')) {
              seatEl.insertAdjacentHTML('beforeend', '<div class="seat-vote-check">✓</div>');
            }
          }
        }

        // show selected night target with a gold check, without extra marker icons
        if (window.myNightTargetId && window.myNightTargetId === userIdInSeat) {
          seatEl.classList.add('selected-target');
          if (!seatEl.querySelector('.seat-target-check')) {
            seatEl.insertAdjacentHTML('beforeend', '<div class="seat-target-check">✓</div>');
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

  function getHiddenMediaHost() {
    let host = document.getElementById('audio-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'audio-host';
      host.setAttribute('aria-hidden', 'true');
      host.style.position = 'fixed';
      host.style.left = '-9999px';
      host.style.top = '-9999px';
      host.style.width = '1px';
      host.style.height = '1px';
      host.style.overflow = 'hidden';
      host.style.opacity = '0';
      host.style.pointerEvents = 'none';
      host.style.display = 'none';
      document.body.appendChild(host);
    }
    return host;
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
          if (listeners.length === 0) listContainer.innerHTML = '<div class="listener-item" style="color:#666;">нет наблюдателей</div>';
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
  function sendChatMessage() {
    const input = chatInput;
    if (!input) return;
    if (!getChatAllowed()) {
      input.value = '';
      return;
    }
    const text = input.value.trim();
    if (text.length > 0) {
      appSocket.sendChatMessage(text);
      input.value = '';
    }
  }

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

  function showRoleCardImage(role) {
      if (!role) return;
      // map role ids to image filenames in public/carts
      const map = {
        mafia: 'mafia_cart.png',
        don: 'don_cart.png',
        doctor: 'doc_cart.png',
        cop: 'cop_cart.png',
        // fallback for roles without specific art
        default: 'civilian_cart.png'
      };
      const file = map[role] || map.default;
      const overlay = document.createElement('div');
      overlay.className = 'role-card-overlay';
      // base styles
      overlay.style.position = 'fixed';
      overlay.style.inset = '0';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0,0,0,0.0)';
      overlay.style.zIndex = '1000';
      overlay.style.transition = 'background 250ms ease';

      const img = document.createElement('img');
      img.src = `/carts/${file}`;
      img.alt = role;
      img.style.maxWidth = '80%';
      img.style.maxHeight = '80%';
      img.style.borderRadius = '12px';
      img.style.boxShadow = '0 12px 30px rgba(0,0,0,0.6)';
      // start from invisible and slightly scaled down
      img.style.opacity = '0';
      img.style.transform = 'scale(0.96) translateY(6px)';
      img.style.transition = 'opacity 220ms ease, transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1)';

      overlay.appendChild(img);
      document.body.appendChild(overlay);

      // allow click to dismiss immediately
      overlay.addEventListener('click', () => {
        try { overlay.remove(); } catch (e) { /* ignore */ }
      });

      // force layout then animate in
      requestAnimationFrame(() => {
        overlay.style.background = 'rgba(0,0,0,0.6)';
        img.style.opacity = '1';
        img.style.transform = 'scale(1) translateY(0)';
      });

      // show for ~3 seconds total
      const visibleDuration = 2700; // ms before starting fade-out
      const totalDuration = 3000; // ms until removed
      setTimeout(() => {
        // animate out: background & image
        overlay.style.background = 'rgba(0,0,0,0)';
        img.style.opacity = '0';
        img.style.transform = 'scale(1.04) translateY(-6px)';
      }, visibleDuration);

      setTimeout(() => { try { overlay.remove(); } catch (e) { /* ignore */ } }, totalDuration);
    }

    function updateRoleCard() {
      if (roleCardValue) roleCardValue.innerText = myRole ? 'Нажмите, чтобы открыть' : 'Скрыто';
    }

  function openRoleCard() {
    // show the same image card when user clicks the role-card button (only visible to owner)
    try { showRoleCardImage(myRole); } catch (e) { console.warn('showRoleCardImage failed', e); }
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
    const chatContainer = document.getElementById('chat-container');
    if (chatContainer) chatContainer.classList.add('hidden');
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

      const mediaHost = getHiddenMediaHost();

      lkRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === 'audio') {
          const element = track.attach();
          element.muted = !isAudioOn;
          element.dataset.participantId = participant.identity;
          element.setAttribute('aria-hidden', 'true');
          element.style.position = 'fixed';
          element.style.left = '-9999px';
          element.style.top = '-9999px';
          element.style.width = '1px';
          element.style.height = '1px';
          element.style.opacity = '0';
          element.style.pointerEvents = 'none';
          element.style.display = 'none';
          mediaHost.appendChild(element);
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
    const chatContainer = document.querySelector('.chat-container');
    if (chatContainer && hasChat === false) chatContainer.classList.add('hidden');
    const myState = users && myId ? users[myId] : null;

    if (gameStatus !== 'day_voting') hasVotedThisPhase = false;
    if (gameStatus === 'day_voting' && votes && Object.prototype.hasOwnProperty.call(votes, myId)) hasVotedThisPhase = true;

    if (chatInput) chatInput.disabled = !getChatAllowed();
    if (chatSendBtn) chatSendBtn.disabled = !getChatAllowed();

    // keep last room state for helpers
    window.__lastRoomState = { users, seats, gameStatus, votes: votes || {}, lastWordPlayerId, doctorSelfHealUsedLastNight };
    renderSeats(maxSeats, users, seats, currentSpeakerId, gameStatus);
    updateUI(users, seats, gameStatus);
    renderVoting(votes || {}, users || {}, seats || {}, gameStatus === 'day_voting');

    if (gameStatus === 'night' && myState && !myState.isAlive) {
      clearPhaseUI();
    }

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
    const votingPaper = document.getElementById('voting-paper');
    if (votingPaper) votingPaper.classList.remove('hidden');
    const eventFeed = document.getElementById('event-feed');
    if (eventFeed) eventFeed.classList.remove('hidden');
    const statusEl = document.getElementById('game-status-text');
    if (statusEl) statusEl.innerText = 'ГОЛОСОВАНИЕ\nВЫБЕРИТЕ ИГРОКА';
    const timerEl = document.getElementById('game-timer-text');
    if (timerEl) timerEl.innerText = `Осталось: ${timeLeft}с`;
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
      statusEl.innerText = winner === 'mafia' ? 'ИГРА ЗАВЕРШЕНА\nМАФИЯ ПОБЕДИЛА' : 'ИГРА ЗАВЕРШЕНА\nМИРНЫЕ ПОБЕДИЛИ';
      addEventFeedItem(winner === 'mafia' ? 'Игра завершена. Победила мафия.' : 'Игра завершена. Победили мирные.', 'alert');
    } else if (tie || !eliminatedPlayerName) {
      statusEl.innerText = 'ГОЛОСА РАЗДЕЛИЛИСЬ\nНИКТО НЕ ВЫБЫЛ';
      addEventFeedItem('Голоса разделились. Никто не покинул игру.', 'info');
    } else {
      statusEl.innerText = `ИСКЛЮЧЁН\n${eliminatedPlayerName}`;
      addEventFeedItem(`Игрок ${eliminatedPlayerName} исключён.`, 'alert');
    }
    setTimeout(() => clearPhaseUI(), 1800);
  });

  // acknowledge of night action from server (private)
  window.appSocket.socket.on('night-action-ack', ({ actionType, targetId, accepted }) => {
    console.log('night-action-ack', { actionType, targetId, accepted });
    if (accepted) {
      window.myNightTargetId = targetId;
      const idx = getSeatIndexByUserId(targetId);
      if (idx !== -1) {
        const targetEl = document.getElementById(`seat-${idx}`);
        if (targetEl) {
          targetEl.classList.add('selected-target');
          if (!targetEl.querySelector('.seat-target-check')) {
            targetEl.insertAdjacentHTML('beforeend', '<div class="seat-target-check">✓</div>');
          }
        }
      }
      const targetName = getUserNameById(targetId);
      const actionLabels = {
        mafia_kill: `Вы выбрали игрока «${targetName}»`,
        doctor_heal: `Вы выбрали игрока «${targetName}»`,
        cop_check: `Вы проверили игрока «${targetName}»`
      };
      addEventFeedItem(actionLabels[actionType] || 'Действие подтверждено.', 'success');
    } else {
      nightActionSubmitted = false;
      addEventFeedItem('Действие не принято: вы уже действовали или цель недоступна.', 'alert');
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
      // Show role image card for 2 seconds immediately after role distribution
      try { showRoleCardImage(role); } catch (e) { console.warn('showRoleCardImage failed', e); }
      if (statusEl) statusEl.innerText = `НОЧЬ 1\nНОЧНЫЕ ДЕЙСТВИЯ`;
    } else if (data && data.roomStatus) {
      if (statusEl) statusEl.innerText = 'НОЧЬ 1\nНОЧНЫЕ ДЕЙСТВИЯ';
    } else {
      if (statusEl) statusEl.innerText = 'ИГРА НАЧАЛАСЬ';
    }
  });

  appEvents.on('turn-changed', ({ activePlayerId, timeLeft }) => {
    window.currentActiveSpeakerId = activePlayerId;
    const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `Осталось: ${timeLeft}с`;

    const isMeActive = (window.appSocket.socket.id === activePlayerId);
    if (isMeActive) { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = 'ВАШ ХОД\nГОВОРИТЕ'; if (micBtn) micBtn.disabled = false; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.hasTurnMicStarted) { window.hasTurnMicStarted = true; window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } }
    else { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = 'ХОД ДРУГОГО ИГРОКА'; if (micBtn) micBtn.disabled = true; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(false).then(() => { updateMicButtonUI(false); appSocket.toggleMedia(false); }).catch(e => console.error(e)); } }
  });

  appEvents.on('timer-tick', ({ timeLeft }) => { const timerEl = document.getElementById('game-timer-text'); if (!timerEl) return; if (timerEl.innerText.includes('Обсуждение')) timerEl.innerText = `💬 Общее обсуждение. Осталось: ${timeLeft}с`; else timerEl.innerText = `⏱ Осталось времени: ${timeLeft}с`; });

  appEvents.on('discussion-started', ({ timeLeft }) => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = 'ДЕНЬ 1\nОБЩЕЕ ОБСУЖДЕНИЕ'; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `Осталось: ${timeLeft}с`; if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && !window.lkRoom.localParticipant.isMicrophoneEnabled) { window.lkRoom.localParticipant.setMicrophoneEnabled(true).then(() => { updateMicButtonUI(true); appSocket.toggleMedia(true); }).catch(e => console.error(e)); } });

  appEvents.on('last-word-started', ({ playerId, playerName, timeLeft }) => {
    const isSpeaker = window.appSocket.socket.id === playerId;
    const statusEl = document.getElementById('game-status-text');
    const timerEl = document.getElementById('game-timer-text');
    if (statusEl) statusEl.innerText = isSpeaker ? 'ПОСЛЕДНЕЕ СЛОВО\nВАШ ХОД' : `ПОСЛЕДНЕЕ СЛОВО\n${playerName}`;
    if (timerEl) timerEl.innerText = `Осталось: ${timeLeft}с`;
    if (micBtn) micBtn.disabled = !isSpeaker;
  });

  // Ночь — выключаем микрофоны у всех
  appEvents.on('night-started', ({ timeLeft }) => {
    // reset local night selection
    window.myNightTargetId = null;

    const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = 'НОЧЬ 1\nНОЧНЫЕ ДЕЙСТВИЯ';
    const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = `Осталось: ${timeLeft}с`;
    // выключаем локальный микрофон
    if (mySeat !== null && window.lkRoom && window.lkRoom.localParticipant && window.lkRoom.localParticipant.isMicrophoneEnabled) {
      window.lkRoom.localParticipant.setMicrophoneEnabled(false).then(() => { updateMicButtonUI(false); appSocket.toggleMedia(false); }).catch(e => console.error(e));
    }
  });

  // Результаты ночи
  appEvents.on('night-result', ({ killedPlayerName, winner }) => {
    const statusEl = document.getElementById('game-status-text');
    if (winner) {
      if (statusEl) statusEl.innerText = winner === 'mafia' ? 'ИГРА ЗАВЕРШЕНА\nМАФИЯ ПОБЕДИЛА' : 'ИГРА ЗАВЕРШЕНА\nМИРНЫЕ ПОБЕДИЛИ';
      addEventFeedItem(winner === 'mafia' ? 'Игра завершена. Победила мафия.' : 'Игра завершена. Победили мирные.', 'alert');
    } else if (killedPlayerName) {
      if (statusEl) statusEl.innerText = `НОЧЬ ЗАВЕРШЕНА\nПОГИБ ${killedPlayerName}`;
      addEventFeedItem(`Ночь завершена. Погиб: ${killedPlayerName}`, 'alert');
    } else {
      if (statusEl) statusEl.innerText = 'НОЧЬ ПРОШЛА СПОКОЙНО';
      addEventFeedItem('Ночь прошла спокойно.', 'success');
    }
    setTimeout(() => clearPhaseUI(), 2200);
  });

  // Результат проверки комиссара (личное сообщение)
  appEvents.on('cop-result', ({ targetName, isMafia }) => {
    addEventFeedItem(`Игрок «${targetName || ''}» из клана ${isMafia ? 'мафии' : 'мирных'}.`, 'success');
  });

  appEvents.on('game-ended', () => { const statusEl = document.getElementById('game-status-text'); if (statusEl) statusEl.innerText = 'ИГРА ЗАВЕРШЕНА\nМОЖНО ОБЩАТЬСЯ'; const timerEl = document.getElementById('game-timer-text'); if (timerEl) timerEl.innerText = 'Конец игры'; if (mySeat !== null && readyBtn) { readyBtn.style.display = 'inline-block'; readyBtn.innerText = 'Готов к игре'; readyBtn.classList.remove('ready-on'); }
    clearPhaseUI();
    // clear private role after game
    window.myRole = null; myRole = null; updateRoleCard(); const playerRoleEl = document.getElementById('player-role'); if (playerRoleEl) playerRoleEl.innerText = 'Вы - —';
  });

})();
