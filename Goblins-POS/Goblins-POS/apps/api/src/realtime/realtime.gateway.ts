import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';

/**
 * CORS allowlist for the socket handshake. Mirrors the HTTP allowlist in
 * main.ts: set CORS_ORIGINS in production; reflect the origin in local dev.
 */
const wsAllowlist = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * Single Socket.IO gateway. Rooms:
 *  - "floor"        floor-plan status + live session costs
 *  - "kds:<stationId>"  station ticket streams
 *  - "expo"         expo/pass aggregate
 *  - "menu"         86 / availability pushes
 *  - "pos"          order updates, prepaid alerts
 *  - "print"        print jobs (print-service daemon, via WS_SERVICE_TOKEN)
 *
 * Connections must authenticate: a user JWT (browsers) or the WS_SERVICE_TOKEN
 * (the headless print-service). Enforced in production; in non-production an
 * unauthenticated connection is allowed with a warning so local dev keeps working.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: wsAllowlist.length ? wsAllowlist : true, credentials: true },
  path: '/ws',
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  handleConnection(client: Socket) {
    const isProd = process.env.NODE_ENV === 'production';
    // Token may arrive via socket.io `auth: { token }` (preferred) or `?token=`.
    const raw =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query.token as string | undefined) ??
      '';
    const token = raw.replace(/^Bearer\s+/i, '');

    const serviceToken = process.env.WS_SERVICE_TOKEN;
    const isService = !!serviceToken && token === serviceToken;
    let authed = isService;

    if (!authed && token) {
      try {
        this.jwt.verify(token);
        authed = true;
      } catch {
        authed = false;
      }
    }

    if (!authed) {
      if (isProd) {
        client.disconnect(true);
        return;
      }
      console.warn('[ws] unauthenticated connection allowed (non-production only)');
    }

    // clients declare rooms via auth/query: ?rooms=floor,kds:abc
    const rooms = String(client.handshake.query.rooms ?? '')
      .split(',')
      .filter(Boolean);
    for (const room of rooms) void client.join(room);
  }

  emitTo(room: string, event: string, payload: unknown) {
    this.server?.to(room).emit(event, payload);
  }

  emitAll(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }
}
