import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AppTitle, Checkbox, DateCard, Field, IconButton, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { aggregateBundleIds, put, remove, uid } from '../lib/data';
import { db } from '../lib/db';
import { useApp, useBlocksOn, useBundles, useCategories, useNow, useTodos } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import { addDays, fmtMinutes, logicalToday, nowSlot, SLOTS } from '../lib/time';
import type { Bundle, Category, Todo, Top3, Top3Item } from '../lib/types';
import { BundleEdit, CategoryEdit } from './BundleEdit';
import { BlockSheet, type BlockDraft } from './BlockSheet';

const MAX_PILLS = 12;

export function TodoScreen({ embedded }: { embedded?: boolean }) {
  const { settings, date, setDate } = useApp();
  const today = logicalToday(useNow());
  const categories = useCategories();
  const bundles = useBundles();
  const todos = useTodos();
  const blocks = useBlocksOn(date);
  const [editBundle, setEditBundle] = useState<{ bundle?: Bundle } | null>(null);
  const [editCat, setEditCat] = useState<Category | null>(null);
  const [editTodo, setEditTodo] = useState<Todo | null>(null);
  const [draft, setDraft] = useState<BlockDraft | null>(null);

  const aggIds = useMemo(() => aggregateBundleIds(settings, bundles), [settings, bundles]);
  const aggMinutes = blocks.filter((b) => b.kind === 'done' && aggIds.has(b.bundleId)).reduce((s, b) => s + (b.end - b.start) * 10, 0);
  const doneCount = todos.filter((t) => t.done).length;

  const addToTimetable = (t: Todo) => {
    const s = date === today ? Math.min(SLOTS - 6, Math.ceil(nowSlot())) : 18; // 다른 날이면 09:00
    setDraft({ date, kind: 'plan', start: s, end: s + 6, bundleId: t.bundleId, todoId: t.id });
  };

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        <DateCard date={date} today={today} onChange={setDate} addDays={addDays} twoLine />

        {settings.sections.summary && (
          <div className="summary-row">
            <section className="card stat" aria-label="집계시간">
              <span className="muted small">집계시간</span>
              <strong className="stat-value">{fmtMinutes(aggMinutes)}</strong>
            </section>
            <section className="card stat" aria-label={`Todo 진행 ${doneCount}/${todos.length}`}>
              <div className="stat-line">
                <span className="muted small">Todo</span>
                <strong>{doneCount}/{todos.length}</strong>
              </div>
              {todos.length > 0 && todos.length <= MAX_PILLS ? (
                <div className="pills" aria-hidden="true">
                  {todos.map((_, i) => <span key={i} className={i < doneCount ? 'on' : ''} />)}
                </div>
              ) : (
                <div className="progress" aria-hidden="true">
                  <span style={{ width: todos.length ? `${(doneCount / todos.length) * 100}%` : 0 }} />
                </div>
              )}
            </section>
          </div>
        )}

        {settings.sections.top3 && <Top3Card date={date} />}
        {settings.sections.dailyReview && <ComingSoon title="Daily Review" />}
        {settings.sections.dday && <ComingSoon title="D-Day" />}
        {settings.sections.goal && <ComingSoon title="Goal" />}

        {categories.map((c) => {
          const bs = bundles.filter((b) => b.categoryId === c.id);
          const inAgg = settings.aggregate.categoryIds.includes(c.id) || bs.some((b) => settings.aggregate.bundleIds.includes(b.id));
          return (
            <section key={c.id} className="category" aria-label={c.name}>
              <div className="category-head">
                <h3>{c.name}</h3>
                {inAgg && <span className="tag accent">집계 선택됨</span>}
                {bs.some((b) => b.income) && <span className="tag income">수입 계산</span>}
                <span className="spacer" />
                <IconButton icon="pencil" className="faint" label={`${c.name} 카테고리 편집`} onClick={() => setEditCat(c)} />
              </div>
              {bs.map((b) => (
                <BundleCard key={b.id} bundle={b} todos={todos.filter((t) => t.bundleId === b.id)}
                  onEdit={() => setEditBundle({ bundle: b })} onSchedule={addToTimetable} onEditTodo={setEditTodo} />
              ))}
            </section>
          );
        })}

        <button type="button" className="btn dashed wide" onClick={() => setEditBundle({})}>
          <Icon name="plus" size={16} /> 묶음 · 카테고리 추가
        </button>
      </div>

      <BundleEdit open={!!editBundle} bundle={editBundle?.bundle} onClose={() => setEditBundle(null)} />
      <CategoryEdit category={editCat} onClose={() => setEditCat(null)} />
      <TodoEdit todo={editTodo} onClose={() => setEditTodo(null)} />
      <BlockSheet draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <section className="card compact">
      <span className="muted small">{title}</span>
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
    <section className="card compact" aria-labelledby="top3-title">
      <span className="muted small" id="top3-title">Top 3</span>
      <ol className="top3">
        {items.map((it, i) => (
          <li key={i} className={it.done ? 'done' : ''}>
            <Checkbox checked={it.done} number={i + 1} label={`Top 3 ${i + 1}번 완료`} onChange={(done) => update(i, { done })} />
            <input className="input bare" value={editing[i] ?? it.text} placeholder="오늘 가장 중요한 일"
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

function BundleCard({ bundle, todos, onEdit, onSchedule, onEditTodo }: {
  bundle: Bundle; todos: Todo[]; onEdit: () => void; onSchedule: (t: Todo) => void; onEditTodo: (t: Todo) => void;
}) {
  const [text, setText] = useState('');
  const col = colorOf(bundle.color);
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    setText(''); // Enter 직후 blur가 와도 두 번 추가되지 않게 먼저 비운다
    await put<Todo>('todos', {
      id: uid(), bundleId: bundle.id, title, done: false, order: todos.reduce((m, t) => Math.max(m, t.order + 1), 0),
    });
  };
  return (
    <div className="bundle-card">
      <button type="button" className="bundle-head" onClick={onEdit} aria-label={`${bundle.name} 묶음 편집`}>
        <span className="dot md" style={{ background: col.strong }} />
        <span className="bundle-name">{bundle.name}</span>
        <span className="muted small">
          {bundle.income ? `시급 ${bundle.wage.toLocaleString('ko-KR')}원` : `${todos.filter((t) => t.done).length}/${todos.length}`}
        </span>
      </button>
      <ul className="todo-list">
        {todos.map((t) => (
          <li key={t.id} className={'todo' + (t.done ? ' done' : '')}>
            <Checkbox checked={t.done} label={t.title} onChange={(done) => put<Todo>('todos', { ...t, done })} />
            <button type="button" className="todo-title" onClick={() => onEditTodo(t)}>{t.title}</button>
            {t.done ? <span className="todo-gap" /> : (
              <IconButton icon="clock" className="accent-text" label={`${t.title} 시간표에 추가`} onClick={() => onSchedule(t)} />
            )}
          </li>
        ))}
        <li className="todo add">
          <span className="todo-plus"><Icon name="plus" size={16} /></span>
          <input className="input bare" value={text} placeholder="할 일 추가" aria-label={`${bundle.name}에 할 일 추가`}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} />
        </li>
      </ul>
    </div>
  );
}

/** 할 일 이름 바꾸기 · 삭제 */
function TodoEdit({ todo, onClose }: { todo: Todo | null; onClose: () => void }) {
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(todo?.title ?? ''), [todo]);
  if (!todo) return null;
  return (
    <Sheet open onClose={onClose} title="할 일"
      footer={
        <>
          <button type="button" className="btn outline danger big del-btn" onClick={async () => { await remove('todos', todo.id); onClose(); }}>삭제</button>
          <button type="button" className="btn primary big grow" disabled={!title.trim()}
            onClick={async () => { await put<Todo>('todos', { ...todo, title: title.trim() }); onClose(); }}>저장</button>
        </>
      }>
      <Field label="이름">
        <input className="input" value={title} maxLength={60} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </Field>
    </Sheet>
  );
}
