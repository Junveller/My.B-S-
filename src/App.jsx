import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Home, Calendar as CalIcon, CheckSquare, Sparkles, MessageCircle,
  ChevronLeft, ChevronRight, Plus, X, Check, Send, Circle, Clock,
  Link as LinkIcon, Settings, Trash2, Save, Download, Upload, LogOut,
} from "lucide-react";
import { loadData, saveData, loadMessages, saveMessages } from "./lib/storage.js";
import { sendChat } from "./lib/api.js";
import { getToken, getUsername, clearSession, register, login } from "./lib/auth.js";

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */
const C = {
  bg: "#FBF8F4",
  card: "#FFFFFF",
  beige: "#F1E6D3",
  beigeDeep: "#C89F68",
  lavender: "#E7DAF3",
  lavenderMid: "#C9B3E4",
  lavenderDeep: "#8868B3",
  ink: "#423C52",
  inkMuted: "#948C9E",
  border: "#EAE2F0",
};

const DEFAULT_CATEGORIES = [
  { id: "assignment", name: "과제", color: "#B7A4DE" },
  { id: "job", name: "취업준비", color: "#D9B98C" },
  { id: "habitcat", name: "습관", color: "#C9A8C4" },
  { id: "todo", name: "todo 리스트", color: "#A9B7D9" },
  { id: "schedule", name: "스케쥴", color: "#CBB89A" },
];

const STATUS_ORDER = ["준비중", "곧 시작", "임박", "종료"];
const STATUS_STYLE = {
  "준비중": { bg: "#E7E1ED", text: "#6B6478" },
  "곧 시작": { bg: "#CBB8E8", text: "#4A3B6B" },
  "임박": { bg: "#E3A9A9", text: "#FFFFFF" },
  "종료": { bg: "#A7C9A7", text: "#FFFFFF" },
};

const ICON_SETS = {
  얼굴: ["😐", "🙂", "😊", "😄"],
  강아지: ["🐾", "🐕", "🐩", "🐶"],
  클로버: ["🍂", "🌱", "🍃", "🍀"],
};

const uid = () => Math.random().toString(36).slice(2, 10);
// Local calendar date, not UTC: toISOString() would shift the date back
// a day for any timezone ahead of UTC (e.g. KST) once it's past local
// midnight but still the previous day in UTC.
const fmt = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// "오늘"은 기기/브라우저의 시간대 설정과 무관하게 항상 한국(Asia/Seoul) 기준
// 달력 날짜여야 한다 — en-CA 로케일은 YYYY-MM-DD 포맷을 그대로 내어준다.
const KST_TODAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const todayStr = () => KST_TODAY_FORMATTER.format(new Date());
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return fmt(d);
};
const dayDiff = (a, b) => {
  const A = new Date(a + "T00:00:00");
  const B = new Date(b + "T00:00:00");
  return Math.round((B - A) / 86400000);
};
const tierOf = (p) => (p == null ? -1 : p <= 25 ? 0 : p <= 50 ? 1 : p <= 75 ? 2 : 3);

/* ------------------------------------------------------------------ */
/* Small shared UI bits                                                */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE["준비중"];
  return (
    <span
      className="text-[11px] px-2 py-1 rounded-md font-medium whitespace-nowrap"
      style={{ background: s.bg, color: s.text }}
    >
      {status}
    </span>
  );
}

function IconBtn({ onClick, children, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="w-9 h-9 flex items-center justify-center rounded-full active:scale-95 transition"
      style={{ color: C.lavenderDeep }}
    >
      {children}
    </button>
  );
}

