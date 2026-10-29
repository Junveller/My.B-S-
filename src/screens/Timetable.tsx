import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { AppTitle, Checkbox, IconButton, Segmented, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { aggregateBundleIds, copyPlanToDone, saveSettings } from '../lib/data';
import { useApp, useBlocksOn, useBundles, useCategories, useLocalPref, useNow } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import { addDays, fmtDateLong, fmtHM, fmtMinutes, hourOfRow, logicalToday, nowSlot, SLOTS } from '../lib/time';
import type { Block, BlockKind } from '../lib/types';
import { BlockSheet, type BlockDraft } from './BlockSheet';

const ROWS = 24;
const ROW_H = 20;
const ROW_H_ZOOM = 48;
const LONG_PRESS_MS = 320;
const MOVE_TOLERANCE = 8;

interface Seg {
  key: string;
  row: number;
  from: number;
  to: number;
  first: boolean;
}

/** [start, end) 칸 범위를 시간 행 단위 조각으로 나눈다 */
function segments(key: string, start: number, end: number): Seg[] {
  const out: Seg[] = [];
  for (let r = Math.floor(start / 6); r * 6 < end; r++) {
    const from = Math.max(start, r * 6) - r * 6;
    const to = Math.min(end, r * 6 + 6) - r * 6;
    out.push({ key: `${key}-${r}`, row: r, from, to, first: out.length === 0 });
  }
  return out;
}

export function TimetableScreen({ embedded }: { embedded?: boolean }) {
  const { settings, toast } = useApp();
  const now = useNow();
  const today = logicalToday(now);
  const [date, setDate] = useState(today);
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

  const shown = blocks.filter((b) => b.kind === kind);
  const ghost = blocks.filter((b) => b.kind !== kind);
  const rowH = zoom ? ROW_H_ZOOM : ROW_H;
  const isToday = date === today;
  const ns = nowSlot(now);
  const nowRow = Math.floor(ns / 6);

  const gridRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const gesture = useRef<{
    id: number; x: number; y: number; timer?: ReturnType<typeof setTimeout>; painting: boolean; anchor: number;
    blockId?: string; mouse: boolean;
  } | null>(null);

  const slotAt = (x: number, y: number) => {
    const grid = gridRef.current!;
    const track = grid.querySelector('.tt-track') as HTMLElement;
    const g = grid.getBoundingClientRect();
    const t = track.getBoundingClientRect();
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor((y - g.top) / rowH)));
    const col = Math.max(0, Math.min(5, Math.floor(((x - t.left) / t.width) * 6)));
    return row * 6 + col;
  };

  // 칠하는 중에는 스크롤 막기 (iOS Safari: passive가 아닌 touchmove에서 preventDefault)
  useEffect(() => {
    const el = gridRef.current;
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
      const range: [number, number] = [Math.min(g.anchor, s), Math.max(g.anchor, s) + 1];
      setSel(null);
      setDraft({ date, kind, start: range[0], end: range[1] });
      return;
    }
    // 짧게 탭
    if (g.blockId) {
      const b = blocks.find((x) => x.id === g.blockId);
      if (b) setDraft({ ...b });
      return;
    }
    if (!zoom) {
      const row = Math.floor(g.anchor / 6);
      setZoom(true);
      requestAnimationFrame(() => rowRefs.current[row]?.scrollIntoView({ block: 'center' }));
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

  const addAtNow = () => {
    const s = isToday ? Math.min(SLOTS - 6, Math.floor(ns)) : 0;
    setDraft({ date, kind, start: s, end: s + 6 });
  };

  const renderSeg = (b: Block, seg: Seg, isGhost: boolean) => {
    const bundle = bundleMap.get(b.bundleId);
    const c = colorOf(bundle?.color);
    return (
      <div key={seg.key} className={'tt-block' + (isGhost ? ' ghost' : '') + (b.kind === 'plan' ? ' plan' : ' done')}
        data-block={isGhost ? undefined : b.id}
        style={{
          left: `${(seg.from / 6) * 100}%`, width: `${((seg.to - seg.from) / 6) * 100}%`,
          ['--c' as string]: c.strong, ['--cl' as string]: c.light,
        }}
        aria-hidden="true">
        {!isGhost && seg.first && <span className="tt-block-title">{b.title || bundle?.name}</span>}
        {!isGhost && seg.first && b.memo && <span className="tt-memo"><Icon name="memo" size={zoom ? 14 : 11} stroke={2.2} /></span>}
      </div>
    );
  };

  const rows = Array.from({ length: ROWS }, (_, r) => r);
  const segsByRow = (list: Block[]) => {
    const m = new Map<number, { b: Block; seg: Seg }[]>();
    for (const b of list) for (const seg of segments(b.id, b.start, b.end)) {
      if (!m.has(seg.row)) m.set(seg.row, []);
      m.get(seg.row)!.push({ b, seg });
    }
    return m;
  };
  const shownRows = segsByRow(shown);
  const ghostRows = segsByRow(ghost);
  const selSegs = sel ? segments('sel', sel[0], sel[1]) : [];

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="tt-toolbar">
        <div className="date-nav">
          <IconButton icon="left" label="어제" onClick={() => setDate(addDays(date, -1))} />
          <button type="button" className="date-label" onClick={() => setDate(today)} aria-label={`${fmtDateLong(date)}, 오늘로 이동`}>
            {fmtDateLong(date)}{isToday && <span className="today-dot" aria-hidden="true" />}
          </button>
          <IconButton icon="right" label="내일" onClick={() => setDate(addDays(date, 1))} />
          <span className="spacer" />
          {settings.sections.summary && (
            <button type="button" className="agg-btn" onClick={() => setAggOpen(true)} aria-label={`집계시간 ${fmtMinutes(aggMinutes)}, 집계 항목 선택`}>
              <span className="muted small">집계</span> <strong>{fmtHM(aggMinutes)}</strong>
            </button>
          )}
        </div>
        <div className="tt-actions">
          <Segmented label="PLAN / DONE" value={kind} onChange={setKind}
            options={[{ value: 'plan', label: 'PLAN' }, { value: 'done', label: 'DONE' }]} />
          <button type="button" className="btn soft small tt-copy" onClick={copyAll} aria-label="PLAN → DONE 복사">
            <Icon name="copy" size={16} />PLAN→DONE
          </button>
          <span className="spacer" />
          <IconButton icon={zoom ? 'zoomOut' : 'zoomIn'} label={zoom ? '확대 끄기' : '확대 보기'} pressed={zoom} onClick={() => setZoom(!zoom)} />
          <IconButton icon="plus" label="시간 선택해서 넣기" className="accent" onClick={addAtNow} />
        </div>
      </div>

      <div className="screen-body tt-scroll">
        <div className={'tt-grid' + (zoom ? ' zoom' : '') + (kind === 'done' ? ' mode-done' : '')} ref={gridRef}
          style={{ ['--row-h' as string]: `${rowH}px` }}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
          onContextMenu={(e) => e.preventDefault()}
          role="grid" aria-label={`${fmtDateLong(date)} ${kind === 'plan' ? 'PLAN' : 'DONE'} 시간표. 길게 눌러 끌면 칠하고, 탭하면 확대돼요.`}>
          {rows.map((r) => (
            <div key={r} className="tt-row" ref={(el) => { rowRefs.current[r] = el; }} role="row">
              <div className={'tt-hour' + (isToday && r === nowRow ? ' now' : '')} role="rowheader">
                <span>{hourOfRow(r)}</span>
              </div>
              <div className="tt-track" role="gridcell"
                aria-label={`${hourOfRow(r)}시: ${(shownRows.get(r) ?? []).map(({ b }) => b.title).join(', ') || '비어 있음'}`}>
                {[1, 2, 3, 4, 5].map((i) => <span key={i} className="tt-tick" style={{ left: `${(i / 6) * 100}%` }} />)}
                {(ghostRows.get(r) ?? []).map(({ b, seg }) => renderSeg(b, seg, true))}
                {(shownRows.get(r) ?? []).map(({ b, seg }) => renderSeg(b, seg, false))}
                {selSegs.filter((s) => s.row === r).map((s) => (
                  <div key={s.key} className="tt-sel" style={{ left: `${(s.from / 6) * 100}%`, width: `${((s.to - s.from) / 6) * 100}%` }} />
                ))}
                {isToday && r === nowRow && <div className="tt-now" style={{ left: `${((ns % 6) / 6) * 100}%` }} />}
              </div>
            </div>
          ))}
        </div>
        <p className="muted small tt-help">길게 눌러 끌면 칠하기 · 칸을 탭하면 확대 · 블록을 탭하면 메모</p>
      </div>

      <BlockSheet draft={draft} onClose={() => setDraft(null)} />
      <AggregateSheet open={aggOpen} onClose={() => setAggOpen(false)} />
    </div>
  );
}

