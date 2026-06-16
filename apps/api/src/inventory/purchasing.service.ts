import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from './stock.service';

const D = Prisma.Decimal;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async suppliers(all = false) {
    const where = all ? {} : { isActive: true };
    return this.prisma.supplier.findMany({ where, orderBy: { name: 'asc' } });
  }

  async createSupplier(userId: string, params: { name: string; phone?: string; email?: string; taxId?: string; notes?: string }) {
    const s = await this.prisma.supplier.create({
      data: {
        name: params.name,
        phone: params.phone || null,
        email: params.email || null,
        taxId: params.taxId || null,
        notes: params.notes || null,
      },
    });
    await this.audit.log({
      userId, action: 'supplier.create', entity: 'Supplier', entityId: s.id,
      detail: { name: s.name },
    });
    return s;
  }

  async updateSupplier(userId: string, id: string, params: { name?: string; phone?: string; email?: string; taxId?: string; notes?: string; isActive?: boolean }) {
    const s = await this.prisma.supplier.update({
      where: { id },
      data: {
        name: params.name,
        phone: params.phone !== undefined ? (params.phone || null) : undefined,
        email: params.email !== undefined ? (params.email || null) : undefined,
        taxId: params.taxId !== undefined ? (params.taxId || null) : undefined,
        notes: params.notes !== undefined ? (params.notes || null) : undefined,
        isActive: params.isActive,
      },
    });
    await this.audit.log({
      userId, action: 'supplier.update', entity: 'Supplier', entityId: s.id,
      detail: { name: s.name },
    });
    return s;
  }

  async deleteSupplier(userId: string, id: string) {
    const s = await this.prisma.supplier.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId, action: 'supplier.delete', entity: 'Supplier', entityId: s.id,
      detail: { name: s.name },
    });
    return s;
  }

  async listPOs() {
    return this.prisma.purchaseOrder.findMany({
      include: { supplier: true, lines: { include: { ingredient: { include: { uom: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async createPO(params: {
    supplierId: string;
    userId: string;
    lines: { ingredientId: string; quantity: number; unitCostCents: number }[];
    expectedAt?: string;
    notes?: string;
  }) {
    if (!params.lines.length) throw new BadRequestException('PO needs lines');
    const po = await this.prisma.purchaseOrder.create({
      data: {
        supplierId: params.supplierId,
        status: 'SENT',
        expectedAt: params.expectedAt ? new Date(params.expectedAt) : undefined,
        notes: params.notes,
        lines: {
          create: params.lines.map((l) => ({
            ingredientId: l.ingredientId,
            quantity: new D(l.quantity),
            unitCostCents: new D(l.unitCostCents),
          })),
        },
      },
      include: { lines: true, supplier: true },
    });
    await this.audit.log({
      userId: params.userId, action: 'purchase.create', entity: 'PurchaseOrder', entityId: po.id,
      detail: { supplier: po.supplier.name, lines: params.lines.length },
    });
    return po;
  }

  /**
   * Receive goods (full or partial) against a PO into a location.
   * Creates batches (expiry for perishables), updates moving-average cost,
   * and records supplier price history.
   */
  async receive(params: {
    poId: string;
    locationId: string;
    userId: string;
    lines: { poLineId: string; quantity: number; unitCostCents?: number; expiresAt?: string; lotCode?: string }[];
    invoiceNumber?: string;
    accountId?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: params.poId },
        include: { lines: { include: { ingredient: true } }, supplier: true },
      });
      if (po.status === 'CANCELLED' || po.status === 'RECEIVED') {
        throw new BadRequestException(`PO is ${po.status}`);
      }
      const receipt = await tx.goodsReceipt.create({
        data: {
          poId: po.id,
          accountId: params.accountId || null,
        },
      });

      let receivedTotalCents = 0;

      for (const input of params.lines) {
        const line = po.lines.find((l) => l.id === input.poLineId);
        if (!line) throw new BadRequestException('Unknown PO line');
        const qty = new D(input.quantity);
        if (qty.lte(0)) continue;
        const outstanding = new D(line.quantity).minus(new D(line.receivedQty));
        if (qty.gt(outstanding)) {
          throw new BadRequestException(`Over-receiving ${line.ingredient.name}: outstanding ${outstanding}`);
        }
        const unitCost = new D(input.unitCostCents ?? line.unitCostCents);

        receivedTotalCents += Math.round(Number(input.quantity) * Number(input.unitCostCents ?? line.unitCostCents));

        // batch (expiry optional)
        const batch = await tx.batch.create({
          data: {
            ingredientId: line.ingredientId,
            lotCode: input.lotCode,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            initialQty: qty,
            remainingQty: qty,
          },
        });
        await this.stock.move(tx, {
          ingredientId: line.ingredientId,
          kind: 'RECEIPT',
          quantity: qty,
          toLocationId: params.locationId,
          unitCostCents: unitCost,
          goodsReceiptId: receipt.id,
          batchId: batch.id,
        });
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { receivedQty: { increment: qty } },
        });

        // moving-average cost: (oldQty*oldCost + newQty*newCost) / total
        const totals = await tx.stockLevel.aggregate({
          where: { ingredientId: line.ingredientId },
          _sum: { quantity: true },
        });
        const totalQty = new D(totals._sum.quantity ?? 0);
        const oldQty = totalQty.minus(qty);
        const oldCost = new D(line.ingredient.avgCostCents);
        const newAvg = oldQty.gt(0)
          ? oldQty.mul(oldCost).plus(qty.mul(unitCost)).div(totalQty)
          : unitCost;
        await tx.ingredient.update({
          where: { id: line.ingredientId },
          data: { avgCostCents: newAvg, lastCostCents: unitCost },
        });
        await tx.supplierPriceHistory.create({
          data: { supplierId: po.supplierId, ingredientId: line.ingredientId, unitCostCents: unitCost },
        });
      }

      // PO status
      const fresh = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: po.id },
        include: { lines: true },
      });
      const fullyReceived = fresh.lines.every((l) => new D(l.receivedQty).gte(new D(l.quantity)));
      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      if (params.invoiceNumber) {
        const totalCents = fresh.lines.reduce(
          (a, l) => a + Math.round(Number(l.unitCostCents) * Number(l.receivedQty)),
          0,
        );
        const invoice = await tx.supplierInvoice.create({
          data: {
            supplierId: po.supplierId,
            number: params.invoiceNumber,
            totalCents,
            invoiceDate: new Date(),
          },
        });
        await tx.goodsReceipt.update({ where: { id: receipt.id }, data: { invoiceId: invoice.id } });
      }

      if (params.accountId && receivedTotalCents > 0) {
        const invAccount = await tx.account.findUnique({ where: { code: '1400' } });
        const payAccount = await tx.account.findUnique({ where: { id: params.accountId } });

        if (invAccount && payAccount) {
          await tx.journalEntry.create({
            data: {
              description: `PO Receipt: ${po.supplier.name} (PO #${po.number})`,
              reference: `GoodsReceipt #${receipt.id}`,
              date: new Date(),
              lines: {
                create: [
                  {
                    accountId: invAccount.id,
                    debitCents: receivedTotalCents,
                    creditCents: 0,
                  },
                  {
                    accountId: payAccount.id,
                    debitCents: 0,
                    creditCents: receivedTotalCents,
                  },
                ],
              },
            },
          });
        }
      }

      await this.audit.log(
        { userId: params.userId, action: 'purchase.receive', entity: 'GoodsReceipt', entityId: receipt.id,
          detail: { poId: po.id, lines: params.lines.length } },
        tx,
      );
      return tx.goodsReceipt.findUniqueOrThrow({
        where: { id: receipt.id },
        include: { movements: { include: { ingredient: true } } },
      });
    });
  }

  async listGoodsReceipts() {
    return this.prisma.goodsReceipt.findMany({
      include: {
        po: { include: { supplier: true } },
        account: true,
        invoice: true,
        movements: { include: { ingredient: { include: { uom: true } } } },
      },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async updateGoodsReceipt(id: string, userId: string, params: { accountId?: string; invoiceNumber?: string; notes?: string }) {
    const existing = await this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id },
      include: { po: { include: { supplier: true } }, invoice: true }
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Update notes and accountId on GoodsReceipt
      const receipt = await tx.goodsReceipt.update({
        where: { id },
        data: {
          accountId: params.accountId !== undefined ? (params.accountId || null) : undefined,
          notes: params.notes !== undefined ? (params.notes || null) : undefined,
        },
      });

      // 2. Handle invoice update
      if (params.invoiceNumber !== undefined) {
        if (existing.invoiceId) {
          await tx.supplierInvoice.update({
            where: { id: existing.invoiceId },
            data: { number: params.invoiceNumber },
          });
        } else if (params.invoiceNumber && existing.poId) {
          const freshReceipt = await tx.goodsReceipt.findUniqueOrThrow({
            where: { id },
            include: { movements: true }
          });
          const totalCents = freshReceipt.movements.reduce(
            (sum, m) => sum + Math.round(Number(m.quantity) * Number(m.unitCostCents)),
            0,
          );
          const invoice = await tx.supplierInvoice.create({
            data: {
              supplierId: existing.po!.supplierId,
              number: params.invoiceNumber,
              totalCents,
              invoiceDate: new Date(),
            },
          });
          await tx.goodsReceipt.update({
            where: { id },
            data: { invoiceId: invoice.id },
          });
        }
      }

      // 3. Update JournalEntry credit line if accountId updated
      const ref = `GoodsReceipt #${id}`;
      const entry = await tx.journalEntry.findFirst({
        where: { reference: ref },
        include: { lines: true }
      });

      if (entry) {
        const creditLine = entry.lines.find(l => l.creditCents > 0);
        if (creditLine && params.accountId) {
          const payAccount = await tx.account.findUnique({ where: { id: params.accountId } });
          if (payAccount) {
            await tx.journalLine.update({
              where: { id: creditLine.id },
              data: { accountId: payAccount.id }
            });
          }
        } else if (creditLine && params.accountId === null) {
          await tx.journalEntry.delete({ where: { id: entry.id } });
        }
      } else if (params.accountId && !entry) {
        const freshReceipt = await tx.goodsReceipt.findUniqueOrThrow({
          where: { id },
          include: { movements: true }
        });
        const receivedTotalCents = freshReceipt.movements.reduce(
          (sum, m) => sum + Math.round(Number(m.quantity) * Number(m.unitCostCents)),
          0,
        );
        const invAccount = await tx.account.findUnique({ where: { code: '1400' } });
        const payAccount = await tx.account.findUnique({ where: { id: params.accountId } });

        if (invAccount && payAccount && receivedTotalCents > 0) {
          await tx.journalEntry.create({
            data: {
              description: `PO Receipt: ${existing.po!.supplier.name} (PO #${existing.po!.number})`,
              reference: ref,
              date: new Date(),
              lines: {
                create: [
                  {
                    accountId: invAccount.id,
                    debitCents: receivedTotalCents,
                    creditCents: 0,
                  },
                  {
                    accountId: payAccount.id,
                    debitCents: 0,
                    creditCents: receivedTotalCents,
                  },
                ],
              },
            },
          });
        }
      }

      return receipt;
    });

    await this.audit.log({
      userId, action: 'purchase.receive.update', entity: 'GoodsReceipt', entityId: id,
      detail: { notes: params.notes, accountId: params.accountId }
    });
    return updated;
  }

  async deleteGoodsReceipt(id: string, userId: string) {
    const receipt = await this.prisma.goodsReceipt.findUniqueOrThrow({
      where: { id },
      include: {
        po: true,
        movements: { include: { ingredient: true } },
      },
    });

    await this.prisma.$transaction(async (tx) => {
      // 1. Revert stock levels, poLine receivedQty, and recalculate avgCostCents
      for (const m of receipt.movements) {
        const qty = new D(m.quantity);
        const unitCost = new D(m.unitCostCents);

        if (m.toLocationId) {
          await tx.stockLevel.upsert({
            where: { ingredientId_locationId: { ingredientId: m.ingredientId, locationId: m.toLocationId } },
            update: { quantity: { decrement: qty } },
            create: { ingredientId: m.ingredientId, locationId: m.toLocationId, quantity: qty.neg() },
          });
        }

        if (receipt.poId) {
          const poLine = await tx.purchaseOrderLine.findFirst({
            where: { poId: receipt.poId, ingredientId: m.ingredientId },
          });
          if (poLine) {
            await tx.purchaseOrderLine.update({
              where: { id: poLine.id },
              data: { receivedQty: { decrement: qty } },
            });
          }
        }

        const totals = await tx.stockLevel.aggregate({
          where: { ingredientId: m.ingredientId },
          _sum: { quantity: true },
        });
        const currentQty = new D(totals._sum.quantity ?? 0);
        if (currentQty.gt(0)) {
          const currentAvg = new D(m.ingredient.avgCostCents);
          const oldAvg = currentQty.plus(qty).mul(currentAvg).minus(qty.mul(unitCost)).div(currentQty);
          await tx.ingredient.update({
            where: { id: m.ingredientId },
            data: { avgCostCents: oldAvg.lt(0) ? 0 : oldAvg },
          });
        }
      }

      // 2. Delete StockMovements
      await tx.stockMovement.deleteMany({ where: { goodsReceiptId: id } });

      // 3. Delete Batches
      const batchIds = receipt.movements.map(m => m.batchId).filter(Boolean) as string[];
      if (batchIds.length > 0) {
        await tx.batch.deleteMany({ where: { id: { in: batchIds } } });
      }

      // 4. Delete SupplierPriceHistory records
      if (receipt.poId) {
        const ingredientIds = receipt.movements.map(m => m.ingredientId);
        await tx.supplierPriceHistory.deleteMany({
          where: {
            supplierId: receipt.po!.supplierId,
            ingredientId: { in: ingredientIds },
          },
        });
      }

      // 5. Delete SupplierInvoice if linked
      if (receipt.invoiceId) {
        await tx.goodsReceipt.update({
          where: { id },
          data: { invoiceId: null },
        });
        await tx.supplierInvoice.delete({ where: { id: receipt.invoiceId } });
      }

      // 6. Delete associated JournalEntry
      const ref = `GoodsReceipt #${id}`;
      const entry = await tx.journalEntry.findFirst({
        where: { reference: ref }
      });
      if (entry) {
        await tx.journalEntry.delete({ where: { id: entry.id } });
      }

      // 7. Delete GoodsReceipt itself
      await tx.goodsReceipt.delete({ where: { id } });

      // 8. Recompute PO status
      if (receipt.poId) {
        const freshPo = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: receipt.poId },
          include: { lines: true },
        });
        const fullyReceived = freshPo.lines.every((l) => new D(l.receivedQty).gte(new D(l.quantity)));
        const someReceived = freshPo.lines.some((l) => new D(l.receivedQty).gt(0));
        await tx.purchaseOrder.update({
          where: { id: receipt.poId },
          data: { status: fullyReceived ? 'RECEIVED' : someReceived ? 'PARTIALLY_RECEIVED' : 'SENT' },
        });
      }
    });

    await this.audit.log({
      userId, action: 'purchase.receive.delete', entity: 'GoodsReceipt', entityId: id,
      detail: { poId: receipt.poId }
    });
    return { success: true };
  }
}
