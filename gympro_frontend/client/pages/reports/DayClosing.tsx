import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { Download, Calendar as CalendarIcon, CheckCircle, ArrowLeft, IndianRupee, Banknote, CreditCard } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type DayClosingData = {
  date: string;
  opening_balance: number;
  total_sales: number;
  cash_collected: number;
  card_collected: number;
  upi_collected: number;
  wallet_collected: number;
  expenses: number;
  closing_balance: number;
  variance: number;
  closed_by: string;
  closing_time: string;
};

export default function DayClosing() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closingData, setClosingData] = useState<DayClosingData | null>(null);

  const fetchDayClosing = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const date = format(selectedDate, "yyyy-MM-dd");
      const resp = await ApiService.get<ApiResponse<DayClosingData>>(`/reports/day-closing?salon_id=${user.salon_id}&date=${date}`);
      setClosingData(resp.data || null);
    } catch (err: any) {
      const message = err?.message || "";
      if (typeof message === "string" && message.includes("status: 404")) {
        setClosingData(null);
        setError(null);
      } else {
        setError(message || "Failed to fetch day closing data");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDayClosing();
  }, []);

  const handleSubmit = () => {
    fetchDayClosing();
  };

  const handleExportPDF = () => {
    if (!closingData) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Day Closing Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Date: ${closingData.date}`, 14, 22);
    doc.text(`Closed By: ${closingData.closed_by}`, 14, 28);
    doc.text(`Closing Time: ${closingData.closing_time}`, 14, 34);
    
    autoTable(doc, {
      startY: 40,
      head: [["Description", "Amount"]],
      body: [
        ["Opening Balance", `₹${closingData.opening_balance.toFixed(2)}`],
        ["Total Sales", `₹${closingData.total_sales.toFixed(2)}`],
        ["Cash Collected", `₹${closingData.cash_collected.toFixed(2)}`],
        ["Card Collected", `₹${closingData.card_collected.toFixed(2)}`],
        ["UPI Collected", `₹${closingData.upi_collected.toFixed(2)}`],
        ["Wallet Collected", `₹${closingData.wallet_collected.toFixed(2)}`],
        ["Expenses", `₹${closingData.expenses.toFixed(2)}`],
        ["Closing Balance", `₹${closingData.closing_balance.toFixed(2)}`],
        ["Variance", `₹${closingData.variance.toFixed(2)}`],
      ],
    });
    doc.save(`Day_Closing_${closingData.date}.pdf`);
  };

  const handleExportExcel = () => {
    if (!closingData) return;
    const ws = XLSX.utils.json_to_sheet([
      { Description: "Opening Balance", Amount: closingData.opening_balance },
      { Description: "Total Sales", Amount: closingData.total_sales },
      { Description: "Cash Collected", Amount: closingData.cash_collected },
      { Description: "Card Collected", Amount: closingData.card_collected },
      { Description: "UPI Collected", Amount: closingData.upi_collected },
      { Description: "Wallet Collected", Amount: closingData.wallet_collected },
      { Description: "Expenses", Amount: closingData.expenses },
      { Description: "Closing Balance", Amount: closingData.closing_balance },
      { Description: "Variance", Amount: closingData.variance },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Day Closing");
    XLSX.writeFile(wb, `Day_Closing_${closingData.date}.xlsx`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-slate-50">
                <CheckCircle className="h-5 w-5 text-slate-700" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Day Closing Report</h1>
            </div>

            {/* Compact Action Bar */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleExportExcel} disabled={!closingData} className="h-8 text-xs">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export Excel
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportPDF} disabled={!closingData} className="h-8 text-xs">
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

          {/* Inline Date Filter */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs font-normal">
                    <CalendarIcon className="mr-1.5 h-3.5 w-3.5" />
                    {format(selectedDate, "dd-MM-yyyy")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} initialFocus />
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

      {!closingData ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-slate-500">
              No closing data available for {format(selectedDate, "PPP")}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Header Info */}
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-green-800">Day Closed Successfully</h3>
                  <p className="text-sm text-green-700 mt-1">
                    Closed by: {closingData.closed_by} at {closingData.closing_time}
                  </p>
                </div>
                <CheckCircle className="h-12 w-12 text-green-600" />
              </div>
            </CardContent>
          </Card>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900 flex items-center">
                  <IndianRupee className="h-5 w-5 mr-1" />
                  {closingData.total_sales.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Cash Collected</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600 flex items-center">
                  <Banknote className="h-5 w-5 mr-1" />
                  {closingData.cash_collected.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Digital Payments</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-blue-600 flex items-center">
                  <CreditCard className="h-5 w-5 mr-1" />
                  {(closingData.card_collected + closingData.upi_collected + closingData.wallet_collected).toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">Closing Balance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900 flex items-center">
                  <IndianRupee className="h-5 w-5 mr-1" />
                  {closingData.closing_balance.toFixed(2)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Details Table */}
          <Card>
            <CardHeader>
              <CardTitle>Settlement Details</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Opening Balance</TableCell>
                    <TableCell className="text-right">₹{closingData.opening_balance.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-slate-50 font-semibold">
                    <TableCell>Total Sales</TableCell>
                    <TableCell className="text-right">₹{closingData.total_sales.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8 text-sm text-slate-600">Cash</TableCell>
                    <TableCell className="text-right text-green-600">₹{closingData.cash_collected.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8 text-sm text-slate-600">Card</TableCell>
                    <TableCell className="text-right text-blue-600">₹{closingData.card_collected.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8 text-sm text-slate-600">UPI</TableCell>
                    <TableCell className="text-right text-blue-600">₹{closingData.upi_collected.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="pl-8 text-sm text-slate-600">Wallet</TableCell>
                    <TableCell className="text-right text-purple-600">₹{closingData.wallet_collected.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium text-red-600">Expenses</TableCell>
                    <TableCell className="text-right text-red-600">₹{closingData.expenses.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow className="bg-slate-100 font-bold text-lg">
                    <TableCell>Closing Balance</TableCell>
                    <TableCell className="text-right">₹{closingData.closing_balance.toFixed(2)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Variance</TableCell>
                    <TableCell className={`text-right font-bold ${closingData.variance === 0 ? 'text-green-600' : 'text-orange-600'}`}>
                      ₹{closingData.variance.toFixed(2)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Variance Alert */}
          {closingData.variance !== 0 && (
            <Card className="border-orange-200 bg-orange-50">
              <CardContent className="pt-6">
                <p className="text-sm text-orange-800">
                  <strong>Note:</strong> There is a variance of ₹{Math.abs(closingData.variance).toFixed(2)} in the day closing. 
                  {closingData.variance > 0 
                    ? " Actual closing balance is higher than expected." 
                    : " Actual closing balance is lower than expected."}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}
      </div>
    </div>
  );
}