function Modal({ onClose, title, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: "rgba(66,60,82,0.35)" }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 max-h-[85vh] overflow-y-auto"
        style={{ background: C.card }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold" style={{ color: C.ink }}>
            {title}
          </h3>
          <IconBtn onClick={onClose} label="닫기">
            <X size={18} />
          </IconBtn>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-xs mb-1" style={{ color: C.inkMuted }}>
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: `1px solid ${C.border}`,
  background: C.bg,
  color: C.ink,
  fontSize: 14,
  outline: "none",
};

/* ------------------------------------------------------------------ */
/* Home                                                                 */
/* ------------------------------------------------------------------ */
function timeAgoLabel(date) {
  if (!date) return null;
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${h12}:${String(m).padStart(2, "0")}`;
}

function Home_({
  setScreen,
  scheduleItems,
  onManualSave,
  saveStatus,
  lastSaved,
  loadedFromStorage,
  data,
  setData,
  username,
  onLogout,
}) {
  const urgent = scheduleItems.filter((i) => i.status === "임박" && !i.completed);
  const [showBackup, setShowBackup] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");

  const exportText = JSON.stringify(data, null, 2);

  const doImport = () => {
    try {
      const parsed = JSON.parse(importText);
      if (!parsed.categories || !parsed.scheduleItems || !parsed.habits || !parsed.habitLogs) {
        setImportMsg("형식이 올바르지 않아요. My.BㅣSㅓ 백업 텍스트인지 확인해주세요.");
        return;
      }
      setData(parsed);
      setImportMsg("불러왔어요. 상단 '저장' 버튼을 눌러 저장해주세요.");
    } catch {
      setImportMsg("텍스트를 읽을 수 없어요. 백업 텍스트를 그대로 붙여넣었는지 확인해주세요.");
    }
  };

  return (
    <div className="flex flex-col h-full px-6 pt-2 pb-6">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm" style={{ color: C.inkMuted }}>
          {username ? `${username}님, ` : ""}오늘도 잘하고 있어요
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onLogout}
            className="w-8 h-8 flex items-center justify-center rounded-full shrink-0"
            style={{ background: C.bg }}
            aria-label="로그아웃"
          >
            <LogOut size={14} color={C.inkMuted} />
          </button>
          <button
            onClick={() => setShowBackup(true)}
            className="w-8 h-8 flex items-center justify-center rounded-full shrink-0"
            style={{ background: C.bg }}
          >
            <Download size={14} color={C.inkMuted} />
          </button>
          <button
            onClick={onManualSave}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full shrink-0"
            style={{ background: C.lavender, color: C.ink }}
          >
            <Save size={12} />
            {saveStatus === "saving"
              ? "저장 중…"
              : saveStatus === "saved"
              ? "저장됨 ✓"
              : "저장"}
          </button>
        </div>
      </div>
      {lastSaved && (
        <div className="text-[11px] mb-1" style={{ color: C.inkMuted }}>
          마지막 저장 {timeAgoLabel(lastSaved)}
        </div>
      )}
      {!lastSaved && (
        <div className="text-[11px] mb-1" style={{ color: C.inkMuted }}>
          {loadedFromStorage
            ? "이전에 저장된 내용을 불러왔어요"
            : "아직 저장된 내용이 없어요 · 뭔가 추가하면 자동 저장돼요"}
        </div>
      )}
      <h1
        className="text-3xl font-bold mb-8 tracking-tight"
        style={{ color: C.ink }}
      >
        My.B<span style={{ color: C.lavenderDeep }}>l</span>S
        <span style={{ color: C.lavenderDeep }}>ㅓ</span>
      </h1>

      {urgent.length > 0 && (
        <div
          className="mb-6 rounded-2xl p-3"
          style={{ background: "#F6E4E4", border: "1px solid #E3A9A9" }}
        >
          {urgent.map((i) => (
            <div key={i.id} className="text-sm" style={{ color: "#7A2E2E" }}>
              임박‼️ {i.title}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { key: "calendar", label: "캘린더", icon: CalIcon, bg: C.lavender },
          { key: "assistant", label: "비서", icon: MessageCircle, bg: C.beige },
          { key: "habits", label: "습관", icon: Sparkles, bg: "#E4D8EE" },
          { key: "checklist", label: "체크리스트", icon: CheckSquare, bg: "#EFE3D0" },
        ].map((c) => (
          <button
            key={c.key}
            onClick={() => setScreen(c.key)}
            className="rounded-3xl p-5 flex flex-col items-start gap-6 active:scale-[0.98] transition h-32"
            style={{ background: c.bg }}
          >
            <c.icon size={22} style={{ color: C.ink }} />
            <span className="text-sm font-semibold" style={{ color: C.ink }}>
              {c.label}
            </span>
          </button>
        ))}
      </div>

      {showBackup && (
        <Modal onClose={() => setShowBackup(false)} title="백업 (내보내기 / 불러오기)">
          <div className="text-[11px] mb-3" style={{ color: C.inkMuted }}>
            자동 저장이 불안하면, 아래 텍스트를 복사해서 메모장 등에 보관해두세요.
            나중에 이 화면에 다시 붙여넣고 "불러오기"를 누르면 복원돼요.
          </div>
          <Field label="현재 데이터 (복사해서 백업하세요)">
            <textarea
              readOnly
              value={exportText}
              onFocus={(e) => e.target.select()}
              style={{ ...inputStyle, minHeight: 110, fontSize: 11, resize: "vertical" }}
            />
          </Field>
          <Field label="백업 텍스트 붙여넣어 복원">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="여기에 백업 텍스트를 붙여넣으세요"
              style={{ ...inputStyle, minHeight: 90, fontSize: 11, resize: "vertical" }}
            />
          </Field>
          {importMsg && (
            <div className="text-[11px] mb-2" style={{ color: C.lavenderDeep }}>
              {importMsg}
            </div>
          )}
          <button
            onClick={doImport}
            className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1"
            style={{ background: C.lavenderDeep, color: "#fff" }}
          >
            <Upload size={14} /> 불러오기
          </button>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar                                                             */
/* ------------------------------------------------------------------ */
function monthWeeks(y, m) {
  const first = new Date(y, m, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const gridStart = new Date(y, m, 1 - startOffset);
  const dates = Array.from({ length: totalCells }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const weeks = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return weeks;
}

const MAX_WEEK_LANES = 4;

function layoutWeek(weekDateStrs, items) {
  const weekStart = weekDateStrs[0];
  const weekEnd = weekDateStrs[6];
  const weekItems = items
    .filter((i) => i.startDate <= weekEnd && i.endDate >= weekStart)
    .sort((a, b) => {
      const aDur = dayDiff(a.startDate, a.endDate);
      const bDur = dayDiff(b.startDate, b.endDate);
      if (aDur !== bDur) return bDur - aDur;
      return a.startDate.localeCompare(b.startDate);
    });
  const laneEnds = [];
  const placed = [];
  for (const it of weekItems) {
    const startCol =
      it.startDate < weekStart ? 0 : weekDateStrs.indexOf(it.startDate);
    const endCol = it.endDate > weekEnd ? 6 : weekDateStrs.indexOf(it.endDate);
    let lane = laneEnds.findIndex((endUsed) => endUsed < startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endCol);
    } else {
      laneEnds[lane] = endCol;
    }
    placed.push({ item: it, startCol, endCol, lane });
  }
  return placed;
}

function CalendarScreen({ data, setData }) {
  const [cursor, setCursor] = useState(() => {
    const [y, m] = todayStr().split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [picker, setPicker] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const touchX = useRef(null);

  const monthChange = (delta) => {
    setCursor((c) => {
      let m = c.m + delta;
      let y = c.y;
      if (m < 0) { m = 11; y -= 1; }
      if (m > 11) { m = 0; y += 1; }
      return { y, m };
    });
  };

  const weeks = monthWeeks(cursor.y, cursor.m);

  const itemsForDate = (ds) =>
    data.scheduleItems.filter((i) => ds >= i.startDate && ds <= i.endDate);

  const catColor = (categoryId) =>
    data.categories.find((c) => c.id === categoryId)?.color || C.lavenderMid;

  const catName = (categoryId) =>
    data.categories.find((c) => c.id === categoryId)?.name || "";

  const monthFirst = `${cursor.y}-${String(cursor.m + 1).padStart(2, "0")}-01`;
  const monthLast = fmt(new Date(cursor.y, cursor.m + 1, 0));
  const monthItems = data.scheduleItems
    .filter((i) => i.startDate <= monthLast && i.endDate >= monthFirst)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  return (
    <div className="flex flex-col h-full px-3 pt-2 overflow-y-auto pb-4">
      <div className="flex items-center justify-between mb-4 px-2">
        <IconBtn onClick={() => monthChange(-1)} label="이전 달">
          <ChevronLeft size={20} />
        </IconBtn>
        <button
          onClick={() => setPicker(true)}
          className="text-base font-semibold px-3 py-1 rounded-full"
          style={{ color: C.ink }}
        >
          {cursor.y}년 {cursor.m + 1}월
        </button>
        <IconBtn onClick={() => monthChange(1)} label="다음 달">
          <ChevronRight size={20} />
        </IconBtn>
      </div>

      <div
        className="grid grid-cols-7 text-center text-xs mb-1 px-1"
        style={{ color: C.inkMuted }}
      >
        {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
          <div key={d} style={i === 0 ? { color: "#C77676" } : {}}>
            {d}
          </div>
        ))}
      </div>

      <div
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (dx > 60) monthChange(-1);
          if (dx < -60) monthChange(1);
          touchX.current = null;
        }}
      >
        {weeks.map((week, wi) => {
          const weekDateStrs = week.map(fmt);
          const placed = layoutWeek(weekDateStrs, data.scheduleItems).filter(
            (p) => p.lane < MAX_WEEK_LANES
          );
          return (
            <div
              key={wi}
              style={{
                borderTop: wi > 0 ? `1px solid ${C.border}` : "none",
                paddingTop: 6,
                paddingBottom: 6,
              }}
            >
              <div className="grid grid-cols-7 mb-1">
                {week.map((d, di) => {
                  const ds = fmt(d);
                  const inMonth = d.getMonth() === cursor.m;
                  const isToday = ds === todayStr();
                  return (
                    <button
                      key={di}
                      onClick={() => setSelectedDay(ds)}
                      className="flex justify-center py-0.5"
                    >
                      <span
                        className="w-6 h-6 flex items-center justify-center rounded-full text-xs"
                        style={
                          isToday
                            ? { background: C.lavenderDeep, color: "#fff" }
                            : {
                                color: inMonth ? C.ink : C.inkMuted,
                                opacity: inMonth ? 1 : 0.5,
                              }
                        }
                      >
                        {d.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>
              {placed.length > 0 && (
                <div
                  className="grid gap-[2px]"
                  style={{
                    gridTemplateColumns: "repeat(7, 1fr)",
                    gridAutoRows: "16px",
                  }}
                >
                  {placed.map((p) => {
                    const isMulti = p.item.startDate !== p.item.endDate;
                    return (
                      <button
                        key={p.item.id}
                        onClick={() => setSelectedItem(p.item)}
                        className="text-[10px] truncate text-left px-1 rounded"
                        style={{
                          gridColumn: `${p.startCol + 1} / ${p.endCol + 2}`,
                          gridRow: p.lane + 1,
                          background: isMulti
                            ? catColor(p.item.categoryId)
                            : hexAlpha(catColor(p.item.categoryId), 0.18),
                          color: isMulti ? "#fff" : C.ink,
                          borderLeft: isMulti
                            ? "none"
                            : `2px solid ${catColor(p.item.categoryId)}`,
                        }}
                      >
                        {p.item.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 px-2">
        <div className="text-sm font-semibold mb-2" style={{ color: C.ink }}>
          {cursor.m + 1}월 일정
        </div>
        {monthItems.length === 0 && (
          <div className="text-sm text-center py-6" style={{ color: C.inkMuted }}>
            이번 달 등록된 일정이 없어요
          </div>
        )}
        <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
          {monthItems.map((it, idx) => (
            <div
              key={it.id}
              className="flex items-center justify-between px-4 py-3"
              style={idx > 0 ? { borderTop: `1px solid ${C.border}` } : {}}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: catColor(it.categoryId) }}
                />
                <div className="min-w-0">
                  <div
                    className="text-sm truncate"
                    style={{
                      color: it.completed ? C.inkMuted : C.ink,
                      textDecoration: it.completed ? "line-through" : "none",
                    }}
                  >
                    {it.title}
                  </div>
                  <div className="text-[11px]" style={{ color: C.inkMuted }}>
                    {catName(it.categoryId)} · {it.startDate.slice(5)}~
                    {it.endDate.slice(5)}
                  </div>
                </div>
              </div>
              <StatusBadge status={it.status} />
            </div>
          ))}
        </div>
      </div>

      {selectedDay && (
        <Modal
          onClose={() => setSelectedDay(null)}
          title={`${Number(selectedDay.slice(5, 7))}월 ${Number(selectedDay.slice(8, 10))}일`}
        >
          {itemsForDate(selectedDay).length === 0 && (
            <div className="text-sm py-6 text-center" style={{ color: C.inkMuted }}>
              이 날의 일정이 없어요
            </div>
          )}
          {itemsForDate(selectedDay).map((it) => (
            <div
              key={it.id}
              className="flex items-center justify-between py-2 border-b last:border-0"
              style={{ borderColor: C.border }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: catColor(it.categoryId) }}
                />
                <span
                  className="text-sm truncate"
                  style={{
                    color: C.ink,
                    textDecoration: it.completed ? "line-through" : "none",
                  }}
                >
                  {it.title}
                </span>
              </div>
              <StatusBadge status={it.status} />
            </div>
          ))}
        </Modal>
      )}

      {selectedItem && (
        <Modal onClose={() => setSelectedItem(null)} title={selectedItem.title}>
          <div className="flex items-center gap-2 mb-3">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: catColor(selectedItem.categoryId) }}
            />
            <span className="text-sm" style={{ color: C.inkMuted }}>
              {catName(selectedItem.categoryId)}
            </span>
            <span className="ml-auto">
              <StatusBadge status={selectedItem.status} />
            </span>
          </div>
          <div className="text-sm mb-1" style={{ color: C.ink }}>
            {selectedItem.startDate} ~ {selectedItem.endDate}
          </div>
          {selectedItem.time && (
            <div className="text-sm flex items-center gap-1" style={{ color: C.inkMuted }}>
              <Clock size={12} /> {selectedItem.time}
            </div>
          )}
          {selectedItem.link && (
            <div className="text-sm flex items-center gap-1 truncate" style={{ color: C.lavenderDeep }}>
              <LinkIcon size={12} /> {selectedItem.link}
            </div>
          )}
          {selectedItem.memo && (
            <div className="text-sm mt-2" style={{ color: C.ink }}>
              {selectedItem.memo}
            </div>
          )}
          <div className="text-[11px] mt-3" style={{ color: C.inkMuted }}>
            자세한 수정은 체크리스트 화면에서 할 수 있어요.
          </div>
        </Modal>
      )}

      {picker && (
        <Modal onClose={() => setPicker(false)} title="년/월 이동">
          <div className="flex items-center justify-center gap-4 mb-4">
            <IconBtn onClick={() => setCursor((c) => ({ ...c, y: c.y - 1 }))} label="이전 연도">
              <ChevronLeft size={18} />
            </IconBtn>
            <span className="text-lg font-semibold" style={{ color: C.ink }}>
              {cursor.y}년
            </span>
            <IconBtn onClick={() => setCursor((c) => ({ ...c, y: c.y + 1 }))} label="다음 연도">
              <ChevronRight size={18} />
            </IconBtn>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 12 }, (_, m) => (
              <button
                key={m}
                onClick={() => {
                  setCursor((c) => ({ ...c, m }));
                  setPicker(false);
                }}
                className="py-2 rounded-xl text-sm"
                style={
                  m === cursor.m
                    ? { background: C.lavenderDeep, color: "#fff" }
                    : { background: C.bg, color: C.ink }
                }
              >
                {m + 1}월
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checklist                                                            */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Category picker (free-form add)                                      */
/* ------------------------------------------------------------------ */
const CATEGORY_PALETTE = [
  "#B7A4DE", "#D9B98C", "#C9A8C4", "#A9B7D9",
  "#CBB89A", "#8868B3", "#E3A9A9", "#A7C9A7",
];

function CategoryPicker({ categories, selectedId, onSelect, onCreate }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_PALETTE[0]);

  const confirm = () => {
    if (!name.trim()) return;
    const cat = { id: uid(), name: name.trim(), color };
    onCreate(cat);
    onSelect(cat.id);
    setName("");
    setColor(CATEGORY_PALETTE[0]);
    setAdding(false);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="text-xs px-3 py-1.5 rounded-full"
            style={
              selectedId === c.id
                ? { background: c.color, color: "#fff" }
                : { background: C.bg, color: C.ink, border: `1px solid ${C.border}` }
            }
          >
            {c.name}
          </button>
        ))}
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1"
          style={{
            background: C.bg,
            color: C.lavenderDeep,
            border: `1px dashed ${C.lavenderDeep}`,
          }}
        >
          <Plus size={12} /> 추가
        </button>
      </div>
      {adding && (
        <div
          className="mt-2 p-3 rounded-xl"
          style={{ background: C.bg, border: `1px solid ${C.border}` }}
        >
          <input
            style={{ ...inputStyle, marginBottom: 8 }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="새 카테고리 이름"
            autoFocus
          />
          <div className="flex gap-2 mb-2">
            {CATEGORY_PALETTE.map((p) => (
              <button
                key={p}
                onClick={() => setColor(p)}
                className="w-6 h-6 rounded-full shrink-0"
                style={{
                  background: p,
                  outline: color === p ? `2px solid ${C.ink}` : "none",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
          <button
            onClick={confirm}
            className="w-full py-2 rounded-lg text-xs font-semibold"
            style={{ background: C.lavenderDeep, color: "#fff" }}
          >
            만들기
          </button>
        </div>
      )}
    </div>
  );
}

function ChecklistScreen({ data, setData }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [showCatManage, setShowCatManage] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const [editItem, setEditItem] = useState(null);
  const [statusPickerItem, setStatusPickerItem] = useState(null);
  const [saveStatus, setSaveStatus] = useState("");
  const manualSave = async () => {
    setSaveStatus("saving");
    await saveData(data);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 1500);
  };
  const [form, setForm] = useState({
    title: "",
    categoryId: data.categories[0].id,
    startDate: todayStr(),
    endDate: todayStr(),
    time: "",
    link: "",
    memo: "",
  });

  const active = data.scheduleItems.filter((i) => !i.completed);
  const done = data.scheduleItems.filter((i) => i.completed);

  const addItem = () => {
    if (!form.title.trim()) return;
    const item = {
      id: uid(),
      title: form.title.trim(),
      categoryId: form.categoryId,
      startDate: form.startDate,
      endDate: form.endDate,
      time: form.time.trim(),
      link: form.link.trim(),
      memo: form.memo.trim(),
      status: "준비중",
      completed: false,
    };
    setData((d) => ({ ...d, scheduleItems: [...d.scheduleItems, item] }));
    setForm({
      title: "",
      categoryId: data.categories[0].id,
      startDate: todayStr(),
      endDate: todayStr(),
      time: "",
      link: "",
      memo: "",
    });
    setShowAdd(false);
  };

  const toggleComplete = (id) => {
    setData((d) => ({
      ...d,
      scheduleItems: d.scheduleItems.map((i) =>
        i.id === id
          ? { ...i, completed: !i.completed, status: !i.completed ? "종료" : "준비중" }
          : i
      ),
    }));
  };

  const setStatus = (id, status) => {
    setData((d) => ({
      ...d,
      scheduleItems: d.scheduleItems.map((i) =>
        i.id === id ? { ...i, status, completed: status === "종료" } : i
      ),
    }));
  };

  const openDetail = (item) => setEditItem({ ...item });

  const saveDetail = () => {
    if (!editItem.title.trim()) return;
    setData((d) => ({
      ...d,
      scheduleItems: d.scheduleItems.map((i) =>
        i.id === editItem.id ? { ...editItem, title: editItem.title.trim() } : i
      ),
    }));
    setEditItem(null);
  };

  const deleteDetail = () => {
    setData((d) => ({
      ...d,
      scheduleItems: d.scheduleItems.filter((i) => i.id !== editItem.id),
    }));
    setEditItem(null);
  };

  const renderRow = (it, cat) => (
    <div className="relative flex items-center justify-between px-4 py-3 gap-2">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          onClick={() => toggleComplete(it.id)}
          className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
          style={{ borderColor: cat.color }}
        >
          {it.completed && <Check size={12} color={cat.color} />}
        </button>
        <button
          onClick={() => openDetail(it)}
          className="flex flex-col items-start text-left min-w-0"
        >
          <span
            className="text-sm truncate"
            style={{
              color: it.completed ? C.inkMuted : C.ink,
              textDecoration: it.completed ? "line-through" : "none",
            }}
          >
            {it.title}
          </span>
          {(it.time || it.link) && (
            <span
              className="flex items-center gap-2 text-[11px] mt-0.5"
              style={{ color: C.inkMuted }}
            >
              {it.time && (
                <span className="flex items-center gap-0.5">
                  <Clock size={10} /> {it.time}
                </span>
              )}
              {it.link && (
                <span className="flex items-center gap-0.5">
                  <LinkIcon size={10} /> 링크
                </span>
              )}
            </span>
          )}
        </button>
      </div>

      <button
        onClick={() => setStatusPickerItem(it)}
        className="shrink-0"
      >
        <StatusBadge status={it.status} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full px-5 pt-2 pb-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold" style={{ color: C.ink }}>
          체크리스트
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={manualSave}
            className="flex items-center gap-1 text-xs px-3 py-2 rounded-full"
            style={{ background: C.beige, color: C.ink }}
          >
            <Save size={13} />
            {saveStatus === "saving" ? "저장 중…" : saveStatus === "saved" ? "저장됨 ✓" : "저장"}
          </button>
          <button
            onClick={() => setShowCatManage(true)}
            className="w-9 h-9 flex items-center justify-center rounded-full"
            style={{ background: C.bg }}
          >
            <Settings size={16} color={C.inkMuted} />
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-sm px-3 py-2 rounded-full"
            style={{ background: C.lavender, color: C.ink }}
          >
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {data.categories.map((cat) => {
        const items = active.filter((i) => i.categoryId === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id} className="mb-5">
            <button
              onClick={() => setEditCategory(cat)}
              className="flex items-center gap-2 mb-2"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: cat.color }}
              />
              <span className="text-sm font-semibold" style={{ color: C.ink }}>
                {cat.name}
              </span>
              <Settings size={11} color={C.inkMuted} />
            </button>
            <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
              {items.map((it, idx) => (
                <div
                  key={it.id}
                  style={idx > 0 ? { borderTop: `1px solid ${C.border}` } : {}}
                >
                  {renderRow(it, cat)}
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {active.length === 0 && (
        <div className="text-sm text-center py-10" style={{ color: C.inkMuted }}>
          아직 등록된 항목이 없어요. + 추가 로 시작해보세요.
        </div>
      )}

      <button
        onClick={() => setShowDone((v) => !v)}
        className="text-sm py-2 mt-2"
        style={{ color: C.lavenderDeep }}
      >
        {showDone ? "완료된 항목 숨기기" : `완료된 항목 보기 (${done.length})`}
      </button>

      {showDone && (
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: C.card }}>
          {done.map((it, idx) => (
            <div
              key={it.id}
              className="flex items-center justify-between px-4 py-3"
              style={idx > 0 ? { borderTop: `1px solid ${C.border}` } : {}}
            >
              <button
                className="flex items-center gap-2 min-w-0"
                onClick={() => toggleComplete(it.id)}
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: C.inkMuted }}
                >
                  <Check size={12} color="#fff" />
                </span>
                <span
                  className="text-sm truncate"
                  style={{ color: C.inkMuted, textDecoration: "line-through" }}
                >
                  {it.title}
                </span>
              </button>
            </div>
          ))}
          {done.length === 0 && (
            <div className="text-sm text-center py-6" style={{ color: C.inkMuted }}>
              완료된 항목이 없어요
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="새 항목">
          <Field label="제목">
            <input
              style={inputStyle}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="예: A기업 서류 제출"
            />
          </Field>
          <Field label="카테고리">
            <CategoryPicker
              categories={data.categories}
              selectedId={form.categoryId}
              onSelect={(id) => setForm((f) => ({ ...f, categoryId: id }))}
              onCreate={(cat) =>
                setData((d) => ({ ...d, categories: [...d.categories, cat] }))
              }
            />
          </Field>
          <div className="flex gap-2">
            <Field label="시작일">
              <input
                type="date"
                style={inputStyle}
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </Field>
            <Field label="마감일">
              <input
                type="date"
                style={inputStyle}
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="시간 (선택)">
            <input
              type="time"
              style={inputStyle}
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
            />
          </Field>
          <Field label="링크 (선택)">
            <input
              style={inputStyle}
              value={form.link}
              onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
              placeholder="https://..."
            />
          </Field>
          <Field label="메모 (선택)">
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
              placeholder="자유롭게 메모하세요"
            />
          </Field>
          <button
            onClick={addItem}
            className="w-full py-3 rounded-xl text-sm font-semibold mt-2"
            style={{ background: C.lavenderDeep, color: "#fff" }}
          >
            추가하기
          </button>
        </Modal>
      )}

      {statusPickerItem && (
        <Modal onClose={() => setStatusPickerItem(null)} title="상태 선택">
          <div className="flex flex-col gap-2">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStatus(statusPickerItem.id, s);
                  setStatusPickerItem(null);
                }}
                className="flex items-center justify-between px-4 py-3 rounded-xl"
                style={{
                  background: s === statusPickerItem.status ? C.bg : "transparent",
                  border: `1px solid ${C.border}`,
                }}
              >
                <span className="text-sm" style={{ color: C.ink }}>
                  {s}
                </span>
                <StatusBadge status={s} />
              </button>
            ))}
          </div>
        </Modal>
      )}

      {editCategory && (
        <Modal onClose={() => setEditCategory(null)} title="카테고리 편집">
          <Field label="이름">
            <input
              style={inputStyle}
              value={
                data.categories.find((c) => c.id === editCategory.id)?.name ?? ""
              }
              onChange={(e) =>
                setData((d) => ({
                  ...d,
                  categories: d.categories.map((cc) =>
                    cc.id === editCategory.id ? { ...cc, name: e.target.value } : cc
                  ),
                }))
              }
            />
          </Field>
          <Field label="색상">
            <div className="flex flex-wrap gap-2">
              {CATEGORY_PALETTE.map((p) => (
                <button
                  key={p}
                  onClick={() =>
                    setData((d) => ({
                      ...d,
                      categories: d.categories.map((cc) =>
                        cc.id === editCategory.id ? { ...cc, color: p } : cc
                      ),
                    }))
                  }
                  className="w-7 h-7 rounded-full shrink-0"
                  style={{
                    background: p,
                    outline:
                      data.categories.find((c) => c.id === editCategory.id)?.color === p
                        ? `2px solid ${C.ink}`
                        : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Field>
          {(() => {
            const count = data.scheduleItems.filter(
              (i) => i.categoryId === editCategory.id
            ).length;
            return (
              <button
                onClick={() => {
                  if (count > 0) return;
                  setData((d) => ({
                    ...d,
                    categories: d.categories.filter((cc) => cc.id !== editCategory.id),
                  }));
                  setEditCategory(null);
                }}
                disabled={count > 0}
                className="w-full py-3 rounded-xl text-sm font-semibold mt-2 flex items-center justify-center gap-1"
                style={{
                  background: C.bg,
                  color: count > 0 ? C.inkMuted : "#B25858",
                  border: `1px solid ${C.border}`,
                  opacity: count > 0 ? 0.6 : 1,
                }}
              >
                <Trash2 size={14} />
                {count > 0 ? `이 카테고리를 쓰는 항목 ${count}개가 있어 삭제 불가` : "카테고리 삭제"}
              </button>
            );
          })()}
          <button
            onClick={() => setEditCategory(null)}
            className="w-full py-3 rounded-xl text-sm font-semibold mt-2"
            style={{ background: C.lavenderDeep, color: "#fff" }}
          >
            완료
          </button>
        </Modal>
      )}

      {editItem && (
        <Modal onClose={() => setEditItem(null)} title="일정 상세">
          <Field label="제목">
            <input
              style={inputStyle}
              value={editItem.title}
              onChange={(e) =>
                setEditItem((f) => ({ ...f, title: e.target.value }))
              }
            />
          </Field>
          <Field label="카테고리">
            <CategoryPicker
              categories={data.categories}
              selectedId={editItem.categoryId}
              onSelect={(id) => setEditItem((f) => ({ ...f, categoryId: id }))}
              onCreate={(cat) =>
                setData((d) => ({ ...d, categories: [...d.categories, cat] }))
              }
            />
          </Field>
          <Field label="상태">
            <div className="flex flex-wrap gap-2">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => setEditItem((f) => ({ ...f, status: s }))}
                  style={
                    editItem.status === s
                      ? { outline: `2px solid ${C.lavenderDeep}`, outlineOffset: 2, borderRadius: 8 }
                      : {}
                  }
                >
                  <StatusBadge status={s} />
                </button>
              ))}
            </div>
          </Field>
          <div className="flex gap-2">
            <Field label="시작일">
              <input
                type="date"
                style={inputStyle}
                value={editItem.startDate}
                onChange={(e) =>
                  setEditItem((f) => ({ ...f, startDate: e.target.value }))
                }
              />
            </Field>
            <Field label="마감일">
              <input
                type="date"
                style={inputStyle}
                value={editItem.endDate}
                onChange={(e) =>
                  setEditItem((f) => ({ ...f, endDate: e.target.value }))
                }
              />
            </Field>
          </div>
          <Field label="시간 (선택)">
            <input
              type="time"
              style={inputStyle}
              value={editItem.time || ""}
              onChange={(e) =>
                setEditItem((f) => ({ ...f, time: e.target.value }))
              }
            />
          </Field>
          <Field label="링크 (선택)">
            <input
              style={inputStyle}
              value={editItem.link || ""}
              onChange={(e) =>
                setEditItem((f) => ({ ...f, link: e.target.value }))
              }
              placeholder="https://..."
            />
          </Field>
          <Field label="메모 (선택)">
            <textarea
              style={{ ...inputStyle, minHeight: 64, resize: "vertical" }}
              value={editItem.memo || ""}
              onChange={(e) =>
                setEditItem((f) => ({ ...f, memo: e.target.value }))
              }
              placeholder="자유롭게 메모하세요"
            />
          </Field>
          <div className="flex gap-2 mt-2">
            <button
              onClick={deleteDetail}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: C.bg, color: "#B25858", border: `1px solid ${C.border}` }}
            >
              삭제
            </button>
            <button
              onClick={saveDetail}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: C.lavenderDeep, color: "#fff" }}
            >
              저장
            </button>
          </div>
        </Modal>
      )}

      {showCatManage && (
        <Modal onClose={() => setShowCatManage(false)} title="카테고리 관리">
          {data.categories.map((c) => {
            const count = data.scheduleItems.filter(
              (i) => i.categoryId === c.id
            ).length;
            return (
              <div key={c.id} className="flex items-center gap-2 mb-3">
                <div className="flex gap-1">
                  {CATEGORY_PALETTE.slice(0, 4).map((p) => (
                    <button
                      key={p}
                      onClick={() =>
                        setData((d) => ({
                          ...d,
                          categories: d.categories.map((cc) =>
                            cc.id === c.id ? { ...cc, color: p } : cc
                          ),
                        }))
                      }
                      className="w-5 h-5 rounded-full shrink-0"
                      style={{
                        background: p,
                        outline: c.color === p ? `2px solid ${C.ink}` : "none",
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                </div>
                <input
                  style={{ ...inputStyle, flex: 1, padding: "6px 10px" }}
                  value={c.name}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      categories: d.categories.map((cc) =>
                        cc.id === c.id ? { ...cc, name: e.target.value } : cc
                      ),
                    }))
                  }
                />
                <button
                  onClick={() => {
                    if (count > 0) return;
                    setData((d) => ({
                      ...d,
                      categories: d.categories.filter((cc) => cc.id !== c.id),
                    }));
                  }}
                  disabled={count > 0}
                  className="w-8 h-8 flex items-center justify-center rounded-full shrink-0"
                  style={{ opacity: count > 0 ? 0.3 : 1 }}
                >
                  <Trash2 size={14} color="#B25858" />
                </button>
              </div>
            );
          })}
          <div className="text-[11px] mb-3" style={{ color: C.inkMuted }}>
            항목이 있는 카테고리는 항목을 먼저 옮기거나 지운 뒤 삭제할 수 있어요.
          </div>
          <CategoryPicker
            categories={[]}
            selectedId={null}
            onSelect={() => {}}
            onCreate={(cat) =>
              setData((d) => ({ ...d, categories: [...d.categories, cat] }))
            }
          />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Habits                                                               */
/* ------------------------------------------------------------------ */
function HabitLogModal({ habit, initialDate, logs, onSave, onDelete, onClose }) {
  const [date, setDate] = useState(initialDate);
  const currentLog = logs.find((l) => l.date === date);
  const [percent, setPercent] = useState(currentLog?.percent ?? 50);
  const [note, setNote] = useState(currentLog?.note ?? "");
  const hasLog = !!logs.find((l) => l.date === date);

  useEffect(() => {
    const l = logs.find((x) => x.date === date);
    setPercent(l?.percent ?? 50);
    setNote(l?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  return (
    <Modal onClose={onClose} title={habit.name}>
      <Field label="날짜">
        <div className="flex items-center gap-2">
          <input
            type="date"
            style={{ ...inputStyle, flex: 1 }}
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
          />
          {hasLog && (
            <button
              onClick={() => onDelete(date)}
              className="text-[11px] px-2 py-2 rounded-lg shrink-0"
              style={{ color: "#B25858", border: `1px solid ${C.border}`, background: C.bg }}
            >
              삭제
            </button>
          )}
        </div>
      </Field>
      <div className="text-center mb-4">
        <div className="text-4xl mb-2">
          {ICON_SETS[habit.iconSet][tierOf(percent)]}
        </div>
        <div className="text-2xl font-bold" style={{ color: habit.color }}>
          {percent}%
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        onChange={(e) => setPercent(Number(e.target.value))}
        className="w-full mb-4"
      />
      <Field label="한줄 메모">
        <input
          style={inputStyle}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="오늘 어땠나요?"
        />
      </Field>
      <button
        onClick={() => onSave(date, percent, note)}
        className="w-full py-3 rounded-xl text-sm font-semibold"
        style={{ background: habit.color, color: "#fff" }}
      >
        저장
      </button>
    </Modal>
  );
}

function blockDays(habit, range) {
  const anchor = habit.anchorDate || habit.startDate || todayStr();
  return Array.from({ length: range }, (_, i) => addDays(anchor, i));
}

function HabitCard({ habit, logs, onLog, onSetAnchor, onDelete }) {
  const [range, setRange] = useState(30);
  const days = blockDays(habit, range);
  const cols = range === 7 ? 7 : range === 15 ? 5 : range === 30 ? 5 : 10;
  const anchor = habit.anchorDate || habit.startDate || todayStr();

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: C.card }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: habit.color }} />
          <span className="text-sm font-semibold truncate" style={{ color: C.ink }}>
            {habit.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {[7, 15, 30, 180].map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className="text-[11px] px-2 py-1 rounded-full"
              style={
                range === r
                  ? { background: habit.color, color: "#fff" }
                  : { background: C.bg, color: C.inkMuted }
              }
            >
              {r === 180 ? "6개월" : `${r}일`}
            </button>
          ))}
          <button
            onClick={() => onDelete(habit)}
            className="w-6 h-6 flex items-center justify-center rounded-full shrink-0"
          >
            <Trash2 size={13} color={C.inkMuted} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px]" style={{ color: C.inkMuted }}>
          기준일
        </span>
        <input
          type="date"
          value={anchor}
          onChange={(e) => onSetAnchor(habit.id, e.target.value)}
          className="text-[11px] px-2 py-1 rounded-lg"
          style={{ background: C.bg, color: C.ink, border: `1px solid ${C.border}` }}
        />
      </div>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
      >
        {days.map((d) => {
          const log = logs.find((l) => l.date === d);
          const tier = tierOf(log?.percent);
          const sat = tier === -1 ? 0.12 : 0.35 + tier * 0.22;
          const isFuture = d > todayStr();
          return (
            <button
              key={d}
              disabled={isFuture}
              onClick={() => onLog(habit, d)}
              className="aspect-square rounded-md flex items-center justify-center text-[10px]"
              style={{
                background: tier === -1 ? C.bg : hexAlpha(habit.color, sat),
                opacity: isFuture ? 0.4 : 1,
              }}
              title={d}
            >
              {!isFuture && tier !== -1 && range <= 30 && (
                <span style={{ fontSize: range === 7 ? 16 : 11 }}>
                  {ICON_SETS[habit.iconSet][tier]}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function hexAlpha(hex, alpha) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function HabitsScreen({ data, setData }) {
  const [showAdd, setShowAdd] = useState(false);
  const [logTarget, setLogTarget] = useState(null); // {habit, date, log}
  const [saveStatus, setSaveStatus] = useState("");
  const manualSave = async () => {
    setSaveStatus("saving");
    await saveData(data);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus(""), 1500);
  };
  const [form, setForm] = useState({
    name: "",
    color: "#B7A4DE",
    iconSet: "얼굴",
    goal: "",
  });

  const palette = ["#B7A4DE", "#D9B98C", "#C9A8C4", "#A9B7D9", "#CBB89A", "#8868B3"];

  const addHabit = () => {
    if (!form.name.trim()) return;
    const habit = {
      id: uid(),
      name: form.name.trim(),
      color: form.color,
      iconSet: form.iconSet,
      goal: form.goal.trim(),
      startDate: todayStr(),
      anchorDate: todayStr(),
    };
    setData((d) => ({ ...d, habits: [...d.habits, habit] }));
    setForm({ name: "", color: "#B7A4DE", iconSet: "얼굴", goal: "" });
    setShowAdd(false);
  };

  const saveLog = (habitId, date, percent, note) => {
    setData((d) => {
      const existing = d.habitLogs.find(
        (l) => l.habitId === habitId && l.date === date
      );
      if (existing) {
        return {
          ...d,
          habitLogs: d.habitLogs.map((l) =>
            l === existing ? { ...l, percent, note } : l
          ),
        };
      }
      return {
        ...d,
        habitLogs: [...d.habitLogs, { id: uid(), habitId, date, percent, note }],
      };
    });
    setLogTarget(null);
  };

  const deleteLog = (habitId, date) => {
    setData((d) => ({
      ...d,
      habitLogs: d.habitLogs.filter(
        (l) => !(l.habitId === habitId && l.date === date)
      ),
    }));
    setLogTarget(null);
  };

  const setAnchor = (habitId, date) => {
    setData((d) => ({
      ...d,
      habits: d.habits.map((h) =>
        h.id === habitId ? { ...h, anchorDate: date } : h
      ),
    }));
  };

  const [deleteTarget, setDeleteTarget] = useState(null);
  const deleteHabit = (habitId) => {
    setData((d) => ({
      ...d,
      habits: d.habits.filter((h) => h.id !== habitId),
      habitLogs: d.habitLogs.filter((l) => l.habitId !== habitId),
    }));
    setDeleteTarget(null);
  };

  return (
    <div className="flex flex-col h-full px-5 pt-2 pb-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold" style={{ color: C.ink }}>
          습관
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={manualSave}
            className="flex items-center gap-1 text-xs px-3 py-2 rounded-full"
            style={{ background: C.beige, color: C.ink }}
          >
            <Save size={13} />
            {saveStatus === "saving" ? "저장 중…" : saveStatus === "saved" ? "저장됨 ✓" : "저장"}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-sm px-3 py-2 rounded-full"
            style={{ background: C.lavender, color: C.ink }}
          >
            <Plus size={16} /> 추가
          </button>
        </div>
      </div>

      {data.habits.length === 0 && (
        <div className="text-sm text-center py-10" style={{ color: C.inkMuted }}>
          아직 등록된 습관이 없어요. + 추가 로 시작해보세요.
        </div>
      )}

      {data.habits.map((h) => (
        <HabitCard
          key={h.id}
          habit={h}
          logs={data.habitLogs.filter((l) => l.habitId === h.id)}
          onLog={(habit, date) => setLogTarget({ habit, date })}
          onSetAnchor={setAnchor}
          onDelete={setDeleteTarget}
        />
      ))}

      {logTarget && (
        <HabitLogModal
          habit={logTarget.habit}
          initialDate={logTarget.date}
          logs={data.habitLogs.filter((l) => l.habitId === logTarget.habit.id)}
          onClose={() => setLogTarget(null)}
          onSave={(date, percent, note) =>
            saveLog(logTarget.habit.id, date, percent, note)
          }
          onDelete={(date) => deleteLog(logTarget.habit.id, date)}
        />
      )}

      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)} title="습관 삭제">
          <div className="text-sm mb-4" style={{ color: C.ink }}>
            "{deleteTarget.name}" 습관을 삭제할까요? 지금까지 기록한 내용도 함께 사라져요.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteTarget(null)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: C.bg, color: C.ink, border: `1px solid ${C.border}` }}
            >
              취소
            </button>
            <button
              onClick={() => deleteHabit(deleteTarget.id)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: "#B25858", color: "#fff" }}
            >
              삭제
            </button>
          </div>
        </Modal>
      )}

      {showAdd && (
        <Modal onClose={() => setShowAdd(false)} title="새 습관">
          <Field label="습관 이름">
            <input
              style={inputStyle}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="예: 매일 10분 독서"
            />
          </Field>
          <Field label="목표 (선택)">
            <input
              style={inputStyle}
              value={form.goal}
              onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              placeholder="예: 하루 10분"
            />
          </Field>
          <Field label="색상">
            <div className="flex gap-2">
              {palette.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm((f) => ({ ...f, color: c }))}
                  className="w-8 h-8 rounded-full"
                  style={{
                    background: c,
                    outline: form.color === c ? `2px solid ${C.ink}` : "none",
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </Field>
          <Field label="아이콘 스타일">
            <div className="flex gap-2">
              {Object.keys(ICON_SETS).map((k) => (
                <button
                  key={k}
                  onClick={() => setForm((f) => ({ ...f, iconSet: k }))}
                  className="text-xs px-3 py-1.5 rounded-full flex items-center gap-1"
                  style={
                    form.iconSet === k
                      ? { background: form.color, color: "#fff" }
                      : { background: C.bg, color: C.ink, border: `1px solid ${C.border}` }
                  }
                >
                  {ICON_SETS[k][3]} {k}
                </button>
              ))}
            </div>
          </Field>
          <button
            onClick={addHabit}
            className="w-full py-3 rounded-xl text-sm font-semibold mt-2"
            style={{ background: C.lavenderDeep, color: "#fff" }}
          >
            추가하기
          </button>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Assistant (chat)                                                     */
/* ------------------------------------------------------------------ */
const SUGGESTIONS = [
  "오늘 무슨 일을 해야 하나요?",
  "오늘의 습관을 기록하시겠어요?",
  "내일까지 할 일이 있나요?",
];

function buildSystemPrompt(data) {
  return `너는 "My.비서"라는 일정관리 앱의 비서 챗봇이야. 대화 전체 맥락(이전 메시지 포함)을 참고해서, 아래 JSON 스키마로만 응답해. 다른 텍스트, 설명, 코드펜스 없이 순수 JSON 객체 하나만 출력해.

스키마:
{
  "reply": "사용자에게 보여줄 다정하고 간결한 한국어 답변 (1~2문장)",
  "actions": [ ...아래 타입 중 0개 이상... ],
  "askDateChoice": "습관 기록 날짜를 되물을 때만 true, 그 외에는 항상 false"
}

action 타입:
1) {"type":"add_schedule","title":"...","categoryId":"아래 카테고리 목록의 id 중 하나","startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}
2) {"type":"update_status","titleMatch":"기존 항목 제목에 포함된 텍스트","status":"준비중|곧 시작|임박|종료"}
3) {"type":"complete_schedule","titleMatch":"기존 항목 제목에 포함된 텍스트"}
4) {"type":"log_habit","habitNameMatch":"습관 이름(없으면 새로 만들 이름)","percent":0-100,"note":"짧은 메모","date":"YYYY-MM-DD (선택, 없으면 오늘 날짜로 기록)"}
5) {"type":"add_habit","name":"...","goal":"예: 하루 10분 (선택, 없으면 빈 문자열)"}

