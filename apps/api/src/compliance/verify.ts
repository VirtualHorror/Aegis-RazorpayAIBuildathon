import type { ComplianceAssessment } from './rubric';
import type { KeywordHit } from './keywords';

export interface EvidenceVerification {
  readonly status: 'open' | 'needs_review';
  readonly note?: string;
  readonly category: ComplianceAssessment['category'];
  readonly riskLevel: ComplianceAssessment['risk_level'];
}

/**
 * Cross-check the model's evidence against source text and the deterministic prescreen.
 * Intent: a plausible-sounding assessment is not evidence; the exact case-sensitive span must exist in the product
 *         description, and keyword/model disagreement is surfaced to a human.
 * Flow: verify span -> compare keyword categories -> return an explicit review status consumed by scanner persistence.
 */
export function verifyEvidenceSpan(
  assessment: ComplianceAssessment,
  description: string,
  keywordHits: readonly KeywordHit[] = [],
): EvidenceVerification {
  // Intent: every non-neutral assessment must carry a real source span; `''.includes('')` is true but is not evidence.
  // Flow: reject a missing span first -> then enforce the case-sensitive substring check below.
  const requiresEvidence = assessment.category !== 'none' || assessment.risk_level !== 'none';
  if (requiresEvidence && assessment.evidence_span.length === 0) {
    return {
      status: 'needs_review',
      note: 'model returned a flagged assessment without an evidence_span',
      category: assessment.category,
      riskLevel: assessment.risk_level,
    };
  }
  if (!description.includes(assessment.evidence_span)) {
    return {
      status: 'needs_review',
      note: 'model evidence_span is not a case-sensitive substring of the product description',
      category: assessment.category,
      riskLevel: assessment.risk_level,
    };
  }
  const keywordCategory = keywordHits.find((hit) => hit.category !== 'none')?.category;
  if (keywordCategory && assessment.category === 'none') {
    return {
      status: 'needs_review',
      note: `keyword prescreen hit ${keywordCategory} but the model returned none`,
      category: keywordCategory,
      riskLevel: assessment.risk_level === 'none' ? 'medium' : assessment.risk_level,
    };
  }
  return { status: 'open', category: assessment.category, riskLevel: assessment.risk_level };
}

export const verifyEvidence = verifyEvidenceSpan;
