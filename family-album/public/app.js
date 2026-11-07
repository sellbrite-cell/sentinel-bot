/* 가족 앨범 프런트엔드 (프레임워크 없이 순수 JS) */
'use strict';

// ---------- 공통 ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const deviceId = (() => {
  let id = LS.get('fa.device');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()); LS.set('fa.device', id); }
  return id;
})();
const myUploads = new Set(LS.get('fa.mine', []));
const rememberMine = (id) => { myUploads.add(id); LS.set('fa.mine', [...myUploads].slice(-5000)); };

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'x-device-id': deviceId }, credentials: 'same-origin' };
  if (opts.body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const res = await fetch('api/' + path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '문제가 생겼어요.');
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return iso;
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
};
const fmtMonth = (iso) => { const d = new Date(iso); return `${d.getFullYear()}년 ${d.getMonth() + 1}월`; };
const yearOf = (s) => (s ? String(s).slice(0, 4) : '');
const lifeSpan = (p) => {
  const b = yearOf(p.birth), d = yearOf(p.death);
  if (b && d) return `${b} – ${d}`;
  if (b) return `${b}년생`;
  if (d) return `– ${d}`;
  return '';
};

// ---------- 상태 ----------
const state = { me: null, albums: [], people: [], peopleById: new Map() };
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

async function loadPeople() {
  const { people } = await api('people');
  state.people = people.sort((a, b) => (a.birth || '9999').localeCompare(b.birth || '9999') || a.name.localeCompare(b.name, 'ko'));
  state.peopleById = new Map(people.map((p) => [p.id, p]));
}
async function loadAlbums() {
  const r = await api('albums');
  state.albums = r.albums; state.totalPhotos = r.totalPhotos;
}

