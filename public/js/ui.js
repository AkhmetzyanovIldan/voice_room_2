(() => {
  const $ = (id) => document.getElementById(id),
    events = window.appEvents,
    api = window.appSocket;
  const roles = new Map((window.mafiaRoles || []).map((r) => [r.id, r]));
  roles.set('civilian', { id: 'civilian', name: 'Мирный', clan: 'peaceful' });
  const actionNames = {
    mafia_kill: 'Выстрел клана',
    doctor_heal: 'Лечение',
    cop_check: 'Проверка клана',
    don_check: 'Поиск комиссара',
    lawyer_check: 'Узнать профессию',
    sergeant_kill: 'Одноразовый выстрел',
    journalist_check: 'Проверить пару',
    mistress_charm: 'Очаровать',
  };
  let state = null,
    mine = null,
    roomId = null,
    privateState = {},
    action = null,
    selected = [],
    pending = false,
    sound = true,
    mediaPending = false,
    microphoneVersion = 0,
    replaced = false;
  let noticeTimer;
  let mediaChannel,
    mediaEnabled = true;
  let shownFinal = '';
  const shownPhases = new Set();
  const shownChecks = new Set();
  const notice = document.createElement('div');
  notice.id = 'app-notice';
  notice.setAttribute('role', 'alert');
  notice.hidden = true;
  document.body.append(notice);
  const connection = document.createElement('div');
  connection.id = 'connection-status';
  connection.setAttribute('role', 'status');
  document.body.append(connection);
  const actions = document.createElement('div');
  actions.id = 'night-actions';
  $('ready-btn-game').before(actions);
  const skip = document.createElement('button');
  skip.textContent = 'Пропустить';
  skip.className = 'menu-action';
  $('voting-paper').append(skip);
  const stage = document.createElement('div');
  stage.className = 'table-stage';
  $('table-container').before(stage);
  stage.append($('table-container'), $('event-feed'));
  $('event-feed').append($('voting-paper'));
  const retry = document.createElement('button');
  retry.textContent = 'Подключить звук';
  retry.className = 'audio-retry menu-action';
  retry.hidden = true;
  $('game-status-text').after(retry);
  const roleName = (id) => roles.get(id)?.name || id || '—';
  const me = () =>
    state?.users[mine] && {
      ...state.users[mine],
      ...(state.gameStatus === 'night'
        ? { canSpeak: privateState.canSpeak, mic: privateState.mic }
        : {}),
    };
  const connected = () => api.socket.connected && !replaced;
  function error(message) {
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      notice.hidden = true;
    }, 7000);
  }
  function send(name, data) {
    if (!connected()) {
      error('Нет соединения. Дождитесь восстановления.');
      return false;
    }
    api.emit(name, data);
    return true;
  }
  function line(text, type = 'info') {
    const feed = $('event-feed');
    const follow = feed.scrollHeight - feed.clientHeight - feed.scrollTop < 45;
    const item = document.createElement('div');
    item.className = `event-feed-item ${type}`;
    item.textContent = text;
    $('event-feed-list').append(item);
    while ($('event-feed-list').children.length > 200) $('event-feed-list').firstChild.remove();
    $('event-feed').classList.remove('hidden');
    if (follow) feed.scrollTop = feed.scrollHeight;
  }
  function phaseLine(phase, round) {
    const key = `${phase}:${round}`;
    if (shownPhases.has(key)) return;
    shownPhases.add(key);
    line(`${phase === 'night' ? 'Ночь' : 'День'} ${round}`, 'phase');
  }
  function clearSelection() {
    action = null;
    selected = [];
    pending = false;
    $('action-confirm-modal').classList.add('hidden');
  }
  function clearRoom() {
    state = null;
    roomId = null;
    privateState = {};
    shownChecks.clear();
    shownPhases.clear();
    shownFinal = '';
    mediaChannel = undefined;
    clearSelection();
    $('event-feed-list').replaceChildren();
    $('chat-messages').replaceChildren();
    $('event-feed').classList.add('hidden');
    $('chat-container').classList.add('hidden');
    $('room-menu-modal').classList.add('hidden');
    $('role-modal').classList.add('hidden');
    document.querySelectorAll('.role-card-overlay').forEach((el) => el.remove());
    $('table-container').replaceChildren();
    $('room').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    actions.replaceChildren();
    mediaPending = false;
    window.gameAudio.disconnect();
  }
  function closeModal() {
    $('modal-overlay').classList.add('hidden');
    $('create-room-modal').classList.add('hidden');
    $('join-room-modal').classList.add('hidden');
  }
  function openModal(id) {
    notice.hidden = true;
    $('modal-overlay').classList.remove('hidden');
    $('create-room-modal').classList.toggle('hidden', id !== 'create-room-modal');
    $('join-room-modal').classList.toggle('hidden', id !== 'join-room-modal');
    $(id).querySelector('input')?.focus();
  }
  const tg = window.Telegram?.WebApp;
  try {
    tg?.ready();
    tg?.expand();
  } catch {}
  const user = tg?.initDataUnsafe?.user;
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Игрок';
  $('create-username-input').value = name;
  $('join-username-input').value = name;
  for (const role of roles.values()) {
    if (role.id === 'civilian') continue;
    const label = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'checkbox';
    input.name = 'enabled-role';
    input.value = role.id;
    input.checked = role.enabledByDefault;
    label.append(input, document.createTextNode(role.name));
    $(`${role.clan === 'mafia' ? 'mafia' : 'peaceful'}-roles`).append(label);
  }
  window.confirmCreateRoom = () => {
    const enabledRoles = [...document.querySelectorAll('input[name="enabled-role"]:checked')].map(
      (el) => el.value
    );
    send('create-room', {
      username: $('create-username-input').value,
      photoUrl: user?.photo_url || '',
      maxSeats: Number($('input-max-seats').value),
      hasChat: $('input-has-chat').checked,
      enabledRoles,
    });
  };
  window.confirmJoinRoom = () =>
    send('join-room', {
      roomId: $('join-room-code-input').value.trim(),
      username: $('join-username-input').value,
      photoUrl: user?.photo_url || '',
    });
  window.closeModal = closeModal;
  $('create-room-btn').onclick = () => openModal('create-room-modal');
  $('join-room-btn').onclick = () => openModal('join-room-modal');
  $('join-btn').onclick = window.confirmJoinRoom;
  $('input-max-seats').min = '3';
  $('room-menu-btn').onclick = () => $('room-menu-modal').classList.remove('hidden');
  $('menu-close-btn').onclick = () => $('room-menu-modal').classList.add('hidden');
  $('menu-leave-btn').onclick = () => send('leave-room');
  $('listeners-toggle-btn').onclick = () => $('listeners-panel').classList.toggle('hidden');
  $('seat-action-btn').onclick = () => {
    if (me()?.seat !== null) send('leave-seat');
    else {
      const i = state?.seats.findIndex((id) => id === null);
      if (i >= 0) send('take-seat', i);
      else error('Свободных мест нет');
    }
    $('room-menu-modal').classList.add('hidden');
  };
  $('ready-btn-game').onclick = () => send('set-ready');
  window.toggleReady = () => send('set-ready');
  $('chat-toggle-btn').onclick = () => {
    if (privateState.canChat) $('chat-container').classList.toggle('hidden');
  };
  $('chat-close-btn').onclick = () => $('chat-container').classList.add('hidden');
  $('chat-send-btn').onclick = () => {
    const text = $('chat-input').value.trim();
    if (text && send('send-chat-message', text)) $('chat-input').value = '';
  };
  $('chat-input').onkeydown = (e) => {
    if (e.key === 'Enter') $('chat-send-btn').click();
  };
  $('join-room-code-input').onkeydown = (e) => {
    if (e.key === 'Enter') window.confirmJoinRoom();
  };
  function requestAudio() {
    if (!roomId || mediaPending || !mediaChannel || !mediaEnabled) return;
    mediaPending = true;
    retry.disabled = true;
    if (!send('get-livekit-token')) {
      mediaPending = false;
      retry.disabled = false;
    }
  }
  retry.onclick = requestAudio;
  $('audio-btn').onclick = async () => {
    try {
      sound = window.gameAudio.connected() && !window.gameAudio.canPlay() ? true : !sound;
      window.gameSounds?.mute(!sound);
      await window.gameAudio.mute(!sound);
      $('audio-btn').classList.toggle('active', sound);
      if (sound && !window.gameAudio.connected()) requestAudio();
    } catch (e) {
      error(e.message);
    }
  };
  $('mic-btn').onclick = async () => {
    if (!me()?.canSpeak || !connected()) return;
    const enabled = !me().mic,
      version = ++microphoneVersion;
    try {
      await window.gameAudio.microphone(enabled);
      if (version !== microphoneVersion || !me()?.canSpeak) {
        await window.gameAudio.microphone(false);
        return;
      }
      send('toggle-media', { mic: enabled });
    } catch (e) {
      error(e.message);
      send('toggle-media', { mic: false });
    }
  };
  skip.onclick = () => {
    if (send('day-vote', { targetId: null, revision: state.revision })) skip.disabled = true;
  };
  function confirm(text, fn) {
    $('action-confirm-text').textContent = text;
    $('action-confirm-modal').classList.remove('hidden');
    $('action-confirm-yes').onclick = () => {
      $('action-confirm-modal').classList.add('hidden');
      fn();
    };
    $('action-confirm-no').onclick = () => {
      $('action-confirm-modal').classList.add('hidden');
      selected = [];
      renderSeats();
    };
  }
  function choose(id) {
    const target = state.users[id],
      self = me();
    if (!connected() || pending) return;
    if (state.gameStatus === 'day_voting') {
      if (!self?.canVote || id === mine || !target?.isAlive || Object.hasOwn(state.votes, mine))
        return;
      send('day-vote', { targetId: id, revision: state.revision });
      return;
    }
    if (
      state.gameStatus !== 'night' ||
      !action ||
      !privateState.actions?.includes(action) ||
      !target?.isAlive
    )
      return;
    if (id === mine && action !== 'doctor_heal') return;
    if (action === 'doctor_heal' && id === mine && privateState.doctorSelfHealUsedLastNight) {
      error('Нельзя лечить себя две ночи подряд');
      return;
    }
    if (action === 'journalist_check') {
      if (selected.includes(id)) selected = selected.filter((x) => x !== id);
      else selected = [...selected, id].slice(-2);
      renderSeats();
      if (selected.length < 2) return;
    } else selected = [id];
    const chosen = [...selected],
      revision = state.revision,
      type = action;
    confirm(
      `${actionNames[type]}: ${chosen.map((x) => state.users[x].username).join(' и ')}?`,
      () => {
        if (state?.revision !== revision) return;
        pending = send('night-action', {
          targetId: chosen[0],
          targetIds: chosen,
          actionType: type,
          revision,
        });
        renderActions();
      }
    );
  }
  function renderSeats() {
    if (!state) return;
    const container = $('table-container'),
      height = container.clientHeight,
      width = container.clientWidth;
    const left = Math.ceil(state.maxSeats / 2),
      maxRows = left;
    const size = Math.max(22, Math.min(58, Math.floor(height / maxRows) - 34));
    container.replaceChildren();
    state.seats.forEach((id, i) => {
      const row = i < left ? i : i - left,
        count = i < left ? left : state.maxSeats - left;
      const wrap = document.createElement('div');
      wrap.className = 'seat-wrap';
      wrap.style.width = '76px';
      wrap.style.left = i < left ? '8px' : `${Math.max(8, width - 84)}px`;
      wrap.style.top = `${Math.max(5, ((row + 0.5) * height) / count - (size + 26) / 2)}px`;
      const seat = document.createElement('div');
      seat.className = 'seat';
      seat.style.width = `${size}px`;
      seat.style.height = `${size}px`;
      seat.id = `seat-${i}`;
      const number = document.createElement('div');
      number.className = 'seat-number';
      number.textContent = i + 1;
      const label = document.createElement('div');
      label.className = 'seat-name';
      if (id) {
        const u = state.users[id];
        seat.classList.add('occupied');
        label.textContent = u?.username || '';
        if (privateState.teammates?.includes(id) && id !== mine) label.textContent += ' · мафия';
        if (u?.photoUrl) {
          const img = document.createElement('img');
          img.src = u.photoUrl;
          img.alt = '';
          seat.append(img);
        }
        if (id === mine) seat.classList.add('my-seat');
        if (id === state.currentSpeakerId) seat.classList.add('active-speaker');
        if (u && !u.connected) {
          seat.classList.add('disconnected-seat');
          label.textContent += ' · нет связи';
        }
        let mark = null;
        if (state.gameStatus !== 'waiting' && !u?.isAlive) mark = ['seat-dead-cross', '×'];
        else if (state.gameStatus === 'waiting' && u?.isReady)
          mark = ['seat-ready-check seat-vote-check', '✓'];
        else if (state.gameStatus === 'day_voting' && state.votes[mine] === id)
          mark = ['seat-vote-check', '✓'];
        else if (
          selected.includes(id) ||
          (Object.values(privateState.submitted || {}).some((a) => a.targetId === id) &&
            state.gameStatus === 'night')
        )
          mark = ['seat-target-check', '✓'];
        if (mark) {
          const badge = document.createElement('div');
          badge.className = mark[0];
          badge.textContent = mark[1];
          seat.append(badge);
        }
        seat.onclick = () => choose(id);
      } else {
        seat.textContent = '+';
        seat.onclick = () => {
          if (state.gameStatus === 'waiting') send('take-seat', i);
        };
      }
      wrap.append(number, seat, label);
      container.append(wrap);
    });
  }
  const observer = new ResizeObserver(() => renderSeats());
  observer.observe($('table-container'));
  function renderActions() {
    actions.replaceChildren();
    actions.hidden = state?.gameStatus !== 'night' || !me()?.isAlive;
    if (actions.hidden) return;
    if (privateState.blocked) {
      actions.textContent = 'Вы очарованы: этой ночью способности недоступны';
      return;
    }
    const available = privateState.actions || [];
    if (!available.includes(action)) {
      action = available[0] || null;
      selected = [];
    }
    for (const a of available) {
      const btn = document.createElement('button');
      btn.className = `menu-action ${action === a ? 'selected-action' : ''}`;
      btn.textContent = actionNames[a];
      btn.disabled = pending;
      btn.onclick = () => {
        action = a;
        selected = [];
        renderActions();
        renderSeats();
      };
      actions.append(btn);
    }
    if (action) {
      const hint = document.createElement('small');
      hint.textContent =
        action === 'journalist_check' ? 'Выберите двух игроков' : 'Выберите игрока за столом';
      actions.append(hint);
    } else actions.textContent = 'Ночных действий нет';
  }
  function renderVoting() {
    const active = ['day_voting', 'vote_result'].includes(state.gameStatus);
    $('voting-paper').classList.toggle('hidden', !active);
    if (!active) return;
    const list = $('vote-results-list');
    list.replaceChildren();
    const groups = new Map();
    for (const [voter, target] of Object.entries(state.votes)) {
      if (!groups.has(target)) groups.set(target, []);
      groups.get(target).push(voter);
    }
    for (const [target, voters] of groups) {
      const row = document.createElement('div');
      row.className = 'vote-row';
      row.textContent = `${target ? Number(state.users[target]?.seat) + 1 : 'Пропуск'} ← ${voters.map((id) => Number(state.users[id]?.seat) + 1).join(' ')}`;
      list.append(row);
    }
    if (!groups.size) list.textContent = 'Голосов пока нет';
    skip.hidden = state.gameStatus !== 'day_voting';
    skip.disabled = !connected() || !me()?.canVote || Object.hasOwn(state.votes, mine);
  }
  function render() {
    if (!state) return;
    const self = me(),
      waiting = state.gameStatus === 'waiting';
    $('role-label').textContent =
      self?.seat == null
        ? 'Режим: Наблюдатель'
        : self.isAlive || waiting
          ? 'Режим: Игрок за столом'
          : 'Вы выбыли из партии';
    $('role-card-value').textContent = privateState.role ? 'Нажмите, чтобы открыть' : 'Скрыто';
    $('seat-action-btn').textContent = self?.seat == null ? '🪑 Сесть' : '🪑 Встать';
    $('seat-action-btn').disabled = !waiting || !connected();
    $('ready-btn-game').style.display = waiting && self?.seat != null ? 'inline-block' : 'none';
    $('ready-btn-game').textContent = self?.isReady ? 'Не готов' : 'Готов к игре';
    $('ready-btn-game').disabled = !connected();
    $('ready-btn-game').classList.toggle('ready-on', !!self?.isReady);
    $('mic-btn').disabled = !connected() || !self?.canSpeak || !window.gameAudio.connected();
    $('mic-btn').classList.toggle('active', !!self?.mic);
    $('mic-btn').title = self?.mic ? 'Выключить микрофон' : 'Включить микрофон';
    if (!self?.canSpeak || !self?.mic) {
      microphoneVersion++;
      window.gameAudio.microphone(false).catch(() => {});
    }
    $('chat-toggle-btn').disabled = !privateState.canChat;
    if (!privateState.canChat) $('chat-container').classList.add('hidden');
    $('chat-title').textContent = state.gameStatus === 'night' ? 'ЧАТ МАФИИ' : 'ЧАТ КОМНАТЫ';
    $('chat-input').disabled = $('chat-send-btn').disabled = !privateState.canChat || !connected();
    const listeners = Object.values(state.users).filter((u) => u.seat === null);
    $('listeners-count-label').textContent = listeners.length;
    $('listeners-list-content').replaceChildren();
    for (const u of listeners) {
      const item = document.createElement('div');
      item.className = 'listener-item';
      item.textContent = u.username;
      $('listeners-list-content').append(item);
    }
    const labels = {
      waiting: 'ОЖИДАНИЕ ИГРОКОВ',
      night: `НОЧЬ ${state.round}\nНОЧНЫЕ ДЕЙСТВИЯ`,
      night_result: 'ИТОГИ НОЧИ',
      day_speeches:
        state.currentSpeakerId === mine
          ? 'ВАШ ХОД\nГОВОРИТЕ'
          : `ГОВОРИТ ${state.users[state.currentSpeakerId]?.username || 'ИГРОК'}`,
      day_discussion: `ДЕНЬ ${state.round}\nОБЩЕЕ ОБСУЖДЕНИЕ`,
      day_voting: 'ГОЛОСОВАНИЕ\nВЫБЕРИТЕ ИГРОКА',
      vote_result: 'ИТОГИ ГОЛОСОВАНИЯ',
      last_words: `ПОСЛЕДНЕЕ СЛОВО\n${state.users[state.lastWordPlayerId]?.username || ''}`,
    };
    $('game-status-text').textContent = labels[state.gameStatus] || '';
    if (state.result?.type === 'game')
      $('game-status-text').textContent =
        state.result.winner === 'mafia' ? 'МАФИЯ ПОБЕДИЛА' : 'МИРНЫЕ ПОБЕДИЛИ';
    retry.hidden = !mediaEnabled || !mediaChannel || window.gameAudio.connected() || mediaPending;
    renderSeats();
    renderActions();
    renderVoting();
    renderTimer();
  }
  let timerOffset = 0;
  function renderTimer() {
    if (!state) return;
    const seconds = state.deadline
      ? Math.max(0, Math.ceil((state.deadline - (Date.now() + timerOffset)) / 1000))
      : 0;
    $('game-timer-text').textContent = state.deadline
      ? `Осталось: ${seconds}с`
      : `Для начала нужны готовые игроки: минимум ${Math.max(3, state.enabledRoles.length)}`;
  }
  setInterval(renderTimer, 250);
  function showRole() {
    if (!privateState.role) return;
    document.querySelectorAll('.role-card-overlay').forEach((el) => el.remove());
    const overlay = document.createElement('div');
    overlay.className = 'role-card-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Ваша роль');
    const map = {
      mafia: 'mafia_cart.png',
      don: 'don_cart.png',
      lawyer: 'lawyer_cart.png',
      doctor: 'doc_cart.png',
      cop: 'cop_cart.png',
      mistress: 'mistress_cart.png',
      civilian: 'civilian_cart.png',
      journalist: 'jurnalist_cart.png',
      sergeant: 'serjant_cart.png',
    };
    if (map[privateState.role]) {
      const img = document.createElement('img');
      img.src = `/carts/${map[privateState.role]}`;
      img.alt = roleName(privateState.role);
      overlay.append(img);
    } else {
      const card = document.createElement('div');
      card.className = 'room-modal-card';
      card.textContent = roleName(privateState.role);
      overlay.append(card);
    }
    if (privateState.checks?.length) {
      const history = document.createElement('div');
      history.className = 'role-check-history';
      for (const result of privateState.checks) {
        const item = document.createElement('div');
        item.textContent = `Ночь ${result.round}: ${investigationText(result)}`;
        history.append(item);
      }
      overlay.append(history);
    }
    const close = document.createElement('button');
    close.className = 'menu-action';
    close.textContent = 'Закрыть';
    close.onclick = () => overlay.remove();
    overlay.append(close);
    document.body.append(overlay);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    close.focus();
  }
  $('role-card-btn').onclick = showRole;
  function investigationText(data) {
    let text = `${data.targetName}: `;
    if (data.actionType === 'lawyer_check') text += roleName(data.role);
    else if (data.actionType === 'don_check') text += data.isCop ? 'комиссар' : 'не комиссар';
    else text += data.isMafia ? 'клан мафии' : 'клан мирных';
    return text;
  }
  function investigation(data) {
    const key = JSON.stringify(data);
    if (shownChecks.has(key)) return;
    shownChecks.add(key);
    line(investigationText(data), 'success');
  }
  function gameResult(result) {
    if (!result?.players) return;
    const key = JSON.stringify([result.winner, result.players]);
    if (shownFinal === key) return;
    shownFinal = key;
    line(result.winner === 'mafia' ? 'Победила мафия' : 'Победили мирные');
    for (const p of result.players)
      line(`${p.seat + 1}. ${p.username} — ${roleName(p.role)}${p.isAlive ? '' : ' · выбыл'}`);
  }
  events.on('session', (d) => {
    mine = d.playerId;
    replaced = false;
  });
  events.on('connect', () => {
    connection.textContent = '';
    render();
  });
  events.on('disconnect', () => {
    connection.textContent = replaced
      ? 'Игра открыта в другой вкладке'
      : 'Соединение потеряно. Переподключение…';
    window.gameAudio.disconnect();
    mediaPending = false;
    mediaChannel = undefined;
    render();
  });
  events.on('connect_error', (e) => {
    connection.textContent = e.message || 'Не удалось подключиться';
  });
  events.on('session-replaced', () => {
    replaced = true;
    error('Эта игровая сессия открыта в другой вкладке');
  });
  events.on('error-msg', error);
  events.on('room-joined', (d) => {
    if (roomId && roomId !== d.roomId) clearRoom();
    roomId = d.roomId;
    mine = d.playerId;
    closeModal();
    $('lobby').classList.add('hidden');
    $('room').classList.remove('hidden');
    $('room-code-display').textContent = roomId;
    requestAudio();
  });
  events.on('room-left', clearRoom);
  events.on('private-state', (d) => {
    if (mediaChannel !== d.mediaChannel) {
      mediaChannel = d.mediaChannel;
      mediaPending = false;
      window.gameAudio.disconnect();
      requestAudio();
    }
    privateState = d;
    pending = false;
    for (const result of d.checks || []) investigation(result);
    render();
  });
  events.on('update-room', (d) => {
    if (d.roomId !== roomId) return;
    const old = state;
    if (!old || old.revision !== d.revision) {
      clearSelection();
      if (old?.gameStatus === 'waiting' && d.gameStatus === 'night') {
        shownPhases.clear();
        shownFinal = '';
        $('event-feed-list').replaceChildren();
      }
      if (d.gameStatus === 'night') phaseLine('night', d.round);
      else if (
        ['night_result', 'day_speeches', 'day_discussion', 'day_voting'].includes(d.gameStatus)
      )
        phaseLine('day', d.round);
      if (old?.gameStatus === 'night' || d.gameStatus === 'night')
        $('chat-messages').replaceChildren();
    }
    state = d;
    timerOffset = d.deadline ? d.deadline - d.timeLeft * 1000 - Date.now() : 0;
    if (d.result?.type === 'game') gameResult(d.result);
    render();
  });
  events.on('livekit-token', async (d) => {
    if (d.roomId !== roomId || d.channel !== mediaChannel) return;
    mediaEnabled = d.enabled !== false;
    if (!d.token) {
      mediaPending = false;
      render();
      return;
    }
    try {
      await window.gameAudio.connect(d);
    } catch (e) {
      error(e.message);
    } finally {
      mediaPending = false;
      retry.disabled = false;
      render();
    }
  });
  events.on('audio-disconnected', () => {
    mediaPending = false;
    retry.disabled = false;
    render();
  });
  events.on('audio-status', () => {
    $('audio-btn').title = window.gameAudio.canPlay()
      ? 'Включить/выключить звук'
      : 'Нажмите, чтобы разрешить воспроизведение звука';
  });
  events.on('media-error', (msg) => {
    window.gameAudio.disconnect();
    error(msg);
    mediaPending = false;
    render();
  });
  events.on('chat-message', (d) => {
    const msg = document.createElement('div');
    msg.className = 'chat-msg';
    msg.textContent = `${d.time} ${d.username}: ${d.text}`;
    $('chat-messages').append(msg);
    while ($('chat-messages').children.length > 100) $('chat-messages').firstChild.remove();
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  });
  events.on('game-started', (d) => {
    shownChecks.clear();
    shownPhases.clear();
    $('chat-messages').replaceChildren();
    privateState = { role: d.role };
    $('event-feed-list').replaceChildren();
    showRole();
  });
  events.on('game-ended', (d) => {
    privateState = {};
    $('chat-messages').replaceChildren();
    clearSelection();
    gameResult(d);
  });
  events.on('night-action-ack', (d) => {
    pending = false;
    if (d.accepted) {
      line('Действие принято', 'success');
      selected = [];
    } else error(d.reason);
    renderActions();
  });
  events.on('day-vote-ack', (d) => {
    if (!d.accepted) error(d.reason);
  });
  events.on('investigation-result', investigation);
  events.on('charmed', () =>
    line(
      'К вам приходила любовница. Ближайшее дневное голосование и способности следующей ночи недоступны.',
      'alert'
    )
  );
  events.on('healed', (d) =>
    line(
      d.saved ? 'Врач спас вас от выстрела этой ночью.' : 'Этой ночью врач вылечил вас.',
      'success'
    )
  );
  events.on('night-result', (d) => {
    phaseLine('day', d.round);
    if (d.killedPlayers?.length) window.gameSounds?.shot();
    line(
      d.killedPlayerName ? `Погибли: ${d.killedPlayerName}` : 'Ночь прошла спокойно',
      d.killedPlayerName ? 'alert' : 'info'
    );
    for (const j of d.headlines || [])
      line(`Журналист: ${j.names.join(' и ')} — ${j.sameClan ? 'один клан' : 'разные кланы'}`);
  });
  events.on('day-vote-result', (d) =>
    line(
      d.eliminatedPlayerName
        ? `Исключён: ${d.eliminatedPlayerName}`
        : d.tie
          ? 'Ничья. Никто не выбыл.'
          : 'Никто не выбыл.',
      d.eliminatedPlayerName ? 'alert' : 'info'
    )
  );
  api.socket.connect();
})();
