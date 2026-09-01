# My.BㅣSㅓ

개인 일정관리 앱 (Vite + React). 캘린더, 체크리스트, 습관 트래커, AI 비서(챗봇)를 제공합니다.

## 구조

- `src/` — React 프론트엔드 (Vite)
  - `src/App.jsx` — 전체 UI/화면
  - `src/lib/storage.js` — 데이터 읽기/쓰기 (현재 `localStorage`, 나중에 백엔드로 교체 가능하도록 함수로 분리됨)
  - `src/lib/api.js` — 비서 채팅 요청 (`/api/chat`으로만 호출, API 키 없음)
- `server/index.js` — Express 서버. `/api/chat`에서 `ANTHROPIC_API_KEY`로 Anthropic API를 대신 호출하고, 프로덕션 빌드(`dist/`)도 서빙합니다.

## 시작하기

```bash
npm install
cp .env.example .env   # ANTHROPIC_API_KEY 값을 채워주세요
npm run dev             # 클라이언트(5173) + 서버(5174) 동시 실행
```

`http://localhost:5173` 접속. Vite 개발 서버가 `/api` 요청을 서버(5174)로 프록시합니다.

## 프로덕션 빌드

```bash
npm run build   # dist/ 생성
npm start        # Express가 dist/ 정적 파일 + /api/chat 서빙
```

## 데이터 저장

현재는 브라우저 `localStorage`에 저장됩니다(`src/lib/storage.js`). 나중에 백엔드(예: Node/Express + SQLite)로 옮기려면 `storage.js`의 `readKey`/`writeKey` 내부만 `fetch`로 바꾸면 됩니다 — 화면 컴포넌트는 수정할 필요가 없습니다.

## 비서(AI 챗봇)

브라우저는 Anthropic API 키를 절대 갖지 않습니다. 채팅 메시지는 `/api/chat`(Express)으로 전송되고, 서버가 `ANTHROPIC_API_KEY` 환경변수로 Anthropic Messages API를 호출한 뒤 응답을 그대로 클라이언트에 반환합니다.

## 배포 (Render / Railway)

이 프로젝트는 빌드된 정적 프론트엔드(`dist/`)와 `/api/chat`을 **같은 Express 서버 하나**가 서빙하는 단일 Node 서비스 구조입니다. 그래서 정적 사이트/서버리스 전용인 Vercel·Netlify보다, Node 서버를 그대로 띄워주는 Render나 Railway가 이 구조에 맞습니다. 저장소 루트에 두 플랫폼용 설정 파일을 넣어뒀습니다.

- `render.yaml` — Render Blueprint. 빌드: `npm install && npm run build`, 실행: `npm start`, 헬스체크: `/api/health`
- `railway.json` — Railway 설정. 동일한 빌드/실행 커맨드 사용

공통적으로 필요한 건 딱 하나, **환경변수 `ANTHROPIC_API_KEY`** 입니다(Anthropic 콘솔에서 발급). 두 파일 모두 이 값은 `sync: false`로 되어 있어 저장소에 커밋되지 않고, 배포 후 각 플랫폼 대시보드에서 직접 입력해야 합니다.

### A. Render로 배포하기

1. https://render.com 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. 대시보드에서 **New +** → **Blueprint** 선택.
3. 이 저장소(`Junveller/My.B-S-`)를 선택하고, 배포할 브랜치로 `claude/vite-react-migration-ip2qq5`(또는 머지된 `main`)를 지정합니다. Render가 루트의 `render.yaml`을 자동으로 읽어 서비스를 구성합니다.
4. **Apply**를 누르면 서비스가 생성되지만, `ANTHROPIC_API_KEY`가 비어 있어 빌드 후 첫 배포 상태가 "환경변수 필요"로 표시됩니다. 서비스 페이지 → **Environment** 탭에서 `ANTHROPIC_API_KEY` 값을 입력하고 저장합니다.
5. 저장하면 자동으로 재배포됩니다. 배포가 끝나면 서비스 페이지 상단에 `https://my-biseo-xxxx.onrender.com` 형태의 주소가 생깁니다 — 이게 실제 배포 URL입니다.
6. 무료 플랜은 일정 시간 요청이 없으면 슬립 상태가 되고, 다음 요청 시 다시 깨어나는 데 수십 초가 걸릴 수 있습니다. 상시 서비스가 필요하면 유료 플랜으로 업그레이드하세요.

### B. Railway로 배포하기

1. https://railway.app 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. **New Project** → **Deploy from GitHub repo** → 이 저장소 선택.
3. 배포할 브랜치를 `claude/vite-react-migration-ip2qq5`(또는 머지된 `main`)로 지정합니다. Railway가 루트의 `railway.json`을 읽어 빌드/실행 커맨드를 설정합니다.
4. 서비스 생성 후 **Variables** 탭에서 `ANTHROPIC_API_KEY`를 추가합니다(필요하면 `ANTHROPIC_MODEL`도).
5. **Settings** → **Networking**에서 **Generate Domain**을 눌러 `https://my-biseo-production.up.railway.app` 같은 공개 주소를 발급받습니다.
6. 이후 브랜치에 새 커밋을 푸시하면 Railway가 자동으로 재빌드/재배포합니다.

### 배포 후 확인할 것

- `https://<배포주소>/` 접속 시 홈 화면이 뜨는지
- `https://<배포주소>/api/health` 가 `{"ok":true}`를 반환하는지
- 비서 화면에서 메시지를 보냈을 때 정상 응답이 오는지(키가 잘못됐거나 비어 있으면 "연결에 문제가 있었어요"가 뜹니다 — 이 경우 대시보드의 환경변수 값을 다시 확인하세요)
