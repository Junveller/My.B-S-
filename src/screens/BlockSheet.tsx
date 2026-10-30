import { useEffect, useState } from 'react';
import { Field, Sheet, Stepper } from '../components/ui';
import { copyPlanToDone, placeBlock, remove, uid } from '../lib/data';
import { useApp, useBundles, useCategories, useTodos } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import { fmtDateLong, fmtMinutes, SLOTS, slotLabel } from '../lib/time';
import type { Block, BlockKind } from '../lib/types';

export interface BlockDraft {
  id?: string;
  date: string;
  kind: BlockKind;
  start: number;
  end: number;
  bundleId?: string;
  todoId?: string;
  title?: string;
  memo?: string;
}

/** 새 블록: 시간표에 넣기 / 기존 블록: 메모 시트 (제목, 묶음 칩, 시간 수정, PLAN→DONE 복사, 메모, 삭제/저장) */
export function BlockSheet({ draft, onClose }: { draft: BlockDraft | null; onClose: () => void }) {
  const { toast } = useApp();
  const categories = useCategories();
  const bundles = useBundles();
  const todos = useTodos();
  const [d, setD] = useState<BlockDraft | null>(draft);
  const [titleTouched, setTitleTouched] = useState(false);
  const [editTime, setEditTime] = useState(false);

  useEffect(() => {
    setD(draft);
    setTitleTouched(!!draft?.id);
    setEditTime(false);
  }, [draft]);

  useEffect(() => {
    if (d && !d.bundleId && bundles.length && !d.id) setD({ ...d, bundleId: bundles[0].id });
  }, [bundles, d]);

  if (!d) return null;
  const editing = !!d.id;
  const bundle = bundles.find((b) => b.id === d.bundleId);
  const category = categories.find((c) => c.id === bundle?.categoryId);
  const bundleTodos = todos.filter((t) => t.bundleId === d.bundleId);
  const autoTitle = (bundleId?: string, todoId?: string) =>
    todos.find((t) => t.id === todoId)?.title ?? bundles.find((b) => b.id === bundleId)?.name ?? '';
  const title = titleTouched ? d.title ?? '' : d.title || autoTitle(d.bundleId, d.todoId);
  const finalTitle = title.trim() || autoTitle(d.bundleId, d.todoId);

  const setStart = (s: number) => {
    const start = Math.max(0, Math.min(SLOTS - 1, s));
    setD({ ...d, start, end: Math.max(d.end, start + 1) });
  };
  const setEnd = (e: number) => {
    const end = Math.max(1, Math.min(SLOTS, e));
    setD({ ...d, end, start: Math.min(d.start, end - 1) });
  };

  const toBlock = (): Omit<Block, 'updatedAt'> => ({
    id: d.id ?? uid(), date: d.date, kind: d.kind, start: d.start, end: d.end,
    bundleId: d.bundleId!, todoId: d.todoId, title: finalTitle, memo: d.memo ?? '',
  });

  const save = async () => {
    if (!d.bundleId) {
      toast('묶음을 먼저 만들어 주세요');
      return;
    }
    await placeBlock(toBlock());
    onClose();
  };

  const copy = async () => {
    const block = toBlock();
    await placeBlock(block);
    const n = await copyPlanToDone(d.date, { ...block, updatedAt: 0 });
    toast(n ? `DONE에 ${fmtMinutes(n * 10)} 복사했어요` : '이미 DONE에 기록된 시간이에요');
    onClose();
  };

  const del = async () => {
    if (d.id) await remove('blocks', d.id);
    onClose();
  };

  const details = (
    <>
      <Field label="제목">
        <input className="input" value={title} placeholder="블록 제목"
          onChange={(e) => { setTitleTouched(true); setD({ ...d, title: e.target.value }); }} />
      </Field>

      <div className="field">
        <span className="field-label">묶음</span>
        {bundles.length === 0 && <p className="muted">할 일 화면에서 묶음을 먼저 만들어 주세요.</p>}
        {categories.map((c) => {
          const bs = bundles.filter((b) => b.categoryId === c.id);
          if (!bs.length) return null;
          return (
            <div key={c.id} className="chip-group">
              <span className="chip-group-label">{c.name}</span>
              <div className="chips">
                {bs.map((b) => (
                  <button key={b.id} type="button" className={'chip' + (b.id === d.bundleId ? ' on' : '')}
                    aria-pressed={b.id === d.bundleId} onClick={() => setD({ ...d, bundleId: b.id, todoId: undefined })}>
                    <span className="dot" style={{ background: colorOf(b.color).strong }} />{b.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {bundle && bundleTodos.length > 0 && (
        <div className="field">
          <span className="field-label">할 일 (선택)</span>
          <div className="chips">
            {bundleTodos.map((t) => (
              <button key={t.id} type="button" className={'chip small' + (t.id === d.todoId ? ' on' : '')}
                aria-pressed={t.id === d.todoId} onClick={() => setD({ ...d, todoId: d.todoId === t.id ? undefined : t.id })}>
                {t.title}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span className="field-label">시간 · {fmtMinutes((d.end - d.start) * 10)}</span>
        <Stepper label="시작" value={slotLabel(d.start)} onDec={() => setStart(d.start - 1)} onInc={() => setStart(d.start + 1)}
          decLabel="시작 10분 앞당기기" incLabel="시작 10분 늦추기" />
        <Stepper label="종료" value={slotLabel(d.end)} onDec={() => setEnd(d.end - 1)} onInc={() => setEnd(d.end + 1)}
          decLabel="종료 10분 앞당기기" incLabel="종료 10분 늦추기" />
      </div>
    </>
  );

  const memo = (
    <div className="field">
      <label className="field-label" htmlFor="block-memo">메모</label>
      <textarea id="block-memo" className="input textarea" rows={4} value={d.memo ?? ''} placeholder="이 블록에 대한 메모"
        onChange={(e) => setD({ ...d, memo: e.target.value })} />
      <span className="field-hint right">이 블록에만 저장돼요</span>
    </div>
  );

  if (!editing) {
    return (
      <Sheet open onClose={onClose} title="시간표에 넣기" tall
        footer={<button type="button" className="btn primary big grow" onClick={save}>저장</button>}>
        <p className="sheet-sub">
          {fmtDateLong(d.date)} · <span className={'kind-tag ' + d.kind}>{d.kind === 'plan' ? 'PLAN' : 'DONE'}</span>
        </p>
        {details}
        {memo}
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={finalTitle || '블록 메모'} tall={editTime}
      footer={
        <>
          <button type="button" className="btn outline danger big del-btn" onClick={del}>삭제</button>
          <button type="button" className="btn primary big grow" onClick={save}>저장</button>
        </>
      }>
      <div className="block-meta">
        <span className="meta-chip">
          <span className="dot" style={{ background: colorOf(bundle?.color).strong }} />
          {category ? `${category.name} · ` : ''}{bundle?.name ?? '묶음 없음'}
        </span>
        <span className="muted small">{slotLabel(d.start)} – {slotLabel(d.end)} · {fmtMinutes((d.end - d.start) * 10)}</span>
        <span className={'kind-tag ' + d.kind}>{d.kind === 'plan' ? 'PLAN' : 'DONE'}</span>
      </div>
      <div className="btn-row">
        <button type="button" className="btn outline" aria-expanded={editTime} onClick={() => setEditTime(!editTime)}>
          {editTime ? '시간 수정 닫기' : '시간 수정'}
        </button>
        {d.kind === 'plan' && <button type="button" className="btn outline" onClick={copy}>PLAN → DONE 복사</button>}
      </div>
      {editTime && details}
      {memo}
    </Sheet>
  );
}
