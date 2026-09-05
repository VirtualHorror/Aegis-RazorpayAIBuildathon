export interface SeedProduct {
  readonly id: string;
  readonly merchantId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly pricePaise: number;
  readonly sku: string;
  readonly active: boolean;
  readonly agentPurchasable: boolean;
}

/**
 * Demo catalog fixtures, including deliberately risky copy for the later compliance scanner.
 * Intent: provide realistic catalog variety and a deterministic x402 selection set while keeping all prices integer paise.
 * Flow:   seed.ts upserts products -> compliance and x402 tasks query this same PostgreSQL catalog.
 */
export const PRODUCTS: readonly SeedProduct[] = [
  { id: 'prod_001', merchantId: 'acc_AegisDemo01', name: 'Aegis USB-C Hub', description: 'Seven-port aluminium USB-C hub with HDMI and power delivery.', category: 'electronics', pricePaise: 49900, sku: 'AEG-HUB-001', active: true, agentPurchasable: true },
  { id: 'prod_002', merchantId: 'acc_AegisDemo01', name: 'Aegis Noise-Cancel Headphones', description: 'Wireless over-ear headphones with adaptive noise cancellation.', category: 'electronics', pricePaise: 99900, sku: 'AEG-AUD-002', active: true, agentPurchasable: true },
  { id: 'prod_003', merchantId: 'acc_AegisDemo01', name: 'Aegis Smart Plug', description: 'Energy-monitoring Wi-Fi smart plug with scheduling.', category: 'electronics', pricePaise: 29900, sku: 'AEG-IOT-003', active: true, agentPurchasable: true },
  { id: 'prod_004', merchantId: 'acc_AegisDemo01', name: 'Aegis Travel Charger', description: 'Compact GaN charger with interchangeable international plugs.', category: 'electronics', pricePaise: 79900, sku: 'AEG-CHG-004', active: true, agentPurchasable: true },
  { id: 'prod_005', merchantId: 'acc_AegisDemo01', name: 'Aegis Cotton Overshirt', description: 'Breathable organic cotton overshirt in a relaxed fit.', category: 'apparel', pricePaise: 69900, sku: 'AEG-APP-005', active: true, agentPurchasable: true },
  { id: 'prod_006', merchantId: 'acc_AegisDemo01', name: 'Aegis Everyday Tote', description: 'Recycled canvas tote with a padded laptop sleeve.', category: 'apparel', pricePaise: 9900, sku: 'AEG-APP-006', active: true, agentPurchasable: true },
  { id: 'prod_007', merchantId: 'acc_AegisDemo01', name: 'Aegis Pro Annual', description: 'Annual analytics workspace for small operations teams.', category: 'saas', pricePaise: 1200000, sku: 'AEG-SaaS-007', active: true, agentPurchasable: false },
  { id: 'prod_008', merchantId: 'acc_AegisDemo01', name: 'Aegis Team Annual', description: 'Annual collaboration workspace with audit exports.', category: 'saas', pricePaise: 4800000, sku: 'AEG-SaaS-008', active: true, agentPurchasable: false },
  { id: 'prod_009', merchantId: 'acc_AegisDemo01', name: 'Aegis Enterprise Annual', description: 'Enterprise controls, SSO, and priority support for one year.', category: 'saas', pricePaise: 12000000, sku: 'AEG-SaaS-009', active: true, agentPurchasable: false },
  { id: 'prod_010', merchantId: 'acc_AegisDemo01', name: 'Aegis Setup Workshop', description: 'A two-hour remote onboarding workshop with an implementation specialist.', category: 'services', pricePaise: 250000, sku: 'AEG-SVC-010', active: true, agentPurchasable: false },
  { id: 'prod_011', merchantId: 'acc_AegisDemo01', name: 'Aegis Data Export', description: 'One-time assisted export of workspace data in CSV format.', category: 'services', pricePaise: 150000, sku: 'AEG-SVC-011', active: true, agentPurchasable: false },
  { id: 'prod_012', merchantId: 'acc_AegisDemo01', name: 'Guaranteed Returns Course', description: 'This investment course promises guaranteed 20% monthly returns.', category: 'financial_services', pricePaise: 350000, sku: 'AEG-RSK-012', active: true, agentPurchasable: false },
  { id: 'prod_013', merchantId: 'acc_AegisDemo01', name: 'Wellness Miracle Kit', description: 'A supplement marketed as cures diabetes in 30 days.', category: 'health', pricePaise: 85000, sku: 'AEG-RSK-013', active: true, agentPurchasable: false },
  { id: 'prod_014', merchantId: 'acc_AegisDemo01', name: 'Luxury Watch Replica', description: 'A replica Rolex offered as a premium lookalike timepiece.', category: 'counterfeit', pricePaise: 199900, sku: 'AEG-RSK-014', active: true, agentPurchasable: false },
  { id: 'prod_015', merchantId: 'acc_AegisDemo01', name: 'Vape Starter Pack', description: 'nicotine vape pods and refill accessories for adults.', category: 'tobacco', pricePaise: 24900, sku: 'AEG-RSK-015', active: true, agentPurchasable: false },
  { id: 'prod_016', merchantId: 'acc_AegisDemo01', name: 'Lucky Draw Bundle', description: 'Lottery ticket bundle with a chance to win a cash prize.', category: 'gambling', pricePaise: 50000, sku: 'AEG-RSK-016', active: true, agentPurchasable: false },
];
