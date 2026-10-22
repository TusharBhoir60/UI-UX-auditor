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

export interface FindingSummaryCounts {
  total: number;
  by_severity: {
    Critical: number;
    High: number;
    Medium: number;
    Low: number;
  };
  by_category: {
    accessibility: number;
    visual: number;
    usability: number;
  };
}

export interface EvidenceResultItem {
  id: string;
  issue_id: string;
  dom_selector: string | null;
  snippet: string | null;
  highlighted_region: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  screenshot_crop_url: string | null;
  created_at: string;
}

export interface IssueResultItem {
  id: string;
  audit_id: string;
  category: 'accessibility' | 'visual' | 'usability';
  title: string;
  description: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  confidence: 'deterministic' | 'high' | 'medium' | 'low';
  standard_reference: string | null;
  recommendation: string;
  status: 'open' | 'acknowledged' | 'fixed';
  created_at: string;
  evidence: EvidenceResultItem[];
}

export interface AuditResultsResponse {
  audit_id: string;
  url: string;
  status: string;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  summary: FindingSummaryCounts;
  issues: IssueResultItem[];
}
