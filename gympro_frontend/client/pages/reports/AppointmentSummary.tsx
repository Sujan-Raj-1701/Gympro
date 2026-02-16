import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, CalendarDays, ArrowLeft, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Badge } from "@/components/ui/badge";

type AppointmentSummaryData = {
  appointment_date: string;
  total_appointments: number;
  confirmed: number;
  completed: number;
  cancelled: number;
  no_show: number;
  revenue_from_appointments: number;
};

export default function AppointmentSummary() {
  const { user } = useAuth();
  const [fromDate, setFromDate] = useState<Date>(new Date());
  const [toDate, setToDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appointmentData, setAppointmentData] = useState<AppointmentSummaryData[]>([]);

  const fetchAppointmentSummary = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const from = format(fromDate, "yyyy-MM-dd");
      const to = format(toDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<AppointmentSummaryData[]>>(`/reports/appointment-summary?salon_id=${user.salon_id}&from_date=${from}&to_date=${to}`);
      setAppointmentData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch appointment summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAppointmentSummary();
  }, []);

  const handleSubmit = () => {
    fetchAppointmentSummary();
  };

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(appointmentData.map(row => ({
      "Date": row.appointment_date,
      "Total": row.total_appointments,
      "Confirmed": row.confirmed,
      "Completed": row.completed,
      "Cancelled": row.cancelled,
      "No Show": row.no_show,
      "Revenue": row.revenue_from_appointments,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Appointments");
    XLSX.writeFile(wb, `Appointment_Summary_${format(fromDate, "yyyy-MM-dd")}_to_${format(toDate, "yyyy-MM-dd")}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Appointment Summary Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Period: ${format(fromDate, "dd/MM/yyyy")} to ${format(toDate, "dd/MM/yyyy")}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Date", "Total", "Confirmed", "Completed", "Cancelled", "No Show", "Revenue"]],
      body: appointmentData.map(row => [
        row.appointment_date,
        row.total_appointments,
        row.confirmed,
        row.completed,
        row.cancelled,
        row.no_show,
        `₹${row.revenue_from_appointments.toFixed(2)}`,
      ]),
    });
    doc.save(`Appointment_Summary_${format(fromDate, "yyyy-MM-dd")}.pdf`);
  };

  const totalAppointments = appointmentData.reduce((sum, row) => sum + row.total_appointments, 0);
  const totalConfirmed = appointmentData.reduce((sum, row) => sum + row.confirmed, 0);
  const totalCompleted = appointmentData.reduce((sum, row) => sum + row.completed, 0);
  const totalCancelled = appointmentData.reduce((sum, row) => sum + row.cancelled, 0);
  const totalNoShow = appointmentData.reduce((sum, row) => sum + row.no_show, 0);
  const totalRevenue = appointmentData.reduce((sum, row) => sum + row.revenue_from_appointments, 0);

  const completionRate = totalAppointments > 0 ? ((totalCompleted / totalAppointments) * 100).toFixed(1) : '0';
  const cancellationRate = totalAppointments > 0 ? ((totalCancelled / totalAppointments) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-sky-50">
                <CalendarDays className="h-5 w-5 text-sky-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Appointment Summary</h1>
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
        {appointmentData.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Total Appointments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">{totalAppointments}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Completed
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{totalCompleted}</div>
              <p className="text-sm text-slate-500">{completionRate}% completion rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600 flex items-center gap-2">
                <XCircle className="h-4 w-4 text-red-600" />
                Cancelled
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{totalCancelled}</div>
              <p className="text-sm text-slate-500">{cancellationRate}% cancellation rate</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-slate-900">₹{totalRevenue.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status Overview */}
      {appointmentData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Status Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <Clock className="h-8 w-8 mx-auto mb-2 text-blue-600" />
                <p className="text-2xl font-bold text-blue-600">{totalConfirmed}</p>
                <p className="text-sm text-slate-600">Confirmed</p>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-lg">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-600" />
                <p className="text-2xl font-bold text-green-600">{totalCompleted}</p>
                <p className="text-sm text-slate-600">Completed</p>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <XCircle className="h-8 w-8 mx-auto mb-2 text-red-600" />
                <p className="text-2xl font-bold text-red-600">{totalCancelled}</p>
                <p className="text-sm text-slate-600">Cancelled</p>
              </div>
              <div className="text-center p-4 bg-orange-50 rounded-lg">
                <CalendarDays className="h-8 w-8 mx-auto mb-2 text-orange-600" />
                <p className="text-2xl font-bold text-orange-600">{totalNoShow}</p>
                <p className="text-sm text-slate-600">No Show</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {appointmentData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No data available</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Confirmed</TableHead>
                    <TableHead className="text-right">Completed</TableHead>
                    <TableHead className="text-right">Cancelled</TableHead>
                    <TableHead className="text-right">No Show</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointmentData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.appointment_date}</TableCell>
                      <TableCell className="text-right">{row.total_appointments}</TableCell>
                      <TableCell className="text-right text-blue-600">{row.confirmed}</TableCell>
                      <TableCell className="text-right text-green-600">{row.completed}</TableCell>
                      <TableCell className="text-right text-red-600">{row.cancelled}</TableCell>
                      <TableCell className="text-right text-orange-600">{row.no_show}</TableCell>
                      <TableCell className="text-right">₹{row.revenue_from_appointments.toFixed(2)}</TableCell>
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
