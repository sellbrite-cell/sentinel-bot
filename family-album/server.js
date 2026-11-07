// 가족 사진첩 + 가계도 서버
// - 공유 링크(?k=...)를 가진 사람: 보기 + 사진 올리기 + 태그/설명 (+ 가계도 편집, 설정에 따라)
// - 관리자(비밀번호): 삭제, 링크 재발급 등 전부
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const cookieParser = require('cookie-parser');
const Store = require('./lib/store');

// ---------- 설정 ----------
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const SITE_NAME = process.env.SITE_NAME || '우리 가족';
const TREE_EDIT = (process.env.TREE_EDIT || 'family').toLowerCase(); // family | admin
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '4096', 10);

const DIRS = {
  originals: path.join(DATA_DIR, 'originals'),
  thumbs: path.join(DATA_DIR, 'thumbs'),
  previews: path.join(DATA_DIR, 'previews'),
  avatars: path.join(DATA_DIR, 'avatars'),
  tmp: path.join(DATA_DIR, 'tmp'),
};
Object.values(DIRS).forEach((d) => fs.mkdirSync(d, { recursive: true }));

// 비밀값은 data/config.json 에 보관 (환경변수는 최초 값으로만 사용)
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
let config = {};
if (fs.existsSync(CONFIG_FILE)) config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const randomKey = (n = 18) => crypto.randomBytes(n).toString('base64url');
let configChanged = false;
const firstRun = !config.adminPassword;
if (!config.familyKey) { config.familyKey = process.env.FAMILY_KEY || randomKey(); configChanged = true; }
if (!config.adminPassword) { config.adminPassword = process.env.ADMIN_PASSWORD || randomKey(9); configChanged = true; }
if (!config.secret) { config.secret = randomKey(32); configChanged = true; }
// 환경변수로 관리자 비밀번호를 바꾸면 반영
if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD !== config.adminPassword) {
  config.adminPassword = process.env.ADMIN_PASSWORD; configChanged = true;
}
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
if (configChanged) saveConfig();

const store = new Store(DATA_DIR).load();
const db = store.data;

// ---------- 유틸 ----------
const now = () => new Date().toISOString();
const safeEq = (a, b) => {
  const A = Buffer.from(String(a || '')); const B = Buffer.from(String(b || ''));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
};
const adminToken = () => crypto.createHmac('sha256', config.secret).update('admin:' + config.adminPassword).digest('base64url');
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const findPhoto = (id) => db.photos.find((p) => p.id === id);
const findAlbum = (id) => db.albums.find((a) => a.id === id);
const findPerson = (id) => db.people.find((p) => p.id === id);

function rmQuiet(file) { fs.promises.unlink(file).catch(() => {}); }

// ---------- 앱 ----------
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

const COOKIE_OPTS = (req) => ({
  httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 1000 * 60 * 60 * 24 * 365 * 5,
});

// 역할 판별
app.use((req, res, next) => {
  const k = req.query.k || req.get('x-family-key');
  if (k && safeEq(k, config.familyKey) && !safeEq(req.cookies.fa_key, config.familyKey)) {
    res.cookie('fa_key', config.familyKey, COOKIE_OPTS(req));
    req.cookies.fa_key = config.familyKey;
  }
  if (req.cookies.fa_admin && safeEq(req.cookies.fa_admin, adminToken())) req.role = 'admin';
  else if (safeEq(req.cookies.fa_key, config.familyKey)) req.role = 'family';
  else req.role = null;
  next();
});

const needFamily = (req, res, next) => (req.role ? next() : res.status(401).json({ error: '공유 링크로 접속해 주세요.' }));
const needAdmin = (req, res, next) => (req.role === 'admin' ? next() : res.status(403).json({ error: '관리자만 할 수 있어요.' }));
const canEditTree = (req) => req.role === 'admin' || (req.role === 'family' && TREE_EDIT === 'family');
const needTreeEdit = (req, res, next) => (canEditTree(req) ? next() : res.status(403).json({ error: '가계도 편집 권한이 없어요.' }));

