import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { AuthedRequest, RequirePermissions } from '../auth/auth.guard';
import { SettingsService } from './settings.service';

/** Credentials that only settings managers may read (everyone else gets them blanked out). */
const SECRET_KEY = /(authToken|accountSid|token|secret|password|apiKey)$/i;

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Any signed-in user can read settings (POS/KDS need receipt text, logo, tax
   * rates…), but credentials are only returned to users with settings.manage.
   */
  @Get()
  async getAll(@Req() req: AuthedRequest) {
    const all = await this.settings.getAll();
    if (req.user.permissions.includes('settings.manage')) return all;
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(all)) {
      if (!SECRET_KEY.test(key)) safe[key] = value;
    }
    return safe;
  }

  @Put()
  @RequirePermissions('settings.manage')
  async update(@Body() body: Record<string, unknown>) {
    for (const [key, value] of Object.entries(body)) {
      await this.settings.set(key, value as never);
    }
    return this.settings.getAll();
  }
}
