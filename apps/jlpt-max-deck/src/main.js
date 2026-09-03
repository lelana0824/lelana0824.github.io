import './style.css';

import {
  DeckWorkerClient,
  collectionEntry,
  contentType,
  createMediaIndex,
  parseZipIndex,
  readZipEntry,
} from './apkg.js';
import { cardView } from './card-renderer.js';
import {
  buildQueue,
  dayKey,
  reviewLabel,
  scheduleReview,
  streakFromHistory,
} from './scheduler.js';
import {
  DEFAULT_STATE,
  exportProgress,
  importProgress,
  loadDeckMeta,
  loadState,
  persistDeck,
  readPersistedDeck,
  removePersistedDeck,
  saveState,
} from './storage.js';

const EXPECTED_FILENAME = 'JLPT-MAX-Deck-2.1.0.apkg';
const EXPECTED_SIZE = 1_148_894_828;
const RELEASE_URL = `https://github.com/truthyblue/jlpt-max-deck/releases/download/v2.1.0/${EXPECTED_FILENAME}`;
const MODE_LABELS = {
  vocabulary: '어휘',
  grammar: '문법',
  practice: '실전',
};

const app = document.querySelector('#app');
let state = loadState();
let deckFile = null;
let mediaEntries = null;
let cardIndex = [];
let worker = null;
let sessionCards = [];
let sessionPosition = 0;
let activeCard = null;
let revealed = false;
let installPrompt = null;
const objectUrls = new Map();

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date);
}

function formatBytes(bytes) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)}GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${Math.round(bytes / 1000)}KB`;
}

function icon(name) {
  const icons = {
    home: '<path d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8Z"/>',
    study: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 15A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 18.5"/>',
    settings: '<path d="M12 15.3a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6Z"/><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a2 2 0 0 1-4 0V19a1.7 1.7 0 0 0-2.9-1.2l-.1.1A2 2 0 0 1 4 15.1l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.2a2 2 0 0 1 0-4H3a1.7 1.7 0 0 0 1.2-2.9L4 5.1a2 2 0 0 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 0 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 0 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.2a2 2 0 0 1 0 4h-.2a1.7 1.7 0 0 0-1.3 2.9Z"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4V5Zm4 4a4 4 0 0 1 0 6m2-9a8 8 0 0 1 0 12"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    download: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M5 21h14"/>',
    upload: '<path d="M12 21V9m0 0 5 5m-5-5-5 5M5 3h14"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || ''}</svg>`;
}

function topbar({ back = false, title = '' } = {}) {
  return `
    <header class="topbar app-topbar">
      ${back ? `<button class="icon-button" type="button" data-action="dashboard" aria-label="홈으로">${icon('close')}</button>` : `
        <a class="brand" href="../index.html" aria-label="JLPT MAX 홈으로">
          <span class="brand-mark" aria-hidden="true">学</span>
          <span><strong>JLPT MAX</strong><small>${title || '모바일 학습'}</small></span>
        </a>`}
      ${back ? `<strong class="view-title">${escapeHtml(title)}</strong>` : ''}
      <span class="local-badge"><i aria-hidden="true"></i> 기기 저장</span>
    </header>
  `;
}

function bottomNav(active = 'home') {
  return `
    <nav class="bottom-nav" aria-label="주요 메뉴">
      <button class="${active === 'home' ? 'is-active' : ''}" type="button" data-action="dashboard">${icon('home')}<span>홈</span></button>
      <button class="${active === 'study' ? 'is-active' : ''}" type="button" data-action="start-study">${icon('study')}<span>학습</span></button>
      <button class="${active === 'settings' ? 'is-active' : ''}" type="button" data-action="settings">${icon('settings')}<span>설정</span></button>
    </nav>
  `;
}

function toast(message, type = 'info') {
  document.querySelector('.toast')?.remove();
  const element = document.createElement('div');
  element.className = `toast toast-${type}`;
  element.setAttribute('role', 'status');
  element.textContent = message;
  document.body.append(element);
  window.setTimeout(() => element.remove(), 4200);
}

