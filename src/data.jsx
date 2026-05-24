import React, { useState, useMemo } from 'react';
import * as d3 from 'd3';
import { useEffect } from 'react';
import {
  TrendingUp, TrendingDown, Wallet, History, LayoutDashboard, ChevronDown,
  ExternalLink, ShieldCheck, Activity, Clock, CreditCard, Receipt,
  PieChart as PieChartIcon, Plus, X, ArrowDownLeft, ArrowUpRight, Briefcase, Calendar, IndianRupee,
  Sun, Moon, Search, Layers, Eye, EyeOff
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* 1. Data engine                                                      */
/* ------------------------------------------------------------------ */

const _safeNum = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[₹$,\s]/g, '').replace(/[()]/g, ''));
  return isNaN(n) ? 0 : n;
};

const _safeDate = (v) => {
  if (v === null || v === undefined || v === 'null') return null;
  if (typeof v === 'number') return null; // pure numbers are not dates
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === 'date' || low === 'month' || low.includes('start')) return null;
  // Strict shape: ISO yyyy-mm-dd, dd/mm/yyyy-like, or contains a month name.
  const isoShape = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s);
  const dmyShape = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(s);
  const hasMonth = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s);
  if (!isoShape && !dmyShape && !hasMonth) return null;

  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const d = new Date(+iso[1], +iso[2] - 1, +iso[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  if (d.getFullYear() < 2000) return null;
  return d;
};

const _mKey = (d) => d ? `${d.getFullYear()}-${d.getMonth()}` : null;
const _label = (d) => d ? new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d) : '---';
const _cellHas = (c, needle) => c !== null && c !== undefined && String(c).toLowerCase().includes(needle.toLowerCase());
const _rowHasAll = (r, needles) => needles.every(n => r.some(c => _cellHas(c, n)));

function scanAllData(data) {
  const summaryLogs = [];
  const granularTransactions = [];
  if (!Array.isArray(data)) return { summaryLogs, granularTransactions };

  let section = null;

  for (const item of data) {
    const row = item.row || [];
    const flat = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
    if (flat.length === 0) continue;

    if (_rowHasAll(row, ['month', 'start']) && row.some(c => _cellHas(c, 'expense'))) { section = 'summary'; continue; }
    if (_rowHasAll(row, ['date', 'category', 'reason']) && row.some(c => _cellHas(c, 'spent'))) { section = 'spend'; continue; }
    if (_rowHasAll(row, ['date', 'month', 'category', 'reason']) && row.some(c => _cellHas(c, 'amount'))) { section = 'credit'; continue; }
    if (_rowHasAll(row, ['date', 'reason']) && row.some(c => _cellHas(c, 'amount')) && !row.some(c => _cellHas(c, 'category'))) { section = 'invest'; continue; }

    if (flat.length <= 2) {
      const tag = flat.map(s => String(s).toLowerCase()).join(' ');
      if (tag.includes('investment'))                                    { section = 'invest'; continue; }
      if (tag.includes('credit'))                                        { section = 'credit'; continue; }
      if (tag.includes('monthly spent'))                                 { section = 'spend';  continue; }
      if (tag.includes('final spent') || tag.includes('expense data'))   { section = 'summary'; continue; }
      section = null;
      continue;
    }

    if (section === 'summary') {
      const d = _safeDate(row[0]);
      if (!d) continue;
      summaryLogs.push({
        id: `sum-${item.index_}`, date: d, monthKey: _mKey(d), year: d.getFullYear(), label: _label(d),
        start: _safeNum(row[1]), expense: _safeNum(row[2]), invest: _safeNum(row[3]),
        credit: _safeNum(row[4]), balance: _safeNum(row[5])
      });
    } else if (section === 'spend') {
      for (let i = 0; i <= row.length - 4; i++) {
        const d = _safeDate(row[i]);
        const amt = _safeNum(row[i + 3]);
        if (!d || !amt) continue;
        if (_cellHas(row[i + 1], 'category') || _cellHas(row[i + 2], 'reason')) continue;
        const catRaw = row[i + 1];
        if (catRaw === null || catRaw === undefined || catRaw === '') continue;
        if (typeof catRaw === 'number') continue;
        if (!isNaN(parseFloat(String(catRaw).replace(/[₹$,\s]/g, '')))) continue;
        const cat = String(catRaw).trim();
        const rsn = String(row[i + 2] || 'Misc');
        const isInv = /sip|mutual|invest|equity|etf|gold/i.test(cat) || /sip|mutual fund|investment|etf/i.test(rsn);
        granularTransactions.push({
          id: `sp-${item.index_}-${i}`, date: d, dateStr: String(row[i]),
          category: isInv ? 'Invested (SIP)' : cat, reason: rsn, amount: amt,
          type: isInv ? 'invest' : 'debit', monthKey: _mKey(d)
        });
      }
    } else if (section === 'credit') {
      for (let i = 0; i <= row.length - 5; i++) {
        const d = _safeDate(row[i]);
        const amt = _safeNum(row[i + 4]);
        if (!d || !amt) continue;
        if (_cellHas(row[i + 2], 'category') || _cellHas(row[i + 3], 'reason')) continue;
        const catRaw = row[i + 2];
        if (typeof catRaw === 'number') continue;
        if (catRaw && !isNaN(parseFloat(String(catRaw).replace(/[₹$,\s]/g, '')))) continue;
        granularTransactions.push({
          id: `cr-${item.index_}-${i}`, date: d, dateStr: String(row[i]),
          category: String(catRaw || 'Credit Inflow').trim(),
          reason: String(row[i + 3] || catRaw || 'Inflow').trim(),
          amount: amt, type: 'credit', monthKey: _mKey(d)
        });
      }
    } else if (section === 'invest') {
      for (let i = 0; i <= row.length - 3; i++) {
        const d = _safeDate(row[i]);
        const amt = _safeNum(row[i + 2]);
        if (!d || !amt) continue;
        if (_cellHas(row[i + 1], 'reason')) continue;
        const rsnRaw = row[i + 1];
        if (typeof rsnRaw === 'number') continue;
        granularTransactions.push({
          id: `iv-${item.index_}-${i}`, date: d, dateStr: String(row[i]),
          category: 'Invested (SIP)', reason: String(rsnRaw || 'Investment').trim(),
          amount: amt, type: 'invest', monthKey: _mKey(d)
        });
      }
    }
  }

  return {
    summaryLogs: summaryLogs.sort((a, b) => a.date - b.date),
    granularTransactions: granularTransactions.sort((a, b) => b.date - a.date)
  };
}

