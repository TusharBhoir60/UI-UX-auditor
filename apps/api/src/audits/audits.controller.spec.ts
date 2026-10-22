import { Test, TestingModule } from '@nestjs/testing';
import { AuditsController } from './audits.controller';
import { AuditsService } from './audits.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('AuditsController', () => {
  let controller: AuditsController;
  let mockAuditsService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    getStatus: jest.Mock;
  };

  const USER_ID = 'user-uuid-1111';
  const AUDIT_ID = 'audit-uuid-2222';

  beforeEach(async () => {
    mockAuditsService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      getStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuditsController],
      providers: [
        {
          provide: AuditsService,
          useValue: mockAuditsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuditsController>(AuditsController);
  });

  it('delegates create to AuditsService with extracted userId and dto', async () => {
    const expected = { audit_id: AUDIT_ID, status: 'queued' };
    mockAuditsService.create.mockResolvedValueOnce(expected);

    const dto = { url: 'https://example.com' };
    const result = await controller.create(USER_ID, dto);

    expect(mockAuditsService.create).toHaveBeenCalledWith(USER_ID, dto);
    expect(result).toBe(expected);
  });

  it('delegates findAll to AuditsService with extracted userId', async () => {
    const expected = [
      {
        audit_id: AUDIT_ID,
        url: 'https://example.com',
        status: 'queued',
        created_at: '2026-10-22T10:00:00.000Z',
        summary_counts: null,
      },
    ];
    mockAuditsService.findAll.mockResolvedValueOnce(expected);

    const result = await controller.findAll(USER_ID);

    expect(mockAuditsService.findAll).toHaveBeenCalledWith(USER_ID);
    expect(result).toBe(expected);
  });

  it('delegates findOne to AuditsService with extracted userId and auditId', async () => {
    const expected = {
      audit_id: AUDIT_ID,
      url: 'https://example.com',
      status: 'queued',
      failure_reason: null,
      created_at: '2026-10-22T10:00:00.000Z',
      completed_at: null,
      report: null,
    };
    mockAuditsService.findOne.mockResolvedValueOnce(expected);

    const result = await controller.findOne(USER_ID, AUDIT_ID);

    expect(mockAuditsService.findOne).toHaveBeenCalledWith(USER_ID, AUDIT_ID);
    expect(result).toBe(expected);
  });

  it('delegates getStatus to AuditsService with extracted userId and auditId', async () => {
    const expected = {
      status: 'queued',
      stage: 'queued',
      failure_reason: null,
    };
    mockAuditsService.getStatus.mockResolvedValueOnce(expected);

    const result = await controller.getStatus(USER_ID, AUDIT_ID);

    expect(mockAuditsService.getStatus).toHaveBeenCalledWith(USER_ID, AUDIT_ID);
    expect(result).toBe(expected);
  });
});