// ---------- 레이아웃 ----------
function setChrome({ title, back = false, tab = null, fab = false, actions = '' }) {
  $('#title').textContent = title;
  document.title = title === state.me?.siteName ? `${title} 앨범` : `${title} · ${state.me?.siteName || '가족'} 앨범`;
  $('#back-btn').hidden = !back;
  $('#top-actions').innerHTML = actions;
  $('#fab').hidden = !fab;
  $('#tabbar').hidden = !state.me?.role;
  $$('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
}

$('#back-btn').addEventListener('click', () => {
  if (history.length > 1 && sessionStorage.getItem('fa.nav')) history.back();
  else location.hash = '#/';
});

// ---------- 라우터 ----------
const routes = [
  [/^#?\/?$/, viewAlbums],
  [/^#\/photos$/, () => viewPhotos({})],
  [/^#\/album\/([\w-]+)$/, (m) => viewPhotos({ albumId: m[1] })],
  [/^#\/unsorted$/, () => viewPhotos({ albumId: 'none' })],
  [/^#\/tree(?:\?(.*))?$/, (m) => viewTree(new URLSearchParams(m[1] || ''))],
  [/^#\/person\/([\w-]+)$/, (m) => viewPerson(m[1])],
  [/^#\/more$/, viewMore],
];

async function route() {
  closeAllSheets();
  const hash = location.hash || '#/';
  if (!state.me?.role) return viewLocked();
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) {
      try { await fn(m); } catch (e) { $('#view').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
      window.scrollTo(0, 0);
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', () => { sessionStorage.setItem('fa.nav', '1'); route(); });

// ---------- 잠금 화면 ----------
function viewLocked() {
  setChrome({ title: state.me?.siteName || '가족 앨범' });
  $('#tabbar').hidden = true;
  $('#view').innerHTML = `
    <div class="locked">
      <img src="icons/icon.svg" alt="" class="locked-logo">
      <h2>가족만 볼 수 있는 앨범이에요</h2>
      <p>가족에게 받은 <b>공유 링크</b>로 들어와 주세요.</p>
      <details class="admin-login">
        <summary>관리자 로그인</summary>
        <form id="login-form">
          <input type="password" name="password" placeholder="관리자 비밀번호" autocomplete="current-password" required>
          <button class="btn primary">로그인</button>
        </form>
      </details>
    </div>`;
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('admin/login', { method: 'POST', body: { password: e.target.password.value } }); await boot(); }
    catch (err) { toast(err.message); }
  });
}

// ---------- 앨범 목록 ----------
async function viewAlbums() {
  setChrome({ title: state.me.siteName, tab: 'albums', fab: true });
  const view = $('#view');
  view.innerHTML = '<div class="loading"></div>';
  await loadAlbums();
  const albumsHtml = state.albums.map((a) => `
    <a class="album-card" href="#/album/${a.id}">
      <div class="album-cover">${a.coverId ? `<img loading="lazy" src="media/${a.coverId}/thumb" alt="">` : '<div class="cover-empty"></div>'}</div>
      <div class="album-meta">
        <b>${esc(a.title)}</b>
        <span>${a.date ? esc(fmtDate(a.date)) + ' · ' : ''}${a.count}장</span>
      </div>
    </a>`).join('');
  view.innerHTML = `
    <section class="hero">
      <div>
        <p class="hero-sub">우리 가족의 기록</p>
        <h2>${esc(state.me.siteName)}</h2>
        <p class="hero-count">사진·영상 ${state.totalPhotos.toLocaleString()}개 · 앨범 ${state.albums.length}개</p>
      </div>
      <button class="btn primary" id="hero-upload">사진 올리기</button>
    </section>
    <div id="install-slot"></div>
    <div class="section-head">
      <h3>앨범</h3>
      <button class="btn ghost small" id="new-album">+ 새 앨범</button>
    </div>
    ${state.albums.length ? `<div class="album-grid">${albumsHtml}</div>` : `
      <div class="empty"><p>아직 앨범이 없어요.<br>"새 앨범"으로 첫 앨범을 만들어 보세요.<br><small>예: 2026 추석, 할머니 팔순</small></p></div>`}
    <a class="link-row" href="#/unsorted">앨범에 넣지 않은 사진 보기 ›</a>`;
  $('#hero-upload').onclick = () => openUpload();
  $('#new-album').onclick = async () => { const a = await albumForm(); if (a) location.hash = `#/album/${a.id}`; };
  renderInstallHint($('#install-slot'));
}

async function albumForm(album) {
  const r = await sheet(`
    <h3>${album ? '앨범 수정' : '새 앨범'}</h3>
    <form class="form">
      <label>앨범 이름<input name="title" maxlength="80" required value="${esc(album?.title)}" placeholder="예: 2026 제주 가족여행"></label>
      <label><span>날짜 <small>(선택)</small></span><input name="date" type="date" value="${esc(album?.date)}"></label>
      <label><span>설명 <small>(선택)</small></span><textarea name="description" rows="3" maxlength="1000">${esc(album?.description)}</textarea></label>
      <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">${album ? '저장' : '만들기'}</button></div>
    </form>`, { form: true });
  if (!r) return null;
  const body = { title: r.title, date: r.date, description: r.description, createdBy: LS.get('fa.name', '') };
  try {
    return album ? await api(`albums/${album.id}`, { method: 'PATCH', body }) : await api('albums', { method: 'POST', body });
  } catch (e) { toast(e.message); return null; }
}

// ---------- 사진 그리드 ----------
let currentList = [];
async function viewPhotos({ albumId }) {
  const view = $('#view');
  view.innerHTML = '<div class="loading"></div>';
  let album = null;
  if (albumId && albumId !== 'none') {
    await loadAlbums();
    album = state.albums.find((a) => a.id === albumId);
    if (!album) throw new Error('앨범을 찾을 수 없어요.');
  }
  const title = album ? album.title : albumId === 'none' ? '앨범 없는 사진' : '모든 사진';
  const isAdmin = state.me.role === 'admin';
  setChrome({
    title, back: !!albumId, tab: albumId ? 'albums' : 'photos', fab: true,
    actions: album ? `<button class="icon-btn" id="album-menu" aria-label="앨범 설정"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>` : '',
  });
  if (!state.people.length) await loadPeople().catch(() => {});
  const q = albumId ? `?album=${albumId}` : '';
  const { photos } = await api('photos' + q);
  currentList = photos;

  view.innerHTML = `
    ${album ? `<div class="album-head">${album.date ? `<span class="pill">${esc(fmtDate(album.date))}</span>` : ''}${album.description ? `<p>${esc(album.description)}</p>` : ''}<p class="muted">${photos.length}장</p></div>` : ''}
    <div id="grid"></div>`;
  if (!photos.length) {
    $('#grid').innerHTML = `<div class="empty"><p>아직 사진이 없어요.</p><button class="btn primary" id="empty-up">첫 사진 올리기</button></div>`;
    $('#empty-up').onclick = () => openUpload(album?.id);
  } else {
    renderGrid($('#grid'), photos, { groupByMonth: !album });
  }
  $('#fab').onclick = () => openUpload(album?.id);
  if (album) {
    $('#album-menu').onclick = async () => {
      const act = await actionSheet([
        ['edit', '앨범 이름·날짜 바꾸기'],
        ['share', '이 앨범 링크 보내기'],
        ...(isAdmin ? [['delete', '앨범 삭제 (사진은 남겨둬요)', 'danger']] : []),
      ]);
      if (act === 'edit') { if (await albumForm(album)) route(); }
      if (act === 'share') shareLink(`${shareBase()}#/album/${album.id}`, album.title);
      if (act === 'delete' && confirm(`'${album.title}' 앨범을 삭제할까요?\n사진은 '앨범 없는 사진'으로 옮겨져요.`)) {
        await api(`albums/${album.id}`, { method: 'DELETE' }); location.hash = '#/';
      }
    };
  }
  $('#fab').hidden = false;
}

// 많은 사진도 부드럽게: 200장씩 이어서 그림
function renderGrid(container, photos, { groupByMonth = false } = {}) {
  container.innerHTML = '';
  const CHUNK = 200;
  let i = 0, lastMonth = null, grid = null;
  const sentinel = h('<div class="grid-sentinel"></div>');
  const more = () => {
    const end = Math.min(i + CHUNK, photos.length);
    for (; i < end; i++) {
      const p = photos[i];
      const month = groupByMonth ? fmtMonth(p.takenAt || p.uploadedAt) : null;
      if (!grid || (groupByMonth && month !== lastMonth)) {
        if (groupByMonth) container.insertBefore(h(`<h4 class="month">${month}</h4>`), sentinel);
        grid = h('<div class="photo-grid"></div>');
        container.insertBefore(grid, sentinel);
        lastMonth = month;
      }
      grid.appendChild(tile(p, i));
    }
    if (i >= photos.length) io.disconnect();
  };
  const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && more(), { rootMargin: '800px' });
  container.appendChild(sentinel);
  more();
  io.observe(sentinel);
  container.onclick = (e) => {
    const t = e.target.closest('.tile'); if (!t) return;
    openLightbox(photos, +t.dataset.idx);
  };
}

function tile(p, idx) {
  const el = h(`<button class="tile" data-idx="${idx}" aria-label="${esc(p.caption || p.origName || '사진')}"></button>`);
  if (p.type === 'video') el.classList.add('is-video');
  if (p.hasThumb || p.type === 'image') {
    const img = new Image(); img.loading = 'lazy'; img.decoding = 'async'; img.alt = '';
    img.src = `media/${p.id}/thumb`;
    img.onerror = () => { img.remove(); el.classList.add('no-thumb'); };
    el.appendChild(img);
  } else el.classList.add('no-thumb');
  if (p.type === 'video') el.appendChild(h('<span class="play-badge"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>'));
  return el;
}

// ---------- 라이트박스 ----------
function openLightbox(list, index) {
  let i = index;
  const isAdmin = state.me.role === 'admin';
  const lb = h(`
    <div class="lightbox" role="dialog" aria-modal="true">
      <div class="lb-top">
        <button class="icon-btn light" data-act="close" aria-label="닫기"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <span class="lb-count"></span>
        <button class="icon-btn light" data-act="menu" aria-label="더보기"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>
      </div>
      <div class="lb-stage"></div>
      <button class="lb-nav prev" data-act="prev" aria-label="이전"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
      <button class="lb-nav next" data-act="next" aria-label="다음"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="lb-info"></div>
    </div>`);
  document.body.appendChild(lb);
  document.body.classList.add('no-scroll');
  history.pushState({ lb: true }, '');

  const stage = $('.lb-stage', lb);
  const render = () => {
    const p = list[i];
    $('.lb-count', lb).textContent = `${i + 1} / ${list.length}`;
    stage.innerHTML = '';
    if (p.type === 'video') {
      const v = h(`<video controls playsinline preload="metadata" ${p.hasThumb ? `poster="media/${p.id}/thumb"` : ''}></video>`);
      v.src = `media/${p.id}/view`;
      stage.appendChild(v);
    } else {
      const img = new Image(); img.alt = p.caption || '';
      if (p.hasThumb) { img.src = `media/${p.id}/thumb`; img.classList.add('blur'); }
      const full = new Image();
      full.onload = () => { img.src = full.src; img.classList.remove('blur'); };
      full.src = `media/${p.id}/view`;
      if (!p.hasThumb) img.src = full.src;
      stage.appendChild(img);
    }
    const people = (p.people || []).map((id) => state.peopleById.get(id)).filter(Boolean);
    $('.lb-info', lb).innerHTML = `
      ${p.caption ? `<p class="lb-caption">${esc(p.caption)}</p>` : ''}
      <div class="lb-tags">${people.map((x) => `<a class="tag" href="#/person/${x.id}">${esc(x.name)}</a>`).join('')}
        <button class="tag add" data-act="tag">+ 사람 태그</button></div>
      <p class="lb-meta">${esc(fmtDate(p.takenAt))}${p.uploader ? ` · ${esc(p.uploader)} 님이 올림` : ''}</p>`;
    $('.lb-nav.prev', lb).hidden = i === 0;
    $('.lb-nav.next', lb).hidden = i === list.length - 1;
    // 다음 사진 미리 불러오기
    const n = list[i + 1]; if (n && n.type === 'image') { const pre = new Image(); pre.src = `media/${n.id}/view`; }
  };
  const go = (d) => { const ni = i + d; if (ni >= 0 && ni < list.length) { i = ni; render(); } };
  const close = () => {
    lb.remove(); document.body.classList.remove('no-scroll');
    window.removeEventListener('popstate', onPop); document.removeEventListener('keydown', onKey);
  };
  const onPop = () => close();
  const onKey = (e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); if (e.key === 'Escape') history.back(); };
  window.addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);

  lb.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const p = list[i];
    if (act === 'close') history.back();
    if (act === 'prev') go(-1);
    if (act === 'next') go(1);
    if (act === 'tag') { const ids = await pickPeople(p.people || []); if (ids) { Object.assign(p, await api(`photos/${p.id}`, { method: 'PATCH', body: { people: ids } })); render(); } }
    if (act === 'menu') {
      const canDelete = isAdmin || myUploads.has(p.id);
      const a = await actionSheet([
        ['caption', '설명 쓰기'],
        ['move', '다른 앨범으로 옮기기'],
        ...(p.albumId ? [['cover', '앨범 대표 사진으로']] : []),
        ...(p.type === 'image' && state.people.length ? [['avatar', '가계도 프로필 사진으로']] : []),
        ['download', '원본 저장'],
        ...(canDelete ? [['delete', '삭제', 'danger']] : []),
      ]);
      try {
        if (a === 'caption') {
          const r = await sheet(`<h3>설명</h3><form class="form"><textarea name="caption" rows="4" maxlength="1000" placeholder="언제, 어디서, 누구와?">${esc(p.caption)}</textarea>
            <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">저장</button></div></form>`, { form: true });
          if (r) { Object.assign(p, await api(`photos/${p.id}`, { method: 'PATCH', body: { caption: r.caption } })); render(); }
        }
        if (a === 'move') {
          await loadAlbums();
          const target = await actionSheet([['', '앨범 없음'], ...state.albums.map((x) => [x.id, x.title])]);
          if (target !== null) { Object.assign(p, await api(`photos/${p.id}`, { method: 'PATCH', body: { albumId: target } })); toast('옮겼어요'); }
        }
        if (a === 'cover') { await api(`albums/${p.albumId}`, { method: 'PATCH', body: { coverId: p.id } }); toast('대표 사진으로 정했어요'); }
        if (a === 'avatar') {
          const who = await actionSheet(state.people.map((x) => [x.id, x.name]));
          if (who) {
            const blob = await squareFromUrl(`media/${p.id}/view`, 400);
            await uploadAvatar(who, blob); toast('프로필 사진을 바꿨어요');
          }
        }
        if (a === 'download') { const l = document.createElement('a'); l.href = `media/${p.id}/original`; l.download = p.origName || ''; l.click(); }
        if (a === 'delete' && confirm('이 사진을 삭제할까요? 되돌릴 수 없어요.')) {
          await api(`photos/${p.id}`, { method: 'DELETE' });
          list.splice(i, 1);
          if (!list.length) { history.back(); route(); return; }
          i = Math.min(i, list.length - 1); render(); toast('삭제했어요');
          lb.dataset.dirty = '1';
        }
      } catch (err) { toast(err.message); }
    }
  });

  // 스와이프
  let sx = 0, sy = 0, tracking = false;
  stage.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) { tracking = false; return; } tracking = true; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (!tracking) return; tracking = false;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (dy > 120 && Math.abs(dy) > Math.abs(dx) * 2) history.back();
  });
  render();
}