function renderWelcome(error = '') {
  app.innerHTML = `
    ${topbar()}
    <main class="shell welcome-shell">
      <section class="welcome-card" aria-labelledby="welcome-title">
        <div class="eyebrow">선택한 급수 집중 학습</div>
        <h1 id="welcome-title">덱은 그대로,<br />공부는 브라우저에서.</h1>
        <p class="welcome-copy">공식 APKG를 이 기기에서 직접 엽니다. 파일과 학습 기록은 외부로 전송되지 않습니다.</p>
        ${error ? `<p class="inline-error" role="alert">${escapeHtml(error)}</p>` : ''}
        <div class="start-actions">
          <label class="button button-primary" for="deck-file">다운로드한 APKG 불러오기</label>
          <input id="deck-file" type="file" accept=".apkg,application/octet-stream" hidden />
          <a class="button button-secondary" href="${RELEASE_URL}">공식 덱 받기 <span aria-hidden="true">↗</span></a>
        </div>
        <div class="trust-row" aria-label="앱 특징">
          <span>업로드 없음</span><span>진도 자동 저장</span><span>홈 화면 설치</span>
        </div>
        <details class="how-it-works">
          <summary>처음 사용하는 순서</summary>
          <ol><li>공식 덱을 기기에 받습니다.</li><li>위의 APKG 불러오기를 누릅니다.</li><li>설정에서 공부할 급수를 선택합니다.</li></ol>
        </details>
      </section>
      <aside class="preview-card is-active" aria-label="학습 카드 미리보기">
        <div class="preview-head"><span>JLPT · 어휘</span><span>미리보기</span></div>
        <div class="preview-word" lang="ja">出す</div>
        <div class="preview-reading" lang="ja">だす</div>
        <div class="preview-rule"></div>
        <div class="preview-meaning">꺼내다 · 제출하다 · 편지를 보내다</div>
        <div class="preview-example"><span lang="ja">宿題を出す。</span><small>숙제를 제출하다.</small></div>
        <button class="preview-flip" type="button" data-action="preview-flip">앞면만 보기</button>
      </aside>
    </main>
  `;
}

function renderLoading(stage, progress = 0) {
  app.innerHTML = `
    ${topbar({ title: '덱 준비 중' })}
    <main class="loading-view">
      <div class="loading-orbit" aria-hidden="true"><span>語</span><i></i></div>
      <p class="eyebrow">기기 안에서 처리 중</p>
      <h1>${escapeHtml(stage)}</h1>
      <p>파일은 어디에도 업로드되지 않습니다. 화면을 닫지 말아 주세요.</p>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"><i style="width:${Math.max(4, progress)}%"></i></div>
      <strong>${Math.round(progress)}%</strong>
    </main>
  `;
}

function currentQueue() {
  return buildQueue(cardIndex, state);
}

