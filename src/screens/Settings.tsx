import { useEffect, useState } from 'react';
import { AppTitle, Field, Row, Sheet, Switch } from '../components/ui';
import { saveSettings } from '../lib/data';
import { useApp } from '../lib/hooks';
import {
  authErrorMessage, linkedEmail, linkEmail, regenerateRecoveryCode, setPin, signOut,
} from '../lib/auth';
import { getSyncStatus, onSyncStatus, syncNow, type SyncStatus } from '../lib/sync';
import { remoteMode } from '../lib/supabase';
import { isPin } from '../lib/crypto';
import type { ScreenKey, Sections } from '../lib/types';

const SECTION_LABELS: [keyof Sections, string][] = [
  ['top3', 'Top 3'],
  ['summary', '집계시간 · Todo 진행'],
  ['stats', '통계 · 알바 수입'],
  ['ledger', '가계부'],
  ['dailyReview', 'Daily Review'],
  ['dday', 'D-Day'],
  ['goal', 'Goal'],
];

/** 표시할 섹션: 끄면 화면에서만 숨기고 데이터는 유지 */
export function SectionsList() {
  const { settings, session } = useApp();
  const set = (k: keyof Sections, v: boolean) =>
    saveSettings({ sections: { ...settings.sections, [k]: v } }, session.nickname);
  return (
    <div className="card list">
      {SECTION_LABELS.map(([k, label]) => (
        <Row key={k} label={label} sub={['dailyReview', 'dday', 'goal'].includes(k) ? '다음 버전 예정' : undefined}>
          <Switch checked={settings.sections[k]} onChange={(v) => set(k, v)} label={label} />
        </Row>
      ))}
    </div>
  );
}

export function SectionsScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="screen">
      <div className="screen-body">
        <div className="pane-head">
          <h2 className="pane-title">표시할 섹션</h2>
          <button type="button" className="btn primary small" onClick={onDone}>완료</button>
        </div>
        <p className="muted small">끄면 화면에서만 숨겨요. 데이터는 그대로 남아 있어요.</p>
        <SectionsList />
      </div>
    </div>
  );
}

const START_OPTIONS: { value: ScreenKey; label: string }[] = [
  { value: 'timetable', label: '시간표' },
  { value: 'todo', label: '할 일' },
  { value: 'stats', label: '통계' },
  { value: 'ledger', label: '가계부' },
];

const SYNC_LABEL: Record<SyncStatus, string> = {
  local: '이 기기에만 저장 중 (서버 미설정)',
  idle: '동기화됨',
  syncing: '동기화 중…',
  offline: '오프라인 · 연결되면 자동으로 동기화해요',
  error: '동기화 실패 · 잠시 후 다시 시도해요',
};

