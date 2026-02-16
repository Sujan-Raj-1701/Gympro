import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar as CalendarIcon, Filter, PlusCircle, MinusCircle, FileSpreadsheet, FileText, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { exportData } from "@/lib/exportUtils";
import { useAuth } from "@/contexts/AuthContext";
import { DataService } from "@/services/userService";
import { useToast } from "@/hooks/use-toast";

export default function CashFlow() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const todayISO = new Date().toISOString().split("T")[0];
  const [fromDate, setFromDate] = useState<string>(todayISO);
  const [toDate, setToDate] = useState<string>(todayISO);
  const [entries, setEntries] = useState<Array<{
    id?: string | number;
    date: string;
    type: "inflow" | "outflow";
    description: string;
    amount: number;
    price?: number;
    qty?: number;
    tax_id?: string;
    tax_amount?: number;
    tax_cgst?: number;
    tax_sgst?: number;
    inclusive?: boolean;
    customer_id?: number | string;
    customer_name?: string;
    customer_phone?: string;
    customer_address?: string;
    customer_gstin?: string;
  }>>([]);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<'date'|'type'|'description'|'amount'|'price'>('date');
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [typeFilter, setTypeFilter] = useState<'all'|'income'|'expense'>('all');

  const loadEntries = async () => {
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const res = await DataService.getIncomeExpenses(fromDate, toDate, acc, ret);
      const data = (res as any)?.data || (res as any)?.rows || (res as any)?.items || [];
      const norm = data.map((e: any) => ({
        id: e.id,
        date: e.date,
        type: (String(e.type || '').toLowerCase() === 'income'
          ? 'inflow'
          : (String(e.type || '').toLowerCase() === 'expense'
            ? 'outflow'
            : (e.type || 'inflow'))) as 'inflow' | 'outflow',
        description: e.description || '',
        amount: Number(e.amount) || 0,
        price: e.price != null ? Number(e.price) : undefined,
        qty: e.qty != null ? Number(e.qty) : undefined,
        tax_id: e.tax_id,
        tax_amount: e.tax_amount != null ? Number(e.tax_amount) : undefined,
        tax_cgst: e.tax_cgst != null ? Number(e.tax_cgst) : undefined,
        tax_sgst: e.tax_sgst != null ? Number(e.tax_sgst) : undefined,
        inclusive: e.inclusive === true || e.inclusive === 1,
        customer_id: e.customer_id,
        customer_name: e.customer_name,
        customer_phone: e.customer_phone,
        customer_address: e.customer_address,
        customer_gstin: e.customer_gstin,
      }));
      setEntries(norm);
    } catch (err: any) {
      toast({ title: "Failed to load entries", description: String(err?.message || err), variant: "destructive" });
    }
  };

  useEffect(() => {
    // initial load for today
    loadEntries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const prepared = useMemo(() => {
    const from = fromDate ? new Date(fromDate) : null;
    const to = toDate ? new Date(toDate) : null;
    const byDate = entries
      .filter((e) => {
        const d = new Date(e.date);
        if (from && d < from) return false;
        if (to) {
          const t = new Date(to);
          // include the entire end day
          t.setHours(23, 59, 59, 999);
          if (d > t) return false;
        }
        return true;
      });
    // Type filter: all | income | expense
    const byType = byDate.filter((e) => {
      if (typeFilter === 'all') return true;
      return typeFilter === 'income' ? e.type === 'inflow' : e.type === 'outflow';
    });
    const bySearch = byType.filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      const dateStr = new Date(e.date).toLocaleDateString().toLowerCase();
      const typeStr = (e.type === 'inflow' ? 'income' : 'expense');
      return (
        dateStr.includes(q) ||
        typeStr.includes(q) ||
        (e.description||'').toLowerCase().includes(q) ||
        (e.customer_name || '').toLowerCase().includes(q) ||
        (e.customer_phone || '').toLowerCase().includes(q) ||
        (e.customer_gstin || '').toLowerCase().includes(q) ||
        String(e.amount).includes(q)
      );
    });
    const sorted = [...bySearch].sort((a,b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'date':
          return (new Date(a.date).getTime() - new Date(b.date).getTime()) * dir;
        case 'amount':
          return (a.amount - b.amount) * dir;
        case 'price':
          return ((a.price||0) - (b.price||0)) * dir;
        case 'type': {
          const at = a.type === 'inflow' ? 'Income' : 'Expense';
          const bt = b.type === 'inflow' ? 'Income' : 'Expense';
          return at.localeCompare(bt) * dir;
        }
        case 'description':
        default:
          return (a.description||'').localeCompare(b.description||'') * dir;
      }
    });
    return sorted;
  }, [entries, fromDate, toDate, search, sortKey, sortDir, typeFilter]);

  const totalRows = prepared.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = prepared.slice(startIdx, endIdx);

  // Reset page to 1 when filters/search/pageSize change or entries reload
  useEffect(() => { setPage(1); }, [fromDate, toDate, search, pageSize, entries.length, typeFilter]);

  const totals = useMemo(() => {
    const inflowRows = prepared.filter(e=>e.type==='inflow');
    const outflowRows = prepared.filter(e=>e.type==='outflow');
    const inflow = inflowRows.reduce((s,e)=>s+e.amount,0);
    const outflow = outflowRows.reduce((s,e)=>s+e.amount,0);
    return {
      inflow,
      outflow,
      inflowCount: inflowRows.length,
      outflowCount: outflowRows.length,
      net: inflow - outflow
    };
  }, [prepared]);

  const handleExport = (format: "excel" | "pdf") => {
    const columns = [
      { header: "Date", dataKey: "date", width: 14 },
      { header: "Type", dataKey: "type", width: 12 },
      { header: "Customer", dataKey: "customer_name", width: 30 },
      { header: "Phone", dataKey: "customer_phone", width: 16 },
      { header: "GSTIN", dataKey: "customer_gstin", width: 22 },
      { header: "Description", dataKey: "description", width: 40 },
      { header: "Price", dataKey: "price", width: 14 },
      { header: "Qty", dataKey: "qty", width: 8 },
      { header: "Tax Amount", dataKey: "tax_amount", width: 16 },
      { header: "Amount", dataKey: "amount", width: 14 },
    ];
  const data = prepared.map((e) => ({
      date: new Date(e.date),
      type: e.type === "inflow" ? "Income" : "Expense",
      customer_name: e.customer_name || '',
      customer_phone: e.customer_phone || '',
      customer_gstin: e.customer_gstin || '',
      description: e.description,
      price: e.price,
      qty: e.qty,
      tax_amount: e.tax_amount,
      amount: e.amount,
    }));
    const filename = `cash-flow_${fromDate || "all"}_${toDate || "all"}`;
    exportData(format, {
      filename,
      title: "Cash Flow",
      subtitle: "Income and expense entries",
      columns: columns as any,
      data,
      dateRange:
        fromDate && toDate
          ? { from: new Date(fromDate), to: new Date(toDate) }
          : undefined,
    });
  };

  // Navigate to invoice page with entry state
  const handleOpenInvoice = (entry: {id?:any}) => {
    if (entry.id == null) {
      // fallback: still allow old popup logic? For now show alert.
      alert('No ID available for this entry to open invoice page.');
      return;
    }
    navigate(`/financetracker/cashflow/invoice/${entry.id}`, { state: { entry } });
  };

  return (
    <div className="space-y-4">
      {/* Back button removed as requested */}

      {/* Date filter with primary actions (unified bar) */}
      <Card className="border border-slate-200 bg-white rounded-lg shadow-sm">
        <CardContent className="p-3 md:p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            {/* Left: Date filter */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <CalendarIcon className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-slate-600 whitespace-nowrap">From</span>
                  <Input type="date" value={fromDate} onChange={(e)=>setFromDate(e.target.value)} className="h-9" />
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-slate-600 whitespace-nowrap">To</span>
                  <Input type="date" value={toDate} onChange={(e)=>setToDate(e.target.value)} className="h-9" />
                </div>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9 px-6" onClick={loadEntries}>
                  <Filter className="h-4 w-4 mr-1.5" /> Apply
                </Button>
              </div>
            </div>

            {/* Middle: Search + Type filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto md:flex-1 md:justify-center">
              <Input
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
                placeholder="Search..."
                className="h-9 w-full sm:w-[220px]"
              />
              <Select value={typeFilter} onValueChange={(v)=>setTypeFilter(v as any)}>
                <SelectTrigger className="h-9 w-full sm:w-[160px]">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Right: Add entry actions */}
            <div className="flex flex-row gap-2 md:justify-end">
              <Button size="sm" className="bg-blue-600 hover:bg-blue-700 text-white h-9 px-4" onClick={() => navigate("/financetracker/cashflow/add?type=inflow")}> 
                <PlusCircle className="h-4 w-4 mr-1.5" /> Income Entry
              </Button>
              <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white h-9 px-4" onClick={() => navigate("/financetracker/cashflow/add?type=outflow")}> 
                <MinusCircle className="h-4 w-4 mr-1.5" /> Expense Entry
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Entries table */}
      <Card className="border border-slate-200 bg-white rounded-lg overflow-hidden w-full shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3 px-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
                <div className="flex items-stretch gap-2">
                  <Card className="group relative h-full overflow-hidden bg-gradient-to-br from-white to-slate-50/80 backdrop-blur-sm border border-slate-200/80 rounded-xl shadow-sm">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
                    <CardHeader className="pb-1.5 pt-2 px-3">
                      <div className="flex items-center gap-2">
                        <span title="Income" className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                          <PlusCircle className="h-4 w-4" />
                        </span>
                        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Income</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-2 px-3">
                      <div className="grid grid-cols-2 gap-0 min-w-[200px]">
                        <div className="py-1 text-center">
                          <div className="text-[11px] text-slate-500">Qty</div>
                          <div className="text-lg font-bold text-emerald-700">{totals.inflowCount}</div>
                        </div>
                        <div className="py-1 text-center border-l border-slate-200">
                          <div className="text-[11px] text-slate-500">Amount</div>
                          <div className="text-base font-bold text-emerald-700">₹{totals.inflow.toLocaleString("en-IN")}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="group relative h-full overflow-hidden bg-gradient-to-br from-white to-slate-50/80 backdrop-blur-sm border border-slate-200/80 rounded-xl shadow-sm">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500" />
                    <CardHeader className="pb-1.5 pt-2 px-3">
                      <div className="flex items-center gap-2">
                        <span title="Expense" className="p-1.5 rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                          <MinusCircle className="h-4 w-4" />
                        </span>
                        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Expense</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-2 px-3">
                      <div className="grid grid-cols-2 gap-0 min-w-[200px]">
                        <div className="py-1 text-center">
                          <div className="text-[11px] text-slate-500">Qty</div>
                          <div className="text-lg font-bold text-rose-700">{totals.outflowCount}</div>
                        </div>
                        <div className="py-1 text-center border-l border-slate-200">
                          <div className="text-[11px] text-slate-500">Amount</div>
                          <div className="text-base font-bold text-rose-700">₹{totals.outflow.toLocaleString("en-IN")}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="group relative h-full overflow-hidden bg-gradient-to-br from-white to-slate-50/80 backdrop-blur-sm border border-slate-200/80 rounded-xl shadow-sm">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-500" />
                    <CardHeader className="pb-1.5 pt-2 px-3">
                      <div className="flex items-center gap-2">
                        <span title="Net (Income - Expense)" className="p-1.5 rounded-lg bg-slate-100 text-slate-700 ring-1 ring-slate-200">
                          <Filter className="h-4 w-4" />
                        </span>
                        <CardTitle className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">Net</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-2 px-3">
                      <div className="min-w-[200px] py-1 text-center">
                        <div className="text-[11px] text-slate-500">Income - Expense</div>
                        <div className={"text-base font-bold " + (totals.net >= 0 ? "text-emerald-700" : "text-rose-700")}>
                          ₹{totals.net.toLocaleString("en-IN")}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handleExport("excel")}>
                <FileSpreadsheet className="h-4 w-4 mr-1.5" /> Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}>
                <FileText className="h-4 w-4 mr-1.5" /> Export PDF
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {prepared.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No entries yet. Use “Income Entry” or “Expense Entry” to add a cash transaction.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-slate-700">
                    <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={()=>{
                      setSortKey('date'); setSortDir(prev => (sortKey==='date' && prev==='asc') ? 'desc' : 'asc');
                    }}>
                      Date {sortKey==='date' ? (sortDir==='asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={()=>{
                      setSortKey('type'); setSortDir(prev => (sortKey==='type' && prev==='asc') ? 'desc' : 'asc');
                    }}>
                      Type {sortKey==='type' ? (sortDir==='asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="text-left px-3 py-2">Customer</th>
                    <th className="text-left px-3 py-2">Phone</th>
                    <th className="text-left px-3 py-2">GSTIN</th>
                    <th className="text-left px-3 py-2 cursor-pointer select-none" onClick={()=>{
                      setSortKey('description'); setSortDir(prev => (sortKey==='description' && prev==='asc') ? 'desc' : 'asc');
                    }}>
                      Description {sortKey==='description' ? (sortDir==='asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={()=>{ setSortKey('price'); setSortDir(prev => (sortKey==='price' && prev==='asc') ? 'desc' : 'asc'); }}>
                      Price {sortKey==='price' ? (sortDir==='asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Tax</th>
                    <th className="text-right px-3 py-2 cursor-pointer select-none" onClick={()=>{ setSortKey('amount'); setSortDir(prev => (sortKey==='amount' && prev==='asc') ? 'desc' : 'asc'); }}>
                      Amount {sortKey==='amount' ? (sortDir==='asc' ? '▲' : '▼') : ''}
                    </th>
                    <th className="text-center px-3 py-2">Invoice</th>
                    
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((e, i) => (
                    <tr key={i} className="border-t odd:bg-slate-50/40">
                      <td className="px-3 py-2">{new Date(e.date).toLocaleDateString()}</td>
                      <td className="px-3 py-2 capitalize">{e.type === 'inflow' ? 'Income' : 'Expense'}</td>
                      <td className="px-3 py-2">{e.customer_name || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.customer_phone || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{e.customer_gstin || '-'}</td>
                      <td className="px-3 py-2">{e.description || '-'}</td>
                      <td className="px-3 py-2 text-right">{e.price != null ? `₹${Number(e.price).toLocaleString('en-IN')}` : '-'}</td>
                      <td className="px-3 py-2 text-right">{e.qty != null ? e.qty : '-'}</td>
                      <td className="px-3 py-2 text-right">{e.tax_amount != null ? `₹${Number(e.tax_amount).toLocaleString('en-IN')}` : (e.tax_id ? e.tax_id : '-')}</td>
                      <td className={`px-3 py-2 text-right ${e.type==='inflow' ? 'text-emerald-700' : 'text-rose-700'}`}>₹{e.amount.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-center">
                        <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => handleOpenInvoice(e)} title="Open Tax Invoice">
                          <Printer className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Footer totals removed as requested */}
              </table>
              {/* Pagination */}
              <div className="flex items-center justify-between p-3 text-sm text-slate-700 border-t">
                <div className="flex items-center gap-2">
                  <span className="text-slate-600">Rows per page:</span>
                  <select
                    className="border rounded-md px-2 py-1 bg-white"
                    value={pageSize}
                    onChange={(e)=> setPageSize(Number(e.target.value) || 10)}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-600">{totalRows === 0 ? '0' : `${startIdx+1}`}–{endIdx} of {totalRows}</span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" disabled={currentPage<=1} onClick={()=> setPage(p=> Math.max(1, p-1))}>
                      <ChevronLeft className="h-4 w-4 mr-1" /> Prev
                    </Button>
                    <span className="px-2">Page {currentPage} / {totalPages}</span>
                    <Button variant="outline" size="sm" disabled={currentPage>=totalPages} onClick={()=> setPage(p=> Math.min(totalPages, p+1))}>
                      Next <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}