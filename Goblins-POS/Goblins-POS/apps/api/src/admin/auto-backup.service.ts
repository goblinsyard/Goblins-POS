import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

@Injectable()
export class AutoBackupService implements OnModuleInit {
  private readonly intervalName = 'auto-database-backup';

  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    await this.initScheduler();
  }

  async initScheduler() {
    // 1. Get config from settings
    const configSetting = await this.prisma.setting.findUnique({
      where: { key: 'db.autoBackupConfig' },
    });
    
    const config = (configSetting?.value as any) || {
      enabled: false,
      intervalHours: 24,
      keepCount: 10,
    };

    // 2. Unschedule if already scheduled
    this.stopScheduledBackup();

    // 3. Schedule if enabled
    if (config.enabled && config.intervalHours > 0) {
      const ms = config.intervalHours * 60 * 60 * 1000;
      const interval = setInterval(() => void this.runBackup(), ms);
      this.schedulerRegistry.addInterval(this.intervalName, interval);
      console.log(`[AutoBackupService] Scheduled auto backup every ${config.intervalHours} hours.`);
    }
  }

  stopScheduledBackup() {
    try {
      this.schedulerRegistry.deleteInterval(this.intervalName);
      console.log(`[AutoBackupService] Unscheduled active backup interval.`);
    } catch {
      // Ignored if not scheduled
    }
  }

  async runBackup() {
    console.log('[AutoBackupService] Starting auto database backup...');
    const configSetting = await this.prisma.setting.findUnique({
      where: { key: 'db.autoBackupConfig' },
    });
    const config = (configSetting?.value as any) || { keepCount: 10 };
    const keepCount = config.keepCount || 10;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const file = path.join(backupsDir, `goblins-auto-${stamp}.sql`);
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('[AutoBackupService] DATABASE_URL is not set.');
      return;
    }

    try {
      await execAsync(`pg_dump "${dbUrl}" --clean --if-exists -f "${file}"`);
      console.log(`[AutoBackupService] Auto backup created: goblins-auto-${stamp}.sql`);

      // Prune old auto backups (keep only up to keepCount)
      const files = fs.readdirSync(backupsDir)
        .filter((f) => f.startsWith('goblins-auto-') && f.endsWith('.sql'))
        .sort(); // oldest first

      if (files.length > keepCount) {
        const toDelete = files.slice(0, files.length - keepCount);
        for (const f of toDelete) {
          fs.unlinkSync(path.join(backupsDir, f));
          console.log(`[AutoBackupService] Pruned old backup file: ${f}`);
        }
      }
    } catch (e) {
      console.error('[AutoBackupService] Auto backup failed:', e);
    }
  }
}