function renderDashboard() {
  const queue = currentQueue();
  const today = state.history[dayKey()] || 0;
  const streak = streakFromHistory(state.history);
  const learnedPercent = queue.eligibleCount
    ? Math.round((queue.learnedCount / queue.eligibleCount) * 100)
    : 0;
  const modeLabel = MODE_LABELS[state.mode];
  const saveMeta = loadDeckMeta();

  app.innerHTML = `
    ${topbar()}
    <main class="dashboard">
      <section class="dashboard-hero">
        <div><p class="date-label">${formatDate()}</p><h1>오늘도, 한 장씩.</h1><p><strong>${state.target}</strong> 콘텐츠만 집중해서 공부합니다.</p></div>
        <div class="streak-badge"><span>${streak || '–'}</span><small>연속 학습일</small></div>
      </section>

      <section class="today-panel">
        <div class="today-heading"><div><span class="section-kicker">TODAY</span><h2>오늘의 ${modeLabel}</h2></div><span class="active-level">${queue.activeLevel || state.target}</span></div>
        <div class="metric-grid">
          <article><span>복습</span><strong>${queue.due.length}</strong><small>기억을 다시 확인해요</small></article>
          <article><span>새 카드</span><strong>${queue.fresh.length}</strong><small>하루 목표 ${state.dailyGoal}장</small></article>
          <article><span>오늘 완료</span><strong>${today}</strong><small>채점한 카드</small></article>
        </div>
        <button class="study-cta" type="button" data-action="start-study" ${queue.cards.length ? '' : 'disabled'}>
          <span>${queue.cards.length ? `${queue.cards.length}장 학습 시작` : '오늘 학습 완료'}</span>${icon(queue.cards.length ? 'arrow' : 'check')}
        </button>
      </section>

      <section class="mode-section">
        <div class="section-heading"><div><span class="section-kicker">COURSE</span><h2>학습 코스</h2></div><button type="button" data-action="settings">목표 ${state.target} · ${state.dailyGoal}장</button></div>
        <div class="mode-grid">
          ${Object.entries(MODE_LABELS).map(([mode, label], index) => `
            <button class="mode-card ${state.mode === mode ? 'is-active' : ''}" type="button" data-mode="${mode}">
              <span class="mode-number">0${index + 1}</span><strong>${label}</strong>
              <small>${mode === 'vocabulary' ? '읽기·뜻·예문' : mode === 'grammar' ? '문형·뉘앙스' : '유형별 문제'}</small>
              <i>${state.mode === mode ? '학습 중' : '선택'}</i>
            </button>
          `).join('')}
        </div>
      </section>

      <section class="progress-panel">
        <div><span class="section-kicker">PROGRESS</span><h2>${modeLabel} 진도</h2></div>
        <strong>${learnedPercent}%</strong>
        <div class="wide-progress"><i style="width:${learnedPercent}%"></i></div>
        <p>${queue.learnedCount.toLocaleString()} / ${queue.eligibleCount.toLocaleString()}장 학습</p>
      </section>

      <p id="deck-save-status" class="deck-save-status">${saveMeta ? `${escapeHtml(saveMeta.name)} · 이 기기에 보관됨` : '이 브라우저를 닫기 전까지 덱을 사용할 수 있습니다.'}</p>
    </main>
    ${bottomNav('home')}
  `;
}

function renderStudyLoading() {
  app.innerHTML = `
    ${topbar({ back: true, title: `${MODE_LABELS[state.mode]} 학습` })}
    <main class="study-view"><div class="card-loading"><i></i><p>카드를 여는 중입니다.</p></div></main>
  `;
}

function renderStudyCard() {
  const view = cardView(activeCard, revealed);
  const progress = state.progress[activeCard.id];
  const position = sessionPosition + 1;
  app.innerHTML = `
    ${topbar({ back: true, title: `${MODE_LABELS[state.mode]} 학습` })}
    <main class="study-view">
      <div class="session-progress"><span>${position} / ${sessionCards.length}</span><div><i style="width:${(position / sessionCards.length) * 100}%"></i></div><span>${view.level}</span></div>
      <article class="study-card ${revealed ? 'is-revealed' : ''}">
        <header><span>${escapeHtml(view.level)} · ${escapeHtml(view.title)}</span>${view.audio ? `<button class="sound-button" type="button" data-audio="${escapeHtml(view.audio)}" aria-label="단어 음성 듣기">${icon('sound')}</button>` : ''}</header>
        <div class="study-content">
          <div class="card-front">${view.front}</div>
          ${view.back ? `<div class="answer-divider"><span>정답</span></div><div class="card-back">${view.back}</div>` : ''}
        </div>
      </article>
      ${revealed ? `
        <div class="rating-panel" aria-label="카드 채점">
          <button type="button" data-rating="again"><span>Again</span><small>${reviewLabel(progress, 'again')}</small></button>
          <button type="button" data-rating="hard"><span>Hard</span><small>${reviewLabel(progress, 'hard')}</small></button>
          <button type="button" data-rating="good"><span>Good</span><small>${reviewLabel(progress, 'good')}</small></button>
          <button type="button" data-rating="easy"><span>Easy</span><small>${reviewLabel(progress, 'easy')}</small></button>
        </div>
      ` : `<button class="reveal-button" type="button" data-action="reveal">정답 보기 <kbd>Space</kbd></button>`}
    </main>
  `;
  hydrateCardMedia();
}

