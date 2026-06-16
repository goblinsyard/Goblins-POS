import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * Single Socket.IO gateway. Rooms:
 *  - "floor"        floor-plan status + live session costs
 *  - "kds:<stationId>"  station ticket streams
 *  - "expo"         expo/pass aggregate
 *  - "menu"         86 / availability pushes
 *  - "pos"          order updates, prepaid alerts
 */
@Injectable()
@WebSocketGateway({ cors: { origin: true }, path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket) {
    // clients declare rooms via query: ?rooms=floor,kds:abc
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
