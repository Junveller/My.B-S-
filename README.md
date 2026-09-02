# My.BㅣSㅓ

개인 일정관리 앱 (Vite + React). 캘린더, 체크리스트, 습관 트래커, AI 비서(챗봇)를 제공하고, 계정별로 로그인해서 씁니다.

## 구조

- `src/` — React 프론트엔드 (Vite)
  - `src/App.jsx` — 전체 UI/화면 (로그인 게이트 포함)
  - `src/lib/auth.js` — 회원가입/로그인 호출, 세션(JWT) 저장
  - `src/lib/storage.js` — 캘린더/체크리스트/습관 데이터 읽기/쓰기 (로그인한 계정의 서버 DB 행을 대상으로 함)
  - `src/lib/api.js` — 비서 채팅 요청 (`/api/chat`으로만 호출, API 키 없음)
- `server/index.js` — Express 서버. 인증 라우트, 계정별 데이터 라우트, `/api/chat`(Gemini 프록시), 프로덕션 빌드(`dist/`) 서빙을 모두 처리합니다.
- `server/db.js` — Postgres 연결 풀 + 테이블 자동 생성(`accounts`, `app_data`)
- `server/auth.js` — 회원가입/로그인/JWT 발급/인증 미들웨어

## 로그인 (사용자 이름 + 4자리 숫자)

이메일/비밀번호 대신 **사용자 이름(닉네임) + 4자리 숫자**로 로그인합니다.

- **사용자 이름은 유일하지 않아도 됩니다.** 동명이인이 여러 명 있을 수 있어요. 대신 **"사용자 이름 + 4자리 숫자" 조합 전체**가 데이터베이스에서 유일해야 합니다(같은 이름이라도 숫자가 다르면 별개 계정).
- 4자리 숫자는 평문으로 저장하지 않고 `bcrypt`로 해싱해서 저장합니다. 조합 유일성 검사는 bcrypt 해시(같은 값이어도 매번 다르게 나옴)로는 할 수 없어서, 별도로 서버 비밀키(`PIN_LOOKUP_SECRET`)로 만든 결정적 HMAC 값을 `(username, pin_lookup)` 유니크 제약으로 걸어뒀습니다. 실제 로그인 인증은 여전히 bcrypt 비교로 처리됩니다.
- 로그인 상태는 JWT(30일 유효)로 유지되고, 브라우저에는 이 토큰만 저장됩니다(`localStorage`) — 원본 4자리 숫자는 어디에도 평문으로 남지 않습니다.
- 모든 데이터 조회/저장은 JWT에 들어있는 **계정 id**로만 구분됩니다. 이름이 같은 두 계정이라도 서버 쪽에서 완전히 분리된 행(row)을 사용하므로 데이터가 섞일 수 없습니다.
- 로그인 시도는 IP당 15분에 20회로 제한되어 있습니다(4자리 숫자는 경우의 수가 10,000개뿐이라 무차별 대입에 취약할 수 있어 최소한의 방어를 넣었습니다).

### 데이터베이스 테이블

```sql
accounts (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL,
  pin_hash TEXT NOT NULL,       -- bcrypt
  pin_lookup TEXT NOT NULL,     -- HMAC(pin, PIN_LOOKUP_SECRET), 조합 유일성 검사용
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (username, pin_lookup)
)

app_data (
  account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,      -- categories/scheduleItems/habits/habitLogs
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 비서 대화 기록
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

서버 시작 시 `server/db.js`의 `initDb()`가 두 테이블을 `CREATE TABLE IF NOT EXISTS`로 자동 생성하므로, 별도 마이그레이션 도구/스텝이 필요 없습니다.

## 시작하기 (로컬 개발)

로컬 Postgres가 필요합니다(예: `postgres://user:pass@localhost:5432/mybiseo`로 접속 가능한 DB 하나).

```bash
npm install
cp .env.example .env
# .env에 채워야 하는 값:
#   GEMINI_API_KEY      - Google AI Studio에서 발급
#   DATABASE_URL        - 로컬 Postgres 연결 문자열
#   JWT_SECRET          - 아무 긴 무작위 문자열 (예: openssl rand -hex 32)
#   PIN_LOOKUP_SECRET   - 위와 다른 무작위 문자열
npm run dev             # 클라이언트(5173) + 서버(5174) 동시 실행
```

`http://localhost:5173` 접속. Vite 개발 서버가 `/api` 요청을 서버(5174)로 프록시합니다. 로그인 화면이 먼저 뜨고, 회원가입 후 바로 로그인됩니다.

## 프로덕션 빌드

```bash
npm run build   # dist/ 생성
npm start        # Express가 dist/ 정적 파일 + API 전체 서빙
```

## 비서(AI 챗봇)