// ---------- 업로드 ----------
const uploadQueue = { items: [], running: 0, el: null };

async function openUpload(albumId) {
  await loadAlbums();
  const name = LS.get('fa.name', '');
  const opts = state.albums.map((a) => `<option value="${a.id}" ${a.id === albumId ? 'selected' : ''}>${esc(a.title)}</option>`).join('');
  const r = await sheet(`
    <h3>사진·동영상 올리기</h3>
    <form class="form">
      <label>올리는 사람<input name="uploader" maxlength="40" value="${esc(name)}" placeholder="예: 큰딸 지은" required></label>
      <label>앨범
        <select name="albumId">
          <option value="">앨범 없이 올리기</option>
          ${opts}
          <option value="__new">+ 새 앨범 만들기</option>
        </select>
      </label>
      <label class="new-album-field" hidden>새 앨범 이름<input name="newAlbum" maxlength="80" placeholder="예: 2026 추석"></label>
      <label class="file-drop">
        <input type="file" name="files" accept="image/*,video/*" multiple required>
        <svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
        <span class="file-label">눌러서 사진 고르기<br><small>여러 장 한 번에 고를 수 있어요</small></span>
      </label>
      <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">올리기</button></div>
    </form>`, {
    form: true,
    onMount(root) {
      const sel = $('select[name=albumId]', root);
      const nf = $('.new-album-field', root);
      sel.onchange = () => { nf.hidden = sel.value !== '__new'; $('input', nf).required = sel.value === '__new'; };
      const fi = $('input[type=file]', root);
      fi.onchange = () => { $('.file-label', root).innerHTML = fi.files.length ? `<b>${fi.files.length}개</b> 선택됨<br><small>다시 누르면 바꿀 수 있어요</small>` : '눌러서 사진 고르기'; };
    },
    collect(form) { return { uploader: form.uploader.value.trim(), albumId: form.albumId.value, newAlbum: form.newAlbum.value.trim(), files: [...form.files.files] }; },
  });
  if (!r || !r.files.length) return;
  LS.set('fa.name', r.uploader);
  let target = r.albumId;
  if (target === '__new') {
    try { target = (await api('albums', { method: 'POST', body: { title: r.newAlbum, createdBy: r.uploader } })).id; }
    catch (e) { toast(e.message); return; }
  }
  for (const f of r.files) uploadQueue.items.push({ file: f, albumId: target, uploader: r.uploader, status: 'wait', progress: 0 });
  pumpUploads();
}

