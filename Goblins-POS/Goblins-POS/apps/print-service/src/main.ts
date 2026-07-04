/**
 * Goblins print service — subscribes to the API's realtime "print" room and
 * dispatches jobs to physical printers (TCP 9100) or preview files.
 *
 * Modes (PRINT_MODE env): "live" sends to printer addresses; "preview"
 * (default) writes rendered tickets to ./preview/*.txt so the system is
 * fully testable without hardware.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect as tcpConnect } from 'node:net';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { renderTicket, renderReceiptEscpos, type TicketJob } from './escpos';

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const MODE = process.env.PRINT_MODE ?? 'preview';
// Shared secret authorizing this headless daemon on the realtime "print" room.
const WS_SERVICE_TOKEN = process.env.WS_SERVICE_TOKEN ?? '';
const PREVIEW_DIR = process.env.PREVIEW_DIR ?? join(process.cwd(), 'preview');

interface ReceiptJob {
  orderId: string;
  printerAddress?: string; // "host:port" in live mode
  text: string;
  openDrawer?: boolean;
}

interface PrinterTarget {
  address: string; // "192.168.1.50:9100"
}

function sendTcp(target: PrinterTarget, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const [host, portStr] = target.address.split(':');
    const socket = tcpConnect({ host, port: Number(portStr ?? 9100), timeout: 5000 }, () => {
      socket.write(payload, () => socket.end());
    });
    socket.on('close', () => resolve());
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Printer timeout: ${target.address}`));
    });
  });
}

function previewWrite(name: string, content: string) {
  mkdirSync(PREVIEW_DIR, { recursive: true });
  const file = join(PREVIEW_DIR, `${Date.now()}-${name}.txt`);
  writeFileSync(file, content, 'utf8');
  console.log(`[preview] ${file}`);
}

async function handleTicket(job: TicketJob & { printerAddress?: string }) {
  const { escpos, preview } = renderTicket(job);
  if (MODE === 'live' && job.printerAddress) {
    try {
      await sendTcp({ address: job.printerAddress }, escpos);
      console.log(`[live] ticket ${job.ticketId} → ${job.printerAddress}`);
    } catch (err) {
      console.error(`[live] FAILED ${job.ticketId}:`, err);
      previewWrite(`FAILED-ticket-${job.ticketId}`, preview); // never lose a ticket
    }
  } else {
    previewWrite(`ticket-${job.stationName}-${job.orderNumber}`, preview);
  }
}

async function handleReceipt(job: ReceiptJob) {
  if (MODE === 'live' && job.printerAddress) {
    try {
      await sendTcp({ address: job.printerAddress }, renderReceiptEscpos(job.text, job.openDrawer ?? false));
      console.log(`[live] receipt ${job.orderId} → ${job.printerAddress}`);
      return;
    } catch (err) {
      console.error(`[live] receipt FAILED:`, err);
    }
  }
  previewWrite(`receipt-${job.orderId}`, job.text);
}

function main() {
  console.log(`Print service starting — mode=${MODE}, api=${API_URL}`);
  const socket = io(API_URL, {
    path: '/ws',
    query: { rooms: 'print' },
    auth: { token: WS_SERVICE_TOKEN },
  });
  socket.on('connect', () => console.log('Connected to API realtime'));
  socket.on('disconnect', () => console.log('Disconnected — retrying…'));
  socket.on('ticket.print', (job: TicketJob & { printerAddress?: string }) => void handleTicket(job));
  socket.on('receipt.print', (job: ReceiptJob) => void handleReceipt(job));
}

main();
