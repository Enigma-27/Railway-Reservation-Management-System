import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { contactMessageService, ContactMessage } from '../../services/contactMessageService';

type Filter = 'ALL' | 'NEW' | 'DONE';

/** Contact Us messages from visitors: read them, mark them done (or open them again). Real data from MongoDB. */
export const ContactMessagesPage: React.FC = () => {
  const [filter, setFilter] = useState<Filter>('NEW');
  const [rows, setRows] = useState<ContactMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await contactMessageService.list(filter === 'ALL' ? undefined : filter));
      setError(null);
    } catch (e: any) {
      setError(e.message || 'The messages could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (m: ContactMessage) => {
    setBusyId(m.messageId);
    try {
      await contactMessageService.setStatus(m.messageId, m.status === 'DONE' ? 'NEW' : 'DONE');
      await load();
    } catch (e: any) {
      setError(e.message || 'The message could not be updated.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contact Messages"
        description="Messages sent from the Contact Us button on the site. Mark a message done when it has been answered."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter messages">
        {(['NEW', 'DONE', 'ALL'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={filter === f ? 'btn-secondary' : 'btn-ghost'}
          >
            {f === 'NEW' ? 'To do' : f === 'DONE' ? 'Done' : 'All'}
          </button>
        ))}
        <button type="button" onClick={load} className="btn-ghost" disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm" role="alert">{error}</div>}
      {!error && !loading && rows.length === 0 && (
        <div className="p-6 rounded-xl bg-white border border-slate-200 text-sm text-slate-600">
          {filter === 'NEW' ? 'No messages are waiting. Nothing to do.' : 'No messages found.'}
        </div>
      )}

      <ul className="space-y-3">
        {rows.map((m) => (
          <li key={m.messageId} className="p-4 rounded-xl bg-white border border-slate-200 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{m.name}</p>
                <p className="text-xs text-slate-600"><a className="underline text-blue-800" href={`mailto:${m.email}`}>{m.email}</a> · {m.createdAt}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold border ${m.status === 'DONE' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                  {m.status === 'DONE' ? 'Done' : 'To do'}
                </span>
                <button type="button" onClick={() => toggle(m)} disabled={busyId === m.messageId} className="btn-secondary" aria-label={m.status === 'DONE' ? `Open again: message from ${m.name}` : `Mark done: message from ${m.name}`}>
                  {m.status === 'DONE' ? <><RotateCcw className="w-4 h-4" aria-hidden="true" /> Open again</> : <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Mark done</>}
                </button>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-800 whitespace-pre-wrap break-words">{m.message}</p>
            {m.status === 'DONE' && m.handledAt && <p className="mt-2 text-xs text-slate-600">Done {m.handledAt}{m.handledBy ? ` by ${m.handledBy}` : ''}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
};
