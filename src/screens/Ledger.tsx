import { useEffect, useState } from 'react';
import { AppTitle, Empty, Field, IconButton, Sheet } from '../components/ui';
import { Icon } from '../components/Icon';
import { put, remove, saveSettings, uid } from '../lib/data';
import { useApp, useExpenseCategories, useExpensesBetween, useLocalPref, usePaymentMethods } from '../lib/hooks';
import { addMonths, fmtDateLong, ymd, won } from '../lib/time';
import type { Expense, ExpenseCategory, PaymentMethod } from '../lib/types';

const MASK = '••••';
const NEW_CAT_COLORS = ['#B4A8EC', '#9DD0EA', '#7ACB98', '#E8A16A', '#EBA2B9', '#F2DC7A'];

export function LedgerScreen({ embedded }: { embedded?: boolean }) {
  const { settings, session } = useApp();
  const [month, setMonth] = useState(() => ymd(new Date()).slice(0, 7));
  const [hidden, setHidden] = useLocalPref('bisje.hideAmounts', false);
  const [search, setSearch] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Expense> | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const cats = useExpenseCategories();
  const methods = usePaymentMethods();
  const list = useExpensesBetween(`${month}-01`, `${month}-31`);

  const filtered = search ? list.filter((e) => e.date === search) : list;
  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const m = (n: number) => (hidden ? MASK : won(n));

  const byCat = cats.map((c) => ({ c, amount: filtered.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0) }))
    .filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
  const uncategorized = filtered.filter((e) => !cats.some((c) => c.id === e.categoryId)).reduce((s, e) => s + e.amount, 0);
  const byMethod = methods.map((pm) => ({ pm, amount: filtered.filter((e) => e.methodId === pm.id).reduce((s, e) => s + e.amount, 0) }))
    .filter((x) => x.amount > 0);
  const days = [...new Set(filtered.map((e) => e.date))].sort().reverse();
  const [y, mo] = month.split('-').map(Number);

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        {embedded && <h2 className="pane-title">가계부</h2>}
        <div className="date-nav">
          <IconButton icon="left" label="이전 달" onClick={() => { setMonth(addMonths(month, -1)); setSearch(null); }} />
          <span className="date-label">{y}년 {mo}월</span>
          <IconButton icon="right" label="다음 달" onClick={() => { setMonth(addMonths(month, 1)); setSearch(null); }} />
          <span className="spacer" />
          <IconButton icon="search" label="날짜 검색" pressed={search !== null}
            onClick={() => setSearch(search === null ? ymd(new Date()) : null)} />
          {!embedded && (
            <IconButton icon={hidden ? 'eyeOff' : 'eye'} label={hidden ? '금액 보이기' : '금액 가리기'} pressed={hidden}
              onClick={() => setHidden(!hidden)} />
          )}
          <IconButton icon="plus" className="accent" label="지출 추가"
            onClick={() => setEdit({ date: search ?? ymd(new Date()) })} />
        </div>

        {search !== null && (
          <div className="search-bar">
            <label className="sr-only" htmlFor="ledger-date">검색할 날짜</label>
            <input id="ledger-date" type="date" className="input" value={search}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setSearch(v);
                setMonth(v.slice(0, 7));
              }} />
            <button type="button" className="btn ghost small" onClick={() => setSearch(null)}>전체 보기</button>
          </div>
        )}

        <section className="card" aria-label="지출 합계">
          <span className="muted small">{search ? fmtDateLong(search) : '이번 달'} 총 지출</span>
          <div className="total-line">
            <strong className="money">{m(total)}</strong>
            {!search && settings.budget > 0 && <span className="budget">/ {m(settings.budget)}</span>}
            <IconButton icon="pencil" label="월 예산 수정" className="faint" onClick={() => setBudgetOpen(true)} />
          </div>
          {total > 0 && (
            <>
              <div className="stack-bar" role="img" aria-label={byCat.map((x) => `${x.c.name} ${hidden ? '' : won(x.amount)}`).join(', ')}>
                {byCat.map((x) => <span key={x.c.id} style={{ width: `${(x.amount / total) * 100}%`, background: x.c.color }} />)}
                {uncategorized > 0 && <span style={{ width: `${(uncategorized / total) * 100}%`, background: '#DCDCE0' }} />}
              </div>
              <ul className="cat-sums">
                {byCat.map((x) => (
                  <li key={x.c.id}>
                    <span className="dot" style={{ background: x.c.color }} />
                    <span>{x.c.name}</span>
                    <span className="spacer" />
                    <span className="muted small">{Math.round((x.amount / total) * 100)}%</span>
                    <strong>{m(x.amount)}</strong>
                  </li>
                ))}
              </ul>
              <div className="chips">
                {byMethod.map((x) => <span key={x.pm.id} className="chip static">{x.pm.name} {m(x.amount)}</span>)}
              </div>
            </>
          )}
        </section>

        {days.length === 0 && <Empty>{search ? '이 날짜의 지출이 없어요.' : '이번 달 지출이 아직 없어요. + 를 눌러 추가해 보세요.'}</Empty>}
        {days.map((d) => {
          const items = filtered.filter((e) => e.date === d).sort((a, b) => b.updatedAt - a.updatedAt);
          return (
            <section key={d} className="card day-card" aria-label={fmtDateLong(d)}>
              <div className="card-head">
                <h3 className="card-title">{fmtDateLong(d)}</h3>
                <strong>{m(items.reduce((s, e) => s + e.amount, 0))}</strong>
              </div>
              <ul className="expense-list">
                {items.map((e) => {
                  const c = cats.find((x) => x.id === e.categoryId);
                  const pm = methods.find((x) => x.id === e.methodId);
                  return (
                    <li key={e.id}>
                      <button type="button" className="expense" onClick={() => setEdit(e)}>
                        <span className="dot" style={{ background: c?.color ?? '#DCDCE0' }} />
                        <span className="expense-text">
                          <span className="expense-name">{e.name}</span>
                          <span className="muted small">{c?.name ?? '미분류'} · {pm?.name ?? '-'}</span>
                        </span>
                        <strong>{m(e.amount)}</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <ExpenseSheet value={edit} onClose={() => setEdit(null)} cats={cats} methods={methods} />
      <BudgetSheet open={budgetOpen} value={settings.budget} onClose={() => setBudgetOpen(false)}
        onSave={(budget) => saveSettings({ budget }, session.nickname)} />
    </div>
  );
}

function ExpenseSheet({ value, onClose, cats, methods }: {
  value: Partial<Expense> | null; onClose: () => void; cats: ExpenseCategory[]; methods: PaymentMethod[];
}) {
  const [e, setE] = useState<Partial<Expense>>({});
  const [adding, setAdding] = useState<'cat' | 'method' | null>(null);
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (value) setE({ categoryId: cats[0]?.id, methodId: methods[0]?.id, ...value });
    setAdding(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  if (!value) return null;
  const editing = !!value.id;
  const valid = !!e.name?.trim() && (e.amount ?? 0) > 0 && !!e.date;

  const save = async () => {
    if (!valid) return;
    await put<Expense>('expenses', {
      id: e.id ?? uid(), date: e.date!, name: e.name!.trim(), amount: Math.round(e.amount!),
      categoryId: e.categoryId ?? '', methodId: e.methodId ?? '',
    });
    onClose();
  };
  const addOption = async () => {
    const name = newName.trim();
    if (!name) return;
    if (adding === 'cat') {
      const c = await put<ExpenseCategory>('expenseCategories', {
        id: uid(), name, color: NEW_CAT_COLORS[cats.length % NEW_CAT_COLORS.length], order: cats.length,
      });
      setE({ ...e, categoryId: c.id });
    } else {
      const pm = await put<PaymentMethod>('paymentMethods', { id: uid(), name, order: methods.length });
      setE({ ...e, methodId: pm.id });
    }
    setNewName('');
    setAdding(null);
  };

  return (
    <Sheet open onClose={onClose} title={editing ? '지출 수정' : '지출 추가'} tall
      footer={
        <>
          {editing && (
            <button type="button" className="btn danger-ghost" onClick={async () => { await remove('expenses', e.id!); onClose(); }}>
              <Icon name="trash" size={18} /> 삭제
            </button>
          )}
          <button type="button" className="btn primary grow" disabled={!valid} onClick={save}>저장</button>
        </>
      }>
      <Field label="날짜">
        <input type="date" className="input" value={e.date ?? ''} onChange={(ev) => setE({ ...e, date: ev.target.value })} />
      </Field>
      <Field label="항목">
        <input className="input" value={e.name ?? ''} placeholder="예: 점심, 버스" maxLength={40}
          onChange={(ev) => setE({ ...e, name: ev.target.value })} />
      </Field>
      <Field label="금액">
        <span className="input-suffix wide">₩
          <input className="input num" inputMode="numeric" value={e.amount ? e.amount.toLocaleString('ko-KR') : ''} placeholder="0"
            onChange={(ev) => setE({ ...e, amount: Number(ev.target.value.replace(/\D/g, '')) })} />
        </span>
      </Field>
      <div className="field">
        <span className="field-label">카테고리</span>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} type="button" className={'chip' + (e.categoryId === c.id ? ' on' : '')} aria-pressed={e.categoryId === c.id}
              onClick={() => setE({ ...e, categoryId: c.id })}>
              <span className="dot" style={{ background: c.color }} />{c.name}
            </button>
          ))}
          <button type="button" className="chip dashed" onClick={() => setAdding('cat')}><Icon name="plus" size={14} /> 추가</button>
        </div>
      </div>
      <div className="field">
        <span className="field-label">결제수단</span>
        <div className="chips">
          {methods.map((pm) => (
            <button key={pm.id} type="button" className={'chip' + (e.methodId === pm.id ? ' on' : '')} aria-pressed={e.methodId === pm.id}
              onClick={() => setE({ ...e, methodId: pm.id })}>{pm.name}</button>
          ))}
          <button type="button" className="chip dashed" onClick={() => setAdding('method')}><Icon name="plus" size={14} /> 추가</button>
        </div>
      </div>
      {adding && (
        <div className="subcard inline">
          <input className="input" autoFocus value={newName} maxLength={20}
            placeholder={adding === 'cat' ? '새 지출 카테고리' : '새 결제수단 (예: 체크카드)'}
            aria-label={adding === 'cat' ? '새 지출 카테고리 이름' : '새 결제수단 이름'}
            onChange={(ev) => setNewName(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && addOption()} />
          <button type="button" className="btn primary small" onClick={addOption}>추가</button>
        </div>
      )}
    </Sheet>
  );
}

function BudgetSheet({ open, value, onClose, onSave }: { open: boolean; value: number; onClose: () => void; onSave: (n: number) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value, open]);
  return (
    <Sheet open={open} onClose={onClose} title="월 예산"
      footer={<button type="button" className="btn primary grow" onClick={() => { onSave(v); onClose(); }}>저장</button>}>
      <Field label="한 달 예산" hint="0으로 두면 표시하지 않아요">
        <span className="input-suffix wide">₩
          <input className="input num" inputMode="numeric" autoFocus value={v ? v.toLocaleString('ko-KR') : ''} placeholder="0"
            onChange={(e) => setV(Number(e.target.value.replace(/\D/g, '')))} />
        </span>
      </Field>
    </Sheet>
  );
}
