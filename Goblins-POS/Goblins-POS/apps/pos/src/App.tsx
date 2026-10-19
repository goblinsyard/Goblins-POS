import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { initOfflineSync } from './lib/api';
import { t } from './lib/i18n';
import { usePos } from './lib/store';
import { useAutoLock } from './lib/useAutoLock';
import { Floor } from './screens/Floor';
import { OrderScreen } from './screens/OrderScreen';
import { PinLogin } from './screens/PinLogin';

export function App() {
  const { user, screen, lang, setLang } = usePos();
  const [queued, setQueued] = useState(0);
  const lockIn = useAutoLock();

  useEffect(() => {
    setLang(lang); // apply dir/lang attrs on boot
    void initOfflineSync(setQueued);
    // boot-only effect — intentionally not re-run on lang change
  }, []);

  return (
    <>
      {queued > 0 && (
        <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-1.5 bg-amber-600 py-1 text-center text-sm font-semibold text-white">
          <TriangleAlert className="h-4 w-4 shrink-0" /> {queued} order update(s) queued offline — will sync when connection returns
        </div>
      )}
      {!user ? <PinLogin /> : screen === 'order' ? <OrderScreen /> : <Floor />}
      {user && lockIn != null && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-goblin-900 p-6 text-center text-goblin-50 shadow-2xl">
            <p className="text-sm text-goblin-300">{t(lang, 'autoLockWarning')}</p>
            <p className="my-3 font-mono text-5xl font-bold">{lockIn}</p>
            <p className="text-sm text-goblin-300">{t(lang, 'autoLockStay')}</p>
          </div>
        </div>
      )}
    </>
  );
}
