import { useState, useEffect, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar } from "@/components/ui/calendar";
import { Textarea } from "@/components/ui/textarea";
import {
  Receipt,
  FileText,
  FileSignature,
  Plus,
  Search,
  Filter,
  CreditCard,
  Banknote,
  Smartphone,
  Printer,
  Eye,
  Edit,
  Trash2,
  DollarSign,
  Calendar as CalendarIcon,
  TrendingUp,
  BarChart3,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  ArrowUpDown,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
  Users,
  Pause,
  HandCoins,
  MessageSquareText,
  Save,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { toIST, formatYMDIST, parseYMDToIST, nowIST, formatTimeIST, normalizeToISTDate } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { DataService } from "@/services/userService";
import { InvoiceService } from "@/services/invoiceService";
import CustomerService from "@/services/customerService";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { exportData } from "@/lib/exportUtils";

type CustomerCreditRow = {
  id: string;
  name: string;
  phone: string;
  credit: number;
  raw?: any;
};

const pickPhone = (row: any): string => {
  const candidates = [
    row?.phone,
    row?.mobile,
    row?.customer_mobile,
    row?.customer_phone,
    row?.phone1,
    row?.alternate_phone,
    row?.phone2,
    row?.alternate_mobile,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s) return s;
  }
  return '';
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "paid":
      return "bg-green-100 text-green-800";
    case "hold":
      return "bg-orange-100 text-orange-800";
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "overdue":
      return "bg-red-100 text-red-800";
    case "refunded":
      return "bg-blue-100 text-blue-800";
    case "cancelled":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

const getStatusIcon = (status: string) => {
  switch (status) {
    case "paid":
      return <CheckCircle className="h-4 w-4 text-green-600" />;
    case "hold":
      return <Pause className="h-4 w-4 text-orange-600" />;
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-600" />;
    case "overdue":
      return <XCircle className="h-4 w-4 text-red-600" />;
    case "refunded":
      return <RefreshCw className="h-4 w-4 text-blue-600" />;
    case "cancelled":
      return <XCircle className="h-4 w-4 text-rose-600" />;
    default:
      return <Receipt className="h-4 w-4 text-gray-600" />;
  }
};

const DEFAULT_WHATSAPP_TEMPLATE = `Dear {customer},

Thank you for choosing *{business}* for your beauty and wellness needs!

*Invoice Details:*
Invoice No: {invoiceId}
Date: {date}
Time: {time}
Total Amount: {amount}{serviceDetails}{billSummary}

We hope you enjoyed our services and look forward to serving you again soon.

For any queries or to book your next appointment, please feel free to contact us.

Best regards,
*{business}* Team{businessPhoneLine}`;

export default function Billing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [serverInvoices, setServerInvoices] = useState<any[]>([]);
  const [lineItemsByInvoice, setLineItemsByInvoice] = useState<Record<string, any[]>>({});
  const [lineItemsLoading, setLineItemsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const invoicesFetchSeqRef = useRef(0);
  const lineItemsFetchSeqRef = useRef(0);
  const [empMap, setEmpMap] = useState<Record<string, string>>({});
  const [custMap, setCustMap] = useState<Record<string, string>>({});
  const [custPhoneMap, setCustPhoneMap] = useState<Record<string, string>>({});
  const [custIdPhoneMap, setCustIdPhoneMap] = useState<Record<string, string>>({});
  // Company profile from settings (retail_master)
  const [company, setCompany] = useState<{ name?: string; address?: string; phone?: string; email?: string; gstin?: string }>({});

  // retail_master row (for updates like manual_whatsappmessage)
  const [retailMasterRow, setRetailMasterRow] = useState<any | null>(null);
  const [manualWhatsAppMessage, setManualWhatsAppMessage] = useState<string>("");

  // WhatsApp message editor dialog
  const [whatsAppMessageDialogOpen, setWhatsAppMessageDialogOpen] = useState(false);
  const [whatsAppMessageDraft, setWhatsAppMessageDraft] = useState<string>("");
  const [whatsAppMessageSaving, setWhatsAppMessageSaving] = useState(false);
  
  // Date range filters - similar to hal-booking page, defaulting to today
  const [fromDate, setFromDate] = useState<Date | undefined>(new Date());
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [rangePreset, setRangePreset] = useState<string>('today');

  // Normalize manual date selection so API/reporting always sees a valid range.
  // If user picks From after To, swap them for querying.
  const normalizedDateRange = useMemo(() => {
    if (!fromDate && !toDate) return { from: undefined, to: undefined } as { from?: Date; to?: Date };
    if (fromDate && !toDate) return { from: fromDate, to: fromDate } as { from: Date; to: Date };
    if (!fromDate && toDate) return { from: toDate, to: toDate } as { from: Date; to: Date };
    const f = fromDate as Date;
    const t = toDate as Date;
    return f.getTime() <= t.getTime() ? { from: f, to: t } : { from: t, to: f };
  }, [fromDate, toDate]);

  const queryFromDate = normalizedDateRange.from;
  const queryToDate = normalizedDateRange.to;
  
  // Search and filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [customerFilterOpen, setCustomerFilterOpen] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [employeeFilterOpen, setEmployeeFilterOpen] = useState(false);
  const [restrictStaff, setRestrictStaff] = useState(true);
  
  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rowsAll, setRowsAll] = useState(false);
  
  // Sorting
  const [sortBy, setSortBy] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  
  // Dashboard toggle
  const [showDashboard, setShowDashboard] = useState(true);

  // Invoice detail dialog state
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [invoiceDetail, setInvoiceDetail] = useState<any | null>(null);

  // Cancel / Revert-cancel confirmation popup
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmInvoice, setCancelConfirmInvoice] = useState<any | null>(null);
  const [cancelConfirmMode, setCancelConfirmMode] = useState<'cancel' | 'revert'>('cancel');
  const [cancelConfirmSubmitting, setCancelConfirmSubmitting] = useState(false);

  // Customer credit payment UI
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [creditCustomers, setCreditCustomers] = useState<CustomerCreditRow[]>([]);
  const [creditCustomersLoading, setCreditCustomersLoading] = useState(false);

  const openTallyPrint = (invoiceId: string, docType: 'tax' | 'proforma' = 'tax') => {
    const suffix = docType === 'proforma' ? '?doc=proforma' : '';
    const url = `/billing/print/${encodeURIComponent(String(invoiceId || '').trim())}${suffix}`;
    const w = window.open(url, '_blank');
    if (w) {
      try {
        (w as any).opener = null;
      } catch {
        // ignore
      }
      return;
    }
    toast({
      title: 'Popup blocked',
      description: 'Please allow popups to open invoice print page.',
      variant: 'destructive',
    });
  };
  const [creditCustomersError, setCreditCustomersError] = useState<string | null>(null);
  const [payCreditDialogOpen, setPayCreditDialogOpen] = useState(false);
  const [payCreditCustomer, setPayCreditCustomer] = useState<CustomerCreditRow | null>(null);
  const [payCreditAmount, setPayCreditAmount] = useState<number>(0);
  const [payCreditMode, setPayCreditMode] = useState<string>('Cash');
  const [payCreditSubmitting, setPayCreditSubmitting] = useState(false);

  const creditTotals = useMemo(() => {
    const count = creditCustomers.length;
    const total = creditCustomers.reduce((sum, c) => sum + (Number(c.credit) || 0), 0);
    return { count, total };
  }, [creditCustomers]);

  const fetchCustomersWithCredit = async () => {
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      setCreditCustomers([]);
      setCreditCustomersError('Missing account/retail context.');
      return;
    }
    setCreditCustomersLoading(true);
    setCreditCustomersError(null);
    try {
      const rows = await CustomerService.getCustomers(String(acc), String(ret));
      const normalized: CustomerCreditRow[] = (Array.isArray(rows) ? rows : [])
        .map((r: any) => {
          const id = String(r?.customer_id ?? r?.CUSTOMER_ID ?? r?.id ?? '').trim();
          const name = String(r?.customer_name ?? r?.Customer_name ?? r?.name ?? r?.full_name ?? '').trim();
          const phone = pickPhone(r);
          const credit = Number(r?.customer_credit ?? r?.CUSTOMER_CREDIT ?? r?.credit ?? r?.credit_amount ?? 0) || 0;
          return { id, name: name || 'Customer', phone: phone || '-', credit, raw: r };
        })
        .filter((c) => c.id && (Number(c.credit) || 0) > 0)
        .sort((a, b) => (b.credit || 0) - (a.credit || 0));
      setCreditCustomers(normalized);
    } catch (e: any) {
      console.error('Failed to load customers with credit', e);
      setCreditCustomers([]);
      setCreditCustomersError('Failed to load customers.');
    } finally {
      setCreditCustomersLoading(false);
    }
  };

  const openPayCredit = (c: CustomerCreditRow) => {
    setPayCreditCustomer(c);
    setPayCreditAmount(Math.max(0, Number(c.credit) || 0));
    setPayCreditMode('Cash');
    setPayCreditDialogOpen(true);
  };

  const submitPayCustomerCredit = async () => {
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      toast({ title: 'Missing context', description: 'Account/Retail code not found.', variant: 'destructive' });
      return;
    }
    if (!payCreditCustomer?.id) {
      toast({ title: 'Select a customer', description: 'Please select a customer to pay credit.', variant: 'destructive' });
      return;
    }
    const custIdNum = Number(payCreditCustomer.id);
    if (!Number.isFinite(custIdNum) || custIdNum <= 0) {
      toast({ title: 'Invalid customer', description: 'Customer ID is invalid.', variant: 'destructive' });
      return;
    }

    const pending = Number(payCreditCustomer.credit) || 0;
    const amt = Number(payCreditAmount) || 0;
    if (amt <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a valid amount.', variant: 'destructive' });
      return;
    }
    if (amt > pending) {
      toast({ title: 'Too much', description: 'Amount cannot exceed pending credit.', variant: 'destructive' });
      return;
    }

    setPayCreditSubmitting(true);
    try {
      const payload = {
        customer_id: custIdNum,
        amount: amt,
        payment_mode: payCreditMode,
        account_code: String(acc),
        retail_code: String(ret),
        notes: `Credit payment via ${payCreditMode}`,
      };
      await ApiService.post('/api/customer-wallet-payment', payload);
      toast({ title: 'Success', description: `Credit payment of ₹${amt.toLocaleString('en-IN')} recorded.` });
      setPayCreditDialogOpen(false);
      setPayCreditCustomer(null);
      // Refresh the list so balances update
      await fetchCustomersWithCredit();
    } catch (e) {
      console.error('Customer credit payment failed', e);
      toast({ title: 'Payment failed', description: 'Could not record credit payment.', variant: 'destructive' });
    } finally {
      setPayCreditSubmitting(false);
    }
  };

  // Print options dialog state
  const [printOptionsOpen, setPrintOptionsOpen] = useState(false);
  const [selectedPrinterType, setSelectedPrinterType] = useState<'auto' | 'thermal' | 'standard' | 'a4'>('auto');
  const [pendingPrintInvoiceId, setPendingPrintInvoiceId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Preview dialog state
  const [previewDialogOpen, setPreviewDialogOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState<string>('');
  const [previewInvoiceId, setPreviewInvoiceId] = useState<string | null>(null);
  const [previewDocumentTitle, setPreviewDocumentTitle] = useState<string>('');

  const whatsappWindowRef = useRef<Window | null>(null);

  const renderReceiptPngBlob = async (invoiceId: string, acc: string, ret: string) => {
    const paperWidthMm = 72;
    const previewHtml = await generateInvoicePreview(invoiceId, acc, ret, paperWidthMm);
    const { default: html2canvas } = await import('html2canvas');

    let host: HTMLDivElement | null = document.createElement('div');
    try {
      host.style.position = 'fixed';
      host.style.left = '-10000px';
      host.style.top = '0';
      host.style.background = 'white';
      host.style.width = `${paperWidthMm}mm`;
      host.style.padding = '0';
      host.style.margin = '0';
      host.style.opacity = '0';
      host.style.pointerEvents = 'none';
      host.innerHTML = previewHtml;
      document.body.appendChild(host);

      const receiptEl = (host.firstElementChild as HTMLElement) || host;
      receiptEl.style.margin = '0';
      receiptEl.style.boxShadow = 'none';

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const canvas = await html2canvas(receiptEl, {
        backgroundColor: '#ffffff',
        scale: 3,
        useCORS: true,
      });

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b);
          else reject(new Error('Failed to create image blob'));
        }, 'image/png');
      });

      return blob;
    } finally {
      if (host?.parentNode) host.parentNode.removeChild(host);
      host = null;
    }
  };

  const copyPngBlobToClipboard = async (blob: Blob) => {
    const ClipboardItemCtor = (window as any)?.ClipboardItem;
    if (!ClipboardItemCtor || !navigator.clipboard?.write) {
      throw new Error('Clipboard image copy not supported');
    }
    await navigator.clipboard.write([new ClipboardItemCtor({ 'image/png': blob })]);
  };

  const copyPngPromiseToClipboard = async (blobPromise: Promise<Blob>) => {
    const ClipboardItemCtor = (window as any)?.ClipboardItem;
    if (!ClipboardItemCtor || !navigator.clipboard?.write) {
      throw new Error('Clipboard image copy not supported');
    }
    // Important: call clipboard.write immediately (while user activation is present)
    // and let the promise resolve later.
    await navigator.clipboard.write([
      new ClipboardItemCtor({
        'image/png': blobPromise,
      }),
    ]);
  };

  const fillWhatsAppTemplate = (template: string, values: Record<string, string>) => {
    return template.replace(/\{(\w+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : m));
  };

  const openWhatsAppMessageEditor = () => {
    const existing = String(manualWhatsAppMessage || '').trim();
    setWhatsAppMessageDraft(existing ? existing : DEFAULT_WHATSAPP_TEMPLATE);
    setWhatsAppMessageDialogOpen(true);
  };

  const saveWhatsAppMessageTemplate = async () => {
    if (!user?.account_code || !user?.retail_code) {
      toast({ title: 'Missing context', description: 'Account/Retail not found.', variant: 'destructive' });
      return;
    }

    try {
      setWhatsAppMessageSaving(true);
      const acc = user.account_code;
      const ret = user.retail_code;

      let pk = retailMasterRow?.Id ?? retailMasterRow?.id ?? retailMasterRow?.ID;
      if (!pk) {
        try {
          const res: any = await DataService.readData(['retail_master'], acc, ret);
          const d = res?.data;
          const rows = Array.isArray(d) ? d : (d?.retail_master || d?.RetailMaster || d || []);
          const first = Array.isArray(rows) ? rows[0] : rows;
          pk = first?.Id ?? first?.id ?? first?.ID;
          if (first) setRetailMasterRow(first);
        } catch {}
      }
      if (!pk) {
        toast({ title: 'Save failed', description: 'Primary key Id not found for retail_master.', variant: 'destructive' });
        return;
      }

      const trimmed = String(whatsAppMessageDraft || '').trim();
      const payload: any = {
        Id: pk,
        account_code: acc,
        retail_code: ret,
        manual_whatsappmessage: trimmed ? trimmed : null,
      };

      const resp: any = await DataService.updateData('retail_master', payload);
      if (resp?.success) {
        setManualWhatsAppMessage(trimmed);
        toast({ title: 'Saved', description: trimmed ? 'WhatsApp message updated.' : 'Cleared. Default message will be used.' });
        setWhatsAppMessageDialogOpen(false);
      } else {
        toast({ title: 'Save failed', description: resp?.message || 'Could not save message.', variant: 'destructive' });
      }
    } catch (e: any) {
      console.error('Failed to update manual_whatsappmessage:', e);
      toast({ title: 'Save error', description: e?.message || String(e), variant: 'destructive' });
    } finally {
      setWhatsAppMessageSaving(false);
    }
  };

  // Helper: open WhatsApp with prefilled invoice message
  const sendWhatsApp = async (invoice: { id: string; customer: string; total: number; date: Date; customerPhone?: string }) => {
    try {
      // Prevent if user context not ready when we need details
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      let phone = "";
      const pickDigits = (v:any) => String(v || "").replace(/\D+/g, "");

      // 1) Prefer phone bundled in the processed invoice if present
      if ((invoice as any).customerPhone) {
        const d = String((invoice as any).customerPhone).replace(/\D+/g, '');
        if (d) phone = d.length > 10 ? d.slice(-10) : d;
      }

      // 2) Try to get phone from the raw server invoice first
      const raw = serverInvoices.find((iv:any) => String(iv?.invoice_id) === String(invoice.id));
      if (raw) {
        const candidates = [
          raw.txn_customer_mobile,
          raw.txn_customer_number,
          raw.customer_number,
          raw.customer_phone,
          raw.CUSTOMER_PHONE,
          raw.CLIENT_PHONE,
          raw.client_phone,
          raw.phone,
          raw.mobile,
        ];
        for (const c of candidates) {
          const d = pickDigits(c);
          if (d) { phone = d.length > 10 ? d.slice(-10) : d; break; }
        }
      }

  // 3) Fallback: fetch invoice header to read phone
      if (!phone && acc && ret) {
        try {
          const resp: any = await InvoiceService.get(invoice.id, acc, ret);
          const header = resp?.header || {}; const lines = resp?.data || [];
          const candidates = [
            header.txn_customer_mobile,
            header.txn_customer_number,
            header.customer_number,
            header.customer_phone,
            header.CUSTOMER_PHONE,
            lines?.[0]?.txn_customer_mobile,
            lines?.[0]?.txn_customer_number,
            lines?.[0]?.customer_number,
            lines?.[0]?.customer_phone,
            lines?.[0]?.CLIENT_PHONE,
            lines?.[0]?.client_phone,
            lines?.[0]?.phone,
            lines?.[0]?.mobile,
          ];
          for (const c of candidates) {
            const d = pickDigits(c);
            if (d) { phone = d.length > 10 ? d.slice(-10) : d; break; }
          }
        } catch {}
      }

      if (!phone) {
        toast({ title: "Phone not found", description: "Customer mobile number is missing for this invoice.", variant: "destructive" });
        return;
      }

      // Get service details and tax information for professional message
      let serviceDetails = "";
      let taxInfo = "";
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        if (acc && ret) {
          const resp: any = await InvoiceService.get(invoice.id, acc, ret);
          if (resp?.success && resp?.data) {
            const services = resp.data.map((item: any) => 
              `• ${item.service_name || 'Service'} - ₹${Number(item.unit_price || 0).toLocaleString('en-IN')}`
            ).join('\n');
            serviceDetails = services ? `\n\n*Services Availed:*\n${services}` : "";
            
            // Calculate tax information
            const subtotal = resp.data.reduce((sum: number, item: any) => sum + ((item.unit_price || 0) * (item.qty || 1)), 0);
            const totalTax = resp.data.reduce((sum: number, item: any) => sum + (item.tax_amount || 0), 0);
            const discount = resp.data.reduce((sum: number, item: any) => sum + (item.discount_amount || 0), 0);
            
            if (subtotal > 0 || totalTax > 0 || discount > 0) {
              taxInfo = `\n\n*Bill Summary:*\nSubtotal: ₹${subtotal.toLocaleString('en-IN')}`;
              if (discount > 0) {
                taxInfo += `\nDiscount: ₹${discount.toLocaleString('en-IN')}`;
              }
              if (totalTax > 0) {
                taxInfo += `\nTotal Tax: ₹${totalTax.toLocaleString('en-IN')}`;
              }
            }
          }
        }
      } catch (err) {
        // If service fetch fails, continue without service details
      }

      // Build WhatsApp deep link
      // Accept 7-15 digits; if exactly 10 digits, assume India (+91)
      const dial = phone.length === 10 ? `91${phone}` : phone;
      const business = (company?.name || (user as any)?.business_name || "Our Salon");
      const dateStr = format(invoice.date, "dd-MM-yyyy");
      const timeStr = format(invoice.date, "hh:mm:ss a");
      const roundedAmount = Math.round(Number(invoice.total || 0));
      const amountStr = `₹${roundedAmount.toLocaleString('en-IN')}`;
      const businessPhoneLine = company?.phone ? `\nPhone: ${company.phone}` : '';
      
      // Professional WhatsApp message with service details and tax info
      const defaultMessage = `Dear ${invoice.customer},

Thank you for choosing *${business}* for your beauty and wellness needs!

*Invoice Details:*
Invoice No: ${invoice.id}
Date: ${dateStr}
Time: ${timeStr}
Total Amount: ${amountStr}${serviceDetails}${taxInfo}

We hope you enjoyed our services and look forward to serving you again soon.

For any queries or to book your next appointment, please feel free to contact us.

Best regards,
*${business}* Team
${company?.phone ? `Phone: ${company.phone}` : ''}`;

      const template = String(manualWhatsAppMessage || '').trim();
      const message = template
        ? fillWhatsAppTemplate(template, {
            customer: invoice.customer,
            business,
            invoiceId: String(invoice.id),
            date: dateStr,
            time: timeStr,
            amount: amountStr,
            serviceDetails: serviceDetails || '',
            billSummary: taxInfo || '',
            businessPhoneLine,
          })
        : defaultMessage;

      const encoded = encodeURIComponent(message);
      const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      // Desktop should open WhatsApp Web directly.
      // Mobile can use wa.me (opens app or WhatsApp web depending on device).
      const url = isMobile
        ? `https://wa.me/${dial}?text=${encoded}`
        : `https://web.whatsapp.com/send?phone=${dial}&text=${encoded}`;

      // Reuse the same tab/window instead of creating many new tabs.
      // Open the window immediately (user gesture) to avoid popup blockers.
      let w = whatsappWindowRef.current;
      if (!w || w.closed) {
        w = window.open('', 'whatsapp_share', 'width=900,height=700,scrollbars=yes,resizable=yes');
        whatsappWindowRef.current = w;
      }
      if (!w) {
        toast({
          title: 'Popup blocked',
          description: 'Please allow popups to open WhatsApp Web.',
          variant: 'destructive',
        });
        return;
      }

      // WhatsApp Web cannot auto-attach files via URL. Best-effort workaround:
      // prepare a receipt image and copy to clipboard so user can paste (Ctrl+V) into chat.
      // Do the clipboard write inline within this click flow (more likely to be allowed).
      if (!isMobile && acc && ret) {
        try {
          if (!window.isSecureContext) {
            toast({
              title: 'Clipboard blocked',
              description: 'Receipt copy needs a secure context. Use https or localhost.',
              variant: 'destructive',
              duration: 8000,
            });
          }

          // Start rendering, but write to clipboard immediately using a promise-based ClipboardItem.
          const blobPromise = renderReceiptPngBlob(String(invoice.id), String(acc), String(ret));
          await copyPngPromiseToClipboard(blobPromise);
          toast({
            title: 'Receipt copied',
            description: 'Now paste (Ctrl+V) in WhatsApp and send.',
            duration: 8000,
          });
        } catch (e) {
          console.warn('Auto copy failed; falling back to manual Copy Receipt action', e);

          // Render blob and provide a manual Copy button as fallback.
          try {
            const fallbackBlob = await renderReceiptPngBlob(String(invoice.id), String(acc), String(ret));
            toast({
              title: 'Receipt ready',
              description: 'Click Copy Receipt, then paste (Ctrl+V) in WhatsApp and send.',
              variant: 'warning',
              duration: 15000,
              action: (
                <ToastAction
                  altText="Copy receipt"
                  onClick={async () => {
                    try {
                      await copyPngBlobToClipboard(fallbackBlob);
                      toast({ title: 'Copied', description: 'Now paste (Ctrl+V) in WhatsApp.' });
                    } catch (err) {
                      console.error('Clipboard copy failed', err);
                      toast({
                        title: 'Copy failed',
                        description: 'Clipboard blocked. Please use Download PDF and attach manually in WhatsApp.',
                        variant: 'destructive',
                        duration: 8000,
                      });
                    }
                  }}
                >
                  Copy Receipt
                </ToastAction>
              ),
            });
          } catch (prepErr) {
            console.error('Receipt preparation failed', prepErr);
            toast({
              title: 'Receipt not attached',
              description: 'Could not prepare receipt image. Please use Download PDF and attach manually in WhatsApp.',
              variant: 'destructive',
              duration: 8000,
            });
          }
        }
      }

      // Navigate after receipt attempt (keeps clipboard call closer to user gesture).
      w.location.replace(url);
      w.focus();
    } catch (e) {
      console.error("WhatsApp share failed", e);
      toast({ title: "Share failed", description: "Couldn't open WhatsApp.", variant: "destructive" });
    }
  };

  const downloadInvoicePdf = async (invoiceId: string) => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      toast({ title: 'Missing context', description: 'Account/Retail not found.', variant: 'destructive' });
      return;
    }

    try {
      // Preferred: render the exact same HTML used in Invoice Preview, then save as PDF with padding.
      // This guarantees the download looks the same as the preview.
      try {
        // 3-inch receipt width
        const paperWidthMm = 72;
        const padMm = 4;
        const previewHtml = await generateInvoicePreview(invoiceId, acc, ret, paperWidthMm);

        const { default: html2canvas } = await import('html2canvas');
        let host: HTMLDivElement | null = document.createElement('div');
        try {
          host.style.position = 'fixed';
          host.style.left = '-10000px';
          host.style.top = '0';
          host.style.background = 'white';
          host.style.width = `${paperWidthMm}mm`;
          host.style.padding = '0';
          host.style.margin = '0';
          host.style.opacity = '0';
          host.style.pointerEvents = 'none';
          host.innerHTML = previewHtml;
          document.body.appendChild(host);

          const receiptEl = (host.firstElementChild as HTMLElement) || host;
          // Avoid centering/margins affecting captured layout
          receiptEl.style.margin = '0';
          receiptEl.style.boxShadow = 'none';

          // Let the browser lay out the offscreen DOM before capturing
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

          const canvas = await html2canvas(receiptEl, {
            backgroundColor: '#ffffff',
            scale: 3,
            useCORS: true,
          });
          const imgData = canvas.toDataURL('image/png');

          const imgWidthMm = Math.max(10, paperWidthMm - padMm * 2);
          const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
          const doc = new jsPDF({ unit: 'mm', format: [paperWidthMm, imgHeightMm + padMm * 2] });
          doc.addImage(imgData, 'PNG', padMm, padMm, imgWidthMm, imgHeightMm);
          doc.save(`invoice-${String(invoiceId).replace(/[^a-zA-Z0-9_-]+/g, '') || 'download'}.pdf`);
          return;
        } finally {
          if (host?.parentNode) host.parentNode.removeChild(host);
          host = null;
        }
      } catch (renderErr) {
        console.warn('HTML->PDF render failed, falling back to text PDF:', renderErr);
        toast({
          title: 'Using basic PDF',
          description: 'Preview-style PDF render failed. Downloading basic receipt format.',
        });
      }

      const resp: any = await InvoiceService.get(invoiceId, acc, ret);
      if (!resp?.success) throw new Error('Failed to fetch invoice');

      const header = (resp as any)?.header || {};
      const servicesArr = Array.isArray((resp as any).services) ? (resp as any).services : (Array.isArray(resp?.data) ? resp.data : []);
      const packagesArr = Array.isArray((resp as any).packages) ? (resp as any).packages : [];
      const inventoryArr = Array.isArray((resp as any).inventory) ? (resp as any).inventory : [];
      const allItems: any[] = [...servicesArr, ...packagesArr, ...inventoryArr];

      const invoiceFromList = sourceInvoices.find((inv: any) => String(inv.id) === String(invoiceId));
      const customerName = String(
        invoiceFromList?.customer || header?.txn_customer_name || header?.customer_name || header?.customer || 'Customer'
      ).trim() || 'Customer';
      const customerPhone = String(invoiceFromList?.customerPhone || header?.txn_customer_mobile || header?.customer_phone || '').trim();

      const staffFromHeader = String(header?.employee_name || header?.txn_employee_name || '').trim();
      const staffFromList = String(invoiceFromList?.staff || '').trim();
      // Prefer header staff (preview uses header/service rows first)
      const staffName = staffFromHeader || staffFromList;

      // 3-inch receipt width
      const paperWidthMm = 72;
      const sidePaddingMm = 4;
      const widthChars = paperWidthMm <= 60 ? 32 : paperWidthMm <= 75 ? 42 : 48;
      const separator = '-'.repeat(widthChars);

      const wrapByChars = (text: string, max: number): string[] => {
        const raw = String(text || '').replace(/\s+/g, ' ').trim();
        if (!raw) return [];
        const words = raw.split(' ');
        const out: string[] = [];
        let line = '';
        for (const w of words) {
          if (!line) {
            if (w.length <= max) {
              line = w;
              continue;
            }
            // hard split long word
            for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max));
            line = '';
            continue;
          }
          if ((line + ' ' + w).length <= max) {
            line += ' ' + w;
          } else {
            out.push(line);
            if (w.length <= max) {
              line = w;
            } else {
              for (let i = 0; i < w.length; i += max) out.push(w.slice(i, i + max));
              line = '';
            }
          }
        }
        if (line) out.push(line);
        return out;
      };

      const formatLine = (left: string, right: string, max: number): string[] => {
        const l = String(left || '');
        const r = String(right || '');
        if (!r) return wrapByChars(l, max);
        if (l.length + 1 + r.length <= max) {
          const spaces = Math.max(1, max - l.length - r.length);
          return [l + ' '.repeat(spaces) + r];
        }
        // If it doesn't fit, split into two lines
        const lines: string[] = [];
        lines.push(...wrapByChars(l, max));
        lines.push(r);
        return lines;
      };

      const itemNameOf = (item: any): string =>
        String(
          item?.service_name ||
            item?.package_name ||
            item?.product_name ||
            item?.item_name ||
            item?.name ||
            'Item'
        ).trim() || 'Item';

      const itemQtyOf = (item: any): number => Number(item?.quantity ?? item?.qty ?? 1) || 1;
      const itemRateOf = (item: any): number => Number(item?.unit_price ?? item?.price ?? item?.rate ?? 0) || 0;
      const itemTaxOf = (item: any): number =>
        Number(
          item?.tax_amount ??
            item?.total_tax ??
            item?.gst_amount ??
            ((Number(item?.cgst_amount) || 0) + (Number(item?.sgst_amount) || 0) + (Number(item?.igst_amount) || 0))
        ) || 0;
      const itemGrossOf = (item: any): number => {
        const q = itemQtyOf(item);
        const r = itemRateOf(item);
        const explicit = Number(item?.item_total ?? item?.grand_total ?? item?.total ?? item?.amount ?? item?.line_total);
        if (Number.isFinite(explicit) && explicit > 0) return explicit;
        return q * r;
      };

      // Totals (subtotal excludes tax)
      let subtotal = 0;
      let totalTax = 0;
      let discount = 0;
      allItems.forEach((item: any) => {
        const gross = itemGrossOf(item);
        const tax = itemTaxOf(item);
        subtotal += Math.max(0, gross - tax);
        totalTax += tax;
        discount += Number(item?.discount_amount || item?.discount || 0) || 0;
      });
      if (subtotal === 0) {
        allItems.forEach((item: any) => {
          subtotal += itemQtyOf(item) * itemRateOf(item);
        });
      }
      const total = subtotal + totalTax - discount;
      const roundedTotal = Math.round(total);

      const issuedAt = invoiceFromList?.date ? new Date(invoiceFromList.date) : new Date(header?.created_at || new Date());

      type ReceiptLine = { text: string; align?: 'left' | 'center' | 'right' };
      const lines: ReceiptLine[] = [];
      const push = (text: string, align: ReceiptLine['align'] = 'left') => {
        lines.push({ text, align });
      };
      const pushWrapped = (text: string, align: ReceiptLine['align'] = 'left') => {
        wrapByChars(text, widthChars).forEach((t) => push(t, align));
      };

      // Header (center)
      pushWrapped(String(company?.name || 'Salon').trim(), 'center');
      if (company?.address) {
        String(company.address)
          .split(/\r?\n/)
          .flatMap((l) => wrapByChars(l, widthChars))
          .forEach((l) => push(l, 'center'));
      }
      if (company?.phone) pushWrapped(`Ph: ${String(company.phone).trim()}`, 'center');
      if (company?.gstin) pushWrapped(`GSTIN: ${String(company.gstin).trim()}`, 'center');
      push(separator, 'center');

      // Invoice lines
      formatLine(`Invoice: ${invoiceId}`, format(issuedAt, 'dd/MM/yyyy'), widthChars).forEach((t) => push(t));
      push(`Time: ${format(issuedAt, 'hh:mm a')}`);
      pushWrapped(`Customer: ${customerName}`);
      if (customerPhone) push(`Phone: ${customerPhone}`);
      if (staffName) pushWrapped(`Staff: ${staffName}`);
      push(separator, 'center');

      // Items
      allItems.forEach((item: any) => {
        const name = itemNameOf(item);
        const qty = itemQtyOf(item);
        const gross = itemGrossOf(item);
        const tax = itemTaxOf(item);
        const base = Math.max(0, gross - tax);
        const unit = qty > 0 ? base / qty : itemRateOf(item);
        pushWrapped(name);
        const left = `${qty} x ₹${unit.toFixed(2)}`;
        const right = `₹${base.toFixed(2)}`;
        formatLine(left, right, widthChars).forEach((t) => push(t));
      });
      push(separator, 'center');

      // Totals
      formatLine('Subtotal:', `₹${subtotal.toFixed(2)}`, widthChars).forEach((t) => push(t));
      if (discount > 0) formatLine('Discount:', `-₹${discount.toFixed(2)}`, widthChars).forEach((t) => push(t));
      if (totalTax > 0) formatLine('Tax:', `₹${totalTax.toFixed(2)}`, widthChars).forEach((t) => push(t));
      push(separator, 'center');
      formatLine('Total:', `₹${roundedTotal}`, widthChars).forEach((t) => push(t));
      push('');
      push('Thank you for visiting!', 'center');
      push('Please visit again', 'center');

      // Match preview footer
      push('');
      push(separator, 'center');
      push('Powered by GYM Pro', 'center');

      // Compute dynamic height
      const marginTopMm = 6;
      const marginBottomMm = 6;
      // Keep a roomier line height so separator rows never overlap text.
      const lineHeightMm = 6.2;
      const separatorExtraGapMm = 1.2;
      const separatorCount = lines.reduce((n, ln) => n + (ln.text === separator ? 1 : 0), 0);
      const heightMm = Math.max(
        90,
        marginTopMm + marginBottomMm + lines.length * lineHeightMm + separatorCount * separatorExtraGapMm
      );

      const doc = new jsPDF({ unit: 'mm', format: [paperWidthMm, heightMm] });
      doc.setFont('courier', 'bold');
      doc.setFontSize(11);

      let yMm = marginTopMm;
      const xLeft = sidePaddingMm;
      const xMid = paperWidthMm / 2;
      const xRight = paperWidthMm - sidePaddingMm;

      lines.forEach((ln) => {
        const t = ln.text ?? '';
        const align = ln.align || 'left';
        // Draw separator lines in normal weight so they don't visually merge into text rows.
        if (t === separator) doc.setFont('courier', 'normal');
        else doc.setFont('courier', 'bold');
        if (align === 'center') doc.text(t, xMid, yMm, { align: 'center' });
        else if (align === 'right') doc.text(t, xRight, yMm, { align: 'right' });
        else doc.text(t, xLeft, yMm, { align: 'left' });
        yMm += lineHeightMm;
        if (t === separator) yMm += separatorExtraGapMm;
      });

      doc.save(`invoice-${String(invoiceId).replace(/[^a-zA-Z0-9_-]+/g, '') || 'download'}.pdf`);
    } catch (e: any) {
      console.error('PDF download failed:', e);
      toast({
        title: 'Download failed',
        description: e?.message || 'Could not generate PDF.',
        variant: 'destructive',
      });
    }
  };

  // ---------- Reports helpers ----------
  const reportDateRange = useMemo(() => {
    if (queryFromDate && queryToDate) {
      return { from: queryFromDate, to: queryToDate } as { from: Date; to: Date };
    }
    const today = new Date();
    return { from: today, to: today };
  }, [queryFromDate, queryToDate]);

  const reportRange = useMemo(() => {
    const start = new Date(reportDateRange.from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(reportDateRange.to);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }, [reportDateRange]);

  const getReportFilteredInvoices = () => {
    // "Filtered" in exports should respect search/status AND the chosen date range
    return displayInvoices.filter((iv) => iv.date >= reportRange.start && iv.date <= reportRange.end);
  };

  const getReportRevenueInvoices = () => {
    // Sales/tax summaries should not include Hold bills
    return getReportFilteredInvoices().filter((iv) => iv.status !== 'hold');
  };

  const exportInvoiceListExcel = () => {
    const rows = getReportFilteredInvoices().map((iv) => ({
      date: iv.date,
      invoice_id: iv.id,
      customer: iv.customer,
      staff: iv.staff || "",
      amount: iv.total,
      status: iv.status,
    }));
    exportData("excel", {
      filename: `invoice-list-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Invoice List",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Invoice ID", dataKey: "invoice_id", width: 16 },
        { header: "Customer", dataKey: "customer", width: 24 },
        { header: "Staff", dataKey: "staff", width: 18 },
        { header: "Amount", dataKey: "amount", width: 12 },
        { header: "Status", dataKey: "status", width: 12 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportSalesSummaryByDay = () => {
    const map = new Map<string, { date: Date; qty: number; amount: number }>();
    getReportRevenueInvoices().forEach((iv) => {
      const key = format(iv.date, "yyyy-MM-dd");
      if (!map.has(key)) {
        map.set(key, { date: new Date(iv.date), qty: 0, amount: 0 });
      }
      const rec = map.get(key)!;
      rec.qty += 1;
      rec.amount += Number(iv.total) || 0;
    });
    const rows = Array.from(map.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    exportData("excel", {
      filename: `sales-summary-daily-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Sales Summary (Daily)",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Invoices", dataKey: "qty", width: 12 },
        { header: "Total Amount", dataKey: "amount", width: 14 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportCustomerSales = () => {
    const map = new Map<string, { customer: string; invoices: number; amount: number }>();
    getReportRevenueInvoices().forEach((iv) => {
      const key = iv.customer || "Customer";
      if (!map.has(key)) map.set(key, { customer: key, invoices: 0, amount: 0 });
      const rec = map.get(key)!;
      rec.invoices += 1;
      rec.amount += Number(iv.total) || 0;
    });
    const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    exportData("excel", {
      filename: `customer-sales-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Customer Sales",
      columns: [
        { header: "Customer", dataKey: "customer", width: 28 },
        { header: "Invoices", dataKey: "invoices", width: 12 },
        { header: "Total Amount", dataKey: "amount", width: 14 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportStaffSales = () => {
    const map = new Map<string, { staff: string; invoices: number; amount: number }>();
    getReportRevenueInvoices().forEach((iv) => {
      const key = iv.staff || "";
      const name = key || "Unassigned";
      if (!map.has(name)) map.set(name, { staff: name, invoices: 0, amount: 0 });
      const rec = map.get(name)!;
      rec.invoices += 1;
      rec.amount += Number(iv.total) || 0;
    });
    const rows = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    exportData("excel", {
      filename: `staff-sales-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Staff Sales",
      columns: [
        { header: "Staff", dataKey: "staff", width: 24 },
        { header: "Invoices", dataKey: "invoices", width: 12 },
        { header: "Total Amount", dataKey: "amount", width: 14 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportPendingPayments = () => {
    // In this billing screen, the only non-paid status is "hold".
    // Treat hold bills as pending payments for reporting.
    const rows = getReportFilteredInvoices()
      .filter((iv) => iv.status === "hold" || iv.status === "pending" || iv.status === "overdue")
      .map((iv) => ({
        date: iv.date,
        invoice_id: iv.id,
        customer: iv.customer,
        amount_due: iv.total,
        status: iv.status,
      }));

    exportData("excel", {
      filename: `pending-payments-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Pending Payments",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Invoice ID", dataKey: "invoice_id", width: 16 },
        { header: "Customer", dataKey: "customer", width: 24 },
        { header: "Amount Due", dataKey: "amount_due", width: 14 },
        { header: "Status", dataKey: "status", width: 12 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  const exportTaxSummary = () => {
    const rows = getReportRevenueInvoices().map((iv) => ({
      date: iv.date,
      invoice_id: iv.id,
      taxable_amount: Math.max(0, (iv.subtotal || 0) - (iv.discount || 0)),
      tax_amount: iv.tax || 0,
      total_amount: iv.total || 0,
    }));

    exportData("excel", {
      filename: `tax-summary-${format(reportDateRange.from, "yyyyMMdd")}-${format(reportDateRange.to, "yyyyMMdd")}`,
      title: "Tax Summary",
      columns: [
        { header: "Date", dataKey: "date", width: 14 },
        { header: "Invoice ID", dataKey: "invoice_id", width: 16 },
        { header: "Taxable Amount", dataKey: "taxable_amount", width: 16 },
        { header: "Tax", dataKey: "tax_amount", width: 12 },
        { header: "Invoice Total", dataKey: "total_amount", width: 14 },
      ],
      data: rows,
      dateRange: reportDateRange,
    });
  };

  // Date range handlers similar to hal-booking
  const handleFromDateSelect = (date: Date | undefined) => {
    setFromDate(date);
    setRangePreset('custom');
    setPage(1);
  };

  const handleToDateSelect = (date: Date | undefined) => {
    setToDate(date);
    setRangePreset('custom');
    setPage(1);
  };

  const applyToday = () => {
    const today = new Date();
    setFromDate(today);
    setToDate(today);
    setRangePreset('today');
    setPage(1);
  };

  const applyThisWeek = () => {
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    setFromDate(startOfWeek);
    setToDate(endOfWeek);
    setRangePreset('thisWeek');
    setPage(1);
  };

  const applyThisMonth = () => {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    setFromDate(startOfMonth);
    setToDate(endOfMonth);
    setRangePreset('thisMonth');
    setPage(1);
  };

  const applyLast3Months = () => {
    const today = new Date();
    const from = new Date(today);
    // Rolling 3-month window including the current month and previous 2 months
    from.setMonth(today.getMonth() - 2);
    setFromDate(from);
    setToDate(today);
    setRangePreset('last3Months');
    setPage(1);
  };

  useEffect(() => {
    const fetchInvoicesAndMasterData = async () => {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;
      const seq = ++invoicesFetchSeqRef.current;
      setLoading(true);
      // Clear any previous restrict-line cache immediately to prevent mixing old rows.
      setLineItemsByInvoice({});
      
      try {
        // Build date filter parameters for API
        const params = new URLSearchParams({
          account_code: acc,
          retail_code: ret,
          // Match Dashboard/Reports: fetch full range for KPI/list
          limit: '5000',
          // Always keep billing list fast. Staff restriction uses separate endpoints.
          sendalldata: 'N'
        });
        params.set('include_details', 'false');
        
        // Re-enable date filtering but make it more inclusive
        // Add date range filters if specified
        if (queryFromDate) {
          const fromDateStr = formatYMDIST(queryFromDate);
          params.append('from_date', fromDateStr);
        }
        if (queryToDate) {
          const toDateStr = formatYMDIST(queryToDate);
          params.append('to_date', toDateStr);
        }
        
        // Fetch invoices + master data in parallel; do not block invoices if master read fails
        const [invoiceRes, masterRes] = await Promise.allSettled([
          ApiService.get(`/billing-transitions?${params.toString()}`) as Promise<any>,
          DataService.readData(['master_employee', 'master_customer', 'retail_master'], acc, ret) as Promise<any>
        ]);

        // Ignore stale responses when date/user changes quickly
        if (seq !== invoicesFetchSeqRef.current) return;

        // Process invoice data
        const invoiceResponse: any = invoiceRes.status === 'fulfilled' ? invoiceRes.value : null;
        const invoiceData = Array.isArray(invoiceResponse?.data?.data)
          ? invoiceResponse.data.data
          : (Array.isArray(invoiceResponse?.data) ? invoiceResponse.data : []);

        // Process master data
        const masterResponse: any = masterRes.status === 'fulfilled' ? masterRes.value : null;
        const root: any = (masterResponse as any)?.data || {};
        const emps: any[] = root.master_employee || root.employee || root.employees || [];
        const custs: any[] = root.master_customer || root.customers || root.customer || [];
          const retailRows: any[] = root.retail_master || root.RetailMaster || root.retail || [];
        
        if (Array.isArray(retailRows) && retailRows.length > 0) {
          const row = retailRows[0];
          setRetailMasterRow(row);
          const mapped = {
            name: row?.RetailName || row?.retail_name || row?.company_name || row?.CompanyName || row?.org_name || row?.OrgName,
            address: row?.address || row?.Address || row?.company_address || row?.CompanyAddress || row?.retail_address || row?.RetailAddress,
            phone: row?.phone1 || row?.phone || row?.Phone || row?.phone_number || row?.PhoneNumber || row?.mobile || row?.Mobile,
            email: row?.email || row?.Email,
            gstin: row?.gst_no || row?.gstin || row?.GSTIN || row?.GSTNo,
          } as { name?: string; address?: string; phone?: string; email?: string; gstin?: string };
          setCompany(mapped);

          const msgVal =
            row?.manual_whatsappmessage ??
            row?.manual_WhatsappMessage ??
            row?.manualWhatsAppMessage ??
            row?.MANUAL_WHATSAPPMESSAGE ??
            row?.MANUAL_WHATSAPP_MESSAGE;
          setManualWhatsAppMessage(msgVal == null ? '' : String(msgVal));
        }
        
        const employeeMap: Record<string, string> = {};
        const customerMap: Record<string, string> = {};
        const customerPhoneMap: Record<string, string> = {};
        const customerIdPhoneMap: Record<string, string> = {};
        
        // Build employee map
        emps.forEach((emp: any) => {
          const id = String(emp.employee_id || emp.id || emp.code || '').trim();
          const name = String(emp.employee_name || emp.name || emp.full_name || '').trim();
          if (id && name) {
            employeeMap[id] = name;
          }
        });
        
        // Normalize phone helper (keep last 10 digits typical for India)
        const normalizePhone = (p: any): string => {
          const onlyDigits = String(p || '').replace(/\D+/g, '');
          if (!onlyDigits) return '';
          // take last 10 digits if length > 10 (strip country code like 91)
          return onlyDigits.length > 10 ? onlyDigits.slice(-10) : onlyDigits;
        };

        // Build customer maps (by id and by phone) with expanded field handling
        custs.forEach((cust: any) => {
          // Try multiple ID field variations
          const possibleIds = [
            cust.customer_id,
            cust.id,
            cust.code,
            cust.client_id,
            cust.CLIENT_ID,
            cust.CUSTOMER_ID,
            cust.cust_id
          ];
          
          // Try multiple name field variations
          const possibleNames = [
            cust.customer_name,
            cust.name,
            cust.full_name,
            cust.CLIENT_NAME,
            cust.client_name,
            cust.CUSTOMER_NAME,
            cust.first_name && cust.last_name ? `${cust.first_name} ${cust.last_name}`.trim() : null,
            cust.fname && cust.lname ? `${cust.fname} ${cust.lname}`.trim() : null
          ];
          
          // Find valid ID
          const id = possibleIds.find(id => {
            const val = String(id || '').trim();
            return val && val !== 'null' && val !== 'undefined';
          });
          
          // Find valid name
          const name = possibleNames.find(name => {
            const val = String(name || '').trim();
            return val && val !== 'null' && val !== 'undefined' && val.length > 0;
          });
          
          if (id && name) {
            const idStr = String(id).trim();
            const nameStr = String(name).trim();
            customerMap[idStr] = nameStr;
          }

          // Map primary/secondary phone numbers to name as a fallback for invoices lacking customer_id
          const phones: string[] = [
            cust.phone, cust.phone1, cust.mobile, cust.MOBILE, cust.PHONE, cust.customer_phone,
          ].filter(Boolean);
          phones.forEach(ph => {
            const np = normalizePhone(ph);
            if (np) {
              customerPhoneMap[np] = String(name || cust.customer_name || cust.name || '').trim() || 'Customer';
            }
          });

          // Map id -> primary phone for quick lookup when invoice lacks phone
          if (id) {
            const primaryPhone = phones.map(ph => normalizePhone(ph)).find(p => p);
            if (primaryPhone) {
              const idStr = String(id).trim();
              if (idStr) customerIdPhoneMap[idStr] = primaryPhone;
            }
          }
        });
        
        // Set all state together to avoid race conditions
        setEmpMap(employeeMap);
        setCustMap(customerMap);
  setServerInvoices(invoiceData); // Set invoices AFTER customer map is ready
  setCustPhoneMap(customerPhoneMap);
  setCustIdPhoneMap(customerIdPhoneMap);
        // Note: lineItemsByInvoice is managed by the restrict effect with its own sequencing.
        
      } catch (e) {
        console.error('Failed to fetch invoices and master data:', e);
        if (seq === invoicesFetchSeqRef.current) setServerInvoices([]);
      } finally {
        if (seq === invoicesFetchSeqRef.current) setLoading(false);
      }
    };
    
    fetchInvoicesAndMasterData();
  }, [user, queryFromDate, queryToDate]);

  useEffect(() => {
    const fetchLineItemsForRestrict = async () => {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      const seq = ++lineItemsFetchSeqRef.current;

      const shouldFetch = !!restrictStaff && String(employeeFilter || '') !== 'all';
      if (!shouldFetch) {
        setLineItemsByInvoice({});
        if (seq === lineItemsFetchSeqRef.current) setLineItemsLoading(false);
        return;
      }

      setLineItemsLoading(true);
      setLineItemsByInvoice({});
      try {
        const baseParams = new URLSearchParams({
          account_code: acc,
          retail_code: ret,
        });
        if (queryFromDate) baseParams.set('from_date', formatYMDIST(queryFromDate));
        if (queryToDate) baseParams.set('to_date', formatYMDIST(queryToDate));

        const fetchPaged = async (path: string): Promise<any[]> => {
          const pageLimit = 20000;
          const maxPages = 5;
          let offset = 0;
          const out: any[] = [];
          for (let i = 0; i < maxPages; i++) {
            const p = new URLSearchParams(baseParams.toString());
            p.set('limit', String(pageLimit));
            p.set('offset', String(offset));
            const resp: any = await ApiService.get(`${path}?${p.toString()}`);
            const rows: any[] = Array.isArray(resp?.data?.data)
              ? resp.data.data
              : (Array.isArray(resp?.data) ? resp.data : []);
            out.push(...rows);
            if (rows.length < pageLimit) break;
            offset += pageLimit;
          }
          return out;
        };

        const [svcRows, pkgRows, invRows] = await Promise.all([
          fetchPaged('/billing-trans-services'),
          fetchPaged('/billing-trans-packages'),
          fetchPaged('/billing-trans-inventory'),
        ]);

        const nextMap: Record<string, any[]> = {};
        const normInvKeys = (raw: any): string[] => {
          const s0 = String(raw ?? '').trim();
          if (!s0) return [];
          const out = new Set<string>();
          const s = s0.replace(/\s+/g, '');
          out.add(s0);
          out.add(s);
          const upper = s.toUpperCase();
          out.add(upper);

          // Common forms: INV-1181, INV1181, 1181
          const digitsOnly = upper.replace(/\D+/g, '');
          if (digitsOnly) {
            out.add(digitsOnly);
            out.add(`INV-${digitsOnly}`);
            out.add(`INV${digitsOnly}`);
          }

          // If it starts with INV, add the tail after INV / INV- / INV:
          if (upper.startsWith('INV')) {
            const tail = upper.replace(/^INV(?:-|:|_)*/i, '').trim();
            if (tail) {
              out.add(tail);
              const tailDigits = tail.replace(/\D+/g, '');
              if (tailDigits) {
                out.add(tailDigits);
                out.add(`INV-${tailDigits}`);
                out.add(`INV${tailDigits}`);
              }
            }
          }

          return Array.from(out).filter((k) => !!String(k || '').trim());
        };
        const add = (row: any) => {
          const rawId = row?.invoice_id ?? row?.billing_id ?? row?.bill_id ?? '';
          const keys = normInvKeys(rawId);
          if (keys.length === 0) return;
          for (const k of keys) {
            if (!nextMap[k]) nextMap[k] = [];
            nextMap[k].push(row);
          }
        };
        [...svcRows, ...pkgRows, ...invRows].forEach(add);
        if (seq === lineItemsFetchSeqRef.current) setLineItemsByInvoice(nextMap);
      } catch (e) {
        console.error('[billing][restrict] Failed to fetch line items:', e);
        if (seq === lineItemsFetchSeqRef.current) setLineItemsByInvoice({});
      } finally {
        if (seq === lineItemsFetchSeqRef.current) setLineItemsLoading(false);
      }
    };

    fetchLineItemsForRestrict();
  }, [user, queryFromDate, queryToDate, restrictStaff, employeeFilter]);

  const customerOptions = useMemo(() => {
    const entries = Object.entries(custMap || {});
    const options = entries
      .map(([id, name]) => {
        const phone = custIdPhoneMap?.[id] || '';
        return { id: String(id), name: String(name || '').trim() || 'Customer', phone };
      })
      .filter((c) => c.id && c.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [custMap, custIdPhoneMap]);

  const employeeOptions = useMemo(() => {
    const entries = Object.entries(empMap || {});
    const options = entries
      .map(([id, name]) => ({ id: String(id), name: String(name || '').trim() || 'Staff' }))
      .filter((e) => e.id && e.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    return options;
  }, [empMap]);

  const selectedCustomerLabel = useMemo(() => {
    if (customerFilter === 'all') return 'All Customers';
    const found = customerOptions.find((c) => c.id === customerFilter);
    if (!found) return 'Customer';
    return `${found.name}${found.phone ? ` - ${found.phone}` : ''}`;
  }, [customerFilter, customerOptions]);

  const selectedEmployeeLabel = useMemo(() => {
    if (employeeFilter === 'all') return 'All Staff';
    const found = employeeOptions.find((e) => e.id === employeeFilter);
    if (found?.name) return found.name;
    // fallback to map lookup in case options not ready
    const name = empMap?.[employeeFilter];
    return String(name || 'Staff').trim() || 'Staff';
  }, [employeeFilter, employeeOptions, empMap]);
  
  const sourceInvoices = useMemo(() => {
  const getCustomerId = (iv: any): string => {
      const idFields = [
        iv.customer_id,
        iv.CUSTOMER_ID,
        iv.customerId,
        iv.cust_id,
        iv.client_id,
        iv.CLIENT_ID,
        iv.clientId,
        iv.billing_customer_id,
        iv.account_id,
      ];
      for (const idField of idFields) {
        const key = String(idField ?? '').trim();
        if (key && key !== 'null' && key !== 'undefined') return key;
      }
      return '';
    };

  const getCustomerName = (iv: any): string => {
      // Try multiple possible customer name fields (expanded list)
      const nameFields = [
        iv.txn_customer_name,
        iv.customer_name,
        iv.customerName,
        iv.customer,
        iv.customer_full_name,
        iv.full_name,
        iv.name,
        iv.CLIENT_NAME,
        iv.client_name,
        iv.Customer_Name,
        iv.CUSTOMER_NAME,
        iv.billing_name,
        iv.account_name
      ];
      
      for (const field of nameFields) {
        const value = String(field || '').trim();
        if (value && value !== 'Customer' && value !== 'null' && value !== 'undefined' && value.length > 0) {
          return value;
        }
      }
      
      // If no direct name found, try customer ID lookup with expanded ID fields
      const idFields = [
        iv.customer_id, 
        iv.CUSTOMER_ID, 
        iv.customerId, 
        iv.cust_id,
        iv.client_id,
        iv.CLIENT_ID,
        iv.clientId,
        iv.billing_customer_id,
        iv.account_id
      ];
      
      for (const idField of idFields) {
        if (idField != null && idField !== '') {
          const key = String(idField).trim();
          if (key && custMap[key]) {
            return custMap[key];
          }
        }
      }
      
      // Next, try by phone mapping if invoice carries a phone/number field
      const phoneFields = [
        iv.customer_number, iv.customer_phone, iv.phone, iv.mobile, iv.CLIENT_PHONE, iv.client_phone
      ];
      for (const pf of phoneFields) {
        const digits = String(pf || '').replace(/\D+/g, '');
        if (!digits) continue;
        const key = digits.length > 10 ? digits.slice(-10) : digits;
        if (key && custPhoneMap[key]) {
          return custPhoneMap[key];
        }
      }
      
      // Last resort: try to find any field that might contain customer info
      const allKeys = Object.keys(iv);
      for (const key of allKeys) {
        if (key.toLowerCase().includes('customer') && key.toLowerCase().includes('name')) {
          const value = String(iv[key] || '').trim();
          if (value && value !== 'Customer' && value !== 'null' && value !== 'undefined' && value.length > 0) {
            return value;
          }
        }
      }
      
      // Final fallback
      return 'Customer';
    };

    const getStaffNamesArray = (iv: any): string[] => {
      // 1) Prefer new backend-provided employeeDetails string (comma-separated names)
      try {
        const raw = String(iv?.employeeDetails ?? iv?.employee_details ?? '').trim();
        if (raw) {
          const seen = new Set<string>();
          const arr = raw
            .split(',')
            .map((s: string) => String(s || '').trim())
            .filter((s: string) => s && s !== 'null' && s !== 'undefined')
            .filter((s: string) => {
              const key = s.toLowerCase();
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          if (arr.length > 0) return arr;
        }
      } catch {
        // fall through
      }

      // 2) Derive staff from child arrays (services/packages/inventory)
      try {
        const names: string[] = [];
        const seen = new Set<string>();
        const addStaff = (id: any, name: any) => {
          const idKey = String(id ?? '').trim();
          const n = String(name ?? '').trim();
          const finalName =
            (n && n !== 'null' && n !== 'undefined')
              ? n
              : (idKey && idKey !== 'null' && idKey !== 'undefined' && empMap?.[idKey])
                ? String(empMap[idKey]).trim()
                : '';
          if (!finalName) return;
          const k = finalName.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k);
          names.push(finalName);
        };

        const svcArr: any[] = Array.isArray(iv?.services) ? iv.services : [];
        const pkgArr: any[] = Array.isArray(iv?.packages) ? iv.packages : [];
        const invArr: any[] = Array.isArray(iv?.inventory) ? iv.inventory : [];

        svcArr.forEach((r: any) => addStaff(r?.employee_id ?? r?.staff_id, r?.employee_name ?? r?.staff_name));
        pkgArr.forEach((r: any) => addStaff(r?.employee_id ?? r?.staff_id, r?.employee_name ?? r?.staff_name));
        invArr.forEach((r: any) => addStaff(r?.employee_id ?? r?.staff_id, r?.employee_name ?? r?.staff_name));

        if (names.length > 0) return names;
      } catch {
        // fall through to legacy fields
      }

      // 3) Legacy single-name fields
      const nameFields = [
        iv.txn_employee_name,
        iv.employee_name,
        iv.staffName,
        iv.staff_name,
        iv.employee,
        iv.emp_name
      ];
      for (const field of nameFields) {
        const value = String(field || '').trim();
        if (value && value !== 'null' && value !== 'undefined' && value.length > 0) {
          return [value];
        }
      }

      // 4) Employee ID lookup
      const idFields = [iv.employee_id, iv.EMPLOYEE_ID, iv.employeeId, iv.emp_id, iv.staff_id];
      for (const idField of idFields) {
        const key = String(idField ?? '').trim();
        if (key && key !== 'null' && key !== 'undefined' && empMap?.[key]) {
          return [String(empMap[key]).trim()];
        }
      }

      return [];
    };

    const getStaffName = (iv: any): string => {
      return getStaffNamesArray(iv).join(', ');
    };

    const getEmployeeId = (iv: any): string => {
      // Prefer a single unique staff id from child arrays when available
      try {
        const ids = new Set<string>();
        const addId = (v: any) => {
          const key = String(v ?? '').trim();
          if (key && key !== 'null' && key !== 'undefined') ids.add(key);
        };
        const svcArr: any[] = Array.isArray(iv?.services) ? iv.services : [];
        const pkgArr: any[] = Array.isArray(iv?.packages) ? iv.packages : [];
        const invArr: any[] = Array.isArray(iv?.inventory) ? iv.inventory : [];
        svcArr.forEach((r: any) => addId(r?.employee_id ?? r?.staff_id));
        pkgArr.forEach((r: any) => addId(r?.employee_id ?? r?.staff_id));
        invArr.forEach((r: any) => addId(r?.employee_id ?? r?.staff_id));
        if (ids.size === 1) return Array.from(ids)[0];
      } catch {
        // fall through
      }

      const idFields = [
        iv.employee_id,
        iv.EMPLOYEE_ID,
        iv.employeeId,
        iv.emp_id,
        iv.staff_id,
        iv.txn_employee_id,
        iv.TXN_EMPLOYEE_ID,
      ];
      for (const idField of idFields) {
        const key = String(idField ?? '').trim();
        if (key && key !== 'null' && key !== 'undefined') return key;
      }
      return '';
    };

    const getEmployeeIds = (iv: any, mergedLinesOverride?: any[]): string[] => {
      const ids = new Set<string>();
      const addId = (v: any) => {
        const key = String(v ?? '').trim();
        if (key && key !== 'null' && key !== 'undefined') ids.add(key);
      };
      try {
        const merged: any[] = Array.isArray(mergedLinesOverride)
          ? mergedLinesOverride
          : [
              ...(Array.isArray(iv?.services) ? iv.services : []),
              ...(Array.isArray(iv?.packages) ? iv.packages : []),
              ...(Array.isArray(iv?.inventory) ? iv.inventory : []),
            ];
        merged.forEach((r: any) => addId(r?.employee_id ?? r?.staff_id ?? r?.emp_id ?? r?.staffId));
      } catch {
        // ignore
      }
      // Always include legacy resolved employee id as a fallback
      addId(getEmployeeId(iv));
      return Array.from(ids);
    };

    const getCustomerPhone = (iv: any): string => {
      const toDigits = (v:any) => String(v||'').replace(/\D+/g, '');
      const fields = [
        iv.txn_customer_mobile,
        iv.txn_customer_number,
        iv.customer_number,
        iv.customer_phone,
        iv.CUSTOMER_PHONE,
        iv.CLIENT_PHONE,
        iv.client_phone,
        iv.phone,
        iv.mobile,
      ];
      for (const f of fields) {
        const d = toDigits(f);
        if (d) {
          return d.length > 10 ? d.slice(-10) : d;
        }
      }
      // Fallback: try by customer id from master customer map
      const idFields = [
        iv.customer_id,
        iv.CUSTOMER_ID,
        iv.customerId,
        iv.cust_id,
        iv.billing_customer_id,
      ];
      for (const id of idFields) {
        const key = String(id || '').trim();
        if (key && custIdPhoneMap[key]) return custIdPhoneMap[key];
      }
      return '';
    };

    const processedInvoices = serverInvoices.map(iv => {
      // Normalize server timestamp (already serialized with +05:30) without double-shifting.
      const rawTs = iv.last_created_at || iv.last_updated_at || iv.created_at || new Date();
      const dateIST = normalizeToISTDate(rawTs);
      const customerName = getCustomerName(iv);
      const customerId = getCustomerId(iv);
      const invId = String(iv.invoice_id ?? iv.id ?? '').trim();
      const invKeyCandidates: string[] = (() => {
        const s0 = String(invId ?? '').trim();
        if (!s0) return [];
        const out = new Set<string>();
        const s = s0.replace(/\s+/g, '');
        out.add(s0);
        out.add(s);
        const upper = s.toUpperCase();
        out.add(upper);
        const digitsOnly = upper.replace(/\D+/g, '');
        if (digitsOnly) {
          out.add(digitsOnly);
          out.add(`INV-${digitsOnly}`);
          out.add(`INV${digitsOnly}`);
        }
        if (upper.startsWith('INV')) {
          const tail = upper.replace(/^INV(?:-|:|_)*/i, '').trim();
          if (tail) {
            out.add(tail);
            const tailDigits = tail.replace(/\D+/g, '');
            if (tailDigits) {
              out.add(tailDigits);
              out.add(`INV-${tailDigits}`);
              out.add(`INV${tailDigits}`);
            }
          }
        }
        return Array.from(out).filter((k) => !!String(k || '').trim());
      })();

      const mergedFromApi = invKeyCandidates
        .map((k) => (Array.isArray(lineItemsByInvoice?.[k]) ? lineItemsByInvoice[k] : []))
        .find((arr) => Array.isArray(arr) && arr.length > 0);

      const mergedLines: any[] = mergedFromApi && mergedFromApi.length > 0
        ? mergedFromApi
        : [
            ...(Array.isArray(iv?.services) ? iv.services : []),
            ...(Array.isArray(iv?.packages) ? iv.packages : []),
            ...(Array.isArray(iv?.inventory) ? iv.inventory : []),
          ];
      const headerTotal = Number(
        iv.txn_grand_total ?? iv.txn_total_amount ?? iv.txn_total ?? 0
      ) || 0;
      const aggregateTotal = Number(iv.grand_total) || 0;
      const resolvedTotal = headerTotal > 0 ? headerTotal : aggregateTotal;

      // Determine status based on billstatus field
      let status = 'paid'; // default
      if (iv.billstatus === 'N' || iv.bill_status === 'N' || iv.BILL_STATUS === 'N') {
        status = 'hold';
      } else if (iv.billstatus === 'Y' || iv.bill_status === 'Y' || iv.BILL_STATUS === 'Y') {
        status = 'paid';
      } else if (iv.billstatus === 'C' || iv.bill_status === 'C' || iv.BILL_STATUS === 'C') {
        status = 'cancelled';
      }
      
      const staffNames = getStaffNamesArray(iv);
      return {
        id: invId,
        customerId,
        customer: customerName,
        customerPhone: getCustomerPhone(iv),
        employeeId: getEmployeeId(iv),
        employeeIds: getEmployeeIds(iv, mergedLines),
        date: dateIST,
        subtotal: Number(iv.txn_subtotal_amount ?? iv.raw_subtotal) || 0,
        tax: Number(iv.txn_tax_amount ?? iv.tax_amount) || 0,
        discount: Number(iv.txn_discount_amount ?? iv.discount_first_line) || 0,
        total: resolvedTotal,
        creditAmount: Number(
          iv.credit_amount ??
          iv.CREDIT_AMOUNT ??
          iv.creditAmount ??
          iv.txn_credit_amount ??
          0
        ) || 0,
        status: status,
        billstatus: iv.billstatus || iv.bill_status || iv.BILL_STATUS,
        paymentMethod: null,
        // Store all child line items for counts (services+packages+inventory)
        services: mergedLines,
        dueDate: dateIST,
        staff: staffNames.join(', '),
        staffNames
      };
    });
    
    return processedInvoices;
  }, [serverInvoices, empMap, custMap, custPhoneMap, lineItemsByInvoice]);

  const filteredInvoices = useMemo(() => {
    const filtered = sourceInvoices.filter((invoice) => {
      const matchesSearch = 
        invoice.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
        String(invoice.id || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (invoice.customerPhone ? String(invoice.customerPhone).includes(searchTerm.replace(/\D+/g,'')) : false);
      
      const matchesStatus = statusFilter === "all" || invoice.status === statusFilter;

      const matchesCustomer =
        customerFilter === 'all' ||
        (String((invoice as any).customerId || '').trim() && String((invoice as any).customerId).trim() === customerFilter) ||
        String(invoice.customer || '').trim() === customerFilter;

      const matchesEmployee = (() => {
        if (employeeFilter === 'all') return true;
        const invEmpId = String((invoice as any).employeeId || '').trim();
        if (invEmpId && invEmpId === employeeFilter) return true;
        const invEmpIds: string[] = Array.isArray((invoice as any).employeeIds) ? (invoice as any).employeeIds : [];
        if (invEmpIds.some((id) => String(id || '').trim() === employeeFilter)) return true;
        const selectedName = String(empMap?.[employeeFilter] || '').trim();
        if (!selectedName) return false;
        const staffNames: string[] = Array.isArray((invoice as any).staffNames) ? (invoice as any).staffNames : [];
        if (staffNames.some((n) => String(n || '').trim().toLowerCase() === selectedName.toLowerCase())) return true;
        // Fallback: substring check against staff string
        return String((invoice as any).staff || '').toLowerCase().includes(selectedName.toLowerCase());
      })();
      
      // Temporarily remove date filtering to show all invoices
      const passesFilter = matchesSearch && matchesStatus && matchesCustomer && matchesEmployee;
      
      return passesFilter;
    });
    
    return filtered;
  }, [sourceInvoices, searchTerm, statusFilter, customerFilter, employeeFilter, empMap]);

  const displayInvoices = useMemo(() => {
    if (!restrictStaff || employeeFilter === 'all') return filteredInvoices;

    const selectedEmployeeId = String(employeeFilter || '').trim();
    const selectedEmployeeName = String(empMap?.[selectedEmployeeId] || selectedEmployeeLabel || '').trim();
    const norm = (v: any) => String(v ?? '').trim().toLowerCase();

    const itemMatchesSelectedStaff = (row: any): boolean => {
      const rowEmpId = String(
        row?.employee_id ?? row?.EMPLOYEE_ID ?? row?.emp_id ?? row?.staff_id ?? row?.staffId ?? ''
      ).trim();
      if (rowEmpId && rowEmpId === selectedEmployeeId) return true;

      const rowEmpName = String(
        row?.employee_name ??
          row?.txn_employee_name ??
          row?.staff_name ??
          row?.staffName ??
          row?.empName ??
          ''
      ).trim();
      if (selectedEmployeeName && rowEmpName && norm(rowEmpName) === norm(selectedEmployeeName)) return true;

      if (selectedEmployeeName && rowEmpId && empMap?.[rowEmpId] && norm(empMap[rowEmpId]) === norm(selectedEmployeeName)) {
        return true;
      }
      return false;
    };

    const itemBaseAmount = (row: any): number => {
      const quantity = Number(row?.qty ?? row?.quantity ?? 1) || 1;
      const unitPrice = Number(row?.unit_price ?? row?.price ?? row?.rate ?? 0) || 0;
      const subtotalLine = unitPrice * quantity;

      const derivedTax =
        (Number(row?.cgst_amount) || Number(row?.total_cgst) || 0) +
        (Number(row?.sgst_amount) || Number(row?.total_sgst) || 0) +
        (Number(row?.igst_amount) || Number(row?.total_igst) || 0);
      const taxAmountLine = Number(row?.tax_amount ?? row?.total_tax ?? row?.gst_amount ?? derivedTax) || 0;
      const explicitTotal = Number(row?.item_total ?? row?.grand_total ?? row?.total ?? row?.amount ?? row?.line_total);

      // Base amount (exclude tax) used to proportionally scale invoice header totals.
      // Prefer unitPrice*qty; fallback to explicit totals when available.
      if (Number.isFinite(explicitTotal) && explicitTotal > 0) {
        const baseFromExplicit = Math.max(0, explicitTotal - taxAmountLine);
        // If explicitTotal looks like it already matches unit subtotal, keep subtotalLine.
        if (Math.abs(explicitTotal - subtotalLine) < 0.01) return Math.max(0, subtotalLine);
        // If explicitTotal includes tax and differs, use derived base.
        if (taxAmountLine > 0) return baseFromExplicit;
      }

      return Math.max(0, subtotalLine);
    };

    const sumBase = (rows: any[]): number => rows.reduce((s, r) => s + itemBaseAmount(r), 0);

    return filteredInvoices.map((inv: any) => {
      const items: any[] = Array.isArray(inv?.services) ? inv.services : [];
      if (items.length === 0) return inv;

      const selectedItems = items.filter(itemMatchesSelectedStaff);
      if (selectedItems.length === 0) return inv;

      const allBase = sumBase(items);
      const selectedBase = sumBase(selectedItems);
      const ratio = allBase > 0 ? selectedBase / allBase : selectedItems.length / items.length;
      const clampRatio = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, Math.max(0, ratio)) : 1;
      const scale = (n: any) => (Number(n || 0) || 0) * clampRatio;

      const nextTotal = Number((scale(inv.total)).toFixed(2));

      return {
        ...inv,
        employeeId: selectedEmployeeId,
        employeeIds: [selectedEmployeeId],
        staff: selectedEmployeeName || inv.staff,
        staffNames: selectedEmployeeName ? [selectedEmployeeName] : inv.staffNames,
        services: selectedItems,
        subtotal: scale(inv.subtotal),
        tax: scale(inv.tax),
        discount: scale(inv.discount),
        creditAmount: scale(inv.creditAmount),
        total: nextTotal,
      };
    });
  }, [filteredInvoices, restrictStaff, employeeFilter, empMap, selectedEmployeeLabel]);

  // Reset paging when filters change
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, customerFilter, employeeFilter, restrictStaff]);

  // Sorting
  const sortedInvoices = useMemo(() => {
    const sorted = [...displayInvoices].sort((a, b) => {
      const direction = sortDir === 'asc' ? 1 : -1;
      
      switch (sortBy) {
        case 'date':
          return (a.date.getTime() - b.date.getTime()) * direction;
        case 'customer':
          return a.customer.localeCompare(b.customer) * direction;
        case 'amount':
          return (a.total - b.total) * direction;
        case 'status':
          return a.status.localeCompare(b.status) * direction;
        default:
          return 0;
      }
    });
    return sorted;
  }, [displayInvoices, sortBy, sortDir]);

  // Keep pageSize synced when user selects "All"
  useEffect(() => {
    if (!rowsAll) return;
    const next = Math.max(1, sortedInvoices.length);
    setPageSize((prev) => (prev === next ? prev : next));
    setPage(1);
  }, [rowsAll, sortedInvoices.length]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedInvoices.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedInvoices = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedInvoices.slice(start, start + pageSize);
  }, [sortedInvoices, pageSize, safePage]);

  // Removed background per-invoice resolution – list now relies solely on billing-transitions payload and master maps.

  // Statistics calculations - use same filtering as main view
  const filteredInvoicesForStats = displayInvoices;

  // Sales Total should include only billed invoices (billtype/billstatus = 'Y' => status 'paid')
  const billedInvoices = filteredInvoicesForStats.filter(inv => inv.status === 'paid');
  const totalRevenue = billedInvoices.reduce((sum, inv) => sum + inv.total, 0);

  // Cancelled bills (billtype/billstatus = 'C' => status 'cancelled')
  const cancelledInvoices = filteredInvoicesForStats.filter(inv => inv.status === 'cancelled');
  const cancelledCount = cancelledInvoices.length;
  const cancelledAmount = cancelledInvoices.reduce((sum, inv) => sum + inv.total, 0);

  // Keep legacy naming used by other parts of the page
  const nonHoldInvoices = filteredInvoicesForStats.filter(inv => inv.status !== 'hold' && inv.status !== 'cancelled');
  const pendingAmount = filteredInvoicesForStats.filter(inv => inv.status === 'pending' || inv.status === 'overdue').reduce((sum, inv) => sum + inv.total, 0);
  
  // For "TODAY" card - always show today's data regardless of filter, excluding hold bills
  const todayRevenue = sourceInvoices.filter(inv => {
    const ymd = formatYMDIST(new Date());
    const todayStart = new Date(`${ymd}T00:00:00.000+05:30`);
    const todayEnd = new Date(`${ymd}T23:59:59.999+05:30`);
    return inv.status === 'paid' && inv.date >= todayStart && inv.date <= todayEnd;
  }).reduce((sum, inv) => sum + inv.total, 0);

  // Today's count excludes hold bills
  const todayCount = sourceInvoices.filter(inv => {
    const ymd = formatYMDIST(new Date());
    const todayStart = new Date(`${ymd}T00:00:00.000+05:30`);
    const todayEnd = new Date(`${ymd}T23:59:59.999+05:30`);
    return inv.status !== 'hold' && inv.status !== 'cancelled' && inv.date >= todayStart && inv.date <= todayEnd;
  }).length;

  const paidCount = filteredInvoicesForStats.filter(inv => inv.status === 'paid').length;
  const pendingCount = filteredInvoicesForStats.filter(inv => inv.status === 'pending' || inv.status === 'overdue').length;
  const paidAmount = filteredInvoicesForStats.filter(inv => inv.status === 'paid').reduce((sum, inv) => sum + inv.total, 0);
  
  // Hold bills calculations
  const holdInvoices = filteredInvoicesForStats.filter(inv => inv.status === 'hold');
  const holdCount = holdInvoices.length;
  const holdAmount = holdInvoices.reduce((sum, inv) => sum + inv.total, 0);
  
  // Total customers from filtered data
  const totalCustomers = new Set(filteredInvoicesForStats.map(inv => inv.customer)).size;

  const topServiceStaff = useMemo(() => {
    const byStaff = new Map<string, { name: string; services: number; amount: number }>();

    // Staff performance should follow billed sales (billtype 'Y')
    billedInvoices.forEach((inv) => {
      const name = (inv.staff || '').trim() || 'N/A';
      const servicesForInvoice = Array.isArray(inv.services) && inv.services.length > 0 ? inv.services.length : 1;
      const prev = byStaff.get(name) || { name, services: 0, amount: 0 };
      prev.services += servicesForInvoice;
      prev.amount += Number(inv.total) || 0;
      byStaff.set(name, prev);
    });

    const rows = Array.from(byStaff.values());
    rows.sort(
      (a, b) =>
        b.services - a.services ||
        b.amount - a.amount ||
        a.name.localeCompare(b.name)
    );

    return rows[0] || { name: 'N/A', services: 0, amount: 0 };
  }, [billedInvoices]);

  const handleNewInvoice = () => {
    navigate("/billing/add");
  };

  // Utility function to detect printer capabilities
  const detectPrinterType = () => {
    // Check if browser supports media queries for printer detection
    const isThermalPrinter = window.matchMedia && window.matchMedia('print and (max-width: 80mm)').matches;
    const isNarrowPrinter = window.matchMedia && window.matchMedia('print and (max-width: 100mm)').matches;
    
    // Check user agent for mobile devices (often connected to thermal printers)
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    // Return printer characteristics
    return {
      isThermal: isThermalPrinter || isMobile,
      isNarrow: isNarrowPrinter || isThermalPrinter,
      supportsColor: !isThermalPrinter && !isMobile,
      recommendedWidth: isThermalPrinter ? '72mm' : isNarrowPrinter ? '80mm' : 'auto'
    };
  };

  const generateInvoicePreview = async (
    invoiceId: string,
    acc: string,
    ret: string,
    paperWidthMm: number = 58,
    documentTitle?: string
  ) => {
    // Get invoice data
    const resp: any = await InvoiceService.get(invoiceId, acc, ret);
    if (!resp?.success || !resp?.data) {
      throw new Error('Failed to fetch invoice data');
    }

    const header = resp.header || {};
    // Prefer explicit arrays when available to include all line types
    const servicesArr = Array.isArray((resp as any).services) ? (resp as any).services : (resp.data || []);
    const packagesArr = Array.isArray((resp as any).packages) ? (resp as any).packages : [];
    const inventoryArr = Array.isArray((resp as any).inventory) ? (resp as any).inventory : [];
    const invoiceData = servicesArr;
    const allItems: any[] = [...servicesArr, ...packagesArr, ...inventoryArr];
    
    // Extract customer and business information
    const invoiceFromList = sourceInvoices.find(inv => inv.id === invoiceId);
    let customerName = invoiceFromList?.customer || 'Customer';
    let customerPhone = invoiceFromList?.customerPhone || '';
    let employeeName = '';
    
    // Get employee name
    const employeeNameSources = [
      header?.employee_name,
      header?.txn_employee_name,
      invoiceData[0]?.employee_name,
      invoiceData[0]?.txn_employee_name,
      invoiceData[0]?.staff_name
    ];
    
    for (const source of employeeNameSources) {
      if (source && String(source).trim()) {
        employeeName = String(source).trim();
        break;
      }
    }
    
    // If no employee name found, try employee ID lookup
    if (!employeeName) {
      const empIdSources = [header?.employee_id, header?.txn_employee_id, invoiceData[0]?.employee_id];
      for (const empId of empIdSources) {
        if (empId && empMap[empId]) {
          employeeName = empMap[empId];
          break;
        }
      }
    }
    
    // Calculate totals with multiple field fallbacks
    // Requirement: Subtotal/Total should NOT include tax.
    let subtotal = 0;
    let totalTax = 0;
    let discount = 0;

    allItems.forEach((item: any) => {
      const quantity = Number(item.quantity || item.qty || 1);
      const unitPrice = Number(item.unit_price || item.price || item.rate || 0);

      // Gross line total (often includes tax in this API)
      const grossTotal = Number(item.item_total || item.grand_total || item.total || item.amount || item.line_total || (quantity * unitPrice) || 0);
      const itemTax =
        Number(
          item.tax_amount ??
            item.total_tax ??
            item.tax ??
            item.gst_amount ??
            ((Number(item.cgst_amount) || 0) + (Number(item.sgst_amount) || 0) + (Number(item.igst_amount) || 0))
        ) || 0;
      const itemDiscount = Number(item.discount_amount || item.discount || 0) || 0;

      // Base line total (exclude tax). Prefer explicit unit price * qty so the receipt shows item-wise unit price.
      const baseFromUnit = quantity * unitPrice;
      const baseFromGross = Math.max(0, grossTotal - itemTax);
      const baseTotal = baseFromUnit > 0 ? baseFromUnit : baseFromGross;

      subtotal += baseTotal;
      totalTax += itemTax;
      discount += itemDiscount;
    });

    // If subtotal is still 0, try to calculate from unit price * quantity
    if (subtotal === 0) {
      allItems.forEach((item: any) => {
        const quantity = Number(item.quantity || item.qty || 1);
        const unitPrice = Number(item.unit_price || item.price || item.rate || 0);
        subtotal += (quantity * unitPrice);
      });
    }

    const issuedAt = invoiceFromList?.date
      ? new Date(invoiceFromList.date)
      : new Date(header?.created_at || new Date());

    // Grand total should include tax
    const total = subtotal + totalTax - discount;
    const roundedTotal = Math.round(total);
    
    // Generate thermal printer optimized HTML
    return `
      <div style="width: ${paperWidthMm}mm; font-family: 'Courier New', monospace; font-size: 16px; font-weight: bold; line-height: 1.4; padding: 8px; margin: 0 auto; background: white;">
        <div style="text-align: center; margin-bottom: 8px;">
          ${documentTitle ? `<div style="font-weight: 900; font-size: 18px; letter-spacing: 0.3px; margin-bottom: 4px;">${documentTitle}</div>` : ''}
          <div style="font-weight: bold; font-size: 18px;">${company?.name || 'Salon Business'}</div>
          ${company?.address ? `<div style="font-size: 14px; font-weight: bold; margin: 2px 0;">${company.address}</div>` : ''}
          ${company?.phone ? `<div style="font-size: 14px; font-weight: bold;">Ph: ${company.phone}</div>` : ''}
          ${company?.gstin ? `<div style="font-size: 14px; font-weight: bold;">GSTIN: ${company.gstin}</div>` : ''}
          <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold;">
            <span>Invoice: ${invoiceId}</span>
            <span>${format(issuedAt, 'dd/MM/yyyy')}</span>
          </div>
          <div style="font-size: 14px; font-weight: bold;">Time: ${format(issuedAt, 'hh:mm a')}</div>
          ${customerName !== 'Customer' ? `<div style="font-size: 14px; font-weight: bold;">Customer: ${customerName}</div>` : ''}
          ${customerPhone ? `<div style="font-size: 14px; font-weight: bold;">Phone: ${customerPhone}</div>` : ''}
          ${employeeName ? `<div style="font-size: 14px; font-weight: bold;">Staff: ${employeeName}</div>` : ''}
        </div>
        
        <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
        
        <div style="margin-bottom: 8px;">
          ${allItems.map((item: any) => {
            const itemName = item.service_name || item.package_name || item.product_name || item.item_name || item.name || 'Item';
            const quantity = Number(item.quantity || item.qty || 1);
            const unitPrice = Number(item.unit_price || item.price || item.rate || 0);
            const grossTotal = Number(item.item_total || item.grand_total || item.total || item.amount || item.line_total || (quantity * unitPrice) || 0);
            const itemTax = Number(
              item.tax_amount ??
                item.total_tax ??
                item.tax ??
                item.gst_amount ??
                ((Number(item.cgst_amount) || 0) + (Number(item.sgst_amount) || 0) + (Number(item.igst_amount) || 0))
            ) || 0;
            const baseFromUnit = quantity * unitPrice;
            const baseFromGross = Math.max(0, grossTotal - itemTax);
            const baseTotal = baseFromUnit > 0 ? baseFromUnit : baseFromGross;
            const effectiveUnitPrice = unitPrice > 0 ? unitPrice : (quantity > 0 ? baseTotal / quantity : 0);
            
            return `
            <div style="margin-bottom: 4px; font-size: 14px; font-weight: bold;">
              <div style="font-weight: bold;">${itemName}</div>
              <div style="display: flex; justify-content: space-between; font-weight: bold;">
                <span>${quantity} x ₹${effectiveUnitPrice.toFixed(2)}</span>
                <span>₹${baseTotal.toFixed(2)}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
        
        <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
        
        <div style="margin-bottom: 8px; font-size: 14px; font-weight: bold;">
          <div style="display: flex; justify-content: space-between; font-weight: bold;">
            <span>Subtotal:</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
          ${discount > 0 ? `
            <div style="display: flex; justify-content: space-between; font-weight: bold;">
              <span>Discount:</span>
              <span>-₹${discount.toFixed(2)}</span>
            </div>
          ` : ''}
          ${totalTax > 0 ? `
            <div style="display: flex; justify-content: space-between; font-weight: bold;">
              <span>Tax:</span>
              <span>₹${totalTax.toFixed(2)}</span>
            </div>
          ` : ''}
          <div style="margin: 6px 0 2px; padding-top: 2px; font-weight: bold; display: flex; justify-content: space-between;">
            <span>Total:</span>
            <span>₹${roundedTotal}</span>
          </div>
        </div>
        
        <div style="text-align: center; font-size: 14px; font-weight: bold; margin-top: 8px;">
          <div>Thank you for visiting!</div>
          <div style="margin-top: 4px;">Please visit again</div>
        </div>
        
        <div style="text-align: center; margin-top: 8px; font-size: 12px; font-weight: bold;">
          <div style="border-bottom: 1px dashed #000; margin: 4px 0;"></div>
          <div>Powered by GYM Pro</div>
        </div>
      </div>
    `;
  };

  const showPrintOptions = async (invoiceId: string, skipDialog = false, documentTitle?: string) => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    try {
      // Generate preview content
      const previewHtml = await generateInvoicePreview(invoiceId, acc, ret, 58, documentTitle);
      setPreviewContent(previewHtml);
      setPreviewInvoiceId(invoiceId);
      setPreviewDocumentTitle(documentTitle || '');
      setPreviewDialogOpen(true);
    } catch (error) {
      console.error('Preview generation failed:', error);
      toast({ 
        title: "Preview Failed", 
        description: "Could not generate invoice preview", 
        variant: "destructive" 
      });
    }
  };

  const cancelInvoiceFromList = (invoice: any) => {
    if (!invoice?.id) return;

    const isCancelled = String(invoice.status || '').toLowerCase() === 'cancelled';
    setCancelConfirmInvoice(invoice);
    setCancelConfirmMode(isCancelled ? 'revert' : 'cancel');
    setCancelConfirmOpen(true);
  };

  const runCancelToggle = async () => {
    if (!user) return;
    if (!cancelConfirmInvoice?.id) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      toast({ title: 'Missing context', description: 'Account/Retail not found.', variant: 'destructive' });
      return;
    }

    setCancelConfirmSubmitting(true);
    try {
      const invoiceId = String(cancelConfirmInvoice.id);
      const nextBillstatus = cancelConfirmMode === 'cancel' ? 'C' : 'Y';

      if (cancelConfirmMode === 'cancel') {
        await InvoiceService.cancel(invoiceId, String(acc), String(ret));
        toast({ title: 'Invoice Cancelled', description: `Invoice ${invoiceId} marked cancelled.`, variant: 'default' });
      } else {
        await InvoiceService.uncancel(invoiceId, String(acc), String(ret));
        toast({ title: 'Cancellation Reverted', description: `Invoice ${invoiceId} restored (Y).`, variant: 'default' });
      }

      // Update local list immediately
      setServerInvoices((prev) =>
        (prev || []).map((iv: any) => {
          const key = String(iv?.invoice_id ?? iv?.id ?? '').trim();
          if (key && key === invoiceId) {
            return {
              ...iv,
              billstatus: nextBillstatus,
              bill_status: nextBillstatus,
              BILL_STATUS: nextBillstatus,
              txn_billstatus: nextBillstatus,
              txn_bill_status: nextBillstatus,
              billtype: nextBillstatus,
              bill_type: nextBillstatus,
              txn_billtype: nextBillstatus,
              txn_bill_type: nextBillstatus,
            };
          }
          return iv;
        })
      );

      setCancelConfirmOpen(false);
      setCancelConfirmInvoice(null);
    } catch (err) {
      console.error('Cancel toggle failed:', err);
      toast({
        title: cancelConfirmMode === 'cancel' ? 'Cancel Failed' : 'Revert Failed',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setCancelConfirmSubmitting(false);
    }
  };

  // Check if any thermal printers might be connected via USB
  const checkForWiredThermalPrinters = async (): Promise<boolean> => {
    try {
      if (!('serial' in navigator)) return false;
      
      const savedPorts = await (navigator as any).serial.getPorts();
      // Check if any saved ports might be thermal printers
      const thermalPorts = savedPorts.filter((port: any) => {
        const info = port.getInfo();
        // Common thermal printer vendor IDs
        const thermalVendorIds = [0x04B8, 0x0483, 0x067B, 0x1A86, 0x0403, 0x10C4];
        return thermalVendorIds.includes(info.usbVendorId);
      });
      
      return thermalPorts.length > 0;
    } catch (error) {
      console.log('Error checking for wired thermal printers:', error);
      return false;
    }
  };

  // Try to print via Web Serial API (wired thermal printer)
  const tryWiredThermalPrint = async (invoiceId: string): Promise<boolean> => {
    try {
      // Check if Web Serial API is supported
      if (!('serial' in navigator)) {
        console.log('Web Serial API not supported');
        return false;
      }

      // First, check if we have any saved thermal printer ports
      const savedPorts = await (navigator as any).serial.getPorts();
      let port = savedPorts.find((p: any) => {
        const info = p.getInfo();
        // Common thermal printer vendor IDs
        const thermalVendorIds = [0x04B8, 0x0483, 0x067B, 0x1A86, 0x0403, 0x10C4];
        return thermalVendorIds.includes(info.usbVendorId);
      });

      // If no saved thermal printer port, request user to select one
      if (!port) {
        try {
          const hasWiredPrinters = await checkForWiredThermalPrinters();
          if (!hasWiredPrinters) {
            // Show user-friendly dialog asking to connect thermal printer
            const userWantsToConnect = confirm(
              'No wired thermal printer detected.\n\n' +
              'Would you like to connect a USB thermal printer?\n\n' +
              'Make sure your thermal printer is:\n' +
              '• Connected via USB\n' +
              '• Turned on\n' +
              '• Has paper loaded\n\n' +
              'Click OK to select the printer port, or Cancel to try Bluetooth printing.'
            );
            
            if (!userWantsToConnect) {
              return false;
            }
          }

          port = await (navigator as any).serial.requestPort({
            filters: [
              // Common thermal printer USB vendor IDs
              { usbVendorId: 0x04B8 }, // Epson
              { usbVendorId: 0x0483 }, // STMicroelectronics (common in thermal printers)
              { usbVendorId: 0x067B }, // Prolific (USB-to-Serial)
              { usbVendorId: 0x1A86 }, // QinHeng Electronics (CH340)
              { usbVendorId: 0x0403 }, // FTDI
              { usbVendorId: 0x10C4 }, // Silicon Labs
              { usbVendorId: 0x0519 }, // Star Micronics
              { usbVendorId: 0x0B00 }, // Printer vendor ID
            ]
          });
        } catch (err: any) {
          if (err.name === 'NotFoundError') {
            console.log('No compatible thermal printer found');
          } else {
            console.log('User cancelled port selection or error occurred:', err.message);
          }
          return false;
        }
      }

      if (!port) return false;

      // Try different common baud rates for thermal printers
      const baudRates = [9600, 19200, 38400, 115200];
      let connected = false;
      
      for (const baudRate of baudRates) {
        try {
          await port.open({ 
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
          });
          connected = true;
          break;
        } catch (error) {
          console.log(`Failed to connect at ${baudRate} baud:`, error);
          continue;
        }
      }

      if (!connected) {
        console.error('Failed to connect to thermal printer at any baud rate');
        return false;
      }

      // Generate print data
      const printData = await generateThermalPrintData(invoiceId);

      // Write data to the port with error handling
      const writer = port.writable.getWriter();
      
      try {
        await writer.write(printData);
        
        // Wait a moment for the data to be processed
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } finally {
        writer.releaseLock();
        
        // Close the port
        try {
          await port.close();
        } catch (closeError) {
          console.log('Error closing port:', closeError);
        }
      }

      return true;
      
    } catch (error: any) {
      console.error('Wired thermal print error:', error);
      
      // Provide user-friendly error messages
      if (error.name === 'NetworkError') {
        toast({
          title: "Printer Connection Error",
          description: "Failed to connect to thermal printer. Please check the USB connection and try again.",
          variant: "destructive"
        });
      } else if (error.name === 'InvalidStateError') {
        toast({
          title: "Printer Busy",
          description: "Thermal printer is busy or already in use. Please wait and try again.",
          variant: "destructive"
        });
      }
      
      return false;
    }
  };

  // Try to print via Bluetooth thermal printer
  const tryBluetoothThermalPrint = async (invoiceId: string): Promise<boolean> => {
    try {
      // Get printer connection using the global connection manager
      const printerConnection = await getPrinterConnection();
      
      if (!printerConnection) {
        return false;
      }

      const { device, port, info } = printerConnection;
      
      // Handle Bluetooth printer
      if (info.type === 'bluetooth' || !info.type) {
        if (!device) {
          return false;
        }

        // Generate ESC/POS commands from the preview content
        const printData = await generateThermalPrintData(invoiceId);
        
        // Send data to Bluetooth thermal printer
        await sendToBluetooth(device, printData);
        
        return true;
      }

      // Handle wired printer
      if (info.type === 'wired' && port) {
        return await printToWiredPort(invoiceId, port);
      }
      
      return false;
    } catch (error) {
      console.error('Thermal print error:', error);
      return false;
    }
  };

  // Helper function to print to wired port
  const printToWiredPort = async (invoiceId: string, port: any): Promise<boolean> => {
    try {
      // Try different baud rates
      const baudRates = [9600, 19200, 38400, 115200];
      let connected = false;

      for (const baudRate of baudRates) {
        try {
          await port.open({
            baudRate,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
          });
          connected = true;

          // Generate print data
          const printData = await generateThermalPrintData(invoiceId);

          // Write data to the port
          const writer = port.writable.getWriter();
          await writer.write(printData);
          writer.releaseLock();

          await port.close();
          return true;
        } catch (error) {
          if (connected) {
            try { await port.close(); } catch {} // Cleanup on error
          }
          continue; // Try next baud rate
        }
      }
      
      return false;
    } catch (error) {
      console.error('Wired port print error:', error);
      return false;
    }
  };

  const handleBrowserPrint = async (invoiceId: string, documentTitle?: string) => {
    try {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      // Generate the same thermal receipt format but for browser printing
      // Browser print: use 3-inch (72mm) receipt width
      const thermalContent = await generateInvoicePreview(invoiceId, acc, ret, 72, documentTitle);
      
      // Create a printable HTML document
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>${documentTitle ? `${documentTitle} - ${invoiceId}` : `Receipt - ${invoiceId}`}</title>
          <style>
            @media print {
              @page {
                size: 72mm auto;
                margin: 0;
              }
              body { margin: 0; }
            }
            body {
              font-family: 'Courier New', monospace;
              margin: 0;
              padding: 0;
              background: white;
            }
            .no-print {
              display: block;
            }
            @media print {
              .no-print {
                display: none !important;
              }
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="position: fixed; top: 10px; right: 10px; z-index: 1000; display: flex; gap: 10px;">
            <button onclick="window.print()" style="padding: 8px 16px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
              🖨️ Print
            </button>
            <button onclick="window.close()" style="padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer;">
              ✕ Close
            </button>
          </div>
          ${thermalContent}
        </body>
        </html>
      `;

      // Open in new window for printing
      const printWindow = window.open('', '_blank', 'width=400,height=600,scrollbars=yes,resizable=yes');
      if (printWindow) {
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();
        
        // Auto-focus for immediate printing
        printWindow.onload = () => {
          setTimeout(() => {
            printWindow.focus();
          }, 250);
        };
        
        setPreviewDialogOpen(false);
        
          toast({
            title: "Print Window Opened",
            description: `${documentTitle || 'Receipt'} opened in new window. Click Print button to print.`,
            className: "bg-blue-50 border-blue-200 text-blue-800"
          });
      } else {
        toast({
          title: "Popup Blocked",
          description: "Please allow popups for this site to use browser printing.",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Browser print error:', error);
      toast({
        title: "Print Failed",
        description: "Failed to open print window. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleThermalPrint = async (invoiceId: string) => {
    try {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      // First check if we have any connected printers saved in localStorage
      const printerConnection = await getPrinterConnection();
      
      if (printerConnection) {
        const { device, port, info } = printerConnection;
        
        // If we have a connected Bluetooth printer, use it directly
        if (info.type === 'bluetooth' || !info.type) {
          if (device && device.gatt?.connected) {
            try {
              const printData = await generateThermalPrintData(invoiceId);
              await sendToBluetooth(device, printData);
              
              toast({ 
                title: "Print Sent", 
                description: "Invoice sent to Bluetooth printer successfully.",
                className: "bg-green-50 border-green-200 text-green-800" 
              });
              setPreviewDialogOpen(false);
              return;
            } catch (error) {
              console.error('Bluetooth print failed:', error);
              // Continue to fallback options if Bluetooth fails
            }
          }
        }
        
        // If we have a connected wired printer, use it
        if (info.type === 'wired' && port) {
          try {
            const success = await printToWiredPort(invoiceId, port);
            if (success) {
              toast({ 
                title: "Print Sent", 
                description: "Invoice sent to wired printer successfully.",
                className: "bg-green-50 border-green-200 text-green-800" 
              });
              setPreviewDialogOpen(false);
              return;
            }
          } catch (error) {
            console.error('Wired print failed:', error);
            // Continue to fallback options if wired fails
          }
        }
      }

      // If no connected printers found or existing connections failed, try to discover new printers
      const isDesktop = !(/Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent));
      
      let wiredSuccess = false;
      let bluetoothSuccess = false;

      // On desktop, try wired thermal printers first
      if (isDesktop && 'serial' in navigator) {
        toast({
          title: "Connecting to Printer",
          description: "Checking for wired thermal printer...",
          variant: "default"
        });
        
        wiredSuccess = await tryWiredThermalPrint(invoiceId);
        if (wiredSuccess) {
          toast({ 
            title: "Print Sent", 
            description: "Invoice sent to wired thermal printer successfully.",
            className: "bg-green-50 border-green-200 text-green-800" 
          });
          setPreviewDialogOpen(false);
          return;
        }
      }

      // Fallback to Bluetooth thermal printer discovery
      if (!wiredSuccess) {
        bluetoothSuccess = await tryBluetoothThermalPrint(invoiceId);
        if (bluetoothSuccess) {
          toast({ 
            title: "Print Sent", 
            description: "Invoice sent to Bluetooth thermal printer successfully.",
            className: "bg-green-50 border-green-200 text-green-800" 
          });
          setPreviewDialogOpen(false);
          return;
        }
      }

      // If both methods fail, show helpful message
      const helpMessage = isDesktop ? 
        "Please connect a wired thermal printer via USB or setup a Bluetooth thermal printer in Settings. Make sure the printer is powered on." :
        "Please setup a Bluetooth thermal printer in Settings or connect a wired printer via USB adapter. Make sure the printer is powered on.";
        
      toast({ 
        title: "No Thermal Printer Found", 
        description: helpMessage, 
        variant: "destructive" 
      });
      
    } catch (error) {
      console.error('Thermal print failed:', error);
      toast({ 
        title: "Print Failed", 
        description: "Failed to send to thermal printer. " + (error.message || ''), 
        variant: "destructive" 
      });
    }
  };

  const reconnectToPrinter = async (printerInfo: any) => {
    try {
      // Request the same device again using Web Bluetooth API
      const device = await navigator.bluetooth?.requestDevice({
        filters: [
          { namePrefix: printerInfo.name },
          { services: ['000018f0-0000-1000-8000-00805f9b34fb'] },
          { services: ['49535343-fe7d-4ae5-8fa9-9fafd205e455'] },
          { services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }
        ],
        optionalServices: [
          'generic_access', 
          'generic_attribute',
          '000018f0-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455',
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
        ]
      });

      if (device && device.id === printerInfo.id) {
        // Connect to the device
        if (!device.gatt?.connected) {
          await device.gatt?.connect();
        }
        
        // Update localStorage to maintain connection state
        const sessions = JSON.parse(localStorage.getItem('bluetooth_printer_sessions') || '[]');
        const updatedSessions = sessions.map((s: any) => 
          s.id === device.id ? { ...s, isConnected: true } : s
        );
        localStorage.setItem('bluetooth_printer_sessions', JSON.stringify(updatedSessions));
        
        return device;
      }
      
      return null;
    } catch (error) {
      console.error('Reconnection failed:', error);
      return null;
    }
  };

  const generateThermalPrintData = async (invoiceId: string) => {
    if (!user) throw new Error('User not authenticated');
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) throw new Error('Account details missing');

    // Get invoice data
    const resp: any = await InvoiceService.get(invoiceId, acc, ret);
    if (!resp?.success || !resp?.data) {
      throw new Error('Failed to fetch invoice data');
    }

    const invoiceData = resp.data;
    const header = resp.header || {};
    
    // Extract details
    const invoiceFromList = sourceInvoices.find(inv => inv.id === invoiceId);
    const customerName = invoiceFromList?.customer || 'Customer';
    const customerPhone = invoiceFromList?.customerPhone || '';
    
    // Calculate totals
    // Requirement: Subtotal/Total should NOT include tax.
    let subtotal = 0;
    let totalTax = 0;
    let discount = 0;
    
    invoiceData.forEach((item: any) => {
      const quantity = Number(item.quantity || item.qty || 1);
      const unitPrice = Number(item.unit_price || item.price || item.rate || 0);
      const grossTotal = Number(item.item_total || item.grand_total || item.total || item.amount || item.line_total || (quantity * unitPrice) || 0);
      const itemTax =
        Number(
          item.tax_amount ??
            item.total_tax ??
            item.tax ??
            item.gst_amount ??
            ((Number(item.cgst_amount) || 0) + (Number(item.sgst_amount) || 0) + (Number(item.igst_amount) || 0))
        ) || 0;

      subtotal += Math.max(0, grossTotal - itemTax);
      totalTax += itemTax;
      discount += Number(item.discount_amount || item.discount || 0) || 0;
    });
    
    // If subtotal is still 0, try to calculate from unit price * quantity
    if (subtotal === 0) {
      invoiceData.forEach((item: any) => {
        const quantity = Number(item.quantity || item.qty || 1);
        const unitPrice = Number(item.unit_price || item.price || item.rate || 0);
        subtotal += (quantity * unitPrice);
      });
    }
    
    // Grand total should include tax
    const total = subtotal + totalTax - discount;
    const roundedTotal = Math.round(total);

    // Get employee name for use throughout the receipt
    let employeeName = '';
    const employeeNameSources = [
      header?.employee_name,
      header?.txn_employee_name,
      invoiceData[0]?.employee_name,
      invoiceData[0]?.txn_employee_name,
      invoiceData[0]?.staff_name
    ];
    
    for (const source of employeeNameSources) {
      if (source && String(source).trim()) {
        employeeName = String(source).trim();
        break;
      }
    }

    // ESC/POS command constants
    const ESC = 0x1B;
    const GS = 0x1D;
    const LF = 0x0A;
    const CR = 0x0D;
    const commands = [];

    // 2-inch printers are typically ~32 characters wide in a standard font.
    const LINE_WIDTH = 32;
    const formatLine = (left: string, right: string) => {
      const safeLeft = String(left ?? '');
      const safeRight = String(right ?? '');
      const spaceCount = Math.max(1, LINE_WIDTH - safeLeft.length - safeRight.length);
      return safeLeft + ' '.repeat(spaceCount) + safeRight;
    };
    
    // Initialize printer with optimized setup for 2-inch (50mm) paper
    commands.push(ESC, 0x40); // ESC @ - Initialize printer
    commands.push(ESC, 0x74, 0x00); // Select character code table (PC437/USA)
    commands.push(ESC, 0x4D, 0x01); // Select font B (9x17) - smaller font for 2-inch paper
    commands.push(ESC, 0x21, 0x00); // Reset character size
    commands.push(ESC, 0x7B, 0x00); // Upside down printing OFF (0x00 = OFF, 0x01 = ON)
    commands.push(GS, 0x21, 0x00); // Reset character size (alternative command)
    commands.push(ESC, 0x45, 0x01); // Bold on for entire receipt
    commands.push(ESC, 0x61, 0x00); // Left alignment as default
    commands.push(GS, 0x7C, 0x00, 0x02, 0x01, 0x64); // Set print density to maximum
    commands.push(ESC, 0x7D, 0x03); // Set printing speed (slower for darker print)
    commands.push(LF); // Line feed to ensure proper spacing
    
    // Header section with centered company information
    commands.push(ESC, 0x61, 0x01); // Center alignment
    commands.push(ESC, 0x21, 0x10); // Double width for company name
    commands.push(ESC, 0x45, 0x01); // Bold on
    
    // Company name
    const companyName = company?.name || 'Techies Magnifier';
    const companyBytes = new TextEncoder().encode(companyName + '\n');
    commands.push(...Array.from(companyBytes));
    
    // Reset to normal size for address and contact
    commands.push(ESC, 0x21, 0x00); // Normal size
    commands.push(ESC, 0x4D, 0x01); // Font B for compact layout
    
    // Company address and contact information
    if (company?.address) {
      const addressBytes = new TextEncoder().encode(company.address + '\n');
      commands.push(...Array.from(addressBytes));
    }
    
    if (company?.phone) {
      const phoneBytes = new TextEncoder().encode('Ph: ' + company.phone + '\n');
      commands.push(...Array.from(phoneBytes));
    }
    
    // Separator line matching preview (fit to 2-inch width)
    const separatorLine = new TextEncoder().encode('-'.repeat(LINE_WIDTH) + '\n');
    commands.push(...Array.from(separatorLine));
    
    // Invoice details section - with proper 2-inch printer alignment
    commands.push(ESC, 0x61, 0x00); // Left alignment
    commands.push(ESC, 0x21, 0x00); // Normal size
    
    const currentDate = new Date();
    
    // Invoice line with right-aligned date for 2-inch printer
    const invoiceText = `Invoice: ${invoiceId}`;
    const dateStr = format(currentDate, 'dd/MM/yyyy');
    // Use LINE_WIDTH character width for 2-inch printer
    const spacesNeeded = Math.max(1, LINE_WIDTH - (invoiceText.length + dateStr.length));
    const invoiceDateBytes = new TextEncoder().encode(invoiceText + ' '.repeat(spacesNeeded) + dateStr + '\n');
    commands.push(...Array.from(invoiceDateBytes));
    
    // Time
    const timeBytes = new TextEncoder().encode(`Time: ${format(currentDate, 'hh:mm a')}\n`);
    commands.push(...Array.from(timeBytes));
    
    // Customer information section matching preview
    if (customerName !== 'Customer') {
      const custBytes = new TextEncoder().encode(`Customer: ${customerName}\n`);
      commands.push(...Array.from(custBytes));
    }
    
    if (customerPhone) {
      const phoneBytes = new TextEncoder().encode(`Phone: ${customerPhone}\n`);
      commands.push(...Array.from(phoneBytes));
    }
    
    if (employeeName) {
      const staffBytes = new TextEncoder().encode(`Staff: ${employeeName}\n`);
      commands.push(...Array.from(staffBytes));
    }
    
    // Separator after customer info
    commands.push(...Array.from(separatorLine));
    
    // Services section matching preview layout
    invoiceData.forEach((item: any) => {
      const itemName = item.service_name || item.product_name || item.package_name || item.item_name || item.name || 'Service';
      const quantity = Number(item.quantity || item.qty || 1);
      const unitPrice = Number(item.unit_price || item.price || item.rate || 0);
      const grossTotal = Number(item.item_total || item.grand_total || item.total || item.amount || item.line_total || (quantity * unitPrice) || 0);
      const itemTax =
        Number(
          item.tax_amount ??
            item.total_tax ??
            item.tax ??
            item.gst_amount ??
            ((Number(item.cgst_amount) || 0) + (Number(item.sgst_amount) || 0) + (Number(item.igst_amount) || 0))
        ) || 0;
      const baseTotal = Math.max(0, grossTotal - itemTax);
      const effectiveUnitPrice = quantity > 0 ? baseTotal / quantity : unitPrice;
      
      // Service name
      const serviceBytes = new TextEncoder().encode(itemName + '\n');
      commands.push(...Array.from(serviceBytes));
      
      // Quantity x rate (left) and amount (right) on same line
      const left = `${quantity} x Rs${effectiveUnitPrice.toFixed(2)}`;
      const right = `Rs${baseTotal.toFixed(2)}`;
      const itemLine = (left.length + 1 + right.length <= LINE_WIDTH)
        ? formatLine(left, right)
        : `${left}\n${right}`;
      const itemLineBytes = new TextEncoder().encode(itemLine + '\n');
      commands.push(...Array.from(itemLineBytes));
    });
    
    // Separator before totals
    commands.push(...Array.from(separatorLine));
    
    // Totals section matching preview layout (label left, amount right)
    const subtotalBytes = new TextEncoder().encode(formatLine('Subtotal:', 'Rs' + subtotal.toFixed(2)) + '\n');
    commands.push(...Array.from(subtotalBytes));
    
    if (totalTax > 0) {
      const taxBytes = new TextEncoder().encode(formatLine('Tax:', 'Rs' + totalTax.toFixed(2)) + '\n');
      commands.push(...Array.from(taxBytes));
    }
    
    if (discount > 0) {
      const discountBytes = new TextEncoder().encode(formatLine('Discount:', '-Rs' + discount.toFixed(2)) + '\n');
      commands.push(...Array.from(discountBytes));
    }
    
    // Total line
    const totalBytes = new TextEncoder().encode(formatLine('Total:', 'Rs' + String(roundedTotal)) + '\n');
    commands.push(...Array.from(totalBytes));
    
    // Footer section matching preview layout
    commands.push(ESC, 0x61, 0x01); // Center alignment
    
    const thankYouBytes = new TextEncoder().encode('\nThank you for visiting!\n');
    commands.push(...Array.from(thankYouBytes));
    
    const visitAgainBytes = new TextEncoder().encode('Please visit again\n');
    commands.push(...Array.from(visitAgainBytes));
    
    // Final separator
    commands.push(...Array.from(separatorLine));
    
    // Powered by branding
    const brandingBytes = new TextEncoder().encode('Powered by GYM Pro\n');
    commands.push(...Array.from(brandingBytes));
    
    // Turn off bold and ensure proper paper feed before cutting
    commands.push(ESC, 0x45, 0x00); // Bold off
    commands.push(ESC, 0x61, 0x00); // Left alignment
    commands.push(LF, LF, LF); // Extra line feeds for paper clearance
    
    // Cut paper
    commands.push(GS, 0x56, 0x00); // Full cut
    
    return new Uint8Array(commands);
  };

  const sendToBluetooth = async (device: any, data: Uint8Array) => {
    if (!device || !device.gatt) {
      throw new Error('Invalid printer device');
    }

    // Ensure device is connected
    if (!device.gatt.connected) {
      try {
        await device.gatt.connect();
      } catch (error) {
        throw new Error('Failed to connect to printer');
      }
    }

    // Try different service and characteristic UUIDs for thermal printers
    const serviceUUIDs = [
      '000018f0-0000-1000-8000-00805f9b34fb', // Standard printer service
      '49535343-fe7d-4ae5-8fa9-9fafd205e455', // HM-10 service
      '6e400001-b5a3-f393-e0a9-e50e24dcca9e'  // Nordic UART service
    ];
    
    const characteristicUUIDs = [
      '00002af1-0000-1000-8000-00805f9b34fb', // Write characteristic
      '49535343-8841-43f4-a8d4-ecbe34729bb3', // Write characteristic
      '6e400002-b5a3-f393-e0a9-e50e24dcca9e'  // TX characteristic
    ];

    let printed = false;
    
    for (const serviceUUID of serviceUUIDs) {
      if (printed) break;
      
      try {
        const service = await device.gatt.getPrimaryService(serviceUUID);
        
        for (const charUUID of characteristicUUIDs) {
          try {
            const characteristic = await service.getCharacteristic(charUUID);
            
            if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
              // Send data in chunks (thermal printers have MTU limitations)
              const chunkSize = 20;
              for (let i = 0; i < data.length; i += chunkSize) {
                const chunk = data.slice(i, i + chunkSize);
                
                if (characteristic.properties.writeWithoutResponse) {
                  await characteristic.writeValueWithoutResponse(chunk);
                } else {
                  await characteristic.writeValue(chunk);
                }
                
                // Small delay between chunks
                await new Promise(resolve => setTimeout(resolve, 50));
              }
              
              printed = true;
              break;
            }
          } catch (charError) {
            console.log(`Characteristic ${charUUID} not available:`, charError);
            continue;
          }
        }
      } catch (serviceError) {
        console.log(`Service ${serviceUUID} not available:`, serviceError);
        continue;
      }
    }
    
    if (!printed) {
      throw new Error('Could not find writable characteristic for printing');
    }
  };

  // Global printer connection manager (updated for both Bluetooth and wired printers)
  const getPrinterConnection = async () => {
    // Try new unified storage first, fall back to old storage
    let savedSessions = localStorage.getItem('thermal_printer_sessions');
    if (!savedSessions) {
      savedSessions = localStorage.getItem('bluetooth_printer_sessions');
    }
    
    const printerSessions = savedSessions ? JSON.parse(savedSessions) : [];
    const connectedPrinter = printerSessions.find((p: any) => p.isConnected);
    
    if (!connectedPrinter) {
      return null;
    }

    // Handle Bluetooth printers
    if (connectedPrinter.type === 'bluetooth' || !connectedPrinter.type) {
      // Try to get device from global window object if stored
      const globalPrinters = (window as any).bluetoothPrinters || {};
      let device = globalPrinters[connectedPrinter.id];
      
      if (!device || !device.gatt?.connected) {
        // Try to reconnect
        device = await reconnectToPrinter(connectedPrinter);
        
        if (device) {
          // Store in global window object for persistence across pages
          if (!(window as any).bluetoothPrinters) {
            (window as any).bluetoothPrinters = {};
          }
          (window as any).bluetoothPrinters[connectedPrinter.id] = device;
          
          // Add disconnect listener to clean up
          device.addEventListener('gattserverdisconnected', () => {
            delete (window as any).bluetoothPrinters[connectedPrinter.id];
            // Update localStorage for both old and new keys
            const updateSessions = (key: string) => {
              const sessions = JSON.parse(localStorage.getItem(key) || '[]');
              const updatedSessions = sessions.map((s: any) => 
                s.id === connectedPrinter.id ? { ...s, isConnected: false } : s
              );
              localStorage.setItem(key, JSON.stringify(updatedSessions));
            };
            updateSessions('bluetooth_printer_sessions');
            updateSessions('thermal_printer_sessions');
          });
        }
      }
      
      return { device, info: connectedPrinter };
    }

    // Handle wired printers
    if (connectedPrinter.type === 'wired') {
      // For wired printers, we need to check if the port is still available
      if ('serial' in navigator) {
        try {
          const savedPorts = await (navigator as any).serial.getPorts();
          const matchingPort = savedPorts.find((port: any) => {
            const info = port.getInfo();
            return info.usbVendorId === connectedPrinter.vendorId && 
                   info.usbProductId === connectedPrinter.productId;
          });
          
          if (matchingPort) {
            return { 
              device: null, // Wired printers don't have persistent device objects
              port: matchingPort,
              info: connectedPrinter 
            };
          }
        } catch (error) {
          console.error('Failed to check wired printer availability:', error);
        }
      }
      return null;
    }
    
    return null;
  };

  const handlePrintInvoice = async (invoiceId: string, printerType: 'auto' | 'thermal' | 'standard' | 'a4' = 'auto') => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    try {
      // First try to get customer name from the already loaded invoice list
      const invoiceFromList = sourceInvoices.find(inv => inv.id === invoiceId);
      let preKnownCustomerName = '';
      if (invoiceFromList && invoiceFromList.customer && invoiceFromList.customer !== 'Customer') {
        preKnownCustomerName = invoiceFromList.customer;

      }
      
      // No background overrides anymore; rely on list/master data only
      // Fetch invoice details
      const resp: any = await InvoiceService.get(invoiceId, acc, ret);
      if (!resp?.success || !resp?.data) {
        toast({
          title: "Error",
          description: "Failed to fetch invoice details",
          variant: "destructive"
        });
        return;
      }

      const invoiceData = resp.data;
      const header = resp.header || {};
      
      // Debug: Log the complete response to understand structure
      console.log('[PRINT DEBUG] Complete invoice response:', {
        data: resp.data,
        header: resp.header,
        dataLength: resp.data?.length,
        firstItem: resp.data?.[0],
        allItems: resp.data
      });
      
      // Process all line items - they might all be in the main data array
      let allLineItems = [];
      
      if (Array.isArray(invoiceData) && invoiceData.length > 0) {
        // Process each item and try to identify its type
        invoiceData.forEach((item: any, index: number) => {
          console.log(`[PRINT DEBUG] Processing item ${index}:`, {
            raw: item,
            service_name: item.service_name,
            package_name: item.package_name,
            product_name: item.product_name,
            item_name: item.item_name,
            unit_price: item.unit_price,
            price: item.price,
            qty: item.qty,
            quantity: item.quantity,
            tax_amount: item.tax_amount,
            allFields: Object.keys(item)
          });
          
          // Determine item details
          const itemName = item.service_name || item.package_name || item.product_name || 
                          item.item_name || item.name || item.description || 'Item';
          
          if (itemName !== 'Item') {
            const processedItem = {
              ...item,
              processed_name: itemName,
              processed_type: item.service_name ? 'Service' : 
                             item.package_name ? 'Package' : 
                             item.product_name ? 'Product' : 'Item'
            };
            allLineItems.push(processedItem);
            console.log(`[PRINT DEBUG] Added item:`, processedItem);
          }
        });
      }
      
      // Also check for separate arrays (backup)
      if (resp.packages && Array.isArray(resp.packages)) {
        console.log('[PRINT DEBUG] Found packages array:', resp.packages);
        allLineItems.push(...resp.packages.map((pkg: any) => ({...pkg, item_type: 'package'})));
      }
      
      if (resp.services && Array.isArray(resp.services)) {
        console.log('[PRINT DEBUG] Found services array:', resp.services);
        allLineItems.push(...resp.services.map((svc: any) => ({...svc, item_type: 'service'})));
      }
      
      console.log('[PRINT DEBUG] Total collected items:', allLineItems.length, allLineItems);
      
      // Use the collected items
      const finalInvoiceData = allLineItems;
      
      // Extract customer and business information with improved field checking
      let customerName = preKnownCustomerName || 'Customer'; // Start with pre-known name if available
      let customerPhone = '';
      let employeeName = '';
      
      // Only search for customer name if we don't already have it from the list
      if (!preKnownCustomerName) {
        // Try multiple sources and field names for customer name
        const customerNameSources = [
          header?.customer_name,
          header?.txn_customer_name,
          header?.customerName,
          invoiceData[0]?.customer_name,
          invoiceData[0]?.txn_customer_name,
          invoiceData[0]?.customerName,
          invoiceData[0]?.customer_full_name,
          invoiceData[0]?.full_name
        ];
      
        for (const source of customerNameSources) {
          const name = String(source || '').trim();
          if (name && name !== 'Customer' && name !== 'null' && name !== 'undefined' && name.length > 0) {
            customerName = name;
            break;
          }
        }
        
        // If still no name found, try customer ID lookup
        if (customerName === 'Customer') {
          const customerIds = [
            header?.customer_id,
            invoiceData[0]?.customer_id,
            header?.CUSTOMER_ID,
            invoiceData[0]?.CUSTOMER_ID
          ];
          
          for (const id of customerIds) {
            if (id != null && id !== '') {
              const key = String(id).trim();
              if (key && custMap[key]) {
                customerName = custMap[key];
                break;
              }
            }
          }
        }
      }      // Extract phone number
      const phoneNumberSources = [
        header?.customer_number,
        header?.customer_phone,
        invoiceData[0]?.customer_number,
        invoiceData[0]?.customer_phone,
        invoiceData[0]?.phone,
        invoiceData[0]?.mobile
      ];
      
      for (const source of phoneNumberSources) {
        const phone = String(source || '').trim();
        if (phone && phone !== 'null' && phone !== 'undefined' && phone.length > 0) {
          customerPhone = phone;
          break;
        }
      }
      
      // Extract employee name
      const employeeNameSources = [
        header?.employee_name,
        header?.txn_employee_name,
        invoiceData[0]?.employee_name,
        invoiceData[0]?.txn_employee_name,
        invoiceData[0]?.staff_name
      ];
      
      for (const source of employeeNameSources) {
        const name = String(source || '').trim();
        if (name && name !== 'null' && name !== 'undefined' && name.length > 0) {
          employeeName = name;
          break;
        }
      }
      
      // If no employee name found, try employee ID lookup
      if (!employeeName) {
        const employeeIds = [
          header?.employee_id,
          invoiceData[0]?.employee_id,
          header?.EMPLOYEE_ID,
          invoiceData[0]?.EMPLOYEE_ID
        ];
        
        for (const id of employeeIds) {
          if (id != null && id !== '') {
            const key = String(id).trim();
            if (key && empMap[key]) {
              employeeName = empMap[key];
              break;
            }
          }
        }
      }
      

      
      // Calculate totals for all item types (services, packages, inventory)
      let subtotal = 0;
      let totalTax = 0;
      let discount = 0;
      
      finalInvoiceData.forEach((item: any) => {
        const qty = item.qty || item.quantity || 1;
        const unitPrice = item.unit_price || item.price || 0;
        const itemSubtotal = unitPrice * qty;
        subtotal += itemSubtotal;
        totalTax += item.tax_amount || item.cgst_amount || item.sgst_amount || 0;
        discount += item.discount_amount || 0;
      });
      
      console.log('[PRINT DEBUG] Calculated totals:', { subtotal, totalTax, discount });
      
      // Calculate round-off
      const beforeRoundOff = subtotal + totalTax - discount;
      const total = Math.round(beforeRoundOff);
      const roundOff = total - beforeRoundOff;
      
      // Detect printer capabilities for optimized layout
      const printerInfo = printerType === 'auto' ? detectPrinterType() : {
        isThermal: printerType === 'thermal',
        isNarrow: printerType === 'thermal' || printerType === 'standard',
        supportsColor: printerType === 'a4',
        recommendedWidth: printerType === 'thermal' ? '72mm' : printerType === 'standard' ? '80mm' : 'auto'
      };
      
      // Create responsive receipt for all printer types with auto-detection
      const printContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Receipt - ${invoiceId}</title>
          <style>
            * { 
              box-sizing: border-box; 
              margin: 0; 
              padding: 0; 
            }
            
            /* Base styles */
            body {
              font-family: 'Courier New', 'Arial', monospace;
              background: white;
              color: black;
              line-height: 1.4;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            
            /* Container that adapts to different printer widths */
            .receipt {
              width: 100%;
              background: white;
              padding: 4mm;
              margin: 0 auto;
            }
            
            /* Thermal printer optimized layout */
            .receipt.thermal-optimized {
              font-size: 12px;
              padding: 2mm;
              line-height: 1.3;
            }
            
            .receipt.thermal-optimized .business-name {
              font-size: 15px;
            }
            
            .receipt.thermal-optimized .items-table th,
            .receipt.thermal-optimized .items-table td {
              padding: 0.2em 0.1em;
              font-size: 11px;
            }
            
            /* Standard receipt printer optimized layout */
            .receipt.standard-optimized {
              font-size: 11px;
              padding: 3mm;
              line-height: 1.3;
              max-width: 80mm;
            }
            
            .receipt.standard-optimized .business-name {
              font-size: 14px;
            }
            
            .receipt.standard-optimized .items-table th,
            .receipt.standard-optimized .items-table td {
              padding: 0.3em 0.2em;
              font-size: 10px;
            }
            
            /* A4 printer optimized layout */
            .receipt.a4-optimized {
              font-size: 12px;
              padding: 10mm;
              line-height: 1.4;
              max-width: 120mm;
              margin: 0 auto;
              border: 1px solid #000;
            }
            
            .receipt.a4-optimized .business-name {
              font-size: 18px;
            }
            
            .receipt.a4-optimized .receipt-title {
              font-size: 16px;
              padding: 0.8em;
            }
            
            .receipt.a4-optimized .items-table th,
            .receipt.a4-optimized .items-table td {
              padding: 0.5em 0.3em;
              font-size: 11px;
            }
            
            .receipt.a4-optimized .info-section,
            .receipt.a4-optimized .totals,
            .receipt.a4-optimized .payment-section {
              font-size: 11px;
            }
            
            /* Typography scaling based on container width */
            .receipt {
              font-size: clamp(11px, 3vw, 15px);
            }
            
            .header {
              text-align: center;
              border-bottom: 2px solid #000;
              padding-bottom: 1em;
              margin-bottom: 1em;
            }
            
            .business-name {
              font-size: 1.6em;
              font-weight: bold;
              margin-bottom: 0.3em;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            
            .business-info {
              font-size: 0.95em;
              line-height: 1.4;
              color: #333;
            }
            
            .receipt-title {
              font-size: 1.4em;
              font-weight: bold;
              text-align: center;
              margin: 1em 0;
              text-transform: uppercase;
              letter-spacing: 1px;
              border: 2px solid #000;
              padding: 0.5em;
            }
            
            .info-section {
              margin-bottom: 1em;
              font-size: 1.05em;
            }
            
            .info-row {
              display: flex;
              justify-content: space-between;
              margin-bottom: 0.2em;
              word-wrap: break-word;
            }
            
            .info-row strong {
              font-weight: bold;
            }
            
            .divider {
              border-top: 1px dashed #000;
              margin: 1em 0;
              width: 100%;
            }
            
            /* Responsive table for different printer widths */
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 1em;
              font-size: 1em;
            }
            
            .items-table th,
            .items-table td {
              padding: 0.3em 0.2em;
              border: none;
              text-align: left;
              word-wrap: break-word;
              overflow-wrap: break-word;
            }
            
            .items-table th {
              font-weight: bold;
              border-bottom: 2px solid #000;
              background: #f5f5f5;
              text-transform: uppercase;
              font-size: 0.95em;
            }
            
            .items-table td:nth-child(1),
            .items-table th:nth-child(1) {
              width: 45%;
              text-align: left;
            }
            
            .items-table td:nth-child(2),
            .items-table th:nth-child(2) {
              width: 15%;
              text-align: center;
            }
            
            .items-table td:nth-child(3),
            .items-table th:nth-child(3) {
              width: 20%;
              text-align: right;
            }
            
            .items-table td:nth-child(4),
            .items-table th:nth-child(4) {
              width: 20%;
              text-align: right;
              font-weight: bold;
            }
            
            .items-table tbody tr:nth-child(even) {
              background: #f9f9f9;
            }
            
            .totals {
              margin-bottom: 1em;
              font-size: 1.05em;
              border-top: 1px solid #000;
              padding-top: 0.5em;
            }
            
            .total-row {
              display: flex;
              justify-content: space-between;
              margin-bottom: 0.3em;
              padding: 0.1em 0;
            }
            
            .total-row.grand {
              font-weight: bold;
              font-size: 1.3em;
              border-top: 2px solid #000;
              border-bottom: 2px solid #000;
              padding: 0.5em 0;
              margin-top: 0.5em;
              background: #f0f0f0;
            }
            
            .payment-section {
              margin-bottom: 1em;
              font-size: 1.05em;
              border: 1px solid #000;
              padding: 0.5em;
            }
            
            .footer {
              text-align: center;
              border-top: 2px solid #000;
              padding-top: 1em;
              font-size: 1em;
              font-style: italic;
            }
            
            /* Thermal printer optimizations (58mm) */
            @media print and (max-width: 70mm) {
              .receipt {
                font-size: 11px;
                padding: 2mm;
              }
              .business-name {
                font-size: 15px;
              }
              .receipt-title {
                font-size: 13px;
                padding: 0.3em;
              }
              .items-table th,
              .items-table td {
                padding: 0.2em 0.1em;
                font-size: 10px;
              }
            }
            
            /* Standard receipt printer (80mm) */
            @media print and (min-width: 70mm) and (max-width: 90mm) {
              .receipt {
                font-size: 13px;
                padding: 3mm;
              }
              .business-name {
                font-size: 17px;
              }
              .receipt-title {
                font-size: 15px;
              }
              .items-table th,
              .items-table td {
                font-size: 12px;
              }
            }
            
            /* A4 and larger printers */
            @media print and (min-width: 90mm) {
              .receipt {
                max-width: 80mm;
                font-size: 14px;
                padding: 5mm;
                margin: 0 auto;
                border: 1px solid #000;
              }
              .business-name {
                font-size: 19px;
              }
              .receipt-title {
                font-size: 17px;
              }
              .items-table th,
              .items-table td {
                font-size: 13px;
              }
            }
            
            /* Print-specific adjustments */
            @media print {
              body {
                margin: 0;
                padding: 0;
              }
              .receipt {
                box-shadow: none;
                border-radius: 0;
              }
              /* Ensure black text prints properly */
              * {
                -webkit-print-color-adjust: exact !important;
                color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            
            /* Dynamic page sizing based on printer type */
            @page {
              margin: 0;
              size: auto;
            }
            
            /* Thermal printer page setup */
            @page thermal {
              size: 58mm auto;
              margin: 2mm;
            }
            
            /* Standard receipt printer page setup */  
            @page standard {
              size: 80mm auto;
              margin: 3mm;
            }
            
            /* A4 printer page setup */
            @page a4 {
              size: A4 portrait;
              margin: 10mm;
            }
            
            /* Apply page styles based on class */
            .receipt.thermal-optimized {
              page: thermal;
            }
            
            .receipt.standard-optimized {
              page: standard;
            }
            
            .receipt.a4-optimized {
              page: a4;
            }
            
            /* Fallback for very narrow printers */
            @media (max-width: 250px) {
              .receipt {
                font-size: 10px;
              }
              .info-row {
                flex-direction: column;
                gap: 0.2em;
              }
              .total-row {
                flex-direction: column;
                gap: 0.1em;
              }
              .items-table {
                font-size: 9px;
              }
              .business-name {
                font-size: 13px;
              }
            }
          </style>
        </head>
        <body>
          <div class="receipt ${
            printerType === 'thermal' || printerInfo.isThermal ? 'thermal-optimized' : 
            printerType === 'standard' ? 'standard-optimized' : 
            printerType === 'a4' ? 'a4-optimized' : ''
          }">
            <div class="header">
              <div class="business-name">${company?.name || (user as any)?.business_name || 'Techies Magnifier'}</div>
              <div class="business-info">
                ${company?.address || (user as any)?.business_address || 'No.7, CTH Road, Redhills city, Pattabiram-600072'}<br>
                Phone: ${company?.phone || (user as any)?.business_phone || '+918344816562'}<br>
                Email: ${company?.email || (user as any)?.business_email || 'teamit@selt.com'}
              </div>
            </div>
            
            <div class="receipt-title">RECEIPT</div>
            
            <div class="info-section">
              <div class="info-row">
                <span><strong>Bill No.:</strong> ${invoiceId}</span>
              </div>
              ${(() => { try { const _d = normalizeToISTDate(header.created_at || header.last_created_at || header.last_updated_at || invoiceData?.[0]?.created_at || Date.now()); return `
              <div class=\"info-row\">
                <span><strong>Date:</strong> ${format(_d, 'dd/MM/yyyy')}</span>
              </div>
              <div class=\"info-row\">
                <span><strong>Time:</strong> ${format(_d, 'hh:mm:ss a')}</span>
              </div>`; } catch { const _d = new Date(); return `
              <div class=\"info-row\">
                <span><strong>Date:</strong> ${format(_d, 'dd/MM/yyyy')}</span>
              </div>
              <div class=\"info-row\">
                <span><strong>Time:</strong> ${format(_d, 'hh:mm:ss a')}</span>
              </div>`; } })()}
            </div>
            
            <div class="info-section">
              <div class="info-row">
                <span><strong>Customer:</strong> ${customerName || 'soundar'}</span>
              </div>
              ${employeeName ? `
              <div class="info-row">
                <span><strong>Staff:</strong> ${employeeName}</span>
              </div>
              ` : ''}
            </div>
            
            <div class="divider"></div>
            
            <table class="items-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Rate</th>
                  <th>Qty</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${finalInvoiceData.map((item: any, index: number) => {
                  // Use processed names if available, fallback to original logic
                  const itemName = item.processed_name || item.service_name || item.package_name || 
                                 item.product_name || item.item_name || item.name || 'Unknown Item';
                  const itemType = item.processed_type || 
                                 (item.service_name ? 'Service' : 
                                  item.package_name ? 'Package' : 
                                  item.product_name ? 'Product' : 
                                  item.item_type || 'Item');
                  
                  const qty = item.qty || item.quantity || 1;
                  const unitPrice = item.unit_price || item.price || 0;
                  const taxAmount = item.tax_amount || item.cgst_amount || item.sgst_amount || 0;
                  const itemTotal = (unitPrice * qty) + taxAmount;
                  
                  console.log(`[PRINT DEBUG] Rendering item ${index}:`, { 
                    itemName, itemType, qty, unitPrice, taxAmount, itemTotal 
                  });
                  
                  return `
                <tr>
                  <td>${itemName}</td>
                  <td>${itemType}</td>
                  <td>₹${unitPrice.toFixed(0)}</td>
                  <td>${qty}</td>
                  <td>₹${itemTotal.toFixed(0)}</td>
                </tr>
                `;
                }).join('')}
              </tbody>
            </table>
            
            <div class="divider"></div>
            
            <div class="totals">
              <div class="total-row">
                <span>Subtotal:</span>
                <span>₹${subtotal.toFixed(0)}</span>
              </div>
              ${totalTax > 0 ? `
              <div class="total-row">
                <span>Tax:</span>
                <span>₹${totalTax.toFixed(2)}</span>
              </div>
              ` : ''}
              ${discount > 0 ? `
              <div class="total-row">
                <span>Discount:</span>
                <span>-₹${discount.toFixed(2)}</span>
              </div>
              ` : ''}
              ${Math.abs(roundOff) > 0.01 ? `
              <div class="total-row">
                <span>Round-off:</span>
                <span>${roundOff >= 0 ? '' : '-'}₹${Math.abs(roundOff).toFixed(2)}</span>
              </div>
              ` : ''}
              <div class="total-row grand">
                <span>Total:</span>
                <span>₹${total.toFixed(0)}</span>
              </div>
            </div>
            
            <div class="payment-section">
              <div class="info-row">
                <span><strong>Payment Mode:</strong> CASH</span>
              </div>
              <div class="info-row">
                <span><strong>Amount Paid:</strong> ₹${total.toFixed(0)}</span>
              </div>
            </div>
            
            <div class="divider"></div>
            
            <div class="footer">
              Thank You, Visit Again<br>
              Have a Nice Day
            </div>
          </div>
        </body>
        <script>
          // Dynamic printer optimization on load
          (function() {
            const receipt = document.querySelector('.receipt');
            if (!receipt) return;
            
            // Detect actual print width and adjust accordingly
            function optimizeForPrinter() {
              const printWidth = window.innerWidth;
              
              // Very narrow (thermal printers)
              if (printWidth <= 300) {
                receipt.classList.add('thermal-optimized');
                receipt.style.fontSize = '9px';
                receipt.style.padding = '2mm';
              }
              // Standard receipt printers
              else if (printWidth <= 400) {
                receipt.style.fontSize = '10px';
                receipt.style.padding = '3mm';
              }
              // Regular printers
              else {
                receipt.style.fontSize = '11px';
                receipt.style.padding = '4mm';
                receipt.style.maxWidth = '80mm';
                receipt.style.border = '1px solid #000';
              }
            }
            
            // Apply optimizations
            optimizeForPrinter();
            
            // Re-optimize on window resize (useful for print preview)
            window.addEventListener('resize', optimizeForPrinter);
            
            // Auto-fit text if needed
            function autoFitText() {
              const tables = document.querySelectorAll('.items-table');
              tables.forEach(table => {
                const cells = table.querySelectorAll('td:first-child');
                cells.forEach(cell => {
                  if (cell.scrollWidth > cell.offsetWidth) {
                    cell.style.fontSize = '0.85em';
                    cell.style.wordBreak = 'break-word';
                  }
                });
              });
            }
            
            setTimeout(autoFitText, 100);
            
            // Keyboard shortcuts for print
            document.addEventListener('keydown', function(e) {
              if (e.ctrlKey && e.key === 'p') {
                e.preventDefault();
                window.print();
              }
              if (e.key === 'Escape') {
                window.close();
              }
            });
          })();
        </script>
        </html>
      `;
      
      // Enhanced print dialog with better printer compatibility and responsive sizing
      const windowWidth = printerInfo.isThermal ? 350 : printerInfo.isNarrow ? 450 : 600;
      const windowHeight = printerInfo.isThermal ? 500 : 700;
      const printWindow = window.open('', '_blank', `width=${windowWidth},height=${windowHeight},scrollbars=yes,resizable=yes,menubar=no,toolbar=no,status=no`);
      if (printWindow) {
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.focus();
        
        // Enhanced print handling with printer detection
        printWindow.onload = () => {
          // Add print event listeners for better compatibility
          printWindow.addEventListener('beforeprint', () => {
            // Adjust layout just before printing
            const receipt = printWindow.document.querySelector('.receipt') as HTMLElement;
            if (receipt) {
              // Add any last-minute adjustments here
              receipt.style.pageBreakInside = 'avoid';
            }
          });

          printWindow.addEventListener('afterprint', () => {
            // Close options dialog after successful print
            setPrintOptionsOpen(false);
            setPendingPrintInvoiceId(null);
            setSelectedPrinterType('auto');
            setShowPreview(false);
            // Optional: Close window after printing
            if (!showPreview) {
              setTimeout(() => printWindow.close(), 1000);
            }
          });

          // Only auto-print if not in preview mode
          if (!showPreview) {
            setTimeout(() => {
              try {
                printWindow.print();
              } catch (error) {
                console.error('Print failed:', error);
                toast({
                  title: "Print Error",
                  description: "Print failed. Please try again or check your printer settings.",
                  variant: "destructive"
                });
              }
            }, 500);
          } else {
            // In preview mode, add a print button to the window
            const printBtn = printWindow.document.createElement('button');
            printBtn.innerHTML = '🖨️ Print';
            printBtn.style.cssText = `
              position: fixed;
              top: 10px;
              right: 10px;
              z-index: 1000;
              padding: 8px 16px;
              background: #007bff;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-family: sans-serif;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            `;
            printBtn.onclick = () => {
              printWindow.print();
            };
            printWindow.document.body.appendChild(printBtn);
            
            // Also add a close button
            const closeBtn = printWindow.document.createElement('button');
            closeBtn.innerHTML = '✕ Close';
            closeBtn.style.cssText = `
              position: fixed;
              top: 10px;
              right: 80px;
              z-index: 1000;
              padding: 8px 16px;
              background: #6c757d;
              color: white;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-family: sans-serif;
              box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            `;
            closeBtn.onclick = () => {
              printWindow.close();
              setPrintOptionsOpen(false);
              setPendingPrintInvoiceId(null);
              setSelectedPrinterType('auto');
              setShowPreview(false);
            };
            printWindow.document.body.appendChild(closeBtn);
          }
        };

        // Fallback if onload doesn't fire
        setTimeout(() => {
          if (printWindow.document.readyState === 'complete' && !showPreview) {
            try {
              printWindow.print();
            } catch (error) {
              console.error('Fallback print failed:', error);
              toast({
                title: "Print Error",
                description: "Print failed. Please try using the print button in the preview window.",
                variant: "destructive"
              });
            }
          }
        }, 1000);
        
        // Handle window close event
        printWindow.addEventListener('beforeunload', () => {
          setPrintOptionsOpen(false);
          setPendingPrintInvoiceId(null);
          setSelectedPrinterType('auto');
          setShowPreview(false);
        });
      } else {
        toast({
          title: "Print Error",
          description: "Unable to open print window. Please check your browser settings and disable popup blockers.",
          variant: "destructive"
        });
      }
      
    } catch (error) {
      console.error('Print error:', error);
      toast({
        title: "Error",
        description: "Failed to print invoice",
        variant: "destructive"
      });
    }
  };

  // Fetch invoice detail for dialog (reuses similar logic as InvoiceDetail page)
  const openInvoiceDialog = async (invoiceId: string) => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;
    setSelectedInvoiceId(invoiceId);
    setInvoiceDialogOpen(true);
    setInvoiceLoading(true);
    setInvoiceError(null);
    try {
      const resp: any = await InvoiceService.get(invoiceId, acc, ret);
      if (!resp?.success || !resp?.data) {
        throw new Error('Failed to fetch invoice');
      }
      const lines = resp.data || [];
      const header = (resp as any).header || {};
      // New payments array from API (replaces legacy single payment)
      const payments: any[] = Array.isArray((resp as any).payments) ? (resp as any).payments : [];
      // Keep legacy single payment fallback for older records if needed
      const payment = (resp as any).payment || {};
      const rawPackages: any[] = Array.isArray((resp as any).packages) ? (resp as any).packages : [];
      const rawInventory: any[] = Array.isArray((resp as any).inventory) ? (resp as any).inventory : [];
      const wallet = (resp as any).wallet || [];
      const creditAmountApi = Number((resp as any).credit_amount || 0);

      // Resolve customer and staff names with best-effort logic
      const possibleSources = [header, payment, ...(lines || [])];
      const pickName = (keys: string[], idKeys: string[], map: Record<string,string>) => {
        for (const src of possibleSources) {
          if (!src) continue;
          for (const k of keys) {
            const v = String((src as any)[k] || '').trim();
            if (v && v !== 'null' && v !== 'undefined' && v !== 'Customer') return v;
          }
        }
        for (const src of possibleSources) {
          if (!src) continue;
          for (const k of idKeys) {
            const id = String((src as any)[k] || '').trim();
            if (id && map[id]) return map[id];
          }
        }
        return '';
      };

      // Build master maps on-demand if empty
      let emMap = empMap; let cuMap = custMap;
      if (Object.keys(empMap).length === 0 || Object.keys(custMap).length === 0) {
        try {
          const masters: any = await DataService.readData(['master_employee','master_customer'], acc, ret);
          const root: any = masters?.data || {};
          const emps: any[] = root.master_employee || [];
          const custs: any[] = root.master_customer || [];
          const eMap: Record<string,string> = {};
          const cMap: Record<string,string> = {};
          emps.forEach((r:any)=>{
            const id = String(r.employee_id || r.id || r.code || '').trim();
            const nm = String(r.employee_name || r.name || r.full_name || '').trim();
            if (id && nm) eMap[id]=nm;
          });
          custs.forEach((r:any)=>{
            const id = String(r.customer_id || r.id || r.code || '').trim();
            const nm = String(r.customer_name || r.name || r.full_name || '').trim();
            if (id && nm) cMap[id]=nm;
          });
          if (Object.keys(empMap).length===0) setEmpMap(eMap);
          if (Object.keys(custMap).length===0) setCustMap(cMap);
          emMap = eMap; cuMap = cMap;
        } catch {}
      }

      const customerName = pickName([
        'customer_name','txn_customer_name','customer','customer_full_name','customerName','name','full_name'
      ], ['customer_id','CUSTOMER_ID','customerId','cust_id','client_id','CLIENT_ID'], cuMap) || 'Customer';
      const customerPhone = pickName(['customer_number','customer_phone','customer_mobile','phone','mobile'], [], {});
      const staffName = pickName(['employee_name','txn_employee_name','staff_name','employee','staffName','empName'], ['employee_id','EMPLOYEE_ID','emp_id','staff_id'], emMap);

      const resolveItemStaffName = (row: any): string => {
        const direct = String(
          row?.employee_name ||
            row?.txn_employee_name ||
            row?.staff_name ||
            row?.staffName ||
            row?.empName ||
            ''
        ).trim();
        if (direct) return direct;

        const id = String(
          row?.employee_id || row?.EMPLOYEE_ID || row?.emp_id || row?.staff_id || row?.staffId || ''
        ).trim();
        if (id && emMap[id]) return emMap[id];

        return staffName || '-';
      };

      const packages = rawPackages.map((p: any) => ({ ...p, staffName: resolveItemStaffName(p) }));
      const inventory = rawInventory.map((it: any) => ({ ...it, staffName: resolveItemStaffName(it) }));
      
      // Build payments summary from payments array
      const normalizedPayments = payments.map(p => ({
        method: String(p.payment_mode_name || p.payment_method || '').trim() || 'Payment',
        amount: Number(p.amount ?? p.payment_amount ?? 0) || 0,
        status: String(p.status || p.payment_status || '').trim(),
        payment_date: p.payment_date || p.created_at || header.created_at || null,
        upi_transaction_id: p.upi_transaction_id || '',
        cheque_no: p.cheque_no || ''
      }));
      const totalPaid = normalizedPayments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const latestPaymentDate = (() => {
        const ds = normalizedPayments
          .map(p => (p.payment_date ? new Date(p.payment_date as any).getTime() : 0))
          .filter(n => n > 0);
        const max = ds.length ? Math.max(...ds) : 0;
        return max ? new Date(max) : (header.created_at ? new Date(header.created_at) : new Date());
      })();
      const paymentSummary = normalizedPayments.length
        ? normalizedPayments.map(p => `${p.method} ₹${Number(p.amount||0).toLocaleString('en-IN')}`).join(', ')
        : '';

      // Build all items (services, packages, inventory) and totals - include staff information per item
      const services = (lines || []).map((ln: any, idx: number) => {
        const quantity = Number(ln.qty ?? ln.quantity ?? 1) || 1;
        const price = Number(ln.unit_price ?? ln.price ?? ln.rate ?? 0) || 0;
        const subtotalLine = price * quantity;

        const derivedTax =
          (Number(ln.cgst_amount) || Number(ln.total_cgst) || 0) +
          (Number(ln.sgst_amount) || Number(ln.total_sgst) || 0) +
          (Number(ln.igst_amount) || Number(ln.total_igst) || 0);

        const taxAmountLine = Number(ln.tax_amount ?? ln.total_tax ?? ln.gst_amount ?? derivedTax) || 0;
        const explicitTotal = Number(ln.item_total ?? ln.grand_total ?? ln.total ?? ln.amount ?? ln.line_total);

        return {
          id: String(idx + 1),
          name: ln.service_name || 'Service',
          price,
          quantity,
          subtotal: subtotalLine,
          taxAmount: taxAmountLine,
          total:
            Number.isFinite(explicitTotal)
              ? (taxAmountLine > 0 && Math.abs(explicitTotal - subtotalLine) < 0.01
                  ? subtotalLine + taxAmountLine
                  : explicitTotal)
              : subtotalLine + taxAmountLine,
          staffName: ln.employee_name || emMap[String(ln.employee_id || '')] || staffName || '-'
        };
      });
      // Prefer header totals if present, else compute from lines (subtotal excludes tax)
      const subtotalComputed = services.reduce((s, r: any) => s + (Number(r.subtotal) || 0), 0);
      const subtotal = Number(header.subtotal ?? subtotalComputed) || 0;
      const discountAmount = Number(header.discount_amount ?? lines[0]?.discount_amount) || 0;
      const cgst = Number(header.total_cgst ?? lines.reduce((s:number,r:any)=> s + (Number(r.cgst_amount)||Number(r.total_cgst)||0),0)) || 0;
      const sgst = Number(header.total_sgst ?? lines.reduce((s:number,r:any)=> s + (Number(r.sgst_amount)||Number(r.total_sgst)||0),0)) || 0;
      const igst = Number(header.total_igst ?? lines.reduce((s:number,r:any)=> s + (Number(r.igst_amount)||Number(r.total_igst)||0),0)) || 0;
      const directTaxAmount = Number(header.tax_amount ?? lines.reduce((s:number,r:any)=> s + (Number(r.tax_amount)||Number(r.total_tax)||0),0)) || 0;
      const combinedTax = Number((cgst + sgst + igst).toFixed(2));
      const taxAmount = combinedTax > 0 ? combinedTax : Number((directTaxAmount).toFixed(2));
      const roundoff = Number(header.roundoff || 0) || 0;
      const total = Number(header.grand_total ?? (subtotal - discountAmount + taxAmount + roundoff)) || 0;

      // Apply staff restriction in summary view (dialog) to match list behavior.
      // When enabled, show only selected staff line items and proportionally scale totals.
      const shouldRestrictInDialog = !!restrictStaff && String(employeeFilter || '') !== 'all';
      const selectedEmployeeId = String(employeeFilter || '').trim();
      const selectedEmployeeName = String(emMap?.[selectedEmployeeId] || selectedEmployeeLabel || '').trim();

      const norm = (v: any) => String(v ?? '').trim().toLowerCase();
      const itemMatchesSelectedStaff = (row: any): boolean => {
        if (!selectedEmployeeId && !selectedEmployeeName) return false;

        const rowEmpId = String(
          row?.employee_id ?? row?.EMPLOYEE_ID ?? row?.emp_id ?? row?.staff_id ?? row?.staffId ?? ''
        ).trim();
        if (rowEmpId && selectedEmployeeId && rowEmpId === selectedEmployeeId) return true;

        const rowName = String(
          row?.staffName ??
            row?.employee_name ??
            row?.txn_employee_name ??
            row?.staff_name ??
            row?.staffName ??
            row?.empName ??
            ''
        ).trim();
        if (selectedEmployeeName && rowName && norm(rowName) === norm(selectedEmployeeName)) return true;

        if (selectedEmployeeName && rowName && norm(rowName).includes(norm(selectedEmployeeName))) return true;
        return false;
      };

      const baseAmountOf = (row: any): number => {
        const qty = Number(row?.quantity ?? row?.qty ?? 1) || 1;
        const unit = Number(
          row?.price ??
            row?.unit_price ??
            row?.rate ??
            row?.package_price ??
            row?.amount ??
            0
        ) || 0;
        const base = unit * qty;
        return Number.isFinite(base) ? Math.max(0, base) : 0;
      };

      let finalServices = services;
      let finalPackages = packages;
      let finalInventory = inventory;
      let finalSubtotal = subtotal;
      let finalDiscount = discountAmount;
      let finalTaxAmount = taxAmount;
      let finalRoundoff = roundoff;
      let finalTotal = total;
      let finalCreditAmount = creditAmountApi;
      let finalPayments = normalizedPayments;
      let finalTotalPaid = totalPaid;
      let finalPaymentStatus: string = 'UNPAID';
      let finalStaffName = staffName;
      let didRestrictTotals = false;

      if (shouldRestrictInDialog && (selectedEmployeeId || selectedEmployeeName)) {
        // Filter items
        const selectedServices = (services || []).filter(itemMatchesSelectedStaff);
        const selectedPackages = (packages || []).filter(itemMatchesSelectedStaff);
        const selectedInventory = (inventory || []).filter(itemMatchesSelectedStaff);

        const allItems = [
          ...(services || []),
          ...(packages || []),
          ...(inventory || []),
        ];
        const selectedItems = [
          ...selectedServices,
          ...selectedPackages,
          ...selectedInventory,
        ];

        if (selectedItems.length > 0) {
          didRestrictTotals = true;
          const allBase = allItems.reduce((s: number, r: any) => s + baseAmountOf(r), 0);
          const selectedBase = selectedItems.reduce((s: number, r: any) => s + baseAmountOf(r), 0);
          const ratio = allBase > 0 ? selectedBase / allBase : selectedItems.length / Math.max(1, allItems.length);
          const clampRatio = Number.isFinite(ratio) && ratio > 0 ? Math.min(1, Math.max(0, ratio)) : 1;
          const scale = (n: any) => (Number(n || 0) || 0) * clampRatio;

          finalServices = selectedServices;
          finalPackages = selectedPackages;
          finalInventory = selectedInventory;

          finalStaffName = selectedEmployeeName || staffName;

          finalSubtotal = Number(scale(subtotal).toFixed(2));
          finalDiscount = Number(scale(discountAmount).toFixed(2));
          finalTaxAmount = Number(scale(taxAmount).toFixed(2));
          finalRoundoff = Number(scale(roundoff).toFixed(2));
          finalCreditAmount = Number(scale(creditAmountApi).toFixed(2));
          finalTotal = Number(scale(total).toFixed(2));

          finalPayments = (normalizedPayments || []).map((p) => ({
            ...p,
            amount: Number(scale(p.amount).toFixed(2)),
          }));
          finalTotalPaid = Number(scale(totalPaid).toFixed(2));

          // Re-derive payment status for the restricted totals
          const dueForRestricted = Math.max(0, finalTotal - finalCreditAmount);
          if (String(header.billstatus || header.bill_status || header.BILL_STATUS || '').trim() === 'C') {
            finalPaymentStatus = 'Canceled';
          } else if (String(header.invoice_status || '').toLowerCase() === 'hold') {
            finalPaymentStatus = 'HOLD';
          } else if (finalTotalPaid >= dueForRestricted - 0.5) {
            finalPaymentStatus = 'PAID';
          } else if (finalTotalPaid > 0) {
            finalPaymentStatus = 'PARTIAL';
          } else {
            finalPaymentStatus = 'UNPAID';
          }
        }
      }

      // Derive payment status from totals and payments
      let derivedPaymentStatus: string = 'UNPAID';
      if (header.billstatus === 'C' || header.bill_status === 'C' || header.BILL_STATUS === 'C') {
        derivedPaymentStatus = 'Canceled';
      } else if (String(header.invoice_status || '').toLowerCase() === 'hold') {
        derivedPaymentStatus = 'HOLD';
      } else if (totalPaid >= Math.max(0, total - Number((resp as any).credit_amount || 0)) - 0.5) {
        derivedPaymentStatus = 'PAID';
      } else if (totalPaid > 0) {
        derivedPaymentStatus = 'PARTIAL';
      }

      // When not restricted, keep the original payment status.
      if (!didRestrictTotals) {
        finalPaymentStatus = derivedPaymentStatus;
      }

      setInvoiceDetail({
        id: invoiceId,
        number: invoiceId,
        // Use normalized IST date derived from serialized header timestamps to avoid UTC display in modal
        date: normalizeToISTDate(
          header.created_at || header.last_created_at || header.last_updated_at || lines[0]?.created_at || new Date()
        ),
        customer: { name: customerName, phone: customerPhone, email: String(header.customer_email || lines[0]?.customer_email || '') },
        staffName: finalStaffName,
        services: finalServices,
        subtotal: finalSubtotal,
        discountAmount: finalDiscount,
        taxAmount: finalTaxAmount,
        taxBreakdown: { cgst, sgst, igst, tax_rate_percent: Number(header.tax_rate_percent || lines[0]?.tax_rate_percent || 0) },
        roundoff: finalRoundoff,
        total: finalTotal,
        paymentMethod: paymentSummary || String(header.payment_method || lines[0]?.payment_method || '').toLowerCase() || 'cash',
        notes: header.notes || lines[0]?.notes || ''
        ,
        // Attach raw sections for advanced rendering
        header,
        // expose payments data for rendering
        payments: finalPayments,
        totalPaid: finalTotalPaid,
        latestPaymentDate,
        paymentStatus: finalPaymentStatus,
        packages: finalPackages,
        inventory: finalInventory,
        wallet,
        creditAmount: finalCreditAmount
      });
    } catch (e:any) {
      setInvoiceError(e?.message || 'Failed to load invoice');
    } finally {
      setInvoiceLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Removed duplicate top date-range block; consolidated inside CardHeader */}

      {/* Stats grid moved inside the table below */}

      {/* Invoices Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-row flex-nowrap items-center justify-between gap-3 overflow-x-auto">
            {/* Filters (merged) */}
            <div className="flex flex-nowrap items-center gap-3 shrink-0">
              <div className="flex flex-wrap sm:flex-nowrap items-center border border-input bg-background shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden">
                {/* Date range */}
                <div className="flex flex-nowrap items-center gap-2 px-2 h-10 sm:h-9 whitespace-nowrap">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "min-w-[132px] justify-start text-left rounded-none h-10 sm:h-9 px-2 font-medium border-0 hover:bg-transparent",
                          !fromDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">From{fromDate ? `: ${format(fromDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={fromDate} onSelect={handleFromDateSelect} initialFocus />
                    </PopoverContent>
                  </Popover>

                  <span className="text-muted-foreground/60">→</span>

                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "min-w-[120px] justify-start text-left rounded-none h-10 sm:h-9 px-2 font-medium border-0 hover:bg-transparent",
                          !toDate && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                        <span className="text-xs sm:text-sm">To{toDate ? `: ${format(toDate, "dd-MM-yyyy")}` : ""}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={toDate}
                        onSelect={handleToDateSelect}
                        disabled={fromDate ? { before: fromDate } : undefined}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Presets */}
                <div className="flex items-center px-2 h-10 sm:h-9 min-w-[170px]">
                  <Select
                    value={(['today', 'thisWeek', 'thisMonth', 'last3Months'] as string[]).includes(rangePreset) ? rangePreset : undefined}
                    onValueChange={(v) => {
                      if (v === 'today') {
                        applyToday();
                        return;
                      }
                      if (v === 'thisWeek') {
                        applyThisWeek();
                        return;
                      }
                      if (v === 'thisMonth') {
                        applyThisMonth();
                        return;
                      }
                      if (v === 'last3Months') {
                        applyLast3Months();
                        return;
                      }
                    }}
                  >
                    <SelectTrigger className="h-10 sm:h-9 w-full border-0 rounded-none bg-transparent shadow-none focus:ring-0">
                      <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                      <SelectValue placeholder="Range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="today">Today</SelectItem>
                      <SelectItem value="thisWeek">This Week</SelectItem>
                      <SelectItem value="thisMonth">This Month</SelectItem>
                      <SelectItem value="last3Months">3 Months</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Status */}
                <div className="flex items-center px-2 h-10 sm:h-9 min-w-[170px]">
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                    <SelectTrigger className="h-10 sm:h-9 w-full border-0 rounded-none bg-transparent shadow-none focus:ring-0">
                      <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="hold">Hold</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Primary actions */}
            <div className="flex gap-2 shrink-0">

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="bg-yellow-500/90 text-black hover:bg-yellow-500">
                    <BarChart3 className="h-4 w-4 mr-2" />
                    <span className="sm:inline">Reports</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>Export Excel</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={exportInvoiceListExcel}>Invoice List (filtered)</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportSalesSummaryByDay}>Sales Summary by Day</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportCustomerSales}>Customer Sales Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportStaffSales}>Staff Sales Summary</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPendingPayments}>Pending Payments</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportTaxSummary}>Tax Summary</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="destructive"
                className="whitespace-nowrap px-4"
                onClick={async () => {
                  setCreditDialogOpen(true);
                  await fetchCustomersWithCredit();
                }}
                title="Pay Members Credit"
              >
                <IndianRupee className="h-4 w-4 mr-2" />
                <span className="hidden lg:inline">Pay Members Credit</span>
                <span className="lg:hidden">Pay Credit</span>
              </Button>

              <Button onClick={handleNewInvoice} className="gap-2 bg-blue-700 hover:bg-blue-800 text-white min-w-[180px] sm:min-w-[210px] px-6 sm:px-8">
                <Plus className="h-4 w-4" />
                <span className="sm:inline">New Enroll</span>
              </Button>
            </div>
          </div>
          {/* Toolbar: merged layout */}
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center border border-input bg-background shadow-sm divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-3 sm:top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 w-full border-0 focus-visible:ring-0 shadow-none rounded-none bg-transparent h-10 sm:h-9"
                placeholder="Search invoices..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            
            {/* Customer filter */}
            <Popover open={customerFilterOpen} onOpenChange={setCustomerFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  role="combobox"
                  aria-expanded={customerFilterOpen}
                  className="w-full sm:w-44 md:w-52 lg:w-64 justify-between rounded-none h-10 sm:h-9 hover:bg-transparent font-normal border-0"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedCustomerLabel}</span>
                  </span>
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search customer..." className="h-9" />
                  <CommandList>
                    <CommandEmpty>No customers found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="All Customers"
                        onSelect={() => {
                          setCustomerFilter('all');
                          setCustomerFilterOpen(false);
                        }}
                      >
                        All Customers
                      </CommandItem>
                      {customerOptions.map((c) => {
                        const label = `${c.name}${c.phone ? ` - ${c.phone}` : ''}`;
                        return (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.phone || ''} ${c.id}`}
                            onSelect={() => {
                              setCustomerFilter(c.id);
                              setCustomerFilterOpen(false);
                            }}
                          >
                            <span className="truncate">{label}</span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Employee filter */}
            <Popover open={employeeFilterOpen} onOpenChange={setEmployeeFilterOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  role="combobox"
                  aria-expanded={employeeFilterOpen}
                  className="w-full sm:w-40 md:w-44 lg:w-56 justify-between rounded-none h-10 sm:h-9 hover:bg-transparent font-normal border-0"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{selectedEmployeeLabel}</span>
                  </span>
                  <ArrowUpDown className="h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search staff..." className="h-9" />
                  <CommandList>
                    <CommandEmpty>No staff found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="All Staff"
                        onSelect={() => {
                          setEmployeeFilter('all');
                          setEmployeeFilterOpen(false);
                        }}
                      >
                        All Staff
                      </CommandItem>
                      {employeeOptions.map((e) => (
                        <CommandItem
                          key={e.id}
                          value={`${e.name} ${e.id}`}
                          onSelect={() => {
                            setEmployeeFilter(e.id);
                            setEmployeeFilterOpen(false);
                          }}
                        >
                          <span className="truncate">{e.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Restrict Staff toggle */}
            <div className="flex items-center justify-between sm:justify-start gap-2 px-3 h-10 sm:h-9 bg-transparent min-w-[140px]">
              <Label htmlFor="restrict-staff" className="text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
                Restrict Staff
              </Label>
              <Switch
                id="restrict-staff"
                checked={restrictStaff}
                onCheckedChange={(v) => setRestrictStaff(!!v)}
                disabled={employeeFilter === 'all'}
                aria-label="Restrict staff totals to selected staff"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3">
          {/* KPI cards below the filters */}
          {showDashboard && (
            <div className="mb-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-2 sm:gap-4">
              {[
                { 
                  label: 'SALES TOTAL', 
                  qty: billedInvoices.length, 
                  amount: Math.round(Number(totalRevenue || 0)), 
                  icon: <Receipt className="h-3 w-3 sm:h-4 sm:w-4" />, 
                  tone: 'from-purple-500/10 to-purple-500/5', 
                  iconTint: 'bg-purple-100 text-purple-600 ring-purple-200/60' 
                },
                { 
                  label: 'CANCELLED BILLS', 
                  qty: cancelledCount, 
                  amount: Math.round(Number(cancelledAmount || 0)), 
                  icon: <XCircle className="h-3 w-3 sm:h-4 sm:w-4" />, 
                  tone: 'from-rose-500/10 to-rose-500/5', 
                  iconTint: 'bg-rose-100 text-rose-600 ring-rose-200/60' 
                },
                { 
                  label: 'HOLD BILLS', 
                  qty: holdCount, 
                  amount: Math.round(Number(holdAmount || 0)), 
                  icon: <HandCoins className="h-3 w-3 sm:h-4 sm:w-4" />, 
                  tone: 'from-orange-500/10 to-orange-500/5', 
                  iconTint: 'bg-orange-100 text-orange-600 ring-orange-200/60' 
                },
                { 
                  label: 'CUSTOMERS', 
                  qty: totalCustomers, 
                  amount: 0, // No amount for customers
                  icon: <Users className="h-3 w-3 sm:h-4 sm:w-4" />, 
                  tone: 'from-blue-500/10 to-blue-500/5', 
                  iconTint: 'bg-blue-100 text-blue-600 ring-blue-200/60',
                  hideAmount: true // Hide the amount display for customers
                },
              ].map(card => (
                <div key={card.label} className="relative overflow-hidden rounded-xl border border-gray-200/70 dark:border-gray-800/60 bg-white dark:bg-gray-900 px-3 sm:px-5 py-3 sm:py-4 shadow-sm hover:shadow-md transition-shadow group min-h-[80px] sm:min-h-[112px]">
                  <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`}></div>
                  <div className="relative flex items-start justify-between gap-2 sm:gap-4 min-h-[56px] sm:min-h-[72px]">
                    <div className="w-full">
                      <div className="h-4 sm:h-5 flex items-end">
                        <p className="text-[10px] sm:text-[12px] font-semibold tracking-wide text-gray-600 dark:text-gray-400 uppercase leading-none whitespace-nowrap">{card.label}</p>
                      </div>
                      {card.inlineStat ? (
                        <div className="mt-2">
                          <div className="grid grid-cols-2 gap-3 text-[9px] sm:text-[11px] text-gray-500">
                            <div className="truncate">Name</div>
                            <div className="text-right">{card.qtyLabel || 'Services'}</div>
                          </div>
                          <div className="mt-1 grid grid-cols-2 gap-3 items-baseline">
                            <div className="min-w-0 text-base sm:text-lg leading-none font-semibold text-gray-900 dark:text-gray-100 truncate">{card.subtitle || 'N/A'}</div>
                            <div className="text-right text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{card.qty}</div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {card.subtitle && (
                            <div className="mt-1 text-[11px] sm:text-[12px] font-medium text-gray-800 dark:text-gray-200 truncate">
                              {card.subtitle}
                            </div>
                          )}
                          <div className={`mt-1 sm:mt-2 ${card.hideAmount ? 'text-center' : 'grid grid-cols-2 gap-1 sm:gap-2'}`}>
                            <div>
                              <div className="text-[9px] sm:text-[11px] text-gray-500">{card.hideAmount ? (card.qtyLabel || 'Total') : 'Qty'}</div>
                              <div className="text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{card.qty}</div>
                            </div>
                            {!card.hideAmount && (
                              <div className="text-right">
                                <div className="text-[9px] sm:text-[11px] text-gray-500">Amount</div>
                                <div className="text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">₹{Math.round(Number((card.qty === 0 ? 0 : card.amount) || 0)).toLocaleString('en-IN')}</div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    <div className={`shrink-0 h-6 w-6 sm:h-8 sm:w-8 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>{card.icon}</div>
                  </div>
                  <div className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
                </div>
              ))}
            </div>
          )}
          {/* Mobile cards (show on < sm) */}
          <div className="sm:hidden space-y-3">
            {pagedInvoices.length === 0 ? (
              <div className="text-center text-sm text-slate-500 py-6">
                {loading ? "Loading invoices..." : "No invoices found for the selected date range."}
              </div>
            ) : (
              pagedInvoices.map((invoice) => (
                <Card
                  key={invoice.id}
                  className={cn(
                    "border bg-white shadow-sm hover:shadow-md transition-shadow cursor-pointer",
                    invoice.status === 'cancelled' ? 'bg-rose-50/70' : undefined
                  )}
                  onClick={() => openInvoiceDialog(invoice.id)}
                >
                  <CardContent className="p-4 space-y-3">
                    {/* Top row: date/time and amount */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{formatYMDIST(invoice.date).split('-').reverse().join('-')}</div>
                        <div className="text-xs text-slate-500">{formatTimeIST(invoice.date)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Amount</div>
                        <div className="text-lg font-bold text-slate-900">₹{invoice.total.toLocaleString('en-IN')}</div>
                      </div>
                    </div>

                    {/* Customer and invoice info */}
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {invoice.customer.split(' ').map((n: string) => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-slate-900 truncate">{invoice.customer}</div>
                          <Badge variant="secondary" className={cn("shrink-0", getStatusColor(invoice.status))}>
                            <div className="flex items-center gap-1 capitalize">
                              {getStatusIcon(invoice.status)}
                              {invoice.status}
                            </div>
                          </Badge>
                        </div>
                        {invoice.customerPhone && (
                          <div className="text-xs text-slate-500 truncate">{invoice.customerPhone}</div>
                        )}
                        <div className="text-xs text-slate-500 flex items-center gap-2 mt-1">
                          <span className="font-medium text-slate-700">ID:</span>
                          <span className="tabular-nums">{invoice.id}</span>
                          {invoice.staff && (
                            <>
                              <span className="text-slate-300">•</span>
                              <span className="truncate">{invoice.staff}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/billing/add?edit=${invoice.id}`);
                        }}
                        title="Edit Invoice"
                        aria-label="Edit Invoice"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-rose-50 hover:text-rose-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelInvoiceFromList(invoice);
                        }}
                        title={String(invoice.status || '').toLowerCase() === 'cancelled' ? 'Revert Cancellation' : 'Cancel Invoice'}
                        aria-label="Cancel Invoice"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-slate-50 hover:text-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            openWhatsAppMessageEditor();
                          }}
                          title="Edit WhatsApp message"
                          aria-label="Edit WhatsApp message"
                        >
                          <MessageSquareText className="h-4 w-4" />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-emerald-50 hover:text-emerald-600'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            sendWhatsApp(invoice as any);
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'WhatsApp disabled for Hold invoices' : 'Send on WhatsApp'}
                          aria-label="Send on WhatsApp"
                        >
                          <SiWhatsapp className={cn('h-4 w-4', String(invoice.status || '').toLowerCase() === 'hold' ? 'text-slate-400' : 'text-green-500')} />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-blue-50 hover:text-blue-600'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            openTallyPrint(invoice.id, 'proforma');
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'Print disabled for Hold invoices' : 'Proforma Invoice'}
                          aria-label="Proforma Invoice"
                        >
                          <FileSignature className="h-4 w-4" />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-slate-50 hover:text-slate-800'
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            openTallyPrint(invoice.id, 'tax');
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'Print disabled for Hold invoices' : 'Invoice Print (Tally style)'}
                          aria-label="Invoice Print (Tally style)"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Desktop table (hidden on mobile) */}
          {/* Make the table horizontally scrollable on very small screens */}
          <div className="hidden sm:block overflow-x-auto">
          <Table className="min-w-[640px] sm:min-w-0">
            <TableHeader className="bg-slate-50/80 dark:bg-slate-900/30">
              <TableRow className="bg-slate-50/80 dark:bg-slate-900/30">
                <TableHead className="cursor-pointer" onClick={() => { setSortBy(prev => prev === 'date' ? 'date' : 'date'); setSortDir(d => (sortBy === 'date' ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); }}>
                  <span className="inline-flex items-center gap-1">Date <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => { setSortBy('customer'); setSortDir(d => (sortBy === 'customer' ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); }}>
                  <span className="inline-flex items-center gap-1">Customer <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="hidden sm:table-cell">Invoice ID</TableHead>
                <TableHead className="hidden sm:table-cell">Staff</TableHead>
                <TableHead className="cursor-pointer" onClick={() => { setSortBy('amount'); setSortDir(d => (sortBy === 'amount' ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); }}>
                  <span className="inline-flex items-center gap-1">Amount <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="hidden sm:table-cell cursor-pointer" onClick={() => { setSortBy('status'); setSortDir(d => (sortBy === 'status' ? (d === 'asc' ? 'desc' : 'asc') : 'asc')); }}>
                  <span className="inline-flex items-center gap-1">Payment Status <ArrowUpDown className="h-3 w-3 opacity-50" /></span>
                </TableHead>
                <TableHead className="hidden sm:table-cell">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedInvoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-slate-500 py-8">
                    {loading ? "Loading invoices..." : "No invoices found for the selected date range."}
                  </TableCell>
                </TableRow>
              ) : pagedInvoices.map((invoice) => (
                <TableRow
                  key={invoice.id}
                  className={cn(
                    "hover:bg-muted/50 transition-colors cursor-pointer",
                    invoice.status === 'cancelled' ? 'bg-rose-50/70 hover:bg-rose-100/70' : undefined,
                    invoice.status === 'hold' ? 'bg-orange-50/70 hover:bg-orange-100/70' : undefined
                  )}
                  onClick={() => openInvoiceDialog(invoice.id)}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {format(invoice.date, 'dd-MM-yyyy')}
                      </span>
                      <span className="text-sm text-gray-500">
                        {formatTimeIST(invoice.date)}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {invoice.customer.split(' ').map(n => n[0]).join('')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{invoice.customer}</span>
                        {invoice.customerPhone ? (
                          <span className="text-xs text-gray-500">{invoice.customerPhone}</span>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="font-medium">{invoice.id}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className="text-sm text-gray-600">{invoice.staff || '—'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold">₹{invoice.total.toLocaleString('en-IN')}</span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="secondary" className={getStatusColor(invoice.status)}>
                      <div className="flex items-center gap-1">
                        {getStatusIcon(invoice.status)}
                        {invoice.status}
                      </div>
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="h-8 w-8 p-0 hover:bg-blue-50 hover:text-blue-600" 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          navigate(`/billing/add?edit=${invoice.id}`);
                        }}
                        title="Edit Invoice"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 hover:bg-rose-50 hover:text-rose-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelInvoiceFromList(invoice);
                        }}
                        title={String(invoice.status || '').toLowerCase() === 'cancelled' ? 'Revert Cancellation' : 'Cancel Invoice'}
                        aria-label="Cancel Invoice"
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-slate-50 hover:text-slate-700"
                          onClick={(e) => {
                            e.stopPropagation();
                            openWhatsAppMessageEditor();
                          }}
                          title="Edit WhatsApp message"
                          aria-label="Edit WhatsApp message"
                        >
                          <MessageSquareText className="h-4 w-4" />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-emerald-50 hover:text-emerald-600'
                          )}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            sendWhatsApp(invoice);
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'WhatsApp disabled for Hold invoices' : 'Send on WhatsApp'}
                          aria-label="Send on WhatsApp"
                        >
                          <SiWhatsapp className={cn('h-4 w-4', String(invoice.status || '').toLowerCase() === 'hold' ? 'text-slate-400' : 'text-green-500')} />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-blue-50 hover:text-blue-600'
                          )}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            openTallyPrint(invoice.id, 'proforma');
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'Print disabled for Hold invoices' : 'Proforma Invoice'}
                          aria-label="Proforma Invoice"
                        >
                          <FileSignature className="h-4 w-4" />
                        </Button>
                      </span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        className={cn(String(invoice.status || '').toLowerCase() === 'hold' ? 'cursor-not-allowed' : undefined)}
                      >
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          disabled={String(invoice.status || '').toLowerCase() === 'hold'}
                          className={cn(
                            'h-8 w-8 p-0',
                            String(invoice.status || '').toLowerCase() === 'hold'
                              ? 'opacity-40 blur-[0.6px]'
                              : 'hover:bg-slate-50 hover:text-slate-800'
                          )}
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            if (String(invoice.status || '').toLowerCase() === 'hold') return;
                            openTallyPrint(invoice.id, 'tax');
                          }}
                          title={String(invoice.status || '').toLowerCase() === 'hold' ? 'Print disabled for Hold invoices' : 'Invoice Print (Tally style)'}
                          aria-label="Invoice Print (Tally style)"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/80 dark:bg-slate-900/30 px-3 py-2">
        <div className="text-center sm:text-left text-sm text-slate-600">
          {(sortedInvoices.length === 0)
            ? 'No invoices'
            : (
              <>
                <span className="font-medium text-slate-900 tabular-nums">{(safePage - 1) * pageSize + 1}</span>
                <span className="mx-1">–</span>
                <span className="font-medium text-slate-900 tabular-nums">{Math.min(safePage * pageSize, sortedInvoices.length)}</span>
                <span className="mx-1">of</span>
                <span className="font-medium text-slate-900 tabular-nums">{sortedInvoices.length}</span>
              </>
            )}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-end gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Rows</span>
            <Select
              value={rowsAll ? 'all' : String(pageSize)}
              onValueChange={(v) => {
                if (v === 'all') {
                  setRowsAll(true);
                  setPageSize(Math.max(1, sortedInvoices.length));
                  setPage(1);
                  return;
                }
                setRowsAll(false);
                setPageSize(Number(v) || 10);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-8 w-[92px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {[5, 10, 20, 50, 100, 500].map((n) => (
                  <SelectItem key={`ps-${n}`} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
              title="Previous"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[72px] text-center text-sm text-slate-700 tabular-nums">
              <span className="font-medium">{safePage}</span>
              <span className="mx-1 text-slate-400">/</span>
              <span className="text-slate-600">{totalPages}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
              title="Next"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

        {/* Invoice View Dialog */}
        <Dialog open={invoiceDialogOpen} onOpenChange={(v)=>{ setInvoiceDialogOpen(v); if(!v){ setSelectedInvoiceId(null); setInvoiceDetail(null); setInvoiceError(null);} }}>
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-5xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle className="text-lg sm:text-xl">Invoice {invoiceDetail?.number || selectedInvoiceId || ''}</DialogTitle>
            </DialogHeader>
            {invoiceLoading ? (
              <div className="py-8 text-center text-sm text-slate-600">Loading invoice…</div>
            ) : invoiceError ? (
              <div className="py-8 text-center text-sm text-red-600">{invoiceError}</div>
            ) : invoiceDetail ? (
              <div className="space-y-4 sm:space-y-6">
                {/* Customer & Meta */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Customer</div>
                    <div className="truncate text-sm font-semibold text-slate-900">{invoiceDetail.customer?.name || 'Customer'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Phone</div>
                    <div className="truncate text-sm font-medium text-slate-900">{invoiceDetail.customer?.phone || '-'}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">Date</div>
                    <div className="text-sm font-medium text-slate-900">{(() => {
                      const d = normalizeToISTDate(invoiceDetail.date as any);
                      return `${format(d, 'dd/MM/yyyy')}`;
                    })()}</div>
                  </div>
                  {/* Payment method block removed as requested */}
                  {(invoiceDetail.staffName || invoiceDetail.header?.employee_level) && (
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">Staff</div>
                      <div className="truncate text-sm font-medium text-slate-900">{invoiceDetail.staffName || '-'}</div>
                      {invoiceDetail.header?.employee_level && (
                        <div className="truncate text-xs text-slate-500">Level: {invoiceDetail.header.employee_level}</div>
                      )}
                    </div>
                  )}
                  {invoiceDetail.customer?.email && (
                    <div className="min-w-0 sm:col-span-2">
                      <div className="text-xs text-slate-500">Email</div>
                      <div className="truncate text-sm font-medium text-slate-900">{invoiceDetail.customer.email}</div>
                    </div>
                  )}
                </div>

                {/* Payment Details (from payments array) */}
                {Array.isArray((invoiceDetail as any).payments) && (invoiceDetail as any).payments.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 rounded border bg-slate-50 p-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">Paid Amount</div>
                      <div className="text-sm font-semibold text-slate-900">₹{Number((invoiceDetail as any).totalPaid || 0).toLocaleString('en-IN')}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">Status</div>
                      <div className="text-sm font-medium uppercase text-slate-900">{String((invoiceDetail as any).paymentStatus || '').trim() || '-'}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-500">Date</div>
                      <div className="text-sm font-medium text-slate-900">{(invoiceDetail as any).latestPaymentDate ? format(normalizeToISTDate((invoiceDetail as any).latestPaymentDate), 'dd/MM/yyyy') : '-'}</div>
                    </div>
                    <div className="min-w-0 sm:col-span-1">
                      <div className="text-xs text-slate-500">Methods</div>
                      <div className="flex flex-col gap-1 text-sm font-medium text-slate-800">
                        {((invoiceDetail as any).payments as any[]).map((p:any, i:number) => (
                          <div key={`pm-${i}`} className="truncate">
                            {p.method} ₹{Number(p.amount||0).toLocaleString('en-IN')}
                          </div>
                        ))}
                      </div>
                    </div>
                    {((invoiceDetail as any).payments as any[]).some((p:any)=> p.upi_transaction_id || p.cheque_no) && (
                      <div className="col-span-2 sm:col-span-4">
                        <div className="text-xs text-slate-500">Txn Ref</div>
                        <div className="text-sm font-medium break-all text-slate-900">
                          {((invoiceDetail as any).payments as any[])
                            .filter((p:any)=> p.upi_transaction_id || p.cheque_no)
                            .map((p:any, idx:number)=> (p.upi_transaction_id || p.cheque_no))
                            .join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Services */}
                {Array.isArray(invoiceDetail.services) && invoiceDetail.services.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="px-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Service</div>
                    <div className="min-w-[400px] overflow-hidden rounded border">
                      <table className="w-full table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-[40%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Service</th>
                            <th className="w-[18%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Staff</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Rate</th>
                            <th className="w-[8%] px-3 sm:px-4 py-2 text-center text-xs font-medium uppercase text-gray-600">Qty</th>
                            <th className="w-[10%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Tax</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y">
                          {invoiceDetail.services?.map((s:any)=> {
                            const itemSubtotal = Number(s.subtotal ?? (s.price * s.quantity)) || 0;
                            const taxAmount = Number(
                              s.taxAmount ?? s.tax_amount ?? s.total_tax ?? s.gst_amount ?? (Number(s.total) - itemSubtotal)
                            ) || 0;

                            return (
                              <tr key={s.id}>
                                <td className="px-3 sm:px-4 py-2 text-sm">
                                  <div className="flex flex-col gap-1">
                                    <span className="break-words">{s.name}</span>
                                    {s.type && s.type !== 'Service' && (
                                      <Badge variant="outline" className="text-xs w-fit">{s.type}</Badge>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 sm:px-4 py-2 text-sm font-medium text-blue-600 truncate">{s.staffName}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm">₹{Number(s.price||0).toLocaleString('en-IN')}</td>
                                <td className="px-3 sm:px-4 py-2 text-center text-sm">{s.quantity}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm">{taxAmount > 0 ? `₹${taxAmount.toLocaleString('en-IN')}` : '-'}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm font-medium">₹{Number(s.total||0).toLocaleString('en-IN')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Packages (if any) */}
                {invoiceDetail.packages && invoiceDetail.packages.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="px-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Package</div>
                    <div className="min-w-[400px] overflow-hidden rounded border">
                      <table className="w-full table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-[40%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Package</th>
                            <th className="w-[18%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Staff</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Rate</th>
                            <th className="w-[8%] px-3 sm:px-4 py-2 text-center text-xs font-medium uppercase text-gray-600">Qty</th>
                            <th className="w-[10%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Tax</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y">
                          {invoiceDetail.packages.map((p:any, idx:number)=> (
                            <tr key={`pkg-${idx}`}>
                              <td className="px-3 sm:px-4 py-2 text-sm break-words">{p.package_name}</td>
                              <td className="px-3 sm:px-4 py-2 text-sm font-medium text-blue-600 truncate">{p.staffName || invoiceDetail.staffName || '-'}</td>
                              <td className="px-3 sm:px-4 py-2 text-right text-sm">₹{Number(p.unit_price||p.package_price||0).toLocaleString('en-IN')}</td>
                              <td className="px-3 sm:px-4 py-2 text-center text-sm">{p.qty || 1}</td>
                              <td className="px-3 sm:px-4 py-2 text-right text-sm">{Number(p.tax_amount||0) > 0 ? `₹${Number(p.tax_amount||0).toLocaleString('en-IN')}` : '-'}</td>
                              <td className="px-3 sm:px-4 py-2 text-right text-sm font-medium">₹{Number(p.grand_total||((p.unit_price||p.package_price||0)*(p.qty||1)+(p.tax_amount||0))).toLocaleString('en-IN')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Inventory (if any) */}
                {invoiceDetail.inventory && invoiceDetail.inventory.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="px-0.5 text-xs font-semibold uppercase tracking-wide text-slate-600">Product</div>
                    <div className="min-w-[400px] overflow-hidden rounded border">
                      <table className="w-full table-fixed">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="w-[40%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Product</th>
                            <th className="w-[18%] px-3 sm:px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Staff</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Rate</th>
                            <th className="w-[8%] px-3 sm:px-4 py-2 text-center text-xs font-medium uppercase text-gray-600">Qty</th>
                            <th className="w-[10%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Tax</th>
                            <th className="w-[12%] px-3 sm:px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y">
                          {invoiceDetail.inventory.map((it:any, idx:number)=> {
                            const qty = Number(it.qty ?? it.quantity ?? 1) || 1;
                            const unitPrice = Number(it.unit_price ?? it.price ?? 0) || 0;
                            const invTax = Number(
                              it.tax_amount ??
                              it.total_tax ??
                              it.gst_amount ??
                              ((Number(it.cgst_amount) || 0) + (Number(it.sgst_amount) || 0) + (Number(it.igst_amount) || 0))
                            ) || 0;
                            const amount = Number(it.grand_total ?? it.total ?? it.amount ?? (unitPrice * qty + invTax)) || 0;

                            return (
                              <tr key={`inv-${idx}`}>
                                <td className="px-3 sm:px-4 py-2 text-sm break-words">{it.product_name || it.name || it.barcode || 'Item'}</td>
                                <td className="px-3 sm:px-4 py-2 text-sm font-medium text-blue-600 truncate">{it.staffName || invoiceDetail.staffName || '-'}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm">₹{Number(unitPrice||0).toLocaleString('en-IN')}</td>
                                <td className="px-3 sm:px-4 py-2 text-center text-sm">{qty}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm">{invTax > 0 ? `₹${invTax.toLocaleString('en-IN')}` : '-'}</td>
                                <td className="px-3 sm:px-4 py-2 text-right text-sm font-medium">₹{amount.toLocaleString('en-IN')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Tax & Totals */}
                <div className="ml-auto w-full sm:max-w-sm space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-slate-600">Subtotal</span><span className="font-medium">₹{Number(invoiceDetail.subtotal||0).toLocaleString('en-IN')}</span></div>
                  {Number(invoiceDetail.discountAmount||0) > 0 && (
                    <div className="flex justify-between text-sm"><span className="text-slate-600">Discount</span><span className="font-medium text-red-600">-₹{Number(invoiceDetail.discountAmount||0).toLocaleString('en-IN')}</span></div>
                  )}
                  {invoiceDetail.taxBreakdown && (
                    <>
                      <div className="flex justify-between text-xs text-slate-600"><span>CGST</span><span>₹{Number(invoiceDetail.taxBreakdown.cgst||0).toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between text-xs text-slate-600"><span>SGST</span><span>₹{Number(invoiceDetail.taxBreakdown.sgst||0).toLocaleString('en-IN')}</span></div>
                      {Number(invoiceDetail.taxBreakdown.igst||0) > 0 && (
                        <div className="flex justify-between text-xs text-slate-600"><span>IGST</span><span>₹{Number(invoiceDetail.taxBreakdown.igst||0).toLocaleString('en-IN')}</span></div>
                      )}
                    </>
                  )}
                  {Number(invoiceDetail.taxAmount||0) > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-600 inline-flex items-center gap-2">
                        Total Tax
                        {selectedInvoiceId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title="Proforma Invoice"
                            aria-label="Proforma Invoice"
                            onClick={() => showPrintOptions(selectedInvoiceId, false, 'Proforma Invoice')}
                          >
                            <FileText className="h-4 w-4 text-blue-600" />
                          </Button>
                        )}
                      </span>
                      <span className="font-medium">₹{Number(invoiceDetail.taxAmount||0).toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {Number(invoiceDetail.roundoff||0) !== 0 && (
                    <div className="flex justify-between text-sm"><span className="text-slate-600">Round-off</span><span className="font-medium">₹{Number(invoiceDetail.roundoff||0).toLocaleString('en-IN')}</span></div>
                  )}
                  <div className="flex justify-between text-base font-semibold border-t pt-2"><span>Total</span><span className="text-green-700">₹{Number(invoiceDetail.total||0).toLocaleString('en-IN')}</span></div>
                </div>

                {invoiceDetail.notes ? (
                  <div className="text-sm text-slate-700"><span className="font-medium">Notes: </span>{invoiceDetail.notes}</div>
                ) : null}

                {/* Meta block removed as requested */}
              </div>
            ) : null}
            <DialogFooter className="mt-4 flex-col sm:flex-row gap-2 sm:gap-0">
              <Button variant="outline" onClick={()=> setInvoiceDialogOpen(false)} className="w-full sm:w-auto">Close</Button>
              {selectedInvoiceId && (
                <Button 
                  onClick={(e)=> { if (selectedInvoiceId) showPrintOptions(selectedInvoiceId, e.shiftKey); }} 
                  className="w-full sm:w-auto"
                  title="Print Invoice (Shift+Click for quick print)"
                >
                  Print
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* WhatsApp Message Template */}
        <Dialog
          open={whatsAppMessageDialogOpen}
          onOpenChange={(v) => {
            if (whatsAppMessageSaving) return;
            setWhatsAppMessageDialogOpen(v);
          }}
        >
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-lg">WhatsApp Message</DialogTitle>
              <DialogDescription>
                Saved message will be used for WhatsApp. Leave empty to use the default message.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label>Message Template</Label>
              <Textarea
                value={whatsAppMessageDraft}
                onChange={(e) => setWhatsAppMessageDraft(e.target.value)}
                rows={10}
                placeholder={DEFAULT_WHATSAPP_TEMPLATE}
              />
              <div className="text-xs text-slate-500">
                Placeholders: {'{customer}'}, {'{business}'}, {'{invoiceId}'}, {'{date}'}, {'{time}'}, {'{amount}'},
                {'{serviceDetails}'}, {'{billSummary}'}, {'{businessPhoneLine}'}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setWhatsAppMessageDialogOpen(false)}
                disabled={whatsAppMessageSaving}
              >
                <span className="inline-flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Cancel
                </span>
              </Button>
              <Button
                variant="outline"
                onClick={() => setWhatsAppMessageDraft('')}
                disabled={whatsAppMessageSaving}
                title="Clear saved message so default is used"
              >
                <span className="inline-flex items-center gap-2">
                  <Trash2 className="h-4 w-4" />
                  Clear
                </span>
              </Button>
              <Button onClick={saveWhatsAppMessageTemplate} disabled={whatsAppMessageSaving}>
                {whatsAppMessageSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Saving…
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Save className="h-4 w-4" />
                    Save
                  </span>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Cancel / Revert cancellation confirmation */}
        <AlertDialog
          open={cancelConfirmOpen}
          onOpenChange={(open) => {
            if (!cancelConfirmSubmitting) {
              setCancelConfirmOpen(open);
              if (!open) setCancelConfirmInvoice(null);
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {cancelConfirmMode === 'cancel' ? 'Cancel Invoice' : 'Revert Cancellation'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {cancelConfirmMode === 'cancel'
                  ? `Are you sure you want to cancel invoice ${String(cancelConfirmInvoice?.id || '')}? This will mark the invoice as cancelled (C).`
                  : `Invoice ${String(cancelConfirmInvoice?.id || '')} is already cancelled. Revert and set status back from C to Y?`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={cancelConfirmSubmitting}>No</AlertDialogCancel>
              <AlertDialogAction onClick={runCancelToggle} disabled={cancelConfirmSubmitting}>
                {cancelConfirmSubmitting
                  ? (cancelConfirmMode === 'cancel' ? 'Cancelling…' : 'Reverting…')
                  : (cancelConfirmMode === 'cancel' ? 'Yes, Cancel' : 'Yes, Revert')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Pay Members Credit - List Dialog */}
        <Dialog
          open={creditDialogOpen}
          onOpenChange={(v) => {
            setCreditDialogOpen(v);
            if (!v) {
              setCreditCustomersError(null);
              setCreditCustomers([]);
            }
          }}
        >
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Pay Members Credit</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="text-sm text-slate-600">
                {creditCustomersLoading ? 'Loading…' : `${creditTotals.count} customer${creditTotals.count === 1 ? '' : 's'} pending`}
              </div>
              <div className="text-sm font-semibold text-slate-900 tabular-nums">
                Total Pending: ₹{Number(creditTotals.total || 0).toLocaleString('en-IN')}
              </div>
            </div>

            {creditCustomersError ? (
              <div className="py-6 text-center text-sm text-red-600">{creditCustomersError}</div>
            ) : creditCustomersLoading ? (
              <div className="py-8 text-center text-sm text-slate-600">Loading customers…</div>
            ) : creditCustomers.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-600">No customers with pending credit.</div>
            ) : (
              <div className="rounded border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Contact</TableHead>
                      <TableHead className="text-right">Credit Pending</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditCustomers.map((c) => (
                      <TableRow key={`cc-${c.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs">{(c.name || 'C').slice(0, 1).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">{c.name}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-sm text-slate-800">{c.phone || '-'}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="font-semibold tabular-nums text-amber-700">₹{Number(c.credit || 0).toLocaleString('en-IN')}</div>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" onClick={() => openPayCredit(c)}>
                            Pay
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <DialogFooter className="mt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setCreditDialogOpen(false);
                }}
              >
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Pay Customer Credit - Payment Dialog */}
        <Dialog open={payCreditDialogOpen} onOpenChange={setPayCreditDialogOpen}>
          <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-md">
            <DialogHeader>
              <DialogTitle>Pay Outstanding Credit</DialogTitle>
              <DialogDescription>
                {payCreditCustomer ? (
                  <span>
                    {payCreditCustomer.name} • Pending ₹{Number(payCreditCustomer.credit || 0).toLocaleString('en-IN')}
                  </span>
                ) : (
                  'Select a payment mode and confirm.'
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    min={0}
                    className="no-number-spinner"
                    value={payCreditAmount}
                    onChange={(e) => setPayCreditAmount(Number(e.target.value || 0))}
                  />
                </div>
                <div>
                  <Label className="text-xs">Payment Mode</Label>
                  <Select value={payCreditMode} onValueChange={setPayCreditMode}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash">Cash</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                      <SelectItem value="UPI">UPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setPayCreditDialogOpen(false)} disabled={payCreditSubmitting}>
                Cancel
              </Button>
              <Button onClick={submitPayCustomerCredit} disabled={payCreditSubmitting}>
                {payCreditSubmitting ? 'Processing…' : 'Submit Payment'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Print Options Dialog */}
        <Dialog open={printOptionsOpen} onOpenChange={(v) => { 
          setPrintOptionsOpen(v); 
          if (!v) { 
            setPendingPrintInvoiceId(null); 
            setSelectedPrinterType('auto'); 
          } 
        }}>
          <DialogContent className="max-w-md mx-4">
            <DialogHeader>
              <DialogTitle className="text-lg">Print Options</DialogTitle>
              <CardDescription>
                Choose your printer type for optimal formatting
                <br />
                <span className="text-xs text-gray-400">💡 Tip: Hold Shift while clicking print buttons for quick auto-print</span>
              </CardDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-3">
                <Label className="text-sm font-medium">Printer Type</Label>
                <div className="space-y-2">
                  {[
                    { 
                      value: 'auto', 
                      label: 'Auto Detect', 
                      description: 'Automatically detect printer type',
                      icon: '🔍'
                    },
                    { 
                      value: 'thermal', 
                      label: 'Thermal Printer (58mm)', 
                      description: 'USB or Bluetooth thermal printers, mobile POS printers',
                      icon: '🧾' 
                    },
                    { 
                      value: 'standard', 
                      label: 'Standard Receipt (80mm)', 
                      description: 'Most common receipt printers',
                      icon: '🖨️' 
                    },
                    { 
                      value: 'a4', 
                      label: 'A4/Letter Printer', 
                      description: 'Laser or inkjet printers',
                      icon: '📄' 
                    }
                  ].map((option) => (
                    <div
                      key={option.value}
                      className={cn(
                        "flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                        selectedPrinterType === option.value
                          ? "border-primary bg-primary/5"
                          : "border-gray-200 hover:bg-gray-50"
                      )}
                      onClick={() => setSelectedPrinterType(option.value as any)}
                    >
                      <div className="text-lg">{option.icon}</div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="printerType"
                            value={option.value}
                            checked={selectedPrinterType === option.value}
                            onChange={() => setSelectedPrinterType(option.value as any)}
                            className="h-4 w-4"
                          />
                          <label className="font-medium text-sm">{option.label}</label>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">{option.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button 
                variant="outline" 
                onClick={() => setPrintOptionsOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button 
                variant="outline"
                onClick={async () => {
                  if (pendingPrintInvoiceId) {
                    setShowPreview(true);
                    
                    // Handle thermal preview differently
                    if (selectedPrinterType === 'thermal') {
                      try {
                        const acc = (user as any)?.account_code;
                        const ret = (user as any)?.retail_code;
                        if (acc && ret) {
                          const thermalPreview = await generateInvoicePreview(pendingPrintInvoiceId, acc, ret);
                          setPreviewContent(thermalPreview);
                          setPreviewInvoiceId(pendingPrintInvoiceId);
                          setPreviewDocumentTitle('');
                          setPreviewDocumentTitle('');
                          setPreviewDialogOpen(true);
                          setPrintOptionsOpen(false);
                        }
                      } catch (error) {
                        toast({
                          title: "Preview Error",
                          description: "Failed to generate thermal preview",
                          variant: "destructive"
                        });
                      }
                    } else {
                      await handlePrintInvoice(pendingPrintInvoiceId, selectedPrinterType);
                    }
                  }
                }}
                className="w-full sm:w-auto"
                disabled={!pendingPrintInvoiceId}
              >
                <Eye className="h-4 w-4 mr-2" />
                Preview
              </Button>
              <Button 
                onClick={async () => {
                  if (pendingPrintInvoiceId) {
                    setPrintOptionsOpen(false);
                    setShowPreview(false);
                    
                    // Handle thermal printing differently
                    if (selectedPrinterType === 'thermal') {
                      await handleThermalPrint(pendingPrintInvoiceId);
                    } else {
                      await handlePrintInvoice(pendingPrintInvoiceId, selectedPrinterType);
                    }
                    
                    setPendingPrintInvoiceId(null);
                    setSelectedPrinterType('auto');
                  }
                }}
                className="w-full sm:w-auto"
                disabled={!pendingPrintInvoiceId}
              >
                <Printer className="h-4 w-4 mr-2" />
                Print Receipt
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview Dialog */}
        <Dialog open={previewDialogOpen} onOpenChange={(v) => { 
          setPreviewDialogOpen(v); 
          if (!v) { 
            setPreviewInvoiceId(null); 
            setPreviewContent(''); 
            setPreviewDocumentTitle('');
          } 
        }}>
          <DialogContent className="max-w-md mx-4 max-h-[90vh] overflow-auto">
            <DialogHeader>
              <DialogTitle className="text-lg">Invoice Preview</DialogTitle>
              <CardDescription>
                Preview before printing to Bluetooth printer
              </CardDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              {/* Preview Content */}
              <div className="border rounded-lg p-4 bg-gray-50 max-h-96 overflow-auto">
                <div dangerouslySetInnerHTML={{ __html: previewContent }} />
              </div>
              
              {/* Print Confirmation */}
              <div className="text-center space-y-2">
                <p className="text-sm text-gray-600">
                  Ready to print to Bluetooth printer?
                </p>
                <p className="text-xs text-gray-500">
                  Make sure your Bluetooth printer is connected in Settings
                </p>
              </div>
            </div>
            
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button 
                variant="outline" 
                onClick={() => setPreviewDialogOpen(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button 
                variant="outline"
                onClick={() => {
                  if (previewInvoiceId) {
                    handleBrowserPrint(previewInvoiceId, previewDocumentTitle || undefined);
                  }
                }}
                className="w-full sm:w-auto border-blue-300 text-blue-700 hover:bg-blue-50"
                disabled={!previewInvoiceId}
              >
                <Printer className="h-4 w-4 mr-2" />
                Browser Print
              </Button>
              <Button 
                onClick={() => {
                  if (previewInvoiceId) {
                    handleThermalPrint(previewInvoiceId);
                  }
                }}
                className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                disabled={!previewInvoiceId}
              >
                <Printer className="h-4 w-4 mr-2" />
                Bluetooth Print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </div>
  );
}
