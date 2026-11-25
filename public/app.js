const $ = (id) => document.getElementById(id);

const PHASE_LABELS = {
  idle: 'Готово',
  starting: 'Старт',
  solving: 'Поиск решения',
  playing: 'Играем',
  won: 'Победа',
  failed: 'Не вышло',
  error: 'Ошибка',
  stopped: 'Остановлено',
  login: 'Ожидаем вход',
  'logged-in': 'Вы вошли',
};

let currentStatus = { phase: 'idle', running: false };

/** Electron-приложение встраивает игру в #gameSlot через WebContentsView. */
function syncEmbeddedGame() {
  if (!window.desktop?.setEmbeddedGameBounds || !$('gameSlot')) return;
  const slot = $('gameSlot');
  const rect = slot.getBoundingClientRect();
  window.desktop.setEmbeddedGameBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  });
}

function setupEmbeddedDesktop(info) {
  if (!info?.embeddedGame) return;
  document.body.classList.add('desktop-embedded');
  $('embeddedNote').classList.remove('hidden');
  $('toggleGameBtn').addEventListener('click', () => {
    const collapsed = document.body.classList.toggle('game-collapsed');
    $('toggleGameBtn').textContent = collapsed ? 'Показать игру' : 'Скрыть игру';
    syncEmbeddedGame();
  });
  syncEmbeddedGame();
  window.addEventListener('resize', syncEmbeddedGame);
  window.addEventListener('scroll', syncEmbeddedGame, true);
  if (window.ResizeObserver) new ResizeObserver(syncEmbeddedGame).observe($('gameSlot'));
}

function addLog(line) {
  const log = $('log');
  const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  log.textContent += `[${time}] ${line}\n`;
  while (log.textContent.length > 40000) {
    log.textContent = log.textContent.slice(log.textContent.indexOf('\n') + 1);
  }
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  $('log').textContent = '';
}

function applyStatus(status) {
  currentStatus = status;
  const phase = status.phase || 'idle';
  const badge = $('statusBadge');

  badge.textContent = PHASE_LABELS[phase] || phase;
  badge.className = 'badge';
  if (phase === 'won' || phase === 'logged-in') badge.classList.add('good');
  else if (phase === 'failed' || phase === 'error') badge.classList.add('bad');
  else if (phase === 'login') badge.classList.add('wait');
  else if (status.running) badge.classList.add('running');

  $('message').textContent = status.message || '';
  $('deckValue').textContent = status.deck
    ? `${status.deck.slice(0, 14)}… (${status.deck.length})`
    : '—';
  if (status.deck) $('deckValue').title = status.deck;

  $('solutionValue').textContent = status.solutionMoves ? `${status.solutionMoves} ходов` : '—';
  $('movesValue').textContent = `${status.executed || 0} / ${status.total || 0}`;
  $('attemptValue').textContent = status.totalGames
    ? `${status.gameNo || 0} / ${status.totalGames}`
    : '—';
  $('foundationsValue').textContent = `${status.foundations || 0} / 8`;
  $('winnerValue').textContent = status.winner === true
    ? 'да'
    : (status.winner === false ? 'нет' : '—');

  const pct = status.total ? Math.round((status.executed / status.total) * 100) : 0;
  $('progressBar').style.width = `${pct}%`;

  const busy = Boolean(status.running) && phase !== 'login';
  $('startBtn').disabled = busy;
  $('loginBtn').disabled = Boolean(status.running);
  $('stopBtn').disabled = !status.running;
  $('confirmBtn').classList.toggle('hidden', phase !== 'login');
}

async function post(url, body = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

$('mode').addEventListener('change', () => {
  $('deckField').classList.toggle('hidden', $('mode').value !== 'deck');
});

$('startBtn').addEventListener('click', async () => {
  const body = {
    mode: $('mode').value,
    deck: $('deck').value.trim(),
    games: Number($('games').value),
    attempts: Number($('attempts').value),
    maxNodes: Number($('maxNodes').value),
    timeout: Number($('timeout').value),
    headless: $('headless').checked,
  };
  if (body.mode === 'deck' && body.deck.length !== 104) {
    alert('Код колоды должен содержать ровно 104 символа');
    return;
  }
  clearLog();
  try {
    await post('/api/start', body);
  } catch (err) {
    addLog(`Ошибка запуска: ${err.message}`);
  }
});

$('loginBtn').addEventListener('click', async () => {
  try {
    await post('/api/login');
  } catch (err) {
    addLog(`Ошибка входа: ${err.message}`);
  }
});

$('confirmBtn').addEventListener('click', async () => {
  try {
    await post('/api/confirm-login');
  } catch (err) {
    addLog(`Ошибка подтверждения: ${err.message}`);
  }
});

$('stopBtn').addEventListener('click', async () => {
  try {
    await post('/api/stop');
  } catch (err) {
    addLog(`Ошибка остановки: ${err.message}`);
  }
});

const events = new EventSource('/api/events');
events.onmessage = (event) => {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'status') applyStatus(msg.status);
    else if (msg.type === 'log') addLog(msg.line);
  } catch {
    // игнорируем битые сообщения
  }
};
events.onerror = () => {
  $('message').textContent = 'Соединение потеряно, переподключение...';
};

addLog('Интерфейс готов. Выберите режим и нажмите «Запустить».');

if (window.desktop?.getInfo) {
  window.desktop.getInfo().then((info) => {
    setupEmbeddedDesktop(info);
    const el = $('appVersion');
    if (!el || !info?.version) return;
    el.textContent = `Desktop ${info.version}`;
    el.title = info.profile || '';
    el.classList.remove('hidden');
  }).catch(() => {
    // Веб-версия работает без desktop API — просто не показываем версию.
  });
}
