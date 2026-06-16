import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ImportExportController } from './import-export.controller';
import { AutoBackupService } from './auto-backup.service';

@Module({
  controllers: [AdminController, ImportExportController],
  providers: [AutoBackupService],
  exports: [AutoBackupService],
})
export class AdminModule {}
