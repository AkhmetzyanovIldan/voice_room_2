(() => {
  const descriptions = {
    mafia:
      'Вместе с доном выбирает одну общую жертву ночью. При равенстве голосов клана выстрела нет.',
    don: 'Участвует в общем выстреле и отдельно проверяет, является ли игрок комиссаром. Проверка приходит даже при гибели дона этой ночью.',
    lawyer:
      'Узнаёт точную роль одного игрока ночью, даже если сам погибает этой ночью. Играет за мафию, но не стреляет.',
    cop: 'Комиссар (шериф): ночью узнаёт клан одного игрока.',
    doctor:
      'Лечит одного игрока и защищает от всех выстрелов этой ночи. Себя нельзя лечить две ночи подряд.',
    sergeant:
      'Один выстрел за всю игру. В первую ночь стрелять нельзя. Потраченный выстрел не восстанавливается.',
    journalist:
      'Сравнивает кланы двух других игроков. Утром публикуется результат без раскрытия роли журналиста, только если он пережил ночь.',
    mistress:
      'Выбирает другого игрока: он лишается голоса ближайшим днём и способностей следующей ночью. Способности текущей ночи действуют. Игроку сообщается об очаровании.',
  };
  const button = document.createElement('button');
  button.className = 'menu-action';
  button.textContent = 'Правила и роли';
  document.getElementById('menu-close-btn').before(button);
  const modal = document.createElement('div');
  modal.className = 'room-modal hidden';
  modal.id = 'rules-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-label', 'Правила и роли');
  const card = document.createElement('div');
  card.className = 'room-modal-card rules-card';
  const title = document.createElement('h2');
  title.textContent = 'Правила и роли';
  title.tabIndex = -1;
  card.append(title);
  const rules = document.createElement('p');
  rules.textContent =
    'Ночь длится 20 секунд. Ночные действия разрешаются одновременно. Днём у каждого живого игрока один голос, кроме очарованного. При равенстве голосов никто не выбывает. Можно пропустить голосование. Мирные побеждают, когда не осталось живых мафии и дона. Ночью мафия общается в закрытом канале; погибшие члены клана могут только слушать. После последнего слова погибшие больше не говорят.';
  card.append(rules);
  const victory = document.createElement('p');
  victory.textContent =
    'Равенство сторон само по себе не завершает игру. Мафия побеждает, если мирных не осталось или мафиози не меньше мирных и у мирных уже нет шанса победить даже при удачном выборе ночных целей против лучших действий мафии. Учитываются лечение, оставшийся выстрел сержанта, первая ночь и блокировки любовницы. Простое затягивание партии не считается шансом на победу.';
  card.append(victory);
  for (const role of [...window.mafiaRoles, { id: 'civilian', name: 'Мирный' }]) {
    const heading = document.createElement('h3'),
      text = document.createElement('p');
    heading.textContent = role.name;
    text.textContent =
      descriptions[role.id] || 'Ищет мафию в обсуждении и голосует днём. Ночных способностей нет.';
    card.append(heading, text);
  }
  const close = document.createElement('button');
  close.className = 'menu-action';
  close.textContent = 'Закрыть';
  close.onclick = () => {
    modal.classList.add('hidden');
    button.focus();
  };
  card.append(close);
  modal.append(card);
  document.body.append(modal);
  button.onclick = () => {
    modal.classList.remove('hidden');
    card.scrollTop = 0;
    title.focus();
  };
  modal.onkeydown = (e) => {
    if (e.key === 'Escape') close.click();
  };
})();
