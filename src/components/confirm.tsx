import { useEffect, useState } from 'react';
import { Sheet } from './ui';

interface Request {
  message: string;
  okLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

let show: ((r: Request) => void) | null = null;

/** 브라우저 confirm() 대신 쓰는 확인 시트 (임베드된 화면에서는 confirm()이 막혀 있다) */
export function askConfirm(message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!show) return resolve(false);
    show({ message, okLabel: opts.okLabel ?? '확인', danger: opts.danger ?? false, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    show = setReq;
    return () => {
      show = null;
    };
  }, []);
  if (!req) return null;
  const done = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  return (
    <Sheet open onClose={() => done(false)} title="확인"
      footer={
        <>
          <button type="button" className="btn outline big grow" onClick={() => done(false)}>취소</button>
          <button type="button" className={'btn big grow ' + (req.danger ? 'danger-fill' : 'primary')} onClick={() => done(true)}>
            {req.okLabel}
          </button>
        </>
      }>
      <p className="confirm-text">{req.message}</p>
    </Sheet>
  );
}
