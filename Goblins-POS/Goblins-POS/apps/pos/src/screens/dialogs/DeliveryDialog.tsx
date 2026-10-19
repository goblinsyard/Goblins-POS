import { useState } from 'react';
import { Bike } from 'lucide-react';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';
import type { Order } from '../../lib/types';

const CHANNELS = [
  { value: 'PHONE', en: 'Phone / WhatsApp', ar: 'تليفون / واتساب' },
  { value: 'TALABAT', en: 'Talabat', ar: 'طلبات' },
  { value: 'ELMENUS', en: 'Elmenus', ar: 'المنيوز' },
  { value: 'RABBIT', en: 'Rabbit', ar: 'رابيت' },
] as const;

/** Start a delivery order: which app it came from, the app's order number, and the customer. */
export function DeliveryDialog({ onCreated, onClose }: { onCreated: (orderId: string) => void; onClose: () => void }) {
  const { lang } = usePos();
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]['value']>('TALABAT');
  const [externalRef, setExternalRef] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isApp = channel !== 'PHONE';
  const ar = lang === 'ar';

  async function create() {
    setError('');
    if (isApp && !externalRef.trim()) {
      setError(ar ? 'اكتب رقم الطلب من التطبيق' : "Enter the app's order number");
      return;
    }
    setBusy(true);
    try {
      const order = await api<Order>('/orders', {
        method: 'POST',
        body: {
          type: 'DELIVERY', channel,
          ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
          ...(name.trim() ? { deliveryName: name.trim() } : {}),
          ...(phone.trim() ? { deliveryPhone: phone.trim() } : {}),
          ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
        },
      });
      onCreated(order.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  const input = 'w-full rounded-xl bg-goblin-950 p-3';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl border border-goblin-800 bg-goblin-900 p-5 text-goblin-50" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-bold">
          <Bike className="h-5 w-5" /> {ar ? 'طلب توصيل' : 'Delivery order'}
        </h2>
        <div className="mb-3 grid grid-cols-2 gap-2">
          {CHANNELS.map((c) => (
            <button key={c.value} onClick={() => setChannel(c.value)}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${channel === c.value ? 'bg-goblin-600 text-white' : 'bg-goblin-800 text-goblin-200'}`}>
              {ar ? c.ar : c.en}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {isApp && (
            <input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} autoFocus
              placeholder={ar ? 'رقم الطلب في التطبيق' : 'App order number'} className={input} />
          )}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={ar ? 'اسم العميل' : 'Customer name'} className={input} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder={ar ? 'الموبايل' : 'Phone'} className={input} />
          {!isApp && (
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
              placeholder={ar ? 'العنوان' : 'Address'} className={input} />
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-goblin-800 py-3">{t(lang, 'cancel')}</button>
          <button onClick={() => void create()} disabled={busy}
            className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold text-white disabled:opacity-50">
            {ar ? 'ابدأ الطلب' : 'Start order'}
          </button>
        </div>
      </div>
    </div>
  );
}
