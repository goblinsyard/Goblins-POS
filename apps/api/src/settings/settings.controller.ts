import { Body, Controller, Get, Put } from '@nestjs/common';
import { RequirePermissions } from '../auth/auth.guard';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getAll() {
    return this.settings.getAll();
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
