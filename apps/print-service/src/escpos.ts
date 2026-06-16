/** Minimal ESC/POS command builder for 80mm thermal printers. */

const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  private chunks: Buffer[] = [];

  init(): this {
    this.chunks.push(Buffer.from([ESC, 0x40])); // initialize
    return this;
  }

  align(mode: 'left' | 'center' | 'right'): this {
    const n = mode === 'left' ? 0 : mode === 'center' ? 1 : 2;
    this.chunks.push(Buffer.from([ESC, 0x61, n]));
    return this;
  }

  bold(on: boolean): this {
    this.chunks.push(Buffer.from([ESC, 0x45, on ? 1 : 0]));
    return this;
  }

  size(double: boolean): this {
    this.chunks.push(Buffer.from([GS, 0x21, double ? 0x11 : 0x00]));
    return this;
  }

  text(s: string): this {
    this.chunks.push(Buffer.from(s + '\n', 'utf8')); // CP-aware encoding configurable later
    return this;
  }

  feed(lines = 1): this {
    this.chunks.push(Buffer.from([ESC, 0x64, lines]));
    return this;
  }

  cut(): this {
    this.chunks.push(Buffer.from([GS, 0x56, 0x42, 0x00])); // partial cut
    return this;
  }

  drawer(): this {
    this.chunks.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa])); // kick drawer pin 2
    return this;
  }

  qr(data: string, size = 4): this {
    const dataBytes = Buffer.from(data, 'utf8');
    const len = dataBytes.length + 3;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;

    // 1. Set size
    this.chunks.push(Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, size]));
    // 2. Set error correction (M = 49)
    this.chunks.push(Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 49]));
    // 3. Store data
    this.chunks.push(Buffer.from([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]));
    this.chunks.push(dataBytes);
    // 4. Print
    this.chunks.push(Buffer.from([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

export interface TicketJob {
  ticketId: string;
  stationName: string;
  orderNumber: number;
  resourceName: string;
  course: number;
  reprint?: boolean;
  lines: { quantity: number; description: string; modifiers: string[]; notes?: string | null }[];
}

export function renderTicket(job: TicketJob): { escpos: Buffer; preview: string } {
  const b = new EscPos().init();
  const p: string[] = [];

  b.align('center').size(true).bold(true).text(job.stationName.toUpperCase());
  p.push(`=== ${job.stationName.toUpperCase()} ===`);
  if (job.reprint) {
    b.text('** REPRINT **');
    p.push('** REPRINT **');
  }
  b.size(false).bold(false);
  b.text(`#${job.orderNumber}  ${job.resourceName}  C${job.course}`);
  p.push(`#${job.orderNumber}  ${job.resourceName}  Course ${job.course}`);
  b.text(new Date().toLocaleTimeString('en-EG', { timeZone: 'Africa/Cairo' }));
  b.align('left').text('-'.repeat(42));
  p.push('-'.repeat(42));
  for (const line of job.lines) {
    b.size(true).text(`${line.quantity} x ${line.description}`).size(false);
    p.push(`${line.quantity} x ${line.description}`);
    for (const m of line.modifiers) {
      b.text(`   + ${m}`);
      p.push(`   + ${m}`);
    }
    if (line.notes) {
      b.bold(true).text(`   * ${line.notes}`).bold(false);
      p.push(`   * ${line.notes}`);
    }
  }
  b.feed(3).cut();
  return { escpos: b.build(), preview: p.join('\n') };
}

export function renderReceiptEscpos(text: string, openDrawer: boolean): Buffer {
  const b = new EscPos().init().align('left');
  for (let line of text.split('\n')) {
    if (line.startsWith('<logo>') && line.endsWith('</logo>')) {
      continue;
    }
    if (line.startsWith('<qr>') && line.endsWith('</qr>')) {
      const qrData = line.substring(4, line.length - 5).trim();
      b.align('center').qr(qrData).align('left');
      continue;
    }
    let isLarge = false;
    if (line.startsWith('<large>') && line.endsWith('</large>')) {
      isLarge = true;
      line = line.substring(7, line.length - 8);
    }
    
    const trimmed = line.trim();
    if (isLarge) {
      b.align('center').size(true).bold(true).text(trimmed).size(false).bold(false).align('left');
    } else {
      const leadingSpaces = line.length - line.trimStart().length;
      if (leadingSpaces > 3 && trimmed.length > 0) {
        b.align('center').text(trimmed).align('left');
      } else {
        b.text(line);
      }
    }
  }
  b.feed(3).cut();
  if (openDrawer) b.drawer();
  return b.build();
}
