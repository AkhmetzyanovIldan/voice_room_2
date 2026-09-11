(function () {
  window.mafiaRoles = [
    { id: 'mafia', name: 'Мафия', clan: 'mafia', enabledByDefault: true },
    { id: 'don', name: 'Дон', clan: 'mafia', enabledByDefault: false },
    { id: 'lawyer', name: 'Адвокат', clan: 'mafia', enabledByDefault: false },
    { id: 'cop', name: 'Комиссар', clan: 'peaceful', enabledByDefault: true },
    { id: 'doctor', name: 'Врач', clan: 'peaceful', enabledByDefault: true },
    { id: 'sergeant', name: 'Сержант', clan: 'peaceful', enabledByDefault: false },
    { id: 'journalist', name: 'Журналист', clan: 'peaceful', enabledByDefault: false },
    { id: 'mistress', name: 'Любовница', clan: 'peaceful', enabledByDefault: false },
  ];
})();