// PWA 매니페스트: 공유키를 start_url 에 넣어서, 홈 화면 앱(특히 iOS)에서도 바로 열리도록
app.get('/manifest.webmanifest', (req, res) => {
  const k = req.query.k && safeEq(req.query.k, config.familyKey) ? req.query.k : null;
  res.type('application/manifest+json').set('Cache-Control', 'no-cache').send(JSON.stringify({
    name: `${SITE_NAME} 앨범`,
    short_name: SITE_NAME,
    description: '가족 사진첩과 가계도',
    lang: 'ko',
    start_url: k ? `./?k=${encodeURIComponent(k)}` : './',
    scope: './',
    display: 'standalone',
    background_color: '#fbf7f2',
    theme_color: '#c96f4a',
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }));
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders: (res, file) => {
    if (file.endsWith('sw.js') || file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
  },
}));

// ---------- 세션/설정 ----------
app.get('/api/me', (req, res) => {
  res.json({
    role: req.role,
    siteName: SITE_NAME,
    canEditTree: canEditTree(req),
    shareKey: req.role ? config.familyKey : null,
  });
});

app.post('/api/admin/login', (req, res) => {
  if (!safeEq(str(req.body.password, 200), config.adminPassword)) {
    return res.status(401).json({ error: '비밀번호가 틀렸어요.' });
  }
  res.cookie('fa_admin', adminToken(), COOKIE_OPTS(req));
  // 관리자는 가족 링크도 함께 갖게 함
  res.cookie('fa_key', config.familyKey, COOKIE_OPTS(req));
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => { res.clearCookie('fa_admin'); res.json({ ok: true }); });

// 공유 링크 재발급: 기존 링크로는 더 이상 접속 불가
app.post('/api/admin/rotate-key', needAdmin, (req, res) => {
  config.familyKey = randomKey();
  saveConfig();
  res.cookie('fa_key', config.familyKey, COOKIE_OPTS(req));
  res.json({ shareKey: config.familyKey });
});

// ---------- 앨범 ----------
function albumView(a) {
  const photos = db.photos.filter((p) => p.albumId === a.id);
  const cover = (a.coverId && findPhoto(a.coverId)) || photos[photos.length - 1] || null;
  return { ...a, count: photos.length, coverId: cover ? cover.id : null };
}

app.get('/api/albums', needFamily, (req, res) => {
  const list = db.albums.map(albumView).sort((a, b) => (b.date || b.createdAt).localeCompare(a.date || a.createdAt));
  res.json({ albums: list, totalPhotos: db.photos.length });
});

app.post('/api/albums', needFamily, (req, res) => {
  const title = str(req.body.title, 80);
  if (!title) return res.status(400).json({ error: '앨범 이름을 적어주세요.' });
  const a = {
    id: Store.id(), title, date: str(req.body.date, 10), description: str(req.body.description, 1000),
    coverId: null, createdAt: now(), createdBy: str(req.body.createdBy, 40),
  };
  db.albums.push(a); store.save();
  res.json(albumView(a));
});

app.patch('/api/albums/:id', needFamily, (req, res) => {
  const a = findAlbum(req.params.id);
  if (!a) return res.status(404).json({ error: '앨범이 없어요.' });
  if ('title' in req.body) a.title = str(req.body.title, 80) || a.title;
  if ('date' in req.body) a.date = str(req.body.date, 10);
  if ('description' in req.body) a.description = str(req.body.description, 1000);
  if ('coverId' in req.body) a.coverId = findPhoto(req.body.coverId) ? req.body.coverId : null;
  store.save();
  res.json(albumView(a));
});

app.delete('/api/albums/:id', needAdmin, (req, res) => {
  const a = findAlbum(req.params.id);
  if (!a) return res.status(404).json({ error: '앨범이 없어요.' });
  // 사진은 지우지 않고 '앨범 없음'으로 이동
  db.photos.forEach((p) => { if (p.albumId === a.id) p.albumId = null; });
  db.albums = db.albums.filter((x) => x !== a);
  store.save();
  res.json({ ok: true });
});

// ---------- 사진 ----------
const photoView = (p) => {
  const { origFile, deviceId, ...rest } = p;
  return rest;
};

app.get('/api/photos', needFamily, (req, res) => {
  let list = db.photos;
  if (req.query.album === 'none') list = list.filter((p) => !p.albumId);
  else if (req.query.album) list = list.filter((p) => p.albumId === req.query.album);
  if (req.query.person) list = list.filter((p) => (p.people || []).includes(req.query.person));
  list = [...list].sort((a, b) => (b.takenAt || b.uploadedAt).localeCompare(a.takenAt || a.uploadedAt));
  res.json({ photos: list.map(photoView) });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.tmp,
    filename: (req, file, cb) => cb(null, Store.id()),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 3 },
});

