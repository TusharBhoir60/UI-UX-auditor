import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { RegisterDto, LoginDto } from './dto';

// Pre-computed 10-round bcrypt hash used to normalize execution time
// when an account does not exist or has been soft-deleted.
const DUMMY_BCRYPT_HASH =
  '$2b$10$AKrsf//tT78jIPat05/1PeR0L/jSNW5egbiStvVP6opucTg0jAIHW';

export interface RegisterResult {
  id: string;
  email: string;
}

export interface LoginResult {
  access_token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Canonicalizes email addresses by trimming surrounding whitespace and converting to lowercase.
   * Applied consistently across registration and login to ensure identity normalization.
   */
  canonicalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async register(dto: RegisterDto): Promise<RegisterResult> {
    const email = this.canonicalizeEmail(dto.email);

    // Check for existing user (active or soft-deleted)
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      throw new BadRequestException('Email is already registered');
    }

    const saltRounds = this.configService.get<number>('BCRYPT_SALT_ROUNDS', 10);
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
        },
      });

      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Email is already registered');
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const email = this.canonicalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user || user.deletedAt !== null) {
      // Execute dummy bcrypt comparison to reduce timing discrepancy against non-existent accounts
      await bcrypt.compare(dto.password, DUMMY_BCRYPT_HASH);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      access_token: accessToken,
    };
  }
}
