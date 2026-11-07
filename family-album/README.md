# 우리 가족 앨범 (사진첩 + 가계도)

NAS에 올려서 쓰는 가족 전용 웹앱이에요. 폰에서 **홈 화면에 추가**하면 앱처럼 열려요(PWA).

## 기능

- **사진첩**
  - 공유 링크를 가진 가족 누구나 폰으로 사진과 동영상을 여러 장 한 번에 올릴 수 있어요.
  - 앨범을 만들 수 있고, 모든 사진을 월별로 볼 수 있어요.
  - 사진을 넘겨 보는 화면(스와이프)에서 설명을 쓰고, 사진 속 사람을 태그하고, 원본을 저장할 수 있어요.
  - 촬영 날짜는 사진 정보(EXIF)에서 자동으로 읽어요.
  - 썸네일은 폰에서 미리 만들어서 올려요. 그래서 NAS에 부담이 없어요.
- **가계도**
  - 부부와 자녀로 이어지는 트리를 보여주고, 확대·축소할 수 있어요.
  - 사람을 누르면 상세 화면이 나와요: 부모, 배우자, 자녀, 형제자매, 메모, 프로필 사진, **그 사람이 태그된 사진 모음**.
  - "자녀 추가", "배우자 추가"를 누르면 관계가 자동으로 연결돼요.
- **권한**

  | 할 수 있는 일 | 링크 가진 가족 | 관리자 (비밀번호) |
  |---|---|---|
  | 보기, 올리기, 태그, 설명 | ✅ | ✅ |
  | 가계도 편집 | ✅ (`TREE_EDIT=admin`으로 막을 수 있음) | ✅ |
  | 사진 삭제 | 자기가 올린 것만 | ✅ |
  | 앨범·사람 삭제 | ❌ | ✅ |
  | 링크 재발급 (예전 링크 차단) | ❌ | ✅ |

## NAS(시놀로지)에 설치

지금 `sentinel-web`을 돌리는 방식(ssh `nas` + Docker CLI)과 똑같이 맞춰 놨어요.

1. NAS에 설정 파일을 하나 만들어요 (처음 한 번만).
   ```bash
   ssh nas "mkdir -p /volume1/docker/family-album"
   scp config.env.example nas:/volume1/docker/family-album/config.env
   ```
   `SITE_NAME`만 원하는 대로 바꾸면 돼요. 예: `김씨네`
2. PC의 Git Bash에서 배포해요.
   ```bash
   cd family-album && ./deploy.sh
   ```
   처음 실행할 때 로그에 **가족 공유 링크**와 **관리자 비밀번호**가 한 번만 찍혀요.
   나중에 다시 보려면 `/volume1/docker/family-album/data/config.json`을 열면 돼요.
3. 밖에서도 접속할 수 있게 주소를 연결해요. 예: `family.visualblending.synology.me`
   - DSM **제어판 → 로그인 포털 → 고급 → 역방향 프록시 → 생성**
     - 소스: `HTTPS` / `family.visualblending.synology.me` / `443`
     - 대상: `HTTP` / `localhost` / `8092`
   - 인증서는 **제어판 → 보안 → 인증서**에서 이 주소에도 Let's Encrypt를 적용해요.
   - `sentinel-gate` nginx를 앞에 두고 있다면, 거기에 이 주소용 server 블록을 추가해요. 이때 큰 동영상이 올라가도록 **`client_max_body_size 4g;`**를 꼭 넣어야 해요.

## 데이터

모든 데이터는 `/volume1/docker/family-album/data` 아래에 있어요. **이 폴더만 Hyper Backup으로 백업하면 돼요.**

```
data/
  originals/YYYY/MM/   ← 올린 원본 그대로
  thumbs/, previews/   ← 목록용 작은 사진 / 보기용 큰 사진
  avatars/             ← 가계도 프로필 사진
  db.json              ← 앨범·사진 정보·가계도
  config.json          ← 공유 키, 관리자 비밀번호 (외부 유출 주의)
```

## 로컬에서 실행

```bash
npm install
FAMILY_KEY=test ADMIN_PASSWORD=admin node server.js
# 접속 주소: http://localhost:8092/?k=test  (PORT를 안 주면 3000번)
```
