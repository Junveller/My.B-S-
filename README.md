# My.BㅣSㅓ

개인 일정관리 앱 (Vite + React). 캘린더, 체크리스트, 습관 트래커, AI 비서(챗봇)를 제공하고, 계정별로 로그인해서 씁니다.

## 구조

- `src/` — React 프론트엔드 (Vite)
  - `src/App.jsx` — 전체 UI/화면 (로그인 게이트 포함)
  - `src/lib/auth.js` — 회원가입/로그인 호출, 세션(JWT) 저장
  - `src/lib/storage.js` — 캘린더/체크리스트/습관 데이터 읽기/쓰기 (로그인한 계정의 서버 데이터를 대상으로 함)
  - `src/lib/api.js` — 비서 채팅 요청 (`/api/chat`으로만 호출, API 키 없음)
- `server/index.js` — Express 서버. 인증 라우트, 계정별 데이터 라우트, `/api/chat`(Gemini 프록시), 프로덕션 빌드(`dist/`) 서빙을 모두 처리합니다.
- `server/db.js` — Firebase Admin SDK 초기화 + Firestore 핸들
- `server/auth.js` — 회원가입/로그인/JWT 발급/인증 미들웨어

**클라이언트는 Firebase를 전혀 모릅니다.** 브라우저는 여전히 우리 서버의 `/api/*`만 호출하고, Firestore 접근은 서버(Firebase Admin SDK)만 합니다 — DB를 Postgres에서 Firestore로 바꿔도 프론트엔드 코드는 한 줄도 바뀌지 않았습니다.

## 로그인 (사용자 이름 + 4자리 숫자) — 왜 Firebase Authentication을 안 썼는지

이메일/비밀번호 대신 **사용자 이름(닉네임) + 4자리 숫자**로 로그인합니다. **Firebase Authentication의 이메일/비밀번호 방식은 쓰지 않았습니다** — Firebase Auth는 비밀번호 최소 길이를 6자로 강제해서 4자리 숫자를 그대로 비밀번호로 쓸 수가 없고(형식이 근본적으로 안 맞음), 여기서 필요한 "이름+숫자 조합 유일성" 같은 규칙도 Firebase Auth가 대신해주지 않습니다. 대신 이전 버전에서 이미 만들어뒀던 자체 인증(bcrypt 해싱 + JWT 세션)을 그대로 쓰고, **Firestore는 순수 데이터베이스로만** 사용합니다 — Firebase Auth 클라이언트 SDK, 커스텀 토큰 발급, Firestore 보안 규칙 같은 걸 새로 얹지 않아서 구조가 지금까지와 동일하게 단순합니다(서버가 유일한 관문, 브라우저는 DB에 직접 접근하지 않음).

- **사용자 이름은 유일하지 않아도 됩니다.** 동명이인이 여러 명 있을 수 있어요. 대신 **"사용자 이름 + 4자리 숫자" 조합 전체**가 유일해야 합니다(같은 이름이라도 숫자가 다르면 별개 계정).
- 4자리 숫자는 평문으로 저장하지 않고 `bcrypt`로 해싱해서 저장합니다(`pinHash`).
- **조합 유일성**은 Firestore의 문서 ID로 강제합니다: `username`+PIN을 서버 비밀키(`PIN_LOOKUP_SECRET`)로 keyed-HMAC 해서 만든 값을 `accounts` 컬렉션의 문서 ID로 씁니다. 이 값 하나가 계정의 고유 식별자 역할까지 겸해서, 회원가입은 `accounts.doc(key).create(...)`로 처리되는데 — Firestore의 `create()`는 같은 ID의 문서가 이미 있으면 원자적으로 실패하기 때문에(동시 가입 경쟁 상태에도 안전), 별도 트랜잭션 없이 "조합 중복 방지"가 됩니다. 실제 로그인 인증은 여전히 `bcrypt.compare()`로 처리됩니다.
- 로그인 상태는 JWT(30일 유효)로 유지되고, 브라우저에는 이 토큰만 저장됩니다(`localStorage`) — 원본 4자리 숫자는 어디에도 평문으로 남지 않습니다.
- 모든 데이터 조회/저장은 JWT에 들어있는 **계정 키**로만 구분됩니다. 이름이 같은 두 계정이라도 서버 쪽에서 완전히 분리된 문서를 쓰므로 데이터가 섞일 수 없습니다.
- 로그인 시도는 IP당 15분에 20회로 제한되어 있습니다(4자리 숫자는 경우의 수가 10,000개뿐이라 무차별 대입에 취약할 수 있어 최소한의 방어를 넣었습니다).

### Firestore 컬렉션 구조

```
accounts/{accountKey}            accountKey = HMAC-SHA256(username + " " + pin, PIN_LOOKUP_SECRET)
  username: string
  pinHash: string                 (bcrypt)
  createdAt: timestamp

appData/{accountKey}              같은 accountKey를 문서 ID로 재사용
  data: { categories, scheduleItems, habits, habitLogs }
  messages: [ 비서 대화 기록 ]
  updatedAt: timestamp
```

Firestore는 스키마가 없어서 별도 마이그레이션이 필요 없습니다 — 컬렉션/문서는 첫 쓰기 시점에 자동으로 생깁니다.

## 시작하기 (로컬 개발)

Firebase 프로젝트와 서비스 계정 키가 필요합니다(아래 "Firebase 콘솔 설정" 참고).

