import React from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface SettlementReportProps {
  data: Array<{
    id: string;
    type: 'appointment' | 'billing' | 'income' | 'expense';
    date: Date;
    customer_name?: string;
    customer_phone?: string;
    staff_name?: string;
    description: string;
    amount: number;
    payment_mode?: string;
    status: string;
    source: string;
  }>;
  dateRange: { start: Date; end: Date };
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
  };
}

export default function SettlementReport({ data, dateRange, companyInfo }: SettlementReportProps) {
  const totalIncome = data
    .filter(item => ['appointment', 'billing', 'income'].includes(item.type))
    .reduce((sum, item) => sum + item.amount, 0);

  const totalExpenses = data
    .filter(item => item.type === 'expense')
    .reduce((sum, item) => sum + item.amount, 0);

  const netAmount = totalIncome - totalExpenses;

  const groupedByType = {
    appointment: data.filter(item => item.type === 'appointment'),
    billing: data.filter(item => item.type === 'billing'),
    income: data.filter(item => item.type === 'income'),
    expense: data.filter(item => item.type === 'expense')
  };

  return (
    <div className="print:p-4 print:text-xs print:bg-white space-y-6">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl print:text-lg font-bold">Daily Settlement Report</h1>
        {companyInfo && (
          <div className="text-sm print:text-xs text-gray-600">
            <p className="font-medium">{companyInfo.name}</p>
            <p>{companyInfo.address}</p>
            <p>Phone: {companyInfo.phone} | Email: {companyInfo.email}</p>
          </div>
        )}
        <p className="text-lg print:text-sm font-medium">
          Period: {format(dateRange.start, 'dd MMM yyyy')} to {format(dateRange.end, 'dd MMM yyyy')}
        </p>
        <p className="text-sm print:text-xs text-gray-500">
          Generated on: {format(new Date(), 'dd MMM yyyy HH:mm')}
        </p>
      </div>

      <Separator />

      {/* Summary Section */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 print:grid-cols-4 print:gap-2">
        <Card className="print:border print:shadow-none">
          <CardContent className="p-4 print:p-2 text-center">
            <p className="text-sm print:text-xs text-gray-600">Total Income</p>
            <p className="text-xl print:text-sm font-bold text-green-600">
              ₹{totalIncome.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
        <Card className="print:border print:shadow-none">
          <CardContent className="p-4 print:p-2 text-center">
            <p className="text-sm print:text-xs text-gray-600">Total Expenses</p>
            <p className="text-xl print:text-sm font-bold text-red-600">
              ₹{totalExpenses.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
        <Card className="print:border print:shadow-none">
          <CardContent className="p-4 print:p-2 text-center">
            <p className="text-sm print:text-xs text-gray-600">Net Amount</p>
            <p className={`text-xl print:text-sm font-bold ${netAmount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ₹{netAmount.toLocaleString('en-IN')}
            </p>
          </CardContent>
        </Card>
        <Card className="print:border print:shadow-none">
          <CardContent className="p-4 print:p-2 text-center">
            <p className="text-sm print:text-xs text-gray-600">Total Transactions</p>
            <p className="text-xl print:text-sm font-bold text-blue-600">
              {data.length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4 print:gap-2">
        {Object.entries(groupedByType).map(([type, items]) => {
          const typeAmount = items.reduce((sum, item) => sum + item.amount, 0);
          return (
            <div key={type} className="text-center">
              <p className="text-sm print:text-xs text-gray-600 capitalize">{type}</p>
              <p className="font-bold print:text-xs">{items.length} transactions</p>
              <p className={`font-bold print:text-xs ${
                type === 'expense' ? 'text-red-600' : 'text-green-600'
              }`}>
                ₹{typeAmount.toLocaleString('en-IN')}
              </p>
            </div>
          );
        })}
      </div>

      <Separator />

      {/* Detailed Transactions */}
      <Card className="print:border print:shadow-none">
        <CardHeader className="print:p-2">
          <CardTitle className="print:text-sm">Transaction Details</CardTitle>
        </CardHeader>
        <CardContent className="print:p-2">
          <div className="overflow-x-auto">
            <Table className="print:text-xs">
              <TableHeader>
                <TableRow className="print:border">
                  <TableHead className="print:border print:p-1">Date & Time</TableHead>
                  <TableHead className="print:border print:p-1">Type</TableHead>
                  <TableHead className="print:border print:p-1">Customer</TableHead>
                  <TableHead className="print:border print:p-1">Description</TableHead>
                  <TableHead className="print:border print:p-1 text-right">Amount</TableHead>
                  <TableHead className="print:border print:p-1">Payment</TableHead>
                  <TableHead className="print:border print:p-1">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data
                  .sort((a, b) => b.date.getTime() - a.date.getTime())
                  .map((item) => (
                    <TableRow key={item.id} className="print:border">
                      <TableCell className="print:border print:p-1">
                        <div className="text-xs">
                          <div>{format(item.date, 'dd/MM/yyyy')}</div>
                          <div className="text-gray-500">{format(item.date, 'HH:mm')}</div>
                        </div>
                      </TableCell>
                      <TableCell className="print:border print:p-1">
                        <Badge 
                          variant={
                            item.type === 'expense' ? 'destructive' :
                            item.type === 'appointment' ? 'default' :
                            item.type === 'billing' ? 'secondary' : 'outline'
                          }
                          className="print:text-xs print:px-1"
                        >
                          {item.type.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="print:border print:p-1">
                        <div className="text-xs">
                          <div>{item.customer_name || '-'}</div>
                          {item.customer_phone && (
                            <div className="text-gray-500">{item.customer_phone}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="print:border print:p-1 max-w-xs">
                        <div className="text-xs truncate">{item.description}</div>
                      </TableCell>
                      <TableCell className={`print:border print:p-1 text-right font-medium ${
                        item.type === 'expense' ? 'text-red-600' : 'text-green-600'
                      }`}>
                        <span className="text-xs">₹{item.amount.toLocaleString('en-IN')}</span>
                      </TableCell>
                      <TableCell className="print:border print:p-1">
                        <span className="text-xs">{item.payment_mode || '-'}</span>
                      </TableCell>
                      <TableCell className="print:border print:p-1">
                        <Badge 
                          variant={
                            item.status === 'settled' || item.status === 'completed' ? 'default' :
                            item.status === 'advance' ? 'secondary' : 'outline'
                          }
                          className="print:text-xs print:px-1"
                        >
                          {item.status.toUpperCase()}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-center text-sm print:text-xs text-gray-500 space-y-2">
        <Separator />
        <p>This is a computer-generated report and does not require a signature.</p>
        <p>For any discrepancies, please contact the administrator.</p>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { font-size: 10px !important; }
          .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          .print\\:text-xs { font-size: 10px !important; }
          .print\\:text-sm { font-size: 12px !important; }
          .print\\:text-lg { font-size: 16px !important; }
          .print\\:p-1 { padding: 2px !important; }
          .print\\:p-2 { padding: 4px !important; }
          .print\\:p-4 { padding: 8px !important; }
          .print\\:px-1 { padding-left: 2px !important; padding-right: 2px !important; }
          .print\\:gap-2 { gap: 4px !important; }
          .print\\:grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
          .print\\:border { border: 1px solid #ccc !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:bg-white { background-color: white !important; }
          @page { margin: 0.5in; }
        }
      `}</style>
    </div>
  );
}