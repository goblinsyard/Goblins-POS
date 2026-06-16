import { useEffect, useState } from 'react';
import { initOfflineSync } from './lib/api';
import { usePos } from './lib/store';
import { Floor } from './screens/Floor';
import { OrderScreen } from './screens/OrderScreen';
import { PinLogin } from './screens/PinLogin';

export function App() {
  const { user, screen, lang, setLang } = usePos();
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    setLang(lang); // apply dir/lang attrs on boot
    void initOfflineSync(setQueued);
    // boot-only effect — intentionally not re-run on lang change
  }, []);

  return (
    <>
      {queued > 0 && (
        <div className="fixed inset-x-0 top-0 z-[100] bg-amber-600 py-1 text-center text-sm font-semibold text-white">
          ⚠ {queued} order update(s) queued offline — will sync when connection returns
        </div>
      )}
      {!user ? <PinLogin /> : screen === 'order' ? <OrderScreen /> : <Floor />}
    </>
  );
}