function renderUploadPanel() {
  const q = uploadQueue;
  const done = q.items.filter((x) => x.status === 'done').length;
  const failed = q.items.filter((x) => x.status === 'error').length;
  const total = q.items.length;
  if (!q.el) { q.el = h('<div class="upload-panel"></div>'); document.body.appendChild(q.el); }
  const active = q.items.filter((x) => x.status === 'up');
  const pct = total ? Math.round(q.items.reduce((s, x) => s + (x.status === 'done' ? 1 : x.status === 'up' ? x.progress : 0), 0) / total * 100) : 0;
  const finished = done + failed === total;
  q.el.innerHTML = `
    <div class="up-row"><b>${finished ? (failed ? `${done}개 올림, ${failed}개 실패` : `${done}개 모두 올렸어요 🎉`) : `올리는 중… ${done}/${total}`}</b>
    ${finished ? '<button class="btn small ghost" data-x>닫기</button>' : ''}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    ${active[0] ? `<small class="muted">${esc(active[0].file.name)}</small>` : ''}
    ${finished && failed ? '<button class="btn small" data-retry>실패한 것 다시 올리기</button>' : ''}`;
  const x = $('[data-x]', q.el); if (x) x.onclick = () => { q.el.remove(); q.el = null; q.items = []; };
  const rt = $('[data-retry]', q.el); if (rt) rt.onclick = () => { q.items.forEach((it) => { if (it.status === 'error') it.status = 'wait'; }); pumpUploads(); };
}

function pumpUploads() {
  const q = uploadQueue;
  while (q.running < 2) {
    const it = q.items.find((x) => x.status === 'wait');
    if (!it) break;
    it.status = 'up'; q.running++;
    uploadOne(it).then(() => { it.status = 'done'; }).catch((e) => { it.status = 'error'; it.error = e.message; console.warn(e); })
      .finally(() => {
        q.running--; renderUploadPanel(); pumpUploads();
        if (q.running === 0 && !q.items.some((x) => x.status === 'wait')) {
          // 모두 성공하면 잠시 후 알림 자동으로 닫기
          if (!q.items.some((x) => x.status === 'error')) setTimeout(() => { if (q.running === 0 && q.el && !q.items.some((x) => x.status !== 'done')) { q.el.remove(); q.el = null; q.items = []; } }, 3500);
          if (/^#\/?$|^#\/photos|^#\/album|^#\/unsorted/.test(location.hash || '#/') && !$('.lightbox')) route();
        }
      });
  }
  renderUploadPanel();
}

async function uploadOne(it) {
  const f = it.file;
  const isVideo = f.type.startsWith('video/') || /\.(mov|mp4|m4v|webm|3gp)$/i.test(f.name);
  let variants = {};
  try { variants = isVideo ? await videoThumb(f) : await imageVariants(f); } catch (e) { console.warn('미리보기 생성 실패', e); }
  let takenAt = null;
  if (!isVideo) takenAt = await exifDate(f).catch(() => null);
  if (!takenAt && f.lastModified) takenAt = new Date(f.lastModified);
  const fd = new FormData();
  fd.append('albumId', it.albumId || '');
  fd.append('uploader', it.uploader);
  fd.append('deviceId', deviceId);
  if (takenAt && !isNaN(takenAt)) fd.append('takenAt', takenAt.toISOString());
  if (variants.width) { fd.append('width', variants.width); fd.append('height', variants.height); }
  if (variants.thumb) fd.append('thumb', variants.thumb, 'thumb.jpg');
  if (variants.preview) fd.append('preview', variants.preview, 'preview.jpg');
  fd.append('file', f, f.name);
  const res = await new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', 'api/upload');
    x.upload.onprogress = (e) => { if (e.lengthComputable) { it.progress = e.loaded / e.total; renderUploadPanel(); } };
    x.onload = () => {
      let d = {}; try { d = JSON.parse(x.responseText); } catch {}
      x.status < 300 ? resolve(d) : reject(new Error(d.error || (x.status === 413 ? '파일이 너무 커요' : `업로드 실패 (${x.status})`)));
    };
    x.onerror = () => reject(new Error('네트워크 오류'));
    x.send(fd);
  });
  if (res.id) rememberMine(res.id);
}

function loadImg(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
function canvasBlob(source, sw, sh, maxSide, quality = 0.82, crop) {
  const scale = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height);
  else ctx.drawImage(source, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
}
async function imageVariants(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImg(url);   // 브라우저가 EXIF 회전을 알아서 적용
    const w = img.naturalWidth, hgt = img.naturalHeight;
    const thumb = await canvasBlob(img, w, hgt, 512, 0.78);
    const preview = Math.max(w, hgt) > 2048 || file.size > 1.5e6 || !/jpe?g/i.test(file.type) ? await canvasBlob(img, w, hgt, 2048, 0.85) : null;
    return { thumb, preview, width: w, height: hgt };
  } finally { URL.revokeObjectURL(url); }
}
function videoThumb(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
    const done = (r) => { clearTimeout(t); URL.revokeObjectURL(url); r(); };
    const t = setTimeout(() => done(() => reject(new Error('timeout'))), 10000);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = async () => {
      try {
        const thumb = await canvasBlob(v, v.videoWidth, v.videoHeight, 512, 0.78);
        done(() => resolve({ thumb, width: v.videoWidth, height: v.videoHeight }));
      } catch (e) { done(() => reject(e)); }
    };
    v.onerror = () => done(() => reject(new Error('video')));
  });
}
async function squareFromUrl(src, size) {
  const img = await loadImg(src);
  const s = Math.min(img.naturalWidth, img.naturalHeight);
  return canvasBlob(img, s, s, size, 0.85, { x: (img.naturalWidth - s) / 2, y: (img.naturalHeight - s) / 3, w: s, h: s });
}
// JPEG EXIF 의 촬영 날짜(DateTimeOriginal) 읽기
async function exifDate(file) {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null;
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.getUint16(0) !== 0xffd8) return null;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off); const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && v.getUint32(off + 4) === 0x45786966) {
      const t = off + 10; const le = v.getUint16(t) === 0x4949;
      const u16 = (o) => v.getUint16(t + o, le), u32 = (o) => v.getUint32(t + o, le);
      const readIfd = (ifd, wanted) => {
        const n = u16(ifd);
        for (let k = 0; k < n; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === wanted) return e;
        }
        return null;
      };
      const ifd0 = u32(4);
      const exifPtr = readIfd(ifd0, 0x8769);
      let entry = exifPtr != null ? readIfd(u32(exifPtr + 8), 0x9003) : null;
      if (entry == null) entry = readIfd(ifd0, 0x0132);
      if (entry == null) return null;
      const so = t + u32(entry + 8); let s = '';
      for (let k = 0; k < 19; k++) s += String.fromCharCode(v.getUint8(so + k));
      const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (!m || m[1] === '0000') return null;
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    if ((marker & 0xff00) !== 0xff00) break;
    off += 2 + len;
  }
  return null;
}

