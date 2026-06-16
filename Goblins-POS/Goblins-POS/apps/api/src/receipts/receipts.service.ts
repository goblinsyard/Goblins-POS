import { Injectable, NotFoundException } from '@nestjs/common';
import { formatEgp } from '@goblins/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

const WIDTH = 42; // chars per line on 80mm paper

function line(ch = '-'): string {
  return ch.repeat(WIDTH);
}
function center(s: string): string {
  const pad = Math.max(0, Math.floor((WIDTH - s.length) / 2));
  return ' '.repeat(pad) + s;
}
function row(left: string, right: string): string {
  const space = Math.max(1, WIDTH - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Render a customer receipt as plain text (ESC/POS-ready). Phase 4 sends
   * this to the print service; until then the POS shows it as print-preview.
   */
  async render(orderId: string, opts: { reprint?: boolean } = {}): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { modifiers: true }, orderBy: { sortOrder: 'asc' } },
        payments: { include: { method: true } },
        discounts: true,
        resource: true,
        customer: { include: { tier: true } },
        branch: true,
        openedBy: { select: { name: true } },
      },
    });
    if (!order) throw new NotFoundException();

    const header = await this.settings.get('receipt.header');
    const headerAr = await this.settings.get('receipt.headerAr' as any).catch(() => '');
    const footer = await this.settings.get('receipt.footer');
    const footerAr = await this.settings.get('receipt.footerAr' as any).catch(() => '');
    const showTax = await this.settings.get('receipt.showTaxSummary' as any).catch(() => true);
    const showLoyalty = await this.settings.get('receipt.showLoyalty' as any).catch(() => true);
    const showQr = await this.settings.get('receipt.showQrCode' as any).catch(() => true);
    const qrText = await this.settings.get('receipt.qrCodeText' as any).catch(() => 'https://goblinsyard.com');
    const fontSize = await this.settings.get('receipt.fontSize' as any).catch(() => 'normal');
    const hasLogo = await this.settings.get('receipt.logo' as any).catch(() => '');
    const businessAddress = await this.settings.get('business.address' as any).catch(() => order.branch.address || '');
    const businessTaxId = await this.settings.get('business.taxId' as any).catch(() => order.branch.taxId || '');

    const out: string[] = [];
    if (hasLogo) {
      out.push('<logo></logo>');
    }
    
    const fmtHeader = fontSize === 'large' ? `<large>${center(String(header))}</large>` : center(String(header));
    out.push(fmtHeader);
    if (headerAr) {
      const fmtHeaderAr = fontSize === 'large' ? `<large>${center(String(headerAr))}</large>` : center(String(headerAr));
      out.push(fmtHeaderAr);
    }
    
    if (businessAddress) out.push(center(String(businessAddress)));
    if (businessTaxId) out.push(center(`Tax ID: ${String(businessTaxId)}`));
    out.push(line('='));
    if (opts.reprint) out.push(center('*** REPRINT ***'));
    out.push(row(`Order #${order.number}`, order.type.replace('_', ' ')));
    if (order.resource) out.push(row('Table/Room:', order.resource.name));
    out.push(row('Server:', order.openedBy.name));
    out.push(row('Date:', new Date(order.closedAt ?? order.openedAt).toLocaleString('en-EG', { timeZone: 'Africa/Cairo' })));
    if (order.customer) out.push(row('Customer:', order.customer.name));
    out.push(line());

    for (const item of order.items) {
      if (item.status === 'VOIDED') continue;
      const qty = Number(item.quantity);
      const qtyStr = qty === 1 ? '' : `${qty} x `;
      out.push(row(`${qtyStr}${item.description}`.slice(0, WIDTH - 10), formatEgp(item.lineCents)));
      for (const mod of item.modifiers) {
        out.push(
          row(`  + ${mod.name}`.slice(0, WIDTH - 10), mod.priceCents ? formatEgp(mod.priceCents * qty) : ''),
        );
      }
    }
    out.push(line());
    out.push(row('Subtotal', formatEgp(order.subtotalCents)));
    if (order.discountCents > 0) out.push(row('Discount', `-${formatEgp(order.discountCents)}`));
    if (showTax) {
      if (order.serviceChargeCents > 0) out.push(row('Service', formatEgp(order.serviceChargeCents)));
      out.push(row('VAT', formatEgp(order.taxCents)));
    }
    out.push(line('='));
    out.push(row('TOTAL', formatEgp(order.totalCents)));
    out.push(line('='));
    for (const p of order.payments) {
      out.push(row(p.method.name, formatEgp(p.amountCents)));
      if (p.tenderedCents != null) {
        out.push(row('  Tendered', formatEgp(p.tenderedCents)));
        out.push(row('  Change', formatEgp(p.changeCents)));
      }
    }
    
    if (showLoyalty && order.customer) {
      out.push(line());
      if (order.customer.tier) {
        out.push(center(`Loyalty Tier: ${order.customer.tier.name}`));
      }
      out.push(center(`Points Balance: ${order.customer.pointsBalance} pts`));
    }
    
    out.push('');
    const fmtFooter = fontSize === 'large' ? `<large>${center(String(footer))}</large>` : center(String(footer));
    out.push(fmtFooter);
    if (footerAr) {
      const fmtFooterAr = fontSize === 'large' ? `<large>${center(String(footerAr))}</large>` : center(String(footerAr));
      out.push(fmtFooterAr);
    }
    out.push('');
    
    if (showQr && qrText) {
      out.push(`<qr>${qrText}</qr>`);
      out.push('');
    }
    
    return out.join('\n');
  }
}
