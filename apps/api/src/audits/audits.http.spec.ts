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
import { AuditQueueService } from '../queue/audit-queue.service';
import { AuditFindingsService } from './audit-findings.service';

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

interface StoredEvidence {
  id: string;
  issueId: string;
  domSelector: string | null;
  snippet: string | null;
  highlightedRegion: unknown;
  screenshotCropUrl: string | null;
  createdAt: Date;
}

interface StoredIssue {
  id: string;
  auditId: string;
  category: 'accessibility' | 'visual' | 'usability';
  title: string;
  description: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  confidence: 'deterministic' | 'high' | 'medium' | 'low';
  standardReference: string | null;
  recommendation: string;
  status: 'open' | 'acknowledged' | 'fixed';
  createdAt: Date;
  evidence?: StoredEvidence[];
}

describe('Audits Endpoints HTTP-Level Integration & Ownership Isolation', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  let tamperedJwtService: JwtService;

  // In-memory database store for clean cross-user isolation
  let auditStore: StoredAudit[] = [];
  let issueStore: StoredIssue[] = [];
  let evidenceStore: StoredEvidence[] = [];


  const USER_A_ID = '11111111-1111-4111-8111-111111111111';
  const USER_B_ID = '22222222-2222-4222-8222-222222222222';
  const NONEXISTENT_AUDIT_ID = '99999999-9999-4999-8999-999999999999';

  let userAToken: string;
  let userBToken: string;
  let tamperedToken: string;
  let expiredToken: string;

  const mockAuditQueueService = {
    addAuditJob: jest.fn().mockResolvedValue(undefined),
  };

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
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: { id: string; status?: string };
            data: Partial<StoredAudit>;
          }) => {
            let count = 0;
            for (const item of auditStore) {
              if (
                item.id === where.id &&
                (!where.status || item.status === where.status)
              ) {
                Object.assign(item, data);
                count++;
              }
            }
            return Promise.resolve({ count });
          },
        ),
      },
      issue: {
        findMany: jest.fn(({ where }: { where: { auditId: string } }) => {
          const matched = issueStore
            .filter((i) => i.auditId === where.auditId)
            .map((i) => ({
              ...i,
              evidence: evidenceStore.filter((e) => e.issueId === i.id),
            }));
          return Promise.resolve(matched);
        }),
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
        AuditFindingsService,
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
        {
          provide: AuditQueueService,
          useValue: mockAuditQueueService,
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
    issueStore = [];
    evidenceStore = [];
    mockAuditQueueService.addAuditJob.mockReset().mockResolvedValue(undefined);
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
      { method: 'GET', path: '/00000000-0000-4000-8000-000000000000/results' },
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
    it('creates an audit record returning 201 with { audit_id, status: "queued" } and dispatches queue job', async () => {
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

      // Verify queue dispatch was invoked with the created audit ID
      expect(mockAuditQueueService.addAuditJob).toHaveBeenCalledTimes(1);
      expect(mockAuditQueueService.addAuditJob).toHaveBeenCalledWith(data.audit_id);
    });

    it('returns 500 and updates audit status to failed when queue dispatch fails', async () => {
      mockAuditQueueService.addAuditJob.mockRejectedValueOnce(
        new Error('Redis connection refused'),
      );

      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://fail-enqueue.example.com' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.message).toBe('Failed to enqueue audit for processing');

      // Audit was created, and compensating update transitioned it to failed
      expect(auditStore).toHaveLength(1);
      expect(auditStore[0].status).toBe('failed');
      expect(auditStore[0].failureReason).toBe('Failed to enqueue audit for processing');
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

  describe('6. Cross-User Results & Findings Aggregation (GET /api/v1/audits/:auditId/results)', () => {
    it('returns audit results with aggregated counts, issues, and evidence for owned completed audit', async () => {
      // Create Audit A
      const createResA = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://user-a.example.com' }),
      });
      const { audit_id: auditAId } = await createResA.json();

      // Mark Audit A as complete in store
      const auditRec = auditStore.find((a) => a.id === auditAId)!;
      auditRec.status = 'complete';
      auditRec.completedAt = new Date('2026-10-23T02:00:00.000Z');

      // Add issues and evidence to stores
      const issueId1 = randomUUID();
      const issueId2 = randomUUID();

      issueStore.push(
        {
          id: issueId1,
          auditId: auditAId,
          category: 'accessibility',
          title: 'Button missing accessible name',
          description: '<button> lacks inner text or aria label',
          severity: 'Critical',
          confidence: 'deterministic',
          standardReference: 'WCAG 4.1.2',
          recommendation: 'Add accessible name',
          status: 'open',
          createdAt: new Date('2026-10-23T01:59:00.000Z'),
        },
        {
          id: issueId2,
          auditId: auditAId,
          category: 'visual',
          title: 'Heading order skipped',
          description: 'Heading skipped from h1 to h3',
          severity: 'Low',
          confidence: 'deterministic',
          standardReference: 'WCAG 1.3.1',
          recommendation: 'Use sequential heading levels',
          status: 'open',
          createdAt: new Date('2026-10-23T01:59:30.000Z'),
        },
      );

      const evId1 = randomUUID();
      evidenceStore.push({
        id: evId1,
        issueId: issueId1,
        domSelector: 'button#btn',
        snippet: '<button id="btn"></button>',
        highlightedRegion: { x: 50, y: 100, width: 80, height: 32 },
        screenshotCropUrl: null,
        createdAt: new Date('2026-10-23T01:59:00.000Z'),
      });

      // User A accesses results
      const resOwn = await fetch(`${baseUrl}/${auditAId}/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resOwn.status).toBe(200);
      const results = await resOwn.json();

      expect(results.audit_id).toBe(auditAId);
      expect(results.url).toBe('https://user-a.example.com');
      expect(results.status).toBe('complete');
      expect(results.failure_reason).toBeNull();
      expect(results.completed_at).toBe('2026-10-23T02:00:00.000Z');

      // Summary counts check
      expect(results.summary).toEqual({
        total: 2,
        by_severity: {
          Critical: 1,
          High: 0,
          Medium: 0,
          Low: 1,
        },
        by_category: {
          accessibility: 1,
          visual: 1,
          usability: 0,
        },
      });

      // Issues and evidence mapping check
      expect(results.issues).toHaveLength(2);
      expect(results.issues[0].id).toBe(issueId1);
      expect(results.issues[0].evidence).toHaveLength(1);
      expect(results.issues[0].evidence[0].dom_selector).toBe('button#btn');
      expect(results.issues[0].evidence[0].highlighted_region).toEqual({
        x: 50,
        y: 100,
        width: 80,
        height: 32,
      });

      expect(results.issues[1].id).toBe(issueId2);
      expect(results.issues[1].evidence).toHaveLength(0);
    });

    it('returns 404 for another user audit results and nonexistent audit results (anti-enumeration)', async () => {
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

      // User A attempts to access User B's audit results -> 404
      const resCrossUser = await fetch(`${baseUrl}/${auditBId}/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(resCrossUser.status).toBe(404);
      const crossData = await resCrossUser.json();
      expect(crossData.message).toBe('Audit not found');

      // User A attempts to access nonexistent audit results -> identical 404
      const resNonexistent = await fetch(
        `${baseUrl}/${NONEXISTENT_AUDIT_ID}/results`,
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
      const res = await fetch(`${baseUrl}/bad-uuid/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain('Validation failed');
    });

    it('ignores caller-supplied userId in query parameter and derives ownership strictly from token', async () => {
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

      // User A attempts to access User B's audit by supplying userId=USER_B_ID in query string -> 404
      const resTamperedQuery = await fetch(
        `${baseUrl}/${auditBId}/results?userId=${USER_B_ID}`,
        {
          headers: { Authorization: `Bearer ${userAToken}` },
        },
      );
      expect(resTamperedQuery.status).toBe(404);
      const data = await resTamperedQuery.json();
      expect(data.message).toBe('Audit not found');
    });

    it('returns 200 with zero summary counts and empty issues for completed audit with zero findings', async () => {
      const createRes = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://clean-site.example.com' }),
      });
      const { audit_id: auditId } = await createRes.json();

      const auditRec = auditStore.find((a) => a.id === auditId)!;
      auditRec.status = 'complete';
      auditRec.completedAt = new Date('2026-10-23T02:00:00.000Z');

      const res = await fetch(`${baseUrl}/${auditId}/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(200);
      const results = await res.json();

      expect(results.status).toBe('complete');
      expect(results.summary).toEqual({
        total: 0,
        by_severity: { Critical: 0, High: 0, Medium: 0, Low: 0 },
        by_category: { accessibility: 0, visual: 0, usability: 0 },
      });
      expect(results.issues).toEqual([]);
    });

    it('honestly represents running audit status without misrepresenting as complete', async () => {
      const createRes = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://processing-site.example.com' }),
      });
      const { audit_id: auditId } = await createRes.json();

      const auditRec = auditStore.find((a) => a.id === auditId)!;
      auditRec.status = 'running';

      const res = await fetch(`${baseUrl}/${auditId}/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(200);
      const results = await res.json();

      expect(results.status).toBe('running');
      expect(results.completed_at).toBeNull();
    });

    it('honestly represents failed audit status with failure reason and does not report complete even if findings exist', async () => {
      const createRes = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`,
        },
        body: JSON.stringify({ url: 'https://failed-site.example.com' }),
      });
      const { audit_id: auditId } = await createRes.json();

      const auditRec = auditStore.find((a) => a.id === auditId)!;
      auditRec.status = 'failed';
      auditRec.failureReason = 'Capture timeout exceeded';
      auditRec.completedAt = new Date('2026-10-23T02:00:00.000Z');

      // Findings persisted before crash
      const issueId = randomUUID();
      issueStore.push({
        id: issueId,
        auditId,
        category: 'accessibility',
        title: 'Image missing alt',
        description: '<img> without alt',
        severity: 'Critical',
        confidence: 'deterministic',
        standardReference: 'WCAG 1.1.1',
        recommendation: 'Add alt',
        status: 'open',
        createdAt: new Date('2026-10-23T01:59:00.000Z'),
      });

      const res = await fetch(`${baseUrl}/${auditId}/results`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      expect(res.status).toBe(200);
      const results = await res.json();

      // Must remain authoritative from database: failed, NOT complete
      expect(results.status).toBe('failed');
      expect(results.failure_reason).toBe('Capture timeout exceeded');
      expect(results.summary.total).toBe(1);
      expect(results.issues).toHaveLength(1);
    });
  });
});