// ---------- 가계도 ----------
function personChildren(p) { return state.people.filter((c) => (c.parents || []).includes(p.id)); }
function descendantsCount(p, seen = new Set()) {
  if (seen.has(p.id)) return 0; seen.add(p.id);
  return personChildren(p).reduce((s, c) => s + 1 + descendantsCount(c, seen), 0);
}
function topAncestor(p) {
  const seen = new Set();
  while (p && p.parents?.length && !seen.has(p.id)) {
    seen.add(p.id);
    const ps = p.parents.map((id) => state.peopleById.get(id)).filter(Boolean);
    p = ps.find((x) => x.gender === 'm') || ps[0] || p;
    if (seen.has(p.id)) break;
  }
  return p;
}
function avatarHtml(p, cls = '') {
  const initial = esc((p.name || '?').slice(-2, -1) ? p.name.slice(-2) : p.name);
  const img = p.hasAvatar || p.avatarPhotoId ? `<img src="avatar/${p.id}?v=${p.avatarRev || p.avatarPhotoId || ''}" alt="" loading="lazy">` : '';
  return `<span class="avatar ${cls} g-${p.gender || 'n'}">${img || `<i>${initial}</i>`}</span>`;
}

async function viewTree(params) {
  await loadPeople();
  const canEdit = state.me.canEditTree;
  setChrome({
    title: '가계도', tab: 'tree',
    actions: canEdit ? '<button class="btn small primary" id="add-person">+ 사람</button>' : '',
  });
  const view = $('#view');
  if (!state.people.length) {
    view.innerHTML = `<div class="empty"><p>아직 가계도가 비어 있어요.</p>${canEdit ? '<p><small>가장 윗대 어른부터 추가해 보세요.<br>그다음 사람을 눌러 "자녀 추가"를 하면 돼요.</small></p><button class="btn primary" id="first-person">첫 사람 추가</button>' : ''}</div>`;
    if (canEdit) { $('#first-person').onclick = () => personForm(); $('#add-person').onclick = () => personForm(); }
    return;
  }
  const roots = state.people.filter((p) => !(p.parents || []).length)
    // 다른 가족의 배우자로 들어온 사람은(부모 없음 + 배우자에게 부모 있음) 뿌리 후보에서 뺌
    .filter((p) => !(p.spouses || []).some((s) => (state.peopleById.get(s)?.parents || []).length))
    .map((p) => ({ p, n: descendantsCount(p) }))
    // 부부는 한 번만
    .filter((x, _, arr) => !(x.p.spouses || []).some((s) => arr.find((y) => y.p.id === s && (y.n > x.n || (y.n === x.n && y.p.gender === 'm' && x.p.gender !== 'm')))))
    .sort((a, b) => b.n - a.n);
  const focus = params.get('focus');
  let rootId = params.get('root') || LS.get('fa.treeRoot');
  if (focus && state.peopleById.has(focus)) rootId = topAncestor(state.peopleById.get(focus)).id;
  if (!state.peopleById.has(rootId)) rootId = roots[0]?.p.id || state.people[0].id;
  const root = state.peopleById.get(rootId);
  LS.set('fa.treeRoot', rootId);

  const seen = new Set();
  const nodeHtml = (p) => {
    if (seen.has(p.id)) return `<li><a class="couple ref" href="#/person/${p.id}"><span class="pcard">${avatarHtml(p)}<b>${esc(p.name)}</b><small>(위에 있음)</small></span></a></li>`;
    seen.add(p.id);
    const spouses = (p.spouses || []).map((id) => state.peopleById.get(id)).filter(Boolean);
    spouses.forEach((s) => seen.add(s.id));
    const coupleIds = new Set([p.id, ...spouses.map((s) => s.id)]);
    const kids = state.people
      .filter((c) => (c.parents || []).includes(p.id) || ((c.parents || []).some((x) => coupleIds.has(x)) && (c.parents || []).every((x) => coupleIds.has(x))))
      .sort((a, b) => (a.birth || '9999').localeCompare(b.birth || '9999'));
    const card = (x) => `<a class="pcard ${x.death ? 'deceased' : ''} ${x.id === focus ? 'focus' : ''}" href="#/person/${x.id}" data-id="${x.id}">
      ${avatarHtml(x)}<b>${esc(x.name)}</b>${x.nickname ? `<em>${esc(x.nickname)}</em>` : ''}<small>${esc(lifeSpan(x))}</small></a>`;
    return `<li><div class="couple">${card(p)}${spouses.map((s) => `<span class="heart">♥</span>${card(s)}`).join('')}</div>
      ${kids.length ? `<ul>${kids.map(nodeHtml).join('')}</ul>` : ''}</li>`;
  };
  const treeHtml = `<ul>${nodeHtml(root)}</ul>`;
  const outside = state.people.filter((p) => !seen.has(p.id));
  const zoom = LS.get('fa.treeZoom', innerWidth < 600 ? 0.8 : 1);

  view.innerHTML = `
    <div class="tree-toolbar">
      <label>시작 어른
        <select id="root-sel">${roots.map(({ p, n }) => `<option value="${p.id}" ${p.id === rootId ? 'selected' : ''}>${esc(p.name)} 집안</option>`).join('')}
        ${roots.some((r) => r.p.id === rootId) ? '' : `<option value="${rootId}" selected>${esc(root.name)}부터</option>`}</select>
      </label>
      <div class="zoom-btns"><button class="icon-btn" data-z="-1" aria-label="작게">−</button><button class="icon-btn" data-z="1" aria-label="크게">+</button></div>
    </div>
    <div class="tree-scroll"><div class="tree" style="zoom:${zoom}">${treeHtml}</div></div>
    ${outside.length ? `<div class="section-head"><h3>위 가계도에 안 나온 사람</h3></div>
      <div class="people-list">${outside.map((p) => `<a href="#/person/${p.id}" class="person-row">${avatarHtml(p)}<b>${esc(p.name)}</b><small>${esc(lifeSpan(p))}</small></a>`).join('')}</div>` : ''}
    <p class="muted center small">사람을 누르면 자세히 보고, 자녀·배우자를 추가할 수 있어요.</p>`;

  $('#root-sel').onchange = (e) => { location.hash = `#/tree?root=${e.target.value}`; };
  const treeEl = $('.tree', view);
  $$('[data-z]', view).forEach((b) => b.onclick = () => {
    const z = Math.max(0.4, Math.min(1.6, (parseFloat(treeEl.style.zoom) || 1) + 0.15 * +b.dataset.z));
    treeEl.style.zoom = z; LS.set('fa.treeZoom', z);
  });
  // 처음엔 가운데(또는 강조된 사람)로 스크롤
  requestAnimationFrame(() => {
    const sc = $('.tree-scroll', view);
    const f = focus && $(`.pcard[data-id="${focus}"]`, view);
    if (f) f.scrollIntoView({ block: 'center', inline: 'center' });
    else sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) / 2;
  });
  if (canEdit) $('#add-person').onclick = () => personForm();
}

