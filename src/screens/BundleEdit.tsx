import { useEffect, useState } from 'react';
import { ColorPicker, Field, Row, Sheet, Switch } from '../components/ui';
import { Icon } from '../components/Icon';
import { put, remove, uid } from '../lib/data';
import { db } from '../lib/db';
import { useBundles, useCategories } from '../lib/hooks';
import type { Bundle, Category, ColorKey } from '../lib/types';

const NEW_CAT = '__new__';

/** 묶음 편집 화면 (이름, 큰 카테고리, 색, 수입 계산, 시급, 월급날, 정산기간, 삭제) */
export function BundleEdit({ open, bundle, presetCategoryId, onClose }: {
  open: boolean; bundle?: Bundle; presetCategoryId?: string; onClose: () => void;
}) {
  const categories = useCategories();
  const bundles = useBundles();
  const [b, setB] = useState<Bundle | null>(null);
  const [newCat, setNewCat] = useState({ name: '', color: 'blue' as ColorKey });

  useEffect(() => {
    if (!open) return;
    setB(bundle ?? {
      id: uid(), categoryId: presetCategoryId ?? categories[0]?.id ?? NEW_CAT, name: '', color: 'blue', order: 0,
      income: false, wage: 10030, payday: 10, settleStart: 1, updatedAt: 0,
    });
    setNewCat({ name: '', color: 'blue' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, bundle]);

  if (!open || !b) return null;
  const isNew = !bundle;
  const siblings = bundles.filter((x) => x.categoryId === b.categoryId && x.id !== b.id);
  const set = (c: Partial<Bundle>) => setB({ ...b, ...c });
  const valid = b.name.trim() && (b.categoryId !== NEW_CAT || newCat.name.trim());

  const save = async () => {
    if (!valid) return;
    let categoryId = b.categoryId;
    if (categoryId === NEW_CAT) {
      const cat = await put<Category>('categories', {
        id: uid(), name: newCat.name.trim(), color: newCat.color,
        order: categories.reduce((m, c) => Math.max(m, c.order + 1), 0),
      });
      categoryId = cat.id;
    }
    const moved = bundle && bundle.categoryId !== categoryId;
    const order = isNew || moved ? bundles.filter((x) => x.categoryId === categoryId).reduce((m, x) => Math.max(m, x.order + 1), 0) : b.order;
    await put<Bundle>('bundles', {
      ...b, categoryId, order, name: b.name.trim(),
      wage: Math.max(0, Math.round(b.wage || 0)),
      payday: clampDay(b.payday), settleStart: clampDay(b.settleStart),
    });
    onClose();
  };

  const move = async (dir: -1 | 1) => {
    const list = bundles.filter((x) => x.categoryId === b.categoryId);
    const i = list.findIndex((x) => x.id === b.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    const other = list[j];
    await put<Bundle>('bundles', { ...other, order: list[i].order });
    await put<Bundle>('bundles', { ...list[i], order: other.order });
    setB({ ...b, order: other.order });
  };

  const del = async () => {
    if (!bundle) return;
    const todos = await db.todos.where('bundleId').equals(bundle.id).toArray();
    if (!confirm(`'${bundle.name}' 묶음과 할 일 ${todos.filter((t) => !t.deleted).length}개를 삭제할까요?\n시간표 기록은 남아요.`)) return;
    for (const t of todos) await remove('todos', t.id);
    await remove('bundles', bundle.id);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={isNew ? '묶음 · 카테고리 추가' : '묶음 편집'} tall
      footer={
        <>
          {!isNew && <button type="button" className="btn danger-ghost" onClick={del}><Icon name="trash" size={18} /> 삭제</button>}
          <button type="button" className="btn primary grow" disabled={!valid} onClick={save}>저장</button>
        </>
      }>
      <Field label="묶음 이름">
        <input className="input" value={b.name} placeholder="예: 수학, 카페" maxLength={30}
          onChange={(e) => set({ name: e.target.value })} />
      </Field>

      <div className="field">
        <span className="field-label">큰 카테고리</span>
        <div className="chips">
          {categories.map((c) => (
            <button key={c.id} type="button" className={'chip' + (b.categoryId === c.id ? ' on' : '')}
              aria-pressed={b.categoryId === c.id} onClick={() => set({ categoryId: c.id })}>{c.name}</button>
          ))}
          <button type="button" className={'chip dashed' + (b.categoryId === NEW_CAT ? ' on' : '')}
            aria-pressed={b.categoryId === NEW_CAT} onClick={() => set({ categoryId: NEW_CAT })}>
            <Icon name="plus" size={14} /> 새 카테고리
          </button>
        </div>
        {b.categoryId === NEW_CAT && (
          <div className="subcard">
            <input className="input" value={newCat.name} placeholder="새 카테고리 이름 (예: 공부)" maxLength={20}
              aria-label="새 카테고리 이름" onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} />
            <ColorPicker value={newCat.color} onChange={(color) => setNewCat({ ...newCat, color })} />
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">색</span>
        <ColorPicker value={b.color} onChange={(color) => set({ color })} />
      </div>

      <div className="card flat">
        <Row label="수입 계산" sub="알바처럼 근무시간 × 시급으로 수입을 계산해요">
          <Switch checked={b.income} onChange={(income) => set({ income })} label="수입 계산" />
        </Row>
        {b.income && (
          <>
            <Row label="시급">
              <span className="input-suffix">
                <input className="input num" inputMode="numeric" value={b.wage || ''} aria-label="시급 (원)"
                  onChange={(e) => set({ wage: Number(e.target.value.replace(/\D/g, '')) })} />원
              </span>
            </Row>
            <Row label="월급날">
              <span className="input-suffix">매달
                <input className="input num short" inputMode="numeric" value={b.payday || ''} aria-label="월급날 (일)"
                  onChange={(e) => set({ payday: Number(e.target.value.replace(/\D/g, '')) })} />일
              </span>
            </Row>
            <Row label="정산기간" sub={`매달 ${clampDay(b.settleStart)}일 ~ ${clampDay(b.settleStart) === 1 ? '말일' : `다음 달 ${clampDay(b.settleStart) - 1}일`}`}>
              <span className="input-suffix">매달
                <input className="input num short" inputMode="numeric" value={b.settleStart || ''} aria-label="정산 시작일"
                  onChange={(e) => set({ settleStart: Number(e.target.value.replace(/\D/g, '')) })} />일부터
              </span>
            </Row>
          </>
        )}
      </div>

      {!isNew && siblings.length > 0 && (
        <div className="field">
          <span className="field-label">순서</span>
          <div className="btn-row">
            <button type="button" className="btn soft" onClick={() => move(-1)}><Icon name="up" size={18} /> 위로</button>
            <button type="button" className="btn soft" onClick={() => move(1)}><Icon name="down" size={18} /> 아래로</button>
          </div>
        </div>
      )}
      <p className="muted small">집계시간에 넣을지는 시간표의 ‘집계 항목 선택’에서 정해요.</p>
    </Sheet>
  );
}

const clampDay = (n: number) => Math.min(31, Math.max(1, Math.round(n || 1)));

/** 큰 카테고리 편집: 이름, 색, 순서, 삭제 */
export function CategoryEdit({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const categories = useCategories();
  const [c, setC] = useState<Category | null>(category);
  useEffect(() => setC(category), [category]);
  if (!c || !category) return null;

  const save = async () => {
    if (!c.name.trim()) return;
    await put<Category>('categories', { ...c, name: c.name.trim() });
    onClose();
  };
  const move = async (dir: -1 | 1) => {
    const i = categories.findIndex((x) => x.id === c.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= categories.length) return;
    const other = categories[j];
    await put<Category>('categories', { ...other, order: categories[i].order });
    await put<Category>('categories', { ...categories[i], name: c.name, color: c.color, order: other.order });
    setC({ ...c, order: other.order });
  };
  const del = async () => {
    const bs = (await db.bundles.where('categoryId').equals(c.id).toArray()).filter((b) => !b.deleted);
    if (!confirm(`'${category.name}' 카테고리와 묶음 ${bs.length}개, 그 안의 할 일을 삭제할까요?\n시간표 기록은 남아요.`)) return;
    for (const b of bs) {
      for (const t of await db.todos.where('bundleId').equals(b.id).toArray()) await remove('todos', t.id);
      await remove('bundles', b.id);
    }
    await remove('categories', c.id);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title="카테고리 편집"
      footer={
        <>
          <button type="button" className="btn danger-ghost" onClick={del}><Icon name="trash" size={18} /> 삭제</button>
          <button type="button" className="btn primary grow" disabled={!c.name.trim()} onClick={save}>저장</button>
        </>
      }>
      <Field label="이름">
        <input className="input" value={c.name} maxLength={20} onChange={(e) => setC({ ...c, name: e.target.value })} />
      </Field>
      <div className="field">
        <span className="field-label">색</span>
        <ColorPicker value={c.color} onChange={(color) => setC({ ...c, color })} />
      </div>
      <div className="field">
        <span className="field-label">순서</span>
        <div className="btn-row">
          <button type="button" className="btn soft" onClick={() => move(-1)}><Icon name="up" size={18} /> 위로</button>
          <button type="button" className="btn soft" onClick={() => move(1)}><Icon name="down" size={18} /> 아래로</button>
        </div>
      </div>
    </Sheet>
  );
}
