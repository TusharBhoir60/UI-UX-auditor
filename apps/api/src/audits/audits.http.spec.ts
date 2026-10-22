import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../database/prisma.service';

const TEST_JWT_SECRET = 'deterministic-test-jwt-secret-min-32-chars-long';
const TAMPERED_JWT_SECRET = 'tampered-jwt-secret-used-to-test-invalid-signature';

interface StoredAudit {
  id: string;
  userId: string;
  url: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  failureReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

describe('Audits Endpoints HTTP-Level Integration & Ownership Isolation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  let tamperedJwtService: JwtService;

  // In-memory database store for clean cross-user isolation
  let auditStore: StoredAudit[] = [];

  const USER_A_ID = '11111111-1111-4111-8111-111111111111';
  const USER_B_ID = '22222222-2222-4222-8222-222222222222';
  const NONEXISTENT_AUDIT_ID = '99999999-9999-4999-8999-999999999999';

  let userAToken: string;
  let userBToken: string;
  let tamperedToken: string;
  let expiredToken: string;

  beforeAll(async () => {
    const mockPrismaService = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: string } }) => {
          if (where.id === USER_A_ID) {
            return Promise.resolve({
              id: USER_A_ID,
              email: 'user.a@example.com',
              deletedAt: null,
            });
          }
          if (where.id === USER_B_ID) {
            return Promise.resolve({
              id: USER_B_ID,
              email: 'user.b@example.com',
              deletedAt: null,
            });
          }
          return Promise.resolve(null);
        }),
      },
      audit: {
        create: jest.fn(
          ({
            data,
            select,
          }: {
            data: { userId: string; url: string; status: 'queued' };
            select?: Record<string, boolean>;
          }) => {
            const record: StoredAudit = {
              id: randomUUID(),
              userId: data.userId,
              url: data.url,
              status: data.status,
              failureReason: null,
              createdAt: new Date(),
              completedAt: null,
            };
            auditStore.push(record);
            if (select) {
              const res: Record<string, unknown> = {};
              if (select.id) res.id = record.id;
              if (select.status) res.status = record.status;
              return Promise.resolve(res);
            }
            return Promise.resolve(record);
          },
        ),
        findMany: jest.fn(
          ({
            where,
            orderBy,
          }: {
            where: { userId: string };
            orderBy?: { createdAt: 'asc' | 'desc' };
          }) => {
            let matches = auditStore.filter((a) => a.userId === where.userId);
            if (orderBy?.createdAt === 'desc') {
              matches = matches.sort(
                (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
              );
            }
            return Promise.resolve(matches);
          },
        ),
        findFirst: jest.fn(
          ({
            where,
          }: {
            where: { id: string; userId: string };
          }) => {
            const match = auditStore.find(
              (a) => a.id === where.id && a.userId === where.userId,
            );
            return Promise.resolve(match || null);
          },
        ),
      },
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
        }),
      ],
      controllers: [AuditsController],
      providers: [
        AuditsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
              return null;
            }),
          },
        },
        JwtStrategy,
        JwtAuthGuard,
      ],
    }).compile();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    // Create a separate signer for tampered signature tests
    const tamperedModule: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TAMPERED_JWT_SECRET,
          signOptions: { algorithm: 'HS256', expiresIn: '1h' },
        }),
      ],
    }).compile();
    tamperedJwtService = tamperedModule.get<JwtService>(JwtService);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === 'string' ? address : address.port;
    baseUrl = `http://localhost:${port}/api/v1/audits`;

    userAToken = jwtService.sign({
      sub: USER_A_ID,
      email: 'user.a@example.com',
    });

    userBToken = jwtService.sign({
      sub: USER_B_ID,
      email: 'user.b@example.com',
    });

    tamperedToken = tamperedJwtService.sign({
      sub: USER_A_ID,
      email: 'user.a@example.com',
    });

    expiredToken = jwtService.sign(
      { sub: USER_A_ID, email: 'user.a@example.com' },
      { expiresIn: '-1s' },
    );
  });

  beforeEach(() => {
    // Reset in-memory store before each test to maintain clean isolation
    auditStore = [];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Authentication Enforcement (401 on Missing or Invalid JWT)', () => {
    const endpoints = [
      { method: 'POST', path: '' },
      { method: 'GET', path: '' },
      { method: 'GET', path: '/00000000-0000-4000-8000-000000000000' },
      { method: 'GET', path: '/00000000-0000-4000-8000-000000000000/status' },
    ];

    for (const ep of endpoints) {
      it(`${ep.method} /api/v1/audits${ep.path} returns 401 when Authorization header is missing`, async () => {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: ep.method === 'POST' ? { 'Content-Type': 'application/json' } : {},
          body: ep.method === 'POST' ? JSON.stringify({ url: 'https://example.com' }) : undefined,
        });
        expect(res.status).toBe(401);
      });

      it(`${ep.method} /api/v1/audits${ep.path} returns 401 when token is tampered/invalid`, async () => {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            Authorization: `Bearer ${tamperedToken}`,
            ...(ep.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: ep.method === 'POST' ? JSON.stringify({ url: 'https://example.com' }) : undefined,
        });
        expect(res.status).toBe(401);
      });

      it(`${ep.method} /api/v1/audits${ep.path} returns 401 when token is expired`, async () => {
        const res = await fetch(`${baseUrl}${ep.path}`, {
          method: ep.method,
          headers: {
            Authorization: `Bearer ${expiredToken}`,
            ...(ep.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
          },
          body: ep.method === 'POST' ? JSON.stringify({ url: 'https://example.com' }) : undefined,
        });
        expect(res.status).toBe(401);
      });
    }
  });

  describe('2. POST /api/v1/audits: Creation, Validation & Client userId Rejection', () => {
    it('creates an audit record returning 201 with { audit_id, status: "queued" }', async () => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a.example.com' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toHaveProperty('audit_id');
      expect(typeof data.audit_id).toBe('string');
      expect(data.status).toBe('queued');

      // Verify the record in store is bound to User A
      expect(auditStore).toHaveLength(1);
      expect(auditStore[0].userId).toBe(USER_A_ID);
      expect(auditStore[0].url).toBe('https://user-a.example.com');
      expect(auditStore[0].status).toBe('queued');
    });

    it('rejects client-supplied userId with 400 Bad Request', async () => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({
          url: 'https://example.com',
          userId: USER_B_ID,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toEqual(
        expect.arrayContaining([expect.stringContaining('property userId should not exist')]),
      );
      expect(auditStore).toHaveLength(0);
    });

    it('rejects missing url with 400 Bad Request', async () => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      expect(auditStore).toHaveLength(0);
    });

    it('rejects malformed url with 400 Bad Request', async () => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'not-a-valid-http-url' }),
      });
      expect(res.status).toBe(400);
      expect(auditStore).toHaveLength(0);
    });

    it('rejects unsupported protocol (ftp://) with 400 Bad Request', async () => {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'ftp://ftp.example.com/resource' }),
      });
      expect(res.status).toBe(400);
      expect(auditStore).toHaveLength(0);
    });
  });

  describe('3. Cross-User Listing Isolation (GET /api/v1/audits)', () => {
    it('returns only the requesting user audits and excludes other users audits', async () => {
      // User A creates 2 audits
      await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a-1.example.com' }),
      });

      await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a-2.example.com' }),
      });

      // User B creates 1 audit
      await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userBToken}`,
        },
        body: JSON.stringify({ url: 'https://user-b.example.com' }),
      });

      expect(auditStore).toHaveLength(3);

      // User A requests audit list
      const resA = await fetch(baseUrl, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resA.status).toBe(200);
      const listA = await resA.json();
      expect(listA).toHaveLength(2);
      expect(listA.map((item: { url: string }) => item.url)).toEqual([
        'https://user-a-2.example.com',
        'https://user-a-1.example.com',
      ]);
      // Verify exact documented response shape
      for (const item of listA) {
        expect(item).toHaveProperty('audit_id');
        expect(item).toHaveProperty('url');
        expect(item).toHaveProperty('status', 'queued');
        expect(item).toHaveProperty('created_at');
        expect(item).toHaveProperty('summary_counts', null);
        expect(item).not.toHaveProperty('userId');
      }

      // User B requests audit list
      const resB = await fetch(baseUrl, {
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      expect(resB.status).toBe(200);
      const listB = await resB.json();
      expect(listB).toHaveLength(1);
      expect(listB[0].url).toBe('https://user-b.example.com');
    });

    it('returns empty array when user has no audits', async () => {
      const res = await fetch(baseUrl, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });
  });

  describe('4. Cross-User Detail Isolation (GET /api/v1/audits/:auditId)', () => {
    it('returns audit detail for owned audit and returns 404 for another user audit', async () => {
      // User A creates Audit A
      const createResA = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a.example.com' }),
      });
      const { audit_id: auditAId } = await createResA.json();

      // User B creates Audit B
      const createResB = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userBToken}`,
        },
        body: JSON.stringify({ url: 'https://user-b.example.com' }),
      });
      const { audit_id: auditBId } = await createResB.json();

      // User A can access Audit A
      const resOwn = await fetch(`${baseUrl}/${auditAId}`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resOwn.status).toBe(200);
      const detailA = await resOwn.json();
      expect(detailA).toEqual({
        audit_id: auditAId,
        url: 'https://user-a.example.com',
        status: 'queued',
        failure_reason: null,
        created_at: expect.any(String),
        completed_at: null,
        report: null,
      });

      // User A attempts to access User B's Audit B -> 404 Not Found
      const resCrossUser = await fetch(`${baseUrl}/${auditBId}`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resCrossUser.status).toBe(404);
      const crossData = await resCrossUser.json();
      expect(crossData.message).toBe('Audit not found');

      // User A attempts to access nonexistent audit -> identical 404 Not Found
      const resNonexistent = await fetch(`${baseUrl}/${NONEXISTENT_AUDIT_ID}`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resNonexistent.status).toBe(404);
      const nonexistentData = await resNonexistent.json();
      expect(nonexistentData.message).toBe('Audit not found');

      // Responses must be completely indistinguishable (anti-enumeration)
      expect(crossData).toEqual(nonexistentData);
    });

    it('returns 400 Bad Request for malformed UUID before database query', async () => {
      const res = await fetch(`${baseUrl}/not-a-valid-uuid`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Validation failed');
    });
  });

  describe('5. Cross-User Status Isolation (GET /api/v1/audits/:auditId/status)', () => {
    it('returns status for owned audit and returns 404 for another user audit', async () => {
      // User A creates Audit A
      const createResA = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a.example.com' }),
      });
      const { audit_id: auditAId } = await createResA.json();

      // User B creates Audit B
      const createResB = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userBToken}`,
        },
        body: JSON.stringify({ url: 'https://user-b.example.com' }),
      });
      const { audit_id: auditBId } = await createResB.json();

      // User A accesses status of Audit A
      const resOwn = await fetch(`${baseUrl}/${auditAId}/status`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resOwn.status).toBe(200);
      const statusA = await resOwn.json();
      expect(statusA).toEqual({
        status: 'queued',
        stage: 'queued',
        failure_reason: null,
      });

      // User A accesses status of User B's Audit B -> 404 Not Found
      const resCrossUser = await fetch(`${baseUrl}/${auditBId}/status`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resCrossUser.status).toBe(404);
      const crossData = await resCrossUser.json();
      expect(crossData.message).toBe('Audit not found');

      // User A accesses status of nonexistent audit -> identical 404 Not Found
      const resNonexistent = await fetch(
        `${baseUrl}/${NONEXISTENT_AUDIT_ID}/status`,
        {
          headers: { Authorization: `Bearer ${userAToken}` },
        },
      );
      expect(resNonexistent.status).toBe(404);
      const nonexistentData = await resNonexistent.json();
      expect(nonexistentData.message).toBe('Audit not found');

      expect(crossData).toEqual(nonexistentData);
    });

    it('returns 400 Bad Request for malformed UUID before database query', async () => {
      const res = await fetch(`${baseUrl}/bad-uuid-format/status`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Validation failed');
    });
  });
});