습관 규칙:
- "현재 습관 목록"에 없는 습관을 사용자가 언급하면서 하는 중/기록하고 싶다고 하면, 먼저 add_habit으로 그 습관을 새로 만들고, 같은 응답의 actions 배열에 이어서 log_habit도 함께 넣어(habitNameMatch는 add_habit에서 쓴 name과 동일하게). 단순히 "습관을 시작하고 싶다/만들고 싶다"고만 하고 아직 실행 기록이 없으면 add_habit만 넣어.
- 습관 기록 요청(예: "오늘 8분 독서했어", "요가 30분 했어", "오늘 운동 다녀왔어")은 목표 대비 퍼센트를 계산해서 반드시 log_habit 액션을 만들어. 목표를 모르거나 정확한 계산이 어려우면 정확도보다 "반드시 액션을 만드는 것"이 우선이야 — percent를 상식적으로 추정해서(예: "다 했어"=90~100, "조금 했어"=20~40, 구체적 시간이 있으면 목표 대비 비율로) 절대 actions를 비우지 마.
- 습관 이름/목표에 대해서는 위 되묻기(clarification) 규칙을 적용하지 마 — 습관 이름이 짧거나 구체적이지 않아도 되묻지 말고 사용자가 말한 그대로 이름으로 사용해서 바로 add_habit/log_habit을 실행해. (단, 날짜에 대해서는 아래 "습관 기록 날짜 확인 규칙"을 따로 적용해.)
- 예시) 사용자: "오늘부터 매일 스트레칭하기로 했고, 방금 5분 했어" → {"reply":"스트레칭 습관 시작했어요! 오늘 몫도 기록했어요.","actions":[{"type":"add_habit","name":"스트레칭","goal":""},{"type":"log_habit","habitNameMatch":"스트레칭","percent":70,"note":"5분"}],"askDateChoice":false}

