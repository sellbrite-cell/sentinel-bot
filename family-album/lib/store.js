// 아주 단순한 JSON 파일 저장소.
// 가족 규모(사진 수만 장)까지는 충분하고, 네이티브 모듈이 없어서 어떤 NAS(ARM/x86)에서도 돌아갑니다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = () => ({ version: 1, albums: [], photos: [], people: [] });

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'db.json');
    this.data = EMPTY();
    this._timer = null;
    this._writing = Promise.resolve();
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (fs.existsSync(this.file)) {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = Object.assign(EMPTY(), JSON.parse(raw));
    } else {
      this.flushSync();
    }
    return this;
  }

  // 변경 후 호출: 짧게 모아서 원자적으로 저장 (tmp 파일 → rename)
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 300);
  }

  flush() {
    clearTimeout(this._timer);
    const json = JSON.stringify(this.data);
    this._writing = this._writing.then(async () => {
      const tmp = this.file + '.tmp';
      await fs.promises.writeFile(tmp, json);
      await fs.promises.rename(tmp, this.file);
    }).catch((e) => console.error('[store] 저장 실패', e));
    return this._writing;
  }

  flushSync() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }

  static id() {
    return crypto.randomBytes(9).toString('base64url');
  }
}

module.exports = Store;