/* ------------------------------------------------------------------ */
/* 2. Main                                                             */
/* ------------------------------------------------------------------ */

export default function App({ data }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedRow, setExpandedRow] = useState(null);
  const [timeRange, setTimeRange] = useState('total');
  const [addModal, setAddModal] = useState({ open: false, step: 1, type: null });
  const [localTxs, setLocalTxs] = useState([]);
  const [ledgerMode, setLedgerMode] = useState('monthly'); // monthly | yearly
  const [drawerQuery, setDrawerQuery] = useState('');
  const [trajectoryRange, setTrajectoryRange] = useState('total'); // 3m | year | total
  const [allocationRange, setAllocationRange] = useState('total'); // month | 3m | year | total
  const [categoryRange, setCategoryRange]     = useState('total');
  const [theme, setTheme] = useState(() => {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  });
  const applyTheme = (t) => {
    setTheme(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
    try { localStorage.setItem('wp-theme', t); } catch {}
  };
  useEffect(() => {}, [theme]);

  /* Privacy mode — masks every sheet value on-screen via CSS blur */
  const [privateMode, setPrivateMode] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('private-mode', privateMode);
  }, [privateMode]);

  const { summaryLogs, granularTransactions: parsedTx } = useMemo(() => scanAllData(data), [data]);
  const granularTransactions = useMemo(
    () => [...localTxs, ...parsedTx].sort((a, b) => b.date - a.date),
    [localTxs, parsedTx]
  );

  const debitCategories  = ['Essentials', 'Food', 'Fun', 'Given', 'Miscellaneous', 'Home', 'Rent', 'Returned', 'Travel'];
  const creditCategories = ['Taken', 'Returned', 'Salary', 'Miscellaneous'];

  const openAdd = () => setAddModal({ open: true, step: 1, type: null });
  const closeAdd = () => setAddModal({ open: false, step: 1, type: null });
  const pickType = (type) => setAddModal({ open: true, step: 2, type });
  const commitTx = async (entry) => {
    const d = entry.date ? new Date(entry.date) : new Date();
    const amt = parseFloat(entry.amount) || 0;
    if (!amt) return;
    const id = `local-${Date.now()}`;
    const tx = {
      id, date: d,
      dateStr: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d),
      category: addModal.type === 'invest' ? 'Invested (SIP)' : (entry.category || 'Miscellaneous'),
      reason: entry.reason || '---',
      amount: amt,
      type: addModal.type,
      monthKey: _mKey(d),
      pending: true,
    };
    setLocalTxs(prev => [tx, ...prev]);
    closeAdd();

    try {
      const r = await fetch('/api/sheet/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: addModal.type,
          date: d.toISOString(),
          category: tx.category,
          reason: tx.reason,
          amount: tx.amount,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      setLocalTxs(prev => prev.map(t => t.id === id ? { ...t, pending: false, synced: true } : t));
    } catch (err) {
      console.error('Sheet append failed:', err.message);
      setLocalTxs(prev => prev.map(t => t.id === id ? { ...t, pending: false, failed: err.message } : t));
      alert(`Couldn't write to sheet: ${err.message}\n\nMake sure the sheet is shared with the service account email as EDITOR (not Viewer).`);
    }
  };

  const yearlyLogs = useMemo(() => {
    const groups = d3.group(summaryLogs, d => d.year);
    return Array.from(groups, ([year, months]) => {
      const sorted = months.slice().sort((a, b) => a.date - b.date);
      return {
        id: `yr-${year}`,
        year, date: new Date(year, 0, 1),
        monthKey: null, label: String(year),
        start: sorted[0].start,
        expense: d3.sum(sorted, d => d.expense),
        invest:  d3.sum(sorted, d => d.invest),
        credit:  d3.sum(sorted, d => d.credit),
        balance: sorted[sorted.length - 1].balance,
      };
    }).sort((a, b) => a.year - b.year);
  }, [summaryLogs]);

  const scopeSummary = (key) => {
    const latest = summaryLogs[summaryLogs.length - 1];
    if (!latest) return summaryLogs;
    if (key === 'month') return [latest];
    if (key === '3m') {
      const cutoff = new Date(latest.date); cutoff.setMonth(cutoff.getMonth() - 2);
      return summaryLogs.filter(l => l.date >= cutoff);
    }
    if (key === 'year') return summaryLogs.filter(l => l.year === latest.year);
    return summaryLogs;
  };
  const scopeTx = (key) => {
    const latest = summaryLogs[summaryLogs.length - 1];
    if (!latest) return granularTransactions;
    if (key === 'month') return granularTransactions.filter(t => t.monthKey === latest.monthKey);
    if (key === '3m') {
      const cutoff = new Date(latest.date); cutoff.setMonth(cutoff.getMonth() - 2); cutoff.setDate(1);
      return granularTransactions.filter(t => t.date >= cutoff);
    }
    if (key === 'year') return granularTransactions.filter(t => t.date.getFullYear() === latest.year);
    return granularTransactions;
  };
  const rangeLabel = (k) => k === 'month' ? 'This Month' : k === '3m' ? 'Last 3 Months' : k === 'year' ? 'This Year' : 'All Time';

  const trajectoryLogs = useMemo(() => scopeSummary(trajectoryRange), [summaryLogs, trajectoryRange]);

  const allocation = useMemo(() => {
    const src = scopeSummary(allocationRange);
    if (src.length === 0) return { expense: 0, invest: 0, balance: 0, denom: 1 };
    const expense = d3.sum(src, d => d.expense);
    const invest  = d3.sum(src, d => d.invest);
    const credit  = d3.sum(src, d => d.credit);
    const start   = src[0].start;
    const balance = src[src.length - 1].balance;
    const denom = (start + credit) || 1;
    return { expense, invest, balance, denom };
  }, [summaryLogs, allocationRange]);

  const categoryMix = useMemo(() => {
    const debits = scopeTx(categoryRange).filter(t => t.type === 'debit');
    const groups = d3.rollup(debits, v => d3.sum(v, d => d.amount), d => d.category);
    const arr = Array.from(groups, ([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
    const grand = d3.sum(arr, d => d.total) || 1;
    return arr.map(x => ({ ...x, pct: (x.total / grand) * 100 }));
  }, [granularTransactions, summaryLogs, categoryRange]);


  const metrics = useMemo(() => {
    const latest = summaryLogs[summaryLogs.length - 1];
    let source = summaryLogs;
    if (timeRange === 'month' && latest) source = [latest];
    if (timeRange === 'year' && latest)  source = summaryLogs.filter(l => l.year === latest.year);
    const prev = summaryLogs[summaryLogs.length - 2];
    const growth = latest && prev && prev.balance ? ((latest.balance - prev.balance) / prev.balance) * 100 : 0;
    return {
      net: latest?.balance || 0,
      exp: d3.sum(source, d => d.expense),
      inv: d3.sum(source, d => d.invest),
      cre: d3.sum(source, d => d.credit),
      growth
    };
  }, [summaryLogs, timeRange]);

  const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);

  if (!summaryLogs.length) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-12 text-center">
        <Activity className="w-16 h-16 text-indigo-200 mb-6 animate-pulse" />
        <h2 className="text-2xl font-black text-slate-800">Scanning audit streams…</h2>
        <p className="text-slate-400 mt-4 max-w-sm">No summary rows parsed yet. Make sure the "Final Spent" tab has a Months / Start / Expense / Invest / Credited / Balance header row.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-900 flex flex-col font-sans selection:bg-indigo-100">
      <nav className="bg-white/55 backdrop-blur-2xl backdrop-saturate-150 border-b border-slate-100 sticky top-0 z-[60] shadow-sm px-8 h-20 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center shadow-2xl">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">Spent Analyzer</h1>
            <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-1.5">Granular Audit Intelligence</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100/50 rounded-2xl border border-slate-100">
            <NavBtn active={activeTab === 'overview'}   onClick={() => setActiveTab('overview')}   icon={<LayoutDashboard size={16}/>} label="Overview" />
            <NavBtn active={activeTab === 'statements'} onClick={() => setActiveTab('statements')} icon={<History size={16}/>}         label="Financial Ledger" />
          </div>
          <div className="hidden lg:flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black border border-emerald-100 uppercase tracking-widest">
            <Clock className="w-3.5 h-3.5" /> Wide-Scan Active
          </div>
          <div role="group" aria-label="Theme" className="theme-toggle flex p-1 rounded-xl bg-slate-100 border border-slate-200">
            <button type="button" onClick={() => applyTheme('light')} aria-pressed={theme === 'light'} title="Light mode"
              className={`p-2 rounded-lg transition-all ${theme === 'light' ? 'theme-toggle-active text-amber-500' : 'text-slate-400'}`}>
              <Sun className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => applyTheme('dark')} aria-pressed={theme === 'dark'} title="Dark mode"
              className={`p-2 rounded-lg transition-all ${theme === 'dark' ? 'theme-toggle-active text-indigo-400' : 'text-slate-400'}`}>
              <Moon className="w-4 h-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setPrivateMode(v => !v)}
            aria-pressed={privateMode}
            title={privateMode ? 'Show data' : 'Hide data (presentation mode)'}
            className={`p-2.5 rounded-xl border transition-all ${privateMode ? 'bg-amber-500 text-white border-amber-600 shadow-lg' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}
          >
            {privateMode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-all font-bold text-sm shadow-xl active:scale-95">
            <Plus className="w-4 h-4" /> Add Log
          </button>
        </div>
      </nav>

      {addModal.open && (
        <AddLogModal
          modal={addModal}
          onPick={pickType}
          onSubmit={commitTx}
          onClose={closeAdd}
          debitCategories={debitCategories}
          creditCategories={creditCategories}
        />
      )}

      <main className="max-w-7xl mx-auto w-full px-8 py-10 flex-grow space-y-12">
        <section className="space-y-8">
          <div className="flex items-center justify-between">
            <h2 className="portfolio-pulse-heading text-xs font-black uppercase tracking-[0.25em] flex items-center gap-2">
              <Activity size={16} /> Portfolio Pulse
            </h2>
            <div className="flex p-1 bg-white border border-slate-100 rounded-2xl shadow-sm">
              <FilterBtn active={timeRange === 'month'} onClick={() => setTimeRange('month')} label="This Cycle" />
              <FilterBtn active={timeRange === 'year'}  onClick={() => setTimeRange('year')}  label="This Year" />
              <FilterBtn active={timeRange === 'total'} onClick={() => setTimeRange('total')} label="All Time" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <KPI title="Net Balance"   val={metrics.net} icon={<Wallet />}       color="indigo" growth={metrics.growth} />
            <KPI title="Living Spends" val={metrics.exp} icon={<TrendingDown />} color="rose" />
            <KPI title="SIP Invested"  val={metrics.inv} icon={<TrendingUp />}   color="emerald" />
            <KPI title="Total Inflow"  val={metrics.cre} icon={<CreditCard />}   color="amber" />
          </div>
        </section>

        {activeTab === 'overview' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
            <div className="lg:col-span-2 space-y-10">
              <div className="bg-white rounded-[3rem] p-10 shadow-sm border border-slate-100">
                <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                  <div>
                    <h2 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Growth Trajectory</h2>
                    <p className="text-sm text-slate-400 font-medium mt-1">Multi-series trend · {rangeLabel(trajectoryRange)}</p>
                  </div>
                  <div className="flex gap-4">
                    <Legend color="bg-indigo-600"  label="Balance" />
                    <Legend color="bg-rose-500"    label="Spends"   dashed />
                    <Legend color="bg-emerald-500" label="Invested" dashed />
                  </div>
                </div>
                <RangePicker value={trajectoryRange} onChange={setTrajectoryRange} options={['3m', 'year', 'total']} />
                <div className="mt-6">
                  <Chart logs={trajectoryLogs} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100">
                  <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-widest flex items-center gap-3">
                    <PieChartIcon className="w-5 h-5 text-indigo-600" /> Capital Allocation
                  </h3>
                  <RangePicker value={allocationRange} onChange={setAllocationRange} options={['month','3m','year','total']} />
                  <div className="space-y-6 mt-6">
                    <AllocBar label="Living Expense"   val={allocation.expense} total={allocation.denom} color="bg-rose-500" />
                    <AllocBar label="Strategic Invest" val={allocation.invest}  total={allocation.denom} color="bg-emerald-500" />
                    <AllocBar label="Retained Liquid"  val={allocation.balance} total={allocation.denom} color="bg-indigo-600" />
                  </div>
                </div>
                <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100">
                  <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-widest flex items-center gap-3">
                    <Layers className="w-5 h-5 text-indigo-600" /> Category Mix
                  </h3>
                  <RangePicker value={categoryRange} onChange={setCategoryRange} options={['month','3m','year','total']} />
                  <div className="space-y-4 mt-6">
                    {categoryMix.slice(0, 6).map(c => (
                      <div key={c.category} className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className="text-slate-500" data-private>{c.category}</span>
                          <span className="text-slate-800 tabular-nums">{fmt(c.total)}</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${c.pct}%` }} />
                        </div>
                      </div>
                    ))}
                    {categoryMix.length === 0 && (
                      <p className="text-xs font-bold text-slate-300 italic">No granular debits in this range.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-indigo-600 dark:bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden group">
                <div className="relative z-10 space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/15 rounded-full text-[9px] font-black uppercase tracking-widest">
                    <Clock className="w-3.5 h-3.5" /> Intelligence Insight
                  </div>
                  <h3 className="text-2xl font-black leading-tight">Savings power is ascending.</h3>
                  <p className="text-indigo-100/85 dark:text-slate-400 text-sm leading-relaxed">Keeping living expenses under 40% of inflow is accelerating portfolio growth. Strategic SIPs are compounding consistently.</p>
                </div>
                <TrendingUp className="absolute -bottom-10 -right-10 w-48 h-48 text-white/10 group-hover:scale-110 group-hover:rotate-6 transition-all duration-700" />
              </div>
            </div>

            <div className="space-y-8 flex flex-col">
              <RecentTransactions txs={granularTransactions} />
              <SpendHeatmap txs={granularTransactions} />
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-[3.5rem] shadow-sm border border-slate-100 overflow-hidden">
            <div className="p-10 border-b border-slate-100 bg-slate-50/20 flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div>
                <h2 className="text-2xl font-black text-slate-800 tracking-tight uppercase">Financial Ledger Audit</h2>
                <p className="text-sm text-slate-400 font-medium mt-1">Cross-reference summaries with granular daily transactions</p>
              </div>
              <div className="flex gap-2 p-1 bg-white rounded-2xl border border-slate-100 shadow-sm">
                <FilterBtn active={ledgerMode === 'monthly'} onClick={() => setLedgerMode('monthly')} label="Monthly" />
                <FilterBtn active={ledgerMode === 'yearly'}  onClick={() => setLedgerMode('yearly')}  label="Yearly" />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1000px]">
                <thead>
                  <tr className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em] bg-slate-50/50 border-b border-slate-100">
                    <th className="px-10 py-7">{ledgerMode === 'monthly' ? 'Reporting Period' : 'Year'}</th>
                    <th className="px-10 py-7">Opening Cap</th>
                    <th className="px-10 py-7 text-rose-500/70">Expenditure</th>
                    <th className="px-10 py-7 text-indigo-500/70">Invested (SIP)</th>
                    <th className="px-10 py-7 text-emerald-500/70">Credited</th>
                    <th className="px-10 py-7 text-slate-900">Closing Stat</th>
                    <th className="px-10 py-7 text-right">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {(ledgerMode === 'monthly' ? summaryLogs : yearlyLogs).slice().reverse().map(item => {
                    const monthTx = ledgerMode === 'monthly'
                      ? granularTransactions.filter(tx => tx.monthKey === item.monthKey)
                      : granularTransactions.filter(tx => tx.date.getFullYear() === item.year);
                    const isOpen = expandedRow === item.id;
                    const filtered = drawerQuery
                      ? monthTx.filter(t => (t.reason + ' ' + t.category).toLowerCase().includes(drawerQuery.toLowerCase()))
                      : monthTx;
                    return (
                      <React.Fragment key={item.id}>
                        <tr onClick={() => setExpandedRow(isOpen ? null : item.id)}
                            className={`hover:bg-slate-50 transition-all cursor-pointer group ${isOpen ? 'bg-indigo-50/30' : ''}`}>
                          <td className="px-10 py-8">
                            <div className="flex items-center gap-4">
                              <div className={`p-2 rounded-xl transition-all duration-300 ${isOpen ? 'bg-indigo-600 text-white rotate-180' : 'bg-slate-100 text-slate-400 group-hover:bg-indigo-100'}`}>
                                <ChevronDown size={18} />
                              </div>
                              <span className="font-bold text-slate-800 text-lg" data-private>{item.label}</span>
                            </div>
                          </td>
                          <td className="px-10 py-8 text-slate-400 font-bold text-sm italic tabular-nums" data-private>{fmt(item.start)}</td>
                          <td className="px-10 py-8 text-rose-600 font-black tabular-nums" data-private>{fmt(item.expense)}</td>
                          <td className="px-10 py-8 text-indigo-600 font-black tabular-nums" data-private>{fmt(item.invest)}</td>
                          <td className="px-10 py-8 text-emerald-600 font-black tabular-nums" data-private>{fmt(item.credit)}</td>
                          <td className="px-10 py-8 font-black text-slate-900 text-lg tabular-nums" data-private>{fmt(item.balance)}</td>
                          <td className="px-10 py-8 text-right">
                            <button className="p-3 bg-white rounded-xl shadow-sm border border-slate-100 text-slate-400 hover:text-indigo-600 transition-all">
                              <ExternalLink size={18}/>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-white">
                            <td colSpan={7} className="px-10 py-12 border-x border-slate-50">
                              <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                                <div className="space-y-6">
                                  <div className="p-8 bg-slate-50/50 rounded-[2.5rem] border border-slate-100 shadow-inner">
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                      <Activity size={14} /> Performance Breakdown
                                    </h4>
                                    <SummaryLine label="Opening Capital"  val={fmt(item.start)} />
                                    <SummaryLine label="Credits Received" val={fmt(item.credit)}  color="text-emerald-600" />
                                    <SummaryLine label="Total Outflow"    val={fmt(item.expense + item.invest)} color="text-rose-600" />
                                    <SummaryLine label="Strategic Invest" val={fmt(item.invest)}  color="text-indigo-600" />
                                    <div className="h-px bg-slate-200 my-4" />
                                    <SummaryLine label="Closing Balance"  val={fmt(item.balance)} bold />
                                    <div className="mt-6 p-4 bg-white rounded-2xl border border-slate-100 text-center">
                                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Savings Efficiency</p>
                                      <p className="text-xl font-black text-indigo-600">
                                        {((item.start + item.credit) > 0 ? (item.balance / (item.start + item.credit)) * 100 : 0).toFixed(1)}%
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="lg:col-span-2 space-y-6">
                                  <div className="flex items-center justify-between px-2 gap-3 flex-wrap">
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                      <Receipt size={14}/> Transaction Audit Log · {filtered.length}/{monthTx.length}
                                    </h4>
                                    <div className="relative flex-1 max-w-xs min-w-[180px]">
                                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                                      <input
                                        value={drawerQuery}
                                        onChange={e => setDrawerQuery(e.target.value)}
                                        placeholder="Search reason / category…"
                                        className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                                      />
                                    </div>
                                  </div>
                                  <div className="bg-white rounded-[2.5rem] border border-slate-100 overflow-hidden shadow-sm">
                                    <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
                                      <table className="w-full text-left">
                                        <thead className="sticky top-0 z-20">
                                          <tr className="text-[9px] font-black uppercase text-slate-500 tracking-widest bg-white/85 backdrop-blur-md shadow-[0_2px_8px_-4px_rgba(15,23,42,0.08)] border-b border-slate-200">
                                            <th className="px-6 py-4">Date</th>
                                            <th className="px-6 py-4">Category</th>
                                            <th className="px-6 py-4">Reason</th>
                                            <th className="px-6 py-4 text-right">Amount</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                          {filtered.map(tx => (
                                            <tr key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                                              <td className="px-6 py-4 text-[10px] font-bold text-slate-400 tabular-nums whitespace-nowrap" data-private>{tx.dateStr}</td>
                                              <td className="px-6 py-4">
                                                <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-tighter ${
                                                  tx.type === 'invest' ? 'bg-indigo-50 text-indigo-600' :
                                                  tx.type === 'credit' ? 'bg-emerald-50 text-emerald-600' :
                                                                          'bg-slate-100 text-slate-500'
                                                }`} data-private>{tx.category}</span>
                                              </td>
                                              <td className="px-6 py-4 text-xs font-bold text-slate-700" data-private>{tx.reason}</td>
                                              <td className={`px-6 py-4 text-right text-xs font-black tabular-nums ${
                                                tx.type === 'credit' ? 'text-emerald-600' :
                                                tx.type === 'invest' ? 'text-indigo-600'  : 'text-rose-500'
                                              }`} data-private>
                                                {tx.type === 'credit' || tx.type === 'invest' ? '+' : '-'}{fmt(tx.amount)}
                                              </td>
                                            </tr>
                                          ))}
                                          {filtered.length === 0 && (
                                            <tr><td colSpan={4} className="px-6 py-24 text-center text-xs font-bold text-slate-300 italic">
                                              {drawerQuery ? `No matches for "${drawerQuery}"` : 'No granular records for this period.'}
                                            </td></tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function KPI({ title, val, icon, color, growth }) {
  const themes = {
    indigo:  { chip: 'bg-indigo-50 text-indigo-600 border-indigo-100',   bg: 'from-indigo-50/40' },
    rose:    { chip: 'bg-rose-50 text-rose-600 border-rose-100',         bg: 'from-rose-50/40' },
    emerald: { chip: 'bg-emerald-50 text-emerald-600 border-emerald-100',bg: 'from-emerald-50/40' },
    amber:   { chip: 'bg-amber-50 text-amber-600 border-amber-100',      bg: 'from-amber-50/40' }
  };
  const t = themes[color];
  return (
    <div className={`relative bg-white p-10 rounded-[3rem] shadow-sm border border-slate-100 group hover:shadow-2xl transition-all duration-700 overflow-hidden bg-gradient-to-br ${t.bg} via-white to-white`}>
      {/* Watermark icon */}
      <div className="absolute -bottom-12 -right-12 text-slate-900 opacity-[0.045] group-hover:opacity-[0.08] group-hover:scale-110 group-hover:-rotate-6 transition-all duration-1000 pointer-events-none">
        {React.cloneElement(icon, { size: 220, strokeWidth: 1.5 })}
      </div>
      {/* Subtle inner gloss */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/40 to-transparent pointer-events-none rounded-[3rem]" />

      <div className="relative z-10 flex justify-between items-start mb-10">
        <div className={`p-4 rounded-[1.5rem] ${t.chip} group-hover:scale-110 transition-transform duration-700 border shadow-sm`}>
          {React.cloneElement(icon, { size: 24 })}
        </div>
        {growth !== undefined && (
          <div className={`px-3 py-1.5 rounded-full text-[10px] font-black flex items-center gap-1.5 ${growth >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {growth >= 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>} {Math.abs(growth).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="relative z-10">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em]">{title}</p>
        <h4 className="text-3xl font-black text-slate-800 mt-2.5 tracking-tight tabular-nums">
          {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0)}
        </h4>
      </div>
    </div>
  );
}

function Chart({ logs }) {
  const [hoverIdx, setHoverIdx] = React.useState(null);
  if (logs.length < 2) {
    return <div className="h-64 flex items-center justify-center text-sm text-slate-300 italic">Need at least two months of summary rows to plot a trajectory.</div>;
  }
  const m = { t: 20, r: 20, b: 40, l: 65 };
  const w = 800, h = 320, iw = w - m.l - m.r, ih = h - m.t - m.b;
  const x = d3.scaleTime().domain(d3.extent(logs, d => d.date)).range([0, iw]);
  const yMax = d3.max(logs, d => Math.max(d.balance, d.expense, d.invest)) || 1;
  const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([ih, 0]).nice();
  const line = (key) => d3.line().x(d => x(d.date)).y(d => y(d[key])).curve(d3.curveCatmullRom.alpha(0.5));
  const fmtTip = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);
  const fmtMonth = (d) => new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(d);
  const bandW = iw / logs.length;
  const hovered = hoverIdx !== null ? logs[hoverIdx] : null;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto overflow-visible">
      <g transform={`translate(${m.l}, ${m.t})`}>
        {y.ticks(5).map(t => (
          <g key={t} transform={`translate(0, ${y(t)})`}>
            <line x1={0} x2={iw} className="chart-grid" strokeDasharray="4 4" />
            <text x="-12" dy="4" textAnchor="end" className="fill-slate-400 text-[10px] font-bold tabular-nums">{t >= 1000 ? `${(t/1000).toFixed(0)}k` : t}</text>
          </g>
        ))}
        {logs.map((d, i) => (
          <text key={i} x={x(d.date)} y={ih + 22} textAnchor="middle" className="fill-slate-400 text-[8px] font-black uppercase tracking-widest">{fmtMonth(d.date)}</text>
        ))}

        {/* Series — secondary lines deliberately soft */}
        <path d={line('expense')(logs)} fill="none" stroke="#fda4af" strokeWidth="2" strokeDasharray="6 4" strokeOpacity="0.55" />
        <path d={line('invest')(logs)}  fill="none" stroke="#6ee7b7" strokeWidth="2" strokeDasharray="6 4" strokeOpacity="0.55" />
        <path d={line('balance')(logs)} fill="none" stroke="#4f46e5" strokeWidth="3.5" strokeLinecap="round" />

        {/* Points */}
        {logs.map((d, i) => (
          <g key={i}>
            <circle cx={x(d.date)} cy={y(d.expense)} r="2.5" fill="#fda4af" fillOpacity="0.7" />
            <circle cx={x(d.date)} cy={y(d.invest)}  r="2.5" fill="#6ee7b7" fillOpacity="0.7" />
            <circle cx={x(d.date)} cy={y(d.balance)} r="5"   fill="#4f46e5" stroke="#fff" strokeWidth="2" />
          </g>
        ))}

        {/* Hover hit zones */}
        {logs.map((d, i) => (
          <rect key={`hz-${i}`} x={x(d.date) - bandW/2} y={0} width={bandW} height={ih}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)} />
        ))}

        {/* Hover tooltip */}
        {hovered && (
          <g pointerEvents="none">
            <line x1={x(hovered.date)} x2={x(hovered.date)} y1={0} y2={ih} stroke="#94a3b8" strokeDasharray="3 3" />
            <circle cx={x(hovered.date)} cy={y(hovered.balance)} r="7" fill="#4f46e5" stroke="#fff" strokeWidth="3" />
            <circle cx={x(hovered.date)} cy={y(hovered.expense)} r="5" fill="#f43f5e" stroke="#fff" strokeWidth="2" />
            <circle cx={x(hovered.date)} cy={y(hovered.invest)}  r="5" fill="#10b981" stroke="#fff" strokeWidth="2" />
            {(() => {
              const tipW = 180, tipH = 88;
              const tipX = x(hovered.date) + 14 + tipW > iw ? x(hovered.date) - tipW - 14 : x(hovered.date) + 14;
              return (
                <g transform={`translate(${tipX}, 8)`}>
                  <rect width={tipW} height={tipH} rx="10" fill="#0f172a" />
                  <text x="12" y="20" className="fill-white text-[10px] font-black uppercase tracking-widest">{fmtMonth(hovered.date)}</text>
                  <circle cx="14" cy="38" r="3" fill="#818cf8" />
                  <text x="22" y="42" className="fill-white text-[10px] font-bold">Balance: {fmtTip(hovered.balance)}</text>
                  <circle cx="14" cy="54" r="3" fill="#fb7185" />
                  <text x="22" y="58" className="fill-white text-[10px] font-bold">Spent: {fmtTip(hovered.expense)}</text>
                  <circle cx="14" cy="70" r="3" fill="#34d399" />
                  <text x="22" y="74" className="fill-white text-[10px] font-bold">Invest: {fmtTip(hovered.invest)}</text>
                </g>
              );
            })()}
          </g>
        )}
      </g>
    </svg>
  );
}

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 px-8 py-3.5 rounded-2xl font-black text-sm transition-all ${active ? 'bg-white shadow-xl shadow-slate-200/50 text-indigo-600' : 'text-slate-400 hover:text-slate-700 hover:bg-white/50'}`}>
      {icon} {label}
    </button>
  );
}
function RangePicker({ value, onChange, options }) {
  const labels = { month: 'This Month', '3m': 'Last 3M', year: 'This Year', total: 'All Time' };
  return (
    <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200">
      {options.map(k => (
        <button key={k} onClick={() => onChange(k)}
          className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${value === k ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
          {labels[k]}
        </button>
      ))}
    </div>
  );
}

function FilterBtn({ active, onClick, label }) {
  return (
    <button onClick={onClick} className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${active ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-400 hover:text-slate-600'}`}>
      {label}
    </button>
  );
}
function Legend({ color, label, dashed }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-full ${color} ${dashed ? 'opacity-40' : ''}`} />
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
    </div>
  );
}
function MetricTag({ label, val, color }) {
  return (
    <div className="flex flex-col items-center p-2 bg-white rounded-xl shadow-sm border border-slate-100">
      <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</span>
      <span className={`text-[10px] font-black tabular-nums ${color}`}>
        {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val || 0)}
      </span>
    </div>
  );
}
function SummaryLine({ label, val, color = 'text-slate-600', bold = false }) {
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-xs font-bold text-slate-400">{label}</span>
      <span className={`text-sm ${bold ? 'font-black' : 'font-bold'} ${color} tabular-nums`}>{val}</span>
    </div>
  );
}
function AllocBar({ label, val, total, color }) {
  const pct = total > 0 ? Math.min((val / total) * 100, 100) : 0;
  return (
    <div className="space-y-3">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.15em] text-slate-400">
        <span>{label}</span><span className="text-slate-800 font-black">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden p-0.5 border border-slate-50 shadow-inner">
        <div className={`h-full ${color} rounded-full transition-all duration-1000 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
/* Add Log Modal                                                       */
/* ------------------------------------------------------------------ */

function AddLogModal({ modal, onPick, onSubmit, onClose, debitCategories = [], creditCategories = [] }) {
  const activeList = modal.type === 'credit' ? creditCategories : debitCategories;
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: activeList[0] || '',
    reason: '',
    amount: ''
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const typeMeta = {
    credit: { label: 'Credit',  desc: 'Money received (returns, salary, refunds)', icon: <ArrowDownLeft className="w-5 h-5"/>, tone: 'bg-emerald-50 text-emerald-600 border-emerald-100', accent: 'bg-emerald-600' },
    debit:  { label: 'Debit',   desc: 'Living expenses, food, travel, bills',     icon: <ArrowUpRight  className="w-5 h-5"/>, tone: 'bg-rose-50 text-rose-600 border-rose-100',        accent: 'bg-rose-600'    },
    invest: { label: 'Invest',  desc: 'SIPs, mutual funds, ETFs, gold',           icon: <Briefcase     className="w-5 h-5"/>, tone: 'bg-indigo-50 text-indigo-600 border-indigo-100',  accent: 'bg-indigo-600'  }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg relative overflow-hidden">
        <div className="bg-indigo-600 p-8 text-white relative">
          <h3 className="text-2xl font-black tracking-tight">
            {modal.step === 1 ? 'New Log Entry' : `New ${typeMeta[modal.type].label} Entry`}
          </h3>
          <p className="text-indigo-100/80 text-xs mt-1 font-medium">
            {modal.step === 1 ? 'Choose the type of transaction you want to record.' : 'Fill in the details below.'}
          </p>
          <button onClick={onClose} className="absolute top-6 right-6 p-2 bg-white/10 rounded-full hover:bg-white/20 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {modal.step === 1 ? (
          <div className="p-8 space-y-3">
            {Object.entries(typeMeta).map(([k, t]) => (
              <button key={k} onClick={() => onPick(k)} className={`w-full flex items-center gap-4 p-5 rounded-2xl border ${t.tone} hover:shadow-md transition-all text-left`}>
                <div className={`w-12 h-12 rounded-xl ${t.accent} text-white flex items-center justify-center`}>{t.icon}</div>
                <div>
                  <p className="text-sm font-black uppercase tracking-widest">{t.label}</p>
                  <p className="text-[11px] font-medium opacity-80 mt-0.5">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="p-8 space-y-5">
            <Field label="Date" icon={<Calendar className="w-3.5 h-3.5"/>}>
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)}
                     className="w-full bg-slate-50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-sm text-slate-700" />
            </Field>
            {modal.type !== 'invest' && (
              <Field label="Category" icon={<LayoutDashboard className="w-3.5 h-3.5"/>}>
                <select value={form.category} onChange={e => set('category', e.target.value)}
                        className="w-full bg-slate-50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-sm text-slate-700 cursor-pointer">
                  {activeList.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            )}
            <Field label="Reason / Narration" icon={<Receipt className="w-3.5 h-3.5"/>}>
              <input value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Describe the entry"
                     className="w-full bg-slate-50 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500 font-bold text-sm text-slate-700" />
            </Field>
            <Field label="Amount (INR)" icon={<IndianRupee className="w-3.5 h-3.5"/>}>
              <input type="number" inputMode="decimal" value={form.amount} onChange={e => set('amount', e.target.value)} placeholder="0"
                     className="w-full bg-indigo-50 text-indigo-700 rounded-xl px-4 py-3.5 outline-none focus:ring-2 focus:ring-indigo-500 font-black text-lg" />
            </Field>
            <div className="flex gap-3 pt-2">
              <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200">Cancel</button>
              <button onClick={() => onSubmit(form)} className="flex-1 py-3 bg-indigo-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-indigo-700">
                Commit Entry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, icon, children }) {
  return (
    <label className="space-y-2 block">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">{icon} {label}</span>
      {children}
    </label>
  );
}
/* ------------------------------------------------------------------ */
/* Recent Transactions + Spend Heatmap                                 */
/* ------------------------------------------------------------------ */

function RecentTransactions({ txs }) {
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);

  const meta = (k) => k === 'credit'
    ? { sign: '+', tone: 'text-emerald-600', pill: 'bg-emerald-50 text-emerald-600' }
    : k === 'invest'
      ? { sign: '+', tone: 'text-indigo-600',  pill: 'bg-indigo-50 text-indigo-600' }
      : { sign: '-', tone: 'text-rose-500',    pill: 'bg-slate-100 text-slate-500' };

  const filtered = txs
    .filter(t => filter === 'all' || t.type === filter)
    .filter(t => !q || (t.reason + ' ' + t.category).toLowerCase().includes(q.toLowerCase()))
    .slice(0, 40);

  return (
    <div className="bg-white rounded-[3rem] p-8 shadow-sm border border-slate-100 flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-black text-slate-800 tracking-tight">Recent Transactions</h2>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{filtered.length} of {txs.length}</span>
      </div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" aria-label="Search recent transactions"
               className="w-full pl-9 pr-3 py-2 bg-slate-50 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500" />
      </div>
      <div className="flex gap-1.5 p-1 bg-slate-100/60 rounded-xl mb-6">
        {['all', 'debit', 'credit', 'invest'].map(k => (
          <button key={k} onClick={() => setFilter(k)}
            className={`flex-1 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${filter === k ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400'}`}>
            {k === 'all' ? 'All' : k.charAt(0).toUpperCase() + k.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto max-h-[560px] pr-2 -mr-2 space-y-2 custom-scrollbar">
        {filtered.map(t => {
          const m = meta(t.type);
          return (
            <div key={t.id} className="flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 transition-colors">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${m.pill}`}>
                {t.type === 'credit' ? <ArrowDownLeft className="w-4 h-4" /> : t.type === 'invest' ? <Briefcase className="w-4 h-4" /> : <ArrowUpRight className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700 truncate" data-private>{t.reason}</p>
                  <p className={`text-[11px] font-black whitespace-nowrap tabular-nums ${m.tone}`} data-private>{m.sign}{fmt(t.amount)}</p>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest truncate" data-private>{t.category}</span>
                  <span className="text-[9px] font-bold text-slate-400" data-private>{t.dateStr}</span>
                </div>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-xs text-slate-300 italic text-center py-12">No matches.</p>
        )}
      </div>
    </div>
  );
}

function SpendHeatmap({ txs }) {
  const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const start = useMemo(() => {
    const d = new Date(today); d.setDate(d.getDate() - 90);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [today]);

  const dayTotals = useMemo(() => {
    const map = new Map();
    txs.filter(t => t.type === 'debit' && t.date >= start && t.date <= today).forEach(t => {
      const key = t.date.toDateString();
      map.set(key, (map.get(key) || 0) + t.amount);
    });
    return map;
  }, [txs, start, today]);

  const max = useMemo(() => Math.max(1, ...Array.from(dayTotals.values())), [dayTotals]);

  const cells = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    cells.push({ key: cursor.toDateString(), date: new Date(cursor), v: dayTotals.get(cursor.toDateString()) || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const intensity = (v) => {
    if (!v) return 0;
    const r = v / max;
    if (r < 0.2) return 1; if (r < 0.4) return 2; if (r < 0.7) return 3; return 4;
  };
  const cellColor = {
    0: 'heatmap-cell-0',
    1: 'heatmap-cell-1',
    2: 'heatmap-cell-2',
    3: 'heatmap-cell-3',
    4: 'heatmap-cell-4',
  };
  const totalSpent = Array.from(dayTotals.values()).reduce((a, b) => a + b, 0);
  const spentDays = Array.from(dayTotals.values()).filter(v => v > 0).length;

  return (
    <div className="bg-white rounded-[3rem] p-8 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-lg font-black text-slate-800 tracking-tight">Spend Heatmap · 90d</h2>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{spentDays} active · {fmt(totalSpent)}</span>
      </div>
      <div className="flex gap-1 overflow-x-auto custom-scrollbar pb-2">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {Array.from({ length: 7 }).map((_, di) => {
              const cell = week[di];
              if (!cell) return <div key={di} className="w-3.5 h-3.5" />;
              const c = intensity(cell.v);
              return (
                <div key={di}
                     title={`${cell.date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}: ${cell.v ? fmt(cell.v) : 'no spend'}`}
                     className={`w-3.5 h-3.5 rounded-[3px] ${cellColor[c]} hover:ring-2 hover:ring-indigo-400 transition-all cursor-default`} />
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-1.5 mt-4 text-[9px] font-black text-slate-400 uppercase tracking-widest">
        <span>less</span>
        {[0,1,2,3,4].map(n => <div key={n} className={`w-3 h-3 rounded-[3px] ${cellColor[n]}`} />)}
        <span>more</span>
      </div>
    </div>
  );
}