import { useMemo, useState } from 'react';
import { AppTitle, Empty, Segmented } from '../components/ui';
import { useApp, useBlocksBetween, useBundles, useCategories, useToday } from '../lib/hooks';
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
  const { settings } = useApp();
  const today = useToday();
  const [period, setPeriod] = useState<Period>('week');
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
  const totalDone = [...totals.values()].reduce((s, t) => s + t.done, 0);

  // 막대: 주 = 요일별, 월 = 주별 근무시간(수입 묶음)
  const bars = period === 'week'
    ? Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i);
      const day = periodBlocks.filter((b) => b.date === d);
      return { label: weekday(d), done: sum(day, 'done'), plan: sum(day, 'plan'), current: d === today };
    })
    : monthWeeks(from, to).map(([s, e], i) => {
      const wk = periodBlocks.filter((b) => b.date >= s && b.date <= e && bundleMap.get(b.bundleId)?.income);
      return { label: `${i + 1}주`, done: sum(wk, 'done'), plan: sum(wk, 'plan'), current: today >= s && today <= e };
    });
  const maxBar = Math.max(60, ...bars.map((b) => Math.max(b.done, b.plan)));

  // 알바 수입 (현재 정산기간)
  const jobs = incomeBundles.filter(inFilter).map((b) => {
    const [s, e] = settle.get(b.id)!;
    const mine = blocks.filter((x) => x.bundleId === b.id && x.date >= s && x.date <= e);
    let doneMin = 0;
    let planMin = 0;
    const days = new Set(mine.map((x) => x.date));
    for (const d of days) {
      const day = mine.filter((x) => x.date === d);
      const dm = sum(day, 'done');
      const pm = sum(day, 'plan');
      doneMin += dm;
      planMin += d < today ? dm : Math.max(dm, pm);
    }
    return { b, s, e, doneMin, planMin, earned: (doneMin / 60) * b.wage, expected: (planMin / 60) * b.wage, pay: nextPayday(today, b.payday) };
  });
  const earnedTotal = jobs.reduce((s, j) => s + j.earned, 0);
  const expectedMax = Math.max(1, ...jobs.map((j) => j.expected));

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        {embedded && <h2 className="pane-title">통계</h2>}
        <div className="stats-controls">
          <Segmented label="기간" value={period} onChange={setPeriod}
            options={[{ value: 'week', label: '이번 주' }, { value: 'month', label: '이번 달' }]} />
          <div className="chips scroll" role="group" aria-label="카테고리 필터">
            <button type="button" className={'chip' + (catFilter === 'all' ? ' on' : '')} aria-pressed={catFilter === 'all'}
              onClick={() => setCatFilter('all')}>전체</button>
            {categories.map((c) => (
              <button key={c.id} type="button" className={'chip' + (catFilter === c.id ? ' on' : '')} aria-pressed={catFilter === c.id}
                onClick={() => setCatFilter(c.id)}>
                <span className="dot" style={{ background: colorOf(c.color).strong }} />{c.name}
              </button>
            ))}
          </div>
        </div>

        {jobs.length > 0 && (
          <section className="card" aria-labelledby="job-title">
            <h3 className="card-title" id="job-title">알바로 지금까지 모인 돈</h3>
            <p className="money">{won(earnedTotal)}</p>
            <p className="muted small">현재 정산기간 · DONE 기준 (주휴수당·세금 제외)</p>
            <ul className="job-list">
              {jobs.map((j) => (
                <li key={j.b.id}>
                  <div className="job-head">
                    <span className="dot" style={{ background: colorOf(j.b.color).strong }} />
                    <strong>{j.b.name}</strong>
                    <span className="tag accent">월급날 {j.pay.dday === 0 ? 'D-Day' : `D-${j.pay.dday}`}</span>
                    <span className="spacer" />
                    <strong>{won(j.earned)}</strong>
                  </div>
                  <div className="dual-bar" aria-hidden="true">
                    <span className="plan" style={{ width: `${(j.expected / expectedMax) * 100}%` }} />
                    <span className="done" style={{ width: `${(j.earned / expectedMax) * 100}%`, background: colorOf(j.b.color).strong }} />
                  </div>
                  <p className="muted small">
                    실제 {fmtMinutes(j.doneMin)} · 계획 포함 {fmtMinutes(j.planMin)} → 예상 {won(j.expected)}
                    <br />정산 {short(j.s)} ~ {short(j.e)} · 시급 {won(j.b.wage)} · 지급 {short(j.pay.date)}
                  </p>
                </li>
              ))}
            </ul>
            <Legend />
          </section>
        )}

        <section className="card" aria-labelledby="bar-title">
          <div className="card-head">
            <h3 className="card-title" id="bar-title">{period === 'week' ? '요일별 시간' : '주별 근무시간'}</h3>
            <span className="muted small">{period === 'week' ? `${short(from)} ~ ${short(to)}` : '수입 계산 묶음'}</span>
          </div>
          <div className="vbars" role="img"
            aria-label={bars.map((b) => `${b.label} 실제 ${fmtMinutes(b.done)}, 계획 ${fmtMinutes(b.plan)}`).join('. ')}>
            {bars.map((b) => (
              <div key={b.label} className={'vbar' + (b.current ? ' current' : '')}>
                <span className="vbar-value">{b.done ? (b.done / 60).toFixed(1) : ''}</span>
                <div className="vbar-track">
                  <span className="plan" style={{ height: `${(b.plan / maxBar) * 100}%` }} />
                  <span className="done" style={{ height: `${(b.done / maxBar) * 100}%` }} />
                </div>
                <span className="vbar-label">{b.label}</span>
              </div>
            ))}
          </div>
          <Legend />
        </section>

        <section className="card" aria-labelledby="sum-title">
          <div className="card-head">
            <h3 className="card-title" id="sum-title">{period === 'week' ? '이번 주' : '이번 달'} 합계</h3>
            <strong>{fmtMinutes(totalDone)}</strong>
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
                  return (
                    <div key={b.id} className="hbar-row">
                      <span className="hbar-name">{b.name}</span>
                      <div className="dual-bar" aria-hidden="true">
                        <span className="plan" style={{ width: `${(t.plan / maxTotal) * 100}%` }} />
                        <span className="done" style={{ width: `${(t.done / maxTotal) * 100}%`, background: colorOf(b.color).strong }} />
                      </div>
                      <span className="hbar-val">{fmtMinutes(t.done)}<span className="muted"> / {fmtMinutes(t.plan)}</span></span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </section>
        {!settings.sections.stats && <p className="muted small">통계 섹션은 설정에서 숨김 상태예요.</p>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="sw done" /> 실제 (DONE)</span>
      <span><i className="sw plan" /> 계획 (PLAN) 포함</span>
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
