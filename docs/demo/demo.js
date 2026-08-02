const loginView = document.querySelector('#loginView');
const appView = document.querySelector('#appView');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const loginLanguage = document.querySelector('#loginLanguage');
const appLanguage = document.querySelector('#appLanguage');
const toast = document.querySelector('#toast');
const eventList = document.querySelector('#eventList');
const logConsole = document.querySelector('#logConsole code');

const dynamicCopy = {
  en: {
    pageTitle: 'SmartWAN Manager — Interactive Demo',
    invalidLogin: 'Use the demonstration credentials: demo / demo.',
    credentialsCopied: 'Demo credentials copied: demo / demo',
    clipboardFallback: 'Demo credentials: demo / demo',
    mapOpened: 'Fictional network map opened.',
    mapClosed: 'Network map preview closed.',
    soundOn: 'Aurelka demo notifications enabled.',
    soundOff: 'Aurelka demo notifications muted.',
    demoAction: 'Demo action completed — no router command was sent.',
    clearEvents: 'Demo event archive cleared.',
    refresh: 'Fictional router state refreshed.',
    scan: 'Network scan complete: 14 fictional devices online.',
    ssh: 'Demo SSH test successful: Ed25519 connection ready.',
    save: 'Demo settings saved for this preview only.',
    apply: 'Demo configuration applied successfully.',
    preview: 'Managed rule preview generated locally.',
    download: 'Demo VPN profile prepared — no real credentials included.',
    tailscale: 'Demo peers refreshed: 6 online.',
    backup: 'Fictional safety backup created.',
    restore: 'Restore preview opened — no data was changed.',
    export: 'Demo log export prepared.',
    diagnose: 'Diagnostics complete: no routing conflicts detected.',
    ping: 'Demo ping complete: 12 ms, 0% packet loss.',
    key: 'Demo Ed25519 fingerprint verified.',
    scripts: 'Managed Merlin script preview ready.',
    conflicts: 'Conflict scan complete: configuration is safe.',
    modeChanged: 'Interface preview mode changed.',
    simulationBusy: 'A WAN event simulation is already running.',
    wan0Checking: 'Aurelka is checking WAN0 (Starlink)…',
    wan1Checking: 'Aurelka is checking WAN1 (Orange Fiber)…',
    bothChecking: 'Aurelka is checking both WAN links…',
    wan0Down: 'WAN0 outage confirmed — traffic moved to Orange Fiber.',
    wan1Down: 'WAN1 outage confirmed — traffic moved to Starlink.',
    bothDown: 'Both WAN links are offline — Internet access interrupted.',
    wan0Recovering: 'WAN0 signal returned — confirming recovery.',
    wan1Recovering: 'WAN1 signal returned — confirming recovery.',
    bothRecovering: 'Both WAN links returned — confirming stability.',
    allRecovered: 'Both WAN links are healthy again.',
    online: 'Online',
    checking: 'Checking',
    recovering: 'Recovering',
    down: 'Down',
    degraded: 'Degraded',
    offline: 'Offline',
    allHealthy: 'All healthy',
    verifying: 'Verifying links',
    outage: 'Outage detected',
    bothHealthyMessage: 'Both WAN links are healthy.',
    checkingMessage: 'Aurelka is checking link quality.',
    oneDownMessage: 'Aurelka is guarding the active failover route.',
    bothDownMessage: 'Aurelka reports loss of both Internet links.',
    balanced: 'Balanced',
    failoverActive: 'Failover active',
    noInternet: 'No Internet',
    balanceMode: 'Balance 60/40',
    emergencyRoute: 'Emergency route',
    routeUnavailable: 'Route unavailable',
    wanOnlineSummary: '2/2 WAN online',
    wanCheckingSummary: 'WAN verification in progress',
    oneWanSummary: '1/2 WAN online · failover active',
    zeroWanSummary: '0/2 WAN online',
    eventChecking0: 'WAN0 verification started',
    eventChecking1: 'WAN1 verification started',
    eventCheckingBoth: 'Both WAN links are being verified',
    eventDown0: 'WAN0 outage confirmed; failover activated',
    eventDown1: 'WAN1 outage confirmed; failover activated',
    eventDownBoth: 'Both WAN links reported offline',
    eventRecovery0: 'WAN0 recovery confirmation started',
    eventRecovery1: 'WAN1 recovery confirmation started',
    eventRecoveryBoth: 'Recovery confirmation started for both links',
    eventRecovered: 'Both WAN links confirmed online',
  },
  pl: {
    pageTitle: 'SmartWAN Manager — Interaktywne demo',
    invalidLogin: 'Użyj danych demonstracyjnych: demo / demo.',
    credentialsCopied: 'Skopiowano dane demo: demo / demo',
    clipboardFallback: 'Dane demonstracyjne: demo / demo',
    mapOpened: 'Otwarto fikcyjną mapę sieci.',
    mapClosed: 'Zamknięto podgląd mapy sieci.',
    soundOn: 'Powiadomienia demonstracyjne Aurelki włączone.',
    soundOff: 'Powiadomienia demonstracyjne Aurelki wyciszone.',
    demoAction: 'Akcja demo zakończona — nie wysłano polecenia do routera.',
    clearEvents: 'Wyczyszczono archiwum zdarzeń demo.',
    refresh: 'Odświeżono fikcyjny stan routera.',
    scan: 'Skan sieci zakończony: 14 fikcyjnych urządzeń online.',
    ssh: 'Test SSH demo udany: połączenie Ed25519 gotowe.',
    save: 'Ustawienia demo zapisano tylko w tym podglądzie.',
    apply: 'Konfiguracja demo została zastosowana pomyślnie.',
    preview: 'Podgląd zarządzanych reguł wygenerowano lokalnie.',
    download: 'Przygotowano profil VPN demo — bez prawdziwych danych dostępowych.',
    tailscale: 'Odświeżono peery demo: 6 online.',
    backup: 'Utworzono fikcyjny backup bezpieczeństwa.',
    restore: 'Otwarto podgląd przywracania — nie zmieniono danych.',
    export: 'Przygotowano eksport logu demo.',
    diagnose: 'Diagnostyka zakończona: nie wykryto konfliktów routingu.',
    ping: 'Ping demo zakończony: 12 ms, 0% utraty pakietów.',
    key: 'Zweryfikowano demonstracyjny fingerprint Ed25519.',
    scripts: 'Podgląd zarządzanych skryptów Merlin jest gotowy.',
    conflicts: 'Skan konfliktów zakończony: konfiguracja jest bezpieczna.',
    modeChanged: 'Zmieniono pokazowy tryb interfejsu.',
    simulationBusy: 'Symulacja zdarzenia WAN już trwa.',
    wan0Checking: 'Aurelka sprawdza WAN0 (Starlink)…',
    wan1Checking: 'Aurelka sprawdza WAN1 (Orange Fiber)…',
    bothChecking: 'Aurelka sprawdza oba łącza WAN…',
    wan0Down: 'Potwierdzono awarię WAN0 — ruch przeniesiono na Orange Fiber.',
    wan1Down: 'Potwierdzono awarię WAN1 — ruch przeniesiono na Starlink.',
    bothDown: 'Oba łącza WAN są offline — dostęp do Internetu przerwany.',
    wan0Recovering: 'Sygnał WAN0 powrócił — trwa potwierdzanie sprawności.',
    wan1Recovering: 'Sygnał WAN1 powrócił — trwa potwierdzanie sprawności.',
    bothRecovering: 'Oba łącza powróciły — trwa potwierdzanie stabilności.',
    allRecovered: 'Oba łącza WAN ponownie działają prawidłowo.',
    online: 'Online',
    checking: 'Sprawdzanie',
    recovering: 'Powrót',
    down: 'Awaria',
    degraded: 'Ograniczony',
    offline: 'Offline',
    allHealthy: 'Wszystko działa',
    verifying: 'Sprawdzanie łączy',
    outage: 'Wykryto awarię',
    bothHealthyMessage: 'Oba łącza WAN działają prawidłowo.',
    checkingMessage: 'Aurelka sprawdza jakość łączy.',
    oneDownMessage: 'Aurelka pilnuje aktywnej trasy failover.',
    bothDownMessage: 'Aurelka zgłasza utratę obu łączy internetowych.',
    balanced: 'Równoważenie',
    failoverActive: 'Failover aktywny',
    noInternet: 'Brak Internetu',
    balanceMode: 'Równoważenie 60/40',
    emergencyRoute: 'Trasa awaryjna',
    routeUnavailable: 'Trasa niedostępna',
    wanOnlineSummary: '2/2 WAN online',
    wanCheckingSummary: 'Trwa sprawdzanie łączy WAN',
    oneWanSummary: '1/2 WAN online · failover aktywny',
    zeroWanSummary: '0/2 WAN online',
    eventChecking0: 'Rozpoczęto sprawdzanie WAN0',
    eventChecking1: 'Rozpoczęto sprawdzanie WAN1',
    eventCheckingBoth: 'Trwa sprawdzanie obu łączy WAN',
    eventDown0: 'Potwierdzono awarię WAN0; aktywowano failover',
    eventDown1: 'Potwierdzono awarię WAN1; aktywowano failover',
    eventDownBoth: 'Oba łącza WAN zgłoszono jako offline',
    eventRecovery0: 'Rozpoczęto potwierdzanie powrotu WAN0',
    eventRecovery1: 'Rozpoczęto potwierdzanie powrotu WAN1',
    eventRecoveryBoth: 'Rozpoczęto potwierdzanie powrotu obu łączy',
    eventRecovered: 'Potwierdzono działanie obu łączy WAN',
  },
};

