import { describe, expect, it } from 'vitest';
import { verifyEvidenceSpan } from './verify';
import type { ComplianceAssessment } from './rubric';

const assessment: ComplianceAssessment = { risk_level: 'high', category: 'weapons', evidence_span: 'firearm', recommendation: 'Review', reasoning: 'A weapon is offered.' };

describe('compliance evidence verification', () => {
  it('requires a verbatim source span', () => {
    expect(verifyEvidenceSpan({ ...assessment, evidence_span: 'Firearm' }, 'firearm for sale')).toMatchObject({ status: 'needs_review' });
    expect(verifyEvidenceSpan(assessment, 'firearm for sale')).toMatchObject({ status: 'open' });
  });

  it('does not treat an empty span as evidence for a flagged assessment', () => {
    expect(verifyEvidenceSpan({ ...assessment, evidence_span: '' }, 'firearm for sale')).toMatchObject({
      status: 'needs_review',
      note: 'model returned a flagged assessment without an evidence_span',
    });
  });

  it('surfaces keyword/model disagreement', () => {
    expect(verifyEvidenceSpan({ ...assessment, category: 'none', risk_level: 'none', evidence_span: '' }, 'firearm for sale', [{ category: 'weapons', pattern: 'firearm' }])).toMatchObject({ status: 'needs_review', category: 'weapons' });
  });
});
