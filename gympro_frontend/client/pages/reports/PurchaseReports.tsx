import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { format } from "date-fns";
import {
  Download,
  Calendar as CalendarIcon,
  ShoppingCart,
  Printer,
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Building,
} from "lucide-react";
import { Link } from "react-router-dom";

const purchaseData = [
  { month: "Jan", amount: 25000, orders: 45, avgOrder: 556 },
  { month: "Feb", amount: 28000, orders: 52, avgOrder: 538 },
  { month: "Mar", amount: 26000, orders: 48, avgOrder: 542 },
  { month: "Apr", amount: 32000, orders: 58, avgOrder: 552 },
  { month: "May", amount: 30000, orders: 55, avgOrder: 545 },
  { month: "Jun", amount: 35000, orders: 62, avgOrder: 565 },
];

const supplierData = [
  {
    supplier: "Tech Supplies Co.",
    totalPurchases: 85000,
    orders: 24,
    lastOrder: "2024-03-20",
    paymentTerms: "30 days",
    status: "Active",
  },
  {
    supplier: "Office World Ltd.",
    totalPurchases: 62000,
    orders: 18,
    lastOrder: "2024-03-18",
    paymentTerms: "15 days",
    status: "Active",
  },
  {
    supplier: "Digital Solutions",
    totalPurchases: 45000,
    orders: 12,
    lastOrder: "2024-03-15",
    paymentTerms: "45 days",
    status: "Active",
  },
  {
    supplier: "Hardware Plus",
    totalPurchases: 38000,
    orders: 15,
    lastOrder: "2024-03-10",
    paymentTerms: "30 days",
    status: "Pending",
  },
];

const recentPurchases = [
  {
    poNumber: "PO-2024-001",
    date: "2024-03-20",
    supplier: "Tech Supplies Co.",
    amount: 15000,
    status: "Delivered",
    items: 8,
  },
  {
    poNumber: "PO-2024-002",
    date: "2024-03-19",
    supplier: "Office World Ltd.",
    amount: 12500,
    status: "Pending",
    items: 5,
  },
  {
    poNumber: "PO-2024-003",
    date: "2024-03-18",
    supplier: "Digital Solutions",
    amount: 8750,
    status: "Delivered",
    items: 3,
  },
  {
    poNumber: "PO-2024-004",
    date: "2024-03-17",
    supplier: "Hardware Plus",
    amount: 22000,
    status: "In Transit",
    items: 12,
  },
];

export default function PurchaseReports() {
  const [date, setDate] = useState<Date>();
  const [reportPeriod, setReportPeriod] = useState("monthly");

  const handleExportReport = (format: string) => {
    console.log(`Exporting purchase report as ${format}`);
    alert(`Purchase report exported as ${format.toUpperCase()}`);
  };

  const handlePrintReport = () => {
    console.log(`Printing purchase report`);
    alert(`Purchase report sent to printer`);
  };

  // Calculate totals
  const totals = {
    totalPurchases: supplierData.reduce((sum, supplier) => sum + supplier.totalPurchases, 0),
    totalOrders: supplierData.reduce((sum, supplier) => sum + supplier.orders, 0),
    avgOrderValue: supplierData.reduce((sum, supplier) => sum + supplier.totalPurchases, 0) / 
                   supplierData.reduce((sum, supplier) => sum + supplier.orders, 0),
    activeSuppliers: supplierData.filter(s => s.status === "Active").length,
  };

  return (
  <div className="min-h-screen space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Purchase Reports</h1>
          <p className="text-muted-foreground">
            Monitor purchase activities and vendor performance
          </p>
        </div>
        <Link to="/reports">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Reports
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="period">Period</Label>
              <Select value={reportPeriod} onValueChange={setReportPeriod}>
                <SelectTrigger>
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <Label>Date Range</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex gap-2">
              <Select
                defaultValue="pdf"
                onValueChange={(value) => handleExportReport(value)}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Export" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">Export PDF</SelectItem>
                  <SelectItem value="excel">Export Excel</SelectItem>
                  <SelectItem value="csv">Export CSV</SelectItem>
                </SelectContent>
              </Select>

              <Button variant="outline" onClick={handlePrintReport}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Key Metrics */}
  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Purchases</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{totals.totalPurchases.toLocaleString()}</div>
            <div className="flex items-center text-xs text-green-600">
              <TrendingUp className="h-3 w-3 mr-1" />
              +8.5% from last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.totalOrders}</div>
            <div className="flex items-center text-xs text-green-600">
              <TrendingUp className="h-3 w-3 mr-1" />
              +12.3% from last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{Math.round(totals.avgOrderValue).toLocaleString()}</div>
            <div className="flex items-center text-xs text-red-600">
              <TrendingDown className="h-3 w-3 mr-1" />
              -2.1% from last month
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Suppliers</CardTitle>
            <Building className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.activeSuppliers}</div>
            <p className="text-xs text-muted-foreground">
              Total suppliers
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Purchase Trend (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={purchaseData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip
                  formatter={(value, name) => [
                    name === "amount" ? `₹${value.toLocaleString()}` : value,
                    name === "amount" ? "Amount" : "Orders"
                  ]}
                />
                <Line
                  type="monotone"
                  dataKey="amount"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  name="amount"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Purchase Orders by Month</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={purchaseData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="orders" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Supplier Performance */}
      <Card>
        <CardHeader>
          <CardTitle>Supplier Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Total Purchases</TableHead>
                  <TableHead>Orders</TableHead>
                  <TableHead>Last Order</TableHead>
                  <TableHead>Payment Terms</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierData.map((supplier, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{supplier.supplier}</TableCell>
                    <TableCell>₹{supplier.totalPurchases.toLocaleString()}</TableCell>
                    <TableCell>{supplier.orders}</TableCell>
                    <TableCell>{supplier.lastOrder}</TableCell>
                    <TableCell>{supplier.paymentTerms}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        supplier.status === "Active" 
                          ? "bg-green-100 text-green-800" 
                          : "bg-yellow-100 text-yellow-800"
                      }`}>
                        {supplier.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Purchase Orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Purchase Orders</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPurchases.map((order, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{order.poNumber}</TableCell>
                    <TableCell>{order.date}</TableCell>
                    <TableCell>{order.supplier}</TableCell>
                    <TableCell>₹{order.amount.toLocaleString()}</TableCell>
                    <TableCell>{order.items}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        order.status === "Delivered" 
                          ? "bg-green-100 text-green-800"
                          : order.status === "Pending"
                          ? "bg-yellow-100 text-yellow-800"
                          : "bg-blue-100 text-blue-800"
                      }`}>
                        {order.status}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