습관 기록 날짜 확인 규칙:
- 습관을 "기록"하는 메시지에 오늘/어제/그제/특정 날짜(예: "9/1에", "지난주 화요일") 같은 날짜 표현이 전혀 없으면, log_habit을 바로 실행하지 말고 reply에서 "언제 하셨나요?"처럼 되묻고, actions는 빈 배열로 두고 askDateChoice를 true로 설정해.
- 날짜 표현이 이미 있으면(예: "오늘 독서했어", "어제 8분 했어") 그 날짜를 YYYY-MM-DD로 변환해 log_habit의 date 필드에 넣어 바로 실행하고, askDateChoice는 false로 둬.
- 직전 네 reply가 습관 기록 날짜를 되물은 것이었고, 이번 사용자 메시지가 그 답(예: "오늘", "어제", 버튼으로 직접 고른 YYYY-MM-DD)이라면: 그 이전 사용자 메시지에서 언급된 습관 내용을 참고해서, 이번에 확인된 날짜를 date 필드에 넣어 log_habit을 실행해(다시 되묻지 마).
- add_habit만 필요한 경우(아직 실행 기록 없이 습관만 새로 만드는 경우)나 습관과 무관한 모든 응답에서는 항상 askDateChoice를 false로 둬.

날짜 규칙:
- 오늘 날짜: ${todayStr()}
- "내일"=오늘+1일, "모레"=오늘+2일, "글피"=오늘+3일, "어제"=오늘-1일, "그제"/"그저께"=오늘-2일. 요일 표현("이번 주 금요일" 등)은 가장 가까운 미래의 그 요일로 계산.
- "~까지"는 endDate로 사용하고 startDate는 오늘 날짜로 둬.
- 사용자가 "9/1~9/14", "9.1-9.14", "9월 1일~9월 14일"처럼 시작~끝 날짜를 직접 명시하면 그대로 startDate/endDate로 변환해. 연도가 안 적혀 있으면 오늘(${todayStr()}) 기준 올해를 쓰고, 그 날짜가 이미 지난 날짜면 내년으로 넘겨. 날짜가 하루만 적혀 있으면 startDate와 endDate를 같은 날로 둬.
- 모든 날짜는 정확한 YYYY-MM-DD로 변환해서 사용해.

