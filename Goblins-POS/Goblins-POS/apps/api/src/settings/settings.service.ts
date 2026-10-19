import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Well-known setting keys with defaults. */
export const SETTING_DEFAULTS = {
  'tax.vatBps': 1400, // 14% Egyptian VAT
  'tax.serviceChargeBps': 1200, // 12% service charge
  'tax.inclusive': false,
  'loyalty.earnPointsPer100Egp': 1, // 1 point per 100 EGP
  'loyalty.redeemCentsPerPoint': 100, // 1 point = 1 EGP
  'reservation.noShowGraceMinutes': 15,
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
  // owner notifications (WhatsApp/SMS via Twilio); comma-separate several numbers
  'notify.ownerPhone': '',
  'notify.channel': 'whatsapp', // or 'sms'
  'notify.endOfDaySummary': true,
  'notify.lowStockAlerts': true,
  'expense.allocationMethod': 'revenue',
  'expense.allocationManual.RESTAURANT': 4000,
  'expense.allocationManual.BAR': 2000,
  'expense.allocationManual.BILLIARDS': 2000,
  'expense.allocationManual.PLAYSTATION': 2000,
  'pos.autoLockMinutes': 3, // lock idle POS terminals back to the PIN screen (0 = never)
  // one-tap kitchen notes on the POS, comma separated, each "English|عربي"
  'pos.quickNotes': 'No sugar|بدون سكر, Less sugar|سكر خفيف, Extra sugar|سكر زيادة, No ice|بدون ثلج, Extra ice|ثلج زيادة, Extra hot|ساخن جدًا, Takeaway cup|كوب تيك أواي, Less spicy|حار خفيف, Extra spicy|حار زيادة, No onions|بدون بصل, Well done|مستوي جيدًا, Sauce on the side|الصوص على الجنب',
  // optional message shown at the top of the POS order screen (offers, specials)
  'pos.bannerText': '',
  'pos.bannerTextAr': '',
  'session.prepaidAlertMinutes': 10, // alert when 10 min left on prepaid block
  'session.prepaidSmsAlertMinutes': 5, // SMS/WhatsApp alert minutes before expiry
  // delivery apps: commission in bps (2500 = 25%) and the API key each app's
  // integration must send (empty = integration off)
  'delivery.commissionBps.TALABAT': 0,
  'delivery.commissionBps.ELMENUS': 0,
  'delivery.commissionBps.RABBIT': 0,
  'integration.TALABAT.apiKey': '',
  'integration.ELMENUS.apiKey': '',
  'integration.RABBIT.apiKey': '',
  // online booking (website + /book page)
  'booking.enabled': true,
  'booking.types': 'BILLIARDS_TABLE,PS_ROOM', // which tables/rooms can be booked online
  'booking.openTime': '12:00',
  'booking.closeTime': '02:00', // earlier than openTime = closes after midnight
  'booking.slotMinutes': 30,
  'booking.durations': '60,90,120,180',
  'booking.maxDaysAhead': 14,
  'booking.minLeadMinutes': 30,
  'booking.depositCents.BILLIARDS_TABLE': 10000,
  'booking.depositCents.PS_ROOM': 10000,
  'booking.depositHoldMinutes': 120, // unpaid online bookings are released after this
  'booking.instapay': '', // InstaPay address shown to customers, e.g. goblinsyard@instapay
  'booking.wallet': '', // mobile wallet number, e.g. Vodafone Cash
  'booking.liveSessionBufferMinutes': 60, // a running game counts as busy at least this long
  'business.currency': 'EGP',
  'business.timezone': 'Africa/Cairo',
  'business.openHoursPerDay': 12, // used for billiards/PS occupancy %
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
