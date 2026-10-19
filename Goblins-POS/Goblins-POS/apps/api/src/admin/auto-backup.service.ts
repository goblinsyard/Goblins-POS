import { Injectable, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { backupsDir as backupsDir_ } from './backup-dir';
import { appendMediaToSqlBackup } from '../media/media';

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
    
    // Daily automatic backups are on unless an owner has turned them off in Settings.
    const config = (configSetting?.value as any) || {
      enabled: true,
      intervalHours: 24,
      keepCount: 14,
    };

    // 2. Unschedule if already scheduled
    this.stopScheduledBackup();

    // 3. Schedule if enabled
    // Check hourly (and shortly after start-up) whether the newest automatic
    // backup is older than the interval. A fixed timer alone would never fire
    // on a PC that is switched off every night.
    if (config.enabled && config.intervalHours > 0) {
      const dueMs = config.intervalHours * 60 * 60 * 1000;
      const check = () => {
        if (Date.now() - this.newestAutoBackupMs() >= dueMs) void this.runBackup();
      };
      const interval = setInterval(check, 60 * 60 * 1000);
      this.schedulerRegistry.addInterval(this.intervalName, interval);
      setTimeout(check, 60_000);
      console.log(`[AutoBackupService] Auto backup every ${config.intervalHours} h into ${backupsDir_()}`);
    }
  }

  /** mtime of the newest goblins-auto-*.sql, or 0 when there is none. */
  private newestAutoBackupMs(): number {
    const dir = backupsDir_();
    let newest = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith('goblins-auto-') || !f.endsWith('.sql')) continue;
      newest = Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs);
    }
    return newest;
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
    const keepCount = config.keepCount || 14;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupsDir = backupsDir_();
    const file = path.join(backupsDir, `goblins-auto-${stamp}.sql`);
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      console.error('[AutoBackupService] DATABASE_URL is not set.');
      return;
    }

    try {
      await execAsync(`pg_dump "${dbUrl}" --clean --if-exists -f "${file}"`);
      appendMediaToSqlBackup(file);
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
