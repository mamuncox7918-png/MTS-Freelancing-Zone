import {createRoot} from 'react-dom/client';
import {registerSW} from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    void updateSW(true);
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Check immediately when the installed PWA launches
    void registration.update();

    const checkForAppUpdate = () => {
      if (navigator.onLine) {
        void registration.update();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForAppUpdate();
      }
    });
    window.addEventListener('focus', checkForAppUpdate);
    window.addEventListener('online', checkForAppUpdate);
    window.setInterval(checkForAppUpdate, 60 * 1000);
  },
});

createRoot(document.getElementById('root')!).render(<App />);
