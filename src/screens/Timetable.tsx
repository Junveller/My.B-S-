import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AppTitle, Checkbox, DateCard, IconButton, Segmented, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { aggregateBundleIds, copyPlanToDone, saveSettings } from '../lib/data';
import { useApp, useBlocksOn, useBundles, useCategories, useLocalPref, useNow } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import { addDays, fmtDateLong, fmtMinutes, hourOfRow, logicalToday, nowSlot, SLOTS, slotLabel, won } from '../lib/time';
import type { Block, BlockKind } from '../lib/types';
import { BlockSheet, type BlockDraft } from './BlockSheet';

const ROWS = 24;
const ROW_H = 20;
const ROW_H_TABLET = 26;
const ROW_H_ZOOM = 48;
const LONG_PRESS_MS = 320;
const MOVE_TOLERANCE = 8;

interface Piece {
  key: string;
  row: number;
  /** 세로로 이어지는 행 수 (꽉 찬 시간은 하나로 합쳐 그린다) */
  rows: number;
  from: number;
  to: number;
  first: boolean;
}

/** [start, end) 칸 범위를 그릴 조각으로 나눈다: 앞쪽 일부 행 / 꽉 찬 행 묶음 / 뒤쪽 일부 행 */
function pieces(key: string, start: number, end: number): Piece[] {
  const out: Piece[] = [];
  const push = (row: number, rows: number, from: number, to: number) =>
    out.push({ key: `${key}-${out.length}`, row, rows, from, to, first: out.length === 0 });
  let s = start;
  if (s % 6 !== 0 || end - s < 6) {
    const r = Math.floor(s / 6);
    const to = Math.min(end, (r + 1) * 6);
    push(r, 1, s - r * 6, to - r * 6);
    s = to;
  }
  const full = Math.floor((end - s) / 6);
  if (full > 0) {
    push(s / 6, full, 0, 6);
    s += full * 6;
  }
  if (s < end) push(s / 6, 1, 0, end - s);
  return out;
}

