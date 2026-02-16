import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, Scissors, ArrowLeft, IndianRupee } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type ServiceSalesData = {
  service_id: number;
  service_name: string;
  service_count: number;
  total_revenue: number;
  avg_price: number;
  discount_given: number;
};

type BillingTransitionsResponse = {
  success: boolean;
  data?: any[];
  count?: number;
  error?: string;
  message?: string;
};

const toArr = (v: any) => (Array.isArray(v) ? v : []);
const normBillStatus = (v: any) => String(v || '').toUpperCase();

function parseInvoiceDate(inv: any): Date | null {
  const invDate = inv?.txn_created_at || inv?.created_at || inv?.last_created_at || inv?.date;
  if (!invDate) return null;
  const d = new Date(invDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getLineAmount(row: any): number {
  const taxable = Number(row?.taxable_amount ?? row?.taxableAmount);
  const tax = Number(row?.tax_amount ?? row?.taxAmount ?? 0);
  const discount = Number(row?.discount_amount ?? row?.discountAmount ?? row?.discount ?? 0);
  const membershipDiscount = Number(row?.membership_discount ?? row?.membershipDiscount ?? 0);
  if (!Number.isNaN(taxable) && taxable !== 0) {
    return Math.max(0, taxable + (Number.isNaN(tax) ? 0 : tax) - (Number.isNaN(discount) ? 0 : discount) - (Number.isNaN(membershipDiscount) ? 0 : membershipDiscount));
  }
  const n = Number(row?.grand_total ?? row?.grandTotal ?? row?.total_amount ?? row?.amount ?? 0);
  if (!Number.isNaN(n) && n !== 0) return n;
  const qty = Number(row?.qty ?? row?.quantity ?? 1) || 1;
  const unit = Number(row?.unit_price ?? row?.unitPrice ?? row?.price ?? 0) || 0;
  return Math.max(0, unit * qty);
}

function getLineDiscount(row: any): number {
  const d = Number(row?.discount_amount ?? row?.discountAmount ?? row?.discount ?? 0);
  return Number.isFinite(d) ? d : 0;
}

function extractBillingTransitionsRows(resp: any): any[] {
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.data?.data)) return resp.data.data;
  if (Array.isArray(resp)) return resp;
  return [];
}

export default function ServiceSales() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceData, setServiceData] = useState<ServiceSalesData[]>([]);

  const fetchServiceSales = useCallback(async () => {
    if (!user?.account_code || !user?.retail_code) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const params = new URLSearchParams({
        account_code: String(user.account_code),
        retail_code: String(user.retail_code),
        from_date: from,
        to_date: to,
        limit: '10000',
        include_details: 'true',
      });
      const resp = await ApiService.get<BillingTransitionsResponse>(`/billing-transitions?${params.toString()}`);
      if (resp && resp.success === false) {
        throw new Error(resp?.error || resp?.message || 'Failed to fetch billing transitions');
      }

      const invoices = extractBillingTransitionsRows(resp);
      const agg = new Map<
        string,
        { service_id: number; service_name: string; service_count: number; total_revenue: number; discount_given: number }
      >();

      const fromD = new Date(from);
      const toD = new Date(to);
      toD.setHours(23, 59, 59, 999);

      for (const inv of invoices) {
        const billStatus = normBillStatus(inv?.billstatus ?? inv?.bill_status ?? inv?.BILLSTATUS);
        if (billStatus === 'C' || billStatus === 'N') continue;
        if (billStatus && billStatus !== 'Y') continue;

        const d = parseInvoiceDate(inv);
        if (!d || d < fromD || d > toD) continue;

        // Only services for this report
        for (const svc of toArr(inv?.services)) {
          const rawId = svc?.service_id ?? svc?.id ?? svc?.serviceId;
          const sid = typeof rawId === 'number' ? rawId : Number(String(rawId ?? '').trim());
          const sname = String(svc?.service_name ?? svc?.name ?? svc?.service ?? '').trim() || (Number.isFinite(sid) ? `Service ${sid}` : 'Service');

          const qty = Number(svc?.qty ?? svc?.quantity ?? 1) || 1;
          const amount = getLineAmount(svc);
          const discount = getLineDiscount(svc);
          const key = Number.isFinite(sid) ? `id:${sid}` : `name:${sname.toLowerCase()}`;

          const prev = agg.get(key) || { service_id: Number.isFinite(sid) ? sid : 0, service_name: sname, service_count: 0, total_revenue: 0, discount_given: 0 };
          prev.service_count += qty;
          prev.total_revenue += amount;
          prev.discount_given += discount;
          // Keep best name (prefer non-placeholder)
          if (prev.service_name.startsWith('Service ') && !sname.startsWith('Service ')) prev.service_name = sname;
          agg.set(key, prev);
        }
      }

      const out: ServiceSalesData[] = Array.from(agg.values()).map((v) => ({
        service_id: v.service_id,
        service_name: v.service_name,
        service_count: v.service_count,
        total_revenue: Number(v.total_revenue.toFixed(2)),
        avg_price: v.service_count > 0 ? Number((v.total_revenue / v.service_count).toFixed(2)) : 0,
        discount_given: Number(v.discount_given.toFixed(2)),
      }));
      out.sort((a, b) => b.total_revenue - a.total_revenue);
      setServiceData(out);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch service sales data');
      setServiceData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, fromDate, toDate]);

  useEffect(() => {
    fetchServiceSales();
  }, [fetchServiceSales]);

  const handleSubmit = () => {
    fetchServiceSales();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(serviceData.map(row => ({
      "Service Name": row.service_name,
      "Count": row.service_count,
      "Revenue": row.total_revenue,
      "Avg Price": row.avg_price,
      "Discount": row.discount_given,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Service Sales");
    XLSX.writeFile(wb, `Service_Sales_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Service-wise Sales Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Service", "Count", "Revenue", "Avg Price", "Discount"]],
      body: serviceData.map(row => [
        row.service_name,
        row.service_count,
        `₹${row.total_revenue.toFixed(2)}`,
        `₹${row.avg_price.toFixed(2)}`,
        `₹${row.discount_given.toFixed(2)}`,
      ]),
    });
    doc.save(`Service_Sales_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const chartData = serviceData.slice(0, 10).map(row => ({
    name: row.service_name.substring(0, 20),
    count: row.service_count,
    revenue: row.total_revenue,
  }));

  const totalRevenue = serviceData.reduce((sum, row) => sum + row.total_revenue, 0);
  const totalServices = serviceData.reduce((sum, row) => sum + row.service_count, 0);
  const totalDiscount = serviceData.reduce((sum, row) => sum + row.discount_given, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Scissors className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Service Sales Report</h1>
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
        {/* Summary Cards */}
        {serviceData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalRevenue.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Services</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalServices}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Discount</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalDiscount.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Avg Service Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalServices > 0 ? (totalRevenue / totalServices).toFixed(2) : '0.00'}
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Services by Revenue</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" fill="#3b82f6" name="Revenue (₹)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Service Details</CardTitle>
          </CardHeader>
          <CardContent>
            {serviceData.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No data available</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service Name</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Avg Price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serviceData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.service_name}</TableCell>
                      <TableCell className="text-right">{row.service_count}</TableCell>
                      <TableCell className="text-right">₹{row.total_revenue.toFixed(2)}</TableCell>
                      <TableCell className="text-right">₹{row.avg_price.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-orange-600">₹{row.discount_given.toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
