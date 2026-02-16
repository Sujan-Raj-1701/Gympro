import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import { format } from "date-fns";
import {
  BarChart3,
  Download,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Users,
  Package,
  ShoppingCart,
  FileText,
  Printer,
  Eye,
} from "lucide-react";

const salesData = [
  { month: "Jan", sales: 45000, purchases: 25000, profit: 20000 },
  { month: "Feb", sales: 52000, purchases: 28000, profit: 24000 },
  { month: "Mar", sales: 48000, purchases: 26000, profit: 22000 },
  { month: "Apr", sales: 61000, purchases: 32000, profit: 29000 },
  { month: "May", sales: 55000, purchases: 30000, profit: 25000 },
  { month: "Jun", sales: 67000, purchases: 35000, profit: 32000 },
];

const topProducts = [
  { name: "Laptop Pro 15", sales: 125, revenue: 1125000, percentage: 35 },
  { name: "Office Chair", sales: 89, revenue: 890000, percentage: 28 },
  { name: "Desk Lamp", sales: 67, revenue: 167500, percentage: 15 },
  { name: "USB Cable", sales: 156, revenue: 140244, percentage: 12 },
  { name: "Wireless Mouse", sales: 45, revenue: 80955, percentage: 10 },
];

const categoryData = [
  { name: "Electronics", value: 45, color: "#0088FE" },
  { name: "Furniture", value: 30, color: "#00C49F" },
  { name: "Accessories", value: 15, color: "#FFBB28" },
  { name: "Lighting", value: 10, color: "#FF8042" },
];

const gstReportData = [
  {
    invoiceNo: "INV-2024-001",
    date: "2024-03-20",
    customer: "ABC Electronics",
    gstNo: "29ABCDE1234F1Z5",
    taxableAmount: 100000,
    sgst: 9000,
    cgst: 9000,
    igst: 0,
    total: 118000,
  },
  {
    invoiceNo: "INV-2024-002",
    date: "2024-03-21",
    customer: "Tech Solutions",
    gstNo: "29FGHIJ5678K2L6",
    taxableAmount: 75000,
    sgst: 6750,
    cgst: 6750,
    igst: 0,
    total: 88500,
  },
];

const stockReportData = [
  {
    product: "Laptop Pro 15",
    openingStock: 30,
    purchaseIn: 15,
    saleOut: 20,
    closingStock: 25,
    value: 2250000,
  },
  {
    product: "Office Chair",
    openingStock: 25,
    purchaseIn: 10,
    saleOut: 18,
    closingStock: 17,
    value: 212500,
  },
];