export function TimetableScreen({ embedded }: { embedded?: boolean }) {
  const { settings, toast, tablet, date, setDate } = useApp();
  const now = useNow();
  const today = logicalToday(now);
  const [kind, setKind] = useLocalPref<BlockKind>('bisje.kind', 'plan');
  const [zoom, setZoom] = useState(false);
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [aggOpen, setAggOpen] = useState(false);
  const [sel, setSel] = useState<[number, number] | null>(null);

  const blocks = useBlocksOn(date);
  const bundles = useBundles();
  const bundleMap = useMemo(() => new Map(bundles.map((b) => [b.id, b])), [bundles]);
  const aggIds = useMemo(() => aggregateBundleIds(settings, bundles), [settings, bundles]);
  const aggMinutes = blocks.filter((b) => b.kind === 'done' && aggIds.has(b.bundleId)).reduce((s, b) => s + (b.end - b.start) * 10, 0);

  const shown = blocks.filter((b) => b.kind === kind).sort((a, b) => a.start - b.start);
  const ghost = blocks.filter((b) => b.kind !== kind);
  const rowH = zoom ? ROW_H_ZOOM : tablet ? ROW_H_TABLET : ROW_H;
  const isToday = date === today;
  const ns = nowSlot(now);
  const nowRow = Math.floor(ns / 6);

  const bodyRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; painting: boolean; anchor: number;
    blockId?: string; mouse: boolean;
  } | null>(null);
  const tap = useRef<{ blockId?: string; anchor: number } | null>(null);

  const slotAt = (x: number, y: number) => {
    const r = bodyRef.current!.getBoundingClientRect();
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - r.top) / rowH)));
    const col = Math.max(0, Math.min(5, Math.floor(((x - r.left) / r.width) * 6)));
    return row * 6 + col;
  };

  // 칠하는 중에는 스크롤 막기 (iOS Safari: passive가 아닌 touchmove에서 preventDefault)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (gesture.current?.painting) e.preventDefault();
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, []);

  const startPaint = (anchor: number) => {
    const g = gesture.current;
    if (!g) return;
    g.painting = true;
    g.anchor = anchor;
    setSel([anchor, anchor + 1]);
    navigator.vibrate?.(10);
  };

  const onDown = (e: RPointerEvent) => {
    tap.current = null;
    if (e.button !== 0) return;
    const slot = slotAt(e.clientX, e.clientY);
    const blockEl = (e.target as HTMLElement).closest('[data-block]') as HTMLElement | null;
    const mouse = e.pointerType === 'mouse';
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, painting: false, anchor: slot, blockId: blockEl?.dataset.block, mouse };
    if (!mouse) gesture.current.timer = setTimeout(() => startPaint(slot), LONG_PRESS_MS);
  };

  const onMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - g.x, e.clientY - g.y) > MOVE_TOLERANCE;
    if (!g.painting) {
      if (!moved) return;
      if (g.mouse) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        startPaint(g.anchor);
      } else {
        clearTimeout(g.timer); // 스크롤로 판단
        gesture.current = null;
        return;
      }
    }
    const s = slotAt(e.clientX, e.clientY);
    setSel([Math.min(g.anchor, s), Math.max(g.anchor, s) + 1]);
  };

  const onUp = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    clearTimeout(g.timer);
    gesture.current = null;
    if (g.painting) {
      const s = slotAt(e.clientX, e.clientY);
      setSel(null);
      setDraft({ date, kind, start: Math.min(g.anchor, s), end: Math.max(g.anchor, s) + 1 });
      return;
    }
    // 짧게 탭: 처리는 click에서 한다 (pointerup에서 시트를 열면 뒤따르는 click이 시트 안을 눌러 버림)
    tap.current = { blockId: g.blockId, anchor: g.anchor };
  };

  const onClick = () => {
    const t = tap.current;
    tap.current = null;
    if (!t) return;
    if (t.blockId) {
      const b = blocks.find((x) => x.id === t.blockId);
      if (b) setDraft({ ...b });
      return;
    }
    const g = t;
    if (!zoom) {
      // 작은 칸 입력을 위해 그 시간대를 크게 확대
      const row = Math.floor(g.anchor / 6);
      setZoom(true);
      requestAnimationFrame(() => {
        const body = bodyRef.current;
        const scroller = body?.closest('.tt-scroll');
        if (body && scroller) scroller.scrollTop = body.offsetTop + row * ROW_H_ZOOM - scroller.clientHeight / 2 + ROW_H_ZOOM / 2;
      });
      return;
    }
    setDraft({ date, kind, start: g.anchor, end: Math.min(SLOTS, g.anchor + 6) });
  };

  const onCancel = () => {
    clearTimeout(gesture.current?.timer);
    gesture.current = null;
    setSel(null);
  };

  const copyAll = async () => {
    const n = await copyPlanToDone(date);
    toast(n ? `PLAN ${fmtMinutes(n * 10)}을 DONE에 복사했어요` : '복사할 PLAN이 없어요 (이미 DONE에 있는 칸은 건너뛰어요)');
  };

  const rect = (p: Pick<Piece, 'row' | 'rows' | 'from' | 'to'>) => ({
    left: `${(p.from / 6) * 100}%`,
    width: `${((p.to - p.from) / 6) * 100}%`,
    top: p.row * rowH + 1,
    height: p.rows * rowH - 2,
  });

  const renderBlock = (b: Block, isGhost: boolean) => {
    const bundle = bundleMap.get(b.bundleId);
    const c = colorOf(bundle?.color);
    const mins = (b.end - b.start) * 10;
    const range = `${slotLabel(b.start)}–${slotLabel(b.end)}`;
    const ps = pieces(b.id, b.start, b.end);
    const labelIdx = ps.findIndex((p) => p.rows > 1);
    return ps.map((p, i) => {
      const tall = p.rows > 1 && i === labelIdx;
      const showLabel = !isGhost && (labelIdx >= 0 ? i === labelIdx || (i === 0 && labelIdx > 0) : p.first);
      const titleOnly = labelIdx > 0 && i === 0; // 앞쪽 짧은 조각은 제목만
      return (
        <div key={p.key} className={'tt-block ' + b.kind + (isGhost ? ' ghost' : '') + (tall ? ' tall' : '')}
          data-block={isGhost ? undefined : b.id} aria-hidden="true"
          style={{ ...rect(p), ['--c' as string]: c.strong, ['--cl' as string]: c.light, ['--ink' as string]: c.ink }}>
          {showLabel && (
            tall ? (
              <>
                <span className="tt-title">{b.title || bundle?.name}{b.memo && <MemoIcon />}</span>
                <span className="tt-time">{range} · {fmtMinutes(mins)}{bundle?.income ? ` · ${won((mins / 60) * bundle.wage)}` : ''}</span>
              </>
            ) : (
              <>
                <span className="tt-title">{b.title || bundle?.name}</span>
                {!titleOnly && <span className="tt-time">{range}</span>}
                {b.memo && <MemoIcon />}
              </>
            )
          )}
        </div>
      );
    });
  };

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="tt-toolbar">
        {!embedded && <DateCard date={date} today={today} onChange={setDate} addDays={addDays} />}
        <div className="tt-actions">
          <Segmented label="PLAN / DONE" value={kind} onChange={setKind}
            options={[{ value: 'plan', label: 'PLAN' }, { value: 'done', label: 'DONE' }]} />
          <button type="button" className="btn outline tt-copy" onClick={copyAll} aria-label="PLAN을 DONE으로 복사">
            <Icon name="arrowRight" size={16} /> DONE으로 복사
          </button>
          {zoom && <IconButton icon="zoomOut" label="확대 끄기" pressed onClick={() => setZoom(false)} />}
        </div>
        {settings.sections.summary && (
          <div className="tt-agg">
            <span className="muted">집계시간 <b>{fmtMinutes(aggMinutes)}</b></span>
            <button type="button" className="pill-btn" onClick={() => setAggOpen(true)}>
              <span className="pill"><Icon name="sliders" size={14} stroke={2.2} /> 집계 항목 선택</span>
            </button>
          </div>
        )}
      </div>

      <div className="screen-body tt-scroll">
        <div className={'tt-grid' + (zoom ? ' zoom' : '')} style={{ ['--row-h' as string]: `${rowH}px` }}>
          <div className="tt-hours" aria-hidden="true">
            {Array.from({ length: ROWS }, (_, r) => (
              <div key={r} className={'tt-hour' + (isToday && r === nowRow ? ' now' : '')}><span>{hourOfRow(r)}</span></div>
            ))}
          </div>
          <div className="tt-body" ref={bodyRef} style={{ height: ROWS * rowH }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onClick={onClick}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`${fmtDateLong(date)} ${kind === 'plan' ? 'PLAN' : 'DONE'} 시간표. 길게 눌러 끌면 칠하고, 탭하면 확대돼요.`}
            role="application">
            {ghost.map((b) => renderBlock(b, true))}
            {shown.map((b) => renderBlock(b, false))}
            {sel && pieces('sel', sel[0], sel[1]).map((p) => <div key={p.key} className="tt-sel" style={rect(p)} />)}
            {isToday && <div className="tt-now" style={{ left: `${((ns % 6) / 6) * 100}%`, top: nowRow * rowH, height: rowH }} />}
          </div>
        </div>
        <ul className="sr-only" aria-label="이 날의 블록">
          {shown.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => setDraft({ ...b })}>
                {slotLabel(b.start)}부터 {slotLabel(b.end)}까지 {b.title}{b.memo ? ', 메모 있음' : ''}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => {
              const s = isToday ? Math.min(SLOTS - 6, Math.floor(ns)) : 0;
              setDraft({ date, kind, start: s, end: s + 6 });
            }}>새 블록 추가</button>
          </li>
        </ul>
        <p className="muted small tt-help">길게 눌러 끌면 칠하기 · 칸을 탭하면 확대 · 블록을 탭하면 메모</p>
      </div>

      <BlockSheet draft={draft} onClose={() => setDraft(null)} />
      <AggregateSheet open={aggOpen} onClose={() => setAggOpen(false)} blocks={blocks} />
    </div>
  );
}