/** 집계 항목 선택: 카테고리 체크 시 하위 묶음 전체 */
export function AggregateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, session } = useApp();
  const categories = useCategories();
  const bundles = useBundles();
  const { categoryIds, bundleIds } = settings.aggregate;

  const save = (cats: string[], bs: string[]) =>
    saveSettings({ aggregate: { categoryIds: cats, bundleIds: bs } }, session.nickname);

  const toggleCat = (id: string, on: boolean) => {
    const children = bundles.filter((b) => b.categoryId === id).map((b) => b.id);
    const bs = bundleIds.filter((b) => !children.includes(b));
    save(on ? [...categoryIds, id] : categoryIds.filter((c) => c !== id), bs);
  };
  const toggleBundle = (catId: string, id: string, on: boolean) => {
    if (categoryIds.includes(catId)) {
      // 카테고리 전체 선택에서 하나를 빼면 나머지 묶음을 개별 선택으로 바꾼다
      const rest = bundles.filter((b) => b.categoryId === catId && b.id !== id).map((b) => b.id);
      save(categoryIds.filter((c) => c !== catId), [...bundleIds, ...rest]);
      return;
    }
    save(categoryIds, on ? [...bundleIds, id] : bundleIds.filter((b) => b !== id));
  };

  return (
    <Sheet open={open} onClose={onClose} title="집계 항목 선택"
      footer={<button type="button" className="btn primary grow" onClick={onClose}>완료</button>}>
      <p className="muted small">선택한 항목의 DONE 시간을 합쳐서 집계시간으로 보여줘요.</p>
      <ul className="agg-list">
        {categories.map((c) => {
          const children = bundles.filter((b) => b.categoryId === c.id);
          const catOn = categoryIds.includes(c.id);
          const some = !catOn && children.some((b) => bundleIds.includes(b.id));
          return (
            <li key={c.id}>
              <div className="agg-row">
                <Checkbox checked={catOn} indeterminate={some} label={`${c.name} 전체`} onChange={(v) => toggleCat(c.id, v)} />
                <span className="dot" style={{ background: colorOf(c.color).strong }} />
                <strong>{c.name}</strong>
              </div>
              <ul>
                {children.map((b) => (
                  <li key={b.id} className="agg-row sub">
                    <Checkbox checked={catOn || bundleIds.includes(b.id)} label={b.name} color={colorOf(b.color).strong}
                      onChange={(v) => toggleBundle(c.id, b.id, v)} />
                    <span>{b.name}</span>
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