function renderSessionComplete() {
  const today = state.history[dayKey()] || 0;
  app.innerHTML = `
    ${topbar({ back: true, title: '학습 완료' })}
    <main class="complete-view">
      <div class="complete-mark">${icon('check')}</div>
      <p class="eyebrow">TODAY COMPLETE</p>
      <h1>오늘 분량을<br />마쳤습니다.</h1>
      <p>오늘 ${today}장을 채점했습니다. 내일 복습할 카드는 자동으로 다시 나타납니다.</p>
      <button class="button button-primary" type="button" data-action="dashboard">홈으로 돌아가기</button>
    </main>
    ${bottomNav('home')}
  `;
}

function renderSettings() {
  const deckMeta = loadDeckMeta();
  app.innerHTML = `
    ${topbar({ back: true, title: '설정' })}
    <main class="settings-view">
      <section class="settings-hero"><span class="section-kicker">PREFERENCES</span><h1>내 학습 설정</h1><p>이 브라우저에만 저장되며 다른 기기와 자동 동기화되지 않습니다.</p></section>

      <section class="settings-card">
        <div class="setting-row"><label for="target-level"><strong>목표 급수</strong><small>선택한 급수의 카드만 공부합니다.</small></label><select id="target-level">${['N5','N4','N3','N2','N1'].map((level) => `<option ${state.target === level ? 'selected' : ''}>${level}</option>`).join('')}</select></div>
        <div class="setting-row"><label for="daily-goal"><strong>하루 새 카드</strong><small>복습이 밀리면 먼저 복습을 끝내세요.</small></label><select id="daily-goal">${[10,20,30,50].map((count) => `<option value="${count}" ${state.dailyGoal === count ? 'selected' : ''}>${count}장</option>`).join('')}</select></div>
      </section>

      <section class="settings-group"><h2>앱과 데이터</h2>
        <div class="settings-card action-list">
          <button type="button" data-action="install"><span>${icon('download')}<span><strong>홈 화면에 설치</strong><small>일반 앱처럼 빠르게 엽니다.</small></span></span>${icon('arrow')}</button>
          <button type="button" data-action="export-progress"><span>${icon('upload')}<span><strong>학습 기록 내보내기</strong><small>진도와 설정을 JSON 파일로 보관합니다.</small></span></span>${icon('arrow')}</button>
          <label for="progress-file"><span>${icon('download')}<span><strong>학습 기록 가져오기</strong><small>이 브라우저의 현재 기록을 교체합니다.</small></span></span>${icon('arrow')}</label>
          <input id="progress-file" type="file" accept="application/json,.json" hidden />
        </div>
      </section>

      <section class="settings-group"><h2>공식 덱</h2>
        <div class="deck-info-card"><div>${icon('lock')}<span><strong>${escapeHtml(deckMeta?.name || deckFile?.name || EXPECTED_FILENAME)}</strong><small>${formatBytes(deckMeta?.size || deckFile?.size || EXPECTED_SIZE)} · 업로드 없음</small></span></div><span>${deckMeta ? '기기 보관됨' : '현재 세션'}</span></div>
        <div class="danger-actions"><button type="button" data-action="remove-deck">기기에서 덱 제거</button><button type="button" data-action="reset-progress">학습 기록 초기화</button></div>
      </section>
      <p class="license-note">카드 내용과 음성은 JLPT MAX 공식 APKG에서 기기 내에서만 읽습니다. 앱은 Anki·JLPT 시험 운영기관의 공식 제품이 아닙니다.</p>
    </main>
    ${bottomNav('settings')}
  `;
}