const IMAGE_EXT = /^(jpe?g|png|gif|webp|heic|heif|avif|bmp|tiff?)$/;
const VIDEO_EXT = /^(mp4|mov|m4v|webm|3gp|mkv|avi)$/;

app.post('/api/upload', needFamily, upload.fields([
  { name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }, { name: 'preview', maxCount: 1 },
]), async (req, res) => {
  const files = req.files || {};
  const orig = files.file && files.file[0];
  const cleanup = () => Object.values(files).flat().forEach((f) => rmQuiet(f.path));
  if (!orig) { cleanup(); return res.status(400).json({ error: '파일이 없어요.' }); }

  let ext = path.extname(orig.originalname || '').slice(1).toLowerCase();
  const mime = orig.mimetype || '';
  let type = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : null;
  if (!type) type = IMAGE_EXT.test(ext) ? 'image' : VIDEO_EXT.test(ext) ? 'video' : null;
  if (!type) { cleanup(); return res.status(400).json({ error: '사진이나 동영상만 올릴 수 있어요.' }); }
  if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = type === 'video' ? 'mp4' : 'jpg';

  const albumId = req.body.albumId && findAlbum(req.body.albumId) ? req.body.albumId : null;
  const id = Store.id();
  const takenAt = /^\d{4}-\d{2}-\d{2}T/.test(req.body.takenAt || '') ? req.body.takenAt : now();
  const sub = takenAt.slice(0, 7).replace('-', '/'); // YYYY/MM 폴더
  const origRel = path.join(sub, `${id}.${ext}`);

  try {
    await fs.promises.mkdir(path.join(DIRS.originals, sub), { recursive: true });
    await fs.promises.rename(orig.path, path.join(DIRS.originals, origRel));
    const thumb = files.thumb && files.thumb[0];
    const preview = files.preview && files.preview[0];
    if (thumb) await fs.promises.rename(thumb.path, path.join(DIRS.thumbs, `${id}.jpg`));
    if (preview) await fs.promises.rename(preview.path, path.join(DIRS.previews, `${id}.jpg`));

    const p = {
      id, albumId, type, mime, ext,
      origName: str(orig.originalname, 200), origFile: origRel, size: orig.size,
      width: parseInt(req.body.width, 10) || null, height: parseInt(req.body.height, 10) || null,
      takenAt, uploadedAt: now(), uploader: str(req.body.uploader, 40), deviceId: str(req.body.deviceId, 64),
      caption: str(req.body.caption, 1000), people: [],
      hasThumb: !!thumb, hasPreview: !!preview,
    };
    db.photos.push(p); store.save();
    res.json(photoView(p));
  } catch (e) {
    console.error(e); cleanup();
    res.status(500).json({ error: '저장 중 문제가 생겼어요.' });
  }
});

app.patch('/api/photos/:id', needFamily, (req, res) => {
  const p = findPhoto(req.params.id);
  if (!p) return res.status(404).json({ error: '사진이 없어요.' });
  if ('caption' in req.body) p.caption = str(req.body.caption, 1000);
  if ('albumId' in req.body) p.albumId = req.body.albumId && findAlbum(req.body.albumId) ? req.body.albumId : null;
  if (Array.isArray(req.body.people)) p.people = [...new Set(req.body.people.filter((x) => findPerson(x)))];
  if ('takenAt' in req.body && /^\d{4}-\d{2}-\d{2}/.test(req.body.takenAt || '')) p.takenAt = new Date(req.body.takenAt).toISOString();
  store.save();
  res.json(photoView(p));
});

