import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditsService } from './audits.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import {
  AuditCreationResponse,
  AuditDetailResponse,
  AuditListItemResponse,
  AuditStatusResponse,
} from './audits.types';

@Controller('audits')
@UseGuards(JwtAuthGuard)
export class AuditsController {
  constructor(private readonly auditsService: AuditsService) {}

  /**
   * POST /api/v1/audits
   * Creates a new audit job in 'queued' status.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser('id') userId: string,
    @Body() createAuditDto: CreateAuditDto,
  ): Promise<AuditCreationResponse> {
    return this.auditsService.create(userId, createAuditDto);
  }

  /**
   * GET /api/v1/audits
   * Lists the authenticated user's audits, newest first.
   */
  @Get()
  findAll(
    @CurrentUser('id') userId: string,
  ): Promise<AuditListItemResponse[]> {
    return this.auditsService.findAll(userId);
  }

  /**
   * GET /api/v1/audits/:auditId
   * Retrieves an audit's detail and metadata. Scoped to the authenticated owner.
   */
  @Get(':auditId')
  findOne(
    @CurrentUser('id') userId: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<AuditDetailResponse> {
    return this.auditsService.findOne(userId, auditId);
  }

  /**
   * GET /api/v1/audits/:auditId/status
   * Lightweight status polling endpoint. Scoped to the authenticated owner.
   */
  @Get(':auditId/status')
  getStatus(
    @CurrentUser('id') userId: string,
    @Param('auditId', new ParseUUIDPipe()) auditId: string,
  ): Promise<AuditStatusResponse> {
    return this.auditsService.getStatus(userId, auditId);
  }
}
