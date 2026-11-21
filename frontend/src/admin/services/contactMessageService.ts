import { httpRequest } from './http.client';

export interface ContactMessage {
  messageId: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
  status: 'NEW' | 'DONE';
  handledAt: string | null;
  handledBy: string | null;
}

/** Messages sent from the Contact Us panel (MongoDB contact_messages, GET /api/admin/contact-messages). */
export const contactMessageService = {
  list(status?: 'NEW' | 'DONE'): Promise<ContactMessage[]> {
    return httpRequest<ContactMessage[]>(`/api/admin/contact-messages${status ? `?status=${status}` : ''}`);
  },
  setStatus(messageId: string, status: 'NEW' | 'DONE'): Promise<ContactMessage> {
    return httpRequest<ContactMessage>(`/api/admin/contact-messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ status }) });
  },
};
