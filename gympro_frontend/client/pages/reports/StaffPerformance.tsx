import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, Users, ArrowLeft, TrendingUp, Award } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { DataService } from "@/services/userService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type StaffPerformanceData = {
  staff_id: number;
  staff_name: string;
  total_services: number;
  total_revenue: number;
  avg_service_value: number;
  customer_count: number;
  rating: number;
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

function getLineAmount(row: any): number {
  const taxable = Number(row?.taxable_amount ?? row?.taxableAmount);
  const tax = Number(row?.tax_amount ?? row?.taxAmount ?? 0);
  const discount = Number(row?.discount_amount ?? row?.discountAmount ?? 0);
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

function parseInvoiceDate(inv: any): Date | null {
  const invDate = inv?.txn_created_at || inv?.created_at || inv?.last_created_at || inv?.date;
  if (!invDate) return null;
  const d = new Date(invDate);
  return Number.isNaN(d.getTime()) ? null : d;
}

function extractBillingTransitionsRows(resp: any): any[] {
  if (Array.isArray(resp?.data)) return resp.data;
  if (Array.isArray(resp?.data?.data)) return resp.data.data;
  if (Array.isArray(resp)) return resp;
  return [];
}

export default function StaffPerformance() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staffData, setStaffData] = useState<StaffPerformanceData[]>([]);
  const [employeeNameById, setEmployeeNameById] = useState<Record<string, string>>({});

  // Load staff master (actual employee names)
  useEffect(() => {
    const loadStaff = async () => {
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        if (!acc || !ret) return;

        const res: any = await DataService.readData(["master_employee"], String(acc), String(ret));
        const payload: any = res?.data ?? res ?? {};
        let emps: any[] = [];

        if (Array.isArray(payload)) {
          emps = payload;
        } else if (payload.success && Array.isArray(payload.data)) {
          emps = payload.data;
        } else {
          emps = payload.master_employee || payload.employees || payload.employee || [];
        }

        const map: Record<string, string> = {};
        for (const e of emps || []) {
          const id =
            e.employee_id ?? e.EMPLOYEE_ID ??
            e.emp_id ?? e.EMP_ID ??
            e.staff_id ?? e.STAFF_ID ??
            e.id ?? e.ID ??
            e.code ?? e.CODE ??
            e.employee_code ?? e.EMPLOYEE_CODE;
          const name =
            e.employee_name ?? e.EMPLOYEE_NAME ??
            e.emp_name ?? e.EMP_NAME ??
            e.name ?? e.NAME ??
            e.full_name ?? e.FULL_NAME ??
            e.username ?? e.USERNAME;
          if (id != null && String(id).trim() && name) {
            map[String(id).trim()] = String(name).trim();
          }
        }
        setEmployeeNameById(map);
      } catch {
        // Non-blocking: staff names will fall back to IDs
        setEmployeeNameById({});
      }
    };
    loadStaff();
  }, [user]);

  const fetchStaffPerformance = useCallback(async () => {
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
      });

      const resp = await ApiService.get<BillingTransitionsResponse>(`/billing-transitions?${params.toString()}`);
      if (resp && resp.success === false) {
        throw new Error(resp?.error || resp?.message || 'Failed to fetch billing transitions');
      }

      const invoices = extractBillingTransitionsRows(resp);

      const agg = new Map<
        string,
        {
          staff_id: number;
          staff_name: string;
          total_services: number;
          total_revenue: number;
          customerSet: Set<string>;
        }
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

        const customerId = String(inv?.customer_id ?? inv?.txn_customer_id ?? inv?.billing_customer_id ?? inv?.cust_id ?? '').trim();

        const consumeLines = (row: any) => {
          const eidRaw = row?.employee_id ?? row?.staff_id ?? row?.stylist_id ?? row?.employeeId;
          const eidStr = String(eidRaw ?? '').trim();
          if (!eidStr) return;
          const eid = Number(eidStr);
          const staffNameFromLine = String(row?.employee_name ?? row?.staff_name ?? row?.stylist_name ?? row?.staff ?? '').trim();
          const staffName = staffNameFromLine || employeeNameById[eidStr] || `Staff ${eidStr}`;
          const amount = getLineAmount(row);

          const prev = agg.get(eidStr) || {
            staff_id: Number.isFinite(eid) ? eid : 0,
            staff_name: staffName,
            total_services: 0,
            total_revenue: 0,
            customerSet: new Set<string>(),
          };

          // Keep the best name we have
          if (prev.staff_name.startsWith('Staff ') && !staffName.startsWith('Staff ')) {
            prev.staff_name = staffName;
          }

          prev.total_services += 1;
          prev.total_revenue += amount;
          if (customerId) prev.customerSet.add(customerId);
          agg.set(eidStr, prev);
        };

        // Prefer detailed service/package lines. Inventory is excluded from "services".
        toArr(inv?.services).forEach(consumeLines);
        toArr(inv?.packages).forEach(consumeLines);
      }

      const out: StaffPerformanceData[] = Array.from(agg.values()).map((v) => ({
        staff_id: v.staff_id,
        staff_name: employeeNameById[String(v.staff_id)] || v.staff_name,
        total_services: v.total_services,
        total_revenue: Number(v.total_revenue.toFixed(2)),
        avg_service_value: v.total_services > 0 ? Number((v.total_revenue / v.total_services).toFixed(2)) : 0,
        customer_count: v.customerSet.size,
        rating: 5.0,
      }));

      out.sort((a, b) => b.total_revenue - a.total_revenue);
      setStaffData(out);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch staff performance data');
      setStaffData([]);
    } finally {
      setLoading(false);
    }
  }, [user?.account_code, user?.retail_code, fromDate, toDate, employeeNameById]);

  useEffect(() => {
    fetchStaffPerformance();
  }, [fetchStaffPerformance]);

  const handleSubmit = () => {
    fetchStaffPerformance();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(staffData.map(row => ({
      "Staff Name": row.staff_name,
      "Services": row.total_services,
      "Revenue": row.total_revenue,
      "Avg Value": row.avg_service_value,
      "Customers": row.customer_count,
      "Rating": row.rating,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Staff Performance");
    XLSX.writeFile(wb, `Staff_Performance_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Staff Performance Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Staff", "Services", "Revenue", "Avg Value", "Customers"]],
      body: staffData.map(row => [
        row.staff_name,
        row.total_services,
        `₹${row.total_revenue.toFixed(2)}`,
        `₹${row.avg_service_value.toFixed(2)}`,
        row.customer_count,
      ]),
    });
    doc.save(`Staff_Performance_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const chartData = staffData.map(row => ({
    name: row.staff_name,
    revenue: row.total_revenue,
    services: row.total_services,
  }));

  const totalRevenue = staffData.reduce((sum, row) => sum + row.total_revenue, 0);
  const totalServices = staffData.reduce((sum, row) => sum + row.total_services, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Staff Performance</h1>
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
        {staffData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">₹{totalRevenue.toFixed(2)}</div>
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
              <CardTitle className="text-sm font-medium text-slate-600">Active Staff</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{staffData.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Top Performer</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-lg font-bold text-slate-900">
                {staffData.reduce((top, row) => row.total_revenue > top.total_revenue ? row : top, staffData[0]).staff_name}
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Staff Revenue Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" fill="#3b82f6" name="Revenue (₹)" />
                <Bar dataKey="services" fill="#10b981" name="Services" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Staff Details</CardTitle>
          </CardHeader>
          <CardContent>
            {staffData.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No data available</div>
            ) : (
              <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Staff Name</TableHead>
                  <TableHead className="text-right">Services</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Avg Value</TableHead>
                  <TableHead className="text-right">Customers</TableHead>
                  <TableHead className="text-center">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {staffData.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{row.staff_name}</TableCell>
                    <TableCell className="text-right">{row.total_services}</TableCell>
                    <TableCell className="text-right">₹{row.total_revenue.toFixed(2)}</TableCell>
                    <TableCell className="text-right">₹{row.avg_service_value.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{row.customer_count}</TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1">
                        <Award className="h-4 w-4 text-yellow-500" />
                        {row.rating.toFixed(1)}
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

