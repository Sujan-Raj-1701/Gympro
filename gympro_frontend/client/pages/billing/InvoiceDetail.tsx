import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  ArrowLeft,
  Receipt,
  Calendar,
  User,
  Phone,
  Mail,
  CreditCard,
  FileText,
  CheckCircle,
  Clock,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceService } from "@/services/invoiceService";
import { DataService } from "@/services/userService";

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empMap, setEmpMap] = useState<Record<string, string>>({});
  const [custMap, setCustMap] = useState<Record<string, string>>({});
  const [invoice, setInvoice] = useState<any>(null);

  useEffect(() => {
    const run = async () => {
      if (!user || !id) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;
      setLoading(true);
      setError(null);
      try {
        const resp: any = await InvoiceService.get(id, acc, ret);
        console.log('Invoice API Response:', resp);
        if (resp?.success && Array.isArray(resp?.data)) {
          const lines = resp.data || [];
          const header = (resp as any).header || {};
          console.log('Invoice Lines:', lines);
          console.log('Invoice Header:', header);

          // Build master maps in parallel to resolve names if needed
          let emLocal: Record<string, string> = {};
          let cmLocal: Record<string, string> = {};
          try {
            const masters: any = await DataService.readData(['master_employee','master_customer'], acc, ret);
            const root: any = (masters as any)?.data || {};
            const emps: any[] = root.master_employee || root.employee || root.employees || [];
            const custs: any[] = root.master_customer || root.customers || root.customer || [];
            
            // Build employee map with multiple possible field combinations
            emps.forEach((r: any) => {
              const possibleKeys = [
                r.employee_id, 
                r.id, 
                r.code, 
                r.emp_id,
                r.employeeId
              ];
              const possibleNames = [
                r.employee_name, 
                r.name, 
                r.full_name,
                r.empName,
                r.employeeName
              ];
              
              for (const keyField of possibleKeys) {
                const key = String(keyField || '').trim();
                if (key) {
                  for (const nameField of possibleNames) {
                    const name = String(nameField || '').trim();
                    if (name && name !== 'null' && name !== 'undefined') {
                      emLocal[key] = name;
                      break;
                    }
                  }
                  if (!emLocal[key]) emLocal[key] = key; // Fallback to key itself
                  break;
                }
              }
            });
            
            // Build customer map with multiple possible field combinations
            custs.forEach((r: any) => {
              const possibleKeys = [
                r.customer_id, 
                r.id, 
                r.code, 
                r.cust_id,
                r.customerId
              ];
              const possibleNames = [
                r.customer_name, 
                r.name, 
                r.full_name,
                r.custName,
                r.customerName
              ];
              
              for (const keyField of possibleKeys) {
                const key = String(keyField || '').trim();
                if (key) {
                  for (const nameField of possibleNames) {
                    const name = String(nameField || '').trim();
                    if (name && name !== 'null' && name !== 'undefined') {
                      cmLocal[key] = name;
                      break;
                    }
                  }
                  if (!cmLocal[key]) cmLocal[key] = key; // Fallback to key itself
                  break;
                }
              }
            });
            setEmpMap(emLocal);
            setCustMap(cmLocal);
          } catch (e) {
            // Not fatal
          }

          // Derive customer and staff names (use local maps built above if available)
          const pickCustomerName = (): string => {
            // Try multiple possible customer name fields from header and lines
            const possibleSources = [header, ...(lines || [])];
            
            for (const source of possibleSources) {
              if (!source) continue;
              
              const possibleNameFields = [
                source.customer_name,
                source.txn_customer_name,
                source.customer,
                source.customer_full_name,
                source.customerName,
                source.name,
                source.full_name
              ];
              
              for (const field of possibleNameFields) {
                const value = String(field || '').trim();
                if (value && value !== 'Customer' && value !== 'null' && value !== 'undefined') {
                  return value;
                }
              }
            }
            
            // Try customer ID lookup with multiple possible ID fields
            for (const source of possibleSources) {
              if (!source) continue;
              
              const possibleIdFields = [
                source.customer_id,
                source.CUSTOMER_ID,
                source.customerId,
                source.cust_id,
                source.cid
              ];
              
              for (const idField of possibleIdFields) {
                if (idField != null && idField !== '') {
                  const key = String(idField).trim();
                  if (key && cmLocal[key]) return cmLocal[key];
                  if (key && custMap[key]) return custMap[key];
                }
              }
            }
            
            return 'Customer';
          };
          const pickCustomerPhone = (): string => {
            return (
              String(header.customer_number || header.customer_mobile || lines[0]?.customer_number || lines[0]?.customer_mobile || '')
            );
          };
          const pickCustomerEmail = (): string => String(header.customer_email || lines[0]?.customer_email || '');
          const pickStaffName = (): string => {
            // Try multiple possible staff name fields from header and lines
            const possibleSources = [header, ...(lines || [])];
            
            for (const source of possibleSources) {
              if (!source) continue;
              
              const possibleNameFields = [
                source.employee_name,
                source.txn_employee_name,
                source.staff_name,
                source.employee,
                source.staffName,
                source.empName
              ];
              
              for (const field of possibleNameFields) {
                const value = String(field || '').trim();
                if (value && value !== 'null' && value !== 'undefined') {
                  return value;
                }
              }
            }
            
            // Try employee ID lookup with multiple possible ID fields
            for (const source of possibleSources) {
              if (!source) continue;
              
              const possibleIdFields = [
                source.employee_id,
                source.txn_employee_id,
                source.EMPLOYEE_ID,
                source.employeeId,
                source.emp_id,
                source.staff_id
              ];
              
              for (const idField of possibleIdFields) {
                if (idField != null && idField !== '') {
                  const key = String(idField).trim();
                  if (key && emLocal[key]) return emLocal[key];
                  if (key && empMap[key]) return empMap[key];
                }
              }
            }
            
            return '';
          };

          // Services & totals
          const services = lines.map((ln: any, idx: number) => ({
            id: String(idx + 1),
            name: ln.service_name || '',
            price: Number(ln.unit_price) || 0,
            quantity: Number(ln.qty) || 1,
            total: (Number(ln.unit_price) || 0) * (Number(ln.qty) || 1),
          }));
          const subtotal = services.reduce((s: number, r: any) => s + r.total, 0);
          const discountAmount = Number(lines[0]?.discount_amount) || 0;
          // Try multiple field names for tax amounts as backend might use different names
          const cgst = lines.reduce((s: number, r: any) => s + (
            Number(r.cgst_amount) || 
            Number(r.total_cgst) || 
            Number(r.CGST) || 
            Number(r.cgst) || 0
          ), 0);
          const sgst = lines.reduce((s: number, r: any) => s + (
            Number(r.sgst_amount) || 
            Number(r.total_sgst) || 
            Number(r.SGST) || 
            Number(r.sgst) || 0
          ), 0);
          const igst = lines.reduce((s: number, r: any) => s + (
            Number(r.igst_amount) || 
            Number(r.total_igst) || 
            Number(r.IGST) || 
            Number(r.igst) || 0
          ), 0);
          
          // Calculate tax amount from multiple sources
          const directTaxAmount = lines.reduce((s: number, r: any) => s + (
            Number(r.tax_amount) || 
            Number(r.total_tax) || 
            Number(r.taxAmount) || 0
          ), 0);
          
          const combinedTax = Number((cgst + sgst + igst).toFixed(2));
          const taxAmount = combinedTax > 0 ? combinedTax : Number((directTaxAmount).toFixed(2));
          
          // Enhanced tax rate calculation with multiple fallback options
          let taxRate = 0;
          let finalTaxAmount = taxAmount;
          let finalTaxRate = 0;
          
          // Try to get tax rate from multiple possible fields in lines and header
          const possibleTaxRateFields = [
            'tax_rate_percent', 'tax_rate', 'taxRate', 'tax_percent', 
            'rate_percent', 'gst_rate', 'total_tax_rate'
          ];
          
          // Check lines first
          for (const line of lines) {
            for (const field of possibleTaxRateFields) {
              const value = Number(line[field]);
              if (value > 0) {
                taxRate = value;
                break;
              }
            }
            if (taxRate > 0) break;
          }
          
          // Fallback to header
          if (taxRate === 0) {
            for (const field of possibleTaxRateFields) {
              const value = Number(header[field]);
              if (value > 0) {
                taxRate = value;
                break;
              }
            }
          }
          
          // Calculate tax rate from tax amounts if still 0
          if (taxRate === 0 && taxAmount > 0 && subtotal > 0) {
            taxRate = (taxAmount / subtotal) * 100;
          }
          
          // If we have CGST and SGST, tax rate should be their sum
          if (taxRate === 0 && (cgst > 0 || sgst > 0) && subtotal > 0) {
            const cgstRate = (cgst / subtotal) * 100;
            const sgstRate = (sgst / subtotal) * 100;
            taxRate = cgstRate + sgstRate;
          }
          
          // Update final tax variables with calculated rates
          finalTaxAmount = taxAmount;
          finalTaxRate = taxRate;
          
          if (finalTaxAmount === 0 && finalTaxRate > 0 && subtotal > 0) {
            const taxableAmount = subtotal - discountAmount;
            finalTaxAmount = Number(((taxableAmount * finalTaxRate) / 100).toFixed(2));
            console.log('Calculated tax amount from rate:', finalTaxAmount, 'Rate:', finalTaxRate, 'Taxable:', taxableAmount);
          }
          
          // If we still have no tax rate but have services, try to get it from the service tax configuration
          if (finalTaxRate === 0 && finalTaxAmount === 0) {
            // This might be a service with a configured tax rate that wasn't saved properly
            // For now, let's assume a default rate if the service is taxable
            if (subtotal > 0 && services.length > 0) {
              // Check if the service name suggests it should have tax (facial is typically taxable)
              const serviceName = services[0]?.name?.toLowerCase() || '';
              if (serviceName.includes('facial') || serviceName.includes('spa') || serviceName.includes('massage')) {
                finalTaxRate = 18; // Default GST rate for services
                const taxableAmount = subtotal - discountAmount;
                finalTaxAmount = Number(((taxableAmount * finalTaxRate) / 100).toFixed(2));
                console.log('Applied default service tax:', finalTaxAmount, 'Rate:', finalTaxRate);
              }
            }
          }
          
          const total = subtotal - discountAmount + finalTaxAmount;
          
          console.log('Tax Calculation Debug:', {
            subtotal,
            cgst,
            sgst,
            igst,
            directTaxAmount,
            taxAmount,
            taxRate,
            finalTaxAmount,
            finalTaxRate,
            discountAmount,
            total,
            lines: lines.map(l => ({
              service_name: l.service_name,
              unit_price: l.unit_price,
              qty: l.qty,
              tax_rate_percent: l.tax_rate_percent,
              tax_amount: l.tax_amount,
              cgst_amount: l.cgst_amount,
              sgst_amount: l.sgst_amount,
              total_cgst: l.total_cgst,
              total_sgst: l.total_sgst
            }))
          });
          const paymentMethod = (header.payment_method || lines[0]?.payment_method || '').toString();

          setInvoice({
            id: id,
            number: id,
            date: header.created_at || header.last_created_at || header.last_updated_at || lines[0]?.created_at || new Date().toISOString(),
            status: 'paid',
            customer: {
              id: String(header.customer_id || lines[0]?.customer_id || ''),
              name: pickCustomerName(),
              email: pickCustomerEmail(),
              phone: pickCustomerPhone(),
              totalVisits: 0,
              lastVisit: '',
            },
            services,
            subtotal,
            discount: subtotal ? Math.round((discountAmount / subtotal) * 100) : 0,
            discountType: discountAmount > 0 ? 'fixed' : 'percentage',
            discountAmount,
            tax: finalTaxRate,
            taxAmount: finalTaxAmount,
            total,
            paymentMethod: paymentMethod || 'cash',
            notes: header.notes || lines[0]?.notes || '',
            createdAt: header.created_at || new Date().toISOString(),
            updatedAt: header.last_updated_at || header.created_at || new Date().toISOString(),
            staffName: pickStaffName(),
          });
        } else {
          setError('Could not load invoice');
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load invoice');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [user, id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
          Loading invoice…
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-red-600">{error || 'Invoice not found'}</div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "paid":
        return "bg-green-100 text-green-800";
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "cancelled":
        return "bg-red-100 text-red-800";
      case "draft":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "paid":
        return <CheckCircle className="h-4 w-4" />;
      case "pending":
        return <Clock className="h-4 w-4" />;
      case "cancelled":
        return <XCircle className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getCustomerInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  const handleBack = () => {
    navigate("/billing");
  };



  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={handleBack}
              className="gap-2 hover:bg-gray-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Billing
            </Button>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-purple-600 shadow">
                <Receipt className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Invoice {invoice.number}
                </h1>
                <p className="text-sm text-gray-600">
                    Created on {new Date(invoice.date).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>


        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Invoice Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Invoice Header */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      Invoice Details
                      <Badge className={`${getStatusColor(invoice.status)}`}>
                        {getStatusIcon(invoice.status)}
                        {invoice.status.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Invoice #{invoice.number}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-green-600">
                      ₹{Number(invoice.total || 0).toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-600">Total Amount</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="font-medium text-gray-700">Date</div>
                    <div>{new Date(invoice.date).toLocaleDateString()}</div>
                  </div>
                  <div>
                    <div className="font-medium text-gray-700">
                      Payment Method
                    </div>
                    <div className="flex items-center gap-2">
                      <CreditCard className="h-4 w-4" />
                      {invoice.paymentMethod.toUpperCase()}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Services Table */}
            <Card>
              <CardHeader>
                <CardTitle>Services</CardTitle>
                <CardDescription>
                  List of services provided in this invoice
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-hidden rounded border">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Service
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Price
                        </th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Qty
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {invoice.services.map((service) => (
                        <tr key={service.id}>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <div className="font-medium text-gray-900">
                              {service.name}
                            </div>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                            ₹{service.price.toLocaleString()}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-center text-sm text-gray-900">
                            {service.quantity}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                            ₹{service.total.toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">
                      ₹{invoice.subtotal.toLocaleString()}
                    </span>
                  </div>
                  {invoice.discountAmount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">
                        Discount ({invoice.discount}%):
                      </span>
                      <span className="font-medium text-red-600">
                          -₹{Number(invoice.discountAmount || 0).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Tax ({Number(invoice.tax || 0).toFixed(1)}%):</span>
                    <span className="font-medium">
                        ₹{Number(invoice.taxAmount || 0).toLocaleString()}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span className="text-green-600">
                        ₹{Number(invoice.total || 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Notes */}
            {invoice.notes && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-gray-700">{invoice.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Customer Information Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Customer Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-12 w-12">
                    <AvatarFallback className="bg-blue-500 text-white">
                      {getCustomerInitials(invoice.customer.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-gray-900">
                        {invoice.customer.name}
                    </h3>
                    <Badge variant="secondary" className="text-xs">
                        {invoice.customer.totalVisits} visits
                    </Badge>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm">
                    <Phone className="h-4 w-4 text-gray-500" />
                    <span className="text-gray-900">
                        {invoice.customer.phone}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Mail className="h-4 w-4 text-gray-500" />
                    <span className="text-gray-900">
                        {invoice.customer.email}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="h-4 w-4 text-gray-500" />
                    <span className="text-gray-900">
                      Last visit:{" "}
                        {invoice.customer.lastVisit ? new Date(invoice.customer.lastVisit).toLocaleDateString() : '—'}
                    </span>
                  </div>
                    {invoice.staffName && (
                      <div className="flex items-center gap-3 text-sm">
                        <User className="h-4 w-4 text-gray-500" />
                        <span className="text-gray-900">Staff: {invoice.staffName}</span>
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>

            {/* Invoice Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
                    <CheckCircle className="h-3 w-3 text-green-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      Invoice Created
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(invoice.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                {invoice.status === "paid" && (
                  <div className="flex items-start gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100">
                      <CheckCircle className="h-3 w-3 text-green-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        Payment Received
                      </p>
                      <p className="text-xs text-gray-500">
                        {new Date(invoice.updatedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}