import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Well-known setting keys with defaults. */
export const SETTING_DEFAULTS = {
  'tax.vatBps': 1400,
  'tax.serviceChargeBps': 1200,
  'tax.inclusive': false,
  'loyalty.earnPointsPer100Egp': 1,
  'loyalty.redeemCentsPerPoint': 100,
  'reservation.noShowGraceMinutes': 15,
  'receipt.logo': '',
  'receipt.header': 'Goblins Yard',
  'receipt.headerAr': 'جوبلنز يارد',
  'receipt.footer': 'Thank you! See you soon — goblinsyard.com',
  'receipt.footerAr': 'شكراً لزيارتكم!',
  'receipt.showTaxSummary': true,
  'receipt.showLoyalty': true,
  'receipt.showQrCode': true,
  'receipt.qrCodeText': 'https://goblinsyard.com',
  'receipt.fontSize': 'normal',
  'twilio.accountSid': '',
  'twilio.authToken': '',
  'twilio.from': '',
  'expense.allocationMethod': 'revenue',
  'expense.allocationManual.RESTAURANT': 4000,
  'expense.allocationManual.BAR': 2000,
  'expense.allocationManual.BILLIARDS': 2000,
  'expense.allocationManual.PLAYSTATION': 2000,
  'session.prepaidAlertMinutes': 10,
  'session.prepaidSmsAlertMinutes': 5,
  'business.currency': 'EGP',
  'business.timezone': 'Africa/Cairo',
  'business.name': 'Goblins Yard',
  'business.address': '123 Nile Street, Zamalek, Cairo',
  'business.taxId': '123-456-789',
  'business.phone': '01001234567',
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<K extends SettingKey>(key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return (row?.value ?? SETTING_DEFAULTS[key]) as (typeof SETTING_DEFAULTS)[K];
  }

  async getAll(): Promise<Record<string, unknown>> {
    const rows = await this.prisma.setting.findMany();
    const merged: Record<string, unknown> = { ...SETTING_DEFAULTS };
    for (const row of rows) merged[row.key] = row.value;
    return merged;
  }

  async set(key: string, value: Prisma.InputJsonValue) {
    await this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
