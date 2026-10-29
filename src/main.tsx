import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import './styles.css';

if (import.meta.env.MODE === 'artifact') document.documentElement.classList.add('in-artifact');
else registerSW({ immediate: true });

if (navigator.storage?.persist) navigator.storage.persist().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
