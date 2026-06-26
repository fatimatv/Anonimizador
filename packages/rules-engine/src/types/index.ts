export type EntityType =
  | 'person_name'
  | 'dni'
  | 'passport'
  | 'foreigner_card'
  | 'ruc'
  | 'email'
  | 'phone'
  | 'address'
  | 'bank_account'
  | 'credit_card'
  | 'health_data'
  | 'biometric_data'
  | 'minor_data'
  | 'location_data'
  | 'license_plate'
  | 'ip_address'
  | 'url'
  | 'case_number'
  | 'signature'
  | 'other';

export type EntityCategory =
  | 'personal_data'
  | 'sensitive_data'
  | 'confidential_data'
  | 'identifier';

export type ReplacementType = 'redact' | 'mask' | 'pseudonymize' | 'remove';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface DetectionResult {
  entityType: EntityType;
  category: EntityCategory;
  startOffset: number;
  endOffset: number;
  rawValueHash: string;
  previewMasked: string;
  confidence: number;
  replacementType: ReplacementType;
  ruleId?: string;
  contextWindowHash?: string;
}