export function SettingsScreen({ embedded }: { embedded?: boolean }) {
  const { settings, session, setSession, toast } = useApp();
  const [name, setName] = useState(settings.displayName);
  const [sync, setSync] = useState(getSyncStatus());
  const [email, setEmail] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;

  useEffect(() => setName(settings.displayName), [settings.displayName]);
  useEffect(() => {
    const off = onSyncStatus(setSync);
    return () => { off(); };
  }, []);
  useEffect(() => {
    if (remoteMode) linkedEmail().then(setEmail);
  }, []);

  const saveName = () => {
    const n = name.trim();
    if (!n) return setName(settings.displayName);
    if (n !== settings.displayName) saveSettings({ displayName: n }, session.nickname);
  };

  const connectEmail = async () => {
    try {
      await linkEmail(emailInput.trim());
      toast('확인 메일을 보냈어요. 메일의 링크를 누르면 연결돼요.');
      setEmailInput('');
    } catch (e) {
      toast(authErrorMessage(e));
    }
  };

  const logout = async () => {
    if (!confirm(remoteMode ? '로그아웃할까요? 다시 로그인하면 서버에서 데이터를 불러와요.' : '로그아웃할까요? 데이터는 이 기기에 남아 있어요.')) return;
    await signOut();
    setSession(undefined);
  };

  return (
    <div className="screen">
      {!embedded && <AppTitle />}
      <div className="screen-body">
        {embedded ? <h2 className="pane-title">설정</h2> : <h2 className="section-title">설정</h2>}

        <h3 className="section-title">표시할 섹션</h3>
        <SectionsList />

        <h3 className="section-title">하루계획 열 때</h3>
        <div className="card list">
          <div className="radio-list" role="radiogroup" aria-label="시작 화면">
            {START_OPTIONS.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={settings.startScreen === o.value}
                className={'radio-row' + (settings.startScreen === o.value ? ' on' : '')}
                onClick={() => saveSettings({ startScreen: o.value }, session.nickname)}>
                <span className="radio-dot" />{o.label}
              </button>
            ))}
          </div>
        </div>

        <h3 className="section-title">계정</h3>
        <div className="card list">
          <Field label="표시 이름" hint={`화면 맨 위에 “${name.trim() || settings.displayName}의 비서”로 보여요. 로그인 닉네임은 ${session.nickname}이에요.`}>
            <input className="input" value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          </Field>
          <Row label="비밀번호 (숫자 4자리) 변경"><button type="button" className="btn soft small" onClick={() => setPinOpen(true)}>변경</button></Row>
          <Row label="복구 코드 확인" sub="비밀번호를 잊었을 때 필요해요">
            <button type="button" className="btn soft small" onClick={() => setCodeOpen(true)}>보기</button>
          </Row>
          {remoteMode ? (
            email ? (
              <Row label="이메일 연결됨" sub={email} />
            ) : (
              <Field label="이메일 연결 (선택)" hint="연결하면 비밀번호를 메일로 재설정할 수 있어요">
                <span className="input-row">
                  <input className="input" type="email" autoComplete="email" value={emailInput} placeholder="name@example.com"
                    onChange={(e) => setEmailInput(e.target.value)} />
                  <button type="button" className="btn primary small" disabled={!emailInput.includes('@')} onClick={connectEmail}>연결</button>
                </span>
              </Field>
            )
          ) : (
            <Row label="이메일 연결 (선택)" sub="서버가 연결된 경우에만 사용할 수 있어요" />
          )}
        </div>

        <h3 className="section-title">저장 · 동기화</h3>
        <div className="card list">
          <Row label="상태" sub={SYNC_LABEL[sync]}>
            {remoteMode && <button type="button" className="btn soft small" onClick={() => syncNow()}>지금 동기화</button>}
          </Row>
          {!standalone && (
            <Row label="홈 화면에 추가하기"
              sub="Safari 공유 버튼 → ‘홈 화면에 추가’. 오래 안 쓰면 Safari가 사이트 데이터를 지울 수 있어서 홈 화면 추가를 권장해요." />
          )}
        </div>

        <button type="button" className="btn danger-ghost wide" onClick={logout}>로그아웃</button>
        <p className="muted small center">Bisje · 변경 사항은 자동으로 저장돼요</p>
      </div>

      <PinSheet open={pinOpen} onClose={() => setPinOpen(false)} />
      <RecoveryCodeSheet open={codeOpen} onClose={() => setCodeOpen(false)} code={session.recoveryCode}
        onRegenerated={(recoveryCode) => setSession({ ...session, recoveryCode })} />
    </div>
  );
}

function PinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  useEffect(() => { setA(''); setB(''); }, [open]);
  const ok = isPin(a) && a === b;
  const save = async () => {
    try {
      await setPin(a);
      toast('비밀번호를 바꿨어요');
      onClose();
    } catch (e) {
      toast(authErrorMessage(e));
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="비밀번호 변경"
      footer={<button type="button" className="btn primary grow" disabled={!ok} onClick={save}>저장</button>}>
      <Field label="새 비밀번호 (숫자 4자리)"><PinInput value={a} onChange={setA} autoFocus /></Field>
      <Field label="한 번 더"><PinInput value={b} onChange={setB} /></Field>
      {b.length === 4 && a !== b && <p className="error">두 번 입력한 비밀번호가 달라요</p>}
    </Sheet>
  );
}

function RecoveryCodeSheet({ open, onClose, code, onRegenerated }: {
  open: boolean; onClose: () => void; code?: string; onRegenerated: (c: string) => void;
}) {
  const { toast } = useApp();
  const regen = async () => {
    if (!confirm('새 복구 코드를 만들면 이전 코드는 더 이상 쓸 수 없어요. 계속할까요?')) return;
    try {
      onRegenerated(await regenerateRecoveryCode());
    } catch (e) {
      toast(authErrorMessage(e));
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="복구 코드"
      footer={<button type="button" className="btn primary grow" onClick={onClose}>닫기</button>}>
      {code ? (
        <>
          <p className="recovery-code" aria-label={`복구 코드 ${code.split('').join(' ')}`}>{code}</p>
          <p className="muted small">캡처하거나 적어서 안전한 곳에 보관하세요. 비밀번호를 잊었을 때 이 코드로 재설정해요.</p>
        </>
      ) : (
        <p className="muted">이 기기에는 복구 코드가 저장되어 있지 않아요. 가입할 때 받은 코드를 쓰거나, 새로 만들 수 있어요.</p>
      )}
      <button type="button" className="btn soft wide" onClick={regen}>새 복구 코드 만들기</button>
    </Sheet>
  );
}

export function PinInput({ value, onChange, autoFocus, id }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; id?: string }) {
  return (
    <input id={id} className="input pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={4}
      autoFocus={autoFocus} value={value} placeholder="••••"
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))} />
  );
}