async function loadDeck(file, { shouldPersist = false } = {}) {
  if (!file.name.toLowerCase().endsWith('.apkg')) {
    throw new Error('.apkg 형식의 공식 덱 파일을 선택해 주세요.');
  }
  if (file.size < 100_000) throw new Error('선택한 APKG 파일이 너무 작습니다.');
  renderLoading('덱 구조를 확인하고 있습니다.', 8);
  const entries = await parseZipIndex(file);
  const collection = collectionEntry(entries);
  if (!collection) throw new Error('APKG에서 Anki 컬렉션을 찾지 못했습니다.');
  renderLoading('음성 색인을 준비하고 있습니다.', 22);
  const media = await createMediaIndex(file, entries);
  renderLoading('카드 38,967장을 정리하고 있습니다.', 38);
  worker?.close();
  worker = new DeckWorkerClient();
  const loaded = await worker.load(file, collection);
  deckFile = file;
  mediaEntries = media;
  cardIndex = loaded.index;
  renderDashboard();

  if (shouldPersist) {
    persistDeck(file, (ratio) => {
      const status = document.querySelector('#deck-save-status');
      if (status) status.textContent = `다음에도 바로 열 수 있도록 덱 저장 중 · ${Math.round(ratio * 100)}%`;
    }).then((saved) => {
      const status = document.querySelector('#deck-save-status');
      if (status && saved) status.textContent = `${file.name} · 이 기기에 보관됨`;
    }).catch((error) => {
      const status = document.querySelector('#deck-save-status');
      if (status) status.textContent = '덱을 영구 보관하지 못했습니다. 다음에 APKG를 다시 선택해 주세요.';
      toast(error.message, 'error');
    });
  }
}

async function startStudy() {
  const queue = currentQueue();
  sessionCards = queue.cards;
  sessionPosition = 0;
  if (!sessionCards.length) {
    renderSessionComplete();
    return;
  }
  await openSessionCard();
}

async function openSessionCard() {
  const card = sessionCards[sessionPosition];
  if (!card) {
    renderSessionComplete();
    return;
  }
  renderStudyLoading();
  try {
    activeCard = await worker.getCard(card[0]);
    revealed = false;
    renderStudyCard();
  } catch (error) {
    toast(error.message, 'error');
    renderDashboard();
  }
}

function rateCard(rating) {
  if (!activeCard) return;
  const wasNew = !state.progress[activeCard.id];
  state.progress[activeCard.id] = scheduleReview(state.progress[activeCard.id], rating);
  const today = dayKey();
  state.history[today] = (state.history[today] || 0) + 1;
  if (wasNew) state.newHistory[today] = (state.newHistory[today] || 0) + 1;
  try {
    saveState(state);
  } catch {
    toast('브라우저 저장 공간이 부족해 학습 기록을 저장하지 못했습니다.', 'error');
    return;
  }
  sessionPosition += 1;
  openSessionCard();
}

async function playMedia(filename, button) {
  if (!filename || !deckFile || !mediaEntries) return;
  button?.classList.add('is-loading');
  try {
    let url = objectUrls.get(filename);
    if (!url) {
      const entry = mediaEntries.get(filename);
      if (!entry) throw new Error('APKG에서 해당 음성을 찾지 못했습니다.');
      const bytes = await readZipEntry(deckFile, entry);
      url = URL.createObjectURL(new Blob([bytes], { type: contentType(filename) }));
      objectUrls.set(filename, url);
      if (objectUrls.size > 16) {
        const oldest = objectUrls.keys().next().value;
        URL.revokeObjectURL(objectUrls.get(oldest));
        objectUrls.delete(oldest);
      }
    }
    const audio = new Audio(url);
    await audio.play();
  } catch (error) {
    toast(error.message || '음성을 재생하지 못했습니다.', 'error');
  } finally {
    button?.classList.remove('is-loading');
  }
}

function hydrateCardMedia() {
  const container = document.querySelector('.study-content');
  if (!container) return;
  container.querySelectorAll('audio[src]').forEach((audio) => {
    const filename = audio.getAttribute('src');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-audio';
    button.dataset.audio = filename;
    button.setAttribute('aria-label', '음성 듣기');
    button.innerHTML = `${icon('sound')} 듣기`;
    audio.replaceWith(button);
  });
  container.querySelectorAll('img[src]').forEach(async (image) => {
    const filename = image.getAttribute('src');
    const entry = mediaEntries?.get(filename);
    if (!entry) {
      image.remove();
      return;
    }
    try {
      const bytes = await readZipEntry(deckFile, entry);
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType(filename) }));
      objectUrls.set(`image:${filename}`, url);
      image.src = url;
    } catch {
      image.remove();
    }
  });
}

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  toast('브라우저 메뉴의 “홈 화면에 추가” 또는 “앱 설치”를 선택해 주세요.');
}

