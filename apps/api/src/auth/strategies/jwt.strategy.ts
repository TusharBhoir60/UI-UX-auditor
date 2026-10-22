import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../database/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

// Canonical RFC 4122 UUID validation pattern (8-4-4-4-12 hex characters)
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not configured');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
      algorithms: ['HS256'],
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedUser> {
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('sub' in payload) ||
      !('email' in payload) ||
      typeof (payload as Record<string, unknown>).sub !== 'string' ||
      typeof (payload as Record<string, unknown>).email !== 'string' ||
      !UUID_REGEX.test((payload as Record<string, unknown>).sub as string)
    ) {
      throw new UnauthorizedException('Invalid token payload');
    }

    const { sub, email } = payload as JwtPayload;

    // Verify user exists and is not soft-deleted
    const user = await this.prisma.user.findUnique({
      where: { id: sub },
      select: {
        id: true,
        email: true,
        deletedAt: true,
      },
    });

    if (!user || user.deletedAt !== null) {
      throw new UnauthorizedException('User account is invalid or deactivated');
    }

    return {
      id: user.id,
      email: user.email,
    };
  }
}
