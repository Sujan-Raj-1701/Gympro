import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, CreditCard, ArrowLeft, Wallet, Banknote, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

type PaymentModeData = {
  payment_mode: string;
  total_amount: number;
  transaction_count: number;
  percentage: number;
};

type BillingPaymentsResponse = {
  success: boolean;
  count?: number;
  data?: any[];
  message?: string;
};

const COLORS = {
  Cash: '#10b981',
  UPI: '#3b82f6',
  Card: '#f59e0b',
  Wallet: '#8b5cf6',
  Credit: '#ef4444',
};

export default function PaymentMode() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentModeData[]>([]);

  const normalizeMode = (raw: any, row?: any): string => {
    // Prefer explicit method/name if present
    const s = String(raw ?? "").trim();
    const l = s.toLowerCase();

    const mapIdToLabel = (id: number): string | null => {
      if (!Number.isFinite(id)) return null;
      // Collapse multiple card types into "Card" for reporting
      if (id === 1) return 'Cash';
      if (id === 6) return 'Wallet';
      if (id === 8) return 'UPI';
      if (id === 2 || id === 3 || id === 4 || id === 7) return 'Card';
      if (id === 10) return 'Card';
      if (id === 5) return 'Card';
      if (id === 9) return 'Card';
      return null;
    };

    // If the label itself is numeric (e.g. "1"), treat it as payment_mode_id
    const maybeNumericId = s && /^[0-9]+$/.test(s) ? Number(s) : NaN;
    const numericLabel = mapIdToLabel(maybeNumericId);
    if (numericLabel) return numericLabel;

    // If missing/empty label, try id-based mapping (billing_paymode often stores only payment_mode_id)
    const rawId = row?.payment_mode_id ?? row?.paymentmode_id ?? row?.mode_id;
    const id = typeof rawId === 'number' ? rawId : Number(String(rawId ?? '').trim());
    const mapped = mapIdToLabel(id);
    if ((!s || s === 'None') && mapped) return mapped;

    if (!s || s === 'None') return 'Cash';
    if (l.includes('upi') || l.includes('gpay') || l.includes('google') || l.includes('phonepe') || l.includes('paytm') || l.includes('bhim')) return 'UPI';
    if (l.includes('card') || l.includes('debit') || l.includes('credit card') || l.includes('visa') || l.includes('master')) return 'Card';
    if (l.includes('wallet') || l.includes('e-wallet')) return 'Wallet';
    if (l.includes('cash')) return 'Cash';
    if (l.includes('credit') || l.includes('due')) return 'Credit';
    // fallback - keep original label
    return s;
  };

  const getPaymentAmount = (row: any): number => {
    const val =
      row?.amount ??
      row?.paid_amount ??
      row?.total_amount ??
      row?.payment_amount ??
      row?.txn_amount ??
      row?.value ??
      0;
    const num = Number(val);
    return Number.isFinite(num) ? num : 0;
  };

  const fetchPaymentModeData = useCallback(async () => {
    if (!user?.account_code || !user?.retail_code) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.getBillingPayments({
        accountCode: String(user.account_code),
        retailCode: String(user.retail_code),
        fromDate: from,
        toDate: to,
      }) as BillingPaymentsResponse;

      if (!resp?.success) {
        throw new Error(resp?.message || "Failed to fetch billing payments");
      }

      const rows = Array.isArray(resp?.data) ? resp.data : [];
      const agg = new Map<string, { total: number; count: number }>();

      for (const row of rows) {
        const modeRaw = row?.payment_method ?? row?.pay_mode ?? row?.payment_mode ?? row?.mode ?? row?.payment_mode_id;
        const mode = normalizeMode(modeRaw, row);
        const amt = getPaymentAmount(row);
        const prev = agg.get(mode) || { total: 0, count: 0 };
        prev.total += amt;
        prev.count += 1;
        agg.set(mode, prev);
      }

      const total = Array.from(agg.values()).reduce((sum, v) => sum + v.total, 0);
      const out: PaymentModeData[] = Array.from(agg.entries()).map(([mode, v]) => ({
        payment_mode: mode,
        total_amount: Number(v.total.toFixed(2)),
        transaction_count: v.count,
        percentage: total > 0 ? Number(((v.total / total) * 100).toFixed(2)) : 0,
      }));

      out.sort((a, b) => b.total_amount - a.total_amount);
      setPaymentData(out);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch payment mode data");
      setPaymentData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, fromDate, toDate]);

  useEffect(() => {
    fetchPaymentModeData();
  }, [fetchPaymentModeData]);

  const handleSubmit = () => {
    fetchPaymentModeData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(paymentData.map(row => ({
      "Payment Mode": row.payment_mode,
      "Total Amount": row.total_amount,
      "Transactions": row.transaction_count,
      "Percentage": `${row.percentage.toFixed(2)}%`,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payment Mode Collection");
    XLSX.writeFile(wb, `Payment_Mode_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Payment Mode Collection Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Payment Mode", "Total Amount", "Transactions", "Percentage"]],
      body: paymentData.map(row => [
        row.payment_mode,
        `₹${row.total_amount.toFixed(2)}`,
        row.transaction_count,
        `${row.percentage.toFixed(2)}%`,
      ]),
    });
    doc.save(`Payment_Mode_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const chartData = paymentData.map(row => ({
    name: row.payment_mode,
    value: row.total_amount,
  }));

  const totalAmount = paymentData.reduce((sum, row) => sum + row.total_amount, 0);

  const getIcon = (mode: string) => {
    if (mode.toLowerCase().includes('cash')) return <Banknote className="h-5 w-5" />;
    if (mode.toLowerCase().includes('upi')) return <Smartphone className="h-5 w-5" />;
    if (mode.toLowerCase().includes('card')) return <CreditCard className="h-5 w-5" />;
    if (mode.toLowerCase().includes('wallet')) return <Wallet className="h-5 w-5" />;
    return <CreditCard className="h-5 w-5" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <CreditCard className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Payment Mode Collection</h1>
            </div>

            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportExcel} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export PDF
              </Button>
              <Link to="/reports">
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back to Reports
                </Button>
              </Link>
            </div>
          </div>

          {/* Inline Date Filters */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(fromDate, "dd-MM-yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={fromDate} onSelect={(d) => d && setFromDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <span className="text-slate-400">→</span>

            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(toDate, "dd-MM-yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={toDate} onSelect={(d) => d && setToDate(d)} initialFocus />
                </PopoverContent>
              </Popover>
            </div>

            <Button size="sm" onClick={handleSubmit} disabled={loading} className="h-8 px-4 text-xs">
              Submit
            </Button>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Compact Key Metrics */}
        {paymentData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {paymentData.map((row, idx) => (
              <Card key={idx}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                    {getIcon(row.payment_mode)}
                    {row.payment_mode}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">₹{row.total_amount.toFixed(2)}</div>
                  <p className="text-sm text-slate-500 mt-1">{row.transaction_count} transactions</p>
                  <p className="text-sm text-slate-600 mt-1 font-medium">{row.percentage.toFixed(1)}% of total</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Chart and Table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Payment Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${((entry.value / totalAmount) * 100).toFixed(1)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS] || '#6b7280'} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `₹${value.toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentData.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No data available</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.payment_mode}</TableCell>
                      <TableCell className="text-right">₹{row.total_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{row.transaction_count}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">₹{totalAmount.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{paymentData.reduce((sum, row) => sum + row.transaction_count, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </div>
      </div>
    </div>
  );
}
