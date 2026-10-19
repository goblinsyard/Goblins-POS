import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InventoryService } from '../inventory/inventory.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const egp = (cents: number) =>
  (cents / 100).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Egyptian local numbers (010…) → E.164 (+2010…). */
function toE164(phone: string): string {
  const p = phone.replace(/[\s-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (p.startsWith('0')) return `+2${p}`;
  return `+${p}`;
}

export interface ZSummary {
  closedAt: Date | string;
  orderCount: number;
  voidedCount: number;
  grossCents: number;
  discountCents: number;
  discountCount: number;
  tipsCents: number;
  refundCount?: number;
  refundsCents?: number;
  byMethod: Record<string, { count: number; amountCents: number }>;
  byDepartment: Record<string, number>;
  cash: { expectedCents: number };
  countedCents: number;
  varianceCents: number;
}

/**
 * Owner notifications over Twilio (WhatsApp or SMS): the end-of-day Z summary
 * and low-stock alerts. Configured in Settings (notify.*); without Twilio
 * credentials messages are only written to the API log.
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify');

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly inventory: InventoryService,
  ) {}

  /** Send a message to the owner phone(s). Returns what happened, never throws. */
  async sendToOwner(body: string): Promise<{ sent: number; skipped?: string; errors: string[] }> {
    const all = await this.settings.getAll();
    const phones = String(all['notify.ownerPhone'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!phones.length) return { sent: 0, skipped: 'notify.ownerPhone is empty', errors: [] };
    return this.sendTo(phones, body);
  }

  /** Send to any phone numbers (customers, owner) over the configured channel. Never throws. */
  async sendTo(phones: string[], body: string): Promise<{ sent: number; skipped?: string; errors: string[] }> {
    const all = await this.settings.getAll();
    if (!phones.length) return { sent: 0, skipped: 'no phone number', errors: [] };

    const sid = String(all['twilio.accountSid'] ?? '');
    const token = String(all['twilio.authToken'] ?? '');
    const fromRaw = String(all['twilio.from'] ?? '').replace(/^whatsapp:/, '');
    const whatsapp = String(all['notify.channel'] ?? 'whatsapp') !== 'sms';

    if (!sid || !token || !fromRaw) {
      this.log.log(`[not sent — Twilio not configured] to ${phones.join(', ')}:\n${body}`);
      return { sent: 0, skipped: 'Twilio credentials are not set in Settings', errors: [] };
    }

    const errors: string[] = [];
    let sent = 0;
    for (const phone of phones) {
      const to = toE164(phone);
      const params = new URLSearchParams({
        From: whatsapp ? `whatsapp:${fromRaw}` : fromRaw,
        To: whatsapp ? `whatsapp:${to}` : to,
        Body: body,
      });
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        if (res.ok) sent++;
        else errors.push(`${to}: ${(await res.text()).slice(0, 200)}`);
      } catch (e) {
        errors.push(`${to}: ${e instanceof Error ? e.message : 'network error'}`);
      }
    }
    if (errors.length) this.log.warn(`Some owner messages failed: ${errors.join(' | ')}`);
    return { sent, errors };
  }

  /** End-of-day message built from a closed shift's Z report. */
  async sendEndOfDay(z: ZSummary) {
    if ((await this.settings.getAll())['notify.endOfDaySummary'] === false) return;
    const name = String((await this.settings.getAll())['business.name'] ?? 'Goblins Yard');
    const day = new Date(z.closedAt).toLocaleDateString('en-GB', {
      timeZone: 'Africa/Cairo', weekday: 'short', day: 'numeric', month: 'short',
    });
    const methods = Object.entries(z.byMethod)
      .filter(([, m]) => m.amountCents !== 0)
      .map(([k, m]) => `${k} ${egp(m.amountCents)}`)
      .join(' · ');
    const depts = Object.entries(z.byDepartment)
      .map(([k, v]) => `${k} ${egp(v)}`)
      .join(' · ');
    const variance =
      z.varianceCents === 0 ? 'balanced' : `${z.varianceCents > 0 ? 'over' : 'SHORT'} ${egp(Math.abs(z.varianceCents))}`;
    const lines = [
      `${name} — closing ${day}`,
      `Sales: ${egp(z.grossCents)} EGP (${z.orderCount} bills)`,
      depts && `By area: ${depts}`,
      methods && `Payments: ${methods}`,
      `Cash: expected ${egp(z.cash.expectedCents)}, counted ${egp(z.countedCents)} → ${variance}`,
      `Voided bills: ${z.voidedCount} · Discounts: ${egp(z.discountCents)} (${z.discountCount})`,
      z.refundCount ? `Refunds: ${egp(z.refundsCents ?? 0)} (${z.refundCount})` : '',
      z.tipsCents ? `Tips: ${egp(z.tipsCents)}` : '',
    ].filter(Boolean);
    await this.sendToOwner(lines.join('\n'));
  }

  /**
   * Every 30 minutes: alert once when an ingredient drops to its reorder point.
   * It is alerted again only after it has been restocked above that point.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkLowStock() {
    if ((await this.settings.getAll())['notify.lowStockAlerts'] === false) return;
    const low = await this.inventory.lowStock();
    const row = await this.prisma.setting.findUnique({ where: { key: 'notify.lowStockAlerted' } });
    const alerted = new Set<string>(Array.isArray(row?.value) ? (row.value as string[]) : []);
    const lowIds = new Set(low.map((l) => l.id));
    const fresh = low.filter((l) => !alerted.has(l.id));
    const stillLow = [...alerted].filter((id) => lowIds.has(id));

    if (fresh.length) {
      const list = fresh
        .slice(0, 15)
        .map((l) => `• ${l.name}: ${Number(l.totalQty).toLocaleString('en')} ${l.uom} (reorder at ${Number(l.reorderPoint)})`)
        .join('\n');
      const more = fresh.length > 15 ? `\n…and ${fresh.length - 15} more` : '';
      await this.sendToOwner(`Low stock — please reorder:\n${list}${more}`);
    }
    const next = [...stillLow, ...fresh.map((f) => f.id)];
    await this.prisma.setting.upsert({
      where: { key: 'notify.lowStockAlerted' },
      update: { value: next },
      create: { key: 'notify.lowStockAlerted', value: next },
    });
  }
}
