import { WhatsAppTemplateMessageSchema, type WhatsAppTemplateMessage } from '@aegis/shared';
import { maskContact } from '../../llm/mask';

export function retryTemplate(contact: string, locale: string, amountPaise: number, step: number): WhatsAppTemplateMessage {
  const language = locale.replace('-', '_');
  const body = locale.startsWith('hi')
    ? `आपकी सदस्यता का भुगतान लंबित है। चरण ${step} के लिए ₹${(amountPaise / 100).toFixed(2)} पर फिर प्रयास होगा।`
    : `Your subscription payment is pending. We will retry step ${step} for ₹${(amountPaise / 100).toFixed(2)}.`;
  return WhatsAppTemplateMessageSchema.parse({
    messaging_product: 'whatsapp',
    to: maskContact(contact).replaceAll('*', '•'),
    type: 'template',
    template: {
      name: 'subscription_retry_v1',
      language: { code: language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: body }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: `https://rzp.io/l/aegis-sub-${step}` }] },
      ],
    },
  });
}