async function viewPerson(id) {
  await loadPeople();
  const p = state.peopleById.get(id);
  if (!p) throw new Error('사람을 찾을 수 없어요.');
  const canEdit = state.me.canEditTree;
  setChrome({
    title: p.name, back: true, tab: 'tree',
    actions: canEdit ? '<button class="btn small ghost" id="edit-person">편집</button>' : '',
  });
  const by = (ids) => (ids || []).map((x) => state.peopleById.get(x)).filter(Boolean);
  const parents = by(p.parents);
  const spouses = by(p.spouses);
  const children = personChildren(p).sort((a, b) => (a.birth || '9999').localeCompare(b.birth || '9999'));
  const siblings = parents.length ? state.people.filter((x) => x.id !== p.id && (x.parents || []).some((pp) => p.parents.includes(pp))) : [];
  const chips = (list) => list.map((x) => `<a class="chip" href="#/person/${x.id}">${avatarHtml(x, 'sm')}${esc(x.name)}</a>`).join('');
  const rel = (label, list, addAct) => (list.length || (canEdit && addAct)) ? `
    <div class="rel"><span class="rel-label">${label}</span><div class="chips">${chips(list)}
      ${canEdit && addAct ? `<button class="chip add" data-add="${addAct}">+ 추가</button>` : ''}</div></div>` : '';

  const { photos } = await api(`photos?person=${id}`);
  $('#view').innerHTML = `
    <section class="person-head">
      <button class="avatar-wrap" id="avatar-btn" ${canEdit ? '' : 'disabled'}>${avatarHtml(p, 'xl')}${canEdit ? '<span class="cam">📷</span>' : ''}</button>
      <h2>${esc(p.name)}${p.nickname ? ` <small>${esc(p.nickname)}</small>` : ''}</h2>
      <p class="muted">${p.birth ? `${esc(fmtDate(p.birth))} 출생` : ''}${p.death ? ` · ${esc(fmtDate(p.death))} 별세` : ''}</p>
      ${p.note ? `<p class="note">${esc(p.note).replace(/\n/g, '<br>')}</p>` : ''}
    </section>
    <section class="card">
      ${rel('부모', parents, parents.length < 2 ? 'parent' : null)}
      ${rel('배우자', spouses, 'spouse')}
      ${rel('자녀', children, 'child')}
      ${rel('형제자매', siblings, parents.length ? 'sibling' : null)}
      <a class="btn ghost block" href="#/tree?focus=${p.id}">가계도에서 보기</a>
    </section>
    <div class="section-head"><h3>함께 나온 사진 <small>${photos.length}</small></h3></div>
    <div id="pgrid">${photos.length ? '' : '<p class="muted center small">사진을 열고 "사람 태그"를 누르면 여기에 모여요.</p>'}</div>`;
  if (photos.length) renderGrid($('#pgrid'), photos);
  $$('[data-add]').forEach((b) => b.onclick = () => addRelative(p, b.dataset.add));
  if (canEdit) {
    $('#edit-person').onclick = () => personForm(p);
    $('#avatar-btn').onclick = () => {
      const inp = h('<input type="file" accept="image/*">');
      inp.onchange = async () => {
        const f = inp.files[0]; if (!f) return;
        const url = URL.createObjectURL(f);
        try { await uploadAvatar(p.id, await squareFromUrl(url, 400)); route(); } catch (e) { toast(e.message); } finally { URL.revokeObjectURL(url); }
      };
      inp.click();
    };
  }
}

async function uploadAvatar(personId, blob) {
  const fd = new FormData(); fd.append('avatar', blob, 'avatar.jpg');
  const res = await fetch(`api/people/${personId}/avatar`, { method: 'POST', body: fd });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || '실패했어요');
  return d;
}

async function addRelative(p, kind) {
  const presets = {
    child: { parents: [p.id, ...(p.spouses || []).slice(0, 1)] },
    spouse: { spouses: [p.id], gender: p.gender === 'm' ? 'f' : p.gender === 'f' ? 'm' : '' },
    sibling: { parents: [...(p.parents || [])] },
    parent: { childrenIds: [p.id], spouses: (p.parents || []).slice(0, 1) },
  };
  const titles = { child: `${p.name}의 자녀 추가`, spouse: `${p.name}의 배우자 추가`, sibling: `${p.name}의 형제자매 추가`, parent: `${p.name}의 부모 추가` };
  // 이미 있는 사람을 연결할지, 새로 만들지
  const others = state.people.filter((x) => x.id !== p.id);
  let choice = 'new';
  if (others.length) {
    choice = await actionSheet([['new', '새 사람으로 추가'], ['link', '이미 등록된 사람과 연결']], titles[kind]);
    if (!choice) return;
  }
  if (choice === 'link') {
    const who = await actionSheet(others.map((x) => [x.id, `${x.name} ${lifeSpan(x)}`]), '누구와 연결할까요?');
    if (!who) return;
    const o = state.peopleById.get(who);
    try {
      if (kind === 'child') await api(`people/${o.id}`, { method: 'PATCH', body: { parents: presets.child.parents } });
      if (kind === 'sibling') await api(`people/${o.id}`, { method: 'PATCH', body: { parents: p.parents } });
      if (kind === 'spouse') await api(`people/${p.id}`, { method: 'PATCH', body: { spouses: [...new Set([...(p.spouses || []), o.id])] } });
      if (kind === 'parent') await api(`people/${p.id}`, { method: 'PATCH', body: { parents: [...(p.parents || []), o.id] } });
      route();
    } catch (e) { toast(e.message); }
    return;
  }
  personForm(null, presets[kind], titles[kind]);
}

