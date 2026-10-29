import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppTitle, Checkbox, IconButton } from '../components/ui';
import { Icon } from '../components/Icon';
import { aggregateBundleIds, put, remove, uid } from '../lib/data';
import { db } from '../lib/db';
import { useApp, useBlocksOn, useBundles, useCategories, useNow, useTodos } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import { fmtDateLong, fmtHM, logicalToday, nowSlot, SLOTS } from '../lib/time';
import type { Bundle, Category, Todo, Top3, Top3Item } from '../lib/types';
import { BundleEdit, CategoryEdit } from './BundleEdit';
import { BlockSheet, type BlockDraft } from './BlockSheet';

export function TodoScreen({ embedded }: { embedded?: boolean }) {
  const { settings } = useApp();
  const today = logicalToday(useNow());
  const categories = useCategories();
  const bundles = useBundles();
  const todos = useTodos();
  const blocks = useBlocksOn(today);
  const [editBundle, setEditBundle] = useState<{ bundle?: Bundle; categoryId?: string } | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [draft, setDraft] = useState<BlockDraft | null>(null);

  const aggIds = useMemo(() => aggregateBundleIds(settings, bundles), [settings, bundles]);
  const aggMinutes = blocks.filter((b) => b.kind === 'done' && aggIds.has(b.bundleId)).reduce((s, b) => s + (b.end - b.start) * 10, 0);
  const doneCount = todos.filter((t) => t.done).length;

  const addToTimetable = (t: Todo) => {
    const s = Math.min(SLOTS - 6, Math.ceil(nowSlot()));
    setDraft({ date: today, kind: 'plan', start: s, end: s + 6, bundleId: t.bundleId, todoId: t.id });
  };

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        {embedded && <h2 className="pane-title">할 일</h2>}
        {settings.sections.summary && (
          <section className="card summary" aria-label="요약">
            <div className="summary-item">
              <span className="muted small">집계시간</span>
              <strong className="big">{fmtHM(aggMinutes)}</strong>
            </div>
            <div className="summary-item grow">
              <span className="muted small">Todo 진행</span>
              <strong className="big">{doneCount}/{todos.length}</strong>
              <div className="progress" role="progressbar" aria-label="Todo 진행" aria-valuemin={0}
                aria-valuemax={todos.length} aria-valuenow={doneCount}>
                <span style={{ width: todos.length ? `${(doneCount / todos.length) * 100}%` : 0 }} />
              </div>
            </div>
          </section>
        )}

        {settings.sections.top3 && <Top3Card date={today} />}
        {settings.sections.dailyReview && <ComingSoon title="Daily Review" />}
        {settings.sections.dday && <ComingSoon title="D-Day" />}
        {settings.sections.goal && <ComingSoon title="Goal" />}

        {categories.map((c) => {
          const bs = bundles.filter((b) => b.categoryId === c.id);
          const inAgg = settings.aggregate.categoryIds.includes(c.id) || bs.some((b) => settings.aggregate.bundleIds.includes(b.id));
          return (
            <section key={c.id} className="category" aria-label={c.name}>
              <div className="category-head">
                <span className="dot lg" style={{ background: colorOf(c.color).strong }} />
                <h3>{c.name}</h3>
                {inAgg && <span className="tag accent">집계 선택됨</span>}
                {bs.some((b) => b.income) && <span className="tag">수입 계산</span>}
                <span className="spacer" />
                <IconButton icon="dots" label={`${c.name} 카테고리 편집`} onClick={() => setEditCat(c)} />
              </div>
              {bs.map((b) => (
                <BundleCard key={b.id} bundle={b} todos={todos.filter((t) => t.bundleId === b.id)}
                  onEdit={() => setEditBundle({ bundle: b })} onSchedule={addToTimetable} />
              ))}
              <button type="button" className="btn ghost small add-bundle" onClick={() => setEditBundle({ categoryId: c.id })}>
                <Icon name="plus" size={16} /> {c.name}에 묶음 추가
              </button>
            </section>
          );
        })}

        <button type="button" className="btn soft wide" onClick={() => setEditBundle({})}>
          <Icon name="plus" size={18} /> 묶음 · 카테고리 추가
        </button>
      </div>

      <BundleEdit open={!!editBundle} bundle={editBundle?.bundle} presetCategoryId={editBundle?.categoryId}
        onClose={() => setEditBundle(null)} />
      <CategoryEdit category={editCat} onClose={() => setEditCat(null)} />
      <BlockSheet draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <section className="card">
      <h3 className="card-title">{title}</h3>
      <p className="muted small">다음 버전에서 제공될 예정이에요.</p>
    </section>
  );
}

