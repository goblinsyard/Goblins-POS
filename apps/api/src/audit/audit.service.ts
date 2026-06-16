import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  approverId?: string | null;
  terminalId?: string | null;
  action: string; // e.g. "order.void"
  entity?: string;
  entityId?: string;
  detail?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Write an audit row. Accepts an optional transaction client so audit
   *  entries commit atomically with the action they record. */
  async log(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    
    let userId = entry.userId ?? null;
    if (userId) {
      const userExists = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!userExists) userId = null;
    }

    let approverId = entry.approverId ?? null;
    if (approverId) {
      const appExists = await this.prisma.user.findUnique({ where: { id: approverId } });
      if (!appExists) approverId = null;
    }

    let terminalId = entry.terminalId ?? null;
    if (terminalId) {
      const termExists = await this.prisma.terminal.findUnique({ where: { id: terminalId } });
      if (!termExists) terminalId = null;
    }

    let resourceName: string | null = null;
    try {
      if (entry.entity === 'Order' && entry.entityId) {
        const order = await client.order.findUnique({
          where: { id: entry.entityId },
          select: { resource: { select: { name: true } } },
        });
        if (order?.resource?.name) {
          resourceName = order.resource.name;
        }
      } else if (entry.entity === 'OrderItem' && entry.entityId) {
        const item = await client.orderItem.findUnique({
          where: { id: entry.entityId },
          select: { order: { select: { resource: { select: { name: true } } } } },
        });
        if (item?.order?.resource?.name) {
          resourceName = item.order.resource.name;
        }
      } else if (entry.entity === 'Session' && entry.entityId) {
        const session = await client.session.findUnique({
          where: { id: entry.entityId },
          select: { resource: { select: { name: true } } },
        });
        if (session?.resource?.name) {
          resourceName = session.resource.name;
        }
      }
    } catch (e) {
      console.error('Audit resource enrichment failed:', e);
    }

    let detail = entry.detail;
    if (resourceName) {
      if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
        (detail as any).resourceName = resourceName;
      } else if (!detail) {
        detail = { resourceName };
      }
    }

    await client.auditLog.create({
      data: {
        userId,
        approverId,
        terminalId,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId,
        detail,
      },
    });
  }

  async list(params: {
    action?: string;
    entity?: string;
    entityId?: string;
    userId?: string;
    from?: Date;
    to?: Date;
    take?: number;
    skip?: number;
  }) {
    return this.prisma.auditLog.findMany({
      where: {
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        userId: params.userId,
        createdAt: { gte: params.from, lte: params.to },
      },
      include: {
        user: { select: { name: true } },
        approver: { select: { name: true } },
        terminal: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
      skip: params.skip ?? 0,
    });
  }
}
