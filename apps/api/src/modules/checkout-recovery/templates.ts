export const LOCALES = [
  'en-IN',
  'hi-IN',
  'ta-IN',
  'kn-IN',
  'en-US',
  'en-GB',
  'en-AE',
  'en-SG',
] as const;

export type Locale = (typeof LOCALES)[number];

export interface TemplateParams {
  readonly amount: string;
  readonly link?: string;
}

export interface TemplateSpec {
  readonly name: string;
  readonly language: string;
  readonly bodyParams: (params: TemplateParams) => string[];
  readonly buttonUrl: (link: string) => string;
}

export interface LocaleTemplates {
  readonly retry_link: TemplateSpec;
  readonly alt_method: TemplateSpec;
  readonly cart_nudge: TemplateSpec;
}

function template(
  name: string,
  language: string,
  body: (params: TemplateParams) => string,
): TemplateSpec {
  return Object.freeze({
    name,
    language,
    bodyParams: (params: TemplateParams) => [body(params)],
    // URL parameters are already generated and validated by the module; Meta receives the exact deterministic link.
    buttonUrl: (link: string) => link,
  });
}

function englishTemplates(language: string): LocaleTemplates {
  return Object.freeze({
    retry_link: template(
      'aegis_checkout_retry_link_v1',
      language,
      ({ amount }) => `Your payment of ${amount} could not be completed. Try again securely.`,
    ),
    alt_method: template(
      'aegis_checkout_alt_method_v1',
      language,
      ({ amount }) => `Your payment of ${amount} did not go through. Try another payment method.`,
    ),
    cart_nudge: template(
      'aegis_checkout_cart_nudge_v1',
      language,
      ({ amount }) => `Your ${amount} order is waiting. Complete checkout when you are ready.`,
    ),
  });
}

/**
 * Approved message templates by customer locale.
 * Intent: customer-facing copy remains deterministic and outside the LLM boundary (C-A5).
 * Flow: choose the locale snapshot -> choose the diagnosis strategy -> fill only the formatted amount parameter.
 */
export const TEMPLATES: Record<Locale, LocaleTemplates> = {
  'en-IN': englishTemplates('en_IN'),
  'en-US': englishTemplates('en_US'),
  'en-GB': englishTemplates('en_GB'),
  'en-AE': englishTemplates('en_AE'),
  'en-SG': englishTemplates('en_SG'),
  'hi-IN': Object.freeze({
    retry_link: template(
      'aegis_checkout_retry_link_v1',
      'hi_IN',
      ({ amount }) => `${amount} का भुगतान पूरा नहीं हो सका। सुरक्षित रूप से फिर से प्रयास करें।`,
    ),
    alt_method: template(
      'aegis_checkout_alt_method_v1',
      'hi_IN',
      ({ amount }) => `${amount} का भुगतान नहीं हुआ। कोई दूसरा भुगतान तरीका आज़माएँ।`,
    ),
    cart_nudge: template(
      'aegis_checkout_cart_nudge_v1',
      'hi_IN',
      ({ amount }) => `आपका ${amount} का ऑर्डर प्रतीक्षा में है। तैयार होने पर चेकआउट पूरा करें।`,
    ),
  }),
  'ta-IN': Object.freeze({
    retry_link: template(
      'aegis_checkout_retry_link_v1',
      'ta_IN',
      ({ amount }) => `${amount} கட்டணம் முடியவில்லை. பாதுகாப்பாக மீண்டும் முயற்சிக்கவும்.`,
    ),
    alt_method: template(
      'aegis_checkout_alt_method_v1',
      'ta_IN',
      ({ amount }) => `${amount} கட்டணம் செல்லவில்லை. வேறு கட்டண முறையை முயற்சிக்கவும்.`,
    ),
    cart_nudge: template(
      'aegis_checkout_cart_nudge_v1',
      'ta_IN',
      ({ amount }) => `உங்கள் ${amount} ஆர்டர் காத்திருக்கிறது. தயாரானதும் செக்அவுட்டை முடிக்கவும்.`,
    ),
  }),
  'kn-IN': Object.freeze({
    retry_link: template(
      'aegis_checkout_retry_link_v1',
      'kn_IN',
      ({ amount }) => `${amount} ಪಾವತಿ ಪೂರ್ಣವಾಗಲಿಲ್ಲ. ಸುರಕ್ಷಿತವಾಗಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
    ),
    alt_method: template(
      'aegis_checkout_alt_method_v1',
      'kn_IN',
      ({ amount }) => `${amount} ಪಾವತಿ ವಿಫಲವಾಗಿದೆ. ಬೇರೆ ಪಾವತಿ ವಿಧಾನ ಪ್ರಯತ್ನಿಸಿ.`,
    ),
    cart_nudge: template(
      'aegis_checkout_cart_nudge_v1',
      'kn_IN',
      ({ amount }) => `ನಿಮ್ಮ ${amount} ಆರ್ಡರ್ ಕಾಯುತ್ತಿದೆ. ಸಿದ್ಧವಾದಾಗ ಚೆಕ್ಔಟ್ ಪೂರ್ಣಗೊಳಿಸಿ.`,
    ),
  }),
};

/** Unknown or provider-specific locales use the audited Indian English fallback. */
export function templatesFor(locale: string | null | undefined): LocaleTemplates {
  if (locale !== undefined && locale !== null && Object.prototype.hasOwnProperty.call(TEMPLATES, locale)) {
    return TEMPLATES[locale as Locale];
  }
  return TEMPLATES['en-IN'];
}

/** Normalize a customer locale for persistence while retaining the deterministic fallback. */
export function localeForTemplates(locale: string | null | undefined): Locale {
  return locale !== undefined && locale !== null && Object.prototype.hasOwnProperty.call(TEMPLATES, locale)
    ? locale as Locale
    : 'en-IN';
}