async function personForm(p, preset = {}, title) {
  if (!state.people.length) await loadPeople();
  const v = { ...preset, ...(p || {}) };
  const opt = (sel, exclude) => `<option value="">없음</option>` + state.people.filter((x) => x.id !== exclude)
    .map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)} ${esc(lifeSpan(x))}</option>`).join('');
  const isAdmin = state.me.role === 'admin';
  const r = await sheet(`
    <h3>${esc(title || (p ? `${p.name} 정보 수정` : '사람 추가'))}</h3>
    <form class="form">
      <label>이름<input name="name" maxlength="40" required value="${esc(v.name)}" placeholder="예: 김영희"></label>
      <label><span>호칭 <small>(선택)</small></span><input name="nickname" maxlength="40" value="${esc(v.nickname)}" placeholder="예: 큰할머니, 막내삼촌"></label>
      <div class="seg">
        <label><input type="radio" name="gender" value="m" ${v.gender === 'm' ? 'checked' : ''}><span>남</span></label>
        <label><input type="radio" name="gender" value="f" ${v.gender === 'f' ? 'checked' : ''}><span>여</span></label>
        <label><input type="radio" name="gender" value="" ${!v.gender ? 'checked' : ''}><span>미정</span></label>
      </div>
      <div class="two">
        <label>태어난 날<input name="birth" type="date" value="${esc(v.birth)}"></label>
        <label>돌아가신 날<input name="death" type="date" value="${esc(v.death)}"></label>
      </div>
      <details ${p ? 'open' : ''}><summary>가족 관계</summary>
        <label>부모 1<select name="parent0">${opt(v.parents?.[0], p?.id)}</select></label>
        <label>부모 2<select name="parent1">${opt(v.parents?.[1], p?.id)}</select></label>
        <label>배우자<select name="spouse">${opt(v.spouses?.[0], p?.id)}</select></label>
      </details>
      <label><span>메모 <small>(고향, 직업, 추억 등)</small></span><textarea name="note" rows="3" maxlength="2000">${esc(v.note)}</textarea></label>
      <div class="row-btns">
        ${p && isAdmin ? '<button type="button" class="btn danger ghost" data-del>삭제</button>' : ''}
        <button type="button" class="btn ghost" data-close>취소</button><button class="btn primary">저장</button>
      </div>
    </form>`, {
    form: true,
    onMount(root) {
      const d = $('[data-del]', root);
      if (d) d.onclick = async () => {
        if (!confirm(`${p.name} 님을 가계도에서 지울까요?\n(사진은 지워지지 않아요)`)) return;
        try { await api(`people/${p.id}`, { method: 'DELETE' }); closeAllSheets(); location.hash = '#/tree'; } catch (e) { toast(e.message); }
      };
    },
  });
  if (!r) return;
  const body = {
    name: r.name, nickname: r.nickname, gender: r.gender, birth: r.birth, death: r.death, note: r.note,
    parents: [r.parent0, r.parent1].filter(Boolean),
    spouses: [...new Set([r.spouse, ...((p?.spouses || []).slice(1))].filter(Boolean))],
  };
  if (preset.childrenIds && !p) body.childrenIds = preset.childrenIds;
  try {
    const saved = p ? await api(`people/${p.id}`, { method: 'PATCH', body }) : await api('people', { method: 'POST', body });
    toast('저장했어요');
    if (!p && location.hash.startsWith('#/person/')) route();
    else if (!p) location.hash = `#/person/${saved.id}`;
    else route();
  } catch (e) { toast(e.message); }
}

async function pickPeople(selected) {
  await loadPeople();
  if (!state.people.length) { toast('먼저 가계도에 사람을 추가해 주세요.'); return null; }
  const sel = new Set(selected);
  const r = await sheet(`
    <h3>사진 속 사람</h3>
    <input class="search" placeholder="이름 검색" type="search">
    <div class="pick-list">${state.people.map((p) => `
      <label class="pick" data-name="${esc(p.name + ' ' + (p.nickname || ''))}">
        <input type="checkbox" value="${p.id}" ${sel.has(p.id) ? 'checked' : ''}>${avatarHtml(p, 'sm')}<b>${esc(p.name)}</b><small>${esc(p.nickname || lifeSpan(p))}</small>
      </label>`).join('')}</div>
    <div class="row-btns"><button type="button" class="btn ghost" data-close>취소</button><button type="button" class="btn primary" data-ok>완료</button></div>`, {
    onMount(root, resolve) {
      $('.search', root).oninput = (e) => {
        const q = e.target.value.trim();
        $$('.pick', root).forEach((l) => { l.hidden = q && !l.dataset.name.includes(q); });
      };
      $('[data-ok]', root).onclick = () => resolve($$('input[type=checkbox]:checked', root).map((c) => c.value));
    },
  });
  return r;
}