카테고리 자동 분류 규칙:
- 특정 단어를 그 카테고리에 무조건 연결하는 고정 규칙은 없어. 대신 "사용 가능한 카테고리 목록"에 있는 각 카테고리 이름이 어떤 뜻인지 네가 스스로 해석해서, 사용자가 말한 내용의 성격과 가장 잘 맞는 카테고리를 골라.
  예를 들어 카테고리 이름이 "취업준비"나 "구직"처럼 취업/구직을 뜻하면, 채용·지원·접수·면접·서류처럼 그 의미 범위에 속하는 내용을 그 카테고리로 분류해. 카테고리 이름이 다르게 지어져 있거나(예: "잡헌팅", "커리어") 사용자가 새로 만든 이름이어도 마찬가지로 그 이름의 뜻을 먼저 판단한 뒤 적용해 — 이름 자체가 바뀌면 분류 결과도 그에 맞게 달라져야 해.
- "현재 체크리스트 항목"에 있는 기존 항목들이 실제로 어느 categoryId에 들어있는지도 참고 자료로 활용해. 지금 사용자가 말한 내용과 성격이 비슷한 기존 항목이 이미 있다면, 그 항목과 같은 카테고리를 우선으로 선택해.
- 사용자가 카테고리 이름을 메시지에서 직접 언급했으면 그 카테고리를 우선 사용해.
- 그래도 애매하면 내용상 가장 비슷한 카테고리를 고르고, 정말 판단이 안 서면 가장 범용적인 카테고리(예: "todo 리스트" 성격의 카테고리)를 사용해.
- 특히 "회사이름 + 채용/접수/제출"처럼 회사명과 채용 관련 동작이 함께 나오는 문장(예: "네이버 채용 접수", "카카오 서류 제출", "삼성 신입공채")은, 취업/구직을 뜻하는 카테고리(예: "취업준비", "구직")가 목록에 있다면 반드시 그 카테고리의 id를 categoryId로 써야 해 — "todo 리스트" 같은 범용 카테고리로 흘려보내지 마.

