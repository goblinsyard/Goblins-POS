import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ImportExportController } from './import-export.controller';
import { AutoBackupService } from './auto-backup.service';
import { CostingModule } from '../costing/costing.module';

@Module({
  imports: [CostingModule],
  controllers: [AdminController, ImportExportController],
  providers: [AutoBackupService],
  exports: [AutoBackupService],
})
export class AdminModule {}