export default function Reports() {
  const [dateRange, setDateRange] = useState({
    from: new Date(2024, 2, 1), // March 1, 2024
    to: new Date(), // Today
  });
  const [selectedReport, setSelectedReport] = useState("sales");
  const [reportPeriod, setReportPeriod] = useState("monthly");

  const handleExportReport = (format: string) => {
    console.log(`Exporting ${selectedReport} report as ${format}`);
    alert(`${selectedReport} report exported as ${format.toUpperCase()}`);
  };

  const handlePrintReport = () => {
    console.log(`Printing ${selectedReport} report`);
    alert(`${selectedReport} report sent to printer`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Business Reports
              </h1>
              <p className="text-slate-600 mt-2 text-lg">
                Comprehensive analytics & insights for data-driven decisions
              </p>
            </div>
            <div className="flex items-center space-x-3">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handlePrintReport}
                className="bg-white/50 border-slate-200 hover:bg-white/80 transition-all duration-200"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Select
                value="pdf"
                onValueChange={(value) => handleExportReport(value)}
              >
                <SelectTrigger className="w-36 bg-gradient-to-r from-blue-500 to-purple-600 text-white border-0 hover:from-blue-600 hover:to-purple-700">
                  <Download className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pdf">Export PDF</SelectItem>
                  <SelectItem value="excel">Export Excel</SelectItem>
                  <SelectItem value="csv">Export CSV</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Report Filters */}
        <Card className="bg-white/80 backdrop-blur-sm shadow-lg border border-white/20">
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="space-y-2">
                <Label className="text-slate-700 font-medium">Report Period</Label>
                <Select value={reportPeriod} onValueChange={setReportPeriod}>
                  <SelectTrigger className="w-40 bg-white/70 border-slate-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="weekly">This Week</SelectItem>
                    <SelectItem value="monthly">This Month</SelectItem>
                    <SelectItem value="quarterly">This Quarter</SelectItem>
                    <SelectItem value="yearly">This Year</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {reportPeriod === "custom" && (
                <>
                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">From Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-40 justify-start text-left font-normal bg-white/70 border-slate-200"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange.from ? (
                            format(dateRange.from, "PPP")
                          ) : (
                            <span>Pick a date</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={dateRange.from}
                          onSelect={(date) =>
                            date && setDateRange({ ...dateRange, from: date })
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-slate-700 font-medium">To Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-40 justify-start text-left font-normal bg-white/70 border-slate-200"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dateRange.to ? (
                            format(dateRange.to, "PPP")
                          ) : (
                            <span>Pick a date</span>
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={dateRange.to}
                          onSelect={(date) =>
                            date && setDateRange({ ...dateRange, to: date })
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}

              <div className="flex-1"></div>
              <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white border-0 shadow-lg">
                <Eye className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </div>
          </CardContent>
        </Card>

        <Tabs value={selectedReport} onValueChange={setSelectedReport} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-white/80 backdrop-blur-sm shadow-lg border border-white/20 rounded-xl p-1">
            <TabsTrigger 
              value="sales" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-lg font-medium transition-all duration-200"
            >
              Sales
            </TabsTrigger>
            <TabsTrigger 
              value="purchase" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white rounded-lg font-medium transition-all duration-200"
            >
              Purchase
            </TabsTrigger>
            <TabsTrigger 
              value="stock" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-red-600 data-[state=active]:text-white rounded-lg font-medium transition-all duration-200"
            >
              Stock
            </TabsTrigger>
            <TabsTrigger 
              value="gst" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-yellow-500 data-[state=active]:to-orange-600 data-[state=active]:text-white rounded-lg font-medium transition-all duration-200"
            >
              GST
            </TabsTrigger>
            <TabsTrigger 
              value="customer" 
              className="data-[state=active]:bg-gradient-to-r data-[state=active]:from-pink-500 data-[state=active]:to-purple-600 data-[state=active]:text-white rounded-lg font-medium transition-all duration-200"
            >
              Customer
            </TabsTrigger>
          </TabsList>

          {/* Sales Reports */}
          <TabsContent value="sales" className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-xl border-0 transform hover:scale-105 transition-all duration-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium opacity-90">
                    Total Sales
                  </CardTitle>
                  <DollarSign className="h-5 w-5 opacity-80" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₹3,28,000</div>
                  <div className="flex items-center text-xs text-blue-100 mt-1">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    +12.5% from last month
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-xl border-0 transform hover:scale-105 transition-all duration-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium opacity-90">
                    Total Orders
                  </CardTitle>
                  <ShoppingCart className="h-5 w-5 opacity-80" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">1,247</div>
                  <div className="flex items-center text-xs text-green-100 mt-1">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    +8.2% from last month
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white shadow-xl border-0 transform hover:scale-105 transition-all duration-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium opacity-90">
                    Pending
                  </CardTitle>
                  <Clock className="h-5 w-5 opacity-80" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₹0</div>
                  <div className="flex items-center text-xs text-purple-100 mt-1">
                    Outstanding receivable
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-xl border-0 transform hover:scale-105 transition-all duration-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium opacity-90">
                    Gross Profit
                  </CardTitle>
                  <TrendingUp className="h-5 w-5 opacity-80" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">₹1,52,000</div>
                  <div className="flex items-center text-xs text-orange-100 mt-1">
                    <TrendingUp className="h-3 w-3 mr-1" />
                    +15.3% from last month
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 border-b border-white/20">
                  <CardTitle className="text-lg font-semibold text-slate-800">Sales Trend (Last 6 Months)</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={salesData}>
                      <defs>
                        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1}/>
                        </linearGradient>
                        <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" stroke="#64748b" fontSize={12} />
                      <YAxis stroke="#64748b" fontSize={12} />
                      <Tooltip
                        formatter={(value) => [`₹${value.toLocaleString()}`, ""]}
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          border: 'none',
                          borderRadius: '12px',
                          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="sales"
                        stroke="#3b82f6"
                        strokeWidth={3}
                        name="Sales"
                        dot={{ fill: '#3b82f6', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, stroke: '#3b82f6', strokeWidth: 2 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="profit"
                        stroke="#10b981"
                        strokeWidth={3}
                        name="Profit"
                        dot={{ fill: '#10b981', strokeWidth: 2, r: 6 }}
                        activeDot={{ r: 8, stroke: '#10b981', strokeWidth: 2 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-white/20">
                  <CardTitle className="text-lg font-semibold text-slate-800">Sales by Category</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <defs>
                        <filter id="shadow">
                          <feDropShadow dx="0" dy="4" stdDeviation="3" floodOpacity="0.1"/>
                        </filter>
                      </defs>
                      <Pie
                        data={categoryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={120}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}%`}
                        labelLine={false}
                        filter="url(#shadow)"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          border: 'none',
                          borderRadius: '12px',
                          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Top Products */}
            <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-white/20">
                <CardTitle className="text-lg font-semibold text-slate-800 flex items-center">
                  <BarChart3 className="h-5 w-5 mr-2 text-emerald-600" />
                  Top Selling Products
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/50">
                        <TableHead className="font-semibold text-slate-700">Product Name</TableHead>
                        <TableHead className="font-semibold text-slate-700">Units Sold</TableHead>
                        <TableHead className="font-semibold text-slate-700">Revenue</TableHead>
                        <TableHead className="font-semibold text-slate-700">% of Total Sales</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topProducts.map((product, index) => (
                        <TableRow key={index} className="hover:bg-blue-50/30 transition-colors duration-200">
                          <TableCell className="font-medium text-slate-800 py-4">
                            <div className="flex items-center">
                              <div className={`w-3 h-3 rounded-full mr-3 ${
                                index === 0 ? 'bg-yellow-400' : 
                                index === 1 ? 'bg-gray-300' : 
                                index === 2 ? 'bg-amber-600' : 'bg-slate-300'
                              }`}></div>
                              {product.name}
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">{product.sales}</TableCell>
                          <TableCell className="font-medium text-slate-800 py-4">₹{product.revenue.toLocaleString()}</TableCell>
                          <TableCell className="py-4">
                            <div className="flex items-center">
                              <div className="w-12 bg-slate-200 rounded-full h-2 mr-3">
                                <div 
                                  className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full" 
                                  style={{ width: `${product.percentage}%` }}
                                ></div>
                              </div>
                              <span className="font-medium text-slate-700">{product.percentage}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* GST Reports */}
          <TabsContent value="gst" className="space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-yellow-50 to-orange-50 border-b border-white/20">
                <CardTitle className="text-lg font-semibold text-slate-800 flex items-center">
                  <FileText className="h-5 w-5 mr-2 text-orange-600" />
                  GST Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                  <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl border border-blue-200">
                    <div className="text-2xl font-bold text-blue-700">₹15,750</div>
                    <div className="text-sm text-blue-600 font-medium mt-1">Total SGST</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-green-50 to-green-100 rounded-xl border border-green-200">
                    <div className="text-2xl font-bold text-green-700">₹15,750</div>
                    <div className="text-sm text-green-600 font-medium mt-1">Total CGST</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl border border-purple-200">
                    <div className="text-2xl font-bold text-purple-700">₹0</div>
                    <div className="text-sm text-purple-600 font-medium mt-1">Total IGST</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl border border-orange-200">
                    <div className="text-2xl font-bold text-orange-700">₹31,500</div>
                    <div className="text-sm text-orange-600 font-medium mt-1">Total Tax</div>
                  </div>
                </div>

                <div className="overflow-x-auto bg-white/50 rounded-xl border border-white/30">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/50">
                        <TableHead className="font-semibold text-slate-700">Invoice No</TableHead>
                        <TableHead className="font-semibold text-slate-700">Date</TableHead>
                        <TableHead className="font-semibold text-slate-700">Customer</TableHead>
                        <TableHead className="font-semibold text-slate-700">GST No</TableHead>
                        <TableHead className="font-semibold text-slate-700">Taxable Amount</TableHead>
                        <TableHead className="font-semibold text-slate-700">SGST</TableHead>
                        <TableHead className="font-semibold text-slate-700">CGST</TableHead>
                        <TableHead className="font-semibold text-slate-700">IGST</TableHead>
                        <TableHead className="font-semibold text-slate-700">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gstReportData.map((row, index) => (
                        <TableRow key={index} className="hover:bg-yellow-50/30 transition-colors duration-200">
                          <TableCell className="font-medium text-slate-800 py-4">
                            {row.invoiceNo}
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">{row.date}</TableCell>
                          <TableCell className="text-slate-600 py-4">{row.customer}</TableCell>
                          <TableCell className="text-slate-600 py-4 font-mono text-xs">{row.gstNo}</TableCell>
                          <TableCell className="font-medium text-slate-800 py-4">
                            ₹{row.taxableAmount.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">₹{row.sgst.toLocaleString()}</TableCell>
                          <TableCell className="text-slate-600 py-4">₹{row.cgst.toLocaleString()}</TableCell>
                          <TableCell className="text-slate-600 py-4">₹{row.igst.toLocaleString()}</TableCell>
                          <TableCell className="font-bold text-slate-800 py-4">
                            ₹{row.total.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Stock Reports */}
          <TabsContent value="stock" className="space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 border-b border-white/20">
                <CardTitle className="text-lg font-semibold text-slate-800 flex items-center">
                  <Package className="h-5 w-5 mr-2 text-orange-600" />
                  Stock Movement Report
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50/50">
                        <TableHead className="font-semibold text-slate-700">Product</TableHead>
                        <TableHead className="font-semibold text-slate-700">Opening Stock</TableHead>
                        <TableHead className="font-semibold text-slate-700">Purchase In</TableHead>
                        <TableHead className="font-semibold text-slate-700">Sale Out</TableHead>
                        <TableHead className="font-semibold text-slate-700">Closing Stock</TableHead>
                        <TableHead className="font-semibold text-slate-700">Stock Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockReportData.map((row, index) => (
                        <TableRow key={index} className="hover:bg-orange-50/30 transition-colors duration-200">
                          <TableCell className="font-medium text-slate-800 py-4">
                            <div className="flex items-center">
                              <div className="w-2 h-8 bg-gradient-to-b from-orange-400 to-red-500 rounded-full mr-3"></div>
                              {row.product}
                            </div>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                              {row.openingStock}
                            </span>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                              +{row.purchaseIn}
                            </span>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">
                            <span className="px-2 py-1 bg-red-100 text-red-700 rounded-lg text-sm font-medium">
                              -{row.saleOut}
                            </span>
                          </TableCell>
                          <TableCell className="text-slate-600 py-4">
                            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm font-medium">
                              {row.closingStock}
                            </span>
                          </TableCell>
                          <TableCell className="font-bold text-slate-800 py-4">₹{row.value.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Purchase Reports */}
          <TabsContent value="purchase" className="space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-white/20">
                <CardTitle className="text-lg font-semibold text-slate-800 flex items-center">
                  <Package className="h-5 w-5 mr-2 text-green-600" />
                  Purchase Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="text-center py-16">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 mx-auto bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center">
                      <Package className="h-10 w-10 text-green-600" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-yellow-400 to-orange-500 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-white">!</span>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-3">
                    Purchase Reports Coming Soon
                  </h3>
                  <p className="text-slate-600 max-w-md mx-auto leading-relaxed">
                    Detailed purchase analytics, supplier performance metrics, and procurement insights will be available here.
                  </p>
                  <div className="mt-6">
                    <Button className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white">
                      Notify Me When Ready
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customer Reports */}
          <TabsContent value="customer" className="space-y-6">
            <Card className="bg-white/80 backdrop-blur-sm shadow-xl border border-white/20 rounded-2xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-pink-50 to-purple-50 border-b border-white/20">
                <CardTitle className="text-lg font-semibold text-slate-800 flex items-center">
                  <Users className="h-5 w-5 mr-2 text-pink-600" />
                  Customer Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="text-center py-16">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 mx-auto bg-gradient-to-br from-pink-100 to-purple-100 rounded-full flex items-center justify-center">
                      <Users className="h-10 w-10 text-pink-600" />
                    </div>
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                      <span className="text-xs font-bold text-white">!</span>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-3">
                    Customer Reports Coming Soon
                  </h3>
                  <p className="text-slate-600 max-w-md mx-auto leading-relaxed">
                    Customer analytics, purchase patterns, loyalty insights, and behavioral data will be available here.
                  </p>
                  <div className="mt-6">
                    <Button className="bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700 text-white">
                      Notify Me When Ready
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
