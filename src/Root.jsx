import React, { useEffect, useState, useCallback } from 'react';
import App from './data.jsx';
import { AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

export default function Root() {
  const [state, setState] = useState({ status: 'loading', rows: [], error: null, tabs: [] });

  const load = useCallback(async (force = false) => {
    setState(s => ({ ...s, status: 'loading' }));
    try {
      const r = await fetch(`/api/sheet${force ? '?refresh=1' : ''}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const { rows, tabs } = await r.json();
      setState({ status: 'ready', rows, tabs, error: null });
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  if (state.status === 'loading' && state.rows.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
        <p className="text-sm font-black text-slate-500 uppercase tracking-widest">Pulling sheet data…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-10 text-center gap-4">
        <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-2xl flex items-center justify-center">
          <AlertCircle size={32} />
        </div>
        <h1 className="text-xl font-black text-slate-800">Couldn't load sheet</h1>
        <pre className="text-xs text-rose-600 bg-rose-50 rounded-xl p-4 max-w-xl whitespace-pre-wrap">{state.error}</pre>
        <p className="text-xs text-slate-500 max-w-lg">
          Check that the spreadsheet is shared with the service-account email and that
          <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded">service-account.json</code>
          sits next to <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded">server.js</code>.
        </p>
        <button onClick={() => load(true)} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-bold text-sm shadow-xl active:scale-95">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => load(true)}
        title="Refetch from Google Sheets"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-2xl shadow-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} />
        Sync Sheet
      </button>
      <App data={state.rows} deleteItem={() => {}} updateItem={() => {}} insertItem={() => {}} moveItem={() => {}} />
    </div>
  );
}