// ---------- 더보기 ----------
const shareBase = () => `${location.origin}${location.pathname}?k=${encodeURIComponent(state.me.shareKey)}`;
async function shareLink(url, title) {
  if (navigator.share) { try { await navigator.share({ title: `${state.me.siteName} 앨범`, text: title ? `${title} 사진 보러 와요` : '우리 가족 앨범이에요', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  try { await navigator.clipboard.writeText(url); toast('링크를 복사했어요'); }
  catch { prompt('이 링크를 복사해서 보내세요', url); }
}

function viewMore() {
  setChrome({ title: '더보기', tab: 'more' });
  const isAdmin = state.me.role === 'admin';
  const link = shareBase();
  $('#view').innerHTML = `
    <section class="card">
      <h3>가족 초대 링크</h3>
      <p class="muted small">이 링크가 있는 사람은 앨범을 보고 사진을 올릴 수 있어요. 가족 단톡방에만 보내 주세요.</p>
      <div class="link-box"><code>${esc(link)}</code></div>
      <div class="row-btns"><button class="btn primary" id="share">링크 보내기</button><button class="btn ghost" id="copy">복사</button></div>
      ${isAdmin ? '<button class="btn danger ghost block" id="rotate">링크 새로 만들기 (예전 링크 막기)</button>' : ''}
    </section>
    <section class="card">
      <h3>내 이름</h3>
      <form class="form inline" id="name-form"><input name="n" value="${esc(LS.get('fa.name', ''))}" placeholder="사진 올릴 때 표시돼요" maxlength="40"><button class="btn">저장</button></form>
    </section>
    <section class="card">
      <h3>앱처럼 쓰기</h3>
      <div id="install-slot2"></div>
      <p class="small">
        <b>아이폰</b>: Safari 아래 <b>공유</b> 버튼 → <b>홈 화면에 추가</b><br>
        <b>안드로이드</b>: Chrome 오른쪽 위 <b>⋮</b> → <b>홈 화면에 추가</b> (또는 <b>앱 설치</b>)
      </p>
    </section>
    <section class="card">
      <h3>관리자</h3>
      ${isAdmin ? `<p class="small">관리자로 로그인되어 있어요. 사진·앨범·사람 삭제와 링크 재발급을 할 수 있어요.</p>
        <button class="btn ghost" id="logout">관리자 로그아웃</button>`
        : `<form class="form inline" id="admin-form"><input type="password" name="password" placeholder="관리자 비밀번호" autocomplete="current-password"><button class="btn">로그인</button></form>`}
    </section>`;
  $('#share').onclick = () => shareLink(link);
  $('#copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('복사했어요'); } catch { prompt('복사하세요', link); } };
  $('#name-form').onsubmit = (e) => { e.preventDefault(); LS.set('fa.name', e.target.n.value.trim()); toast('저장했어요'); };
  renderInstallHint($('#install-slot2'), true);
  if (isAdmin) {
    $('#rotate').onclick = async () => {
      if (!confirm('새 링크를 만들면 지금까지 보낸 링크로는 들어올 수 없어요.\n(이미 홈 화면에 추가한 가족도 새 링크로 다시 들어와야 해요)\n계속할까요?')) return;
      const r = await api('admin/rotate-key', { method: 'POST' });
      state.me.shareKey = r.shareKey; syncKeyInUrl(); viewMore(); toast('새 링크를 만들었어요. 가족에게 다시 보내 주세요.');
    };
    $('#logout').onclick = async () => { await api('admin/logout', { method: 'POST' }); await boot(); };
  } else {
    $('#admin-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('admin/login', { method: 'POST', body: { password: e.target.password.value } }); await boot(); toast('관리자로 로그인했어요'); }
      catch (err) { toast(err.message); }
    };
  }
}

// ---------- 설치 안내 ----------
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $$('.install-slot-btn').forEach((b) => (b.hidden = false)); });
function renderInstallHint(slot, always = false) {
  if (!slot || isStandalone()) { if (slot && always) slot.innerHTML = '<p class="small ok">✓ 지금 앱으로 쓰고 있어요</p>'; return; }
  if (!always && LS.get('fa.installDismissed')) return;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  slot.innerHTML = `
    <div class="install-hint">
      <div><b>📱 홈 화면에 추가하면 앱처럼 쓸 수 있어요</b>
      <p class="small">${ios ? 'Safari 아래 <b>공유</b>(□↑) → <b>홈 화면에 추가</b>' : '아래 버튼을 누르거나, 브라우저 메뉴 → <b>홈 화면에 추가</b>'}</p></div>
      <button class="btn primary small install-slot-btn" ${deferredInstall ? '' : 'hidden'}>설치</button>
      ${always ? '' : '<button class="icon-btn" data-dismiss aria-label="닫기">✕</button>'}
    </div>`;
  const b = $('.install-slot-btn', slot);
  b.onclick = async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; b.hidden = true; };
  const d = $('[data-dismiss]', slot); if (d) d.onclick = () => { LS.set('fa.installDismissed', true); slot.innerHTML = ''; };
}

// ---------- 시트(모달) ----------
function closeAllSheets() { $$('.sheet-backdrop').forEach((s) => s._resolve?.(null)); }

function sheet(html, { form = false, onMount, collect } = {}) {
  return new Promise((resolve) => {
    const bd = h(`<div class="sheet-backdrop"><div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div></div>`);
    let finished = false;
    const finish = (val) => { if (finished) return; finished = true; bd.classList.add('closing'); setTimeout(() => bd.remove(), 180); resolve(val); };
    bd._resolve = finish;
    bd.addEventListener('click', (e) => { if (e.target === bd || e.target.closest('[data-close]')) finish(null); });
    if (form) {
      const f = $('form', bd);
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        finish(collect ? collect(f) : Object.fromEntries(new FormData(f)));
      });
    }
    $('#sheet-root').appendChild(bd);
    onMount?.(bd, finish);
    const first = $('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), textarea', bd);
    if (first && !first.value && matchMedia('(pointer:fine)').matches) first.focus();
  });
}

function actionSheet(items, title) {
  return sheet(`${title ? `<h3>${esc(title)}</h3>` : ''}<div class="actions">${items.map(([v, label, cls]) => `<button class="action ${cls || ''}" data-v="${esc(v)}">${esc(label)}</button>`).join('')}</div>
    <button class="action cancel" data-close>취소</button>`, {
    onMount(root, resolve) { $$('[data-v]', root).forEach((b) => b.onclick = () => resolve(b.dataset.v)); },
  });
}

// ---------- 시작 ----------
// iOS 는 홈 화면 앱이 Safari 와 쿠키를 공유하지 않아서, 주소에 공유키를 남겨둬야 "홈 화면에 추가"한 앱에서도 바로 열려요.
function syncKeyInUrl() {
  const key = state.me?.shareKey; if (!key) return;
  const u = new URL(location.href);
  if (u.searchParams.get('k') !== key) { u.searchParams.set('k', key); history.replaceState(history.state, '', u); }
  $('#manifest-link').href = `manifest.webmanifest?k=${encodeURIComponent(key)}`;
}

async function boot() {
  try { state.me = await api('me'); }
  catch { state.me = { role: null, siteName: '가족 앨범' }; }
  syncKeyInUrl();
  await route();
}

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
boot();