app.addEventListener('click', async (event) => {
  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) {
    state.mode = modeButton.dataset.mode;
    saveState(state);
    renderDashboard();
    return;
  }
  const ratingButton = event.target.closest('[data-rating]');
  if (ratingButton) {
    rateCard(ratingButton.dataset.rating);
    return;
  }
  const audioButton = event.target.closest('[data-audio]');
  if (audioButton) {
    playMedia(audioButton.dataset.audio, audioButton);
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'dashboard') renderDashboard();
  else if (action === 'start-study') startStudy();
  else if (action === 'settings') renderSettings();
  else if (action === 'reveal') {
    revealed = true;
    renderStudyCard();
  } else if (action === 'preview-flip') {
    const card = document.querySelector('.preview-card');
    card?.classList.toggle('is-active');
    event.target.textContent = card?.classList.contains('is-active') ? '앞면만 보기' : '정답 보기';
  } else if (action === 'install') installApp();
  else if (action === 'export-progress') {
    downloadText(`jlpt-max-progress-${dayKey()}.json`, exportProgress(state));
  } else if (action === 'remove-deck') {
    if (window.confirm('이 기기에 보관한 APKG를 제거할까요? 학습 기록은 남아 있습니다.')) {
      await removePersistedDeck();
      worker?.close();
      deckFile = null;
      cardIndex = [];
      renderWelcome();
      toast('기기에 보관한 덱을 제거했습니다. 다시 불러올 수 있습니다.');
    }
  } else if (action === 'reset-progress') {
    if (window.confirm('모든 학습 진도와 복습 일정을 초기화할까요? 내보내지 않은 기록은 복구할 수 없습니다.')) {
      state = { ...DEFAULT_STATE, progress: {}, history: {}, newHistory: {}, target: state.target, dailyGoal: state.dailyGoal, mode: state.mode };
      saveState(state);
      renderSettings();
      toast('학습 기록을 초기화했습니다.');
    }
  }
});

app.addEventListener('change', async (event) => {
  if (event.target.id === 'deck-file') {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await loadDeck(file, { shouldPersist: true });
      if (file.name !== EXPECTED_FILENAME || file.size !== EXPECTED_SIZE) {
        toast('공식 v2.1.0과 파일 이름 또는 크기가 다릅니다. 카드 수를 확인해 주세요.');
      }
    } catch (error) {
      renderWelcome(error.message);
    }
  } else if (event.target.id === 'target-level') {
    state.target = event.target.value;
    saveState(state);
    toast(`목표 급수를 ${state.target}로 바꿨습니다.`);
  } else if (event.target.id === 'daily-goal') {
    state.dailyGoal = Number(event.target.value);
    saveState(state);
    toast(`하루 새 카드를 ${state.dailyGoal}장으로 바꿨습니다.`);
  } else if (event.target.id === 'progress-file') {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      state = importProgress(await file.text());
      saveState(state);
      renderSettings();
      toast('학습 기록을 가져왔습니다.');
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});

window.addEventListener('keydown', (event) => {
  if (!activeCard || !document.querySelector('.study-view')) return;
  if (event.code === 'Space' && !revealed) {
    event.preventDefault();
    revealed = true;
    renderStudyCard();
  }
  if (revealed && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(event.code)) {
    rateCard(['again', 'hard', 'good', 'easy'][Number(event.code.at(-1)) - 1]);
  }
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});

async function boot() {
  renderLoading('저장된 덱을 확인하고 있습니다.', 5);
  const persisted = await readPersistedDeck();
  if (!persisted) {
    renderWelcome();
    return;
  }
  try {
    await loadDeck(persisted);
  } catch (error) {
    await removePersistedDeck();
    renderWelcome(`저장된 덱을 열지 못했습니다: ${error.message}`);
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
}

boot();