일정 제목 추출 규칙:
- 사용자 메시지가 "카테고리 이름 + 날짜 범위 + 나머지 설명"을 한 번에 담고 있으면(예: "취업준비에 A 그룹 9/1~9/14 신입채용 추가해줘", "A 그룹 9/1~9/14 신입채용"), 메시지에서 카테고리 이름과 날짜 표현을 뺀 나머지를 title로 사용해(예: "A 그룹 신입채용"). 이런 메시지는 이미 구체적인 것으로 보고 되묻지 마.

되묻기(clarification) 규칙:
- 사용자가 말한 일정 제목이 구체적이지 않으면(예: 그냥 "과제", "시험", "일정"처럼 무엇인지 특정되지 않음) 바로 add_schedule을 만들지 말고, reply에서 "어떤 과제인가요?" 처럼 되물어보고 actions는 빈 배열로 둬.
- 직전 네 메시지가 무엇인지 되물었고 이번 사용자 메시지가 그 답이라면: 사용자가 구체적인 이름을 말했으면 그 이름으로 title을 만들고("확률과통계 과제"), 사용자가 "그냥 과제야"/"몰라"처럼 구체적인 이름 없이 답했다면 title을 "과제"로 만들어.
- 이미 구체적인 이름이 처음부터 포함되어 있으면(예: "A기업 서류", "A 그룹 신입채용") 되묻지 말고 바로 add_schedule을 만들어.

예시) 카테고리 목록에 "job: 취업준비"가 있을 때, 사용자: "A 그룹 9/1~9/14 신입채용" → "신입채용"은 취업준비의 의미 범위에 속하므로 → {"reply":"취업준비에 A 그룹 신입채용 일정을 9/1~9/14로 등록했어요.","actions":[{"type":"add_schedule","title":"A 그룹 신입채용","categoryId":"job","startDate":"2026-09-01","endDate":"2026-09-14"}],"askDateChoice":false} (카테고리 이름이 "구직"이나 "커리어"였어도 같은 방식으로 판단했을 거야 — "job"이라는 id가 아니라 "취업준비"라는 이름의 뜻으로 판단한 것.)

예시) 사용자: "듀오링고 했어" (날짜 표현 없음) → {"reply":"언제 하셨나요?","actions":[],"askDateChoice":true} → 사용자: "어제" → {"reply":"어제 듀오링고 기록했어요.","actions":[{"type":"log_habit","habitNameMatch":"듀오링고","percent":100,"note":"","date":"${addDays(todayStr(), -1)}"}],"askDateChoice":false}

