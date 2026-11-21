import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { Drawer } from './Drawer';
import { toast } from './toast';
import { API_CONFIG } from '../admin/config/api.config';

/**
 * Contact Us. A normal "Contact" link in the header and footer opens this slide-in drawer (there is no floating button).
 * The details come from GET /api/contact-info (SETTING rows CONTACT_HELPLINE, CONTACT_EMAIL, CONTACT_ADDRESS, change them in
 * Admin, Settings). The message is sent to POST /api/contact (saved in MongoDB, read by the admin in "Contact Messages").
 */
const ContactContext = createContext<{ open: () => void }>({ open: () => {} });
export const useContact = () => useContext(ContactContext);

interface Details { helpline?: string; email?: string; address?: string }

export const ContactProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setOpen] = useState(false);
  const [details, setDetails] = useState<Details | null | 'error'>(null);
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const open = useCallback(() => { setMsg(null); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!isOpen || details) return;
    fetch(`${API_CONFIG.BASE_URL}/api/contact-info`)
      .then((r) => r.json())
      .then((j) => { if (!j || !j.success) throw new Error('no details'); setDetails(j.data); })
      .catch(() => setDetails('error'));
  }, [isOpen, details]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { name: form.name.trim(), email: form.email.trim(), message: form.message.trim() };
    if (body.name.length < 2) return setMsg({ text: 'Please enter your name.', ok: false });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) return setMsg({ text: 'Please enter a valid e-mail address.', ok: false });
    if (body.message.length < 5) return setMsg({ text: 'Please write a short message (at least 5 characters).', ok: false });
    setBusy(true);
    setMsg({ text: 'Sending...', ok: true });
    try {
      const r = await fetch(`${API_CONFIG.BASE_URL}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (r.ok && j && j.success) {
        setForm({ name: '', email: '', message: '' });
        setMsg(null);
        setOpen(false);
        toast('Thank you. Your message was sent.', 'success');
      } else setMsg({ text: (j && j.error && j.error.message) || 'Could not send the message. Please try again.', ok: false });
    } catch {
      setMsg({ text: 'Cannot reach the server. Please try again later.', ok: false });
    } finally { setBusy(false); }
  };

  const rows: [string, string | undefined][] = details && details !== 'error' ? [['Helpdesk', details.helpline], ['E-mail', details.email], ['Address', details.address]] : [];

  return (
    <ContactContext.Provider value={{ open }}>
      {children}
      <Drawer open={isOpen} onClose={close} title="Contact us" subtitle="We read every message.">
        <ul className="rrms-contact-list" style={{ marginTop: 18 }}>
          {details === null && <li>Loading contact details...</li>}
          {details === 'error' && <li>Contact details are not available right now. You can still send a message below.</li>}
          {rows.filter((r) => r[1]).map(([k, v]) => <li key={k}><strong>{k}: </strong>{v}</li>)}
        </ul>
        <form onSubmit={send} noValidate style={{ display: 'grid', gap: 12 }}>
          <label className="rrms-field">Your name<input className="rrms-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} autoComplete="name" required /></label>
          <label className="rrms-field">Your e-mail<input className="rrms-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={120} autoComplete="email" required /></label>
          <label className="rrms-field">Message<textarea className="rrms-textarea" rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={1000} required /></label>
          <p role="status" style={{ margin: 0, minHeight: 20, fontSize: 13, color: msg ? (msg.ok ? 'var(--st-confirmed)' : 'var(--st-cancelled)') : undefined }}>{msg ? msg.text : ''}</p>
          <button type="submit" className="rrms-btn rrms-btn-accent" disabled={busy}><Send size={16} aria-hidden="true" /> Send message</button>
        </form>
      </Drawer>
    </ContactContext.Provider>
  );
};