```bash
npm install
cp .env.example .env
# .env에 채워야 하는 값:
#   GEMINI_API_KEY                  - Google AI Studio에서 발급
#   FIREBASE_SERVICE_ACCOUNT_JSON   - Firebase 서비스 계정 키 JSON 전체(한 줄로)
#   JWT_SECRET                      - 아무 긴 무작위 문자열 (예: openssl rand -hex 32)
#   PIN_LOOKUP_SECRET               - 위와 다른 무작위 문자열
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

## Firebase 콘솔 설정 (순서대로)

1. https://console.firebase.google.com 접속 → **프로젝트 추가**로 새 프로젝트를 만듭니다(Google Analytics는 꺼도 무방합니다).
2. 왼쪽 메뉴 **빌드 → Firestore Database** → **데이터베이스 만들기**. 위치는 가까운 리전(예: `asia-northeast3` 서울)을 고르고, **프로덕션 모드**로 시작합니다(어차피 클라이언트는 Firestore에 직접 접근하지 않고 서버(Admin SDK)만 접근하므로 보안 규칙 설정은 필요 없습니다 — Admin SDK는 규칙을 우회합니다).
3. **Firestore 요금제(Spark/무료)**: Firestore Spark 플랜은 저장 1GiB, 하루 읽기 5만 회/쓰기 2만 회/삭제 2만 회까지 **영구 무료**이고, Render 무료 Postgres와 달리 **만료되지 않습니다** — 원하셨던 "만료 걱정 없는 무료 티어"에 정확히 맞습니다. 개인용 습관 관리 앱 트래픽으로는 충분한 한도입니다.
4. **서비스 계정 키 발급**: 왼쪽 위 톱니바퀴 → **프로젝트 설정** → **서비스 계정** 탭 → **새 비공개 키 생성** 클릭. `프로젝트이름-firebase-adminsdk-....json` 파일이 다운로드됩니다. **이 파일은 절대 저장소에 커밋하지 마세요** — 내용 전체를 배포 환경의 `FIREBASE_SERVICE_ACCOUNT_JSON` 환경변수 값으로 붙여넣습니다(줄바꿈 이스코프는 JSON 안에 이미 포함돼 있어 그대로 붙여넣으면 됩니다).

## 배포 (Render / Railway)

이 프로젝트는 빌드된 정적 프론트엔드(`dist/`)와 API를 **같은 Express 서버 하나**가 서빙하는 단일 Node 서비스 구조라, 정적 사이트/서버리스 전용인 Vercel·Netlify보다 Node 서버를 그대로 띄워주는 Render나 Railway가 맞습니다. 데이터베이스는 이제 Render/Railway가 아니라 **Firebase 쪽 리소스**라서, 어느 플랫폼에 배포하든 위 "Firebase 콘솔 설정"은 동일하게 한 번만 하면 됩니다.

- `render.yaml` — Render Blueprint. 빌드/실행 커맨드와 `JWT_SECRET`/`PIN_LOOKUP_SECRET`(자동 생성)까지 정의되어 있습니다. `GEMINI_API_KEY`와 `FIREBASE_SERVICE_ACCOUNT_JSON`만 직접 입력하면 됩니다.
- `railway.json` — Railway 설정. 빌드/실행 커맨드만 정의.

### A. Render로 배포하기

1. https://render.com 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. 대시보드에서 **New +** → **Blueprint** 선택.
3. 이 저장소(`Junveller/My.B-S-`)를 선택하고, 배포할 브랜치를 지정합니다. Render가 루트의 `render.yaml`을 읽어서 웹 서비스를 만듭니다.
4. `JWT_SECRET`/`PIN_LOOKUP_SECRET`은 자동 생성되지만, `GEMINI_API_KEY`와 `FIREBASE_SERVICE_ACCOUNT_JSON`은 비어 있어 직접 입력해야 합니다. 서비스 페이지 → **Environment** 탭에서 두 값을 입력하고 저장합니다(`FIREBASE_SERVICE_ACCOUNT_JSON`에는 위에서 받은 JSON 파일 내용 전체를 붙여넣으세요).
5. 저장하면 자동으로 재배포됩니다. 배포가 끝나면 서비스 페이지 상단에 `https://my-biseo-xxxx.onrender.com` 형태의 주소가 생깁니다.
6. 무료 웹 서비스는 트래픽이 없으면 슬립되고 다음 요청 시 깨어나는 데 수십 초 걸릴 수 있습니다. (Firestore는 Render와 무관하게 만료되지 않습니다.)

### B. Railway로 배포하기

1. https://railway.app 에서 계정을 만들고 GitHub 계정을 연결합니다.
2. **New Project** → **Deploy from GitHub repo** → 이 저장소 선택. Railway가 `railway.json`을 읽어 빌드/실행 커맨드를 설정합니다.
3. 웹 서비스의 **Variables** 탭에서 `GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT_JSON`(JSON 파일 내용 전체), `JWT_SECRET`, `PIN_LOOKUP_SECRET`(둘 다 아무 긴 무작위 문자열)을 추가합니다. 필요하면 `GEMINI_MODEL`도.
4. **Settings** → **Networking** → **Generate Domain**으로 공개 주소를 발급받습니다.
5. 이후 브랜치에 새 커밋을 푸시하면 자동으로 재빌드/재배포됩니다.

### 배포 후 확인할 것

- `https://<배포주소>/` 접속 시 로그인 화면이 뜨는지
- `https://<배포주소>/api/health` 가 `{"ok":true}`를 반환하는지
- 회원가입 → 체크리스트에 항목 추가 → 새로고침해도 항목이 남아있는지(Firestore에 저장된다는 뜻)
- 같은 사용자 이름으로 다른 숫자를 써서 회원가입한 뒤, 서로의 데이터가 안 보이는지
- 비서 화면에서 메시지를 보냈을 때 정상 응답이 오는지
- Firebase 콘솔 → Firestore Database에서 `accounts`/`appData` 컬렉션에 문서가 실제로 쌓이는지
