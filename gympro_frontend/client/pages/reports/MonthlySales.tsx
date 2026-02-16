import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Download, TrendingUp, TrendingDown, IndianRupee, BarChart as BarChartIcon, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type MonthlySalesData = {
  month: string;
  year: number;
  total_sales: number;
  total_invoices: number;
  avg_invoice_value: number;
  growth_percent: number;
};

type BillingTransitionsResponse = {
  success: boolean;
  data?: any[];
  count?: number;
  error?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function parseInvoiceDate(row: any): Date | null {
  const candidate =
    row?.last_created_at ??
    row?.created_at ??
    row?.bill_date ??
    row?.invoice_date ??
    row?.date;

  if (!candidate) return null;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getInvoiceTotal(row: any): number {
  const val =
    row?.grand_total ??
    row?.total_amount ??
    row?.total ??
    row?.bill_amount ??
    row?.net_amount ??
    0;
  const num = Number(val);
  return Number.isFinite(num) ? num : 0;
}

export default function MonthlySales() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [salesData, setSalesData] = useState<MonthlySalesData[]>([]);
  const [yearFilter, setYearFilter] = useState<number>(new Date().getFullYear());

  const fetchMonthlySales = useCallback(async () => {
    if (!user?.account_code || !user?.retail_code) return;
    setLoading(true);
    setError(null);
    try {
      const fromDate = `${yearFilter}-01-01`;
      const toDate = `${yearFilter}-12-31`;
      const qs = new URLSearchParams();
      qs.set("account_code", String(user.account_code));
      qs.set("retail_code", String(user.retail_code));
      qs.set("from_date", fromDate);
      qs.set("to_date", toDate);
      qs.set("limit", "10000");
      qs.set("include_details", "false");

      const resp = await ApiService.get<BillingTransitionsResponse>(`/billing-transitions?${qs.toString()}`);
      if (!resp?.success) {
        throw new Error(resp?.error || "Failed to fetch billing transitions");
      }

      const rows = Array.isArray(resp?.data) ? resp.data : [];
      const buckets = MONTHS.map((m) => ({ month: m, year: yearFilter, total_sales: 0, total_invoices: 0 }));
      let anyInvoice = false;

      for (const row of rows) {
        // Skip cancelled invoices
        const billstatus = String(row?.billstatus ?? "").toUpperCase();
        if (billstatus === "C") continue;

        const d = parseInvoiceDate(row);
        if (!d || d.getFullYear() !== yearFilter) continue;

        const monthIndex = d.getMonth();
        if (monthIndex < 0 || monthIndex > 11) continue;

        const total = getInvoiceTotal(row);
        buckets[monthIndex].total_sales += total;
        buckets[monthIndex].total_invoices += 1;
        anyInvoice = true;
      }

      if (!anyInvoice) {
        setSalesData([]);
        return;
      }

      const computed: MonthlySalesData[] = buckets.map((b, idx) => {
        const avg = b.total_invoices > 0 ? b.total_sales / b.total_invoices : 0;
        const prev = idx > 0 ? buckets[idx - 1].total_sales : 0;
        const growth = prev > 0 ? ((b.total_sales - prev) / prev) * 100 : 0;
        return {
          month: b.month,
          year: b.year,
          total_sales: Number(b.total_sales.toFixed(2)),
          total_invoices: b.total_invoices,
          avg_invoice_value: Number(avg.toFixed(2)),
          growth_percent: Number(growth.toFixed(2)),
        };
      });

      setSalesData(computed);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch monthly sales data");
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, yearFilter]);

  useEffect(() => {
    fetchMonthlySales();
  }, [fetchMonthlySales]);

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(salesData.map(row => ({
      Month: row.month,
      Year: row.year,
      "Total Sales": row.total_sales,
      "Total Invoices": row.total_invoices,
      "Avg Invoice Value": row.avg_invoice_value,
      "Growth %": row.growth_percent,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Monthly Sales");
    XLSX.writeFile(wb, `Monthly_Sales_${yearFilter}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Monthly Sales Summary", 14, 15);
    doc.setFontSize(10);
    doc.text(`Year: ${yearFilter}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Month", "Total Sales", "Invoices", "Avg Value", "Growth %"]],
      body: salesData.map(row => [
        row.month,
        `₹${row.total_sales.toFixed(2)}`,
        row.total_invoices,
        `₹${row.avg_invoice_value.toFixed(2)}`,
        `${row.growth_percent.toFixed(1)}%`,
      ]),
    });
    doc.save(`Monthly_Sales_${yearFilter}.pdf`);
  };

  const chartData = salesData.map(row => ({
    month: row.month,
    sales: row.total_sales,
  }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <BarChartIcon className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Monthly Sales Summary</h1>
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

          {/* Inline Year Filter */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">Year</Label>
              <select
                className="h-8 text-xs border border-slate-200 rounded-md px-2 bg-white"
                value={yearFilter}
                onChange={(e) => setYearFilter(Number(e.target.value))}
              >
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Compact Key Metrics */}
        {salesData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Annual Sales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {salesData.reduce((sum, row) => sum + row.total_sales, 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">
                {salesData.reduce((sum, row) => sum + row.total_invoices, 0)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Avg Monthly Sales</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {(salesData.reduce((sum, row) => sum + row.total_sales, 0) / salesData.length).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Best Month</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {salesData.reduce((best, row) => row.total_sales > best.total_sales ? row : best, salesData[0]).month}
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Sales Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value: any) => `₹${value}`} />
                <Legend />
                <Bar dataKey="sales" fill="#3b82f6" name="Sales" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {salesData.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No data available</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead className="text-right">Invoices</TableHead>
                    <TableHead className="text-right">Avg Value</TableHead>
                    <TableHead className="text-right">Growth</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salesData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.month} {row.year}</TableCell>
                      <TableCell className="text-right">₹{row.total_sales.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{row.total_invoices}</TableCell>
                      <TableCell className="text-right">₹{row.avg_invoice_value.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <span className={`flex items-center justify-end ${row.growth_percent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {row.growth_percent >= 0 ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                          {row.growth_percent.toFixed(1)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
