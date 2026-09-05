import { z } from 'zod';

export const COMPLIANCE_CATEGORIES = [
  'adult_content',
  'gambling_lottery',
  'drugs_paraphernalia',
  'weapons',
  'tobacco_vape',
  'counterfeit_ip',
  'financial_guarantees_mlm',
  'medical_claims_unapproved',
  'crypto_forex_unlicensed',
  'hate_or_illegal',
  'none',
] as const;
export type ComplianceCategory = (typeof COMPLIANCE_CATEGORIES)[number];
export const RISK_LEVELS = ['none', 'low', 'medium', 'high', 'prohibited'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ComplianceAssessmentSchema = z.object({
  risk_level: z.enum(RISK_LEVELS),
  category: z.enum(COMPLIANCE_CATEGORIES),
  evidence_span: z.string().max(200),
  recommendation: z.string().max(300),
  reasoning: z.string().max(400),
});
export type ComplianceAssessment = z.infer<typeof ComplianceAssessmentSchema>;
