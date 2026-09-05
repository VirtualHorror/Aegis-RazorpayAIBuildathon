/**
 * @aegis/shared — the one package both the API and the dashboard import.
 * Keep it dependency-light (zod only): domain enums, precedence rules, money helpers, and (from Task 3) Razorpay webhook schemas.
 */
export const AEGIS_VERSION = '0.1.0';

export * from './money';
export * from './domain/enums';
export * from './domain/locale';
export * from './domain/precedence';
export * from './razorpay/events';
export * from './razorpay/webhook';
export * from './messaging/whatsapp';
export * from './sim/ids';
export * from './sim/scenarios';