기타 규칙:
- 사용 가능한 카테고리 목록(id: 이름): ${data.categories.map((c) => `${c.id}: ${c.name}`).join(", ")}
- 현재 체크리스트 항목(제목/카테고리id/상태/마감일 — 기존 항목이 실제로 어느 카테고리에 들어있는지 분류 참고용): ${JSON.stringify(data.scheduleItems.map((i) => ({ title: i.title, categoryId: i.categoryId, status: i.status, endDate: i.endDate })))}
- 현재 습관 목록: ${JSON.stringify(data.habits.map((h) => ({ name: h.name, goal: h.goal })))}
- 새 일정을 만들 근거가 없으면 add_schedule을 만들지 마.
- add_schedule로 만든 일정은 체크리스트와 캘린더 양쪽에 자동으로 반영되니 따로 안내할 필요 없어.
- 각 action 객체에는 위 action 타입에 정의된 필드만 넣고, 그 타입에 정의되지 않은 필드(예: add_schedule에 titleMatch를 넣는 것처럼)는 절대 추가하지 마. 반드시 완결된 순수 JSON만 출력해 — 중간에 잘리거나 깨진 형태로 끝내지 마.`;
}

const HABIT_AUTO_COLORS = [
  "#B7A4DE", "#D9B98C", "#C9A8C4", "#A9B7D9", "#CBB89A", "#8868B3",
];

function makeAutoHabit(name, goal, existingCount) {
  return {
    id: uid(),
    name,
    color: HABIT_AUTO_COLORS[existingCount % HABIT_AUTO_COLORS.length],
    iconSet: "얼굴",
    goal: goal || "",
    startDate: todayStr(),
    anchorDate: todayStr(),
  };
}

// The model's categoryId is never trusted at face value: it only counts
// when it's an exact match against a real category id (i.e. the user
// named the category directly and the model echoed its real id back).
// Anything else — empty, a made-up id, a category name instead of an
// id — is treated as "unresolved" and left for the user to pick from
// buttons in the chat UI instead of guessing.
function categoryExactMatch(categories, rawCategoryId) {
  return categories.some((c) => c.id === rawCategoryId);
}

// "9/1", "9.1", "9월 1일" 같은 표현에서 월/일을 뽑아 올해 기준 YYYY-MM-DD로
// 바꾼다. 모델이 startDate를 비워서 줬을 때, 비서의 reply 문장에서 날짜를
// 복구하기 위한 최후 수단.
function extractDatesFromReply(replyText) {
  if (!replyText) return [];
  const re = /(\d{1,2})\s*[.\/월]\s*(\d{1,2})\s*일?/g;
  const matches = [...replyText.matchAll(re)];
  const year = todayStr().slice(0, 4);
  return matches.map(
    (m) => `${year}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`
  );
}

function buildScheduleCandidate(a, replyText) {
  const title = (a.title || "").trim();
  let startDate = a.startDate;
  let endDate = a.endDate;
  if (!startDate) {
    const extracted = extractDatesFromReply(replyText);
    startDate = extracted[0] || todayStr();
    endDate = a.endDate || extracted[1] || extracted[0] || todayStr();
  } else {
    endDate = endDate || startDate;
  }
  return { title, startDate, endDate };
}

function isDuplicateSchedule(scheduleItems, { title, categoryId, startDate, endDate }) {
  return scheduleItems.some(
    (it) =>
      it.title === title &&
      it.categoryId === categoryId &&
      it.startDate === startDate &&
      it.endDate === endDate
  );
}

// add_schedule action들 중 categoryId가 실제 카테고리와 정확히 일치하지
// 않는 것들을 모아서, AI를 다시 거치지 않고 채팅 버튼으로 바로 처리할 수
// 있게 한다 (AssistantScreen이 이 목록을 메시지에 붙여 렌더링한다).
function derivePendingSchedules(actions, categories, replyText) {
  if (!Array.isArray(actions)) return [];
  const pending = [];
  for (const a of actions) {
    if (a.type !== "add_schedule") continue;
    if (categoryExactMatch(categories, a.categoryId)) continue;
    const candidate = buildScheduleCandidate(a, replyText);
    if (!candidate.title) continue;
    pending.push({ id: uid(), ...candidate });
  }
  return pending;
}

function applyActions(actions, setData, replyText) {
  if (!Array.isArray(actions)) return;
  setData((d) => {
    let next = {
      ...d,
      scheduleItems: [...d.scheduleItems],
      habitLogs: [...d.habitLogs],
      habits: [...d.habits],
    };
    for (const a of actions) {
      if (a.type === "add_schedule") {
        // categoryId가 정확히 일치하지 않으면 여기서 바로 저장하지 않는다
        // — derivePendingSchedules가 이미 같은 action을 pending으로 잡아
        // 채팅 버튼으로 넘겼으므로, 사용자가 카테고리를 고른 뒤 커밋된다.
        if (!categoryExactMatch(next.categories, a.categoryId)) continue;
        const candidate = buildScheduleCandidate(a, replyText);
        if (!candidate.title) continue;
        const item = { ...candidate, categoryId: a.categoryId };
        if (isDuplicateSchedule(next.scheduleItems, item)) continue;
        next.scheduleItems.push({
          id: uid(),
          ...item,
          status: "준비중",
          completed: false,
        });
      } else if (a.type === "update_status") {
        next.scheduleItems = next.scheduleItems.map((it) =>
          it.title.includes(a.titleMatch)
            ? { ...it, status: a.status, completed: a.status === "종료" }
            : it
        );
      } else if (a.type === "complete_schedule") {
        next.scheduleItems = next.scheduleItems.map((it) =>
          it.title.includes(a.titleMatch)
            ? { ...it, status: "종료", completed: true }
            : it
        );
      } else if (a.type === "add_habit") {
        const name = (a.name || "").trim();
        if (!name) continue;
        const exists = next.habits.find((h) => h.name === name);
        if (!exists) {
          next.habits.push(makeAutoHabit(name, a.goal, next.habits.length));
        }
      } else if (a.type === "log_habit") {
        const nameMatch = (a.habitNameMatch || "").trim();
        if (!nameMatch) continue;
        let habit = next.habits.find((h) => h.name.includes(nameMatch));
        if (!habit) {
          habit = makeAutoHabit(nameMatch, "", next.habits.length);
          next.habits.push(habit);
        }
        const percent = Math.max(
          0,
          Math.min(100, Number.isFinite(Number(a.percent)) ? Number(a.percent) : 50)
        );
        const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date || "") ? a.date : todayStr();
        const existing = next.habitLogs.find(
          (l) => l.habitId === habit.id && l.date === date
        );
        if (existing) {
          next.habitLogs = next.habitLogs.map((l) =>
            l === existing ? { ...l, percent, note: a.note || "" } : l
          );
        } else {
          next.habitLogs.push({
            id: uid(),
            habitId: habit.id,
            date,
            percent,
            note: a.note || "",
          });
        }
      }
    }
    return next;
  });
}

function AssistantScreen({ data, setData, messages, setMessages }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showCustomDate, setShowCustomDate] = useState(false);
  const [customDate, setCustomDate] = useState(todayStr());
  const bottomRef = useRef(null);
  const lastMsg = messages[messages.length - 1];
  const showDateChoice = !busy && lastMsg?.role === "assistant" && lastMsg?.askDateChoice;
  const pendingSchedules = !busy && lastMsg?.role === "assistant" ? lastMsg?.pendingSchedules || [] : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text) => {
    const t = text.trim();
    if (!t || busy) return;
    const userMsg = { id: uid(), role: "user", text: t };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setShowCustomDate(false);
    setBusy(true);
    try {
      const apiMessages = nextMessages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.text,
      }));
      const json = await sendChat(buildSystemPrompt(data), apiMessages);
      const raw = (json.content || [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      const cleaned = raw.replace(/```json|```/g, "").trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      let parsed;
      try {
        parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
        if (!Array.isArray(parsed.actions)) parsed.actions = [];
        if (typeof parsed.reply !== "string" || !parsed.reply.trim()) {
          parsed.reply = "확인했어요.";
        }
        parsed.askDateChoice = parsed.askDateChoice === true;
      } catch (parseErr) {
        // Never show the raw model output to the user — it can be
        // truncated/broken JSON. Log it for debugging only; the server
        // already guards against this too, so this is a last-resort fallback.
        console.error("mybiseo assistant JSON parse error", parseErr, raw);
        parsed = {
          reply: "죄송해요, 응답을 처리하는 중에 문제가 있었어요. 다시 한 번 말씀해주실래요?",
          actions: [],
          askDateChoice: false,
        };
      }
      const newPendingSchedules = derivePendingSchedules(parsed.actions, data.categories, parsed.reply);
      applyActions(parsed.actions, setData, parsed.reply);
      // 카테고리를 확정 못 한 일정이 있으면, 모델이 이미 "등록했어요" 같은
      // 문구를 reply에 넣었더라도 그대로 보여주지 않는다 — 실제로는 아직
      // 저장되지 않았으므로, 대신 카테고리를 되묻는 문구로 교체한다.
      const displayReply =
        newPendingSchedules.length > 0
          ? newPendingSchedules.map((p) => `${p.title}은 어떤 카테고리에 저장할까요?`).join("\n")
          : parsed.reply;
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "assistant",
          text: displayReply,
          askDateChoice: parsed.askDateChoice,
          pendingSchedules: newPendingSchedules,
        },
      ]);
    } catch (e) {
      console.error("mybiseo assistant request error", e);
      const detail = e?.message ? ` (${e.message})` : "";
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: `연결에 문제가 있었어요${detail}. 잠시 후 다시 시도해주세요.` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  // 사용자가 카테고리 버튼을 눌렀을 때 — AI를 다시 거치지 않고, 그 자리에서
  // 바로 일정으로 커밋한다. askDateChoice의 오늘/어제 버튼과 달리 이건
  // send()를 부르지 않는다: 카테고리 선택은 이미 로컬에 있는 정보만으로
  // 결정할 수 있는 일이라 AI에게 다시 물을 이유가 없다.
  const commitScheduleCategory = (pending, categoryId) => {
    setData((d) => {
      const item = {
        title: pending.title,
        categoryId,
        startDate: pending.startDate,
        endDate: pending.endDate,
      };
      if (isDuplicateSchedule(d.scheduleItems, item)) return d;
      return {
        ...d,
        scheduleItems: [
          ...d.scheduleItems,
          { id: uid(), ...item, status: "준비중", completed: false },
        ],
      };
    });
    const category = data.categories.find((c) => c.id === categoryId);
    setMessages((m) => {
      const withoutResolved = m.map((msg) =>
        msg.id === lastMsg?.id
          ? { ...msg, pendingSchedules: (msg.pendingSchedules || []).filter((p) => p.id !== pending.id) }
          : msg
      );
      return [
        ...withoutResolved,
        {
          id: uid(),
          role: "assistant",
          text: `"${pending.title}"을(를) ${category?.name || "선택한 카테고리"}에 저장했어요.`,
        },
      ];
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-2 pb-3 flex items-center justify-between">
        <h2 className="text-xl font-bold" style={{ color: C.ink }}>
          비서
        </h2>
        {messages.length > 0 && (
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full"
            style={{ background: C.bg, color: C.inkMuted, border: `1px solid ${C.border}` }}
          >
            <Trash2 size={12} /> 대화 초기화
          </button>
        )}
      </div>

      {showResetConfirm && (
        <Modal onClose={() => setShowResetConfirm(false)} title="대화 초기화">
          <div className="text-sm mb-4" style={{ color: C.ink }}>
            지금까지 비서와 나눈 대화 내용을 모두 지울까요? 이미 반영된 일정/습관 데이터는 그대로 남아요.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowResetConfirm(false)}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: C.bg, color: C.ink, border: `1px solid ${C.border}` }}
            >
              취소
            </button>
            <button
              onClick={() => {
                setMessages([]);
                setShowResetConfirm(false);
              }}
              className="flex-1 py-3 rounded-xl text-sm font-semibold"
              style={{ background: "#B25858", color: "#fff" }}
            >
              초기화
            </button>
          </div>
        </Modal>
      )}

      <div className="flex-1 overflow-y-auto px-5 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-2 rounded-2xl"
                style={{ background: C.lavender, color: C.ink }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[75%] text-sm px-4 py-2.5 rounded-2xl"
              style={
                m.role === "user"
                  ? { background: C.lavenderDeep, color: "#fff", borderBottomRightRadius: 4 }
                  : { background: C.card, color: C.ink, borderBottomLeftRadius: 4 }
              }
            >
              {m.text}
            </div>
          </div>
        ))}
        {showDateChoice && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => send("오늘")}
                className="text-xs px-3 py-2 rounded-2xl"
                style={{ background: C.lavender, color: C.ink }}
              >
                오늘
              </button>
              <button
                onClick={() => send("어제")}
                className="text-xs px-3 py-2 rounded-2xl"
                style={{ background: C.lavender, color: C.ink }}
              >
                어제
              </button>
              <button
                onClick={() => setShowCustomDate((v) => !v)}
                className="text-xs px-3 py-2 rounded-2xl"
                style={{ background: C.lavender, color: C.ink }}
              >
                날짜 직접 선택
              </button>
            </div>
            {showCustomDate && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customDate}
                  max={todayStr()}
                  onChange={(e) => setCustomDate(e.target.value)}
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button
                  onClick={() => send(customDate)}
                  className="text-xs px-3 py-2 rounded-xl shrink-0 font-semibold"
                  style={{ background: C.lavenderDeep, color: "#fff" }}
                >
                  확인
                </button>
              </div>
            )}
          </div>
        )}
        {pendingSchedules.map((p) => (
          <div key={p.id} className="flex flex-wrap gap-2">
            {data.categories.map((c) => (
              <button
                key={c.id}
                onClick={() => commitScheduleCategory(p, c.id)}
                className="text-xs px-3 py-2 rounded-2xl flex items-center gap-1.5"
                style={{ background: C.card, color: C.ink, border: `1px solid ${C.border}` }}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: c.color }}
                />
                {c.name}
              </button>
            ))}
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div
              className="text-sm px-4 py-2.5 rounded-2xl"
              style={{ background: C.card, color: C.inkMuted }}
            >
              생각 중…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${C.border}` }}>
        <input
          style={{ ...inputStyle, flex: 1, opacity: busy ? 0.6 : 1 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="무엇을 도와드릴까요?"
          disabled={busy}
        />
        <button
          onClick={() => send(input)}
          disabled={busy}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
          style={{ background: C.lavenderDeep, opacity: busy ? 0.6 : 1 }}
        >
          <Send size={16} color="#fff" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom nav + App shell                                               */
/* ------------------------------------------------------------------ */
function BottomNav({ screen, setScreen }) {
  const items = [
    { key: "home", icon: Home, label: "홈" },
    { key: "calendar", icon: CalIcon, label: "캘린더" },
    { key: "assistant", icon: MessageCircle, label: "비서" },
    { key: "habits", icon: Sparkles, label: "습관" },
    { key: "checklist", icon: CheckSquare, label: "체크리스트" },
  ];
  return (
    <div
      className="flex items-end justify-around py-4"
      style={{ borderTop: `1px solid ${C.border}`, background: C.card }}
    >
      {items.map((it) => {
        const activeItem = screen === it.key;
        if (it.key === "assistant") {
          return (
            <button
              key={it.key}
              onClick={() => setScreen(it.key)}
              className="flex flex-col items-center gap-0.5 px-2 -mt-7"
            >
              <span
                className="w-16 h-16 rounded-full flex items-center justify-center shadow-md"
                style={{ background: activeItem ? C.lavenderDeep : C.lavender }}
              >
                <it.icon size={30} color={activeItem ? "#fff" : C.lavenderDeep} />
              </span>
              <span
                className="text-[12px] mt-0.5"
                style={{ color: activeItem ? C.lavenderDeep : C.inkMuted }}
              >
                {it.label}
              </span>
            </button>
          );
        }
        return (
          <button
            key={it.key}
            onClick={() => setScreen(it.key)}
            className="flex flex-col items-center gap-0.5 px-2 py-1"
          >
            <it.icon
              size={30}
              color={activeItem ? C.lavenderDeep : C.inkMuted}
              fill={activeItem && it.key === "home" ? C.lavenderDeep : "none"}
            />
            <span
              className="text-[12px]"
              style={{ color: activeItem ? C.lavenderDeep : C.inkMuted }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auth (username + 4-digit PIN)                                       */
/* ------------------------------------------------------------------ */
function AuthScreen({ notice, onAuthed }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    if (!username.trim()) {
      setError("사용자 이름을 입력해주세요.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("4자리 숫자를 입력해주세요.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await login(username.trim(), pin);
      } else {
        await register(username.trim(), pin);
      }
      onAuthed();
    } catch (e) {
      setError(e.message || "문제가 발생했어요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full items-center justify-center px-8">
      <h1 className="text-3xl font-bold mb-1 tracking-tight" style={{ color: C.ink }}>
        My.B<span style={{ color: C.lavenderDeep }}>l</span>S
        <span style={{ color: C.lavenderDeep }}>ㅓ</span>
      </h1>
      <div className="text-sm mb-8" style={{ color: C.inkMuted }}>
        {mode === "login" ? "로그인하고 이어서 사용해요" : "사용자 이름 + 4자리 숫자로 계정을 만들어요"}
      </div>

      {notice && (
        <div
          className="w-full max-w-xs text-[12px] mb-4 px-3 py-2 rounded-xl"
          style={{ background: "#F6E4E4", color: "#7A2E2E" }}
        >
          {notice}
        </div>
      )}

      <div className="w-full max-w-xs">
        <Field label="사용자 이름">
          <input
            style={inputStyle}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="닉네임"
            maxLength={20}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
        <Field label="4자리 숫자">
          <input
            style={inputStyle}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="0000"
            inputMode="numeric"
            type="password"
            maxLength={4}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </Field>
        {error && (
          <div className="text-[12px] mb-3" style={{ color: "#B25858" }}>
            {error}
          </div>
        )}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-3 rounded-xl text-sm font-semibold"
          style={{ background: C.lavenderDeep, color: "#fff", opacity: busy ? 0.7 : 1 }}
        >
          {busy ? "처리 중…" : mode === "login" ? "로그인" : "회원가입"}
        </button>
        <button
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setError("");
          }}
          className="w-full py-3 text-xs mt-1"
          style={{ color: C.lavenderDeep }}
        >
          {mode === "login" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MainApp — everything that needs a logged-in account. Mounting fresh  */
/* on every login means its state (data/messages/etc.) never carries   */
/* over between accounts, even when they share a username.             */
/* ------------------------------------------------------------------ */
function MainApp({ onLoggedOut }) {
  const [screen, setScreen] = useState("home");
  const [data, setData] = useState(null);
  const [messages, setMessages] = useState([]);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [lastSaved, setLastSaved] = useState(null);
  const [loadedFromStorage, setLoadedFromStorage] = useState(false);
  const skipNextSave = useRef(true);
  const username = getUsername();

  const handleExpired = useCallback(() => {
    onLoggedOut("세션이 만료됐어요. 다시 로그인해주세요.");
  }, [onLoggedOut]);

  useEffect(() => {
    (async () => {
      try {
        const d = await loadData();
        const m = await loadMessages();
        const hasRealData = d && d !== "LOAD_FAILED";
        setData(
          hasRealData
            ? d
            : {
                categories: DEFAULT_CATEGORIES,
                scheduleItems: [],
                habits: [],
                habitLogs: [],
              }
        );
        setLoadedFromStorage(!!hasRealData);
        setMessages(m || []);
        setReady(true);
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") handleExpired();
      }
    })();
  }, [handleExpired]);

  // auto-escalate to 임박 within 2 days
  useEffect(() => {
    if (!data) return;
    const today = todayStr();
    let changed = false;
    const items = data.scheduleItems.map((it) => {
      if (it.completed) return it;
      const diff = dayDiff(today, it.endDate);
      if (diff <= 2 && diff >= 0 && it.status !== "임박") {
        changed = true;
        return { ...it, status: "임박" };
      }
      return it;
    });
    if (changed) setData((d) => ({ ...d, scheduleItems: items }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    if (!ready || !data) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    saveData(data)
      .then(() => setLastSaved(new Date()))
      .catch((e) => {
        if (e.code === "SESSION_EXPIRED") handleExpired();
      });
  }, [data, ready, handleExpired]);

  useEffect(() => {
    if (!ready) return;
    saveMessages(messages).catch((e) => {
      if (e.code === "SESSION_EXPIRED") handleExpired();
    });
  }, [messages, ready, handleExpired]);

  const manualSave = async () => {
    setSaveStatus("saving");
    try {
      await saveData(data);
      await saveMessages(messages);
      setLastSaved(new Date());
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus(""), 1500);
    } catch (e) {
      if (e.code === "SESSION_EXPIRED") {
        handleExpired();
        return;
      }
      setSaveStatus("");
    }
  };

  if (!ready || !data) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-sm" style={{ color: C.inkMuted }}>
          불러오는 중…
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-hidden relative">
        {screen === "home" && (
          <Home_
            setScreen={setScreen}
            scheduleItems={data.scheduleItems}
            onManualSave={manualSave}
            saveStatus={saveStatus}
            lastSaved={lastSaved}
            loadedFromStorage={loadedFromStorage}
            data={data}
            setData={setData}
            username={username}
            onLogout={() => onLoggedOut("")}
          />
        )}
        {screen === "calendar" && <CalendarScreen data={data} setData={setData} />}
        {screen === "checklist" && <ChecklistScreen data={data} setData={setData} />}
        {screen === "habits" && <HabitsScreen data={data} setData={setData} />}
        {screen === "assistant" && (
          <AssistantScreen
            data={data}
            setData={setData}
            messages={messages}
            setMessages={setMessages}
          />
        )}
      </div>
      <BottomNav screen={screen} setScreen={setScreen} />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* App shell — gates the whole app behind login. The mobile shell       */
/* (max-width, dvh height, font) lives here so both the auth screen     */
/* and the logged-in app render inside the same frame.                 */
/* ------------------------------------------------------------------ */
export default function App() {
  const [token, setToken] = useState(() => getToken());
  const [notice, setNotice] = useState("");

  const handleLoggedOut = (msg) => {
    clearSession();
    setToken(null);
    setNotice(msg || "");
  };

  return (
    <div
      className="w-full mx-auto flex flex-col"
      style={{
        maxWidth: 420,
        height: "100dvh",
        overflow: "hidden",
        background: C.bg,
        fontFamily:
          "'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, -apple-system, sans-serif",
      }}
    >
      {token ? (
        <MainApp key={token} onLoggedOut={handleLoggedOut} />
      ) : (
        <AuthScreen
          notice={notice}
          onAuthed={() => {
            setNotice("");
            setToken(getToken());
          }}
        />
      )}
    </div>
  );
}