const actionMessages = {
  refresh: 'refresh',
  scan: 'scan',
  ssh: 'ssh',
  save: 'save',
  apply: 'apply',
  preview: 'preview',
  download: 'download',
  tailscale: 'tailscale',
  backup: 'backup',
  restore: 'restore',
  export: 'export',
  diagnose: 'diagnose',
  ping: 'ping',
  key: 'key',
  scripts: 'scripts',
  conflicts: 'conflicts',
};

let language = new URLSearchParams(window.location.search).get('lang') === 'pl' ? 'pl' : 'en';
let linkStates = { wan0: 'healthy', wan1: 'healthy' };
let simulationTimers = [];
let simulationRunning = false;
let toastTimer;
let soundEnabled = true;

function copy(key) {
  return dynamicCopy[language][key] || dynamicCopy.en[key] || key;
}

function setLanguage(nextLanguage) {
  language = nextLanguage === 'pl' ? 'pl' : 'en';
  document.documentElement.lang = language;
  document.title = copy('pageTitle');
  loginLanguage.value = language;
  appLanguage.value = language;

  document.querySelectorAll('[data-en][data-pl]').forEach((element) => {
    element.textContent = element.dataset[language];
  });

  const modeOptions = document.querySelector('#modeSelect').options;
  modeOptions[0].textContent = language === 'pl' ? 'Ekspert' : 'Expert';
  modeOptions[1].textContent = language === 'pl' ? 'Zaawansowany' : 'Advanced';
  modeOptions[2].textContent = language === 'pl' ? 'Podstawowy' : 'Basic';

  try {
    localStorage.setItem('smartwan-demo-language', language);
  } catch {
    // Storage is optional.
  }

  renderWanState();
}