function Top3Card({ date }: { date: string }) {
  const rec = useLiveQuery(() => db.top3.get(date), [date]);
  const items: Top3Item[] = [0, 1, 2].map((i) => rec?.items?.[i] ?? { text: '', done: false });
  const [editing, setEditing] = useState<Record<number, string>>({});

  const save = (next: Top3Item[]) => put<Top3>('top3', { id: date, items: next, deleted: 0 });
  const update = (i: number, c: Partial<Top3Item>) => save(items.map((it, j) => (j === i ? { ...it, ...c } : it)));

  return (
    <section className="card" aria-labelledby="top3-title">
      <div className="card-head">
        <h3 className="card-title" id="top3-title">Top 3</h3>
        <span className="muted small">{fmtDateLong(date)}</span>
      </div>
      <ol className="top3">
        {items.map((it, i) => (
          <li key={i} className={it.done ? 'done' : ''}>
            <Checkbox checked={it.done} label={`${i + 1}번 완료`} onChange={(done) => update(i, { done })} />
            <input className="input bare" value={editing[i] ?? it.text} placeholder={`오늘 중요한 일 ${i + 1}`}
              aria-label={`Top 3 · ${i + 1}번`}
              onChange={(e) => setEditing({ ...editing, [i]: e.target.value })}
              onBlur={() => {
                if (editing[i] !== undefined && editing[i] !== it.text) update(i, { text: editing[i] });
                const { [i]: _, ...rest } = editing;
                setEditing(rest);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function BundleCard({ bundle, todos, onEdit, onSchedule }: {
  bundle: Bundle; todos: Todo[]; onEdit: () => void; onSchedule: (t: Todo) => void;
}) {
  const [text, setText] = useState('');
  const col = colorOf(bundle.color);
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    await put<Todo>('todos', {
      id: uid(), bundleId: bundle.id, title, done: false, order: todos.reduce((m, t) => Math.max(m, t.order + 1), 0),
    });
    setText('');
  };
  return (
    <div className="bundle-card" style={{ ['--bundle' as string]: col.strong, ['--bundle-light' as string]: col.light }}>
      <button type="button" className="bundle-head" onClick={onEdit} aria-label={`${bundle.name} 묶음 편집`}>
        <span className="bundle-name">{bundle.name}</span>
        {bundle.income && <span className="tag small">시급 {bundle.wage.toLocaleString('ko-KR')}원</span>}
        <span className="spacer" />
        <span className="muted small">{todos.filter((t) => t.done).length}/{todos.length}</span>
        <Icon name="pencil" size={16} />
      </button>
      <ul className="todo-list">
        {todos.map((t) => (
          <li key={t.id} className={'todo' + (t.done ? ' done' : '')}>
            <Checkbox checked={t.done} label={t.title} color={col.strong} onChange={(done) => put<Todo>('todos', { ...t, done })} />
            <span className="todo-title">{t.title}</span>
            <IconButton icon="clock" label={`${t.title} 시간표에 넣기`} onClick={() => onSchedule(t)} />
            <IconButton icon="x" className="faint" label={`${t.title} 삭제`} onClick={() => remove('todos', t.id)} />
          </li>
        ))}
        <li className="todo add">
          <Icon name="plus" size={18} />
          <input className="input bare" value={text} placeholder="할 일 추가" aria-label={`${bundle.name}에 할 일 추가`}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
        </li>
      </ul>
    </div>
  );
}
