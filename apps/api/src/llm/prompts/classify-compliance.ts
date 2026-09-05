import { ComplianceAssessmentSchema } from '../../compliance/rubric';

export const classifyCompliancePrompt = {
  version: 'v1',
  system: 'Classify this product description against the Aegis compliance rubric. Quote a verbatim, case-sensitive evidence span from the description or return an empty span for none. Return JSON only.',
  buildUser: (description: string): string => description,
  schema: ComplianceAssessmentSchema,
} as const;

export default classifyCompliancePrompt;
