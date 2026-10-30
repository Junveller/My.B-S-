/** 하루 = 06:00 ~ 다음날 06:00, 10분 단위 144칸 */
export const SLOTS = 144;
export const DAY_START_HOUR = 6;

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseYmd(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** 06:00 이전이면 전날로 본다 */
export function logicalToday(now = new Date()) {
  const d = new Date(now);
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/** 현재 시각의 칸 위치 (소수) */
export function nowSlot(now = new Date()) {
  const mins = ((now.getHours() - DAY_START_HOUR + 24) % 24) * 60 + now.getMinutes();
  return mins / 10;
}

export function slotLabel(s: number) {
  const mins = s * 10;
  const h = (Math.floor(mins / 60) + DAY_START_HOUR) % 24;
  return `${pad(h)}:${pad(mins % 60)}`;
}

export function hourOfRow(row: number) {
  return (row + DAY_START_HOUR) % 24;
}

export function fmtMinutes(mins: number) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h === 0) return `${m}분`;
  return m ? `${h}시간 ${m}분` : `${h}시간`;
}

/** 26시간 / 3시간 30분 */
export function fmtHours(mins: number) {
  return fmtMinutes(mins);
}

export function fmtHM(mins: number) {
  return `${Math.floor(mins / 60)}:${pad(Math.round(mins % 60))}`;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtDateLong(s: string) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
}
/** 2026년 10월 30일 금 */
export function fmtDateFull(s: string) {
  const d = parseYmd(s);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}`;
}
/** 10/30 금 */
export function fmtDateShort(s: string) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEK[d.getDay()]}`;
}
export function weekday(s: string) {
  return WEEK[parseYmd(s).getDay()];
}

/** 월요일 시작 주 */
export function weekRange(s: string): [string, string] {
  const d = parseYmd(s);
  const offset = (d.getDay() + 6) % 7;
  const start = addDays(s, -offset);
  return [start, addDays(start, 6)];
}

export function monthRange(s: string): [string, string] {
  const d = parseYmd(s);
  return [ymd(new Date(d.getFullYear(), d.getMonth(), 1)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0))];
}

export function ym(s: string) {
  return s.slice(0, 7);
}

export function addMonths(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function clampDay(y: number, m: number, day: number) {
  return new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
}

/** 정산기간: 매달 start일 ~ 다음 달 start-1일 */
export function settlementRange(today: string, start: number): [string, string] {
  const t = parseYmd(today);
  let s = clampDay(t.getFullYear(), t.getMonth(), start);
  if (s > t) s = clampDay(t.getFullYear(), t.getMonth() - 1, start);
  const next = clampDay(s.getFullYear(), s.getMonth() + 1, start);
  next.setDate(next.getDate() - 1);
  return [ymd(s), ymd(next)];
}

/** 다음 월급날까지 남은 일수와 날짜 */
export function nextPayday(today: string, day: number): { date: string; dday: number } {
  const t = parseYmd(today);
  let p = clampDay(t.getFullYear(), t.getMonth(), day);
  if (p < t) p = clampDay(t.getFullYear(), t.getMonth() + 1, day);
  return { date: ymd(p), dday: Math.round((p.getTime() - t.getTime()) / 86400000) };
}

export const won = (n: number) => '₩' + Math.round(n).toLocaleString('ko-KR');