// 삭제: 관리자이거나, 같은 기기에서 올린 사람
app.delete('/api/photos/:id', needFamily, (req, res) => {
  const p = findPhoto(req.params.id);
  if (!p) return res.status(404).json({ error: '사진이 없어요.' });
  const mine = p.deviceId && safeEq(p.deviceId, req.get('x-device-id'));
  if (req.role !== 'admin' && !mine) return res.status(403).json({ error: '올린 사람이나 관리자만 지울 수 있어요.' });
  db.photos = db.photos.filter((x) => x !== p);
  db.albums.forEach((a) => { if (a.coverId === p.id) a.coverId = null; });
  db.people.forEach((x) => { if (x.avatarPhotoId === p.id) x.avatarPhotoId = null; });
  store.save();
  rmQuiet(path.join(DIRS.originals, p.origFile));
  rmQuiet(path.join(DIRS.thumbs, `${p.id}.jpg`));
  rmQuiet(path.join(DIRS.previews, `${p.id}.jpg`));
  res.json({ ok: true });
});

// 미디어 파일 (Range 요청 지원 → 동영상 스트리밍 가능)
const LONG_CACHE = { headers: { 'Cache-Control': 'private, max-age=31536000, immutable' } };
app.get('/media/:id/:kind', needFamily, (req, res) => {
  const p = findPhoto(req.params.id);
  if (!p) return res.status(404).end();
  const origPath = path.join(DIRS.originals, p.origFile);
  const { kind } = req.params;
  if (kind === 'thumb') {
    if (p.hasThumb) return res.sendFile(path.join(DIRS.thumbs, `${p.id}.jpg`), LONG_CACHE);
    if (p.hasPreview) return res.sendFile(path.join(DIRS.previews, `${p.id}.jpg`), LONG_CACHE);
    if (p.type === 'image') return res.sendFile(origPath, LONG_CACHE);
    return res.status(404).end();
  }
  if (kind === 'view') {
    if (p.type === 'image' && p.hasPreview) return res.sendFile(path.join(DIRS.previews, `${p.id}.jpg`), LONG_CACHE);
    return res.sendFile(origPath, LONG_CACHE);
  }
  if (kind === 'original') {
    const name = p.origName || `${p.id}.${p.ext}`;
    res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    return res.sendFile(origPath);
  }
  res.status(404).end();
});

// ---------- 가계도 ----------
const personView = (p) => ({ ...p, photoCount: db.photos.filter((x) => (x.people || []).includes(p.id)).length });

app.get('/api/people', needFamily, (req, res) => {
  res.json({ people: db.people.map(personView) });
});

function applyPerson(p, body) {
  if ('name' in body) p.name = str(body.name, 40) || p.name;
  if ('gender' in body) p.gender = ['m', 'f'].includes(body.gender) ? body.gender : '';
  for (const k of ['birth', 'death']) if (k in body) p[k] = str(body[k], 10);
  if ('note' in body) p.note = str(body.note, 2000);
  if ('nickname' in body) p.nickname = str(body.nickname, 40);
  if (Array.isArray(body.parents)) {
    p.parents = [...new Set(body.parents.filter((x) => x && x !== p.id && findPerson(x)))].slice(0, 2);
  }
  if (Array.isArray(body.spouses)) {
    const next = [...new Set(body.spouses.filter((x) => x && x !== p.id && findPerson(x)))];
    // 배우자 관계는 양쪽에 같이 기록
    for (const o of db.people) {
      if (o === p) continue;
      o.spouses = o.spouses || [];
      const has = o.spouses.includes(p.id);
      if (next.includes(o.id) && !has) o.spouses.push(p.id);
      if (!next.includes(o.id) && has) o.spouses = o.spouses.filter((x) => x !== p.id);
    }
    p.spouses = next;
  }
  if ('avatarPhotoId' in body) p.avatarPhotoId = findPhoto(body.avatarPhotoId) ? body.avatarPhotoId : null;
}

