import { useMemo, useState } from 'react';
import { AppTitle, Empty, ScreenHeading, Segmented } from '../components/ui';
import { useBlocksBetween, useBundles, useCategories, useToday } from '../lib/hooks';
import { colorOf } from '../lib/colors';
import {
  addDays, fmtMinutes, monthRange, nextPayday, parseYmd, settlementRange, weekday, weekRange, won,
} from '../lib/time';
import type { Block, Bundle } from '../lib/types';

type Period = 'week' | 'month';
const mins = (b: Block) => (b.end - b.start) * 10;
const minDate = (a: string, b: string) => (a < b ? a : b);
const maxDate = (a: string, b: string) => (a > b ? a : b);

export function StatsScreen({ embedded }: { embedded?: boolean }) {
  const today = useToday();
  const [period, setPeriod] = useState<Period>('month');
  const [catFilter, setCatFilter] = useState<string | 'all'>('all');
  const categories = useCategories();
  const bundles = useBundles();

  const [from, to] = period === 'week' ? weekRange(today) : monthRange(today);
  const incomeBundles = bundles.filter((b) => b.income);
  const settle = new Map(incomeBundles.map((b) => [b.id, settlementRange(today, b.settleStart)]));
  let qFrom = from;
  let qTo = to;
  for (const [s, e] of settle.values()) {
    qFrom = minDate(qFrom, s);
    qTo = maxDate(qTo, e);
  }
  const blocks = useBlocksBetween(qFrom, qTo);

  const inFilter = (b: Bundle | undefined) => !!b && (catFilter === 'all' || b.categoryId === catFilter);
  const bundleMap = useMemo(() => new Map(bundles.map((b) => [b.id, b])), [bundles]);
  const periodBlocks = blocks.filter((b) => b.date >= from && b.date <= to && inFilter(bundleMap.get(b.bundleId)));

  // 묶음별 합계 (DONE / PLAN)
  const totals = new Map<string, { done: number; plan: number }>();
  for (const b of periodBlocks) {
    const t = totals.get(b.bundleId) ?? { done: 0, plan: 0 };
    t[b.kind] += mins(b);
    totals.set(b.bundleId, t);
  }
  const maxTotal = Math.max(1, ...[...totals.values()].map((t) => Math.max(t.done, t.plan)));

  // 막대: 이번 주 = 요일별, 이번 달 = 주별 근무시간 (수입 계산 묶음)
  const workBlocks = periodBlocks.filter((b) => b.kind === 'done' && bundleMap.get(b.bundleId)?.income);
  const bars = period === 'week'
    ? Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      return { label: weekday(d), done: workBlocks.filter((b) => b.date === d).reduce((s, b) => s + mins(b), 0), current: d === today };
    })
    : monthWeeks(from, to).map(([s, e], i) => ({
      label: `${i + 1}주`,
      done: workBlocks.filter((b) => b.date >= s && b.date <= e).reduce((s2, b) => s2 + mins(b), 0),
      current: today >= s && today <= e,
    }));
  const maxBar = Math.max(60, ...bars.map((b) => b.done));
  const barTotal = bars.reduce((s, b) => s + b.done, 0);

  // 알바 수입 (현재 정산기간)
  const jobs = incomeBundles.filter(inFilter).map((b) => {
    const [s, e] = settle.get(b.id)!;
    const mine = blocks.filter((x) => x.bundleId === b.id && x.date >= s && x.date <= e);
    let doneMin = 0;
    let planMin = 0;
    for (const d of new Set(mine.map((x) => x.date))) {
      const day = mine.filter((x) => x.date === d);
      const dm = sum(day, 'done');
      const pm = sum(day, 'plan');
      doneMin += dm;
      planMin += d < today ? dm : Math.max(dm, pm);
    }
    return { b, s, e, doneMin, planMin, earned: (doneMin / 60) * b.wage, pay: nextPayday(today, b.payday) };
  });
  const earnedTotal = jobs.reduce((s, j) => s + j.earned, 0);
  const planMax = Math.max(1, ...jobs.map((j) => j.planMin));
  const [, m] = today.split('-').map(Number);

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        {!embedded && <ScreenHeading>통계</ScreenHeading>}
        <Segmented label="기간" value={period} onChange={setPeriod}
          options={[{ value: 'week', label: '이번 주' }, { value: 'month', label: '이번 달' }]} />
        <div className="chips scroll" role="group" aria-label="카테고리 필터">
          <button type="button" className={'chip lg' + (catFilter === 'all' ? ' on' : '')} aria-pressed={catFilter === 'all'}
            onClick={() => setCatFilter('all')}>전체</button>
          {categories.map((c) => (
            <button key={c.id} type="button" className={'chip lg' + (catFilter === c.id ? ' on' : '')} aria-pressed={catFilter === c.id}
              onClick={() => setCatFilter(c.id)}>{c.name}</button>
          ))}
        </div>

        {jobs.length > 0 && (
          <>
            <section className="hero" aria-label="알바로 지금까지 모인 돈">
              <span className="hero-label">알바로 지금까지 모인 돈</span>
              <strong className="hero-value">{won(earnedTotal)}</strong>
              <span className="hero-label">{jobs.map((j) => `${j.b.name} ${short(j.pay.date)}`).join(' · ')} 지급 예정</span>
            </section>
            {jobs.map((j) => {
              const c = colorOf(j.b.color);
              return (
                <section key={j.b.id} className="card job" aria-label={`${j.b.name} 수입`}>
                  <div className="job-head">
                    <span className="dot md" style={{ background: c.strong }} />
                    <strong>{j.b.name}</strong>
                    <span className="muted xsmall">시급 {j.b.wage.toLocaleString('ko-KR')}원</span>
                    <span className="spacer" />
                    <strong className="job-amount">{won(j.earned)}</strong>
                  </div>
                  <span className="muted small">월급날 {short(j.pay.date)} · {j.pay.dday === 0 ? 'D-Day' : `D-${j.pay.dday}`}</span>
                  <div className="stack-bar thin" role="img"
                    aria-label={`실제 ${fmtMinutes(j.doneMin)}, 계획 포함 ${fmtMinutes(j.planMin)}`}>
                    <span style={{ width: `${(j.doneMin / planMax) * 100}%`, background: c.dark }} />
                    <span style={{ width: `${((j.planMin - j.doneMin) / planMax) * 100}%`, background: c.light }} />
                  </div>
                  <div className="job-foot muted small">
                    <span>실제 {fmtMinutes(j.doneMin)}</span>
                    <span>계획 포함 {fmtMinutes(j.planMin)}</span>
                  </div>
                </section>
              );
            })}
          </>
        )}

        <section className="card" aria-labelledby="bar-title">
          <div className="card-head">
            <h3 className="card-title small-title" id="bar-title">{period === 'week' ? '이번 주 요일별 근무시간' : `${m}월 주별 근무시간`}</h3>
            <span className="muted small">총 {fmtMinutes(barTotal)}</span>
          </div>
          <div className="vbars" role="img" aria-label={bars.map((b) => `${b.label} ${fmtMinutes(b.done)}`).join(', ')}>
            {bars.map((b) => (
              <div key={b.label} className={'vbar' + (b.current ? ' current' : '')}>
                <span className="vbar-value">{b.done ? `${+(b.done / 60).toFixed(1)}h` : ''}</span>
                <div className="vbar-track"><span style={{ height: `${(b.done / maxBar) * 100}%` }} /></div>
                <span className="vbar-label">{b.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="sum-title">
          <div className="card-head">
            <h3 className="card-title small-title" id="sum-title">{period === 'week' ? '이번 주' : '이번 달'} 묶음별 시간</h3>
            <span className="muted small">실제 / 계획</span>
          </div>
          {totals.size === 0 && <Empty>아직 기록이 없어요. 시간표에서 DONE을 칠해 보세요.</Empty>}
          {categories.filter((c) => catFilter === 'all' || c.id === catFilter).map((c) => {
            const bs = bundles.filter((b) => b.categoryId === c.id && totals.has(b.id));
            if (!bs.length) return null;
            const catDone = bs.reduce((s, b) => s + totals.get(b.id)!.done, 0);
            return (
              <div key={c.id} className="sum-group">
                <div className="sum-cat"><span>{c.name}</span><span>{fmtMinutes(catDone)}</span></div>
                {bs.map((b) => {
                  const t = totals.get(b.id)!;
                  const col = colorOf(b.color);
                  return (
                    <div key={b.id} className="hbar-row">
                      <span className="hbar-name">{b.name}</span>
                      <div className="stack-bar thin" aria-hidden="true">
                        <span style={{ width: `${(t.done / maxTotal) * 100}%`, background: col.dark }} />
                        <span style={{ width: `${(Math.max(0, t.plan - t.done) / maxTotal) * 100}%`, background: col.light }} />
                      </div>
                      <span className="hbar-val">{fmtMinutes(t.done)}<span className="muted"> / {fmtMinutes(t.plan)}</span></span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
      </div>
    </div>
  );
}

const sum = (list: Block[], kind: Block['kind']) => list.filter((b) => b.kind === kind).reduce((s, b) => s + mins(b), 0);
const short = (s: string) => {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

/** 월을 월요일 시작 주로 자른 구간 목록 */
function monthWeeks(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  let s = from;
  while (s <= to) {
    const [, we] = weekRange(s);
    const e = we < to ? we : to;
    out.push([s, e]);
    s = addDays(e, 1);
  }
  return out;
}
