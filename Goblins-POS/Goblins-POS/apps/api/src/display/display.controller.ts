import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public, RequirePermissions } from '../auth/auth.guard';

/**
 * Relay for the customer-facing screen when it runs on a different device than
 * the POS (an iPad at the till and a tablet facing the guest). The POS posts the
 * current order under a random 6-character pairing code; the display polls it.
 * Kept in memory only: it is a live view, not a record.
 */
const CODE = /^[A-Z0-9]{6}$/;
const MAX_BYTES = 32_000;
const TTL_MS = 12 * 3600_000;
const states = new Map<string, { at: number; state: unknown }>();

function checkCode(code: string): string {
  const c = (code ?? '').toUpperCase();
  if (!CODE.test(c)) throw new BadRequestException('Invalid display code');
  return c;
}

@Controller('display')
export class DisplayController {
  @Post(':code')
  @RequirePermissions('pos.use')
  publish(@Param('code') code: string, @Body() body: Record<string, unknown>) {
    const c = checkCode(code);
    const kind = body?.kind;
    if (kind !== 'order' && kind !== 'idle' && kind !== 'thanks') throw new BadRequestException('Invalid display state');
    if (JSON.stringify(body).length > MAX_BYTES) throw new BadRequestException('Display state too large');
    const now = Date.now();
    for (const [k, v] of states) if (now - v.at > TTL_MS) states.delete(k);
    states.set(c, { at: now, state: body });
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get(':code')
  read(@Param('code') code: string) {
    const hit = states.get(checkCode(code));
    if (!hit || Date.now() - hit.at > TTL_MS) throw new NotFoundException('No display state yet');
    return hit.state;
  }
}