app.post('/api/people', needTreeEdit, (req, res) => {
  const name = str(req.body.name, 40);
  if (!name) return res.status(400).json({ error: '이름을 적어주세요.' });
  const p = { id: Store.id(), name, gender: '', birth: '', death: '', note: '', nickname: '', parents: [], spouses: [], avatarPhotoId: null, hasAvatar: false, createdAt: now() };
  db.people.push(p);
  applyPerson(p, req.body);
  // 자녀로 바로 연결하고 싶을 때 (childOf 의 자녀 목록에 추가)
  if (Array.isArray(req.body.childrenIds)) {
    for (const cid of req.body.childrenIds) {
      const c = findPerson(cid);
      if (c && c !== p && (c.parents || []).length < 2 && !c.parents.includes(p.id)) c.parents.push(p.id);
    }
  }
  store.save();
  res.json(personView(p));
});

app.patch('/api/people/:id', needTreeEdit, (req, res) => {
  const p = findPerson(req.params.id);
  if (!p) return res.status(404).json({ error: '사람을 찾을 수 없어요.' });
  applyPerson(p, req.body);
  store.save();
  res.json(personView(p));
});

app.delete('/api/people/:id', needAdmin, (req, res) => {
  const p = findPerson(req.params.id);
  if (!p) return res.status(404).json({ error: '사람을 찾을 수 없어요.' });
  db.people = db.people.filter((x) => x !== p);
  for (const o of db.people) {
    o.parents = (o.parents || []).filter((x) => x !== p.id);
    o.spouses = (o.spouses || []).filter((x) => x !== p.id);
  }
  db.photos.forEach((ph) => { ph.people = (ph.people || []).filter((x) => x !== p.id); });
  store.save();
  rmQuiet(path.join(DIRS.avatars, `${p.id}.jpg`));
  res.json({ ok: true });
});

const avatarUpload = multer({ dest: DIRS.tmp, limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
app.post('/api/people/:id/avatar', needTreeEdit, avatarUpload.single('avatar'), async (req, res) => {
  const p = findPerson(req.params.id);
  if (!req.file) return res.status(400).json({ error: '사진이 없어요.' });
  if (!p) { rmQuiet(req.file.path); return res.status(404).json({ error: '사람을 찾을 수 없어요.' }); }
  await fs.promises.rename(req.file.path, path.join(DIRS.avatars, `${p.id}.jpg`));
  p.hasAvatar = true; p.avatarRev = Date.now(); p.avatarPhotoId = null;
  store.save();
  res.json(personView(p));
});

app.get('/avatar/:id', needFamily, (req, res) => {
  const p = findPerson(req.params.id);
  if (!p) return res.status(404).end();
  if (p.hasAvatar) return res.sendFile(path.join(DIRS.avatars, `${p.id}.jpg`), LONG_CACHE);
  const ph = p.avatarPhotoId && findPhoto(p.avatarPhotoId);
  if (ph) return res.redirect(`../media/${ph.id}/thumb`);
  res.status(404).end();
});

// ---------- 화면 ----------
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'no-cache').sendFile(path.join(__dirname, 'public', 'index.html'));
});

// multer 용량 초과 등 에러
app.use((err, req, res, next) => {
  console.error(err.message);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? `파일이 너무 커요 (최대 ${MAX_UPLOAD_MB}MB).` : '문제가 생겼어요.';
  res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).json({ error: msg });
});

// 오래된 임시 파일 정리
for (const f of fs.readdirSync(DIRS.tmp)) rmQuiet(path.join(DIRS.tmp, f));

const server = app.listen(PORT, () => {
  console.log(`📷 ${SITE_NAME} 앨범 실행 중 (포트 ${PORT}, 데이터 ${DATA_DIR})`);
  // 비밀값은 처음 만들어질 때 한 번만 보여줌 (이후엔 data/config.json 에서 확인)
  if (firstRun) {
    console.log(`   [최초 1회] 가족 공유 링크:  https://<주소>/?k=${config.familyKey}`);
    if (!process.env.ADMIN_PASSWORD) console.log(`   [최초 1회] 관리자 비밀번호: ${config.adminPassword}`);
  }
});
server.requestTimeout = 0; // 큰 동영상 업로드가 끊기지 않도록

const shutdown = () => { store.flushSync(); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
