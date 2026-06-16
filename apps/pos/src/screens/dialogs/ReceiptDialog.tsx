import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../../lib/api';
import { t } from '../../lib/i18n';
import { usePos } from '../../lib/store';

// fetched once per POS session; '' = no logo configured
let cachedLogo: string | null = null;

export function ReceiptDialog({ text, onClose }: { text: string; onClose: () => void }) {
  const { lang } = usePos();
  const [logo, setLogo] = useState<string>(cachedLogo ?? '');
  const [qrCode, setQrCode] = useState<string>('');

  useEffect(() => {
    if (cachedLogo !== null) return;
    api<Record<string, unknown>>('/settings')
      .then((s) => {
        cachedLogo = (s['receipt.logo'] as string) || '';
        setLogo(cachedLogo);
      })
      .catch(() => { cachedLogo = ''; });
  }, []);

  // Extract QR code text from receipt tags if present
  useEffect(() => {
    const lines = text.split('\n');
    const qrLine = lines.find((l) => l.startsWith('<qr>') && l.endsWith('</qr>'));
    if (qrLine) {
      setQrCode(qrLine.substring(4, qrLine.length - 5).trim());
    } else {
      setQrCode('');
    }
  }, [text]);

  // Render QR Code on canvas
  useEffect(() => {
    if (qrCode) {
      const canvas = document.getElementById('receipt-qr') as HTMLCanvasElement;
      if (canvas) {
        QRCode.toCanvas(canvas, qrCode, { width: 120, margin: 1 }, (err) => {
          if (err) console.error('Failed to generate QR Code', err);
        });
      }
    }
  }, [qrCode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-auto rounded-2xl bg-white p-5 text-black" onClick={(e) => e.stopPropagation()}>
        <div id="print-area" className="bg-white p-2 text-black text-left font-mono text-xs leading-snug">
          {logo && <img src={logo} alt="Logo" className="mx-auto mb-3 max-h-20" />}
          
          <div className="whitespace-pre font-mono" dir="ltr">
            {text.split('\n').map((line, i) => {
              const trimmed = line.trim();
              if (trimmed.startsWith('<logo>') && trimmed.endsWith('</logo>')) {
                return null;
              }
              if (trimmed.startsWith('<qr>') && trimmed.endsWith('</qr>')) {
                return null;
              }
              if (trimmed.startsWith('<large>') && trimmed.endsWith('</large>')) {
                const content = trimmed.substring(7, trimmed.length - 8);
                return (
                  <div key={i} className="text-center font-bold text-base my-1 whitespace-normal">
                    {content.trim()}
                  </div>
                );
              }
              if (trimmed.startsWith('Subtotal') || trimmed.startsWith('TOTAL')) {
                return (
                  <div key={i} className="font-bold min-h-[1em]">
                    {line}
                  </div>
                );
              }
              // Normal line
              return <div key={i} className="min-h-[1em]">{line}</div>;
            })}
          </div>

          {qrCode && (
            <div className="mt-4 flex flex-col items-center justify-center">
              <canvas id="receipt-qr" className="mx-auto" />
            </div>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-gray-200 py-3 text-sm">
            {t(lang, 'close')}
          </button>
          <button onClick={() => window.print()} className="flex-1 rounded-xl bg-goblin-600 py-3 font-semibold text-white text-sm">
            {t(lang, 'print')}
          </button>
        </div>
      </div>
    </div>
  );
}