function showToast(messageKey) {
  toast.textContent = copy(messageKey);
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 3000);
}

function formatTime() {
  return new Intl.DateTimeFormat(language === 'pl' ? 'pl-PL' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function addEvent(messageKey, tone = 'blue') {
  const item = document.createElement('li');
  const time = document.createElement('time');
  const dot = document.createElement('i');
  const message = document.createElement('span');

  time.textContent = formatTime();
  dot.className = 'status-dot ' + tone;
  message.dataset.en = dynamicCopy.en[messageKey];
  message.dataset.pl = dynamicCopy.pl[messageKey];
  message.textContent = copy(messageKey);

  item.append(time, dot, message);
  eventList.prepend(item);

  while (eventList.children.length > 7) {
    eventList.lastElementChild.remove();
  }
}

function addLog(level, message, tone = 'log-blue') {
  const line = document.createElement('span');
  line.innerHTML = '<span class="log-time">' + formatTime() + '</span> <span class="' + tone + '">' + level + '</span> ' + message + '\n';
  logConsole.prepend(line);
}

function stateClass(state) {
  return state === 'recovering' ? 'checking' : state;
}

function stateLabel(state) {
  return copy(state === 'healthy' ? 'online' : state);
}

function setWanState(wan, state) {
  linkStates[wan] = state;
  const visualClass = stateClass(state);

  document.querySelectorAll('[data-eye="' + wan + '"], [data-mini-eye="' + wan + '"]').forEach((element) => {
    element.classList.remove('healthy', 'checking', 'down');
    element.classList.add(visualClass);
  });

  const card = document.querySelector('[data-wan-card="' + wan + '"]');
  card.classList.remove('healthy', 'checking', 'down');
  card.classList.add(visualClass);

  const badge = document.querySelector('[data-wan-badge="' + wan + '"]');
  badge.classList.remove('healthy', 'checking', 'down');
  badge.classList.add(visualClass);
  badge.textContent = stateLabel(state);

  const latency = document.querySelector('[data-wan-latency="' + wan + '"]');
  latency.textContent = state === 'down' ? '—' : state === 'healthy' ? (wan === 'wan0' ? '38 ms' : '12 ms') : copy(state);
}

function setTone(element, tone) {
  element.classList.remove('healthy', 'checking', 'down', 'blue');
  element.classList.add(tone);
}

function renderWanState() {
  setWanState('wan0', linkStates.wan0);
  setWanState('wan1', linkStates.wan1);

  const states = Object.values(linkStates);
  const downCount = states.filter((state) => state === 'down').length;
  const checkingCount = states.filter((state) => state === 'checking' || state === 'recovering').length;
  const routerStatus = document.querySelector('#routerStatus');
  const routerDot = document.querySelector('#routerDot');
  const healthSummary = document.querySelector('#healthSummary');
  const guardianBadge = document.querySelector('#guardianBadge');
  const guardianMessage = document.querySelector('#guardianMessage');
  const routingBadge = document.querySelector('#routingBadge');
  const routeMode = document.querySelector('#routeMode');
  const routeTarget = document.querySelector('#routeTarget');

  let tone = 'healthy';
  let bulbTone = 'healthy';

  if (downCount === 2) {
    routerStatus.textContent = copy('offline');
    healthSummary.textContent = copy('zeroWanSummary');
    guardianBadge.textContent = copy('outage');
    guardianMessage.textContent = copy('bothDownMessage');
    routingBadge.textContent = copy('noInternet');
    routeMode.textContent = copy('routeUnavailable');
    routeTarget.textContent = copy('offline');
    tone = 'down';
    bulbTone = 'down';
  } else if (downCount === 1) {
    routerStatus.textContent = copy('degraded');
    healthSummary.textContent = copy('oneWanSummary');
    guardianBadge.textContent = copy('outage');
    guardianMessage.textContent = copy('oneDownMessage');
    routingBadge.textContent = copy('failoverActive');
    routeMode.textContent = copy('emergencyRoute');
    routeTarget.textContent = linkStates.wan0 === 'down' ? 'Orange Fiber' : 'Starlink';
    tone = 'checking';
    bulbTone = 'down';
  } else if (checkingCount > 0) {
    routerStatus.textContent = copy('checking');
    healthSummary.textContent = copy('wanCheckingSummary');
    guardianBadge.textContent = copy('verifying');
    guardianMessage.textContent = copy('checkingMessage');
    routingBadge.textContent = copy('balanced');
    routeMode.textContent = copy('balanceMode');
    routeTarget.textContent = 'Starlink + Orange';
    tone = 'checking';
    bulbTone = 'checking';
  } else {
    routerStatus.textContent = copy('online');
    healthSummary.textContent = copy('wanOnlineSummary');
    guardianBadge.textContent = copy('allHealthy');
    guardianMessage.textContent = copy('bothHealthyMessage');
    routingBadge.textContent = copy('balanced');
    routeMode.textContent = copy('balanceMode');
    routeTarget.textContent = 'Starlink + Orange';
  }

  setTone(routerDot, tone);
  setTone(guardianBadge, bulbTone === 'down' ? 'down' : bulbTone === 'checking' ? 'checking' : 'healthy');
  setTone(routingBadge, downCount > 0 ? (downCount === 2 ? 'down' : 'checking') : 'blue');
  document.querySelectorAll('[data-bulb]').forEach((bulb) => setTone(bulb, bulbTone));
}

function setSimulationButtons(disabled) {
  document.querySelectorAll('[data-simulate]:not([data-simulate="reset"])').forEach((button) => {
    button.disabled = disabled;
  });
}

function clearSimulationTimers() {
  simulationTimers.forEach((timer) => window.clearTimeout(timer));
  simulationTimers = [];
}

function targetWans(target) {
  return target === 'both' ? ['wan0', 'wan1'] : [target];
}

function setTargetState(target, state) {
  targetWans(target).forEach((wan) => setWanState(wan, state));
  renderWanState();
}

function simulate(target) {
  if (target === 'reset') {
    clearSimulationTimers();
    simulationRunning = false;
    setSimulationButtons(false);
    linkStates = { wan0: 'healthy', wan1: 'healthy' };
    renderWanState();
    addEvent('eventRecovered', 'healthy');
    addLog('INFO', 'manual demo reset: wan0=online wan1=online', 'log-ok');
    showToast('allRecovered');
    return;
  }

  if (simulationRunning) {
    showToast('simulationBusy');
    return;
  }

  simulationRunning = true;
  setSimulationButtons(true);
  const isBoth = target === 'both';
  const number = target === 'wan0' ? '0' : '1';

  setTargetState(target, 'checking');
  addEvent(isBoth ? 'eventCheckingBoth' : 'eventChecking' + number, 'checking');
  addLog('CHECK', isBoth ? 'probing wan0 and wan1' : 'probing ' + target, 'log-warn');
  showToast(isBoth ? 'bothChecking' : target === 'wan0' ? 'wan0Checking' : 'wan1Checking');

  simulationTimers.push(window.setTimeout(() => {
    setTargetState(target, 'down');
    addEvent(isBoth ? 'eventDownBoth' : 'eventDown' + number, 'down');
    addLog('ALERT', isBoth ? 'wan0=down wan1=down' : target + '=down failover=active', 'log-down');
    showToast(isBoth ? 'bothDown' : target === 'wan0' ? 'wan0Down' : 'wan1Down');
  }, 850));

  simulationTimers.push(window.setTimeout(() => {
    setTargetState(target, 'recovering');
    addEvent(isBoth ? 'eventRecoveryBoth' : 'eventRecovery' + number, 'checking');
    addLog('RECOVERY', isBoth ? 'both links responding; confirmation 1/3' : target + ' responding; confirmation 1/3', 'log-warn');
    showToast(isBoth ? 'bothRecovering' : target === 'wan0' ? 'wan0Recovering' : 'wan1Recovering');
  }, 4300));

  simulationTimers.push(window.setTimeout(() => {
    setTargetState(target, 'healthy');
    simulationRunning = false;
    setSimulationButtons(false);
    addEvent('eventRecovered', 'healthy');
    addLog('INFO', 'watchdog: wan0=online wan1=online active=balanced', 'log-ok');
    showToast('allRecovered');
  }, 6500));
}

function openView(viewName) {
  document.querySelectorAll('[data-view]').forEach((view) => {
    const active = view.dataset.view === viewName;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });

  document.querySelectorAll('[data-view-target]').forEach((button) => {
    button.classList.toggle('active', button.dataset.viewTarget === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const username = document.querySelector('#username').value.trim();
  const password = document.querySelector('#password').value;

  if (username !== 'demo' || password !== 'demo') {
    loginError.textContent = copy('invalidLogin');
    loginError.hidden = false;
    return;
  }

  loginError.hidden = true;
  loginView.hidden = true;
  appView.hidden = false;
  openView('dashboard');
  renderWanState();
});

document.querySelector('#logoutButton').addEventListener('click', () => {
  clearSimulationTimers();
  simulationRunning = false;
  linkStates = { wan0: 'healthy', wan1: 'healthy' };
  appView.hidden = true;
  loginView.hidden = false;
  document.querySelector('#password').focus();
});

loginLanguage.addEventListener('change', (event) => setLanguage(event.target.value));
appLanguage.addEventListener('change', (event) => setLanguage(event.target.value));

document.querySelector('#copyCredentials').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('demo / demo');
    showToast('credentialsCopied');
  } catch {
    showToast('clipboardFallback');
  }
});

document.querySelector('#mapPreviewButton').addEventListener('click', (event) => {
  const preview = document.querySelector('#mapPreview');
  preview.hidden = !preview.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!preview.hidden));
  showToast(preview.hidden ? 'mapClosed' : 'mapOpened');
});

