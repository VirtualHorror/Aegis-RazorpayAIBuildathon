export interface SeedCustomer {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly contact: string;
  readonly country: string;
  readonly locale: string;
  readonly optedOut: boolean;
  readonly notes: Record<string, string | number | boolean | null>;
}

/**
 * Stable customer fixtures used by the demo and integration tests.
 * Intent: cover every supported locale and both messaging preference paths without storing real customer PII.
 * Flow:   seed.ts inserts these rows with masked contact fields -> action modules read locale/opted_out deterministically.
 */
export const CUSTOMERS: readonly SeedCustomer[] = [
  { id: 'cus_001', name: 'Aarav Mehta', email: 'a***@example.com', contact: '+91******42', country: 'IN', locale: 'en-IN', optedOut: false, notes: {} },
  { id: 'cus_002', name: 'Ananya Rao', email: 'a***@example.com', contact: '+91******18', country: 'IN', locale: 'hi-IN', optedOut: false, notes: {} },
  { id: 'cus_003', name: 'Karthik Iyer', email: 'k***@example.com', contact: '+91******67', country: 'IN', locale: 'ta-IN', optedOut: false, notes: {} },
  { id: 'cus_004', name: 'Nandini Shetty', email: 'n***@example.com', contact: '+91******91', country: 'IN', locale: 'kn-IN', optedOut: false, notes: {} },
  { id: 'cus_005', name: 'Maya Patel', email: 'm***@example.com', contact: '+1******18', country: 'US', locale: 'en-US', optedOut: false, notes: {} },
  { id: 'cus_006', name: 'Oliver Smith', email: 'o***@example.com', contact: '+44******05', country: 'GB', locale: 'en-GB', optedOut: false, notes: {} },
  { id: 'cus_007', name: 'Layla Haddad', email: 'l***@example.com', contact: '+971******73', country: 'AE', locale: 'en-AE', optedOut: false, notes: {} },
  { id: 'cus_008', name: 'Ethan Tan', email: 'e***@example.com', contact: '+65******29', country: 'SG', locale: 'en-SG', optedOut: false, notes: {} },
  { id: 'cus_009', name: 'Rohan Desai', email: 'r***@example.com', contact: '+91******34', country: 'IN', locale: 'en-IN', optedOut: true, notes: { optOutReason: 'customer_request' } },
  { id: 'cus_010', name: 'Priya Menon', email: 'p***@example.com', contact: '+91******56', country: 'IN', locale: 'hi-IN', optedOut: true, notes: { optOutReason: 'customer_request' } },
  { id: 'cus_011', name: 'Sanjay Kulkarni', email: 's***@example.com', contact: '+91******80', country: 'IN', locale: 'ta-IN', optedOut: false, notes: {} },
  { id: 'cus_012', name: 'Grace Wilson', email: 'g***@example.com', contact: '+44******44', country: 'GB', locale: 'en-GB', optedOut: false, notes: {} },
];