const MemoIcon = () => <span className="tt-memo"><Icon name="memo" size={11} stroke={2.2} /></span>;

/** 집계할 항목 선택: 카테고리 체크 시 하위 묶음 전체, 적용을 눌러야 저장 */
export function AggregateSheet({ open, onClose, blocks }: { open: boolean; onClose: () => void; blocks: Block[] }) {
  const { settings, session } = useApp();
  const categories = useCategories();
  const bundles = useBundles();
  const [cats, setCats] = useState<string[]>([]);
  const [bs, setBs] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setCats(settings.aggregate.categoryIds);
    setBs(settings.aggregate.bundleIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doneMin = (ids: Set<string>) =>
    blocks.filter((b) => b.kind === 'done' && ids.has(b.bundleId)).reduce((s, b) => s + (b.end - b.start) * 10, 0);
  const selected = aggregateBundleIds({ ...settings, aggregate: { categoryIds: cats, bundleIds: bs } }, bundles);

  const toggleCat = (id: string, on: boolean) => {
    const children = bundles.filter((b) => b.categoryId === id).map((b) => b.id);
    setBs(bs.filter((b) => !children.includes(b)));
    setCats(on ? [...cats, id] : cats.filter((c) => c !== id));
  };
  const toggleBundle = (catId: string, id: string, on: boolean) => {
    if (cats.includes(catId)) {
      // 카테고리 전체 선택에서 하나를 빼면 나머지 묶음을 개별 선택으로 바꾼다
      const rest = bundles.filter((b) => b.categoryId === catId && b.id !== id).map((b) => b.id);
      setCats(cats.filter((c) => c !== catId));
      setBs([...bs, ...rest]);
      return;
    }
    setBs(on ? [...bs, id] : bs.filter((b) => b !== id));
  };
  const apply = async () => {
    await saveSettings({ aggregate: { categoryIds: cats, bundleIds: bs } }, session.nickname);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="집계할 항목 선택"
      footer={
        <>
          <div className="agg-total"><span className="muted small">집계시간</span><strong>{fmtMinutes(doneMin(selected))}</strong></div>
          <button type="button" className="btn primary grow" onClick={apply}>적용</button>
        </>
      }>
      <p className="muted small">고른 항목의 시간만 위쪽 집계시간에 더해져요</p>
      <ul className="agg-list">
        {categories.map((c) => {
          const children = bundles.filter((b) => b.categoryId === c.id);
          const catOn = cats.includes(c.id);
          const some = !catOn && children.some((b) => bs.includes(b.id));
          return (
            <li key={c.id}>
              <div className="agg-row">
                <Checkbox checked={catOn} indeterminate={some} label={`${c.name} 전체`} color="#4B55D6" onChange={(v) => toggleCat(c.id, v)} />
                <strong className="grow">{c.name}</strong>
                <span className="muted small">{fmtMinutes(doneMin(new Set(children.map((b) => b.id))))}</span>
              </div>
              <ul>
                {children.map((b) => (
                  <li key={b.id} className="agg-row sub">
                    <Checkbox checked={catOn || bs.includes(b.id)} label={b.name} color="#4B55D6"
                      onChange={(v) => toggleBundle(c.id, b.id, v)} />
                    <span className="dot" style={{ background: colorOf(b.color).strong }} />
                    <span className="grow">{b.name}</span>
                    <span className="muted small">{fmtMinutes(doneMin(new Set([b.id])))}</span>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
