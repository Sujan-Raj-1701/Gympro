import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, Wallet, ArrowLeft, IndianRupee } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type StaffCommissionData = {
  staff_id: number;
  staff_name: string;
  total_services: number;
  service_amount: number;
  commission_rate: number;
  commission_earned: number;
  commission_paid: number;
  commission_pending: number;
};

export default function StaffCommission() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commissionData, setCommissionData] = useState<StaffCommissionData[]>([]);

  const fetchCommissionData = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<StaffCommissionData[]>>(`/reports/staff-commission?salon_id=${user.salon_id}&from_date=${from}&to_date=${to}`);
      setCommissionData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch commission data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCommissionData();
  }, []);

  const handleSubmit = () => {
    fetchCommissionData();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(commissionData.map(row => ({
      "Staff Name": row.staff_name,
      "Services": row.total_services,
      "Service Amount": row.service_amount,
      "Commission Rate": `${row.commission_rate}%`,
      "Earned": row.commission_earned,
      "Paid": row.commission_paid,
      "Pending": row.commission_pending,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Staff Commission");
    XLSX.writeFile(wb, `Staff_Commission_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Staff Commission Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Staff", "Services", "Amount", "Earned", "Paid", "Pending"]],
      body: commissionData.map(row => [
        row.staff_name,
        row.total_services,
        `₹${row.service_amount.toFixed(2)}`,
        `₹${row.commission_earned.toFixed(2)}`,
        `₹${row.commission_paid.toFixed(2)}`,
        `₹${row.commission_pending.toFixed(2)}`,
      ]),
    });
    doc.save(`Staff_Commission_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalEarned = commissionData.reduce((sum, row) => sum + row.commission_earned, 0);
  const totalPaid = commissionData.reduce((sum, row) => sum + row.commission_paid, 0);
  const totalPending = commissionData.reduce((sum, row) => sum + row.commission_pending, 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <Wallet className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Staff Commission</h1>
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
        {commissionData.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Earned</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalEarned.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Paid</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalPaid.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Pending</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600 flex items-center">
                <IndianRupee className="h-5 w-5 mr-1" />
                {totalPending.toFixed(2)}
              </div>
            </CardContent>
          </Card>
        </div>
        )}

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Commission Details</CardTitle>
          </CardHeader>
          <CardContent>
            {commissionData.length === 0 ? (
              <div className="text-center py-8 text-slate-500">No data available</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff Name</TableHead>
                    <TableHead className="text-right">Services</TableHead>
                    <TableHead className="text-right">Service Amount</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Earned</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.staff_name}</TableCell>
                      <TableCell className="text-right">{row.total_services}</TableCell>
                      <TableCell className="text-right">₹{row.service_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{row.commission_rate}%</TableCell>
                      <TableCell className="text-right text-green-600 font-semibold">
                        ₹{row.commission_earned.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-blue-600">
                        ₹{row.commission_paid.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right text-orange-600 font-semibold">
                        ₹{row.commission_pending.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold bg-slate-50">
                    <TableCell colSpan={4}>Total</TableCell>
                    <TableCell className="text-right text-green-600">₹{totalEarned.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-blue-600">₹{totalPaid.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-orange-600">₹{totalPending.toFixed(2)}</TableCell>
                  </TableRow>
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

