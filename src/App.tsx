import { useCallback, useEffect, useRef, useState } from 'react';
import { AppContext, useApp, useMediaQuery, useSettingsRaw, type AppCtx } from './lib/hooks';
import { adoptRecoverySession, currentSession, type SessionInfo } from './lib/auth';
import { seedIfEmpty } from './lib/data';
import { setMeta } from './lib/db';
import { startSync, syncNow } from './lib/sync';
import { supabase } from './lib/supabase';
import { AppTitle } from './components/ui';
import { Icon } from './components/Icon';
import { AuthScreen, RecoveryNotice, SetPinScreen } from './screens/Auth';
import { TodoScreen } from './screens/Todo';
import { TimetableScreen } from './screens/Timetable';
import { LedgerScreen } from './screens/Ledger';
import { StatsScreen } from './screens/Stats';
import { SectionsScreen, SettingsScreen } from './screens/Settings';
import type { ScreenKey, Settings } from './lib/types';

async function prepare(s: SessionInfo) {
  startSync();
  await syncNow(); // 새 기기면 서버 데이터를 먼저 받아서 기본 데이터가 중복되지 않게
  await seedIfEmpty(s.nickname);
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [session, setSessionState] = useState<SessionInfo | undefined>();
  const [notice, setNotice] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  const setSession = useCallback((s: SessionInfo | undefined) => {
    setSessionState(s);
    if (s) setMeta('session', s);
  }, []);

  useEffect(() => {
    const sub = supabase?.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setRecovering(true);
        adoptRecoverySession().then(async (s) => {
          if (s) {
            await prepare(s);
            setSessionState(s);
          }
        });
      }
    });
    currentSession().then(async (s) => {
      if (s) await prepare(s);
      setSessionState(s);
      setBooting(false);
    });
    return () => sub?.data.subscription.unsubscribe();
  }, []);

  const onAuthed = async (s: SessionInfo, isNew: boolean) => {
    await prepare(s);
    if (isNew && s.recoveryCode) setNotice(s.recoveryCode);
    setSessionState(s);
  };

  if (booting) return <div className="boot" aria-busy="true" />;
  if (!session) return <AuthScreen onAuthed={onAuthed} />;
  if (recovering) return <SetPinScreen nickname={session.nickname} onDone={() => setRecovering(false)} />;
  if (notice) return <RecoveryNotice code={notice} nickname={session.nickname} onDone={() => setNotice(null)} />;
  return <Shell session={session} setSession={setSession} />;
}

const TABS: { key: ScreenKey; label: string; icon: string }[] = [
  { key: 'todo', label: '할 일', icon: 'list' },
  { key: 'timetable', label: '시간표', icon: 'grid' },
  { key: 'ledger', label: '가계부', icon: 'wallet' },
  { key: 'stats', label: '통계', icon: 'chart' },
  { key: 'settings', label: '설정', icon: 'gear' },
];

const visible = (s: Settings, k: ScreenKey) => (k === 'stats' ? s.sections.stats : k === 'ledger' ? s.sections.ledger : true);

function Shell({ session, setSession }: { session: SessionInfo; setSession: (s: SessionInfo | undefined) => void }) {
  const settings = useSettingsRaw(session.nickname);
  const tablet = useMediaQuery('(min-width: 1000px) and (orientation: landscape)');
  const [screen, setScreen] = useState<ScreenKey | null>(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (settings && screen === null) setScreen(visible(settings, settings.startScreen) ? settings.startScreen : 'timetable');
  }, [settings, screen]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2600);
  }, []);

  if (!settings || !screen) return <div className="boot" aria-busy="true" />;

  const ctx: AppCtx = { session, settings, setSession, go: setScreen, toast, tablet };
  const current = visible(settings, screen) ? screen : 'timetable';
  const tabs = TABS.filter((t) => visible(settings, t.key));

  return (
    <AppContext.Provider value={ctx}>
      {tablet ? <TabletLayout /> : (
        <div className="phone">
          <main className="phone-main">
            {current === 'todo' && <TodoScreen />}
            {current === 'timetable' && <TimetableScreen />}
            {current === 'ledger' && <LedgerScreen />}
            {current === 'stats' && <StatsScreen />}
            {current === 'settings' && <SettingsScreen />}
          </main>
          <nav className="tabbar" aria-label="주 메뉴">
            {tabs.map((t) => (
              <button key={t.key} type="button" className={'tab' + (current === t.key ? ' on' : '')}
                aria-current={current === t.key ? 'page' : undefined} onClick={() => setScreen(t.key)}>
                <Icon name={t.icon} size={22} />
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
      <div className="toast-wrap" aria-live="polite">{toastMsg && <div className="toast">{toastMsg}</div>}</div>
    </AppContext.Provider>
  );
}

type PanelKey = 'stats' | 'ledger' | 'settings';

/** 아이패드 가로: 할 일 | 24시간 시간표 | 오른쪽 패널 */
function TabletLayout() {
  const { settings } = useApp();
  const [panel, setPanel] = useState<PanelKey>('stats');
  const [hiding, setHiding] = useState(false);
  const panels: { key: PanelKey; label: string }[] = [
    ...(settings.sections.stats ? [{ key: 'stats' as const, label: '통계' }] : []),
    ...(settings.sections.ledger ? [{ key: 'ledger' as const, label: '가계부' }] : []),
    { key: 'settings', label: '설정' },
  ];
  const cur = panels.some((p) => p.key === panel) ? panel : 'settings';

  return (
    <div className="tablet">
      <AppTitle />
      <div className="tablet-cols">
        <section className="pane left" aria-label="할 일"><TodoScreen embedded /></section>
        <section className="pane center" aria-label="시간표"><TimetableScreen embedded /></section>
        <section className="pane right" aria-label="오른쪽 패널">
          {hiding ? <SectionsScreen onDone={() => setHiding(false)} /> : (
            <>
              <div className="panel-tabs">
                <div className="segmented" role="tablist" aria-label="패널">
                  {panels.map((p) => (
                    <button key={p.key} type="button" role="tab" aria-selected={cur === p.key} className={cur === p.key ? 'on' : ''}
                      onClick={() => setPanel(p.key)}>{p.label}</button>
                  ))}
                </div>
                <button type="button" className="btn ghost small" onClick={() => setHiding(true)}>
                  <Icon name="eyeOff" size={16} /> 가리기
                </button>
              </div>
              <div className="panel-body">
                {cur === 'stats' && <StatsScreen embedded />}
                {cur === 'ledger' && <LedgerScreen embedded />}
                {cur === 'settings' && <SettingsScreen embedded />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
