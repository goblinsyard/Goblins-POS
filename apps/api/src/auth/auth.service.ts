import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string; // user id
  branchId: string;
  roleId: string;
  permissions: string[];
  name: string;
}

const REFRESH_TTL_MS = 30 * 24 * 3600_000; // 30 days

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** Back-office login: email + password. */
  async loginPassword(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: true } } },
    });
    if (!user?.passwordHash || !user.isActive) throw new UnauthorizedException();
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException();
    return this.issueTokens(user);
  }

  /** POS fast login: user id (tile tap) + PIN. */
  async loginPin(userId: string, pin: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { role: { include: { permissions: true } } },
    });
    if (!user?.pinHash || !user.isActive) throw new UnauthorizedException();
    const ok = await argon2.verify(user.pinHash, pin);
    if (!ok) throw new UnauthorizedException();
    return this.issueTokens(user);
  }

  /**
   * Manager-PIN approval for gated actions (void, discount...). Verifies the
   * PIN belongs to a user holding the required permission; returns approver id.
   */
  async approveWithPin(pin: string, requiredPermission: string): Promise<string> {
    const candidates = await this.prisma.user.findMany({
      where: { isActive: true, pinHash: { not: null } },
      include: { role: { include: { permissions: true } } },
    });
    for (const u of candidates) {
      if (!u.role.permissions.some((p) => p.permissionId === requiredPermission)) continue;
      if (await argon2.verify(u.pinHash!, pin)) return u.id;
    }
    throw new UnauthorizedException('No authorized user matches that PIN');
  }

  async refresh(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { role: { include: { permissions: true } } } } },
    });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || !stored.user.isActive) {
      throw new UnauthorizedException();
    }
    // rotate
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user);
  }

  async logout(refreshToken: string) {
    const tokenHash = sha256(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** POS login screen: list active users that have a PIN, for the tile grid. */
  async pinUsers(branchId?: string) {
    return this.prisma.user.findMany({
      where: { isActive: true, pinHash: { not: null }, ...(branchId ? { branchId } : {}) },
      select: { id: true, name: true, role: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  private async issueTokens(user: {
    id: string;
    branchId: string;
    roleId: string;
    name: string;
    language: string;
    role: { name: string; permissions: { permissionId: string }[] };
  }) {
    const payload: JwtPayload = {
      sub: user.id,
      branchId: user.branchId,
      roleId: user.roleId,
      permissions: user.role.permissions.map((p) => p.permissionId),
      name: user.name,
    };
    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        role: user.role.name,
        language: user.language,
        permissions: payload.permissions,
      },
    };
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
