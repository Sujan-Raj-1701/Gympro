import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, AlertCircle, ArrowLeft, Search, IndianRupee, Phone, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService, type ApiResponse } from "@/services/apiService";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type CreditOutstandingData = {
  customer_id: number;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  total_credit: number;
  oldest_credit_date: string;
  credit_count: number;
};

export default function OutstandingCredit() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditData, setCreditData] = useState<CreditOutstandingData[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");

  useEffect(() => {
    fetchCreditData();
  }, []);

  const fetchCreditData = async () => {
    if (!user?.salon_id) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await ApiService.get<ApiResponse<CreditOutstandingData[]>>(`/reports/credit-outstanding?salon_id=${user.salon_id}`);
      setCreditData(resp.data || []);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch outstanding credit data");
    } finally {
      setLoading(false);
    }
  };

  const filteredData = creditData.filter(row =>
    row.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    row.customer_phone.includes(searchQuery)
  );

  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filteredData.map(row => ({
      "Customer Name": row.customer_name,
      "Phone": row.customer_phone,
      "Email": row.customer_email,
      "Total Credit": row.total_credit,
      "Credit Count": row.credit_count,
      "Oldest Credit": row.oldest_credit_date,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Outstanding Credit");
    XLSX.writeFile(wb, `Outstanding_Credit_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Outstanding Credit Report", 14, 15);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 22);
    autoTable(doc, {
      startY: 30,
      head: [["Customer", "Phone", "Total Credit", "Count", "Oldest"]],
      body: filteredData.map(row => [
        row.customer_name,
        row.customer_phone,
        `₹${row.total_credit.toFixed(2)}`,
        row.credit_count,
        row.oldest_credit_date,
      ]),
    });
    doc.save(`Outstanding_Credit_${new Date().toISOString().split('T')[0]}.pdf`);
  };

  const totalOutstanding = filteredData.reduce((sum, row) => sum + row.total_credit, 0);
  const totalCustomers = filteredData.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50">
      {/* Compact Header */}
      <div className="bg-white border-b border-slate-200 shadow-sm">
        <div className="mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50">
                <AlertCircle className="h-5 w-5 text-blue-600" />
              </div>
              <h1 className="text-xl font-bold text-slate-900">Outstanding Credit</h1>
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

          {/* Inline Search */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Label className="text-xs font-medium text-slate-600">Search</Label>
            </div>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-3.5 w-3.5" />
              <Input
                placeholder="Search by customer name or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>
            {loading && <span className="text-xs text-slate-500 ml-2">Loading…</span>}
            {error && <span className="text-xs text-rose-600 ml-2">{error}</span>}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto px-4 sm:px-6 py-4 space-y-4">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Total Outstanding</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 flex items-center">
              <IndianRupee className="h-5 w-5 mr-1" />
              {totalOutstanding.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Customers with Credit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Avg Credit per Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900 flex items-center">
              <IndianRupee className="h-5 w-5 mr-1" />
              {totalCustomers > 0 ? (totalOutstanding / totalCustomers).toFixed(2) : '0.00'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>Members Credit Details</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredData.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              {searchQuery ? "No matching records found" : "No outstanding credit"}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Contact</TableHead>
                    <TableHead className="text-right">Total Credit</TableHead>
                    <TableHead className="text-right">Credit Count</TableHead>
                    <TableHead>Oldest Credit</TableHead>
                    <TableHead className="text-center">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredData.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">{row.customer_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <span className="flex items-center gap-1 text-sm">
                            <Phone className="h-3 w-3" />
                            {row.customer_phone}
                          </span>
                          {row.customer_email && (
                            <span className="flex items-center gap-1 text-xs text-slate-500">
                              <Mail className="h-3 w-3" />
                              {row.customer_email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-bold text-red-600">
                        ₹{row.total_credit.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">{row.credit_count}</TableCell>
                      <TableCell className="text-sm text-slate-500">{row.oldest_credit_date}</TableCell>
                      <TableCell className="text-center">
                        <Button variant="outline" size="sm">
                          View Details
                        </Button>
                      </TableCell>
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