[document.querySelector('#loginSound'), document.querySelector('#appSound')].forEach((button) => {
  button.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    document.querySelectorAll('#loginSound, #appSound').forEach((soundButton) => soundButton.classList.toggle('is-on', soundEnabled));
    showToast(soundEnabled ? 'soundOn' : 'soundOff');
  });
});

document.querySelectorAll('[data-view-target]').forEach((button) => {
  button.addEventListener('click', () => openView(button.dataset.viewTarget));
});

document.querySelectorAll('[data-simulate]').forEach((button) => {
  button.addEventListener('click', () => simulate(button.dataset.simulate));
});

document.querySelectorAll('[data-demo-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.demoAction;
    if (action === 'clear-events') {
      eventList.replaceChildren();
      showToast('clearEvents');
      return;
    }
    showToast(actionMessages[action] || 'demoAction');
    if (actionMessages[action]) {
      addLog('DEMO', 'action=' + action + ' result=success', 'log-blue');
    }
  });
});

document.querySelectorAll('.preset').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.preset').forEach((preset) => preset.classList.remove('active'));
    button.classList.add('active');
    showToast('apply');
  });
});

document.querySelectorAll('.choice').forEach((choice) => {
  choice.addEventListener('click', () => {
    document.querySelectorAll('.choice').forEach((item) => item.classList.remove('active'));
    choice.classList.add('active');
  });
});

document.querySelectorAll('.filter').forEach((filter) => {
  filter.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach((item) => item.classList.remove('active'));
    filter.classList.add('active');
  });
});

document.querySelector('#modeSelect').addEventListener('change', () => showToast('modeChanged'));
document.querySelector('#floatingAurelka').addEventListener('click', () => {
  const states = Object.values(linkStates);
  showToast(states.includes('down') ? (states.every((state) => state === 'down') ? 'bothDown' : 'oneDownMessage') : states.some((state) => state !== 'healthy') ? 'checkingMessage' : 'bothHealthyMessage');
});

try {
  const storedLanguage = localStorage.getItem('smartwan-demo-language');
  if (!new URLSearchParams(window.location.search).has('lang') && (storedLanguage === 'pl' || storedLanguage === 'en')) {
    language = storedLanguage;
  }
} catch {
  // Storage is optional.
}

setLanguage(language);
renderWanState();

