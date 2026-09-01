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