브라우저는 Gemini API 키를 절대 갖지 않습니다. 채팅 메시지는 `/api/chat`(Express, 로그인 필요)으로 전송되고, 서버가 `GEMINI_API_KEY` 환경변수로 Google Gemini API(`gemini-2.5-flash`, 무료 티어)의 `generateContent`를 호출합니다. `generationConfig.responseSchema`로 `{ reply, actions[], askDateChoice }` 형태의 JSON만 나오도록 강제합니다.

## 배포 (Render / Railway)

이 프로젝트는 빌드된 정적 프론트엔드(`dist/`)와 API를 **같은 Express 서버 하나**가 서빙하는 단일 Node 서비스 구조라, 정적 사이트/서버리스 전용인 Vercel·Netlify보다 Node 서버 + DB를 그대로 띄워주는 Render나 Railway가 맞습니다.

- `render.yaml` — Render Blueprint. **무료 Postgres 데이터베이스까지 함께 정의**되어 있어서, 배포하면 DB 생성과 `DATABASE_URL` 연결까지 자동으로 됩니다.
- `railway.json` — Railway 설정. 빌드/실행 커맨드만 정의(Railway는 DB를 대시보드에서 따로 추가).

> **중요 — Render 무료 Postgres는 영구적이지 않습니다.** 생성 후 **30일**이 지나면 만료되고, 이후 **14일** 유예기간 안에 유료 플랜으로 업그레이드하지 않으면 **데이터베이스와 데이터가 통째로 삭제**됩니다(총 44일). Render가 만료 임박/유예기간 임박 시 이메일로 알려줍니다. 계속 무료로 쓰려면 만료 전에 새 무료 DB로 옮겨야 하고(데이터는 자동 이관되지 않음), 데이터를 계속 보존하려면 결국 유료 플랜(Starter, 현재 월 $6~ 수준)으로 넘어가야 합니다. 개인용으로 가볍게 써보는 용도라면 무료로 충분하지만, 이 제약은 꼭 알고 계셔야 해요.

### A. Render로 배포하기

1. https://render.com 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. 대시보드에서 **New +** → **Blueprint** 선택.
3. 이 저장소(`Junveller/My.B-S-`)를 선택하고, 배포할 브랜치를 지정합니다. Render가 루트의 `render.yaml`을 읽어서 **웹 서비스 + Postgres 데이터베이스**를 함께 만듭니다.
4. `JWT_SECRET`/`PIN_LOOKUP_SECRET`/`DATABASE_URL`은 자동으로 채워지지만, `GEMINI_API_KEY`는 비어 있어 직접 입력해야 합니다. 서비스 페이지 → **Environment** 탭에서 `GEMINI_API_KEY` 값을 입력하고 저장합니다.
5. 저장하면 자동으로 재배포됩니다. 배포가 끝나면 서비스 페이지 상단에 `https://my-biseo-xxxx.onrender.com` 형태의 주소가 생깁니다.
6. 무료 웹 서비스는 트래픽이 없으면 슬립되고 다음 요청 시 깨어나는 데 수십 초 걸릴 수 있습니다. 무료 Postgres의 만료 정책은 위 안내를 참고하세요.

### B. Railway로 배포하기

1. https://railway.app 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. **New Project** → **Deploy from GitHub repo** → 이 저장소 선택. Railway가 `railway.json`을 읽어 빌드/실행 커맨드를 설정합니다.
3. 같은 프로젝트에 **+ New** → **Database** → **PostgreSQL**을 추가합니다.
4. 웹 서비스의 **Variables** 탭에서 `DATABASE_URL`을 추가하고, 값으로 방금 만든 Postgres 서비스의 연결 문자열을 참조/붙여넣습니다(Railway가 서비스 간 변수 참조 UI를 제공합니다).
5. 같은 탭에 `GEMINI_API_KEY`, `JWT_SECRET`, `PIN_LOOKUP_SECRET`(둘 다 아무 긴 무작위 문자열)을 추가합니다. 필요하면 `GEMINI_MODEL`도.
6. **Settings** → **Networking** → **Generate Domain**으로 공개 주소를 발급받습니다.
7. 이후 브랜치에 새 커밋을 푸시하면 자동으로 재빌드/재배포됩니다.

### 배포 후 확인할 것

- `https://<배포주소>/` 접속 시 로그인 화면이 뜨는지
- `https://<배포주소>/api/health` 가 `{"ok":true}`를 반환하는지
- 회원가입 → 체크리스트에 항목 추가 → 새로고침해도 항목이 남아있는지(서버 DB에 저장된다는 뜻)
- 같은 사용자 이름으로 다른 숫자를 써서 회원가입한 뒤, 서로의 데이터가 안 보이는지
- 비서 화면에서 메시지를 보냈을 때 정상 응답이 오는지
