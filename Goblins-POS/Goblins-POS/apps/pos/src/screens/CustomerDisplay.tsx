import { useEffect, useState } from 'react';
import { fmtMoney } from '../lib/i18n';
import { listenDisplay, pollDisplay, type DisplayState } from '../lib/customerDisplay';

interface PublicItem { id: string; name: string; nameAr?: string | null; priceCents: number; imageUrl?: string | null }

/** Customer-facing second screen: live order while ringing up, photo slideshow when idle. */
export function CustomerDisplay() {
  const lang = ((): 'en' | 'ar' => {
    try { return localStorage.getItem('pos.lang') === 'ar' ? 'ar' : 'en'; } catch { return 'en'; }
  })();
  const ar = lang === 'ar';
  const [state, setState] = useState<DisplayState>({ kind: 'idle' });
  const [photos, setPhotos] = useState<PublicItem[]>([]);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    document.documentElement.dir = ar ? 'rtl' : 'ltr';
    document.title = ar ? 'شاشة العميل' : 'Customer display';
    const code = new URLSearchParams(window.location.search).get('code');
    return code ? pollDisplay(code.toUpperCase(), setState) : listenDisplay(setState);
  }, [ar]);

  useEffect(() => {
    fetch('/api/menu/public')
      .then((r) => r.json())
      .then((cats: { items?: PublicItem[] }[]) => {
        const all = cats.flatMap((c) => c.items ?? []).filter((i) => i.imageUrl);
        for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [all[i], all[j]] = [all[j]!, all[i]!]; }
        setPhotos(all.slice(0, 40));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (state.kind === 'order' || photos.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % photos.length), 6000);
    return () => clearInterval(t);
  }, [state.kind, photos.length]);

  // thank-you screen returns to the slideshow by itself
  useEffect(() => {
    if (state.kind !== 'thanks') return;
    const t = setTimeout(() => setState({ kind: 'idle' }), 8000);
    return () => clearTimeout(t);
  }, [state]);

  const brand = (
    <div className="flex items-center gap-3">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-goblin-600 text-2xl font-black text-white">G</span>
      <span className="text-3xl font-extrabold tracking-tight text-goblin-50">Goblins Yard</span>
    </div>
  );

  if (state.kind === 'order' && state.lines && state.lines.length > 0) {
    const due = (state.totalCents ?? 0) - (state.paidCents ?? 0);
    return (
      <div className="flex h-screen bg-goblin-950 text-goblin-50">
        <div className="flex flex-1 flex-col p-8">
          <div className="mb-6 flex items-center justify-between">
            {brand}
            <span className="rounded-full bg-goblin-800 px-4 py-1.5 text-lg font-semibold text-goblin-300">
              {ar ? 'طلب' : 'Order'} #{state.number}
            </span>
          </div>
          <div className="flex-1 space-y-2 overflow-auto pe-2">
            {state.lines.map((l, i) => (
              <div key={i} className="flex items-start justify-between rounded-2xl bg-goblin-900 px-5 py-3 text-2xl">
                <div>
                  <span className="font-semibold">{l.qty !== 1 && <span className="text-goblin-300">{l.qty}× </span>}{l.name}</span>
                  {l.mods.length > 0 && <div className="text-base text-goblin-400">{l.mods.join(' · ')}</div>}
                </div>
                <span className="font-mono">{fmtMoney(l.cents, lang)}</span>
              </div>
            ))}
          </div>
        </div>
        <aside className="flex w-[34%] min-w-[300px] flex-col justify-end gap-3 border-s border-goblin-800 bg-goblin-900 p-8 font-mono text-2xl">
          <Row k={ar ? 'المجموع الفرعي' : 'Subtotal'} v={fmtMoney(state.subtotalCents ?? 0, lang)} />
          {(state.discountCents ?? 0) > 0 && <Row k={ar ? 'الخصم' : 'Discount'} v={`-${fmtMoney(state.discountCents ?? 0, lang)}`} />}
          {(state.serviceCents ?? 0) > 0 && <Row k={ar ? 'الخدمة' : 'Service'} v={fmtMoney(state.serviceCents ?? 0, lang)} />}
          {(state.taxCents ?? 0) > 0 && <Row k={ar ? 'الضريبة' : 'VAT'} v={fmtMoney(state.taxCents ?? 0, lang)} />}
          {(state.paidCents ?? 0) > 0 && <Row k={ar ? 'المدفوع' : 'Paid'} v={fmtMoney(state.paidCents ?? 0, lang)} />}
          <div className="mt-3 flex items-baseline justify-between border-t border-goblin-700 pt-4">
            <span className="font-sans text-2xl font-bold">{ar ? 'الإجمالي' : 'Total'}</span>
            <span className="text-5xl font-black text-goblin-300">{fmtMoney(due, lang)}</span>
          </div>
        </aside>
      </div>
    );
  }

  const photo = photos[slide];
  return (
    <div className="relative flex h-screen flex-col items-center justify-center overflow-hidden bg-goblin-950 text-goblin-50">
      {photo && state.kind !== 'thanks' && (
        <img key={photo.id} src={photo.imageUrl!} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity duration-1000" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-goblin-950 via-goblin-950/30 to-transparent" />
      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        {brand}
        {state.kind === 'thanks' ? (
          <p className="text-4xl font-bold">{ar ? 'شكرًا لزيارتكم!' : 'Thank you! See you again.'}</p>
        ) : photo ? (
          <p className="mt-[45vh] text-3xl font-bold drop-shadow">
            {ar && photo.nameAr ? photo.nameAr : photo.name}
            <span className="ms-3 font-mono text-goblin-300">{fmtMoney(photo.priceCents, lang)}</span>
          </p>
        ) : (
          <p className="text-2xl text-goblin-300">{ar ? 'أهلًا بكم' : 'Welcome'}</p>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-goblin-300">
      <span className="font-sans text-xl">{k}</span>
      <span>{v}</span>
    </div>
  );
}
