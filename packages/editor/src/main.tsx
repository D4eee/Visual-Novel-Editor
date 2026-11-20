import { createRoot } from 'react-dom/client';
import { App } from './App';
import { store } from './state/store';
import './styles.css';

// Used by module mount contexts and a few non-React helpers.
(globalThis as any).__vneStore = store;
(globalThis as any).__vneT = (k: string, p?: any) => store.t(k, p);

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await store.init();
  } catch (err) {
    console.error(err);
  }
  root.render(<App />);
  // Reopen the last project after a crash-reload or when asked by URL.
  const params = new URLSearchParams(location.search);
  const open = params.get('open');
  if (open) await store.openProject(open);
}

boot();
