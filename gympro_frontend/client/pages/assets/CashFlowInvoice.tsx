import React, { useMemo, useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DataService } from '@/services/userService';
import { useAuth } from '@/contexts/AuthContext';

// Lightweight number to Indian words (Rupees) utility
const numberToWords = (n: number): string => {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const numToWords = (num: number): string => {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? ' ' + a[num % 10] : '');
    if (num < 1000) return a[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + numToWords(num % 100) : '');
    if (num < 100000) return numToWords(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + numToWords(num % 1000) : '');
    if (num < 10000000) return numToWords(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + numToWords(num % 100000) : '');
    return String(num);
  };
  return numToWords(Math.floor(n)) + ' Only';
};

interface CashFlowEntry {
  id?: string | number;
  date: string;
  type: string;
  description: string;
  amount: number;
  price?: number;
  qty?: number;
  tax_amount?: number;
  tax_cgst?: number;
  tax_sgst?: number;
  inclusive?: boolean;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  customer_gstin?: string;
}

// This component expects navigation with state.entry provided from CashFlow list.
// If state not present, it will advise user to go back.
const CashFlowInvoice: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const { user } = useAuth();
  const accountCode = (user as any)?.account_code || '';
  const retailCode = (user as any)?.retail_code || '';
  const navEntry: CashFlowEntry | undefined = (location.state as any)?.entry;
  const [entry, setEntry] = useState<CashFlowEntry | undefined>(navEntry);

  // Fallback fetch if opened directly by URL and state missing
  useEffect(() => {
    if (entry || !id) return;
    const today = new Date().toISOString().split('T')[0];
    (async () => {
      try {
        const res = await DataService.getIncomeExpenses(today, today, accountCode, retailCode);
        const all = (res as any)?.data?.data || [];
        const found = all.find((r: any) => String(r.id) === String(id));
        if (found) setEntry(found);
      } catch { /* ignore */ }
    })();
  }, [id, entry, accountCode, retailCode]);

  const computed = useMemo(() => {
    if (!entry) return null;
    const qty = entry.qty || 1;
    const gross = entry.amount || 0;
    const tax = entry.tax_amount || 0;
    const cg = entry.tax_cgst != null ? entry.tax_cgst : tax / 2;
    const sg = entry.tax_sgst != null ? entry.tax_sgst : tax / 2;
    const net = gross - tax;
    const unitPrice = entry.price != null ? entry.price : net / qty;
    const ratePct = tax && net ? ((tax / net) * 100).toFixed(0) : '';
    const halfRate = ratePct ? (Number(ratePct) / 2).toFixed(0) : '';
    const dateStr = new Date(entry.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');
    const invoiceNo = `INV-${entry.id ?? ''}`;
    const hsn = '997211';
    return { qty, gross, tax, cg, sg, net, unitPrice, ratePct, halfRate, dateStr, invoiceNo, hsn };
  }, [entry]);

  if (!entry || !computed) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h2 className="text-lg font-semibold mb-2">Invoice</h2>
        <p className="text-sm text-slate-600 mb-4">No entry data found for ID {id}. Please return to Cash Flow list and open an invoice again.</p>
        <Button onClick={() => navigate('/assets/cashflow')}>Back to Cash Flow</Button>
      </div>
    );
  }

  const { qty, gross, tax, cg, sg, net, unitPrice, halfRate, dateStr, invoiceNo, hsn } = computed;

  return (
    <div className="p-6 print:p-0 max-w-4xl mx-auto">
      <div className="flex items-center justify-end gap-3 mb-4 print:hidden">
        <Button variant="outline" onClick={() => navigate('/assets/cashflow')}>
          Back
        </Button>
        <Button onClick={() => window.print()}>Print</Button>
      </div>
      <div className="bg-white rounded-lg border shadow-sm p-5 print:shadow-none print:border-0 print:rounded-none">
        {/* Header + Buyer inline */}
        <div className="mb-4 flex flex-col md:flex-row gap-4 text-xs">
          <div className="flex-1">
            <div className="font-semibold text-base mb-1">NNNN_retail_1</div>
            <div className="text-slate-600">Invoice No.: {invoiceNo}</div>
            <div className="text-slate-600">Dated: {dateStr}</div>
          </div>
          <div className="border rounded p-2 md:min-w-[320px] flex-[1.2]">
            <div className="font-semibold mb-1">Buyer (Bill to)</div>
            <div className="font-medium">{entry.customer_name || '-'}</div>
            {entry.customer_address && <div className="whitespace-pre-line break-words">{entry.customer_address}</div>}
            <div>Phone : {entry.customer_phone || '-'}</div>
            <div>GSTIN : {entry.customer_gstin || '-'}</div>
          </div>
        </div>
        {/* Line Items */}
        <div className="overflow-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-50">
                <th className="border px-2 py-1">Sl No</th>
                <th className="border px-2 py-1 text-left">Description</th>
                {/* Removed HSN/SAC column */}
                <th className="border px-2 py-1">Qty</th>
                <th className="border px-2 py-1">Rate</th>
                <th className="border px-2 py-1">per</th>
                <th className="border px-2 py-1">Disc. Amt</th>
                <th className="border px-2 py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-2 py-1 text-center">1</td>
                <td className="border px-2 py-1 align-top">
                  {entry.description || '-'}
                  <div className="text-[10px] text-slate-500">CGST</div>
                  <div className="text-[10px] text-slate-500">SGST</div>
                </td>
                {/* HSN cell removed */}
                <td className="border px-2 py-1 text-center">{qty}</td>
                <td className="border px-2 py-1 text-right">₹{unitPrice.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1 text-center">No</td>
                <td className="border px-2 py-1 text-right">₹0.00</td>
                <td className="border px-2 py-1 text-right">
                  ₹{net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}<br />
                  ₹{cg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}<br />
                  ₹{sg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
              </tr>
              <tr>
                <td className="border px-2 py-1 text-right font-semibold" colSpan={6}>Total</td>
                <td className="border px-2 py-1 text-right">₹{gross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              {/* Removed quantity summary row */}
            </tbody>
          </table>
        </div>
        {/* Tax Summary (simplified) */}
        <div className="overflow-auto mt-6">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="bg-slate-50">
                <th className="border px-2 py-1">Taxable Value</th>
                <th className="border px-2 py-1">CGST %</th>
                <th className="border px-2 py-1">CGST Amt</th>
                <th className="border px-2 py-1">SGST %</th>
                <th className="border px-2 py-1">SGST Amt</th>
                <th className="border px-2 py-1">Total Tax Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border px-2 py-1 text-right">₹{net.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1 text-center">{halfRate || ''}%</td>
                <td className="border px-2 py-1 text-right">₹{cg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1 text-center">{halfRate || ''}%</td>
                <td className="border px-2 py-1 text-right">₹{sg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1 text-right">₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
              <tr>
                <td className="border px-2 py-1 text-right font-semibold">Total</td>
                <td className="border px-2 py-1" />
                <td className="border px-2 py-1 text-right">₹{cg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1" />
                <td className="border px-2 py-1 text-right">₹{sg.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                <td className="border px-2 py-1 text-right">₹{tax.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Amount in words */}
        <div className="mt-6 text-[11px]">
          <div className="font-semibold">Amount Chargeable (in words)</div>
          <div>Rupees {numberToWords(gross)}</div>
        </div>
        <div className="mt-8 text-[10px] text-slate-500">* Auto generated invoice preview.</div>
      </div>
      <style>{`@media print { body { background: #fff; } }`}</style>
    </div>
  );
};

export default CashFlowInvoice;
