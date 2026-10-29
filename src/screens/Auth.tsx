import { useState, type FormEvent } from 'react';
import { Field, Segmented, TitleBar } from '../components/ui';
import { PinInput } from './Settings';
import {
  authErrorMessage, requestEmailReset, resetWithCode, setPin, signIn, signUp, type SessionInfo,
} from '../lib/auth';
import { isPin } from '../lib/crypto';

/** public/icon.svg와 같은 그림 (파일 경로 없이도 보이도록 인라인) */
function AppIcon() {
  return (
    <svg width={64} height={64} viewBox="0 0 512 512" aria-hidden="true" className="app-icon">
      <rect width="512" height="512" fill="#4B55D6" />
      <rect x="96" y="104" width="320" height="304" rx="44" fill="#FFFFFF" />
      <rect x="136" y="150" width="140" height="40" rx="12" fill="#F2DC7A" />
      <rect x="136" y="214" width="240" height="40" rx="12" fill="#9DD0EA" />
      <rect x="216" y="278" width="160" height="40" rx="12" fill="#7ACB98" />
      <rect x="136" y="342" width="90" height="24" rx="10" fill="#EEF0FF" />
      <circle cx="352" cy="170" r="18" fill="#F5C84B" />
    </svg>
  );
}
import { remoteMode } from '../lib/supabase';

type Mode = 'login' | 'signup' | 'reset';

export function AuthScreen({ onAuthed }: { onAuthed: (s: SessionInfo, isNew: boolean) => Promise<void> }) {
  const [mode, setMode] = useState<Mode>('login');
  const [nickname, setNickname] = useState('');
  const [pin, setPinV] = useState('');
  const [pin2, setPin2] = useState('');
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setErr('');
    setInfo('');
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'login') run(async () => onAuthed(await signIn(nickname, pin), false));
    if (mode === 'signup') {
      if (pin !== pin2) return setErr('두 번 입력한 비밀번호가 달라요');
      run(async () => onAuthed(await signUp(nickname, pin), true));
    }
    if (mode === 'reset') {
      if (pin !== pin2) return setErr('두 번 입력한 비밀번호가 달라요');
      run(async () => onAuthed(await resetWithCode(nickname, code, pin), true));
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setErr('');
    setInfo('');
    setPinV('');
    setPin2('');
  };

  const valid = nickname.trim() && isPin(pin) && (mode === 'login' || isPin(pin2)) && (mode !== 'reset' || code.trim());

  return (
    <div className="screen auth">
      <TitleBar name={nickname.trim() || '나'} />
      <div className="screen-body narrow">
        <div className="auth-hero">
          <AppIcon />
          <p className="muted">닉네임과 숫자 4자리로 시작해요</p>
        </div>
        {mode !== 'reset' && (
          <Segmented label="로그인 또는 가입" value={mode} onChange={switchTo}
            options={[{ value: 'login', label: '로그인' }, { value: 'signup', label: '처음이에요' }]} />
        )}
        {mode === 'reset' && <h2 className="section-title">비밀번호 재설정</h2>}

        <form className="card list" onSubmit={submit}>
          <Field label="닉네임" hint={mode === 'signup' ? '로그인 ID로 쓰여요. 다른 사람과 겹칠 수 없어요.' : undefined}>
            <input className="input" value={nickname} maxLength={20} autoComplete="username" autoCapitalize="off"
              onChange={(e) => setNickname(e.target.value)} autoFocus />
          </Field>
          {mode === 'reset' && (
            <Field label="복구 코드" hint="가입할 때 받은 XXXX-XXXX-XXXX 코드">
              <input className="input mono" value={code} autoCapitalize="characters" autoComplete="off"
                onChange={(e) => setCode(e.target.value)} />
            </Field>
          )}
          <Field label={mode === 'reset' ? '새 비밀번호 (숫자 4자리)' : '비밀번호 (숫자 4자리)'}>
            <PinInput value={pin} onChange={setPinV} />
          </Field>
          {mode !== 'login' && (
            <Field label="비밀번호 한 번 더"><PinInput value={pin2} onChange={setPin2} /></Field>
          )}
          {err && <p className="error" role="alert">{err}</p>}
          <button type="submit" className="btn primary wide" disabled={!valid || busy}>
            {busy ? '잠시만요…' : mode === 'login' ? '로그인' : mode === 'signup' ? '시작하기' : '재설정하고 로그인'}
          </button>
        </form>

        {mode === 'login' && (
          <button type="button" className="btn ghost wide" onClick={() => switchTo('reset')}>비밀번호를 잊었어요</button>
        )}
        {mode === 'reset' && (
          <>
            {remoteMode && (
              <div className="card list">
                <Field label="이메일을 연결했다면" hint="메일로 재설정 링크를 보내요">
                  <span className="input-row">
                    <input className="input" type="email" value={email} placeholder="name@example.com" onChange={(e) => setEmail(e.target.value)} />
                    <button type="button" className="btn soft small" disabled={!email.includes('@') || busy}
                      onClick={() => run(async () => { await requestEmailReset(email.trim()); setInfo('메일을 보냈어요. 링크를 눌러 새 비밀번호를 정하세요.'); })}>
                      보내기
                    </button>
                  </span>
                </Field>
                {info && <p className="ok" role="status">{info}</p>}
              </div>
            )}
            <button type="button" className="btn ghost wide" onClick={() => switchTo('login')}>로그인으로 돌아가기</button>
          </>
        )}
        {!remoteMode && (
          <p className="muted small center">서버가 설정되지 않아 이 기기에만 저장돼요.</p>
        )}
      </div>
    </div>
  );
}

/** 가입 직후 복구 코드 안내 */
export function RecoveryNotice({ code, nickname, onDone }: { code: string; nickname: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="screen auth">
      <TitleBar name={nickname} />
      <div className="screen-body narrow">
        <h2 className="section-title">복구 코드를 저장하세요</h2>
        <div className="card">
          <p className="recovery-code">{code}</p>
          <p className="muted small">
            비밀번호를 잊었을 때 이 코드로 재설정해요. <strong>지금 화면을 캡처</strong>하거나 적어 두세요.
            설정 &gt; 복구 코드 확인에서 다시 볼 수 있어요.
          </p>
          <button type="button" className="btn soft wide" onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              /* 복사 미지원 */
            }
          }}>{copied ? '복사했어요' : '코드 복사'}</button>
        </div>
        <button type="button" className="btn primary wide" onClick={onDone}>저장했어요</button>
      </div>
    </div>
  );
}

/** 이메일 재설정 링크로 들어온 경우 */
export function SetPinScreen({ nickname, onDone }: { nickname: string; onDone: () => void }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [err, setErr] = useState('');
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (a !== b) return setErr('두 번 입력한 비밀번호가 달라요');
    try {
      await setPin(a);
      onDone();
    } catch (x) {
      setErr(authErrorMessage(x));
    }
  };
  return (
    <div className="screen auth">
      <TitleBar name={nickname} />
      <form className="screen-body narrow" onSubmit={save}>
        <h2 className="section-title">새 비밀번호 정하기</h2>
        <div className="card list">
          <Field label="새 비밀번호 (숫자 4자리)"><PinInput value={a} onChange={setA} autoFocus /></Field>
          <Field label="한 번 더"><PinInput value={b} onChange={setB} /></Field>
          {err && <p className="error" role="alert">{err}</p>}
          <button type="submit" className="btn primary wide" disabled={!isPin(a) || !isPin(b)}>저장</button>
        </div>
      </form>
    </div>
  );
}
