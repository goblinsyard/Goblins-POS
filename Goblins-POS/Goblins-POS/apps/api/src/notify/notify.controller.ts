import { Controller, Post } from '@nestjs/common';
import { RequirePermissions } from '../auth/auth.guard';
import { NotifyService } from './notify.service';

@Controller('notify')
export class NotifyController {
  constructor(private readonly notify: NotifyService) {}

  /** Back office "send test message" button. */
  @Post('test')
  @RequirePermissions('settings.manage')
  test() {
    return this.notify.sendToOwner('Goblins Yard POS: test message — owner notifications are working.');
  }
}
