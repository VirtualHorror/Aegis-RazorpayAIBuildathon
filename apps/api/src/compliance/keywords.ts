import type { ComplianceCategory } from './rubric';

export interface KeywordHit {
  readonly category: ComplianceCategory;
  readonly pattern: string;
}

/** The fixed prescreen vocabulary is intentionally boring and reviewable. */
export const KEYWORDS: Readonly<Record<Exclude<ComplianceCategory, 'none'>, readonly string[]>> = {
  adult_content: ['adult content', 'explicit video', 'porn', 'escort service', 'sexual services', 'nude images'],
  gambling_lottery: ['guaranteed win', 'lottery', 'betting', 'sports book', 'casino', 'roulette'],
  drugs_paraphernalia: ['cocaine', 'drug kit', 'bong', 'marijuana', 'cannabis', 'drug paraphernalia'],
  weapons: ['firearm', 'gun', 'ammunition', 'assault rifle', 'switchblade', 'explosive'],
  tobacco_vape: ['vape', 'nicotine', 'tobacco', 'cigarette', 'e-cigarette', 'smokeless tobacco'],
  counterfeit_ip: ['counterfeit', 'replica', 'first copy', 'fake branded', 'knockoff', 'unauthorised trademark'],
  financial_guarantees_mlm: ['guaranteed returns', 'monthly returns', 'risk-free profit', 'multi-level marketing', 'pyramid scheme', 'double your money'],
  medical_claims_unapproved: ['cures', 'cure diabetes', 'clinically proven', 'miracle treatment', 'guaranteed weight loss', 'treats cancer'],
  crypto_forex_unlicensed: ['crypto investment', 'forex signals', 'guaranteed bitcoin', 'unlicensed broker', 'token presale', 'binary options'],
  hate_or_illegal: ['hate group', 'terrorist', 'stolen goods', 'illegal service', 'exploit', 'human trafficking'],
};

/** Return every category/pattern hit in deterministic input order. */
export function prescreen(description: string): KeywordHit[] {
  const normalized = description.toLowerCase();
  const hits: KeywordHit[] = [];
  for (const [category, patterns] of Object.entries(KEYWORDS) as [Exclude<ComplianceCategory, 'none'>, readonly string[]][]) {
    for (const pattern of patterns) {
      if (normalized.includes(pattern)) hits.push({ category, pattern });
    }
  }
  return hits;
}

export const keywordPrescreen = prescreen;
