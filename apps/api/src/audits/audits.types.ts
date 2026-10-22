/**
 * Response contract types for Audit Management API.
 * Authoritative document: docs/API_SPEC.md
 */

export interface AuditCreationResponse {
  audit_id: string;
  status: string;
}

export interface AuditListItemResponse {
  audit_id: string;
  url: string;
  status: string;
  created_at: string;
  summary_counts: null;
}

export interface AuditDetailResponse {
  audit_id: string;
  url: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  report: null;
}

export interface AuditStatusResponse {
  status: string;
  stage: string;
  failure_reason: string | null;
}
