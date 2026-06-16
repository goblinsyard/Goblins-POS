import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    try {
      const { PERMISSIONS, PERMISSION_GROUPS, DEFAULT_ROLE_PERMISSIONS } = await import(
        '@goblins/shared'
      );
      const groupOf: Record<string, string> = {};
      for (const [group, ids] of Object.entries(PERMISSION_GROUPS)) {
        for (const id of ids) groupOf[id] = group;
      }
      for (const [id, label] of Object.entries(PERMISSIONS)) {
        await this.permission.upsert({
          where: { id },
          update: { label, group: groupOf[id] ?? 'Other' },
          create: { id, label, group: groupOf[id] ?? 'Other' },
        });
      }

      const allPermIds = Object.keys(PERMISSIONS);
      for (const [roleName, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
        const role = await this.role.findUnique({ where: { name: roleName } });
        if (role) {
          const expectedPerms = perms === 'ALL' ? allPermIds : perms;
          const existing = await this.rolePermission.findMany({
            where: { roleId: role.id },
            select: { permissionId: true },
          });
          const existingIds = existing.map((ep) => ep.permissionId);
          const missing = expectedPerms.filter((p) => !existingIds.includes(p));
          if (missing.length > 0) {
            await this.rolePermission.createMany({
              data: missing.map((p) => ({ roleId: role.id, permissionId: p })),
              skipDuplicates: true,
            });
            console.log(`Synced ${missing.length} missing permissions for role: ${roleName} (including ${missing.join(', ')})`);
          }
        }
      }
    } catch (err) {
      console.error('Failed to sync permissions on startup:', err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
