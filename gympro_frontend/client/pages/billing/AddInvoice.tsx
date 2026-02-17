import { useState, useRef, useCallback, useEffect, useMemo, type TouchEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiService } from "@/services/apiService";
import { DataService } from "@/services/userService";
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceService } from "@/services/invoiceService";
import AppointmentTransactionService from "@/services/appointmentTransactionService";
import { useToast } from "@/hooks/use-toast";
import { toIST, formatYMDIST, nowIST } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
// Badge removed from suggestions
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import QrScannerDialog from "@/components/QrScannerDialog";
import {
  ArrowLeft,
  Receipt,
  X,
  Plus,
  Loader2,
  Calculator,
  User,
  Calendar,
  FileText,
  Percent,
  CreditCard,
  CheckCircle,
  AlertCircle,
  XCircle,
  Phone,
  Mail,
  Scissors,
  Search,
  Pencil,
  Printer,
  IdCard,
  ListChecks,
  QrCode,
  Package,
  ShoppingBag,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Trash2,
  UserCheck,
  Wallet,
  Eye,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { SiMeta } from "react-icons/si";

type MasterCreateKey = 'service' | 'package' | 'inventory';

interface Service {
  discount_percentage: number;
  id: string;
  name: string;
  price: number;
  quantity: number;
  description?: string;
  basePrice?: number;
  service_id?: string;
  taxId?: string | number;
  taxRate?: number; // combined tax percent for this service
  staffId?: string | number; // staff assigned to this specific service
  staffName?: string; // staff name for display
  // Multi-staff (per-quantity) assignments for SERVICES only (not packages/inventory)
  staffAssignments?: Array<{ staffId: string | number; staffName?: string }>;
  // Inventory specific metadata (optional)
  productBusinessId?: string; // inventory product_id (business id)
  barcode?: string | null;
  brand?: string | null;
  // Marks if the line was loaded from an existing invoice (edit mode)
  persisted?: boolean;
}

interface Customer {
  id: string;
  customer_id?: string;
  name: string;
  email: string;
  phone: string;
  totalVisits: number;
  lastVisit: string;
  customerCredit?: number;
  visitCount?: number;
}
interface CustomerSuggestion {
  customer_name?: string;
  full_name?: string;
  name?: string; // backend may return any of these
  phone?: string;
  mobile?: string;
  customer_phone?: string;
  id?: number | string;
  customer_id?: number | string; // Business customer ID (preferred over primary key id)
  email?: string;
  total_visits?: number;
  last_visit?: string;
  customer_visitcnt?: number; // Visit count from database
  customer_credit?: number; // Customer credit amount from database
  membership_id?: number | string; // For membership discount application
  membership_membership_name?: string; // Membership name from joined table
  membership_discount_percent?: number; // Discount percentage from joined table
  membership_membership_details?: string; // Additional membership details
}

// Helper: de-duplicate customer suggestions by stable key
const dedupeCustomerSuggestions = (items: CustomerSuggestion[]): CustomerSuggestion[] => {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: CustomerSuggestion[] = [];
  for (const it of items) {
    const id = (it.customer_id ?? it.id);
    const name = String(it.customer_name || it.full_name || it.name || '').trim().toLowerCase();
    const phone = String(it.phone || it.mobile || it.customer_phone || '').replace(/\D+/g, '');
    const key = id != null && id !== '' ? `id:${id}` : `np:${name}|${phone}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(it);
    }
  }
  return out;
};

interface ServiceSuggestion {
  name: string;
  price: number;
  description: string;
  duration: string;
  service_id?: string;
}

interface MasterTax {
  id: number;
  tax_id: string;
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  status: number;
}

interface MasterHSN {
  id: number;
  hsn_id?: string;
  hsn_code?: string;
  hsn_name?: string;
  description?: string;
  tax_id?: string | number;
  status?: number;
}

interface MasterPaymentMode {
  id: number;
  payment_id: string;
  payment_mode_name: string;
  status: number;
}

interface SelectedPaymentMode {
  id: string;
  name: string;
  amount: number;
}

interface MasterService {
  id: number;
  service_id: string;
  service_name: string;
  service_description?: string;
  price: number;
  seasonal_price?: number;
  status: number;
  // Backends may provide either category_id or category_name; prefer id for filters
  category_id?: string | number;
  category_name?: string;
  preferred_gender?: string;
  display_order?: number;
}

interface MasterPackage {
  id: number;
  package_id: string;
  account_code?: string;
  retail_code?: string;
  package_name: string;
  package_description?: string;
  package_price: number; // price field from backend
  package_duration?: number;
  // Some backends return tax as tax_id; others as taxid/taxId. We'll normalize to tax_id.
  tax_id?: string | number;
  status: number;
  created_user?: string | null;
  updated_user?: string | null;
  created_at?: string;
  updated_at?: string | null;
}

interface MasterEmployee {
  id: number;
  employee_id: string;
  employee_name: string;
  designation: string;
  gender: string;
  skill_level: string;
  price_markup_percent: number;
  price_markup_amount?: number;
  status: number;
}

interface MasterMembership {
  id: number;
  membership_id: number;
  membership_name: string;
  duration_months: number;
  price: number;
  discount_percent: number;
  status: number;
}

interface MasterCategory {
  id: number;
  category_id?: string | number;
  category_name?: string;
  name?: string;
  category?: string;
  status?: number;
}

interface WalletLedgerEntry {
  id: number;
  customer_id: number;
  invoice_id: string;
  entry_date: string;
  txn_type: 'ADD' | 'USE' | 'CREDIT' | 'PAYMENT';
  amount: number;
  status: 'PENDING' | 'RECEIVED' | 'SUCCESS';
  notes?: string;
  account_code: string;
  retail_code: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface MasterDataResponse {
  master_tax?: MasterTax[];
  master_paymentmodes?: MasterPaymentMode[];
  master_service?: MasterService[];
  master_employee?: MasterEmployee[];
  master_membership?: MasterMembership[];
  master_category?: MasterCategory[];
  master_hsn?: MasterHSN[];
}

export default function AddInvoice() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const editId = searchParams.get('edit');
  const fromAppt = searchParams.get('from_appt') === '1';
  const fromApptId = searchParams.get('appointment_id') || '';
  const isEditMode = !!editId;

  // Debug logging removed
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  );

  // Multiple customers state
  const [customers, setCustomers] = useState<{
    id: string;
    customer: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    customerGender: string;
    customerMembershipId: string;
    customerBirthday: string;
    customerAnniversary: string;
    customerMembershipCardNo: string;
    customerAddress: string;
    visitCount: string;
    creditPending: string;
    customerAge: string;
    customerHeight: string;
    customerWeight: string;
  }[]>([
    {
      id: '1',
      customer: "",
      customerId: "",
      customerName: "",
      customerPhone: "",
      customerGender: "",
      customerMembershipId: "",
      customerBirthday: "",
      customerAnniversary: "",
      customerMembershipCardNo: "",
      customerAddress: "",
      visitCount: "0",
      creditPending: "0",
      customerAge: "",
      customerHeight: "",
      customerWeight: "",
    }
  ]);

  const [newInvoice, setNewInvoice] = useState({
    customer: "",
    customerName: "",
    customerPhone: "",
    customerGender: "",
    date: formatYMDIST(nowIST()),
    services: [] as Service[],
    discount: "",
    discountType: "percentage" as "percentage" | "fixed",
    tax: 18,
    taxId: "",
    notes: "",
    paymentMethod: "cash" as string,
    paymentModeId: "",
    // Additional customer details
    customerMembershipId: "",
    customerBirthday: "",
    customerAnniversary: "",
    customerMembershipCardNo: "",
    customerAddress: "",
  });

  // API data states
  const [masterTaxes, setMasterTaxes] = useState<MasterTax[]>([]);
  const [masterHSNs, setMasterHSNs] = useState<MasterHSN[]>([]);
  const [masterPaymentModes, setMasterPaymentModes] = useState<MasterPaymentMode[]>([]);
  const [masterServices, setMasterServices] = useState<MasterService[]>([]);
  const [masterPackages, setMasterPackages] = useState<MasterPackage[]>([]);
  const [masterInventory, setMasterInventory] = useState<MasterInventory[]>([]);
  const [masterEmployees, setMasterEmployees] = useState<MasterEmployee[]>([]);
  const [masterMemberships, setMasterMemberships] = useState<MasterMembership[]>([]);
  const [categoryNameMap, setCategoryNameMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingEditData, setLoadingEditData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [holdSubmitting, setHoldSubmitting] = useState(false);
  const [cancelSubmitting, setCancelSubmitting] = useState(false);
  const [prefillApplied, setPrefillApplied] = useState(false);

  // Lightweight prefill when arriving from Appointments (does not require backend calls).
  // This ensures the UI inputs (bound to `customers[]`) show customer details immediately.
  useEffect(() => {
    if (!fromAppt) return;

    const qpName = String(searchParams.get('customer_name') || searchParams.get('customerName') || '').trim();
    const qpPhoneRaw = String(searchParams.get('customer_phone') || searchParams.get('customerPhone') || '').trim();
    const qpPhone = qpPhoneRaw.replace(/\D+/g, '').slice(0, 10);

    if (!qpName && !qpPhone) return;

    setCustomers(prev => {
      if (!prev.length) return prev;
      const first = prev[0];
      const nextFirst = { ...first };
      if (!String(nextFirst.customerName || '').trim() && qpName) nextFirst.customerName = qpName;
      if (!String(nextFirst.customerPhone || '').trim() && qpPhone) nextFirst.customerPhone = qpPhone;
      return [nextFirst, ...prev.slice(1)];
    });

    setNewInvoice(prev => {
      const next = { ...prev };
      if (!String(next.customerName || '').trim() && qpName) next.customerName = qpName;
      if (!String(next.customerPhone || '').trim() && qpPhone) next.customerPhone = qpPhone;
      return next;
    });

    setSelectedCustomer(prev => {
      if (prev) return prev;
      if (!qpName && !qpPhone) return prev;
      return {
        id: '',
        name: qpName || 'Customer',
        email: '',
        phone: qpPhone,
        totalVisits: 0,
        lastVisit: '',
        visitCount: 0,
        customerCredit: 0,
      } as any;
    });
  }, [fromAppt, searchParamsKey]);

  // Customer membership data
  const [customerMembership, setCustomerMembership] = useState<MasterMembership | null>(null);
  // Control whether membership discount should auto-apply into the Discount field
  const [applyMembershipDiscountToggle, setApplyMembershipDiscountToggle] = useState<boolean>(true);
  // Track whether we auto-filled the discount field from membership (so we can clear it when toggled off)
  const membershipDiscountAutoFilledRef = useRef<boolean>(false);
  const lastMembershipKeyRef = useRef<string>('');
  const lastMembershipToggleRef = useRef<boolean>(applyMembershipDiscountToggle);
  // Lock tax to appointment summary
  const [lockToApptTax, setLockToApptTax] = useState(false);
  const [apptTaxSummary, setApptTaxSummary] = useState<{ cgst: number; sgst: number; total: number } | null>(null);
  // Tax exemption toggle
  const [showBreakdown, setShowBreakdown] = useState(false);

  // Auto-fill discount textbox with membership % when enabled.
  // We only force-sync on toggle/membership/type changes (not on every keystroke).
  useEffect(() => {
    const membershipPercent = customerMembership ? Number(customerMembership.discount_percent || 0) : 0;
    const membershipKey = customerMembership ? String((customerMembership as any).membership_id ?? (customerMembership as any).id ?? '') : '';
    const toggleJustEnabled = applyMembershipDiscountToggle && !lastMembershipToggleRef.current;
    const toggleJustDisabled = !applyMembershipDiscountToggle && lastMembershipToggleRef.current;
    const membershipJustApplied = !!membershipKey && !lastMembershipKeyRef.current;

    // Always update change trackers
    lastMembershipToggleRef.current = applyMembershipDiscountToggle;
    lastMembershipKeyRef.current = membershipKey;

    const currentRaw = String(newInvoice.discount ?? '').trim();
    const current = currentRaw === '' ? 0 : (Number(currentRaw) || 0);

    // Membership discount amount is computed only on eligible service lines (exclude packages/products)
    const eligibleGrossSum = newInvoice.services.reduce((sum: number, s: any) => {
      if (!s?.name || !s?.price) return sum;
      const sid = String(s?.service_id || '');
      const eligible = !(sid.startsWith('pkg:') || sid.startsWith('inv:'));
      if (!eligible) return sum;
      return sum + (Number(s.price) || 0) * (Number(s.quantity) || 0);
    }, 0);
    const membershipAmount = (membershipPercent > 0 && eligibleGrossSum > 0)
      ? Number(((eligibleGrossSum * membershipPercent) / 100).toFixed(2))
      : 0;

    // If membership was turned OFF, remove membership portion from the textbox.
    // The textbox is treated as TOTAL discount while membership is ON.
    if (toggleJustDisabled && currentRaw !== '') {
      const next = newInvoice.discountType === 'percentage'
        ? Math.max(0, Number((current - membershipPercent).toFixed(2)))
        : Math.max(0, Number((current - membershipAmount).toFixed(2)));
      setNewInvoice(prev => ({
        ...prev,
        discount: next > 0 ? String(next) : '',
      }));
      membershipDiscountAutoFilledRef.current = false;
      return;
    }

    if (applyMembershipDiscountToggle && membershipPercent > 0) {
      const desired = newInvoice.discountType === 'percentage' ? membershipPercent : membershipAmount;
      // If empty/zero OR we previously auto-filled, keep the textbox aligned with membership.
      if ((currentRaw === '' || current <= 0) || membershipDiscountAutoFilledRef.current) {
        setNewInvoice(prev => ({
          ...prev,
          discount: String(desired),
        }));
        membershipDiscountAutoFilledRef.current = true;
        return;
      }

      // If membership was enabled/applied after user entered a discount, treat the existing value as
      // additional and add membership once.
      if (toggleJustEnabled || membershipJustApplied) {
        const nextTotal = Number((current + desired).toFixed(2));
        setNewInvoice(prev => ({
          ...prev,
          discount: String(nextTotal),
        }));
        membershipDiscountAutoFilledRef.current = false;
      }
      return;
    }

    // If toggled off (or membership removed), clear the auto-filled value.
    if (membershipDiscountAutoFilledRef.current) {
      setNewInvoice(prev => ({
        ...prev,
        discount: '',
      }));
    }
    membershipDiscountAutoFilledRef.current = false;
  }, [applyMembershipDiscountToggle, customerMembership?.membership_id, customerMembership?.discount_percent, newInvoice.discountType, newInvoice.services]);
  const [taxExempted, setTaxExempted] = useState(false);

  // Print confirmation dialog state
  const [showPrintConfirmation, setShowPrintConfirmation] = useState(false);
  const [invoiceDataForPrint, setInvoiceDataForPrint] = useState<any>(null);
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

  // Global staff assignment state
  const [globalStaffId, setGlobalStaffId] = useState<string>('');
  const [globalStaffOpen, setGlobalStaffOpen] = useState(false);

  // Multiple payment modes state
  const [selectedPaymentModes, setSelectedPaymentModes] = useState<SelectedPaymentMode[]>([]);
  const [creditAmount, setCreditAmount] = useState<number>(0);

  // Invoice status state for hold functionality
  const [invoiceStatus, setInvoiceStatus] = useState<'active' | 'hold'>('active');

  // Provider credits state
  const [providerCredits, setProviderCredits] = useState<number | null>(null);

  useEffect(() => {
    const fetchCredits = async () => {
      try {
        const res: any = await ApiService.get("/api/credits/balance");
        if (res && (res.balance !== undefined || res.data?.balance !== undefined)) {
          const bal = res.balance !== undefined ? res.balance : res.data?.balance;
          setProviderCredits(Number(bal));
        }
      } catch (e) {
        console.error("Failed to load provider credits", e);
      }
    };
    fetchCredits();
  }, []);

  // Customer visit history modal state
  const [showVisitHistory, setShowVisitHistory] = useState(false);
  const [visitHistoryData, setVisitHistoryData] = useState<any>(null);
  const [loadingVisitHistory, setLoadingVisitHistory] = useState(false);

  // Visit invoice details dialog state
  const [showVisitInvoiceDetails, setShowVisitInvoiceDetails] = useState(false);
  const [visitInvoiceId, setVisitInvoiceId] = useState<string | null>(null);
  const [visitInvoiceDetails, setVisitInvoiceDetails] = useState<any>(null);
  const [loadingVisitInvoiceDetails, setLoadingVisitInvoiceDetails] = useState(false);
  // Track billstatus for currently opened invoice (header) so we can hide actions when cancelled
  const [invoiceBillStatus, setInvoiceBillStatus] = useState<string | null>(null);

  // Full credit confirmation dialog state
  const [showCreditConfirmation, setShowCreditConfirmation] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<React.FormEvent | null>(null);

  // Ensure membership toast fires only once per membership id
  const lastMembershipToastIdRef = useRef<string | number | null>(null);

  const showMembershipToastOnce = useCallback((membership: any) => {
    const id = (membership?.membership_id ?? membership?.id) as string | number | null;
    if (id == null) return;
    if (lastMembershipToastIdRef.current === id) return;
    lastMembershipToastIdRef.current = id;
    toast({
      title: "Membership Applied",
      description: `${membership.membership_name} - ${membership.discount_percent}% discount applied`,
    });
  }, [toast]);

  // Helper function to apply membership discount
  // Normalize gender strings coming from various sources to Select values
  const normalizeGender = (val: any): '' | 'male' | 'female' | 'other' => {
    const v = String(val ?? '').trim().toLowerCase();
    if (!v) return '';
    if (v === 'male' || v === 'm' || v === '1') return 'male';
    if (v === 'female' || v === 'f' || v === '2') return 'female';
    return 'other';
  };

  const applyMembershipDiscount = useCallback((membershipId: number | string | null) => {
    if (!membershipId || masterMemberships.length === 0) {
      setCustomerMembership(null);
      return;
    }

    const membership = masterMemberships.find(m =>
      m.membership_id == membershipId || m.id == membershipId
    );

    if (membership) {
      setCustomerMembership(membership);
    } else {
      setCustomerMembership(null);
    }
  }, [masterMemberships, showMembershipToastOnce]);

  const [suggestions, setSuggestions] = useState<ServiceSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<string | null>(null);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  // Compact service search
  const [serviceSearch, setServiceSearch] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("");
  const [productCategoryFilterOpen, setProductCategoryFilterOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [genderFilter, setGenderFilter] = useState("");
  const [showOnlySelected, setShowOnlySelected] = useState(false);
  const [showOnlySelectedPackages, setShowOnlySelectedPackages] = useState(false);
  const [showOnlySelectedProducts, setShowOnlySelectedProducts] = useState(false);
  // Collapse toggles (start closed)
  const [packagesOpen, setPackagesOpen] = useState(false);
  const [productsOpen, setProductsOpen] = useState(false);

  // Billing feature flags from retail_master (fetched via /read; do not use sessionStorage)
  const [enableServicesOnBilling, setEnableServicesOnBilling] = useState(false);
  const [enablePackagesOnBilling, setEnablePackagesOnBilling] = useState(true);
  const [enableInventoryOnBilling, setEnableInventoryOnBilling] = useState(false);

  const normalizeBillingUIMode = (value: any): "touch" | "type" => {
    const s = String(value ?? "").trim().toLowerCase();
    return s === "type" ? "type" : "touch";
  };
  const [billingUIMode, setBillingUIMode] = useState<"touch" | "type">("touch");

  const isTypeBillingUI = billingUIMode === 'type';

  type TypeBillingKind = 'service' | 'package' | 'inventory';
  type TypeBillingSuggestion = {
    key: string;
    kind: TypeBillingKind;
    label: string;
    price: number;
    raw: any;
  };
  type TypeBillingRow = Service & {
    itemText: string;
  };

  const tTrim = (v: any) => String(v ?? '').trim();
  const makeTypeRowId = () => Math.random().toString(36).slice(2);
  const createEmptyTypeRow = (): TypeBillingRow => ({
    id: makeTypeRowId(),
    itemText: '',
    name: '',
    price: 0,
    quantity: 0,
    discount_percentage: 0,
    staffId: '',
    staffName: '',
  });

  const isTypeRowBlank = (row: TypeBillingRow) => {
    return (
      !tTrim(row.itemText) &&
      !tTrim(row.name) &&
      !tTrim(row.service_id) &&
      !(Number(row.quantity) > 0) &&
      !(Number(row.price) > 0) &&
      !(Number(row.discount_percentage) > 0) &&
      !tTrim(row.staffId)
    );
  };

  const isTypeRowComplete = (row: TypeBillingRow) => {
    return (
      !!tTrim(row.name) &&
      !!tTrim(row.service_id) &&
      Number(row.quantity || 0) > 0 &&
      Number(row.price || 0) > 0 &&
      !!tTrim(row.staffId)
    );
  };

  const [typeRows, setTypeRows] = useState<TypeBillingRow[]>(() => [createEmptyTypeRow()]);
  const typeRowsInitRef = useRef(false);
  const [typeSuggestRowId, setTypeSuggestRowId] = useState<string | null>(null);
  const [typeSuggestIndex, setTypeSuggestIndex] = useState(-1);
  const [typeStaffOpenRowId, setTypeStaffOpenRowId] = useState<string | null>(null);
  const [typePendingFocusRowId, setTypePendingFocusRowId] = useState<string | null>(null);
  const typePendingFocusAttemptsRef = useRef(0);
  const [typeRowErrors, setTypeRowErrors] = useState<
    Record<string, { item?: boolean; qty?: boolean; price?: boolean; staff?: boolean }>
  >({});

  const typeItemTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const typeQtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const typePriceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const typeStaffTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Focus the next row's Item Name reliably after rows render.
  // Radix Select restores focus to its trigger on close, so we retry with a short delay.
  useEffect(() => {
    if (!typePendingFocusRowId) return;
    typePendingFocusAttemptsRef.current = 0;

    let cancelled = false;
    const tryFocus = () => {
      if (cancelled) return;
      const el = typeItemTriggerRefs.current[typePendingFocusRowId];
      if (el) {
        el.focus();
        setTypeSuggestRowId(typePendingFocusRowId);
        setTypePendingFocusRowId(null);
        return;
      }

      typePendingFocusAttemptsRef.current += 1;
      if (typePendingFocusAttemptsRef.current >= 12) {
        setTypePendingFocusRowId(null);
        return;
      }
      setTimeout(tryFocus, 50);
    };

    // Delay slightly so Select close focus-restore completes first
    const t = setTimeout(tryFocus, 60);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [typePendingFocusRowId, typeRows]);

  const toServiceLine = useCallback((row: TypeBillingRow): Service => {
    return {
      id: row.id,
      name: row.name,
      price: Number(row.price || 0),
      quantity: Number(row.quantity || 0),
      discount_percentage: Number(row.discount_percentage || 0),
      description: row.description,
      basePrice: row.basePrice,
      service_id: row.service_id,
      taxId: row.taxId,
      taxRate: row.taxRate,
      staffId: row.staffId,
      staffName: row.staffName,
      staffAssignments: row.staffAssignments,
      productBusinessId: row.productBusinessId,
      barcode: row.barcode,
      brand: row.brand,
      persisted: row.persisted,
    };
  }, []);

  // Initialize TYPE rows from any preloaded invoice services (edit mode).
  useEffect(() => {
    if (!isTypeBillingUI) return;

    const hasOnlyBlank = typeRows.length === 1 && isTypeRowBlank(typeRows[0]);
    const hasInvoiceLines = Array.isArray(newInvoice.services) && newInvoice.services.some(s => tTrim((s as any)?.name) && Number((s as any)?.quantity || 0) > 0);

    if (!typeRowsInitRef.current || (hasOnlyBlank && hasInvoiceLines)) {
      const existing: TypeBillingRow[] = (newInvoice.services || [])
        .filter(s => tTrim(s.name) && Number(s.quantity || 0) > 0)
        .map(s => ({
          ...s,
          itemText: s.name,
          // Ensure qty/price numeric
          quantity: Number(s.quantity || 0),
          price: Number(s.price || 0),
          discount_percentage: Number(s.discount_percentage || 0),
        }));

      if (!existing.length) {
        setTypeRows([createEmptyTypeRow()]);
      } else {
        const last = existing[existing.length - 1];
        setTypeRows(isTypeRowComplete(last) ? [...existing, createEmptyTypeRow()] : [...existing]);
      }
      typeRowsInitRef.current = true;
    }
  }, [isTypeBillingUI, newInvoice.services]);

  // Keep newInvoice.services in sync with TYPE table rows (exclude blank draft row)
  useEffect(() => {
    if (!isTypeBillingUI) return;
    const derived = typeRows
      .filter(r => tTrim(r.name) && tTrim(r.service_id) && Number(r.quantity || 0) > 0 && Number(r.price || 0) > 0)
      .map(toServiceLine);
    setNewInvoice(prev => {
      const prevLines = Array.isArray(prev.services) ? prev.services : [];
      if (prevLines.length === derived.length) {
        let same = true;
        for (let i = 0; i < derived.length; i++) {
          const a = prevLines[i];
          const b = derived[i];
          if (
            a.id !== b.id ||
            a.name !== b.name ||
            Number(a.quantity || 0) !== Number(b.quantity || 0) ||
            Number(a.price || 0) !== Number(b.price || 0) ||
            Number(a.discount_percentage || 0) !== Number(b.discount_percentage || 0) ||
            String(a.staffId || '') !== String(b.staffId || '') ||
            String(a.service_id || '') !== String(b.service_id || '')
          ) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return { ...prev, services: derived };
    });
  }, [isTypeBillingUI, typeRows, toServiceLine]);

  const parseYNFlag = (value: any, defaultValue: boolean) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    const s = String(value).trim().toLowerCase();
    if (["y", "yes", "true", "1", "on", "enabled"].includes(s)) return true;
    if (["n", "no", "false", "0", "off", "disabled"].includes(s)) return false;
    return defaultValue;
  };

  // Unified search across Services + Packages + Inventory
  const setUnifiedSearch = useCallback((value: string) => {
    setServiceSearch(value);
    setPackageSearch(value);
    setProductSearch(value);
    if (String(value || '').trim()) {
      setPackagesOpen(true);
      setProductsOpen(true);
    }
  }, []);
  // Create-in-modal (reuse existing Masters UI)
  const [masterCreateOpen, setMasterCreateOpen] = useState(false);
  const [masterCreateKey, setMasterCreateKey] = useState<MasterCreateKey>('service');
  // Section-specific tax exemptions
  const [productsTaxExempted, setProductsTaxExempted] = useState(false);
  const [packagesTaxExempted, setPackagesTaxExempted] = useState(false);

  const openMasterCreate = useCallback((key: MasterCreateKey) => {
    setMasterCreateKey(key);
    setMasterCreateOpen(true);
  }, []);

  const fetchMasterData = useCallback(async () => {
    if (!user) return; // wait for auth user (contains account/retail codes & token)
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    setLoading(true);
    try {
      // Do not fetch master_customer via /read (use dedicated search APIs when needed)
      const tables = ["account_master", "retail_master", "master_tax", "master_paymentmodes", "master_service", "master_package", "master_inventory", "master_employee", "master_membership", "master_category", "master_hsn"];
      // Fire one consolidated request (backend supports multi-table) else fall back to per-table
      let consolidated: any = null;
      try {
        consolidated = await ApiService.post('/read', { tables, account_code: acc, retail_code: ret });
      } catch (e) {
        console.warn('Consolidated /read failed, falling back to individual calls', e);
      }
      if (!consolidated) {
        // fallback individual
        const [taxR, payR, servR, packR, empR, memR, custR, catR, hsnR] = await Promise.all([
          ApiService.post('/read', { tables: ['master_tax'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_paymentmodes'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_service'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_package'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_employee'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_membership'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_customer'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_category'], account_code: acc, retail_code: ret }),
          ApiService.post('/read', { tables: ['master_hsn'], account_code: acc, retail_code: ret }),
        ]);
        consolidated = { data: { ...((taxR as any)?.data || {}), ...((payR as any)?.data || {}), ...((servR as any)?.data || {}), ...((packR as any)?.data || {}), ...((empR as any)?.data || {}), ...((memR as any)?.data || {}), ...((custR as any)?.data || {}), ...((catR as any)?.data || {}), ...((hsnR as any)?.data || {}) } };
      }
      const dataRoot: any = (consolidated as any)?.data ?? {};

      // Helper to extract array under multiple possible keys
      const extract = (primary: string, aliases: string[]): any[] => {
        if (Array.isArray(dataRoot)) return dataRoot; // some backends may directly return array
        if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
        for (const k of aliases) {
          if (Array.isArray(dataRoot[k])) return dataRoot[k];
        }
        // search any key that loosely matches (case-insensitive contains)
        const lower = primary.toLowerCase();
        for (const k of Object.keys(dataRoot)) {
          if (k.toLowerCase().includes(lower) && Array.isArray(dataRoot[k])) return dataRoot[k];
        }
        return [];
      };

      // Account master config (Billing UI mode)
      const accountRows: any[] = extract('account_master', ['AccountMaster', 'account', 'accountmaster', 'account_master']);
      const accountRow: any = Array.isArray(accountRows) ? accountRows[0] : null;
      if (accountRow) {
        setBillingUIMode(
          normalizeBillingUIMode(
            accountRow.BillingUI ?? accountRow.billingui ?? accountRow.billing_ui
          )
        );
      }

      // Retail Master config (feature flags)
      const retailRows: any[] = extract('retail_master', ['RetailMaster', 'retail', 'Retail']);
      const retailRow: any = Array.isArray(retailRows) ? retailRows[0] : null;
      if (retailRow) {
        // Force-hide Services section as requested
        setEnableServicesOnBilling(false);
        setEnablePackagesOnBilling(
          parseYNFlag(
            retailRow.enable_packages_onbilling ?? retailRow.EnablePackagesOnBilling,
            true
          )
        );
        // Force-hide Inventory section as requested
        setEnableInventoryOnBilling(false);
      }

      // Taxes
      const taxRows: MasterTax[] = extract('master_tax', ['tax_master', 'taxes', 'tax']);
      if (taxRows.length) {
        const activeTaxes = taxRows.filter(t => t && (t.status == null || t.status === 1));
        setMasterTaxes(activeTaxes);
        const defaultTax = activeTaxes[0];
        if (defaultTax) {
          const totalTax = (Number(defaultTax.cgst) || 0) + (Number(defaultTax.sgst) || 0) + (Number(defaultTax.igst) || 0);
          setNewInvoice(prev => ({ ...prev, tax: totalTax, taxId: String(defaultTax.id) }));
        }
      }

      // Payment Modes
      const payRows: MasterPaymentMode[] = extract('master_paymentmodes', ['master_payment_mode', 'payment_modes', 'payment_mode_master', 'paymodes', 'paymentmodes']);
      if (payRows.length) {
        const activePayments = payRows.filter(p => p && (p.status == null || p.status === 1));
        setMasterPaymentModes(activePayments);
        const defaultPayment = activePayments.find(p => (p.payment_mode_name || '').toLowerCase() === 'cash') || activePayments[0];
        if (defaultPayment) {
          setNewInvoice(prev => ({ ...prev, paymentMethod: (defaultPayment.payment_mode_name || '').toLowerCase(), paymentModeId: String(defaultPayment.id) }));
        }
      }

      // Services
      const serviceRows: MasterService[] = extract('master_service', ['services', 'service_master']);
      const activeServices = serviceRows.length ? serviceRows.filter(s => s && (s.status == null || s.status === 1)) : [];
      const normalizedServices: MasterService[] = activeServices.map((s: any) => ({
        ...s,
        price: Number(s?.price ?? 0),
        seasonal_price: s?.seasonal_price != null ? Number(s.seasonal_price) : undefined,
        display_order: s?.display_order != null ? Number(s.display_order) : undefined,
      }));
      setMasterServices(normalizedServices);

      // Packages
      const packageRows: MasterPackage[] = extract('master_package', ['packages', 'package_master']);
      if (packageRows.length) {
        const activePackages = packageRows.filter(p => p && (p.status == null || p.status === 1));
        // Normalize tax id shape: prefer tax_id, fallback to taxid/taxId
        const normalizedPackages: MasterPackage[] = activePackages.map((p: any) => ({
          ...p,
          tax_id: p?.tax_id ?? p?.taxid ?? p?.taxId ?? undefined,
        }));
        console.log('📦 Package normalization:', normalizedPackages.map(p => ({
          name: p.package_name,
          original_taxid: (p as any).taxid,
          normalized_tax_id: p.tax_id
        })));
        setMasterPackages(normalizedPackages);
      }

      // Inventory (Products)
      const invRows: any[] = extract('master_inventory', ['inventory', 'product_master', 'products']);
      if (invRows.length) {
        // Normalize field names from various APIs: prefer item_name; fallback to product_name or reference_code
        const normalizedInv: MasterInventory[] = invRows
          .filter(p => p && (p.status == null || p.status === 1))
          .map(p => ({
            id: Number(p.id),
            product_id: p.product_id ?? p.id ?? 0,
            product_name: p.item_name ?? p.product_name ?? p.reference_code ?? '',
            price: Number(p.selling_price ?? 0),
            reference_code: p.reference_code ?? undefined,
            barcode: p.barcode ?? undefined,
            item_name: p.item_name ?? p.product_name ?? p.reference_code ?? '',
            brand: p.brand ?? undefined,
            inventory_type: p.inventory_type ?? undefined,
            category: p.category ?? undefined,
            hsn_code: p.hsn_code ?? undefined,
            unit: p.unit ?? undefined,
            purchase_price: p.purchase_price != null ? Number(p.purchase_price) : undefined,
            selling_price: Number(p.selling_price ?? 0),
            tax: (p.tax ?? p.tax_id ?? undefined),
            min_stock_level: p.min_stock_level != null ? Number(p.min_stock_level) : undefined,
            expiry_applicable: p.expiry_applicable != null ? Number(p.expiry_applicable) : undefined,
            expiry_date: p.expiry_date ?? undefined,
            display_order: p.display_order != null ? Number(p.display_order) : undefined,
            status: p.status != null ? Number(p.status) : undefined,
            created_user: p.created_user ?? null,
            updated_user: p.updated_user ?? null,
            created_at: p.created_at ?? null,
            updated_at: p.updated_at ?? null,
          }));
        setMasterInventory(normalizedInv);
      }

      // Employees
      const employeeRows: MasterEmployee[] = extract('master_employee', ['employees', 'staff', 'staff_master']);
      if (employeeRows.length) {
        const activeEmps = employeeRows.filter(e => e && (e.status == null || e.status === 1));
        setMasterEmployees(activeEmps);
      }

      // Memberships
      const membershipRows: MasterMembership[] = extract('master_membership', ['memberships', 'membership_master']);
      if (membershipRows.length) {
        const activeMemberships = membershipRows.filter(m => m && (m.status == null || m.status === 1));
        setMasterMemberships(activeMemberships);
      }

      // Customers - Load all customers as suggestions for quick access
      const customerRows: CustomerSuggestion[] = extract('master_customer', ['customers', 'customer_master']);
      if (customerRows.length) {
        const activeCustomers = customerRows.filter(c => c && ((c as any).status == null || (c as any).status === 1));
        setCustomerSuggestions(dedupeCustomerSuggestions(activeCustomers));
      }

      // Categories - Build ID -> Name map for UI labels
      const categoryRows: MasterCategory[] = extract('master_category', ['categories', 'category_master']);
      if (categoryRows.length) {
        const map: Record<string, string> = {};
        categoryRows.forEach(c => {
          const id = c.category_id != null ? String(c.category_id) : String(c.id);
          const name = (c.category_name || c.name || c.category || id) as string;
          if (id) map[id] = String(name);
        });
        setCategoryNameMap(map);
      } else {
        // Fallback: infer names from services if present (less reliable)
        const map: Record<string, string> = {};
        activeServices.forEach(s => {
          const id = s.category_id != null ? String(s.category_id) : '';
          const name = s.category_name || '';
          if (id && name) map[id] = name;
        });
        if (Object.keys(map).length) setCategoryNameMap(map);
      }

      // HSNs
      const hsnRows: MasterHSN[] = extract('master_hsn', ['hsn_master', 'hsn', 'master_hsn_code']);
      if (hsnRows.length) {
        const activeHSN = hsnRows.filter(h => h && (h.status == null || h.status === 1));
        setMasterHSNs(activeHSN);
      }
    } catch (error) {
      console.error('Error fetching master data:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);
  // Wallet ledger popup states
  const [showWalletLedger, setShowWalletLedger] = useState(false);
  const [showWalletPayModal, setShowWalletPayModal] = useState(false);
  const [walletPayMode, setWalletPayMode] = useState<string>('Cash');
  const [walletPayAmount, setWalletPayAmount] = useState<number>(0);
  const [walletPaySubmitting, setWalletPaySubmitting] = useState(false);
  const [walletLedgerData, setWalletLedgerData] = useState<any[]>([]);
  const [walletLedgerLoading, setWalletLedgerLoading] = useState(false);

  // Swipe-up gesture (touch) support for re-ordering service cards
  const serviceTouchRef = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const serviceGestureConsumedRef = useRef(false);

  // Drag & drop (desktop) support for re-ordering service cards
  const serviceDragIdRef = useRef<number | null>(null);

  const moveServiceBefore = useCallback(
    async (sourceId: number, targetId: number) => {
      if (!sourceId || !targetId || sourceId === targetId) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      const oldOrderById = new Map<number, number | undefined>();
      masterServices.forEach((s) => oldOrderById.set(s.id, s.display_order));

      const sorted = [...masterServices].sort((a, b) => {
        const da = a.display_order ?? Number.POSITIVE_INFINITY;
        const db = b.display_order ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return String(a.service_name || '').localeCompare(String(b.service_name || ''));
      });

      const fromIndex = sorted.findIndex((s) => s.id === sourceId);
      const targetIndex = sorted.findIndex((s) => s.id === targetId);
      if (fromIndex < 0 || targetIndex < 0) return;

      const [moved] = sorted.splice(fromIndex, 1);
      // Insert BEFORE target. If dragging downwards, target index shifts left by 1 after removal.
      const insertIndex = fromIndex < targetIndex ? Math.max(0, targetIndex - 1) : targetIndex;
      sorted.splice(insertIndex, 0, moved);

      // Re-assign sequential display_order to keep it stable and unique.
      const reordered = sorted.map((s, idx) => ({ ...s, display_order: idx + 1 }));
      const reorderedById = new Map<number, MasterService>(reordered.map((s) => [s.id, s]));

      // Optimistic local update
      setMasterServices((prevList) => prevList.map((s) => reorderedById.get(s.id) ?? s));

      // Persist only changed rows (usually a small contiguous range)
      const changed = reordered.filter((s) => oldOrderById.get(s.id) !== s.display_order);
      if (!changed.length) return;

      const results = await Promise.allSettled(
        changed.map((s) =>
          DataService.updateData('master_service', {
            id: s.id,
            account_code: acc,
            retail_code: ret,
            display_order: s.display_order,
            updated_by: user?.username || 'system',
          }),
        ),
      );

      const failed = results.some(
        (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !(r.value as any)?.success),
      );

      if (failed) {
        toast({
          title: 'Reorder failed',
          description: 'Could not save the new service order. Please try again.',
          variant: 'destructive',
        });
      }
    },
    [masterServices, setMasterServices, toast, user],
  );

  const moveServiceUp = useCallback(
    async (service: MasterService) => {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      // Build a stable sorted view and swap with the previous item.
      const sorted = [...masterServices].sort((a, b) => {
        const da = a.display_order ?? Number.POSITIVE_INFINITY;
        const db = b.display_order ?? Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
        return String(a.service_name || '').localeCompare(String(b.service_name || ''));
      });

      const idx = sorted.findIndex((s) => s.id === service.id);
      if (idx <= 0) return;

      const prev = sorted[idx - 1];
      // Move this card just before the previous one (one step up), shifting others.
      await moveServiceBefore(service.id, prev.id);
    },
    [masterServices, user, moveServiceBefore],
  );

  const handleServiceTouchStart = useCallback((e: TouchEvent<HTMLDivElement>, service: MasterService) => {
    const touch = e.touches?.[0];
    if (!touch) return;
    serviceTouchRef.current = { id: service.id, x: touch.clientX, y: touch.clientY, t: Date.now() };
  }, []);

  const handleServiceTouchEnd = useCallback((e: TouchEvent<HTMLDivElement>, service: MasterService) => {
    const start = serviceTouchRef.current;
    serviceTouchRef.current = null;
    if (!start || start.id !== service.id) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;

    const dy = touch.clientY - start.y;
    const dx = touch.clientX - start.x;
    const dt = Date.now() - start.t;

    // Swipe up: quick upward movement; avoid accidental triggers on scroll/tap.
    if (dy < -45 && Math.abs(dx) < 40 && dt < 500) {
      serviceGestureConsumedRef.current = true;
      setTimeout(() => {
        serviceGestureConsumedRef.current = false;
      }, 0);
      moveServiceUp(service);
    }
  }, [moveServiceUp]);

  const filteredServices = useMemo(() => {
    let filtered = masterServices;

    // Apply search filter
    const q = serviceSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(s => (s.service_name || '').toLowerCase().includes(q));
    }

    // Apply category filter
    if (categoryFilter) {
      filtered = filtered.filter(s => String(s.category_id ?? '') === String(categoryFilter));
    }

    // Apply gender filter
    if (genderFilter) {
      filtered = filtered.filter(s => s.preferred_gender === genderFilter);
    }
    // Apply selected-only toggle
    if (showOnlySelected) {
      const selectedSet = new Set(newInvoice.services.map(s => s.service_id));
      filtered = filtered.filter(s => selectedSet.has(s.service_id));
    }

    // Apply display order
    return [...filtered].sort((a, b) => {
      const da = a.display_order ?? Number.POSITIVE_INFINITY;
      const db = b.display_order ?? Number.POSITIVE_INFINITY;
      if (da !== db) return da - db;
      return String(a.service_name || '').localeCompare(String(b.service_name || ''));
    });
  }, [masterServices, serviceSearch, categoryFilter, genderFilter, showOnlySelected, newInvoice.services]);

  const filteredPackages = useMemo(() => {
    let filtered = masterPackages;

    // Apply search filter
    const q = packageSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(p => (p.package_name || '').toLowerCase().includes(q));
    }

    // Apply selected-only toggle
    if (showOnlySelectedPackages) {
      const selectedSet = new Set(newInvoice.services.map(s => String(s.service_id)));
      filtered = filtered.filter(p => selectedSet.has(`pkg:${String(p.package_id)}`));
    }

    return filtered;
  }, [masterPackages, packageSearch, showOnlySelectedPackages, newInvoice.services]);  // Get unique categories and genders for filter options

  const filteredProducts = useMemo(() => {
    let filtered = masterInventory;

    const q = productSearch.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter(p => (p.item_name || '').toLowerCase().includes(q));
    }

    if (productCategoryFilter) {
      filtered = filtered.filter(p => String(p.category ?? '') === String(productCategoryFilter));
    }

    if (showOnlySelectedProducts) {
      const selectedSet = new Set(newInvoice.services.map(s => String(s.service_id)));
      filtered = filtered.filter(p => selectedSet.has(`inv:${String(p.id)}`));
    }

    return filtered;
  }, [masterInventory, productSearch, productCategoryFilter, showOnlySelectedProducts, newInvoice.services]);

  const availableProductCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of masterInventory) {
      const c = String((p as any)?.category ?? '').trim();
      if (c) set.add(c);
    }
    const list = Array.from(set);
    list.sort((a, b) => {
      const la = categoryNameMap[a] || a;
      const lb = categoryNameMap[b] || b;
      return String(la).localeCompare(String(lb));
    });
    return list;
  }, [masterInventory, categoryNameMap]);
  const availableCategories = useMemo(() => {
    const categories = masterServices
      .map(s => (s.category_id != null ? String(s.category_id) : ''))
      .filter(Boolean)
      .filter((category, index, arr) => category && arr.indexOf(category) === index)
      .sort();
    return categories;
  }, [masterServices]);

  const availableGenders = useMemo(() => {
    const genders = masterServices
      .map(s => s.preferred_gender)
      .filter((gender, index, arr) => gender && arr.indexOf(gender) === index)
      .sort();
    return genders;
  }, [masterServices]);
  // Customer suggestions (separate from service suggestions)
  const [customerSuggestions, setCustomerSuggestions] = useState<CustomerSuggestion[]>([]);
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [customerSelectedIndex, setCustomerSelectedIndex] = useState(-1);
  const [activeCustomerRowId, setActiveCustomerRowId] = useState<string>('1'); // Track which customer row is showing suggestions
  const customerNameRef = useRef<HTMLInputElement | null>(null);
  const customerPhoneRef = useRef<HTMLInputElement | null>(null);
  const customerNameRefs = useRef<{ [customerId: string]: HTMLInputElement | null }>({});
  const customerPhoneRefs = useRef<{ [customerId: string]: HTMLInputElement | null }>({});
  const customerAnchorRef = useRef<'name' | 'phone' | null>(null);
  const customerDropdownPos = useRef<{ top: number; left: number; width: number } | null>(null);
  const [customerDropdownTick, setCustomerDropdownTick] = useState(0); // force re-render when position updates
  const [sidebarMinimized, setSidebarMinimized] = useState(false);
  // Simple UI validation flags
  const [invalid, setInvalid] = useState({
    customerName: false,
    customerPhone: false,
    customerGender: false,
    staff: false,
    payment: false,
    services: false,
    customerAge: false,
    customerHeight: false,
    customerWeight: false,
  });

  // Clear payment highlight when user selects any payment mode or full credit covers total
  useEffect(() => {
    const hasAnyPayment = selectedPaymentModes.length > 0;
    const isFullCredit = creditAmount > 0 && Math.round(creditAmount) === Math.round(
      newInvoice.services.reduce((sum, s) => {
        const subtotal = Number(s.price || 0) * Number(s.quantity || 1);
        const discountAmount = subtotal * (Number(s.discount_percentage || 0) / 100);
        const afterDiscount = subtotal - discountAmount;
        const taxAmount = afterDiscount * (Number(s.taxRate || 0) / 100);
        return sum + afterDiscount + taxAmount;
      }, 0)
    );
    if ((hasAnyPayment || isFullCredit) && invalid.payment) {
      setInvalid(prev => ({ ...prev, payment: false }));
    }
  }, [selectedPaymentModes.length, creditAmount]);
  // QR scanner state for customer auto-load
  const [scanOpen, setScanOpen] = useState(false);
  const [scanTarget, setScanTarget] = useState<'customer' | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanningComplete, setScanningComplete] = useState(false);
  const scanStopRef = useRef(false); // Immediate stop flag
  const scanProcessingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);

  // Reset scan guards only when scanner is opened again
  useEffect(() => {
    if (scanOpen) {
      scanStopRef.current = false;
      scanProcessingRef.current = false;
      lastScanRef.current = null;
    }
  }, [scanOpen]);

  // Load customer by exact membership_cardno from master_customer
  const loadCustomerByCard = useCallback(async (cardNo: string) => {
    const code = String(cardNo || '').trim();
    if (!code || !user) return false;
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const readRes: any = await DataService.readData(["master_customer"], acc, ret);
      const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data || []) as any[];
      const norm = (v: any) => String(v ?? '').trim().toLowerCase();
      let rows = Array.isArray(rowsRaw)
        ? rowsRaw.filter((r: any) => norm(r?.account_code) === norm(acc) && norm(r?.retail_code) === norm(ret))
        : [];
      if (!rows.length && Array.isArray(rowsRaw)) rows = rowsRaw;

      const match = rows.find((r: any) => {
        const a = String(r?.membership_cardno ?? r?.membership_card_no ?? r?.card_no ?? r?.membershipcardno ?? '').trim();
        return a && a.toLowerCase() === code.toLowerCase();
      });
      if (!match) return false;

      const name = sTrim(match.customer_name ?? match.full_name ?? match.name);
      const phone = sTrim(match.phone ?? match.phone1 ?? match.mobile ?? match.customer_phone ?? match.mobile_number);
      const gender = normalizeGender(match.gender ?? match.customer_gender ?? '');
      const customerId = match.customer_id ?? match.CUSTOMER_ID ?? match.id;

      setNewInvoice(prev => ({
        ...prev,
        customer: String(customerId || prev.customer || ''),
        customerName: name || prev.customerName,
        customerPhone: phone || prev.customerPhone,
        customerGender: gender || prev.customerGender,
      }));

      // Also hydrate the primary customer row (the UI is bound to `customers`, not only `newInvoice`)
      setCustomers(prev => prev.map(c =>
        c.id === '1'
          ? {
            ...c,
            customer: String(customerId || c.customer || ''),
            customerId: String(customerId || c.customerId || ''),
            customerName: name || c.customerName,
            customerPhone: phone || c.customerPhone,
            customerGender: gender || c.customerGender,
          }
          : c
      ));

      const vc = Number(match.customer_visitcnt ?? match.total_visits ?? match.totalVisits ?? match.visit_count ?? 0) || 0;
      const cred = Number(match.customer_credit ?? match.credit_pending ?? match.pending_credit ?? match.wallet_balance ?? match.total_balance ?? 0) || 0;

      setSelectedCustomer({
        id: String(customerId || ''),
        name: name || 'Customer',
        email: match.email || '',
        phone,
        totalVisits: Number(match.total_visits || 0),
        lastVisit: String(match.last_visit || ''),
        visitCount: vc,
        customerCredit: cred
      });

      // Populate UI-bound fields shown in the customer grid
      setCustomers(prev => prev.map(c =>
        c.id === '1'
          ? { ...c, visitCount: String(vc), creditPending: String(cred) }
          : c
      ));

      // Populate Additional Customer Details modal fields
      const birthday = sTrim(match.birthday_date ?? match.Birthday_date ?? match.birthday ?? '');
      const anniversary = sTrim(match.anniversary_date ?? match.Anniversary_date ?? match.anniversary ?? '');
      const cardno = sTrim(match.membership_cardno ?? match.membership_card_no ?? match.card_no ?? match.membershipcardno ?? '');
      const address = sTrim(match.address ?? match.Address ?? match.customer_address ?? '');
      const membershipIdVal = match.membership_id ?? match.membershipId ?? '';
      const membershipIdResolved = resolveMembershipId(membershipIdVal);
      const birthdayResolved = toDateInputValue(birthday);
      const anniversaryResolved = toDateInputValue(anniversary);
      const cardResolved = sTrim(cardno);
      const addressResolved = sTrim(address);
      setMoreDetails(prev => ({
        ...prev,
        membership_id: membershipIdResolved || (prev.membership_id || ''),
        birthday_date: birthdayResolved || prev.birthday_date || '',
        anniversary_date: anniversaryResolved || prev.anniversary_date || '',
        membership_cardno: cardResolved || prev.membership_cardno || '',
        address: addressResolved || prev.address || '',
      }));

      // Persist details into primary customer row too
      setCustomers(prev => prev.map(c =>
        c.id === '1'
          ? {
            ...c,
            customerMembershipId: membershipIdResolved || c.customerMembershipId || '',
            customerBirthday: birthdayResolved || c.customerBirthday || '',
            customerAnniversary: anniversaryResolved || c.customerAnniversary || '',
            customerMembershipCardNo: cardResolved || c.customerMembershipCardNo || '',
            customerAddress: addressResolved || c.customerAddress || '',
          }
          : c
      ));

      const membershipId = (match as any).membership_id;
      if (membershipId) applyMembershipDiscount(membershipId);
      return true;
    } catch (e) {
      console.warn('loadCustomerByCard failed', e);
      return false;
    }
  }, [user, applyMembershipDiscount]);

  // Removed problematic useEffect that caused duplicate API calls during scanning

  // Reset "shown" guard when membership is cleared
  useEffect(() => {
    if (!customerMembership) {
      lastMembershipToastIdRef.current = null;
    }
  }, [customerMembership]);

  // Do not write membership percent into the Discount field.
  // The Discount input remains for additional discounts only.
  useEffect(() => {
    // Intentionally left blank: membership application is handled in totals calculation,
    // and NOT merged into the editable discount input.
  }, [customerMembership, applyMembershipDiscountToggle]);

  // Price edit dialog state
  const [priceEditOpen, setPriceEditOpen] = useState(false);
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceEditValue, setPriceEditValue] = useState<string>("");

  // Additional customer details modal state
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  // Track which customer row opened the Additional Details modal
  const [moreDetailsCustomerId, setMoreDetailsCustomerId] = useState<string | null>(null);
  const [moreDetailsLoadingCustomerId, setMoreDetailsLoadingCustomerId] = useState<string | null>(null);
  const [moreDetails, setMoreDetails] = useState<{
    membership_id?: string;
    birthday_date?: string;
    anniversary_date?: string;
    membership_cardno?: string;
    address?: string;
  }>({});

  // Auto-apply membership if customer input matches any suggestion
  useEffect(() => {
    if (!customerSuggestions.length || !newInvoice.customerName.trim()) return;

    const currentName = newInvoice.customerName.toLowerCase().trim();
    const currentPhone = String(newInvoice.customerPhone || '').trim();

    // Find matching customer in all suggestions
    const matchingSuggestion = customerSuggestions.find(suggestion => {
      const suggestionName = String(suggestion.customer_name || suggestion.full_name || suggestion.name || '').toLowerCase().trim();
      const suggestionPhone = String(suggestion.phone || suggestion.mobile || suggestion.customer_phone || '').trim();

      // Match by name or phone
      return suggestionName === currentName || (suggestionPhone && currentPhone && suggestionPhone === currentPhone);
    });

    // Auto-apply membership if found and not already applied
    if (matchingSuggestion) {
      const membershipId = (matchingSuggestion as any).membership_id;
      if (membershipId && !customerMembership) {
        applyMembershipDiscount(membershipId);
      }
    }
  }, [customerSuggestions, newInvoice.customerName, newInvoice.customerPhone, customerMembership, applyMembershipDiscount, masterMemberships.length]);

  // Fetch master data from APIs
  useEffect(() => {
    fetchMasterData();
  }, [fetchMasterData]);

  // Map for quick employee lookup`
  const employeeMap = useMemo(() => {
    const map: Record<string, MasterEmployee> = {};
    masterEmployees.forEach(emp => {
      map[String(emp.id)] = emp;
      map[String(emp.employee_id)] = emp; // ensure consistent string keys
    });
    return map;
  }, [masterEmployees]);

  // Compute display price for catalog tiles based on global staff selection
  const getDisplayPriceWithStaff = useCallback((basePrice?: number) => {
    const base = Number(basePrice || 0);
    if (!globalStaffId) return base;
    const emp = employeeMap[globalStaffId];
    if (!emp) return base;
    const markupPercent = Number(emp.price_markup_percent) || 0;
    const adjusted = base + (base * markupPercent / 100);
    return Number(adjusted.toFixed(2));
  }, [globalStaffId, employeeMap]);

  // Normalizes rows: ensure at least one row, collapse multiple blanks at end.
  // NOTE: Does NOT auto-append a new blank row; we add a new row only after staff selection.
  const normalizeTypeRows = useCallback((rows: TypeBillingRow[]) => {
    let next = Array.isArray(rows) ? [...rows] : [createEmptyTypeRow()];
    // Collapse multiple blank rows at end
    while (next.length > 1 && isTypeRowBlank(next[next.length - 1]) && isTypeRowBlank(next[next.length - 2])) {
      next.pop();
    }
    if (!next.length) next = [createEmptyTypeRow()];
    return next;
  }, [createEmptyTypeRow, isTypeRowBlank]);

  const computeTaxFor = useCallback((taxId: any): { taxId?: string; taxRate?: number } => {
    if (taxId == null || String(taxId).trim() === '') return {};
    const tx = masterTaxes.find(t => String(t.tax_id) === String(taxId) || String(t.id) === String(taxId));
    if (!tx) return { taxId: String(taxId), taxRate: 0 };
    return {
      taxId: String(taxId),
      taxRate: (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0),
    };
  }, [masterTaxes]);

  const applyStaffToTypeRow = useCallback((row: TypeBillingRow, staffId: any) => {
    const sidStr = String(row.service_id || '');
    const isPackage = sidStr.startsWith('pkg:');
    const isInventory = sidStr.startsWith('inv:');
    const staffName = staffId ? (employeeMap[String(staffId)]?.employee_name || '') : '';

    // Price markup applies only to SERVICES (not packages/inventory)
    let nextPrice = Number(row.price || 0);
    const base = row.basePrice != null ? Number(row.basePrice || 0) : undefined;
    if (!isPackage && !isInventory && base != null && staffId) {
      const emp = employeeMap[String(staffId)];
      const fixedExtra = Number((emp as any)?.price_markup_amount) || 0;
      const markupPercent = Number(emp?.price_markup_percent) || 0;
      const adjusted = fixedExtra > 0 ? (base + fixedExtra) : (base + (base * markupPercent / 100));
      nextPrice = Number(adjusted.toFixed(2));
    }

    // Staff assignments: services + packages require per-qty slots; inventory is single
    const qty = Math.max(0, Number(row.quantity || 0));
    const needsAssignments = !isInventory;
    const staffAssignments = needsAssignments && qty > 0
      ? Array.from({ length: qty }).map(() => ({ staffId: staffId || '', staffName }))
      : undefined;

    return {
      staffId: staffId || '',
      staffName,
      price: nextPrice,
      staffAssignments,
    } as Partial<TypeBillingRow>;
  }, [employeeMap]);

  const computeTypeRowTaxAmount = useCallback((row: TypeBillingRow) => {
    const qty = Math.max(0, Number(row.quantity || 0));
    const price = Math.max(0, Number(row.price || 0));
    if (!qty || !price) return 0;

    const gross = qty * price;
    const discountP = Math.min(100, Math.max(0, Number(row.discount_percentage || 0)));
    const discountAmt = gross * (discountP / 100);
    const afterDiscount = Math.max(0, gross - discountAmt);

    const sidStr = String((row as any).service_id || '');
    const isProduct = sidStr.startsWith('inv:');
    const isPackage = sidStr.startsWith('pkg:');

    const exempt = taxExempted || (isProduct && productsTaxExempted) || (isPackage && packagesTaxExempted);
    const taxRate = exempt ? 0 : Number((row as any).taxRate ?? 0);
    const taxAmt = afterDiscount * (taxRate / 100);
    return Number(taxAmt.toFixed(2));
  }, [taxExempted, productsTaxExempted, packagesTaxExempted]);

  const computeTypeRowTaxDisplay = useCallback((row: TypeBillingRow) => {
    const qty = Math.max(0, Number(row.quantity || 0));
    const price = Math.max(0, Number(row.price || 0));
    const hasItem = !!tTrim(row.name) && !!tTrim((row as any).service_id);
    if (!hasItem || !qty || !price) return '';

    const sidStr = String((row as any).service_id || '');
    const isProduct = sidStr.startsWith('inv:');
    const isPackage = sidStr.startsWith('pkg:');
    const exempt = taxExempted || (isProduct && productsTaxExempted) || (isPackage && packagesTaxExempted);
    const taxRate = exempt ? 0 : Number((row as any).taxRate ?? 0);
    const taxAmt = computeTypeRowTaxAmount(row);

    const safeRate = Number.isFinite(taxRate) ? taxRate : 0;
    const rateText = safeRate % 1 === 0 ? String(safeRate.toFixed(0)) : String(safeRate);
    const amtText = Number(taxAmt || 0).toFixed(2);
    return `${rateText}% (${amtText})`;
  }, [computeTypeRowTaxAmount, packagesTaxExempted, productsTaxExempted, taxExempted]);

  const buildTypeSuggestions = useCallback((q: string): TypeBillingSuggestion[] => {
    const query = String(q || '').trim().toLowerCase();
    const out: TypeBillingSuggestion[] = [];

    // Preload: when query is empty, show Services + Packages + Inventory (capped)
    if (!query) {
      if (enableServicesOnBilling) {
        const svc = [...masterServices];
        svc.sort((a: any, b: any) => {
          const an = String((a as any).service_name ?? (a as any).name ?? '').trim().toLowerCase();
          const bn = String((b as any).service_name ?? (b as any).name ?? '').trim().toLowerCase();
          return an.localeCompare(bn);
        });
        for (const s of svc) {
          const name = String((s as any).service_name ?? (s as any).name ?? '').trim();
          if (!name) continue;
          out.push({
            key: `service:${String((s as any).service_id ?? (s as any).id ?? name)}`,
            kind: 'service',
            label: name,
            price: Number((s as any).price || 0),
            raw: s,
          });
          if (out.length >= 80) break;
        }
      }

      if (enablePackagesOnBilling) {
        const pkgs = [...masterPackages];
        pkgs.sort((a: any, b: any) => {
          const an = String((a as any).package_name ?? (a as any).name ?? '').trim().toLowerCase();
          const bn = String((b as any).package_name ?? (b as any).name ?? '').trim().toLowerCase();
          return an.localeCompare(bn);
        });
        for (const p of pkgs) {
          const name = String((p as any).package_name ?? (p as any).name ?? '').trim();
          if (!name) continue;
          const pid = String((p as any).package_id ?? (p as any).id ?? name);
          out.push({
            key: `package:${pid}`,
            kind: 'package',
            label: name,
            price: Number((p as any).package_price || 0),
            raw: p,
          });
          if (out.length >= 140) break;
        }
      }

      if (enableInventoryOnBilling) {
        const inv = [...masterInventory];
        inv.sort((a: any, b: any) => {
          const an = String((a as any).item_name ?? (a as any).product_name ?? (a as any).reference_code ?? '').trim().toLowerCase();
          const bn = String((b as any).item_name ?? (b as any).product_name ?? (b as any).reference_code ?? '').trim().toLowerCase();
          return an.localeCompare(bn);
        });
        for (const prod of inv) {
          const name = String((prod as any).item_name ?? (prod as any).product_name ?? (prod as any).reference_code ?? '').trim();
          if (!name) continue;
          const id = String((prod as any).id ?? (prod as any).product_id ?? name);
          out.push({
            key: `inventory:${id}`,
            kind: 'inventory',
            label: name,
            price: Number((prod as any).selling_price ?? (prod as any).price ?? 0),
            raw: prod,
          });
          if (out.length >= 200) break;
        }
      }

      return out.slice(0, 200);
    }

    if (enableServicesOnBilling) {
      for (const s of masterServices) {
        const name = String((s as any).service_name ?? (s as any).name ?? '').trim();
        if (!name) continue;
        if (name.toLowerCase().includes(query)) {
          out.push({
            key: `service:${String((s as any).service_id ?? (s as any).id ?? name)}`,
            kind: 'service',
            label: name,
            price: Number((s as any).price || 0),
            raw: s,
          });
        }
        if (out.length >= 40) break;
      }
    }

    if (enablePackagesOnBilling) {
      for (const p of masterPackages) {
        const name = String((p as any).package_name ?? (p as any).name ?? '').trim();
        if (!name) continue;
        if (name.toLowerCase().includes(query)) {
          const pid = String((p as any).package_id ?? (p as any).id ?? name);
          out.push({
            key: `package:${pid}`,
            kind: 'package',
            label: name,
            price: Number((p as any).package_price || 0),
            raw: p,
          });
        }
        if (out.length >= 80) break;
      }
    }

    if (enableInventoryOnBilling) {
      for (const prod of masterInventory) {
        const name = String((prod as any).item_name ?? (prod as any).product_name ?? (prod as any).reference_code ?? '').trim();
        if (!name) continue;
        if (name.toLowerCase().includes(query)) {
          const id = String((prod as any).id ?? (prod as any).product_id ?? name);
          out.push({
            key: `inventory:${id}`,
            kind: 'inventory',
            label: name,
            price: Number((prod as any).selling_price ?? (prod as any).price ?? 0),
            raw: prod,
          });
        }
        if (out.length >= 120) break;
      }
    }

    // Prefer startsWith matches first
    out.sort((a, b) => {
      const aq = a.label.toLowerCase().startsWith(query) ? 0 : 1;
      const bq = b.label.toLowerCase().startsWith(query) ? 0 : 1;
      if (aq !== bq) return aq - bq;
      return a.label.localeCompare(b.label);
    });
    return out.slice(0, 12);
  }, [enableServicesOnBilling, enablePackagesOnBilling, enableInventoryOnBilling, masterServices, masterPackages, masterInventory]);

  const activeTypeSuggestions = useMemo(() => {
    if (!typeSuggestRowId) return [] as TypeBillingSuggestion[];
    const row = typeRows.find(r => r.id === typeSuggestRowId);
    if (!row) return [] as TypeBillingSuggestion[];
    return buildTypeSuggestions(row.itemText);
  }, [typeSuggestRowId, typeRows, buildTypeSuggestions]);

  const applyTypeSuggestion = useCallback((rowId: string, suggestion: TypeBillingSuggestion) => {
    setTypeRows(prev => {
      const idx = prev.findIndex(r => r.id === rowId);
      if (idx < 0) return prev;
      const row = prev[idx];

      let next: TypeBillingRow = {
        ...row,
        itemText: suggestion.label,
        name: suggestion.label,
        quantity: 1,
        price: Number(suggestion.price || 0),
        discount_percentage: 0,
      };

      if (suggestion.kind === 'service') {
        const ms: any = suggestion.raw;
        const sid = ms.service_id ?? ms.id?.toString?.() ?? '';
        const basePrice = Number(ms.price || 0);
        const taxBits = computeTaxFor(ms.tax_id);
        next = {
          ...next,
          service_id: String(sid),
          description: ms.service_description,
          basePrice,
          price: basePrice,
          ...taxBits,
        };
      } else if (suggestion.kind === 'package') {
        const mp: any = suggestion.raw;
        const pid = mp.package_id ?? mp.id;
        const pkgSid = `pkg:${String(pid)}`;
        const basePrice = Number(mp.package_price || 0);
        const taxBits = computeTaxFor(mp.tax_id ?? mp.taxid ?? mp.taxId);
        next = {
          ...next,
          service_id: pkgSid,
          description: mp.package_description,
          basePrice,
          price: basePrice,
          ...taxBits,
        };
      } else {
        const prod: any = suggestion.raw;
        const invId = prod.id ?? prod.product_id;
        const sid = `inv:${String(invId)}`;
        const basePrice = Number(prod.selling_price ?? prod.price ?? 0);
        const taxBits = computeTaxFor(prod.tax ?? prod.tax_id);
        next = {
          ...next,
          service_id: sid,
          description: prod.brand || prod.category || '',
          basePrice,
          price: basePrice,
          productBusinessId: String(prod.product_id ?? prod.id ?? ''),
          barcode: prod.barcode ?? null,
          brand: prod.brand ?? null,
          ...taxBits,
        };
      }

      // Auto-assign global staff if present (matches TOUCH behavior)
      const preferredStaff = row.staffId || globalStaffId || '';
      if (preferredStaff) {
        next = { ...next, ...applyStaffToTypeRow(next, preferredStaff) };
      }

      const updated = [...prev];
      updated[idx] = next;
      return normalizeTypeRows(updated);
    });
    setTypeSuggestRowId(null);
    setTypeSuggestIndex(-1);
    requestAnimationFrame(() => {
      typeQtyRefs.current[rowId]?.focus();
      typeQtyRefs.current[rowId]?.select?.();
    });
    setTypeRowErrors(prev => {
      if (!prev[rowId]) return prev;
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  }, [applyStaffToTypeRow, computeTaxFor, normalizeTypeRows, globalStaffId]);

  const updateTypeRow = useCallback((rowId: string, patch: Partial<TypeBillingRow> | ((row: TypeBillingRow) => Partial<TypeBillingRow>)) => {
    setTypeRows(prev => {
      const idx = prev.findIndex(r => r.id === rowId);
      if (idx < 0) return prev;
      const row = prev[idx];
      const delta = typeof patch === 'function' ? patch(row) : patch;
      const nextRow = { ...row, ...delta } as TypeBillingRow;

      // Keep staffAssignments in sync with qty for non-inventory items
      const sidStr = String(nextRow.service_id || '');
      const isInventory = sidStr.startsWith('inv:');
      if (!isInventory) {
        const qty = Math.max(0, Number(nextRow.quantity || 0));
        if (qty > 0 && nextRow.staffId) {
          const staffName = nextRow.staffName || (employeeMap[String(nextRow.staffId)]?.employee_name || '');
          nextRow.staffAssignments = Array.from({ length: qty }).map(() => ({ staffId: nextRow.staffId as any, staffName }));
        } else {
          nextRow.staffAssignments = qty > 0 ? Array.from({ length: qty }).map(() => ({ staffId: '', staffName: '' })) : undefined;
        }
      } else {
        nextRow.staffAssignments = undefined;
      }

      const updated = [...prev];
      updated[idx] = nextRow;
      return normalizeTypeRows(updated);
    });
  }, [employeeMap, normalizeTypeRows]);

  const removeTypeRow = useCallback((rowId: string) => {
    setTypeRows(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(r => r.id === rowId);
      if (idx < 0) return prev;
      const isLast = idx === prev.length - 1;
      if (isLast && isTypeRowBlank(prev[idx])) return prev;
      const next = prev.filter(r => r.id !== rowId);
      return normalizeTypeRows(next.length ? next : [createEmptyTypeRow()]);
    });
    setTypeRowErrors(prev => {
      if (!prev[rowId]) return prev;
      const copy = { ...prev };
      delete copy[rowId];
      return copy;
    });
  }, [normalizeTypeRows, isTypeRowBlank, createEmptyTypeRow]);

  // (Row total is intentionally not shown in TYPE UI; invoice summary shows totals.)

  // Prefill from Appointment (3-table) when navigated via Produce Bill
  useEffect(() => {
    const tryPrefill = async () => {
      if (!fromAppt || !fromApptId || !user || loading || prefillApplied) return;
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        const appt = await AppointmentTransactionService.getCompleteAppointment(fromApptId, acc, ret);
        if (!appt) return;

        // Resolve staffId by matching employee name to master list
        let resolvedStaffId = '';
        if (appt.employee_id) {
          // Try direct match by employee_id
          const emp = masterEmployees.find(e => String(e.employee_id) === String(appt.employee_id) || String(e.id) === String(appt.employee_id));
          if (emp) resolvedStaffId = String(emp.employee_id);
        }
        if (!resolvedStaffId && appt.employee_name) {
          const empByName = masterEmployees.find(e => (e.employee_name || '').toLowerCase() === (appt.employee_name || '').toLowerCase());
          if (empByName) resolvedStaffId = String(empByName.employee_id);
        }

        // Map services from appointment summary if present
        const svcSrc: any[] = Array.isArray((appt as any).services) && (appt as any).services.length
          ? (appt as any).services
          : (Array.isArray((appt as any).data) ? (appt as any).data : []);

        const services: Service[] = (svcSrc || []).map((s: any, idx: number) => {
          const name = s.service_name || s.name || `Service ${idx + 1}`;
          const unit = Number(s.unit_price ?? s.price ?? 0) || 0;
          const qty = Number(s.qty ?? s.quantity ?? 1) || 1;
          const taxRate = s.tax_rate_percent != null ? Number(s.tax_rate_percent) : undefined;
          const taxId = s.tax_id ? String(s.tax_id) : undefined;
          const service_id = String(s.service_id ?? s.id ?? (s.service_code ?? `SRV-${idx + 1}`));
          return {
            id: `prefill-${Date.now()}-${idx}`,
            name,
            price: unit,
            quantity: qty,
            basePrice: Number(s.base_price ?? unit),
            service_id,
            taxRate,
            taxId,
          } as Service;
        });

        // Capture appointment tax summary (if provided) and default lock ON
        try {
          let cg = Number((appt as any).total_cgst ?? (appt as any).cgst_amount ?? (appt as any).cgst ?? 0) || 0;
          let sg = Number((appt as any).total_sgst ?? (appt as any).sgst_amount ?? (appt as any).sgst ?? 0) || 0;
          const perLineTaxSum = Array.isArray((appt as any).services)
            ? (appt as any).services.reduce((s: number, r: any) => s + Number(r.total_tax || r.tax_amount || 0), 0)
            : 0;
          let tx = Number((appt as any).total_tax ?? (appt as any).tax_amount ?? perLineTaxSum ?? (cg + sg)) || (cg + sg);
          if ((cg <= 0 && sg <= 0) && tx > 0) {
            const half = Number((tx / 2).toFixed(2));
            cg = half; sg = half;
          }
          if (cg > 0 || sg > 0 || tx > 0) {
            setApptTaxSummary({ cgst: Number(cg.toFixed(2)), sgst: Number(sg.toFixed(2)), total: Number(tx.toFixed(2)) });
            setLockToApptTax(true);
          }
        } catch { }

        // Attempt to map payment mode name to ID
        let paymentModeId = '';
        const payName = (appt as any).payment_mode || '';
        if (payName && masterPaymentModes.length) {
          const pm = masterPaymentModes.find(p => (p.payment_mode_name || '').toLowerCase() === String(payName).toLowerCase());
          if (pm) paymentModeId = String(pm.id);
        } else if (masterPaymentModes.length) {
          // default to cash
          const cash = masterPaymentModes.find(p => (p.payment_mode_name || '').toLowerCase().includes('cash')) || masterPaymentModes[0];
          if (cash) paymentModeId = String(cash.id);
        }

        // Derive a sensible tax percent if all lines share one, else keep existing default
        const uniqueLineRates = new Set(
          services.map(s => s.taxRate != null ? s.taxRate : undefined).filter(v => v != null)
        ) as Set<number>;
        const derivedTax = uniqueLineRates.size === 1 ? (Array.from(uniqueLineRates)[0] as number) : newInvoice.tax;

        setNewInvoice(prev => ({
          ...prev,
          customerName: (appt as any).customer_name || '',
          customerPhone: String((appt as any).customer_mobile || (appt as any).customer_phone || ''),
          customerGender: normalizeGender((appt as any).customer_gender || (appt as any).gender || ''),
          // staffId removed - now handled per service
          date: (appt as any).appointment_date || prev.date,
          services: services.length ? services : (prev.services.length ? prev.services : []),
          discount: String(Number((appt as any).total_discount || 0) || ''),
          discountType: 'fixed',
          tax: derivedTax || prev.tax,
          // Note: taxId per line handled by service.taxId; keep header taxId as-is
          notes: String((appt as any).special_requirements || prev.notes || ''),
          paymentMethod: paymentModeId ? (masterPaymentModes.find(p => String(p.id) === paymentModeId)?.payment_mode_name.toLowerCase() || prev.paymentMethod) : prev.paymentMethod,
          paymentModeId: paymentModeId || prev.paymentModeId,
        }));

        // IMPORTANT: The visible Customer inputs are bound to `customers[]`.
        // Keep the primary row in sync so name/phone actually appear in the UI.
        try {
          const cname = (appt as any).customer_name || '';
          const cphone = String((appt as any).customer_mobile || (appt as any).customer_phone || '').replace(/\D+/g, '').slice(0, 10);
          const cgender = normalizeGender((appt as any).customer_gender || (appt as any).gender || '');
          setCustomers(prev => {
            const first = prev[0] || {
              id: '1',
              customer: '',
              customerId: '',
              customerName: '',
              customerPhone: '',
              customerGender: '',
              customerMembershipId: '',
              customerBirthday: '',
              customerAnniversary: '',
              customerMembershipCardNo: '',
              customerAddress: '',
              visitCount: '0',
              creditPending: '0',
            };
            const updatedFirst = {
              ...first,
              customerName: cname || first.customerName || '',
              customerPhone: cphone || first.customerPhone || '',
              customerGender: cgender || first.customerGender || '',
            };
            return [updatedFirst, ...prev.slice(1)];
          });
        } catch { }

        // Also set selectedCustomer minimal info so UI shows avatar
        const cname = (appt as any).customer_name || '';
        const cphone = String((appt as any).customer_mobile || (appt as any).customer_phone || '');
        if (cname || cphone) {
          setSelectedCustomer({
            id: String((appt as any).customer_id || ''),
            name: cname || 'Customer',
            email: '',
            phone: String(cphone || ''),
            totalVisits: 0,
            lastVisit: '',
            visitCount: 0,
            customerCredit: 0
          });
        }

        setPrefillApplied(true);
        // Optional toast
        toast({ title: 'Prefilled from appointment', description: `Loaded ${fromApptId} into invoice draft` });
      } catch (e) {
        console.warn('Failed to prefill from appointment', e);
      }
    };
    tryPrefill();
  }, [fromAppt, fromApptId, user, loading, prefillApplied, masterEmployees, masterPaymentModes, newInvoice.tax, toast]);

  // Load invoice data for edit mode
  useEffect(() => {
    // Wait for both conditions: edit mode setup and master data loaded
    if (!isEditMode || !editId || !user || loading) return;

    const loadInvoiceData = async () => {
      setLoadingEditData(true);
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;


        // Get invoice data from the billing service
        const response = await InvoiceService.get(editId, acc, ret) as any;
        // Debug logs removed

        if (response?.success && Array.isArray(response?.data)) {
          const lineRows = response.data;
          const header = (response as any).header || {};
          const pkgRows: any[] = Array.isArray((response as any)?.packages) ? (response as any).packages : [];
          const invRows: any[] = Array.isArray((response as any)?.inventory) ? (response as any).inventory : [];
          const paymentsArr: any[] = Array.isArray((response as any)?.payments) ? (response as any).payments : [];

          // Some backends return service lines in `data`, but packages/inventory in separate arrays.
          // Treat the invoice as editable if ANY section has data (or header exists).
          const hasHeader = header && Object.keys(header).length > 0;
          const hasAnyLines = (lineRows?.length || 0) > 0 || (pkgRows?.length || 0) > 0 || (invRows?.length || 0) > 0;

          if (!hasHeader && !hasAnyLines) {
            console.warn('Edit mode - No invoice rows found in response');
            toast({
              title: "Warning",
              description: "No invoice data found for editing",
              className: "border-yellow-200 bg-yellow-50 text-yellow-900"
            });
            return;
          }

          if (lineRows[0]) {
            const debugFirst = { ...lineRows[0] };

            if (header && Object.keys(header).length > 0) {
              // Removed header payment field debug log
            }
          }

          // Map service lines -> services
          // NOTE: For multi-staff support, the backend (and our submit payload) may return qty=N
          // as N separate rows (qty=1 each). When editing, regroup them into one service with
          // quantity + staffAssignments.
          const serviceGroups = new Map<string, {
            first: any;
            quantity: number;
            staffAssignments: Array<{ staffId: string | number; staffName?: string }>;
          }>();

          (lineRows || []).forEach((line: any) => {
            const sid = String(line.service_id || '');
            if (!sid) return;
            const qty = Math.max(1, Number(line.qty || 1));
            const existing = serviceGroups.get(sid);
            const group = existing ?? {
              first: line,
              quantity: 0,
              staffAssignments: [],
            };
            group.quantity += qty;
            const staffId = String(line.employee_id || '');
            const staffName = String(line.employee_name || '');
            for (let i = 0; i < qty; i++) {
              // Keep an assignment slot even if staffId missing; UI will force selection
              group.staffAssignments.push({ staffId: staffId || '', staffName: staffName || '' });
            }
            serviceGroups.set(sid, group);
          });

          const services: Service[] = Array.from(serviceGroups.entries()).map(([sid, g], index: number) => {
            const line = g.first || {};
            const assignments = Array.isArray(g.staffAssignments) ? g.staffAssignments : [];
            const firstAssign = assignments[0];
            return {
              id: `service-${index}-${Date.now()}`,
              name: line.service_name || '',
              price: Number(line.unit_price) || 0,
              quantity: Math.max(1, Number(g.quantity || 1)),
              basePrice: Number(line.base_price) || Number(line.unit_price) || 0,
              service_id: sid,
              taxId: line.tax_id || undefined,
              taxRate: line.tax_rate_percent != null ? Number(line.tax_rate_percent) : undefined,
              staffAssignments: assignments,
              staffId: (firstAssign?.staffId ?? String(line.employee_id || '')) as any,
              staffName: (firstAssign?.staffName ?? String(line.employee_name || '')) as any,
              persisted: true,
            } as any;
          });

          // Include package lines from backend into services list (prefixed service_id)
          // If backend returns qty split as multiple rows, regroup them.
          const pkgGroups = new Map<string, {
            first: any;
            quantity: number;
            staffAssignments: Array<{ staffId: string | number; staffName?: string }>;
          }>();

          (pkgRows || []).forEach((p: any) => {
            const pkgId = String(p.package_id || p.id || '');
            if (!pkgId) return;
            const qty = Math.max(1, Number(p.qty || 1));
            const existing = pkgGroups.get(pkgId);
            const group = existing ?? { first: p, quantity: 0, staffAssignments: [] };
            group.quantity += qty;
            const staffId = String(p.employee_id || '');
            const staffName = String(p.employee_name || '');
            for (let i = 0; i < qty; i++) {
              group.staffAssignments.push({ staffId: staffId || '', staffName: staffName || '' });
            }
            pkgGroups.set(pkgId, group);
          });

          const pkgServices: Service[] = Array.from(pkgGroups.entries()).map(([pkgId, g], idx: number) => {
            const p: any = g.first || {};
            const assignments = Array.isArray(g.staffAssignments) ? g.staffAssignments : [];
            const firstAssign = assignments[0];
            return {
              id: `pkg-${idx}-${Date.now()}`,
              name: p.package_name || p.name || 'Package',
              price: Number(p.unit_price) || Number(p.package_price) || 0,
              quantity: Math.max(1, Number(g.quantity || 1)),
              basePrice: Number(p.unit_price) || Number(p.package_price) || 0,
              service_id: `pkg:${pkgId}`,
              taxId: p.tax_id || undefined,
              taxRate: p.tax_rate_percent != null ? Number(p.tax_rate_percent) : undefined,
              staffAssignments: assignments,
              staffId: (firstAssign?.staffId ?? String(p.employee_id || '')) as any,
              staffName: (firstAssign?.staffName ?? String(p.employee_name || '')) as any,
              discount_percentage: 0,
              persisted: true,
            } as any;
          });

          // Include inventory lines from backend into services list (prefixed service_id)
          const invServices: Service[] = invRows.map((it: any, idx: number) => {
            // Match inventory item with masterInventory to get the correct id
            let inventoryId = it.id || idx;
            if (masterInventory.length > 0 && it.product_id) {
              const masterItem = masterInventory.find(mi => String(mi.product_id) === String(it.product_id));
              if (masterItem) {
                inventoryId = masterItem.id;
              }
            }
            return {
              id: `inv-${idx}-${Date.now()}`,
              name: it.product_name || it.item_name || 'Product',
              price: Number(it.unit_price) || 0,
              quantity: Number(it.qty) || 1,
              basePrice: Number(it.unit_price) || 0,
              // Use masterInventory.id for selection highlight matching
              service_id: `inv:${inventoryId}`,
              taxId: it.tax_id || undefined,
              taxRate: it.tax_rate_percent != null ? Number(it.tax_rate_percent) : undefined,
              staffId: String(it.employee_id || ''),
              staffName: String(it.employee_name || ''),
              productBusinessId: String(it.product_id || ''),
              barcode: it.barcode ?? null,
              brand: it.brand ?? null,
              discount_percentage: 0,
              persisted: true,
            };
          });

          // Merge all lines
          const mergedServices: Service[] = [...services, ...pkgServices, ...invServices];

          // In edit mode, avoid auto-applying membership discount unless the invoice itself
          // indicates it had membership discount applied.
          try {
            const invoiceMembershipDiscount = Number((header as any)?.membership_discount ?? (header as any)?.membershipDiscount ?? 0) || 0;
            setApplyMembershipDiscountToggle(invoiceMembershipDiscount > 0);
          } catch (_) {
            // no-op
          }

          // Removed mapped services debug log

          const first = (lineRows[0] ? { ...lineRows[0] } : (hasHeader ? { ...header } : {})) as any;

          // Prefer header values if present
          const customerName = String(first.customer_name || first.customerr_name || header.customer_name || header.customerr_name || '');
          const customerPhone = String(first.customer_number || first.customer_mobile || header.customer_number || header.customer_mobile || '');
          const customerGender = normalizeGender(first.customer_gender || first.gender || header.customer_gender || header.gender || '');
          const employeeId = first.employee_id || header.employee_id || '';

          // Discount in edit mode must represent the invoice-level total discount.
          // Some APIs store discount per-line, so never trust only the first line's discount.
          const headerDiscountRaw =
            (header as any)?.discount_amount ??
            (header as any)?.discountAmount ??
            (header as any)?.discount ??
            null;
          let discountAmt = Number(headerDiscountRaw || 0) || 0;

          if (!(discountAmt > 0)) {
            const allRowsForDiscount: any[] = [
              ...(Array.isArray(lineRows) ? lineRows : []),
              ...(Array.isArray(pkgRows) ? pkgRows : []),
              ...(Array.isArray(invRows) ? invRows : []),
            ];
            const summed = allRowsForDiscount.reduce((sum: number, row: any) => {
              const v = Number(row?.discount_amount ?? row?.discount ?? 0) || 0;
              return sum + v;
            }, 0);
            discountAmt = Number(summed.toFixed(2));
          }
          const taxRate = Number(first.tax_rate_percent || header.tax_rate_percent || 0) || 0;
          let paymentModeId =
            first.payment_mode_id ||
            header.payment_mode_id ||
            paymentsArr?.[0]?.payment_mode_id ||
            first.payment_id ||
            header.payment_id ||
            '';
          // Additional Notes may be stored on billing_transactions header as `Additional_notes`.
          // Keep backward compatibility with older `notes` fields.
          const notes =
            first?.additional_notes ??
            first?.Additional_notes ??
            header?.additional_notes ??
            header?.Additional_notes ??
            first?.notes ??
            header?.notes ??
            '';

          // Try to find payment method name from payment mode ID
          let paymentMethodName = "cash";
          if (paymentModeId && masterPaymentModes.length > 0) {
            const paymentMode = masterPaymentModes.find(pm =>
              String(pm.id) === String(paymentModeId) ||
              String(pm.payment_id) === String(paymentModeId)
            );
            if (paymentMode) {
              paymentMethodName = paymentMode.payment_mode_name.toLowerCase();
            } else {
              console.warn('Payment mode not found for ID:', paymentModeId, 'Available modes:', masterPaymentModes);
              paymentMethodName = "cash"; // fallback
            }
          } else {
            // No payment mode ID found in invoice data; defaulting to cash
            // Try to find cash payment mode as default
            if (masterPaymentModes.length > 0) {
              const cashMode = masterPaymentModes.find(pm =>
                pm.payment_mode_name.toLowerCase().includes('cash')
              );
              if (cashMode) {
                paymentMethodName = cashMode.payment_mode_name.toLowerCase();
                paymentModeId = String(cashMode.id);
                // default cash payment mode selected
              } else {
                // Use first available payment mode as fallback
                paymentMethodName = masterPaymentModes[0].payment_mode_name.toLowerCase();
                paymentModeId = String(masterPaymentModes[0].id);
                // first available payment mode selected as fallback
              }
            } else {
              paymentMethodName = "cash"; // fallback when no payment modes are loaded
            }
          }

          // Also check if payment method name is directly available in the data
          const directPaymentMethod =
            first.payment_method ||
            header.payment_method ||
            paymentsArr?.[0]?.payment_method ||
            paymentsArr?.[0]?.payment_mode_name ||
            first.payment_mode_name ||
            header.payment_mode_name;
          if (directPaymentMethod && !paymentMethodName) {
            paymentMethodName = String(directPaymentMethod).toLowerCase();
          }

          // Removed extracted data debug log

          // Update the form state
          const newInvoiceData = {
            customer: first.customer_id || header.customer_id || "",
            customerName: customerName,
            customerPhone: customerPhone,
            customerGender: customerGender,
            date: first.created_at ? formatYMDIST(new Date(first.created_at)) : formatYMDIST(nowIST()),
            services: services.length ? services : [],
            discount: String(discountAmt || ''),
            discountType: 'fixed' as "percentage" | "fixed",
            tax: taxRate || 18,
            taxId: first.tax_id || '',
            notes: String(notes || ''),
            paymentMethod: paymentMethodName,
            paymentModeId: paymentModeId,
            // Additional customer details (preserve existing or use empty defaults)
            customerMembershipId: "",
            customerBirthday: "",
            customerAnniversary: "",
            customerMembershipCardNo: "",
            customerAddress: "",
          };

          // Removed invoice data set debug log

          setNewInvoice({ ...newInvoiceData, services: mergedServices.length ? mergedServices : newInvoiceData.services });
          // Hydrate multi-customer rows with the loaded primary customer
          setCustomers([{
            id: '1',
            customer: String(first.customer_id || header.customer_id || ''),
            customerId: String(first.customer_id || header.customer_id || ''),
            customerName: customerName || '',
            customerPhone: customerPhone || '',
            customerGender: customerGender || '',
            customerMembershipId: '',
            customerBirthday: '',
            customerAnniversary: '',
            customerMembershipCardNo: '',
            customerAddress: '',
            visitCount: '0',
            creditPending: '0',
          }]);
          // Auto-open Packages/Products sections in edit mode if any such lines exist
          try {
            const hasPkg = mergedServices.some(s => String(s.service_id || '').startsWith('pkg:'));
            const hasInv = mergedServices.some(s => String(s.service_id || '').startsWith('inv:'));
            if (hasPkg) setPackagesOpen(true);
            if (hasInv) setProductsOpen(true);
          } catch (_) {
            // non-fatal UI hint
          }

          // Hydrate Payment Methods and Credit from backend for edit mode
          try {
            // Use new payments array; keep compatibility if API still returns single payment
            const paymentsArr: any[] = Array.isArray((response as any)?.payments)
              ? (response as any)?.payments
              : [];
            const payData: any = (response as any)?.payment || {};
            const hdr: any = (response as any)?.header || {};
            const walletArr: any[] = Array.isArray((response as any)?.wallet)
              ? (response as any)?.wallet
              : [];

            // Determine credit used from wallet entries (CREDIT + SUCCESS)
            const walletCreditUsed = walletArr
              .filter((e: any) => String(e?.txn_type || '').toUpperCase() === 'CREDIT' && String(e?.status || '').toUpperCase().startsWith('SUC'))
              .reduce((sum: number, e: any) => sum + (Number(e?.amount) || 0), 0);
            const headerGrandTotal = Number(hdr?.grand_total ?? hdr?.total_amount ?? hdr?.invoice_total ?? hdr?.total ?? 0) || 0;

            // Prefer invoice-level credit from API when available (computed per-invoice on backend)
            const invoiceCreditFromApiRaw = (response as any)?.credit_amount ?? (response as any)?.creditAmount ?? (hdr as any)?.credit_amount ?? (hdr as any)?.credit;
            const invoiceCreditFromApi = Number(invoiceCreditFromApiRaw ?? NaN);

            const paymentAmountFromApiSingle = Number(
              payData?.amount ?? payData?.paid_amount ?? payData?.total_amount ?? 0
            ) || 0;
            const paymentAmountFromApiAll = paymentsArr.reduce((sum, p: any) => (
              sum + (Number(p?.amount ?? p?.paid_amount ?? p?.total_amount ?? 0) || 0)
            ), 0);
            const paymentAmountFromApi = paymentsArr.length > 0 ? paymentAmountFromApiAll : paymentAmountFromApiSingle;

            // Credit textbox should show credit value for THIS invoice.
            // Use API's explicit per-invoice credit when present; otherwise fall back to derived outstanding.
            const derivedOutstanding = Math.max(headerGrandTotal - walletCreditUsed - paymentAmountFromApi, 0);
            const capBase = headerGrandTotal || roundedTotal || Number.MAX_SAFE_INTEGER;
            const creditToShow = Number.isFinite(invoiceCreditFromApi)
              ? Math.max(0, Math.min(invoiceCreditFromApi, capBase))
              : Math.max(0, Math.min(derivedOutstanding, capBase));

            setCreditAmount(creditToShow);
            // Also reflect in customer chip immediately as pending/credit outstanding
            setSelectedCustomer(prev => prev ? { ...prev, customerCredit: creditToShow } : prev);

            // Only hydrate payment chips if none selected yet
            if ((selectedPaymentModes?.length || 0) === 0) {
              const toUse = paymentsArr.length > 0 ? paymentsArr : (payData && Object.keys(payData).length > 0 ? [payData] : []);
              if (toUse.length > 0) {
                const mapped = toUse.map((p: any) => {
                  let modeId = p?.payment_mode_id ?? p?.payment_id ?? p?.paymode_id ?? p?.mode_id ?? '';
                  let modeName: string = String(
                    p?.payment_method ?? p?.payment_mode ?? p?.payment_mode_name ?? p?.paymode_name ?? ''
                  );
                  const amount = Number(p?.amount ?? p?.paid_amount ?? p?.total_amount ?? 0) || 0;
                  // Resolve via master list when available
                  if (masterPaymentModes.length > 0) {
                    let resolved = null as null | typeof masterPaymentModes[number];
                    if (modeId) {
                      resolved = masterPaymentModes.find(pm => String(pm.id) === String(modeId) || String(pm.payment_id) === String(modeId)) || null;
                    }
                    if (!resolved && modeName) {
                      const nm = modeName.toLowerCase();
                      resolved = masterPaymentModes.find(pm => (pm.payment_mode_name || '').toLowerCase() === nm) || null;
                    }
                    if (resolved) {
                      modeId = String(resolved.id);
                      modeName = resolved.payment_mode_name;
                    }
                  }
                  return {
                    id: String(modeId || modeName || 'cash'),
                    name: modeName || 'cash',
                    amount,
                  } as SelectedPaymentMode;
                });
                setSelectedPaymentModes(mapped);
              } else {
                // Fallback: derive single payment for full payable
                const payable = Math.max(headerGrandTotal - walletCreditUsed, 0);
                if (payable > 0 && masterPaymentModes.length > 0) {
                  const cashMode = masterPaymentModes.find(pm => pm.payment_mode_name.toLowerCase().includes('cash')) || masterPaymentModes[0];
                  setSelectedPaymentModes([{ id: String(cashMode.id), name: cashMode.payment_mode_name, amount: payable }]);
                }
              }
            }
          } catch (e) {
            console.warn('Failed to hydrate payment methods from invoice response', e);
          }

          // Set global staff selection from header or first line
          try {
            const hdr: any = (response as any)?.header || {};
            let headerStaffId = String(hdr?.employee_id || hdr?.txn_employee_id || '') || '';
            let headerStaffName = String(hdr?.employee_name || hdr?.txn_employee_name || '') || '';

            // Resolve staffId via masterEmployees when only name present
            if ((!headerStaffId || headerStaffId === '0') && headerStaffName && masterEmployees.length > 0) {
              const empByName = masterEmployees.find(e => (e.employee_name || '').toLowerCase() === headerStaffName.toLowerCase());
              if (empByName) {
                headerStaffId = String(empByName.employee_id);
              }
            }

            if (headerStaffId) {
              setGlobalStaffId(headerStaffId);
            }
          } catch (e) {
            console.warn('Failed to set global staff from header', e);
          }

          // Add default service if no services loaded
          if (!services.length) {
            // Removed no services debug log
            setTimeout(() => addService(), 100);
          }

          // Set customer data if available
          if (first.customer_id || header.customer_id) {
            const customerData = {
              id: String(first.customer_id || header.customer_id),
              name: customerName || 'Customer',
              email: first.customer_email || header.customer_email || '',
              phone: customerPhone,
              totalVisits: 0,
              lastVisit: ''
            };
            // Removed customer data debug log
            setSelectedCustomer(customerData);
            // Also reflect into primary customers row immediately
            setCustomers(prev => {
              const firstRow = prev[0] || {
                id: '1', customer: '', customerId: '', customerName: '', customerPhone: '', customerGender: '',
                customerMembershipId: '', customerBirthday: '', customerAnniversary: '', customerMembershipCardNo: '', customerAddress: '', visitCount: '0', creditPending: '0'
              };
              firstRow.customer = String(customerData.id);
              firstRow.customerId = String(customerData.id);
              firstRow.customerName = customerData.name || '';
              firstRow.customerPhone = customerData.phone || '';
              firstRow.customerGender = String(newInvoice.customerGender || customerGender || '');
              return [firstRow];
            });

            // Try to load visit count and pending credit from customer-search (preferred)
            // Fallback to visit-history and wallet-ledger APIs if not present
            let loadedFromSearch = false;

            // Backfill gender from master_customer if header/lines lacked it
            try {
              if (!newInvoice.customerGender || newInvoice.customerGender === '') {
                const searchResp: any = await ApiService.get(`/customer-search?q=${encodeURIComponent(customerPhone || customerName)}&account_code=${encodeURIComponent(acc)}&retail_code=${encodeURIComponent(ret)}&include_membership=true`);
                const arr = Array.isArray(searchResp?.data) ? searchResp.data : [];
                const match = arr.find((c: any) => String(c.customer_id || c.id) === String(customerData.id)) || arr[0];
                if (match) {
                  const g = normalizeGender(match.gender || match.customer_gender || '');
                  if (g) {
                    setNewInvoice(prev => ({ ...prev, customerGender: g }));
                  }
                }
              }
            } catch (e) {
              console.warn('Gender backfill failed', e);
            }

            // Load customer suggestions for the existing customer name to enable membership functionality
            if (customerName && customerName.trim()) {
              try {
                const customerSearchResponse = await ApiService.get(`/customer-search?q=${encodeURIComponent(customerName.trim())}&account_code=${encodeURIComponent(acc)}&retail_code=${encodeURIComponent(ret)}&include_membership=true`) as any;
                const customerSearchData = customerSearchResponse?.data || [];

                // Debug: Check edit mode customer search response
                console.log('Edit mode customer search response:', customerSearchData.map((c: any) => ({
                  name: c.customer_name || c.name,
                  phone: c.phone || c.mobile,
                  membership_id: c.membership_id,
                  customer_id: c.customer_id
                })));

                if (Array.isArray(customerSearchData) && customerSearchData.length > 0) {
                  setCustomerSuggestions(dedupeCustomerSuggestions(customerSearchData));

                  // Find matching customer and apply membership if available
                  const matchingCustomer = customerSearchData.find((cust: any) =>
                    (cust.customer_name?.toLowerCase() === customerName.toLowerCase()) ||
                    (cust.name?.toLowerCase() === customerName.toLowerCase()) ||
                    (cust.full_name?.toLowerCase() === customerName.toLowerCase())
                  );

                  // Update visit count and credit directly from search result if available
                  const vc = Number(matchingCustomer?.customer_visitcnt ?? matchingCustomer?.total_visits ?? 0) || 0;
                  const cred = Number(matchingCustomer?.customer_credit ?? 0) || 0;
                  if (vc > 0 || cred > 0) {
                    loadedFromSearch = true;
                    setSelectedCustomer(prev => prev ? { ...prev, totalVisits: vc, visitCount: vc, customerCredit: cred } : prev);
                    // Update customers row with visit count and credit
                    setCustomers(prev => prev.map((c, i) => i === 0 ? { ...c, visitCount: String(vc), creditPending: String(cred) } : c));
                  }

                  if (matchingCustomer?.membership_id) {
                    applyMembershipDiscount(matchingCustomer.membership_id);
                  }
                }
              } catch (error) {
                console.warn("Failed to load customer suggestions in edit mode:", error);
              }
            }
            // Fallback API calls if search didn't provide values
            if (!loadedFromSearch) {
              try {
                const visitRes: any = await ApiService.get(`/customer-visit-history/${encodeURIComponent(String(customerData.id))}?account_code=${encodeURIComponent(acc)}&retail_code=${encodeURIComponent(ret)}`);
                const totalVisits = Number(visitRes?.data?.summary?.total_visits || 0);
                const walletRes: any = await ApiService.get(`/customer-wallet-ledger?customer_id=${encodeURIComponent(String(customerData.id))}&account_code=${encodeURIComponent(acc)}&retail_code=${encodeURIComponent(ret)}&limit=50`);
                const pendingCredit = Number(walletRes?.data?.total_balance || 0);
                setSelectedCustomer(prev => prev ? { ...prev, totalVisits, visitCount: totalVisits, customerCredit: pendingCredit } : prev);
                // Update customers row with visit count and credit from fallbacks
                setCustomers(prev => prev.map((c, i) => i === 0 ? { ...c, visitCount: String(totalVisits), creditPending: String(pendingCredit) } : c));
              } catch (e) {
                console.warn('Failed to load visit count or wallet balance for customer', e);
              }
            }

            // Apply membership if available from invoice data (fallback)
            const membershipId = first.membership_id || header.membership_id || (first.customer as any)?.membership_id || (header.customer as any)?.membership_id;
            if (membershipId) {
              applyMembershipDiscount(membershipId);
            }
          }

          // Record header billstatus so UI can react (hide actions for cancelled bills)
          setInvoiceBillStatus(String(header.billstatus || header.bill_status || header.BILL_STATUS || '').trim() || null);
        } else {
          console.warn('Edit mode - Unexpected invoice GET response structure:', response);
          toast({
            title: "Error",
            description: "Invalid response format when loading invoice data",
            className: "border-yellow-200 bg-yellow-50 text-yellow-900"
          });
        }
      } catch (error) {
        console.error('Error loading invoice data:', error);
        toast({
          title: "Error",
          description: "Failed to load invoice data for editing",
          className: "border-yellow-200 bg-yellow-50 text-yellow-900"
        });
      } finally {
        setLoadingEditData(false);
      }
    };

    loadInvoiceData();
  }, [isEditMode, editId, user, toast, loading, masterTaxes.length, masterEmployees.length, masterServices.length, masterPackages.length, masterPaymentModes.length]);

  // Update payment method name when master payment modes are loaded and we have a payment mode ID
  useEffect(() => {
    if (newInvoice.paymentModeId && masterPaymentModes.length > 0) {
      const paymentMode = masterPaymentModes.find(pm =>
        String(pm.id) === String(newInvoice.paymentModeId) ||
        String(pm.payment_id) === String(newInvoice.paymentModeId)
      );
      if (paymentMode) {
        const paymentMethodName = paymentMode.payment_mode_name.toLowerCase();
        // Removed payment method update debug log

        // Only update if the payment method is different
        if (newInvoice.paymentMethod !== paymentMethodName) {
          setNewInvoice(prev => ({
            ...prev,
            paymentMethod: paymentMethodName
          }));
        }
      }
    }
  }, [masterPaymentModes, newInvoice.paymentModeId, newInvoice.paymentMethod]);

  // Sync customers row gender from main invoice in edit mode once it is backfilled
  useEffect(() => {
    if (!isEditMode) return;
    const g = String(newInvoice.customerGender || '').trim();
    if (!g) return;
    setCustomers(prev => {
      if (!prev.length) return prev;
      const first = prev[0];
      if (String(first.customerGender || '').trim() === g) return prev;
      const updated = { ...first, customerGender: g };
      return [updated, ...prev.slice(1)];
    });
  }, [isEditMode, newInvoice.customerGender]);

  // Service pricing is now handled per-service when staff is assigned

  // Detect sidebar state from main content padding
  useEffect(() => {
    const checkSidebarState = () => {
      // Find the main content container that has padding-left responsive classes
      const mainContent = document.querySelector('[class*="lg:pl-"]');
      if (mainContent) {
        const hasMinimizedPadding = mainContent.classList.contains("lg:pl-16");
        setSidebarMinimized(hasMinimizedPadding);
      }
    };

    // Initial check
    checkSidebarState();

    // Use MutationObserver to watch for class changes on the main content
    const observer = new MutationObserver(() => {
      checkSidebarState();
    });

    // Watch for class changes on body and main content area
    const targetNode = document.body;
    observer.observe(targetNode, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F10") {
        e.preventDefault();
        handleSubmit(e as any);
      }
      // Add Ctrl+H shortcut for hold invoice
      if (e.ctrlKey && e.key.toLowerCase() === "h" && !isEditMode) {
        e.preventDefault();
        handleHoldInvoice(e as any);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [newInvoice.customerName, newInvoice.customerPhone, newInvoice.paymentModeId, newInvoice.services.length, isEditMode]);

  // Handle scroll and resize to update dropdown position (robust single-cleanup)
  useEffect(() => {
    let ticking = false;
    let scrollTimeout: number | undefined;
    const scrollableParents: Element[] = [];

    const updateDropdownPosition = () => {
      if (!showSuggestions) { ticking = false; return; }
      const input = serviceInputRefs.current[showSuggestions];
      if (!input) { ticking = false; return; }

      const rect = input.getBoundingClientRect();
      // If input is out of viewport, hide dropdown
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        setShowSuggestions(null);
        setSelectedSuggestionIndex(-1);
        ticking = false;
        return;
      }

      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dropdownHeight = 200;
      const dropdownWidth = Math.max(rect.width, 250);

      let top = rect.bottom + 4;
      if (rect.bottom + dropdownHeight > viewportHeight && rect.top > dropdownHeight) {
        top = rect.top - dropdownHeight - 4;
      }

      let left = rect.left;
      if (left + dropdownWidth > viewportWidth) {
        left = viewportWidth - dropdownWidth - 8;
      }
      if (left < 8) left = 8;

      setDropdownPosition({ top, left, width: rect.width });
      ticking = false;
    };

    const requestTick = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (!ticking) { requestAnimationFrame(updateDropdownPosition); ticking = true; }
      scrollTimeout = window.setTimeout(() => {
        if (!ticking) { requestAnimationFrame(updateDropdownPosition); ticking = true; }
      }, 50);
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (!showSuggestions) return;
      const target = e.target as Element;
      const input = serviceInputRefs.current[showSuggestions];
      if (input && !input.contains(target) && !target.closest('[data-suggestions-dropdown]')) {
        setShowSuggestions(null);
      }
    };

    // Attach listeners when suggestions are shown
    if (showSuggestions) {
      window.addEventListener('scroll', requestTick, { passive: true, capture: true });
      document.addEventListener('scroll', requestTick, { passive: true, capture: true });
      window.addEventListener('resize', requestTick, { passive: true });
      document.addEventListener('mousedown', handleClickOutside);

      // Collect scrollable parents
      const input = serviceInputRefs.current[showSuggestions];
      let parent = input?.parentElement || null;
      const isScrollable = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (isScrollable(style.overflow) || isScrollable(style.overflowY) || isScrollable(style.overflowX)) {
          scrollableParents.push(parent);
          parent.addEventListener('scroll', requestTick, { passive: true });
        }
        parent = parent.parentElement;
      }

      // Initial position
      requestAnimationFrame(updateDropdownPosition);
    }

    // Single cleanup for all listeners/timeouts
    return () => {
      window.removeEventListener('scroll', requestTick, true);
      document.removeEventListener('scroll', requestTick, true);
      window.removeEventListener('resize', requestTick);
      document.removeEventListener('mousedown', handleClickOutside);

      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollableParents.forEach(el => el.removeEventListener('scroll', requestTick));
    };
  }, [showSuggestions]);

  // Handle customer suggestions click outside
  useEffect(() => {
    const handleCustomerClickOutside = (e: MouseEvent) => {
      // Customer suggestions removed - using simple input fields now
    };

    return () => {
      // Cleanup no longer needed
    };
  }, []);

  const serviceInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>(
    {},
  );
  const priceInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
  const quantityInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>(
    {},
  );

  const addService = () => {
    // Auto-assign global staff if one is selected
    const staff = globalStaffId ? masterEmployees.find(emp => emp.employee_id === globalStaffId) : null;
    const staffName = staff ? staff.employee_name : "";

    const newService: Service = {
      id: Math.random().toString(36).substr(2, 9),
      name: "",
      price: 0,
      quantity: 1,
      discount_percentage: 0,
      staffId: globalStaffId, // Auto-assign global staff
      staffName: staffName,
    };
    setNewInvoice((prev) => ({
      ...prev,
      services: [...prev.services, newService],
    }));

    // Focus on the new service input after a brief delay
    setTimeout(() => {
      const input = serviceInputRefs.current[newService.id];
      if (input) {
        input.focus();
      }
    }, 100);
  };

  // Functions to manage multiple customers
  const addCustomer = () => {
    // Do not allow adding a new row if any existing row is incomplete
    const hasEmptyRow = customers.some(c => {
      const nameEmpty = !String(c.customerName || '').trim();
      const phoneEmpty = !String(c.customerPhone || '').trim();
      const genderEmpty = !String(c.customerGender || '').trim();
      return nameEmpty || phoneEmpty || genderEmpty;
    });

    if (hasEmptyRow) {
      toast({
        title: "Complete Current Rows",
        description: "Please fill customer name, phone, and gender for all rows before adding a new one.",
        variant: "default",
      });
      return;
    }

    const newId = (customers.length + 1).toString();
    setCustomers(prev => [...prev, {
      id: newId,
      customer: "",
      customerId: "",
      customerName: "",
      customerPhone: "",
      customerGender: "",
      customerMembershipId: "",
      customerBirthday: "",
      customerAnniversary: "",
      customerMembershipCardNo: "",
      customerAddress: "",
      visitCount: "0",
      creditPending: "0",
    }]);
  };

  const removeCustomer = (customerId: string) => {
    if (customers.length > 1) {
      setCustomers(prev => prev.filter(c => c.id !== customerId));
    }
  };

  const updateCustomer = (customerId: string, field: string, value: string) => {
    setCustomers(prev => prev.map(customer =>
      customer.id === customerId
        ? { ...customer, [field]: value }
        : customer
    ));

    // Update the first customer in newInvoice for backward compatibility
    if (customerId === '1') {
      setNewInvoice(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  // Helper function to recalculate payment modes proportionally
  const recalculatePaymentModes = (oldTotal: number, newTotal: number) => {
    if (selectedPaymentModes.length === 0 || oldTotal === 0 || newTotal === 0) {
      return;
    }

    const ratio = newTotal / oldTotal;

    setSelectedPaymentModes(prev => {
      let totalAdjusted = 0;

      const adjusted = prev.map((mode, index) => {
        let newAmount;
        if (index === prev.length - 1) {
          // For the last payment mode, adjust to make the total exact
          newAmount = newTotal - totalAdjusted;
        } else {
          newAmount = Number((mode.amount * ratio).toFixed(2));
          totalAdjusted += newAmount;
        }

        return {
          ...mode,
          amount: Math.max(0, newAmount) // Ensure no negative amounts
        };
      });

      return adjusted;
    });
  };

  const removeService = (id: string) => {
    // Calculate current total before removal
    const currentTotal = newInvoice.services.reduce((sum, service) => {
      const subtotal = Number(service.price || 0) * Number(service.quantity || 1);
      const discountAmount = subtotal * (Number(service.discount_percentage || 0) / 100);
      const afterDiscount = subtotal - discountAmount;
      const taxAmount = afterDiscount * (Number(service.taxRate || 0) / 100);
      return sum + afterDiscount + taxAmount;
    }, 0);

    // Calculate total after removal
    const serviceToRemove = newInvoice.services.find(service => service.id === id);
    let totalAfterRemoval = currentTotal;

    if (serviceToRemove) {
      const subtotal = Number(serviceToRemove.price || 0) * Number(serviceToRemove.quantity || 1);
      const discountAmount = subtotal * (Number(serviceToRemove.discount_percentage || 0) / 100);
      const afterDiscount = subtotal - discountAmount;
      const taxAmount = afterDiscount * (Number(serviceToRemove.taxRate || 0) / 100);
      totalAfterRemoval = currentTotal - (afterDiscount + taxAmount);
    }

    // Update services
    setNewInvoice((prev) => ({
      ...prev,
      services: prev.services.filter((service) => service.id !== id),
    }));

    // Recalculate payment modes if there's a total change
    if (currentTotal !== totalAfterRemoval) {
      const roundedCurrentTotal = Math.round(currentTotal);
      const roundedNewTotal = Math.round(totalAfterRemoval);
      recalculatePaymentModes(roundedCurrentTotal, roundedNewTotal);
    }

    // Clean up refs
    delete serviceInputRefs.current[id];
    delete priceInputRefs.current[id];
    delete quantityInputRefs.current[id];
  };

  const updateService = (id: string, field: keyof Service, value: any) => {
    setNewInvoice((prev) => ({
      ...prev,
      services: prev.services.map((service) => {
        if (service.id !== id) return service;

        // Multi-staff assignment: keep staffAssignments array in sync with quantity for SERVICES only
        if (field === 'quantity') {
          const nextQty = Math.max(0, Number(value || 0));
          const sid = String(service.service_id || '');
          const isInventory = sid.startsWith('inv:');
          // Multi staff applies to SERVICES + PACKAGES; inventory stays single
          if (isInventory) {
            return { ...service, quantity: nextQty };
          }

          const existing = Array.isArray(service.staffAssignments) ? [...service.staffAssignments] : [];
          const fallbackStaffId = (service.staffId ?? globalStaffId ?? '') as any;
          const fallbackStaffName = (service.staffName ?? (fallbackStaffId ? employeeMap[String(fallbackStaffId)]?.employee_name : '') ?? '') as any;

          // Seed from legacy single staff assignment if no array exists
          if (existing.length === 0 && fallbackStaffId) {
            existing.push({ staffId: fallbackStaffId, staffName: fallbackStaffName });
          }

          if (existing.length > nextQty) {
            existing.length = nextQty;
          } else {
            while (existing.length < nextQty) {
              existing.push({ staffId: fallbackStaffId || '', staffName: fallbackStaffName || '' });
            }
          }

          // Keep legacy fields aligned with first assignment for backward compatibility
          const first = existing[0];
          return {
            ...service,
            quantity: nextQty,
            staffId: first?.staffId ?? service.staffId,
            staffName: (first?.staffName as any) ?? service.staffName,
            staffAssignments: existing,
          };
        }

        return { ...service, [field]: value } as any;
      }),
    }));
  };

  // Helper function to update service staff
  // Direct staff assignment using useCallback for stability
  const updateServiceStaff = useCallback((serviceId: string, staffId: string, assignmentIndex: number = 0) => {
    console.log('🔍 DIRECT STAFF ASSIGNMENT START:', { serviceId, staffId, assignmentIndex });

    const staff = masterEmployees.find(emp => String(emp.employee_id) === String(staffId));
    const staffName = staff ? staff.employee_name : "";
    const emp = employeeMap[String(staffId)];

    console.log('🔍 STAFF LOOKUP RESULT:', {
      staff: staff?.employee_name,
      emp: emp?.employee_name,
      markup: emp?.price_markup_percent
    });

    setNewInvoice(prevInvoice => {
      const currentServices = [...prevInvoice.services];

      // Find and update the specific service
      const serviceIndex = currentServices.findIndex(s => s.id === serviceId);
      if (serviceIndex === -1) {
        console.error('Service not found:', serviceId);
        return prevInvoice;
      }

      const currentService = currentServices[serviceIndex];
      const sidStr = String(currentService.service_id || '');
      const isServiceOnly = !(sidStr.startsWith('pkg:') || sidStr.startsWith('inv:'));
      const isPackage = sidStr.startsWith('pkg:');
      const isInventory = sidStr.startsWith('inv:');
      const isMultiAssignable = isServiceOnly || isPackage;
      console.log('🔍 CURRENT SERVICE BEFORE UPDATE:', {
        id: currentService.id,
        name: currentService.name,
        staffId: currentService.staffId,
        staffName: currentService.staffName,
        price: currentService.price,
        basePrice: currentService.basePrice
      });

      // Resolve base price (prefer existing basePrice; fallback to master catalog), then apply employee markup once
      let effectiveBase = currentService.basePrice;
      if (effectiveBase == null) {
        const ms = masterServices.find(ms => (ms.service_id || String(ms.id)) === currentService.service_id) ||
          masterServices.find(ms => ms.service_name === currentService.name);
        effectiveBase = ms ? Number(ms.price || 0) : Number(currentService.price || 0);
        currentService.basePrice = effectiveBase;
      }
      let newPrice = Number(effectiveBase || 0);
      if (emp && !isPackage && !isInventory) {
        const markupPercent = Number(emp.price_markup_percent) || 0;
        const adjustedPrice = Number(effectiveBase || 0) + (Number(effectiveBase || 0) * markupPercent / 100);
        newPrice = Number(adjustedPrice.toFixed(2));
        console.log('🔍 PRICE CALCULATION:', { basePrice: effectiveBase, markupPercent, adjustedPrice, newPrice });
      }

      // For SERVICES + PACKAGES: track staff per quantity. Only assignmentIndex=0 drives legacy staff fields.
      let updatedService: any;
      if (isMultiAssignable && !isInventory) {
        const qty = Math.max(1, Number(currentService.quantity || 1));
        const assignments = Array.isArray(currentService.staffAssignments) ? [...currentService.staffAssignments] : [];

        // Seed from legacy field if needed
        if (assignments.length === 0 && currentService.staffId) {
          assignments.push({ staffId: currentService.staffId, staffName: currentService.staffName || '' });
        }
        // Ensure length
        while (assignments.length < qty) {
          assignments.push({ staffId: (assignments[0]?.staffId ?? '') as any, staffName: (assignments[0]?.staffName ?? '') as any });
        }
        if (assignments.length > qty) assignments.length = qty;

        // Update specific slot
        assignments[assignmentIndex] = { staffId: staffId, staffName: staffName };

        // Keep legacy fields aligned to the first assignment for compatibility
        const first = assignments[0];
        updatedService = {
          ...currentService,
          staffAssignments: assignments,
          staffId: first?.staffId ?? staffId,
          staffName: first?.staffName ?? staffName,
          // Only recalc price when the *first* staff assignment changes
          ...(assignmentIndex === 0 ? { price: newPrice } : {}),
        };
      } else {
        // Packages / Inventory: keep single-staff behavior
        updatedService = {
          ...currentService,
          staffId: staffId,
          staffName: staffName,
          price: newPrice,
        };
      }

      console.log('🔍 UPDATED SERVICE:', {
        id: updatedService.id,
        name: updatedService.name,
        staffId: updatedService.staffId,
        staffName: updatedService.staffName,
        price: updatedService.price
      });

      // Replace the service in the array
      currentServices[serviceIndex] = updatedService;

      const newInvoiceState = {
        ...prevInvoice,
        services: currentServices
      };

      console.log('🔍 FINAL SERVICES STATE:', newInvoiceState.services.map(s => ({
        id: s.id,
        name: s.name,
        staffId: s.staffId,
        staffName: s.staffName,
        price: s.price
      })));

      return newInvoiceState;
    });
  }, [masterEmployees, employeeMap]);

  // Update service HSN selection and auto-apply related tax
  const updateServiceHSN = useCallback((serviceId: string, hsnIdOrCode: string) => {
    const hsn = masterHSNs.find(h => String(h.hsn_id || h.id || h.hsn_code) === String(hsnIdOrCode) || String(h.hsn_code) === String(hsnIdOrCode));
    let nextTaxId: string | undefined = undefined;
    let nextTaxRate: number | undefined = undefined;
    if (hsn && hsn.tax_id != null) {
      const tx = masterTaxes.find(t => String(t.tax_id) === String(hsn.tax_id) || String(t.id) === String(hsn.tax_id));
      if (tx) {
        nextTaxId = String(tx.id);
        nextTaxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
      }
    }
    setNewInvoice(prev => ({
      ...prev,
      services: prev.services.map(s => s.id === serviceId ? {
        ...s, // attach selected HSN into description for now
        description: s.description,
        taxId: nextTaxId ?? s.taxId,
        taxRate: nextTaxRate ?? s.taxRate,
      } : s)
    }));
  }, [masterHSNs, masterTaxes]);

  // Function to assign global staff to all selected services
  const assignGlobalStaffToAllServices = useCallback((staffId: string) => {
    if (!staffId) return;

    const staff = masterEmployees.find(emp => emp.employee_id === staffId);
    const staffName = staff ? staff.employee_name : "";
    const emp = employeeMap[staffId];

    console.log('🔍 GLOBAL STAFF ASSIGNMENT:', {
      staffId,
      staffName,
      markup: emp?.price_markup_percent
    });

    setNewInvoice(prevInvoice => {
      const updatedServices = prevInvoice.services.map(service => {
        // Require a valid row (has a name); price may be 0 initially
        if (!service.name) return service;

        // Use basePrice when available, otherwise fall back to current price
        const base = (service.basePrice != null) ? Number(service.basePrice) : Number(service.price || 0);
        let newPrice = base;
        // Do NOT apply employee markup to packages or inventory products
        const isPackage = String(service.service_id || '').startsWith('pkg:');
        const isInventory = String(service.service_id || '').startsWith('inv:');
        if (emp && !isPackage && !isInventory) {
          const fixedExtra = Number((emp as any).price_markup_amount) || 0;
          const markupPercent = Number(emp.price_markup_percent) || 0;
          const adjustedPrice = fixedExtra > 0 ? (base + fixedExtra) : (base + (base * markupPercent / 100));
          newPrice = Number(adjustedPrice.toFixed(2));
        }

        const isMultiAssignable = !isInventory; // services + packages
        if (isMultiAssignable) {
          const qty = Math.max(1, Number(service.quantity || 1));
          const assignments = Array.from({ length: qty }).map(() => ({ staffId: staffId, staffName: staffName }));
          return {
            ...service,
            staffAssignments: assignments,
            staffId: staffId,
            staffName: staffName,
            price: newPrice,
          };
        }

        return {
          ...service,
          staffId: staffId,
          staffName: staffName,
          price: newPrice
        };
      });

      return {
        ...prevInvoice,
        services: updatedServices
      };
    });
  }, [masterEmployees, employeeMap]);

  // Allow manual price override per item, and stop markup auto-recalculation for that item
  const openPriceEditor = useCallback((id: string, currentPrice: number) => {
    setPriceEditId(id);
    setPriceEditValue(String(currentPrice ?? 0));
    setPriceEditOpen(true);
  }, []);

  const confirmPriceEditor = useCallback(() => {
    if (!priceEditId) { setPriceEditOpen(false); return; }
    const val = Number(priceEditValue);
    if (Number.isNaN(val) || val < 0) {
      toast({ title: "Invalid price", description: "Please enter a valid number greater than or equal to 0." });
      return;
    }
    const rounded = Number(val.toFixed(2));
    setNewInvoice(prev => ({
      ...prev,
      services: prev.services.map(s => s.id === priceEditId ? { ...s, price: rounded, basePrice: undefined } : s)
    }));
    setPriceEditOpen(false);
    setPriceEditId(null);
  }, [priceEditId, priceEditValue, toast]);

  const handleProductSelect = (masterService: MasterService) => {
    // Check if this service is already selected
    const existingServiceIndex = newInvoice.services.findIndex(
      s => s.service_id === masterService.service_id
    );

    if (existingServiceIndex >= 0) {
      // If service already exists, increase quantity
      const existingService = newInvoice.services[existingServiceIndex];
      updateService(existingService.id, "quantity", existingService.quantity + 1);
    } else {
      // If service doesn't exist, add it as new
      // Use global staff markup immediately if a staff is selected (services only)
      const basePrice = Number(masterService.price) || 0;
      let adjustedPrice = basePrice;
      if (globalStaffId && employeeMap[globalStaffId]) {
        const emp = employeeMap[globalStaffId];
        const fixedExtra = Number((emp as any).price_markup_amount) || 0;
        const markupPercent = Number(emp.price_markup_percent) || 0;
        // Do not apply markup to inventory (handled in handleInventorySelect) or packages
        const isPackage = String(masterService.service_id || '').startsWith('pkg:');
        const isInventory = String(masterService.service_id || '').startsWith('inv:');
        if (!isPackage && !isInventory) {
          adjustedPrice = fixedExtra > 0 ? (basePrice + fixedExtra) : (basePrice + (basePrice * markupPercent / 100));
        }
      }

      // Get tax information
      let taxId: string | undefined;
      let taxRate: number | undefined;

      const taxIdFromService = (masterService as any).tax_id;
      if (taxIdFromService) {
        taxId = String(taxIdFromService);
        const tx = masterTaxes.find(t =>
          String(t.tax_id) === String(taxIdFromService) ||
          String(t.id) === String(taxIdFromService)
        );
        if (tx) {
          taxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
        }
      }

      // Auto-assign global staff if one is selected
      const staff = globalStaffId ? masterEmployees.find(emp => emp.employee_id === globalStaffId) : null;
      const staffName = staff ? staff.employee_name : "";

      const newService: Service = {
        id: Math.random().toString(36).substr(2, 9),
        name: masterService.service_name,
        price: Number(adjustedPrice.toFixed(2)),
        quantity: 1,
        description: masterService.service_description,
        basePrice: basePrice,
        service_id: masterService.service_id || masterService.id?.toString(),
        taxId: taxId,
        taxRate: taxRate,
        discount_percentage: 0,
        staffId: globalStaffId, // Auto-assign global staff
        staffName: staffName,
      };

      setNewInvoice((prev) => ({
        ...prev,
        services: [...prev.services, newService],
      }));
      setInvalid(prev => ({ ...prev, services: false }));
    }
  };

  // Select an inventory product as an invoice line
  const handleInventorySelect = (prod: MasterInventory) => {
    // Use a namespaced service_id to avoid collisions with services/packages
    const sid = `inv:${String(prod.id)}`;
    const existingIndex = newInvoice.services.findIndex(s => String(s.service_id) === sid);

    if (existingIndex >= 0) {
      // increase quantity
      const existing = newInvoice.services[existingIndex];
      updateService(existing.id, "quantity", (existing.quantity || 0) + 1);
    } else {
      // Map product tax (string id) to tax rate if present
      let taxId: string | undefined;
      let taxRate: number | undefined;
      if (prod.tax) {
        taxId = String(prod.tax);
        const tx = masterTaxes.find(t => String(t.tax_id) === String(prod.tax) || String(t.id) === String(prod.tax));
        if (tx) taxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
      }
      if (productsTaxExempted) {
        taxRate = 0; // products-specific tax exemption
      }

      const basePrice = Number(prod.selling_price) || 0;
      const newLine: Service = {
        id: Math.random().toString(36).slice(2),
        name: prod.item_name,
        price: basePrice,
        quantity: 1,
        description: prod.brand || prod.category || '',
        basePrice: basePrice,
        service_id: sid,
        productBusinessId: String((prod as any).product_id ?? prod.id),
        barcode: prod.barcode ?? null,
        brand: prod.brand ?? null,
        taxId,
        taxRate,
        discount_percentage: 0,
        staffId: globalStaffId || '',
        staffName: globalStaffId ? (masterEmployees.find(e => e.employee_id === globalStaffId)?.employee_name || '') : ''
      };
      setNewInvoice(prev => ({ ...prev, services: [...prev.services, newLine] }));
      setInvalid(prev => ({ ...prev, services: false }));
    }
  };

  // Toggle products tax exemption and update existing product lines
  const toggleProductsTaxExempt = useCallback(() => {
    setProductsTaxExempted(prev => {
      const next = !prev;
      setNewInvoice(inv => ({
        ...inv,
        services: inv.services.map(s => {
          // Apply only to product lines
          if (String(s.service_id || '').startsWith('inv:')) {
            if (next) {
              return { ...s, taxRate: 0 };
            } else {
              // restore tax from taxId if available
              const tx = masterTaxes.find(t => String(t.tax_id) === String(s.taxId) || String(t.id) === String(s.taxId));
              const rate = tx ? (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0) : undefined;
              return { ...s, taxRate: rate };
            }
          }
          return s;
        })
      }));
      return next;
    });
  }, [masterTaxes]);

  const handlePackageSelect = (masterPackage: MasterPackage) => {
    // Check if this package is already selected
    const pkgSid = `pkg:${String(masterPackage.package_id ?? masterPackage.id)}`;
    const existingServiceIndex = newInvoice.services.findIndex(
      s => String(s.service_id) === pkgSid
    );

    if (existingServiceIndex >= 0) {
      // If package already exists, increase quantity
      const existingService = newInvoice.services[existingServiceIndex];
      updateService(existingService.id, "quantity", existingService.quantity + 1);
    } else {
      // If package doesn't exist, add it as new
      // Packages use base price without markup
      const basePrice = Number(masterPackage.package_price) || 0;
      const adjustedPrice = basePrice; // No markup for packages

      // Get tax information
      let taxId: string | undefined;
      let taxRate: number | undefined;

      const taxIdFromPackage = masterPackage.tax_id;
      console.log('📦 Package object structure:', masterPackage);
      console.log('📦 Package tax lookup:', {
        packageName: masterPackage.package_name,
        taxIdFromPackage,
        rawTaxId: (masterPackage as any).taxid,
        availableTaxes: masterTaxes.map(t => ({ tax_id: t.tax_id, desc: t.description, cgst: t.cgst, sgst: t.sgst }))
      });

      if (taxIdFromPackage) {
        taxId = String(taxIdFromPackage);
        const tx = masterTaxes.find(t =>
          String(t.tax_id) === String(taxIdFromPackage) ||
          String(t.id) === String(taxIdFromPackage)
        );
        console.log('📦 Found tax record:', tx);
        if (tx) {
          taxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
          console.log('📦 Calculated tax rate:', taxRate);
        } else {
          console.warn('📦 No tax record found for tax_id:', taxIdFromPackage);
          taxRate = 0; // Default to 0 if tax not found
        }
      } else {
        console.warn('📦 Package has no tax_id, defaulting to 0%');
        taxRate = 0;
      }

      if (packagesTaxExempted) {
        taxRate = 0; // packages-specific tax exemption
        console.log('📦 Tax exempted via toggle, setting to 0%');
      }

      // Auto-assign global staff if one is selected
      const staff = globalStaffId ? masterEmployees.find(emp => emp.employee_id === globalStaffId) : null;
      const staffName = staff ? staff.employee_name : "";

      const newService: Service = {
        id: Math.random().toString(36).substr(2, 9),
        name: masterPackage.package_name,
        price: Number(adjustedPrice.toFixed(2)),
        quantity: 1,
        description: masterPackage.package_description,
        basePrice: basePrice,
        service_id: pkgSid,
        taxId: taxId,
        taxRate: taxRate,
        discount_percentage: 0,
        staffId: globalStaffId, // Auto-assign global staff
        staffName: staffName,
        staffAssignments: globalStaffId ? [{ staffId: globalStaffId, staffName }] : [{ staffId: '', staffName: '' }],
      };

      console.log('📦 Adding package service:', {
        name: newService.name,
        taxId: newService.taxId,
        taxRate: newService.taxRate
      });

      setNewInvoice((prev) => ({
        ...prev,
        services: [...prev.services, newService],
      }));
      setInvalid(prev => ({ ...prev, services: false }));
    }
  };

  // Toggle packages tax exemption and update existing package lines
  const togglePackagesTaxExempt = useCallback(() => {
    setPackagesTaxExempted(prev => {
      const next = !prev;
      setNewInvoice(inv => ({
        ...inv,
        services: inv.services.map(s => {
          // Apply only to package lines
          if (String(s.service_id || '').startsWith('pkg:')) {
            if (next) {
              return { ...s, taxRate: 0 };
            } else {
              // restore tax from taxId if available
              const tx = masterTaxes.find(t => String(t.tax_id) === String(s.taxId) || String(t.id) === String(s.taxId));
              const rate = tx ? (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0) : undefined;
              return { ...s, taxRate: rate };
            }
          }
          return s;
        })
      }));
      return next;
    });
  }, [masterTaxes]);

  const handleServiceNameChange = (id: string, value: string) => {
    updateService(id, "name", value);

    if (value.length > 0) {
      const filtered = masterServices
        .filter((service) =>
          service.service_name.toLowerCase().includes(value.toLowerCase())
        )
        .map((service) => ({
          name: service.service_name,
          price: service.price,
          description: service.service_description || "",
          duration: "30 min", // Default duration since API doesn't provide this field
          service_id: service.service_id || service.id?.toString?.()
        }));
      setSuggestions(filtered);
      setShowSuggestions(id);
      setSelectedSuggestionIndex(-1); // Reset selection when typing

      // Update dropdown position when typing (immediate update)
      setTimeout(() => {
        const input = serviceInputRefs.current[id];
        if (input) {
          const rect = input.getBoundingClientRect();

          // If input is not visible, hide dropdown
          if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
            setShowSuggestions(null);
            return;
          }

          // Calculate optimal position
          const viewportHeight = window.innerHeight;
          const viewportWidth = window.innerWidth;
          const dropdownHeight = 200;
          const dropdownWidth = Math.max(rect.width, 250);

          // Position below input by default, but above if no space below
          let top = rect.bottom + 4; // fixed positioned element uses viewport coords
          if (rect.bottom + dropdownHeight > viewportHeight && rect.top > dropdownHeight) {
            top = rect.top - dropdownHeight - 4;
          }

          // Ensure dropdown stays within viewport horizontally
          let left = rect.left;
          if (left + dropdownWidth > viewportWidth) {
            left = viewportWidth - dropdownWidth - 8;
          }
          if (left < 8) {
            left = 8;
          }

          setDropdownPosition({
            top,
            left,
            width: rect.width,
          });
        }
      }, 0);
    } else {
      setShowSuggestions(null);
      setSelectedSuggestionIndex(-1);
    }
  };

  const selectSuggestion = (id: string, suggestion: ServiceSuggestion) => {
    // If staff is already assigned (global or row-level), apply markup immediately
    const current = newInvoice.services.find(s => s.id === id);
    const assignedStaffId = current?.staffId || globalStaffId || '';
    const emp = assignedStaffId ? employeeMap[assignedStaffId] : undefined;
    const fixedExtra = emp ? (Number((emp as any).price_markup_amount) || 0) : 0;
    const markupPercent = emp ? (Number(emp.price_markup_percent) || 0) : 0;
    const basePrice = Number(suggestion.price) || 0;
    const adjustedPrice = fixedExtra > 0 ? (basePrice + fixedExtra) : (basePrice + (basePrice * markupPercent / 100));
    let taxId: string | undefined;
    let taxRate: number | undefined;
    const ms = masterServices.find(ms => (ms.service_id || String(ms.id)) === suggestion.service_id);
    if (ms) {
      taxId = (ms as any).tax_id || undefined;
      if (taxId) {
        const tx = masterTaxes.find(t => String(t.tax_id) === String(taxId) || String(t.id) === String(taxId));
        if (tx) taxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
      }
    }
    setNewInvoice(prev => ({
      ...prev,
      services: prev.services.map(s => s.id === id ? {
        ...s,
        name: suggestion.name,
        basePrice,
        price: Number(adjustedPrice.toFixed(2)),
        service_id: suggestion.service_id,
        taxId,
        taxRate,
        // Preserve or set staff based on current/global selection
        staffId: s.staffId || assignedStaffId || '',
        staffName: s.staffName || (assignedStaffId && employeeMap[assignedStaffId]?.employee_name) || s.staffName || ''
      } : s)
    }));
    setShowSuggestions(null);
    setSelectedSuggestionIndex(-1);
    setTimeout(() => {
      // After selecting a service, move focus to Quantity to follow visual order (Service → Qty → Price)
      const qtyInput = quantityInputRefs.current[id];
      if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
    }, 100);
  };

  const handleKeyDown = (
    e: React.KeyboardEvent,
    id: string,
    field: "service" | "price" | "quantity",
  ) => {
    // Row navigation helpers
    const idx = newInvoice.services.findIndex(s => s.id === id);
    const prevRow = idx > 0 ? newInvoice.services[idx - 1] : undefined;
    const nextRow = idx < newInvoice.services.length - 1 ? newInvoice.services[idx + 1] : undefined;

    if (field === "service" && showSuggestions === id && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestionIndex(prev =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestionIndex(prev =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (selectedSuggestionIndex >= 0) {
          selectSuggestion(id, suggestions[selectedSuggestionIndex]);
        } else if (suggestions.length > 0) {
          selectSuggestion(id, suggestions[0]);
        }
        return;
      }
    }

    // Optional: Alt + ArrowUp/ArrowDown to move between rows in the same column
    if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const targetRow = e.key === "ArrowDown" ? nextRow : prevRow;
      if (targetRow) {
        if (field === "service") {
          const el = serviceInputRefs.current[targetRow.id];
          if (el) { el.focus(); el.select?.(); }
        } else if (field === "quantity") {
          const el = quantityInputRefs.current[targetRow.id];
          if (el) { el.focus(); el.select?.(); }
        } else if (field === "price") {
          const el = priceInputRefs.current[targetRow.id];
          if (el) { el.focus(); el.select?.(); }
        }
      }
      return;
    }

    const isTab = e.key === "Tab";
    const isEnter = e.key === "Enter";
    if (isEnter || isTab) {
      e.preventDefault();
      const currentService = newInvoice.services.find(s => s.id === id);
      if (field === "service") {
        // Validate service name before moving
        if (!currentService?.name?.trim()) return;
        // Next focus: Quantity (visual order)
        const qtyInput = quantityInputRefs.current[id];
        if (qtyInput) { qtyInput.focus(); qtyInput.select(); return; }
      }
      if (field === "quantity") {
        // Validate quantity before moving
        if (!currentService?.quantity || currentService.quantity <= 0) return;
        // Next focus: Price
        const pInput = priceInputRefs.current[id];
        if (pInput) { pInput.focus(); pInput.select(); return; }
      }
      if (field === "price") {
        // Validate price before moving
        if (!currentService?.price || currentService.price <= 0) return;
        // Next: Next row's Service if exists; otherwise add a new row
        if (isTab && (e as any).shiftKey) {
          // Shift+Tab: go backwards (Price -> Qty)
          const qtyInput = quantityInputRefs.current[id];
          if (qtyInput) { qtyInput.focus(); qtyInput.select(); return; }
        } else {
          if (nextRow) {
            const el = serviceInputRefs.current[nextRow.id];
            if (el) { el.focus(); el.select?.(); return; }
          } else {
            addService();
            return;
          }
        }
      }
      // Backward traversal with Shift+Tab when on Quantity or Service
      if (isTab && (e as any).shiftKey) {
        if (field === "quantity") {
          const el = serviceInputRefs.current[id];
          if (el) { el.focus(); el.select?.(); return; }
        } else if (field === "service") {
          if (prevRow) {
            const el = priceInputRefs.current[prevRow.id];
            if (el) { el.focus(); el.select?.(); return; }
          }
        }
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(null);
      setSelectedSuggestionIndex(-1);
    }
  };

  const subtotal = newInvoice.services.reduce(
    (sum, service) => sum + service.price * service.quantity,
    0,
  );
  const baseSubtotal = newInvoice.services.reduce((sum, s) => {
    const base = s.basePrice != null ? s.basePrice : s.price;
    return sum + base * s.quantity;
  }, 0);
  const markupTotal = subtotal - baseSubtotal;
  const discountValue = newInvoice.discount === "" ? 0 : Number(newInvoice.discount) || 0;
  // Membership percent originates from customer's membership and is controlled by the toggle
  const membershipPercent = applyMembershipDiscountToggle && customerMembership
    ? Number(customerMembership.discount_percent || 0)
    : 0;
  // Distribute discounts proportionally across lines (both regular and membership)
  const validServices = newInvoice.services.filter(s => s.name && s.price);
  const lineGrosses = validServices.map(s => s.price * s.quantity);
  const isServiceFlags = validServices.map(s => {
    const sid = String(s.service_id || '');
    return !(sid.startsWith('pkg:') || sid.startsWith('inv:'));
  });
  const grossSum = lineGrosses.reduce((a, b) => a + b, 0);
  const grossSumServices = lineGrosses.reduce((sum, g, idx) => sum + (isServiceFlags[idx] ? g : 0), 0);
  // Membership discount should apply ONLY to service lines (exclude packages/products)
  const membershipDiscountAmountOverall = (membershipPercent > 0 && grossSumServices > 0)
    ? Number(((grossSumServices * membershipPercent) / 100).toFixed(2))
    : 0;
  // Split discount between membership (services-only) and any additional discount
  // If percentage, treat entered discount as membership + additional; additional = max(0, entered - membership)
  const additionalPercent = (newInvoice.discountType === "percentage" && membershipPercent > 0)
    ? Math.max(0, discountValue - membershipPercent)
    : (newInvoice.discountType === "percentage" ? discountValue : 0);
  const additionalDiscountAmountOverall = newInvoice.discountType === "percentage"
    ? (subtotal * additionalPercent) / 100
    : Math.max(0, Math.min(discountValue, subtotal) - membershipDiscountAmountOverall); // Fixed: entered represents total (membership+extra)
  const allocProportional = (total: number) => {
    if (!grossSum || total <= 0) return lineGrosses.map(() => 0);
    const raw = lineGrosses.map(g => Number(((g / grossSum) * total).toFixed(2)));
    // fix rounding drift on the last item
    const diff = Number((total - raw.reduce((a, b) => a + b, 0)).toFixed(2));
    if (raw.length > 0) raw[raw.length - 1] = Number((raw[raw.length - 1] + diff).toFixed(2));
    return raw;
  };
  const regularAlloc = allocProportional(additionalDiscountAmountOverall);
  const allocProportionalEligible = (total: number, eligible: boolean[]) => {
    if (!total || total <= 0) return lineGrosses.map(() => 0);
    const eligibleSum = lineGrosses.reduce((sum, g, idx) => sum + (eligible[idx] ? g : 0), 0);
    if (!eligibleSum) return lineGrosses.map(() => 0);
    const raw = lineGrosses.map((g, idx) => Number((((eligible[idx] ? g : 0) / eligibleSum) * total).toFixed(2)));
    const diff = Number((total - raw.reduce((a, b) => a + b, 0)).toFixed(2));
    if (raw.length > 0) raw[raw.length - 1] = Number((raw[raw.length - 1] + diff).toFixed(2));
    return raw;
  };
  const membershipAlloc = allocProportionalEligible(membershipDiscountAmountOverall, isServiceFlags);
  let taxableAmount = 0;
  let taxAmount = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  const cgstRateSet = new Set<number>();
  const sgstRateSet = new Set<number>();
  const igstRateSet = new Set<number>();

  // Handle tax calculation differently when locked to appointment tax (prevents double taxation)
  if (lockToApptTax && apptTaxSummary) {
    // When locked to appointment tax, the service prices likely already include tax
    // Calculate taxable amount by subtracting the pre-calculated tax from subtotal after discounts
    const totalDiscountAmount = additionalDiscountAmountOverall + membershipDiscountAmountOverall;
    const afterDiscountSubtotal = subtotal - totalDiscountAmount;

    cgstTotal = Number((apptTaxSummary.cgst || 0).toFixed(2));
    sgstTotal = Number((apptTaxSummary.sgst || 0).toFixed(2));
    igstTotal = 0;
    taxAmount = Number((apptTaxSummary.total || (cgstTotal + sgstTotal)).toFixed(2));

    // Derive taxable amount by subtracting tax from the after-discount subtotal
    taxableAmount = Math.max(afterDiscountSubtotal - taxAmount, 0);

    // Set rate displays based on appointment data or fallback to service rates
    newInvoice.services.forEach(s => {
      if (s.taxId) {
        const tx = masterTaxes.find(t => String(t.tax_id) === String(s.taxId) || String(t.id) === String(s.taxId));
        if (tx) {
          cgstRateSet.add(Number(tx.cgst) || 0);
          sgstRateSet.add(Number(tx.sgst) || 0);
          if (tx.igst) igstRateSet.add(Number(tx.igst) || 0);
        }
      } else if (s.taxRate != null) {
        const halfRate = s.taxRate / 2;
        cgstRateSet.add(halfRate);
        sgstRateSet.add(halfRate);
      }
    });
  } else {
    // Normal tax calculation when not locked to appointment
    newInvoice.services.forEach((s, idx) => {
      if (!s.name || !s.price) return;
      const lineGross = s.price * s.quantity;
      // Use proportional discount allocation for accurate per-line taxation base
      const vi = validServices.indexOf(s);
      const regDisc = vi >= 0 ? (regularAlloc[vi] || 0) : 0;
      const memDisc = vi >= 0 ? (membershipAlloc[vi] || 0) : 0;
      const lineDiscount = regDisc + memDisc;
      const lineTaxable = Math.max(lineGross - lineDiscount, 0);
      taxableAmount += lineTaxable;
      // Derive component rates
      let cRate = 0, sRate = 0, iRate = 0;
      const sidStr = String(s.service_id || '');
      const isProduct = sidStr.startsWith('inv:');
      const isPackage = sidStr.startsWith('pkg:');
      const productExempt = isProduct && productsTaxExempted;
      const packageExempt = isPackage && packagesTaxExempted;
      if (!productExempt && !packageExempt && s.taxId) {
        const tx = masterTaxes.find(t => String(t.tax_id) === String(s.taxId) || String(t.id) === String(s.taxId));
        if (tx) {
          cRate = Number(tx.cgst) || 0; sRate = Number(tx.sgst) || 0; iRate = Number(tx.igst) || 0;
        }
      }
      // Fallback if we only have combined taxRate and no taxId mapping
      // BUT only if taxRate is not explicitly 0 (which means "no tax")
      if ((cRate + sRate + iRate) === 0 && !productExempt && !packageExempt && s.taxRate !== 0) {
        const combined = (s.taxRate != null ? s.taxRate : newInvoice.tax) || 0;
        // Assume split equally into CGST/SGST if IGST not defined
        cRate = combined / 2;
        sRate = combined / 2;
      }
      // Respect section-specific tax exemptions
      if (productExempt || packageExempt) {
        cRate = 0; sRate = 0; iRate = 0;
      }
      cgstRateSet.add(cRate);
      sgstRateSet.add(sRate);
      if (iRate) igstRateSet.add(iRate);
      const lineCgst = (lineTaxable * cRate) / 100;
      const lineSgst = (lineTaxable * sRate) / 100;
      const lineIgst = (lineTaxable * iRate) / 100;
      cgstTotal += lineCgst;
      sgstTotal += lineSgst;
      igstTotal += lineIgst;
    });
    cgstTotal = Number(cgstTotal.toFixed(2));
    sgstTotal = Number(sgstTotal.toFixed(2));
    igstTotal = Number(igstTotal.toFixed(2));
    taxAmount = Number((cgstTotal + sgstTotal + igstTotal).toFixed(2));
  }
  // Apply tax exemption if toggle is enabled
  if (taxExempted) {
    cgstTotal = 0;
    sgstTotal = 0;
    igstTotal = 0;
    taxAmount = 0;
  }
  const total = taxableAmount + taxAmount;
  const roundedTotal = Math.round(total);
  const roundOff = Number((roundedTotal - total).toFixed(2));
  const uniqueLineRates = new Set(newInvoice.services.map(s => (s.taxRate != null ? s.taxRate : newInvoice.tax)));
  const displayTaxPercent = uniqueLineRates.size === 1 && newInvoice.services.length > 0
    ? [...uniqueLineRates][0]
    : newInvoice.tax;
  const cgstRateDisplay = cgstRateSet.size === 1 ? `${[...cgstRateSet][0]}%` : 'varies';
  const sgstRateDisplay = sgstRateSet.size === 1 ? `${[...sgstRateSet][0]}%` : 'varies';
  const igstRateDisplay = igstRateSet.size === 1 ? `${[...igstRateSet][0]}%` : 'varies';

  // Auto-sync credit to remaining balance when payment amounts change
  useEffect(() => {
    const totalPaid = selectedPaymentModes.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const remaining = Math.max(0, roundedTotal - totalPaid);

    // Only clear credit if payment modes fully cover the total
    if (remaining === 0 && creditAmount > 0) {
      setCreditAmount(0);
    }
    // Don't auto-set credit amount - let user control it manually
  }, [selectedPaymentModes, roundedTotal]);

  // Track previous total to detect changes and recalculate payment modes
  const [previousTotal, setPreviousTotal] = useState<number>(0);

  useEffect(() => {
    // When total changes due to service modifications, recalculate payment modes
    if (previousTotal !== roundedTotal && previousTotal > 0 && roundedTotal > 0 && selectedPaymentModes.length > 0) {
      recalculatePaymentModes(previousTotal, roundedTotal);
    }
    setPreviousTotal(roundedTotal);
  }, [roundedTotal]); // Only depend on roundedTotal to avoid infinite loops

  // Backfill missing per-line taxRate if master data arrives after service selection
  useEffect(() => {
    if (!masterServices.length || !masterTaxes.length) return;
    setNewInvoice(prev => {
      let changed = false;
      const services = prev.services.map(s => {
        if ((s.taxRate == null || s.taxId == null) && s.service_id) {
          const ms = masterServices.find(ms => (ms.service_id || String(ms.id)) === s.service_id);
          if (ms) {
            const taxId: any = (ms as any).tax_id;
            if (taxId) {
              const tx = masterTaxes.find(t => String(t.tax_id) === String(taxId) || String(t.id) === String(taxId));
              if (tx) {
                const taxRate = (Number(tx.cgst) || 0) + (Number(tx.sgst) || 0) + (Number(tx.igst) || 0);
                changed = true;
                return { ...s, taxId: String(taxId), taxRate };
              }
            }
          }
        }
        return s;
      });
      return changed ? { ...prev, services } : prev;
    });
  }, [masterServices, masterTaxes]);

  // Fetch customer visit history
  const fetchVisitHistory = useCallback(async (customerId: string | number) => {
    if (!customerId) return;

    setLoadingVisitHistory(true);
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const params = new URLSearchParams();
      if (acc) params.append('account_code', acc);
      if (ret) params.append('retail_code', ret);

      const response = await ApiService.get(`/customer-visit-history/${customerId}?${params.toString()}`);
      setVisitHistoryData(response);
      setShowVisitHistory(true);
    } catch (error) {
      console.error('Failed to fetch visit history:', error);
      toast({
        title: "Error",
        description: "Failed to fetch customer visit history",
        variant: "destructive"
      });
    } finally {
      setLoadingVisitHistory(false);
    }
  }, [user, toast]);

  const fetchVisitInvoiceDetails = useCallback(async (invoiceId: string) => {
    if (!invoiceId) return;
    setLoadingVisitInvoiceDetails(true);
    setVisitInvoiceDetails(null);
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const params = new URLSearchParams();
      if (acc) params.append('account_code', acc);
      if (ret) params.append('retail_code', ret);

      const resp = await ApiService.get(`/billing-transition/${encodeURIComponent(invoiceId)}?${params.toString()}`);
      setVisitInvoiceDetails(resp);
      // Also capture header billstatus to adjust UI when viewing an existing/cancelled invoice
      try {
        const hdr = (resp && typeof resp === 'object' && 'header' in resp) ? (resp as any).header : {};
        setInvoiceBillStatus(String(hdr.billstatus || hdr.bill_status || hdr.BILL_STATUS || '').trim() || null);
      } catch (e) {
        // ignore
      }
    } catch (error) {
      console.error('Failed to fetch invoice details:', error);
      toast({
        title: 'Error',
        description: 'Failed to load invoice details',
        variant: 'destructive',
      });
    } finally {
      setLoadingVisitInvoiceDetails(false);
    }
  }, [user, toast]);

  // Debounced customer search
  const customerSearchTimeout = useRef<number | undefined>(undefined);
  // Function to calculate dropdown position for active customer row
  const updateDropdownPosition = (field: 'name' | 'phone') => {
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      return;
    }

    let inputElement: HTMLInputElement | null = null;

    // Find the correct input element based on active row and field
    if (field === 'name') {
      inputElement = activeCustomerRowId === '1'
        ? customerNameRef.current
        : customerNameRefs.current[activeCustomerRowId];
    } else if (field === 'phone') {
      inputElement = activeCustomerRowId === '1'
        ? customerPhoneRef.current
        : customerPhoneRefs.current[activeCustomerRowId];
    }

    if (inputElement && inputElement.getBoundingClientRect) {
      try {
        const rect = inputElement.getBoundingClientRect();
        // Only update if we have valid dimensions
        if (rect.width > 0 && rect.height > 0) {
          customerDropdownPos.current = {
            top: rect.bottom + window.scrollY + 4,
            left: rect.left + window.scrollX,
            width: rect.width
          };
        }
      } catch (error) {
        console.warn('Error calculating dropdown position:', error);
      }
    }
  };

  const performCustomerSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length === 0) { setCustomerSuggestions([]); setShowCustomerSuggestions(false); return; }
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const params = new URLSearchParams({ q, limit: '10' });
      if (acc) params.append('account_code', acc);
      if (ret) params.append('retail_code', ret);
      // Explicitly request membership_id in the response
      params.append('include_membership', 'true');
      const resp = await ApiService.get(`/search-master-customer?${params.toString()}`);
      const data = (resp as any)?.data?.data || (resp as any)?.data || [];
      // Debug: Check if membership_id is included in the response
      if (Array.isArray(data) && data.length > 0) {
        console.log('Customer search response with membership data:', data.map(c => ({
          name: c.customer_name || c.name,
          phone: c.phone || c.mobile,
          membership_id: c.membership_id,
          customer_id: c.customer_id
        })));
      }
      setCustomerSuggestions(dedupeCustomerSuggestions(Array.isArray(data) ? data : []));
      if (Array.isArray(data) && data.length > 0) {
        setShowCustomerSuggestions(true);
        customerAnchorRef.current = 'name';
        setCustomerDropdownTick((t) => t + 1);
        // Position dropdown after state updates
        setTimeout(() => updateDropdownPosition('name'), 50);
      } else {
        setShowCustomerSuggestions(false);
      }
    } catch (e) {
      console.warn('Customer search failed', e);
    }
  }, [user]);

  // Row-aware search to avoid state lag: positions dropdown for the exact row/field
  const performCustomerSearchForRow = useCallback(
    async (customerId: string, field: 'name' | 'phone', q: string) => {
      if (!q || q.trim().length === 0) { setCustomerSuggestions([]); setShowCustomerSuggestions(false); return; }
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;
        const params = new URLSearchParams({ q, limit: '10' });
        if (acc) params.append('account_code', acc);
        if (ret) params.append('retail_code', ret);
        params.append('include_membership', 'true');
        const resp = await ApiService.get(`/search-master-customer?${params.toString()}`);
        const data = (resp as any)?.data?.data || (resp as any)?.data || [];
        const list = dedupeCustomerSuggestions(Array.isArray(data) ? data : []);
        if (Array.isArray(list) && list.length > 0) {
          // Compute position using the explicit ref first, then show
          customerAnchorRef.current = field;
          let inputElement: HTMLInputElement | null = null;
          if (field === 'name') {
            inputElement = customerId === '1' ? customerNameRef.current : customerNameRefs.current[customerId];
          } else {
            inputElement = customerId === '1' ? customerPhoneRef.current : customerPhoneRefs.current[customerId];
          }
          if (inputElement) {
            const rect = inputElement.getBoundingClientRect();
            customerDropdownPos.current = {
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
              width: rect.width,
            };
          }
          setCustomerSuggestions(list);
          setCustomerDropdownTick((t) => t + 1);
          setShowCustomerSuggestions(true);
        } else {
          setShowCustomerSuggestions(false);
        }
      } catch (e) {
        console.warn('Row-aware customer search failed', e);
      }
    }, [user]);

  const fetchWalletLedger = useCallback(async (customerId: number) => {
    if (!user?.account_code || !user?.retail_code) return;

    setWalletLedgerLoading(true);
    try {
      const params = new URLSearchParams({
        customer_id: customerId.toString(),
        account_code: user.account_code,
        retail_code: user.retail_code,
        limit: '50'
      });

      const response = await ApiService.get(`/api/customer-wallet-ledger?${params.toString()}`);
      const data = (response && typeof response === 'object' && 'data' in response)
        ? (response as any).data || []
        : [];
      // Persist full ledger list for the dialog
      setWalletLedgerData(Array.isArray(data) ? data : []);

      // Also bind `credit_amount` from the response to the Credit Amount textbox
      // The API may return either an array of entries or an object containing credit info.
      let serverCreditAmount = 0;
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        // Object-shaped response: look for common keys
        const obj: any = data;
        serverCreditAmount = Number(
          obj.credit_amount ?? obj.credit ?? obj.pending_credit ?? 0
        ) || 0;
      } else if (Array.isArray(data)) {
        // Array-shaped response: prefer an explicit `credit_amount` field from latest entry
        const latestWithCredit = data.find((e: any) => e && (e.credit_amount != null || e.credit != null || e.pending_credit != null));
        if (latestWithCredit) {
          serverCreditAmount = Number(
            latestWithCredit.credit_amount ?? latestWithCredit.credit ?? latestWithCredit.pending_credit ?? 0
          ) || 0;
        } else {
          // Fallback: compute credit from entries marked as CREDIT and SUCCESS
          try {
            serverCreditAmount = data
              .filter((e: any) => String(e?.txn_type || '').toUpperCase() === 'CREDIT' && String(e?.status || '').toUpperCase() === 'SUCCESS')
              .reduce((sum: number, e: any) => sum + (Number(e?.amount) || 0), 0) || 0;
          } catch (_) {
            // Non-fatal: leave as 0
          }
        }
      }

      // Update the bound credit amount if server reports a positive value
      if (serverCreditAmount > 0) {
        // Cap by current invoice total to avoid exceeding payable
        const adjusted = Math.min(serverCreditAmount, roundedTotal);
        setCreditAmount(adjusted);
        // Reflect in selected customer chip when available
        setSelectedCustomer(prev => prev ? { ...prev, customerCredit: adjusted } : prev);
      }
    } catch (error) {
      console.error('Failed to fetch wallet ledger:', error);
      toast({
        title: "Error",
        description: "Failed to fetch wallet ledger data",
        variant: "destructive",
      });
      setWalletLedgerData([]);
    } finally {
      setWalletLedgerLoading(false);
    }
  }, [user, toast]);

  const refreshCustomerSegmentAfterCreditPayment = useCallback(async () => {
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;
      if (!selectedCustomer?.id) return;

      const readRes: any = await DataService.readData(["master_customer"], acc, ret);
      const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data?.customers || readRes?.data || []) as any[];
      if (!Array.isArray(rowsRaw) || rowsRaw.length === 0) return;

      const wantId = String(selectedCustomer.id ?? '').trim();
      const match = rowsRaw.find((r: any) => String(r?.customer_id ?? r?.CUSTOMER_ID ?? r?.id ?? '').trim() === wantId);
      if (!match) return;

      const nextCredit = Number(match?.customer_credit ?? match?.CUSTOMER_CREDIT ?? 0) || 0;
      const nextVisits = String(match?.customer_visitcnt ?? match?.customer_visit_count ?? match?.visit_count ?? match?.total_visits ?? match?.customer_visits ?? '');

      setSelectedCustomer((prev) => (prev ? { ...prev, customerCredit: nextCredit } : prev));

      // Update primary customer row UI (Customer segment)
      setCustomers((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) return prev;
        return prev.map((row, idx) => {
          if (idx !== 0) return row;
          return {
            ...row,
            creditPending: String(nextCredit),
            ...(nextVisits ? { visitCount: String(nextVisits) } : {}),
          };
        });
      });
    } catch (e) {
      // Non-fatal: customer segment refresh is best-effort
      console.warn('Failed to refresh customer segment after credit payment', e);
    }
  }, [user, selectedCustomer]);

  const submitWalletPayment = useCallback(async () => {
    if (!user?.account_code || !user?.retail_code || !selectedCustomer?.id) return;
    if (!walletPayAmount || walletPayAmount <= 0) {
      toast({ title: 'Invalid amount', description: 'Enter a valid amount', variant: 'destructive' });
      return;
    }
    setWalletPaySubmitting(true);
    try {
      const payload = {
        customer_id: Number(selectedCustomer.id),
        amount: walletPayAmount,
        payment_mode: walletPayMode,
        account_code: user.account_code,
        retail_code: user.retail_code,
        notes: `Credit payment via ${walletPayMode}`,
      };
      await ApiService.post('/api/customer-wallet-payment', payload);
      setShowWalletPayModal(false);
      toast({ title: 'Success', description: `Credit payment of ₹${walletPayAmount} completed successfully.` });
      // Refresh
      fetchWalletLedger(Number(selectedCustomer.id));
      await refreshCustomerSegmentAfterCreditPayment();
    } catch (e) {
      console.error('Wallet payment failed', e);
      toast({ title: 'Payment failed', description: 'Could not record credit payment', variant: 'destructive' });
    } finally {
      setWalletPaySubmitting(false);
    }
  }, [user, selectedCustomer, walletPayAmount, walletPayMode, fetchWalletLedger, refreshCustomerSegmentAfterCreditPayment, toast]);

  const handleCustomerInputChange = (value: string) => {
    setNewInvoice(prev => ({ ...prev, customerName: value }));
    setSelectedCustomer(null);
    if (value && invalid.customerName) setInvalid(prev => ({ ...prev, customerName: false }));
    // Clear scanning complete flag to allow normal search when user manually types
    if (scanningComplete) setScanningComplete(false);
    // Clear gender when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setNewInvoice(prev => ({ ...prev, customerGender: '' }));
    }
    // Clear membership when customer name changes
    if (!customerMembership) {
      setCustomerMembership(null);
      // Reset toggle when membership cleared
      setApplyMembershipDiscountToggle(true);
    }
    // Clear additional customer details when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setMoreDetails({
        membership_id: '',
        birthday_date: '',
        anniversary_date: '',
        membership_cardno: '',
        address: '',
      });
    }
    // Only perform search if not currently scanning, loading from scan, or just completed scanning
    if (!scanLoading && !scanOpen && !scanningComplete) {
      if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
      customerSearchTimeout.current = window.setTimeout(() => performCustomerSearch(value), 250);
    }
  };

  // Handle customer input change for any row (supporting multiple customers)
  const handleCustomerInputChangeForRow = (customerId: string, value: string) => {
    setActiveCustomerRowId(customerId); // Set which row is currently active for suggestions
    updateCustomer(customerId, 'customerName', value);
    // Immediately update dropdown position under the correct input
    requestAnimationFrame(() => {
      // Prefer explicit element for accurate positioning
      const el = customerId === '1' ? customerNameRef.current : customerNameRefs.current[customerId];
      if (el && el.getBoundingClientRect) {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            customerDropdownPos.current = {
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
              width: rect.width,
            };
            setCustomerDropdownTick((t) => t + 1);
          }
        } catch { }
      }
    });

    // Trigger row-aware search immediately to avoid initial-char positioning lag
    if (value && value.trim().length > 0) {
      if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
      customerSearchTimeout.current = window.setTimeout(() => {
        performCustomerSearchForRow(customerId, 'name', value);
      }, 200);
    } else {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
    }

    // For the first customer, also update the main newInvoice state and trigger suggestions
    if (customerId === '1') {
      handleCustomerInputChange(value);
    } else {
      // For other customers, trigger customer search for suggestions
      // Handled by row-aware search above
    }
  };

  // Handle QR detection: fetch customer by scanned code (card no or id) and populate
  const handleScanDetected = async (code: string) => {
    const normalized = String(code || '').trim();
    if (!normalized) return;

    // Prevent multiple simultaneous scan processing.
    // Use refs because scanner callbacks can fire multiple times before state updates apply.
    if (scanProcessingRef.current || scanStopRef.current || scanLoading || scanningComplete) {
      return;
    }

    const now = Date.now();
    if (lastScanRef.current && lastScanRef.current.code === normalized && now - lastScanRef.current.ts < 3000) {
      // Same code scanned again within 3s; ignore.
      return;
    }

    scanProcessingRef.current = true;
    lastScanRef.current = { code: normalized, ts: now };

    try {
      // IMMEDIATELY set stop flag and close scanner to stop camera and prevent further scans
      scanStopRef.current = true;
      setScanOpen(false);
      setScanLoading(true);
      setScanningComplete(true);

      // Clear any existing customer search timeouts to prevent interference
      if (customerSearchTimeout.current) {
        window.clearTimeout(customerSearchTimeout.current);
        customerSearchTimeout.current = undefined;
      }

      // No-op

      // Prefer exact match by membership_cardno; if not found, fallback to search endpoint
      const found = await loadCustomerByCard(normalized);
      if (found) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      // Try search by general endpoint; supports name/phone/card
      const params = new URLSearchParams({ q: normalized, limit: '5' });
      if (acc) params.append('account_code', acc);
      if (ret) params.append('retail_code', ret);
      params.append('include_membership', 'true');
      const resp = await ApiService.get(`/search-master-customer?${params.toString()}`);
      const results = (resp as any)?.data?.data || (resp as any)?.data || [];
      const c = Array.isArray(results) && results.length ? results[0] : null;
      if (!c) {
        useToast().toast?.({ title: 'QR not found', description: 'No customer matched the scanned code.' });
        return;
      }
      const name = String(c.customer_name || c.full_name || c.name || '');
      const phone = String(c.phone || c.mobile || c.customer_phone || '');
      const customerId = (c as any).customer_id || c.id || '';
      const gender = normalizeGender(c.gender || c.customer_gender || '');
      setNewInvoice(prev => ({
        ...prev,
        customer: String(customerId || prev.customer || ''),
        customerName: name,
        customerPhone: phone,
        customerGender: gender,
      }));

      setCustomers(prev => prev.map(row =>
        row.id === '1'
          ? {
            ...row,
            customer: String(customerId || row.customer || ''),
            customerId: String(customerId || row.customerId || ''),
            customerName: name || row.customerName,
            customerPhone: phone || row.customerPhone,
            customerGender: gender || row.customerGender,
          }
          : row
      ));
      setSelectedCustomer({
        id: String(customerId),
        name,
        email: c.email || '',
        phone,
        totalVisits: Number((c as any).total_visits || 0),
        lastVisit: String((c as any).last_visit || ''),
        visitCount: Number((c as any).customer_visitcnt || (c as any).total_visits || 0),
        customerCredit: Number((c as any).customer_credit || 0)
      });

      // Ensure Visit Count / Credit Pending inputs update (they are bound to `customers`, not `selectedCustomer`)
      const scannedVc = Number((c as any).customer_visitcnt ?? (c as any).total_visits ?? 0) || 0;
      const scannedCred = Number((c as any).customer_credit ?? (c as any).credit_pending ?? (c as any).pending_credit ?? (c as any).wallet_balance ?? (c as any).total_balance ?? 0) || 0;
      setCustomers(prev => prev.map(row =>
        row.id === '1'
          ? { ...row, visitCount: String(scannedVc), creditPending: String(scannedCred) }
          : row
      ));
      // Populate Additional Customer Details modal fields from search result
      const suggestionBirthday = (c as any).birthday_date || (c as any).Birthday_date || (c as any).birthday || '';
      const suggestionAnniversary = (c as any).anniversary_date || (c as any).Anniversary_date || (c as any).anniversary || '';
      const suggestionCardNo = (c as any).membership_cardno || (c as any).Membership_cardno || (c as any).card_no || '';
      const suggestionAddress = (c as any).address || (c as any).Address || (c as any).customer_address || '';
      const membershipIdFromResult = (c as any).membership_id || '';
      const membershipIdResolved = resolveMembershipId(membershipIdFromResult);
      const birthdayResolved = toDateInputValue(suggestionBirthday);
      const anniversaryResolved = toDateInputValue(suggestionAnniversary);
      const cardResolved = sTrim(suggestionCardNo);
      const addressResolved = sTrim(suggestionAddress);
      setMoreDetails(prev => ({
        ...prev,
        membership_id: membershipIdResolved || (prev.membership_id || ''),
        birthday_date: birthdayResolved || prev.birthday_date || '',
        anniversary_date: anniversaryResolved || prev.anniversary_date || '',
        membership_cardno: cardResolved || prev.membership_cardno || '',
        address: addressResolved || prev.address || '',
      }));

      setCustomers(prev => prev.map(row =>
        row.id === '1'
          ? {
            ...row,
            customerMembershipId: membershipIdResolved || row.customerMembershipId || '',
            customerBirthday: birthdayResolved || row.customerBirthday || '',
            customerAnniversary: anniversaryResolved || row.customerAnniversary || '',
            customerMembershipCardNo: cardResolved || row.customerMembershipCardNo || '',
            customerAddress: addressResolved || row.customerAddress || '',
          }
          : row
      ));
      // Apply membership if present
      const membershipId = (c as any).membership_id;
      if (membershipId) {
        applyMembershipDiscount(membershipId);
      }
    } catch (e) {
      console.warn('QR lookup failed', e);
    } finally {
      // Ensure scanner is completely stopped
      setScanLoading(false);
      setScanOpen(false);
      setScanTarget(null);
      // Keep scanned code visible (cleared on Reset)
      // Clear the scanning complete flag after a delay to allow normal search functionality to resume
      setTimeout(() => {
        setScanningComplete(false);
      }, 1500);
    }
  };

  const handleCustomerPhoneChange = (value: string) => {
    const digits10 = String(value || '').replace(/\D+/g, '').slice(0, 10);
    setNewInvoice(prev => ({ ...prev, customerPhone: digits10 }));
    setSelectedCustomer(null);
    if (digits10 && invalid.customerPhone) setInvalid(prev => ({ ...prev, customerPhone: false }));
    // Clear scanning complete flag to allow normal search when user manually types
    if (scanningComplete) setScanningComplete(false);
    // Clear gender when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setNewInvoice(prev => ({ ...prev, customerGender: '' }));
    }
    // Clear membership when customer phone changes
    if (customerMembership) {
      setCustomerMembership(null);
    }
    // Clear additional customer details when manually typing (not selecting from suggestions)
    if (!showCustomerSuggestions || customerSuggestions.length === 0) {
      setMoreDetails({
        membership_id: '',
        birthday_date: '',
        anniversary_date: '',
        membership_cardno: '',
        address: '',
      });
    }
    // Only perform search if not currently scanning, loading from scan, or just completed scanning
    if (!scanLoading && !scanOpen && !scanningComplete) {
      if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
      customerSearchTimeout.current = window.setTimeout(() => performCustomerSearchByPhone(digits10), 250);
    }
  };

  // Handle customer phone change for any row (supporting multiple customers)
  const handleCustomerPhoneChangeForRow = (customerId: string, value: string) => {
    const digits10 = String(value || '').replace(/\D+/g, '').slice(0, 10);
    setActiveCustomerRowId(customerId); // Set which row is currently active for suggestions
    updateCustomer(customerId, 'customerPhone', digits10);
    // Immediately update dropdown position under the correct phone input
    requestAnimationFrame(() => {
      const el = customerId === '1' ? customerPhoneRef.current : customerPhoneRefs.current[customerId];
      if (el && el.getBoundingClientRect) {
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            customerDropdownPos.current = {
              top: rect.bottom + window.scrollY + 4,
              left: rect.left + window.scrollX,
              width: rect.width,
            };
            setCustomerDropdownTick((t) => t + 1);
          }
        } catch { }
      }
    });

    // Trigger row-aware phone search immediately to avoid initial-char positioning lag
    if (digits10 && digits10.trim().length > 0) {
      if (customerSearchTimeout.current) window.clearTimeout(customerSearchTimeout.current);
      customerSearchTimeout.current = window.setTimeout(() => {
        performCustomerSearchForRow(customerId, 'phone', digits10);
      }, 200);
    } else {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
    }

    // For the first customer, also update the main newInvoice state and trigger suggestions
    if (customerId === '1') {
      handleCustomerPhoneChange(digits10);
    } else {
      // For other customers, trigger customer phone search for suggestions
      // Handled by row-aware search above
    }
  };

  // Ensure phone field error clears when a non-empty value exists
  useEffect(() => {
    const v = String(newInvoice.customerPhone || '').trim();
    if (v && invalid.customerPhone) {
      setInvalid(prev => ({ ...prev, customerPhone: false }));
    }
  }, [newInvoice.customerPhone, invalid.customerPhone]);

  const performCustomerSearchByPhone = useCallback(async (phoneQuery: string) => {
    if (!phoneQuery || phoneQuery.trim().length === 0) {
      setCustomerSuggestions([]);
      setShowCustomerSuggestions(false);
      return;
    }
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      const params = new URLSearchParams({ q: phoneQuery, limit: '10' });
      if (acc) params.append('account_code', acc);
      if (ret) params.append('retail_code', ret);
      // Explicitly request membership_id in the response
      params.append('include_membership', 'true');
      const resp = await ApiService.get(`/search-master-customer?${params.toString()}`);
      const data = (resp as any)?.data?.data || (resp as any)?.data || [];
      // Debug: Check if membership_id is included in phone search response
      if (Array.isArray(data) && data.length > 0) {
        console.log('Phone search response with membership data:', data.map(c => ({
          name: c.customer_name || c.name,
          phone: c.phone || c.mobile,
          membership_id: c.membership_id,
          customer_id: c.customer_id
        })));
      }
      setCustomerSuggestions(dedupeCustomerSuggestions(Array.isArray(data) ? data : []));
      if (Array.isArray(data) && data.length > 0) {
        setShowCustomerSuggestions(true);
        customerAnchorRef.current = 'phone';
        setCustomerDropdownTick((t) => t + 1);
        // Position dropdown after state updates
        setTimeout(() => updateDropdownPosition('phone'), 50);
      } else {
        setShowCustomerSuggestions(false);
      }
    } catch (e) {
      console.warn('Customer phone search failed', e);
    }
  }, [user]);

  const selectCustomer = async (suggestion: CustomerSuggestion) => {
    const name = String(suggestion.customer_name || suggestion.full_name || suggestion.name || '');
    const phone = String(suggestion.phone || suggestion.mobile || suggestion.customer_phone || '');
    // Prioritize customer_id over primary key id
    const customerId = (suggestion as any).customer_id || suggestion.id || '';
    const membershipId = (suggestion as any).membership_id;
    const visitCount = Number(suggestion.customer_visitcnt || (suggestion as any).total_visits || 0);
    const creditPending = Number(suggestion.customer_credit || 0);
    // Duplicate customer check intentionally disabled as requested

    // Update the active customer row
    updateCustomer(activeCustomerRowId, 'customerId', String(customerId || ''));
    updateCustomer(activeCustomerRowId, 'customer', String(customerId || ''));
    updateCustomer(activeCustomerRowId, 'customerName', name);
    updateCustomer(activeCustomerRowId, 'customerPhone', phone);
    updateCustomer(activeCustomerRowId, 'visitCount', visitCount.toString());
    updateCustomer(activeCustomerRowId, 'creditPending', creditPending.toString());

    // Try to get gender from suggestion first
    const suggestionGender = (suggestion as any).gender ||
      (suggestion as any).customer_gender ||
      (suggestion as any).Gender ||
      (suggestion as any).GENDER ||
      (suggestion as any).sex ||
      (suggestion as any).SEX || '';

    if (suggestionGender) {
      const normalizedGender = normalizeGender(suggestionGender);
      if (normalizedGender) {
        updateCustomer(activeCustomerRowId, 'customerGender', normalizedGender);
      }
    }

    // If it's the first customer, also update main newInvoice state
    if (activeCustomerRowId === '1') {
      setNewInvoice(prev => ({ ...prev, customerName: name, customerPhone: phone }));
    }

    // Populate moreDetails from suggestion data if available
    const suggestionBirthday = (suggestion as any).birthday_date || (suggestion as any).Birthday_date || (suggestion as any).birthday || '';
    const suggestionAnniversary = (suggestion as any).anniversary_date || (suggestion as any).Anniversary_date || (suggestion as any).anniversary || '';
    const suggestionCardNo = (suggestion as any).membership_cardno || (suggestion as any).Membership_cardno || (suggestion as any).card_no || '';
    const suggestionAddress = (suggestion as any).address || (suggestion as any).Address || (suggestion as any).customer_address || '';

    setMoreDetails(prev => ({
      ...prev,
      membership_id: resolveMembershipId(membershipId) || prev.membership_id || '',
      birthday_date: toDateInputValue(suggestionBirthday) || prev.birthday_date || '',
      anniversary_date: toDateInputValue(suggestionAnniversary) || prev.anniversary_date || '',
      membership_cardno: sTrim(suggestionCardNo) || prev.membership_cardno || '',
      address: sTrim(suggestionAddress) || prev.address || '',
    }));

    // Since gender is not included in search results, fetch full customer details
    if (customerId && customerId !== '0' && customerId !== 0) {
      try {
        const acc = (user as any)?.account_code;
        const ret = (user as any)?.retail_code;

        if (acc && ret) {
          // Fetch full customer details to get gender
          const customerDetails = await DataService.readData(['master_customer'], acc, ret);

          // Handle different possible data structures
          const customers = (customerDetails?.data as any)?.master_customer ||
            (customerDetails?.data as any) ||
            customerDetails || [];

          // Try multiple matching strategies
          let fullCustomer = null;

          if (Array.isArray(customers)) {
            // Strategy 1: Match by customer_id
            fullCustomer = customers.find((c: any) =>
              String(c.customer_id || '') === String(customerId)
            );

            // Strategy 2: Match by id if customer_id didn't work
            if (!fullCustomer) {
              fullCustomer = customers.find((c: any) =>
                String(c.id || '') === String(customerId)
              );
            }

            // Strategy 3: Match by any ID field
            if (!fullCustomer) {
              fullCustomer = customers.find((c: any) =>
                String(c.customer_id || c.id || c.CUSTOMER_ID || c.ID || '') === String(customerId)
              );
            }
          }

          if (fullCustomer) {
            // Try to get gender from full customer data
            const genderFromCustomer = fullCustomer.gender ||
              fullCustomer.customer_gender ||
              fullCustomer.Gender ||
              fullCustomer.GENDER ||
              fullCustomer.sex ||
              fullCustomer.SEX || '';

            if (genderFromCustomer) {
              const normalizedGender = normalizeGender(genderFromCustomer);
              if (normalizedGender) {
                updateCustomer(activeCustomerRowId, 'gender', normalizedGender);
                // If it's the first customer, also update main newInvoice state
                if (activeCustomerRowId === '1') {
                  setNewInvoice(prev => ({ ...prev, customerGender: normalizedGender }));
                }
              }
            }

            // Auto-fill additional customer details into invoice state when available
            const birthday = fullCustomer.birthday_date || fullCustomer.Birthday_date || fullCustomer.birthday || '';
            const anniversary = fullCustomer.anniversary_date || fullCustomer.Anniversary_date || fullCustomer.anniversary || '';
            const cardNo = fullCustomer.membership_cardno || fullCustomer.Membership_cardno || fullCustomer.card_no || '';
            const address = fullCustomer.address || fullCustomer.Address || fullCustomer.customer_address || '';
            const customerMembershipId = fullCustomer.membership_id || fullCustomer.Membership_id || '';

            setNewInvoice(prev => ({
              ...prev,
              customerBirthday: birthday || prev.customerBirthday,
              customerAnniversary: anniversary || prev.customerAnniversary,
              customerMembershipCardNo: cardNo || prev.customerMembershipCardNo,
              customerAddress: address || prev.customerAddress,
            }));

            // Also populate the moreDetails state for the Additional Customer Details dialog
            setMoreDetails(prev => ({
              ...prev,
              membership_id: resolveMembershipId(customerMembershipId) || prev.membership_id || '',
              birthday_date: toDateInputValue(birthday) || prev.birthday_date || '',
              anniversary_date: toDateInputValue(anniversary) || prev.anniversary_date || '',
              membership_cardno: sTrim(cardNo) || prev.membership_cardno || '',
              address: sTrim(address) || prev.address || '',
            }));
          }
        }
      } catch (error) {
        console.error('Failed to fetch customer details:', error);
      }
    }
    setSelectedCustomer({
      id: String(customerId),
      name,
      email: suggestion.email || '',
      phone,
      totalVisits: (suggestion as any).total_visits || 0,
      lastVisit: (suggestion as any).last_visit || '',
      visitCount: Number(suggestion.customer_visitcnt || (suggestion as any).total_visits || 0),
      customerCredit: Number(suggestion.customer_credit || 0)
    });

    // Check if membership data is available directly from the API response
    if (membershipId && suggestion.membership_membership_name && suggestion.membership_discount_percent !== undefined) {
      // Use membership data directly from customer search response
      const membershipData: MasterMembership = {
        id: membershipId as number,
        membership_id: membershipId as number,
        membership_name: suggestion.membership_membership_name,
        discount_percent: suggestion.membership_discount_percent,
        duration_months: 0, // Default value, not needed for discount application
        price: 0, // Default value, not needed for discount application
        status: 1 // Default value, not needed for discount application
      };

      setCustomerMembership(membershipData);
    } else {
      // Fallback to the existing membership lookup logic
      applyMembershipDiscount(membershipId);
    }

    setShowCustomerSuggestions(false);
    setCustomerSelectedIndex(-1);
    // Focus on staff selection after customer selection
    setTimeout(() => {
      const staffSelect = document.querySelector('[data-staff-select] button') as HTMLButtonElement;
      if (staffSelect) {
        staffSelect.focus();
      }
    }, 50);
  };

  const handleCustomerKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCustomerSuggestions && customerSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerSelectedIndex(p => p < customerSuggestions.length - 1 ? p + 1 : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerSelectedIndex(p => p > 0 ? p - 1 : customerSuggestions.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (customerSelectedIndex >= 0) selectCustomer(customerSuggestions[customerSelectedIndex]); else selectCustomer(customerSuggestions[0]); }
      else if (e.key === 'Escape') { setShowCustomerSuggestions(false); setCustomerSelectedIndex(-1); }
    }
  };

  const handleCustomerPhoneKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showCustomerSuggestions && customerSuggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setCustomerSelectedIndex(p => p < customerSuggestions.length - 1 ? p + 1 : 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCustomerSelectedIndex(p => p > 0 ? p - 1 : customerSuggestions.length - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); if (customerSelectedIndex >= 0) selectCustomer(customerSuggestions[customerSelectedIndex]); else selectCustomer(customerSuggestions[0]); }
      else if (e.key === 'Escape') { setShowCustomerSuggestions(false); setCustomerSelectedIndex(-1); }
    }
  };

  // Handle positioning when dropdown visibility or active row changes
  useEffect(() => {
    if (showCustomerSuggestions && customerSuggestions.length > 0 && activeCustomerRowId) {
      const field = customerAnchorRef.current || 'name';
      setTimeout(() => updateDropdownPosition(field), 100);
    }
  }, [showCustomerSuggestions, customerSuggestions.length, activeCustomerRowId, customerDropdownTick]);

  // Close customer suggestions on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!customerNameRef.current && !customerPhoneRef.current) return;
      if (!(e.target instanceof Node)) return;
      if (customerNameRef.current?.contains(e.target) || customerPhoneRef.current?.contains(e.target)) return;
      setShowCustomerSuggestions(false);
    };
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, []);

  // Keep customer suggestions aligned with textbox during scroll/resize
  useEffect(() => {
    if (!showCustomerSuggestions) return;

    let ticking = false;
    let scrollTimeout: number | undefined;

    const getAnchorInput = () => {
      const field = customerAnchorRef.current || 'name';
      const rowId = activeCustomerRowId || '1';
      if (field === 'name') {
        return rowId === '1' ? customerNameRef.current : customerNameRefs.current[rowId] || customerNameRef.current;
      }
      if (field === 'phone') {
        return rowId === '1' ? customerPhoneRef.current : customerPhoneRefs.current[rowId] || customerPhoneRef.current;
      }
      // Fallback to focused element among all known inputs
      const focused = document.activeElement as HTMLElement | null;
      if (focused) {
        if (focused === customerNameRef.current || focused === customerPhoneRef.current) return focused as HTMLInputElement;
        const maybeRowName = Object.values(customerNameRefs.current).find(el => el === focused);
        if (maybeRowName) return maybeRowName;
        const maybeRowPhone = Object.values(customerPhoneRefs.current).find(el => el === focused);
        if (maybeRowPhone) return maybeRowPhone;
      }
      // Final fallback
      return customerNameRefs.current[rowId] || customerPhoneRefs.current[rowId] || customerNameRef.current || customerPhoneRef.current;
    };

    const updatePosition = () => {
      const input = getAnchorInput();
      if (!input) return;
      const rect = input.getBoundingClientRect();

      // Hide if scrolled out of viewport
      if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
        setShowCustomerSuggestions(false);
        return;
      }

      customerDropdownPos.current = {
        top: rect.bottom,
        left: rect.left,
        width: rect.width,
      };
      setCustomerDropdownTick((t) => t + 1);
      ticking = false;
    };

    const requestTick = () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      if (!ticking) {
        requestAnimationFrame(updatePosition);
        ticking = true;
      }
      scrollTimeout = window.setTimeout(() => {
        if (!ticking) {
          requestAnimationFrame(updatePosition);
          ticking = true;
        }
      }, 50);
    };

    // Attach listeners
    window.addEventListener('scroll', requestTick, { passive: true, capture: true });
    document.addEventListener('scroll', requestTick, { passive: true, capture: true });
    window.addEventListener('resize', requestTick, { passive: true });

    // Attach to scrollable parents of anchor as well
    const anchor = getAnchorInput();
    const scrollableParents: Element[] = [];
    if (anchor) {
      let parent = anchor.parentElement;
      const isScrollable = (v: string) => v === 'auto' || v === 'scroll' || v === 'overlay';
      while (parent && parent !== document.body) {
        const style = window.getComputedStyle(parent);
        if (isScrollable(style.overflow) || isScrollable(style.overflowY) || isScrollable(style.overflowX)) {
          scrollableParents.push(parent);
        }
        parent = parent.parentElement;
      }
      scrollableParents.forEach(el => el.addEventListener('scroll', requestTick, { passive: true }));
    }

    // Initial position
    requestTick();

    return () => {
      if (scrollTimeout) clearTimeout(scrollTimeout);
      window.removeEventListener('scroll', requestTick, true);
      document.removeEventListener('scroll', requestTick, true);
      window.removeEventListener('resize', requestTick);
      scrollableParents.forEach(el => el.removeEventListener('scroll', requestTick));
    };
  }, [showCustomerSuggestions]);

  const handleWalkInCustomer = () => {
    // No longer needed with simple inputs
  };

  // Safe trim helper to guard against non-string values (e.g., numbers from backend)
  const sTrim = (v: any) => String(v ?? '').trim();

  // Normalize a date string into HTML <input type="date"> value format (YYYY-MM-DD).
  const toDateInputValue = (v: any): string => {
    const s = String(v ?? '').trim();
    if (!s || s === '0' || s.toLowerCase() === 'null' || s.toLowerCase() === 'none') return '';

    // ISO date already
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // dd-mm-yyyy or dd/mm/yyyy
    let m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    if (m) {
      const dd = m[1];
      const mm = m[2];
      const yyyy = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    // yyyy/mm/dd
    m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (m) {
      const yyyy = m[1];
      const mm = m[2];
      const dd = m[3];
      return `${yyyy}-${mm}-${dd}`;
    }

    // ISO datetime -> take date
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);

    // Fallback: try Date parsing
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    return '';
  };

  const resolveMembershipId = (raw: any): string => {
    if (raw === null || raw === undefined) return '';
    const s = String(raw).trim();
    if (!s || s === '0') return '';

    // If it matches an ID, keep it.
    if ((masterMemberships || []).some((m) => String((m as any).membership_id) === s)) return s;

    // If it looks like a name, map it.
    const byName = (masterMemberships || []).find(
      (m) => String((m as any).membership_name || '').trim().toLowerCase() === s.toLowerCase()
    );
    if (byName) return String((byName as any).membership_id);

    return s;
  };

  // Ensure gender field highlight clears once a valid value is selected
  useEffect(() => {
    const primaryRowGender = customers?.[0]?.customerGender;
    const g = sTrim(newInvoice.customerGender || primaryRowGender);
    if (g && invalid.customerGender) {
      setInvalid(prev => ({ ...prev, customerGender: false }));
    }
  }, [newInvoice.customerGender, customers, invalid.customerGender]);

  const validateInvoice = () => {
    // Check if at least one customer has both name and phone
    const hasValidCustomer = customers.some(customer =>
      sTrim(customer.customerName) && sTrim(customer.customerPhone)
    );

    // For backward compatibility, also check the main newInvoice fields
    const hasName = !!sTrim(newInvoice.customerName) || hasValidCustomer;
    const hasPhone = !!sTrim(newInvoice.customerPhone) || hasValidCustomer;
    // Gender is mandatory: require gender for the primary customer (or any valid customer row)
    const hasGenderForAnyValidCustomer = customers.some(customer =>
      sTrim(customer.customerName) && sTrim(customer.customerPhone) && sTrim(customer.customerGender)
    );
    const hasGender = !!sTrim(newInvoice.customerGender) || hasGenderForAnyValidCustomer;
    const hasService = newInvoice.services.some((service) => service.name && service.price > 0);

    // Validate Physical Stats (mandatory and within range)
    const primaryCustomer = customers[0] || {};
    const ageVal = parseInt(String(primaryCustomer.customerAge || '0'), 10);
    const hasAge = ageVal >= 5 && ageVal <= 100;
    const heightVal = parseFloat(String(primaryCustomer.customerHeight || '0'));
    const hasHeight = heightVal >= 50 && heightVal <= 250;
    const weightVal = parseFloat(String(primaryCustomer.customerWeight || '0'));
    const hasWeight = weightVal >= 20 && weightVal <= 300;

    // TYPE UI row validation (ignore trailing blank row)
    let typeRowsValid = true;
    if (isTypeBillingUI) {
      const errs: Record<string, { item?: boolean; qty?: boolean; price?: boolean; staff?: boolean }> = {};
      const rowsToCheck = typeRows.filter((r, i) => !(i === typeRows.length - 1 && isTypeRowBlank(r)));
      for (const r of rowsToCheck) {
        if (isTypeRowBlank(r)) continue;
        const itemOk = !!sTrim(r.name) && !!sTrim((r as any).service_id);
        const qtyOk = Number((r as any).quantity || 0) > 0;
        const priceOk = Number((r as any).price || 0) > 0;
        const staffOk = !!sTrim((r as any).staffId);
        if (!itemOk || !qtyOk || !priceOk || !staffOk) {
          errs[r.id] = {
            item: !itemOk,
            qty: !qtyOk,
            price: !priceOk,
            staff: !staffOk,
          };
        }
      }
      setTypeRowErrors(errs);
      typeRowsValid = Object.keys(errs).length === 0;
    } else {
      // Clear any stale row errors when not in TYPE mode
      if (Object.keys(typeRowErrors).length) setTypeRowErrors({});
    }

    // Validate multiple payment modes
    const totalPaid = selectedPaymentModes.reduce((sum, p) => sum + p.amount, 0);
    const totalWithCredit = totalPaid + creditAmount;
    // Allow small tolerance due to rounding; treat nearest rupee as valid
    const paymentRounded = Math.round(totalWithCredit);
    const hasAnyPaymentMode = selectedPaymentModes.length > 0;

    // Check if full amount is in credit (no payment modes needed)
    const isFullCredit = creditAmount > 0 && Math.round(creditAmount) === roundedTotal;
    const hasValidPayment = (hasAnyPaymentMode && paymentRounded === roundedTotal) || isFullCredit;

    // Check if all line-items have staff assigned
    const validServices = newInvoice.services.filter(s => s.name && s.price > 0);
    const hasAllRequiredStaff = validServices.every((service) => {
      const sid = String((service as any).service_id || '');
      const isInventory = sid.startsWith('inv:');
      const isMultiAssignable = !isInventory; // services + packages

      if (!isMultiAssignable) {
        return !!service.staffId;
      }

      const qty = Math.max(1, Number(service.quantity || 1));
      const assignments = Array.isArray(service.staffAssignments) ? service.staffAssignments : [];
      for (let i = 0; i < qty; i++) {
        const assigned = assignments[i]?.staffId || (i === 0 ? service.staffId : '');
        if (!assigned) return false;
      }
      return true;
    });

    // Debug staff assignment validation
    if (!hasAllRequiredStaff) {
      console.log('🔍 VALIDATION DEBUG - Missing staff:', validServices
        .map(s => {
          const sid = String((s as any).service_id || '');
          const isInventory = sid.startsWith('inv:');
          const isMultiAssignable = !isInventory;
          const qty = Math.max(1, Number(s.quantity || 1));
          const assignments = Array.isArray(s.staffAssignments) ? s.staffAssignments : [];
          const missingSlots: number[] = [];
          if (isMultiAssignable) {
            for (let i = 0; i < qty; i++) {
              const assigned = assignments[i]?.staffId || (i === 0 ? s.staffId : '');
              if (!assigned) missingSlots.push(i + 1);
            }
          }
          return {
            id: s.id,
            name: s.name,
            service_id: sid,
            qty,
            staffId: s.staffId,
            staffName: s.staffName,
            missingSlots,
          };
        })
        .filter(x => (x.missingSlots?.length || 0) > 0 || !x.staffId)
      );
    }

    // Debug payment validation
    if (!hasValidPayment) {
      console.log('🔍 PAYMENT VALIDATION DEBUG:', {
        selectedPaymentModes: selectedPaymentModes.length,
        totalPaid,
        creditAmount,
        totalWithCredit,
        roundedTotal,
        isFullCredit,
        difference: Math.abs(totalWithCredit - roundedTotal)
      });
    }

    // Update UI highlights only (no text message)
    setInvalid({
      customerName: !hasName,
      customerPhone: !hasPhone,
      customerGender: !hasGender,
      customerAge: !hasAge,
      customerHeight: !hasHeight,
      customerWeight: !hasWeight,
      staff: !hasAllRequiredStaff,
      payment: !hasValidPayment,
      services: !hasService,
    });

    // Focus the first invalid field
    if (!hasName && customerNameRef.current) {
      customerNameRef.current.focus();
      customerNameRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (!hasPhone && customerPhoneRef.current) {
      customerPhoneRef.current.focus();
      customerPhoneRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } else if (!hasAllRequiredStaff) {
      console.log('Some services missing staff assignment');
    } else if (!hasValidPayment) {
      if (!hasAnyPaymentMode && !isFullCredit) {
        toast({
          title: "Select Payment Method",
          description: "Please add at least one payment mode.",
          className: "border-yellow-200 bg-yellow-50 text-yellow-900"
        });
      } else if (!isFullCredit) {
        toast({
          title: "Payment Validation",
          description: `Paid (₹${paymentRounded.toLocaleString()}) must equal total (₹${roundedTotal.toLocaleString()}). Adjust payment or credit.`,
          className: "border-yellow-200 bg-yellow-50 text-yellow-900"
        });
      }
    }

    return hasName && hasPhone && hasGender && hasAllRequiredStaff && hasService && hasValidPayment && typeRowsValid && hasAge && hasHeight && hasWeight;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || submitting) return;

    // Check validation; if invalid, fields are highlighted and focus moves—no message
    if (!validateInvoice()) return;

    setSubmitting(true);

    try {
      // Check if full amount is in credit and ask for confirmation
      const isFullCredit = creditAmount > 0 && Math.round(creditAmount) === roundedTotal;
      if (isFullCredit) {
        setPendingSubmit(e);
        setShowCreditConfirmation(true);
        return; // Wait for user confirmation in dialog
      }

      // Proceed with actual submission
      await processSubmit(e, 'active');
    } catch (error) {
      console.error('Error during submission:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleHoldInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || holdSubmitting) return;

    // HOLD bills can be saved without customer details.
    // Only require at least one line item so the invoice isn't empty.
    const hasAnyLineItem = newInvoice.services.some(s => s.name && s.price > 0 && Number(s.quantity || 0) > 0);

    if (!hasAnyLineItem) {
      toast({
        title: "Incomplete Information",
        description: "Please add at least one service/package to hold the invoice.",
        variant: "destructive"
      });
      return;
    }

    setHoldSubmitting(true);

    try {
      // Proceed with hold submission
      await processSubmit(e, 'hold');
    } catch (error) {
      console.error('Error during hold submission:', error);
    } finally {
      setHoldSubmitting(false);
    }
  };

  const handleCancelInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || cancelSubmitting) return;
    // Show confirmation dialog
    setShowCancelConfirmation(true);
  };

  const confirmCancelInvoice = async () => {
    if (!user || cancelSubmitting) return;
    const invoiceToCancel = (isEditMode && editId) || visitInvoiceId || null;
    if (!invoiceToCancel) {
      toast({ title: "No Invoice", description: "No existing invoice available to cancel.", variant: "destructive" });
      setShowCancelConfirmation(false);
      return;
    }

    setCancelSubmitting(true);
    try {
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      await InvoiceService.cancel(invoiceToCancel, acc, ret);
      toast({ title: "Invoice Cancelled", description: `Invoice ${invoiceToCancel} marked cancelled.`, variant: "default" });
      setShowCancelConfirmation(false);
      // Redirect to billing list
      navigate('/billing');
    } catch (err) {
      console.error('Error cancelling invoice:', err);
      toast({ title: "Cancel Failed", description: "Failed to cancel invoice. Try again.", variant: "destructive" });
    } finally {
      setCancelSubmitting(false);
    }
  };

  const processSubmit = async (e: React.FormEvent, status: 'active' | 'hold' = 'active') => {
    // Use actual scoped account/retail codes; if missing, backend will likely reject
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    try {
      // Determine primary customer from the first customers row for consistency
      const primaryRow = (customers && customers.length > 0) ? customers[0] : null;
      const primaryRowIdRaw = primaryRow ? (primaryRow.customerId || primaryRow.customer || '') : '';
      const normalizeId = (val: any): number | string => {
        const s = String(val ?? '').trim();
        if (!s) return 0;
        const n = parseInt(s, 10);
        return Number.isFinite(n) ? n : s;
      };
      // Prefer explicit first-row id; fallback to selectedCustomer; else 0 to trigger auto-create
      let actualCustomerId: number | string = primaryRowIdRaw ? normalizeId(primaryRowIdRaw) : (selectedCustomer ? (Number(selectedCustomer.id) || selectedCustomer.id) : 0);

      // If no customer selected but name/phone present, try to reuse existing or create a new master_customer with next customer_id
      // Use name/phone from primary row for lookup/create if id not present
      const primaryName = primaryRow ? String(primaryRow.customerName || '').trim() : String(newInvoice.customerName || '').trim();
      const primaryPhone = primaryRow ? String(primaryRow.customerPhone || '').trim() : String(newInvoice.customerPhone || '').trim();
      if (!actualCustomerId && sTrim(primaryName) && sTrim(primaryPhone)) {
        try {
          const readRes: any = await DataService.readData(["master_customer"], acc, ret);
          const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data?.customers || readRes?.data || []) as any[];
          const norm = (v: any) => String(v ?? '').trim().toLowerCase();
          // Prefer scoped rows; if none match due to formatting, fallback to all
          let rows = Array.isArray(rowsRaw)
            ? rowsRaw.filter((r: any) => norm(r?.account_code) === norm(acc) && norm(r?.retail_code) === norm(ret))
            : [];
          if (!rows.length && Array.isArray(rowsRaw)) {
            rows = rowsRaw; // fallback to global view to avoid resetting to 1
          }

          // Try to find an existing customer by phone across common fields
          const phone = sTrim(primaryPhone);
          const onlyDigits = (s: string) => s.replace(/\D+/g, '');
          const existing = rows.find((r: any) => {
            const p = String(r?.phone || r?.phone1 || r?.mobile || r?.customer_phone || r?.mobile_number || "");
            return p && onlyDigits(p) === onlyDigits(phone);
          });
          if (existing) {
            const cid = parseInt(existing.customer_id ?? existing.CUSTOMER_ID ?? "0", 10);
            if (!Number.isNaN(cid) && cid > 0) {
              actualCustomerId = cid;

              // Update existing customer with additional details if provided
              const hasAdditionalDetails = moreDetails.membership_id || moreDetails.birthday_date ||
                moreDetails.anniversary_date || moreDetails.membership_cardno || moreDetails.address;

              if (hasAdditionalDetails) {
                try {
                  const updatePayload: any = {
                    id: existing.id,
                    customer_id: cid,
                    account_code: acc,
                    retail_code: ret,
                    updated_by: user?.username || 'system',
                    ...(moreDetails.membership_id ? { membership_id: String(moreDetails.membership_id).trim() } : {}),
                    ...(moreDetails.birthday_date ? { birthday_date: moreDetails.birthday_date } : {}),
                    ...(moreDetails.anniversary_date ? { anniversary_date: moreDetails.anniversary_date } : {}),
                    ...(moreDetails.membership_cardno ? { membership_cardno: String(moreDetails.membership_cardno).trim() } : {}),
                    ...(moreDetails.address ? { address: String(moreDetails.address).trim() } : {}),
                  };

                  const updateRes: any = await DataService.updateData("master_customer", updatePayload);
                  if (updateRes?.success) {
                    console.log('Customer additional details updated successfully');
                  } else {
                    console.warn('Failed to update customer additional details:', updateRes);
                  }
                } catch (updateErr) {
                  console.warn('Error updating customer additional details:', updateErr);
                }
              }
            }
          }

          // If not found, allocate next numeric customer_id and create the master_customer record
          if (!actualCustomerId) {
            let nextCustomerId = 1;
            if (Array.isArray(rows) && rows.length > 0) {
              const numericCustomerIds = rows
                .map((c: any) => parseInt((c?.customer_id ?? c?.CUSTOMER_ID ?? c?.CustomerId ?? c?.customerID ?? "0") as any, 10))
                .filter((id: number) => Number.isFinite(id) && id > 0);
              const maxCustomerId = numericCustomerIds.length ? Math.max(...numericCustomerIds) : 0;
              nextCustomerId = maxCustomerId + 1;
              // Guard against rare collision
              while (rows.some((c: any) => parseInt((c?.customer_id ?? c?.CUSTOMER_ID ?? c?.CustomerId ?? c?.customerID ?? "-1") as any, 10) === nextCustomerId)) {
                nextCustomerId++;
              }
            }

            // Store full word (Male/Female/Other) per request; fallback to initial on truncation error.
            const normalizedGender = (newInvoice.customerGender || '').trim().toLowerCase();
            const genderFull = (() => {
              if (normalizedGender === 'male' || normalizedGender === 'm') return 'Male';
              if (normalizedGender === 'female' || normalizedGender === 'f') return 'Female';
              if (normalizedGender === 'other' || normalizedGender === 'o') return 'Other';
              return undefined;
            })();

            const customerPayload: any = {
              customer_id: nextCustomerId,
              customer_name: sTrim(newInvoice.customerName),
              // Save under multiple common phone field names for compatibility
              phone: phone,
              phone1: phone,
              mobile_number: phone,
              account_code: acc,
              retail_code: ret,
              ...(genderFull ? { gender: genderFull.slice(0, 18) } : {}),
              // Additional customer details from the modal
              ...(moreDetails.membership_id ? { membership_id: String(moreDetails.membership_id).trim() } : {}),
              ...(moreDetails.birthday_date ? { birthday_date: moreDetails.birthday_date } : {}),
              ...(moreDetails.anniversary_date ? { anniversary_date: moreDetails.anniversary_date } : {}),
              ...(moreDetails.membership_cardno ? { membership_cardno: String(moreDetails.membership_cardno).trim() } : {}),
              ...(moreDetails.address ? { address: String(moreDetails.address).trim() } : {}),
              // Physical stats
              age: parseInt(String(customers[0]?.customerAge || '0'), 10) || undefined,
              height_cm: parseFloat(String(customers[0]?.customerHeight || '0')) || undefined,
              weight_kg: parseFloat(String(customers[0]?.customerWeight || '0')) || undefined,
              // Set default values for required fields
              visitcnt: 0,
              outstandingamt: 0,
              created_by: user?.username || 'system',
              updated_by: user?.username || 'system',
            };
            const createRes: any = await DataService.createData("master_customer", { ...customerPayload, status: 1 }, null, acc, ret);
            if (createRes?.success) {
              actualCustomerId = nextCustomerId;
              // Optional: update local selectedCustomer for UI consistency
              setSelectedCustomer({
                id: String(nextCustomerId),
                name: sTrim(primaryName),
                email: "",
                phone,
                totalVisits: 0,
                lastVisit: "",
                visitCount: 0,
                customerCredit: 0
              });
            } else {
              // Fallback to 0 so backend can still handle, though it may repeat 1
              actualCustomerId = 0;
            }
          }
        } catch (custErr) {
          console.warn("Customer lookup/create failed, proceeding with customer_id=0", custErr);
          actualCustomerId = 0;
        }
      }

      // Split discount into membership (percentage) vs regular (amount) as per requirement
      const membershipPercent = (applyMembershipDiscountToggle && customerMembership)
        ? Number(customerMembership.discount_percent || 0)
        : 0;
      const hasMembership = membershipPercent > 0;
      let regularDiscountAmountOverall = 0;
      let membershipDiscountAmountOverall = 0;

      // Membership discount should apply ONLY to service lines (exclude packages/products)
      const valid = newInvoice.services.filter(s => s.name && s.price > 0);
      const grosses = valid.map(s => s.price * s.quantity);
      const eligibleFlags = valid.map(s => {
        const sid = String((s as any).service_id || '');
        return !(sid.startsWith('pkg:') || sid.startsWith('inv:'));
      });
      // Recalculate subtotal based on valid items only
      const grossSum = valid.reduce((a, b) => a + (b.price * b.quantity), 0);
      const grossSumServices = valid.reduce((sum, s, idx) => sum + (eligibleFlags[idx] ? s.price * s.quantity : 0), 0);
      const subtotalLocal = grossSum;

      if (newInvoice.discountType === 'percentage') {
        const enteredPercent = Number(newInvoice.discount || 0); // user-entered extra/regular percent
        const additionalPercent = hasMembership ? Math.max(0, enteredPercent - membershipPercent) : enteredPercent;
        regularDiscountAmountOverall = Number(((subtotalLocal * additionalPercent) / 100).toFixed(2));
        membershipDiscountAmountOverall = hasMembership ? Number(((grossSumServices * membershipPercent) / 100).toFixed(2)) : 0;
      } else {
        // Total discount represented by textbox
        const enteredAmountTotal = Math.min(Number(newInvoice.discount || 0) || 0, subtotalLocal);
        membershipDiscountAmountOverall = hasMembership ? Number(((grossSumServices * membershipPercent) / 100).toFixed(2)) : 0;
        regularDiscountAmountOverall = Math.max(0, enteredAmountTotal - membershipDiscountAmountOverall);
      }

      // Proportionally allocate both discounts across all valid lines to keep tax base accurate
      const alloc = (total: number) => {
        if (!grossSum || total <= 0) return grosses.map(() => 0);
        const out = grosses.map(g => Number(((g / grossSum) * total).toFixed(2)));
        const diff = Number((total - out.reduce((a, b) => a + b, 0)).toFixed(2));
        if (out.length) out[out.length - 1] = Number((out[out.length - 1] + diff).toFixed(2));
        return out;
      };
      const allocEligible = (total: number, eligible: boolean[]) => {
        if (!total || total <= 0) return grosses.map(() => 0);
        const eligibleSum = grosses.reduce((sum, g, idx) => sum + (eligible[idx] ? g : 0), 0);
        if (!eligibleSum) return grosses.map(() => 0);
        const out = grosses.map((g, idx) => Number((((eligible[idx] ? g : 0) / eligibleSum) * total).toFixed(2)));
        const diff = Number((total - out.reduce((a, b) => a + b, 0)).toFixed(2));
        if (out.length) out[out.length - 1] = Number((out[out.length - 1] + diff).toFixed(2));
        return out;
      };
      const regAlloc = alloc(regularDiscountAmountOverall);
      const memAlloc = allocEligible(membershipDiscountAmountOverall, eligibleFlags);

      const lines = valid.map((s, idx) => (() => {
        const lineGross = s.price * s.quantity;
        const vi = idx; // Using the same array, so index matches directly
        const regDisc = vi >= 0 ? (regAlloc[vi] || 0) : 0;
        const memDisc = vi >= 0 ? (memAlloc[vi] || 0) : 0;
        const appliedDiscountForTax = regDisc + memDisc;
        const lineTaxable = Math.max(lineGross - appliedDiscountForTax, 0);
        let cRate = 0, sRate = 0, iRate = 0;
        if (s.taxId) {
          const tx = masterTaxes.find(t => String(t.tax_id) === String(s.taxId) || String(t.id) === String(s.taxId));
          if (tx) { cRate = Number(tx.cgst) || 0; sRate = Number(tx.sgst) || 0; iRate = Number(tx.igst) || 0; }
        }
        if ((cRate + sRate + iRate) === 0 && s.taxRate !== 0) { // fallback split, but respect explicit 0% tax
          const combined = (s.taxRate != null ? s.taxRate : newInvoice.tax) || 0;
          cRate = combined / 2; sRate = combined / 2; iRate = 0;
        }
        // Default: compute by rates; If locked to appointment summary, we'll override after allocation below
        // Apply tax exemption if toggle is enabled
        // Section-specific exemptions
        const sidStr = String((s as any).service_id || '');
        const sectionExempt = (sidStr.startsWith('inv:') && productsTaxExempted) || (sidStr.startsWith('pkg:') && packagesTaxExempted);
        const exemptAll = taxExempted || sectionExempt;
        let total_cgst = exemptAll ? 0 : Number(((lineTaxable * cRate) / 100).toFixed(2));
        let total_sgst = exemptAll ? 0 : Number(((lineTaxable * sRate) / 100).toFixed(2));
        let total_igst = exemptAll ? 0 : Number(((lineTaxable * iRate) / 100).toFixed(2));
        let tax_amount = Number((total_cgst + total_sgst + total_igst).toFixed(2));
        const grand_total = Number((lineTaxable + tax_amount).toFixed(2));
        return {
          service_name: s.name,
          service_id: (s as any).service_id,
          qty: s.quantity,
          base_price: s.basePrice ?? s.price,
          unit_price: s.price,
          tax_id: s.taxId,
          tax_rate_percent: exemptAll ? 0 : (s.taxRate != null ? s.taxRate : (cRate + sRate + iRate)),
          cgst_rate_percent: exemptAll ? 0 : cRate,
          sgst_rate_percent: exemptAll ? 0 : sRate,
          igst_rate_percent: exemptAll ? 0 : iRate,
          // Store discounts proportionally per line
          discount_amount: Number((appliedDiscountForTax).toFixed(2)),
          // Provide explicit tax and totals so backend doesn't recompute without membership
          taxable_amount: lineTaxable,
          total_cgst,
          total_sgst,
          total_igst,
          tax_amount,
          grand_total,
        };
      })());

      // If lock is on and we have appointment tax summary, reallocate totals proportionally to lines
      if (lockToApptTax && apptTaxSummary && lines.length > 0) {
        const sumTaxable = lines.reduce((s, l) => s + Number(l.taxable_amount || 0), 0);
        if (sumTaxable > 0) {
          const alloc = (total: number) => {
            const raw = lines.map(l => Number((((l.taxable_amount || 0) / sumTaxable) * (total || 0)).toFixed(2)));
            const diff = Number(((total || 0) - raw.reduce((a, b) => a + b, 0)).toFixed(2));
            if (raw.length) raw[raw.length - 1] = Number((raw[raw.length - 1] + diff).toFixed(2));
            return raw;
          };
          const cgAlloc = alloc(apptTaxSummary.cgst || 0);
          const sgAlloc = alloc(apptTaxSummary.sgst || 0);
          // Override line amounts (but respect tax exemption)
          lines.forEach((l, i) => {
            l.total_cgst = taxExempted ? 0 : Number((cgAlloc[i] || 0).toFixed(2));
            l.total_sgst = taxExempted ? 0 : Number((sgAlloc[i] || 0).toFixed(2));
            l.total_igst = 0;
            l.tax_amount = Number(((l.total_cgst + l.total_sgst + l.total_igst)).toFixed(2));
            l.grand_total = Number(((l.taxable_amount || 0) + l.tax_amount).toFixed(2));
          });
        }
      }
      if (!lines.length) return;

      // Use existing invoice ID for updates, generate new one for creates
      const invoiceId = isEditMode && editId ? editId : `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      // Only SERVICES should go into payload.lines (exclude packages and products)
      const serviceOnlyLines = lines.filter(l => {
        const sid = String(l.service_id || '');
        return !(sid.startsWith('pkg:') || sid.startsWith('inv:'));
      });

      const allocate2 = (total: number, parts: number) => {
        const n = Math.max(1, Number(parts || 1));
        const roundedTotal = Number((Number(total || 0)).toFixed(2));
        const base = Number((roundedTotal / n).toFixed(2));
        const arr = Array.from({ length: n }).map(() => base);
        const sum = Number(arr.reduce((a, b) => a + b, 0).toFixed(2));
        const diff = Number((roundedTotal - sum).toFixed(2));
        if (arr.length) arr[arr.length - 1] = Number((arr[arr.length - 1] + diff).toFixed(2));
        return arr;
      };

      const byServiceId = new Map<string, Service>();
      (valid || []).forEach(v => {
        if ((v as any).service_id != null) byServiceId.set(String((v as any).service_id), v);
      });

      // Expand service lines so qty=N becomes N lines (qty=1) with per-unit staff assignment
      const expandedServiceLines = serviceOnlyLines.flatMap((l) => {
        const sid = String(l.service_id || '');
        const svc = byServiceId.get(sid);
        const qty = Math.max(1, Number(l.qty || 1));

        const staffIds: string[] = (() => {
          const assignments = Array.isArray(svc?.staffAssignments) ? svc!.staffAssignments : [];
          const ids = assignments.map(a => String(a?.staffId || '')).filter(Boolean);
          if (ids.length === 0) {
            const fallback = String((svc as any)?.staffId || globalStaffId || '');
            return fallback ? [fallback] : [];
          }
          return ids;
        })();
        while (staffIds.length < qty) staffIds.push(staffIds[0] || '');
        if (staffIds.length > qty) staffIds.length = qty;

        const taxableAlloc = allocate2(Number(l.taxable_amount || 0), qty);
        const cgstAlloc = allocate2(Number(l.total_cgst || 0), qty);
        const sgstAlloc = allocate2(Number(l.total_sgst || 0), qty);
        const igstAlloc = allocate2(Number(l.total_igst || 0), qty);
        const discAlloc = allocate2(Number(l.discount_amount || 0), qty);

        return Array.from({ length: qty }).map((_, idx) => {
          const employee_id = staffIds[idx] || undefined;
          const total_cgst = Number((cgstAlloc[idx] || 0).toFixed(2));
          const total_sgst = Number((sgstAlloc[idx] || 0).toFixed(2));
          const total_igst = Number((igstAlloc[idx] || 0).toFixed(2));
          const taxable_amount = Number((taxableAlloc[idx] || 0).toFixed(2));
          const tax_amount = Number((total_cgst + total_sgst + total_igst).toFixed(2));
          const grand_total = Number((taxable_amount + tax_amount).toFixed(2));

          return {
            service_id: l.service_id,
            service_name: l.service_name,
            qty: 1,
            unit_price: l.unit_price,
            base_price: l.base_price,
            tax_id: l.tax_id || newInvoice.taxId || undefined,
            tax_rate_percent: l.tax_rate_percent,
            cgst_rate_percent: l.cgst_rate_percent,
            sgst_rate_percent: l.sgst_rate_percent,
            igst_rate_percent: l.igst_rate_percent,
            total_cgst,
            total_sgst,
            total_igst,
            taxable_amount,
            tax_amount,
            grand_total,
            discount_amount: Number((discAlloc[idx] || 0).toFixed(2)),
            employee_id,
            employee_name: employee_id ? (employeeMap[String(employee_id)]?.employee_name || undefined) : undefined,
          };
        });
      });
      const payload = {
        // Send services as service_lines (not within lines)
        service_lines: expandedServiceLines,
        // Centralize payment information separately (not inside line objects)
        payment_modes: selectedPaymentModes.map(pm => ({
          payment_mode_id: pm.id,
          payment_mode_name: pm.name,
          amount: pm.amount
        })),
        credit_amount: creditAmount,
        // Add invoice status for hold functionality
        invoice_status: status,
        // payment_method removed as requested

        // Only minimal linkage/audit fields per line (no service details here)
        // IMPORTANT: If there are no service_lines (inventory-only/package-only billing), still send a
        // header line so the backend can capture customer/totals while deriving billable lines.
        lines: (() => {
          const computed = expandedServiceLines.map((l, idx) => {
            const staffId = (l as any).employee_id as any;
            return {
              account_code: acc,
              retail_code: ret,
              invoice_id: invoiceId,
              line_number: idx + 1, // Add unique line number for each service
              line_id: `${invoiceId}-${idx + 1}`, // Unique identifier for this line
              employee_id: staffId || undefined,
              employee_name: staffId ? (employeeMap[String(staffId)]?.employee_name || undefined) : undefined,
              employee_level: staffId ? (employeeMap[String(staffId)]?.skill_level || undefined) : undefined,
              employee_percent: staffId ? (employeeMap[String(staffId)]?.price_markup_percent || undefined) : undefined,
              // Customer reference: use the actual customer ID (either existing or newly created)
              customer_id: actualCustomerId || 0,
              // Customer details only on first line (header usage) — pull from primary row
              customer_name: idx === 0 ? (primaryName || selectedCustomer?.name || undefined) : undefined,
              // Provide canonical phone key the backend reads for header upsert
              customer_number: idx === 0 ? (primaryPhone || selectedCustomer?.phone || undefined) : undefined,
              // Also send common variants for compatibility
              customer_mobile: idx === 0 ? (primaryPhone || selectedCustomer?.phone || undefined) : undefined,
              customer_phone: idx === 0 ? (primaryPhone || selectedCustomer?.phone || undefined) : undefined,
              // Include gender on first line for master_customer upsert
              customer_gender: idx === 0 ? (newInvoice.customerGender || undefined) : undefined,
              // Additional notes stored on billing_transactions header
              additional_notes: idx === 0 ? (String(newInvoice.notes || '').trim() || undefined) : undefined,
              // Flag to indicate if this transaction originated from an appointment
              from_appointment: fromAppt ? 1 : 0,
              // Physical stats on header line
              age: idx === 0 ? (parseInt(String(customers[0]?.customerAge || '0'), 10) || undefined) : undefined,
              height_cm: idx === 0 ? (parseFloat(String(customers[0]?.customerHeight || '0')) || undefined) : undefined,
              weight_kg: idx === 0 ? (parseFloat(String(customers[0]?.customerWeight || '0')) || undefined) : undefined,
              // Audit fields
              created_by: user?.username || 'system',
              updated_by: user?.username || 'system',
            };
          });

          if (computed.length > 0) return computed;

          const staffId = (globalStaffId || '') as any;
          return [{
            account_code: acc,
            retail_code: ret,
            invoice_id: invoiceId,
            line_number: 1,
            line_id: `${invoiceId}-1`,
            employee_id: staffId || undefined,
            employee_name: staffId ? (employeeMap[String(staffId)]?.employee_name || undefined) : undefined,
            employee_level: staffId ? (employeeMap[String(staffId)]?.skill_level || undefined) : undefined,
            employee_percent: staffId ? (employeeMap[String(staffId)]?.price_markup_percent || undefined) : undefined,
            customer_id: actualCustomerId || 0,
            customer_name: (primaryName || selectedCustomer?.name || undefined),
            customer_number: (primaryPhone || selectedCustomer?.phone || undefined),
            customer_mobile: (primaryPhone || selectedCustomer?.phone || undefined),
            customer_phone: (primaryPhone || selectedCustomer?.phone || undefined),
            customer_gender: (newInvoice.customerGender || undefined),
            additional_notes: (String(newInvoice.notes || '').trim() || undefined),
            // Physical stats on header row (for single-line/header fallback)
            age: parseInt(String(customers[0]?.customerAge || '0'), 10) || undefined,
            height_cm: parseFloat(String(customers[0]?.customerHeight || '0')) || undefined,
            weight_kg: parseFloat(String(customers[0]?.customerWeight || '0')) || undefined,
            from_appointment: fromAppt ? 1 : 0,
            created_by: user?.username || 'system',
            updated_by: user?.username || 'system',
          }];
        })(),
      };

      // Build package and inventory lines for dedicated tables (backend optional)
      try {

        const bySid = new Map<string, Service>();
        valid.forEach(v => { if (v.service_id) bySid.set(String(v.service_id), v); });
        const package_lines = lines
          .map((l) => ({ line: l, sid: String(l.service_id || '') }))
          .filter((x) => {
            const isPackage = x.sid.startsWith('pkg:');

            return isPackage;
          })
          .flatMap(({ line, sid }) => {
            const pkgId = sid.split(':', 2)[1] || '';
            const svc = bySid.get(String(line.service_id));
            const qty = Math.max(1, Number(line.qty || 1));

            const staffIds: string[] = (() => {
              const assignments = Array.isArray(svc?.staffAssignments) ? svc!.staffAssignments : [];
              const ids = assignments.map(a => String(a?.staffId || '')).filter(Boolean);
              if (ids.length === 0) {
                const fallback = String((svc as any)?.staffId || globalStaffId || '');
                return fallback ? [fallback] : [];
              }
              return ids;
            })();
            while (staffIds.length < qty) staffIds.push(staffIds[0] || '');
            if (staffIds.length > qty) staffIds.length = qty;

            const cgstAlloc = allocate2(Number(line.total_cgst ?? 0), qty);
            const sgstAlloc = allocate2(Number(line.total_sgst ?? 0), qty);
            const igstAlloc = allocate2(Number(line.total_igst ?? 0), qty);
            const discAlloc = allocate2(Number(line.discount_amount ?? 0), qty);
            const grandAlloc = allocate2(Number(line.grand_total ?? 0), qty);
            const taxAlloc = allocate2(Number(line.tax_amount ?? 0), qty);

            return Array.from({ length: qty }).map((_, idx) => {
              const staffId = staffIds[idx] || '';
              const staffName = staffId ? (employeeMap[staffId]?.employee_name || '') : '';
              return {
                account_code: acc,
                retail_code: ret,
                invoice_id: invoiceId,
                package_id: String(pkgId),
                package_name: String(line.service_name || ''),
                qty: 1,
                unit_price: Number(line.unit_price || 0),
                tax_id: line.tax_id || newInvoice.taxId || '0',
                tax_rate_percent: line.tax_rate_percent ?? 0,
                total_cgst: Number((cgstAlloc[idx] ?? 0).toFixed(2)),
                total_sgst: Number((sgstAlloc[idx] ?? 0).toFixed(2)),
                total_igst: Number((igstAlloc[idx] ?? 0).toFixed(2)),
                total_vat: 0,
                tax_amount: Number((taxAlloc[idx] ?? 0).toFixed(2)),
                discount_amount: Number((discAlloc[idx] ?? 0).toFixed(2)),
                grand_total: Number((grandAlloc[idx] ?? 0).toFixed(2)),
                employee_id: staffId || undefined,
                employee_name: staffName || undefined,
                created_by: user?.username || 'system',
                updated_by: user?.username || 'system',
              };
            });
          });



        // Build inventory_lines robustly from both transformed lines and raw selected services
        let inventory_lines = lines
          .map((l) => ({ line: l, sid: String(l.service_id || ''), service: l.service_id ? bySid.get(String(l.service_id)) : undefined }))
          .filter((x) => {
            const isInventory = x.sid.startsWith('inv:');

            return isInventory;
          })
          .map(({ line, sid, service }) => {
            const productBusinessId = service?.productBusinessId || sid.split(':', 2)[1] || '';
            // Resolve staff for this product from the originating service or global selection
            const staffId = (service?.staffId || globalStaffId || '') as string;
            const staffName = staffId ? (employeeMap[staffId]?.employee_name || '') : '';

            return {
              account_code: acc,
              retail_code: ret,
              invoice_id: invoiceId,
              product_id: String(productBusinessId),
              // Ensure product_name is always populated from available sources
              product_name: String(
                (service && (service as any).name) ||
                line.service_name ||
                (service && (service as any).item_name) ||
                ''
              ),
              barcode: service?.barcode ?? null,
              brand: service?.brand ?? null,
              qty: Number(line.qty || 1),
              unit_price: Number(line.unit_price || 0),
              tax_id: line.tax_id || newInvoice.taxId || undefined,
              tax_rate_percent: line.tax_rate_percent ?? 0,
              total_cgst: line.total_cgst ?? 0,
              total_sgst: line.total_sgst ?? 0,
              total_igst: line.total_igst ?? 0,
              total_vat: 0,
              tax_amount: line.tax_amount ?? 0,
              discount_amount: line.discount_amount ?? 0,
              grand_total: line.grand_total ?? 0,
              employee_id: staffId || undefined,
              employee_name: staffName || undefined,
              created_by: user?.username || 'system',
              updated_by: user?.username || 'system',
            };
          });

        // Fallback: if no inventory_lines were produced, derive directly from selected services
        if (!inventory_lines.length) {

          const selectedServices = (newInvoice?.services || []).filter(s => String(s.service_id || '').startsWith('inv:'));
          inventory_lines = selectedServices.map(s => {
            const sid = String(s.service_id || '');
            const productBusinessId = sid.split(':', 2)[1] || '';
            const svc = bySid.get(sid);
            const staffId = (svc?.staffId || globalStaffId || '') as string;
            const staffName = staffId ? (employeeMap[staffId]?.employee_name || '') : '';
            return {
              account_code: acc,
              retail_code: ret,
              invoice_id: invoiceId,
              product_id: String(productBusinessId),
              product_name: String(s.name || ''),
              barcode: svc?.barcode ?? null,
              brand: svc?.brand ?? null,
              qty: Number(s.quantity || 1),
              unit_price: Number(s.price || 0),
              tax_id: s.taxId || newInvoice.taxId || undefined,
              tax_rate_percent: s.taxRate ?? 0,
              total_cgst: 0,
              total_sgst: 0,
              total_igst: 0,
              total_vat: 0,
              tax_amount: 0,
              discount_amount: 0,
              grand_total: Number((Number(s.price || 0) * Number(s.quantity || 1)).toFixed(2)),
              employee_id: staffId || undefined,
              employee_name: staffName || undefined,
              created_by: user?.username || 'system',
              updated_by: user?.username || 'system',
            };
          });
        }

        // Build customer_lines from the multi-customer rows
        const normalizeCustId = (val: any): any => {
          const s = String(val ?? '').trim();
          if (!s) return 0;
          const n = parseInt(s, 10);
          return Number.isFinite(n) ? n : s; // keep string ids if used in DB
        };

        const customer_lines = (customers || [])
          .filter(c => (String(c.customerName || '').trim() || String(c.customerPhone || '').trim()))
          .map((c, idx) => ({
            account_code: acc,
            retail_code: ret,
            invoice_id: invoiceId,
            row_index: idx,
            // Always include a customer_id: prefer row's customerId, then first row's resolved id, else 0
            customer_id: normalizeCustId(c.customerId || (idx === 0 ? actualCustomerId : undefined) || c.customer || 0),
            customer_name: String(c.customerName || '').trim() || undefined,
            customer_number: String(c.customerPhone || '').trim() || undefined,
            customer_gender: String(c.customerGender || '').trim() || undefined,
            membership_id: String(c.customerMembershipId || '').trim() || undefined,
            birthday_date: c.customerBirthday || undefined,
            anniversary_date: c.customerAnniversary || undefined,
            membership_cardno: String(c.customerMembershipCardNo || '').trim() || undefined,
            address: String(c.customerAddress || '').trim() || undefined,
            visit_count: String(c.visitCount || '').trim() || undefined,
            credit_pending: String(c.creditPending || '').trim() || undefined,
            created_by: user?.username || 'system',
            updated_by: user?.username || 'system',
          }));

        // Always include package_lines so updates remove old rows when empty
        (payload as any).package_lines = package_lines;

        // Always set inventory_lines, even if empty
        (payload as any).inventory_lines = inventory_lines;
        // Include customer_lines for backend processing or future storage
        (payload as any).customer_lines = customer_lines;

        // Do NOT synthesize inventory/package rows into `service_lines`.
        // Backend derives billable service rows from `package_lines` / `inventory_lines` when needed.

        // Populate header totals from UI-computed values to match the displayed summary
        try {
          // UI shows Subtotal before discount but including markup.
          // Send that in `subtotal_amount`, while taxes and grand/rounded reflect post-discount.
          // Recalculate summary totals from valid lines to ensure header consistency
          const taxableAll = lines.reduce((sum, l: any) => sum + (l.taxable_amount || 0), 0);
          const cgstAll = lines.reduce((sum, l: any) => sum + (l.total_cgst || 0), 0);
          const sgstAll = lines.reduce((sum, l: any) => sum + (l.total_sgst || 0), 0);
          const igstAll = lines.reduce((sum, l: any) => sum + (l.total_igst || 0), 0);
          const taxAll = lines.reduce((sum, l: any) => sum + (l.tax_amount || 0), 0);

          const grandTotalExact = Number((taxableAll + taxAll).toFixed(2));
          const grandTotalRounded = Math.round(grandTotalExact);
          const roundOffLocal = Number((grandTotalRounded - grandTotalExact).toFixed(2));

          if (Array.isArray((payload as any).lines) && (payload as any).lines.length > 0) {
            const header = (payload as any).lines[0];
            header.subtotal_amount = Number(subtotalLocal.toFixed(2));
            header.total_cgst = Number(cgstAll.toFixed(2));
            header.total_sgst = Number(sgstAll.toFixed(2));
            header.total_igst = Number(igstAll.toFixed(2));
            header.tax_amount_total = Number(taxAll.toFixed(2));
            header.grand_total = grandTotalRounded;
            header.round_off = roundOffLocal;

            // Audit and discount info
            header.extra_discount_percent = newInvoice.discountType === 'percentage' ? Number(newInvoice.discount || 0) : 0;
            header.extra_discount_amount = regularDiscountAmountOverall;
            header.membership_discount_total = membershipDiscountAmountOverall;
          }
        } catch (err) {
          console.error("Summary total calculation failed:", err);
        }
      } catch (err) {
        console.error("Payload preparation error:", err);
      }

      // Debug logging for staff assignment verification






      // Validate employee assignment by correlating lines to services array
      const employeesByService = (payload.service_lines || []).map((s, idx) => ({
        service: s.service_name,
        employee: payload.lines?.[idx]?.employee_id,
        hasEmployee: !!payload.lines?.[idx]?.employee_id
      }));


      // Validate that each line has unique employee_id where expected
      const linesWithEmployees = payload.lines.filter(l => l.employee_id);


      const resp = isEditMode && editId
        ? await InvoiceService.update(editId, payload as any)
        : await InvoiceService.create(payload as any);

      // Optional: show WhatsApp status if backend attempted sending
      try {
        const wa = (resp as any)?.whatsapp;
        if (wa?.attempted) {
          if (wa?.sent) {
            toast({
              title: "WhatsApp Sent",
              description: "Invoice message sent on WhatsApp.",
              variant: "default",
            });
          } else {
            toast({
              title: "WhatsApp Not Sent",
              description: wa?.reason || wa?.error || "Could not send WhatsApp message.",
              className: "border-yellow-200 bg-yellow-50 text-yellow-900",
            });
          }
        }
      } catch (_e) {
        // ignore
      }

      // Log the response from backend

      // Removed creation/update response debug log

      // Show success toast based on status
      const actionText = status === 'hold' ? 'held' : (isEditMode ? 'updated' : 'created');
      const statusText = status === 'hold' ? ' (On Hold)' : '';
      toast({
        title: "Success!",
        description: `Invoice ${actionText} successfully for ₹${roundedTotal.toLocaleString()}${statusText}`,
        variant: "default"
      });

      // Prepare invoice data for potential printing
      // Use staff names from services - create service-to-staff mapping for detailed printing


      const staffNames = valid
        .filter(s => s.staffId && s.staffName)
        .map(s => s.staffName)
        .filter((name, index, arr) => arr.indexOf(name) === index); // unique names
      const staffName = staffNames.length > 0 ? staffNames.join(', ') : '';



      const invoiceForPrint = {
        invoiceId,
        customerName: newInvoice.customerName || 'Walk-in Customer',
        customerPhone: newInvoice.customerPhone || '',
        staffName: staffName,
        date: newInvoice.date,
        services: lines.map((l, idx) => ({
          service_name: l.service_name || 'Service',
          qty: l.qty || 1,
          unit_price: Number(l.unit_price || 0),
          total: Number(l.grand_total || 0),
          staff_name: valid[idx]?.staffName || '', // Include staff per service
          staff_id: valid[idx]?.staffId || ''
        })),
        subtotal: Number(subtotal || 0),
        discount: Number((additionalDiscountAmountOverall + membershipDiscountAmountOverall) || 0),
        tax: Number(lines.reduce((sum, l) => sum + (l.tax_amount || 0), 0) || 0),
        total: Number(roundedTotal || 0),
        paymentMethods: selectedPaymentModes.map(pm => ({
          method: pm.name,
          amount: pm.amount
        })),
        creditAmount: creditAmount,
        paymentMethod: selectedPaymentModes[0]?.name || 'cash' // For backward compatibility
      };

      // If this invoice was created from an appointment, mark that appointment as completed
      let shouldNavigateToAppointments = false;
      try {
        if (fromAppt && fromApptId) {
          const paidTotal = Number(roundedTotal.toFixed(2));
          const payModeName = selectedPaymentModes[0]?.name?.toLowerCase() || 'cash';
          // 1) Update appointment financials so list shows as settled
          await AppointmentTransactionService.update(
            fromApptId,
            {
              update_fields: {
                advance_paid: paidTotal,
                balance_due: 0,
                payment_mode: payModeName,
              },
            },
            acc,
            ret
          );
          // 2) Mark appointment status as completed
          await AppointmentTransactionService.updateAppointmentStatus(
            fromApptId,
            'completed',
            acc,
            ret
          );
          shouldNavigateToAppointments = true;
        }
      } catch (postBillErr) {
        console.warn('Post-billing appointment update failed', postBillErr);
        // Continue with print confirmation even if post-update fails
      }

      // Store navigation destination and handle differently for hold vs active invoices
      if (status === 'hold') {
        // For hold invoices, navigate directly to billing list without print confirmation
        toast({
          title: "Invoice Held Successfully",
          description: "The invoice has been saved as draft. You can complete it later from the billing list.",
          variant: "default"
        });
        navigate('/billing');
      } else {
        // For active invoices, show print confirmation
        setInvoiceDataForPrint({ ...invoiceForPrint, navigateToAppointments: shouldNavigateToAppointments });
        setShowPrintConfirmation(true);
      }
    } catch (err) {
      console.error('Failed to save invoice', err);

      // Show error toast instead of alert
      toast({
        title: "Error",
        description: "Failed to save invoice. Please try again.",
        className: "border-yellow-200 bg-yellow-50 text-yellow-900"
      });
    }
  };

  const handleReset = () => {
    // Reset all state
    setNewInvoice({
      customer: "",
      customerName: "",
      customerPhone: "",
      customerGender: "",
      date: formatYMDIST(nowIST()),
      services: [] as Service[],
      discount: "",
      discountType: "percentage" as "percentage" | "fixed",
      tax: 18,
      taxId: "",
      notes: "",
      paymentMethod: "cash" as string,
      paymentModeId: "",
      // Additional customer details
      customerMembershipId: "",
      customerBirthday: "",
      customerAnniversary: "",
      customerMembershipCardNo: "",
      customerAddress: "",
    });
    setSelectedCustomer(null);
    setCustomerMembership(null);
    setTaxExempted(false);
    setSelectedPaymentModes([]);
    setCreditAmount(0);
    setPreviousTotal(0);

    // Reset additional customer details
    setMoreDetails({
      membership_id: '',
      birthday_date: '',
      anniversary_date: '',
      membership_cardno: '',
      address: '',
    });

    // Reset customer suggestions
    setCustomerSuggestions([]);
    setShowCustomerSuggestions(false);
    setCustomerSelectedIndex(-1);

    // Reset service suggestions
    setShowSuggestions(null);
    setSuggestions([]);
    setSelectedSuggestionIndex(-1);

    // Clear all refs
    serviceInputRefs.current = {};
    priceInputRefs.current = {};
    quantityInputRefs.current = {};

    // Reset to single empty row
    setTimeout(() => {
      addService();
    }, 100);
  };

  const handleCancel = () => {
    navigate("/billing");
  };

  const getCustomerInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
  };

  // Thermal printing functions
  const generateEscPosCommands = (invoiceData: any): Uint8Array => {
    const ESC = 0x1B;
    const GS = 0x1D;
    const commands: number[] = [];

    // Initialize printer
    commands.push(ESC, 0x40);

    // Set character size to small and center alignment
    commands.push(ESC, 0x21, 0x00);
    commands.push(ESC, 0x61, 0x01);

    // Header - Company name
    const header = "Techies Magnifier\n";
    commands.push(...Array.from(new TextEncoder().encode(header)));

    // Address lines - center aligned
    const addressLine1 = "No 7, CTH Road, Modern city,\n";
    const addressLine2 = "Parrabilram-600072\n";
    commands.push(...Array.from(new TextEncoder().encode(addressLine1)));
    commands.push(...Array.from(new TextEncoder().encode(addressLine2)));

    // Phone number
    const phoneStr = "Ph: +91 7418529631\n";
    commands.push(...Array.from(new TextEncoder().encode(phoneStr)));

    // Separator line
    commands.push(...Array.from(new TextEncoder().encode("--------------------------------\n")));

    // Invoice and date info - left align
    commands.push(ESC, 0x61, 0x00);
    const invoiceStr = `Invoice: ${invoiceData.invoiceId || 'INV-' + Date.now()}\n`;
    const dateStr = `Time: ${new Date().toLocaleTimeString('en-IN', { hour12: true })}\n`;
    const dateOnlyStr = `Date: ${new Date(invoiceData.date || new Date()).toLocaleDateString('en-IN')}\n`;
    commands.push(...Array.from(new TextEncoder().encode(invoiceStr)));
    commands.push(...Array.from(new TextEncoder().encode(dateOnlyStr)));
    commands.push(...Array.from(new TextEncoder().encode(dateStr)));

    // Customer info
    if (invoiceData.customerName && invoiceData.customerName !== 'Walk-in Customer') {
      const customerStr = `Customer: ${invoiceData.customerName}\n`;
      commands.push(...Array.from(new TextEncoder().encode(customerStr)));
    }
    if (invoiceData.customerPhone) {
      const phoneCustomerStr = `Phone: ${invoiceData.customerPhone}\n`;
      commands.push(...Array.from(new TextEncoder().encode(phoneCustomerStr)));
    }

    // Staff info if available
    if (invoiceData.staffName) {
      const staffStr = `Staff: ${invoiceData.staffName}\n`;
      commands.push(...Array.from(new TextEncoder().encode(staffStr)));
    }

    // Separator line
    commands.push(...Array.from(new TextEncoder().encode("--------------------------------\n")));

    // Service items
    if (invoiceData.services && invoiceData.services.length > 0) {
      invoiceData.services.forEach((service: any) => {
        const serviceName = service.service_name || service.name || 'Service';
        const qty = service.qty || service.quantity || 1;
        const price = service.unit_price || service.price || 0;
        const total = service.total || service.grand_total || (qty * price);

        const serviceLine = `${serviceName}\n`;
        const qtyPriceText = `${qty} x Rs.${Number(price).toFixed(2)}`;
        const totalText = `Rs.${Number(total).toFixed(2)}`;
        const padding = ' '.repeat(Math.max(0, 25 - qtyPriceText.length));
        const qtyPriceLine = `${qtyPriceText}${padding}${totalText}\n`;
        commands.push(...Array.from(new TextEncoder().encode(serviceLine)));
        commands.push(...Array.from(new TextEncoder().encode(qtyPriceLine)));
      });
    }

    // Separator line
    commands.push(...Array.from(new TextEncoder().encode("--------------------------------\n")));

    // Totals
    const subtotal = Number(invoiceData.subtotal || 0);
    const discount = Number(invoiceData.discount || 0);
    const tax = Number(invoiceData.tax || 0);
    const total = Number(invoiceData.total || 0);

    const subtotalStr = `Subtotal:${' '.repeat(Math.max(0, 20 - 'Subtotal:'.length))}Rs.${subtotal.toFixed(2)}\n`;
    commands.push(...Array.from(new TextEncoder().encode(subtotalStr)));

    if (discount > 0) {
      const discountStr = `Discount:${' '.repeat(Math.max(0, 20 - 'Discount:'.length))}-Rs.${discount.toFixed(2)}\n`;
      commands.push(...Array.from(new TextEncoder().encode(discountStr)));
    }

    if (tax > 0) {
      const taxStr = `Tax:${' '.repeat(Math.max(0, 20 - 'Tax:'.length))}Rs.${tax.toFixed(2)}\n`;
      commands.push(...Array.from(new TextEncoder().encode(taxStr)));
    }

    // Bold for total
    commands.push(ESC, 0x21, 0x08);
    const totalStr = `Total:${' '.repeat(Math.max(0, 20 - 'Total:'.length))}Rs.${total.toFixed(2)}\n`;
    commands.push(...Array.from(new TextEncoder().encode(totalStr)));

    // Reset formatting and center align
    commands.push(ESC, 0x21, 0x00);
    commands.push(ESC, 0x61, 0x01);

    commands.push(0x0A);
    const paymentStr = `Payment: ${(invoiceData.paymentMethod || 'cash').toUpperCase()}\n`;
    commands.push(...Array.from(new TextEncoder().encode(paymentStr)));
    commands.push(0x0A);

    const thankYouStr = "Thank you for visiting!\n";
    const visitAgainStr = "Please visit again\n";
    commands.push(...Array.from(new TextEncoder().encode(thankYouStr)));
    commands.push(...Array.from(new TextEncoder().encode(visitAgainStr)));

    // Separator line
    commands.push(...Array.from(new TextEncoder().encode("--------------------------------\n")));

    // Powered by - small text
    commands.push(ESC, 0x21, 0x01); // Small font
    const poweredByStr = "Powered by GYM Pro\n";
    commands.push(...Array.from(new TextEncoder().encode(poweredByStr)));

    // Reset formatting
    commands.push(ESC, 0x21, 0x00);
    commands.push(0x0A, 0x0A, 0x0A);

    // Cut paper
    commands.push(GS, 0x56, 0x42, 0x00);

    return new Uint8Array(commands);
  };

  const getPrinterConnection = (): BluetoothDevice | null => {
    try {
      // Try to get from window global state first
      if ((window as any).globalPrinterDevice) {
        const device = (window as any).globalPrinterDevice;
        console.log('Found global printer device:', device.name);
        return device;
      }

      // Fallback to localStorage
      const stored = localStorage.getItem('connectedPrinter');
      if (stored) {
        const printerData = JSON.parse(stored);
        console.log('Found stored printer data:', printerData);
        // Note: We can't reconstruct BluetoothDevice from localStorage
        // User will need to reconnect if not in global state
      }

      return null;
    } catch (error) {
      console.error('Error getting printer connection:', error);
      return null;
    }
  };

  const sendToBluetooth = async (data: Uint8Array): Promise<boolean> => {
    let device: BluetoothDevice | null = null;
    try {
      device = getPrinterConnection();

      if (!device) {
        toast({
          title: "Printer Not Connected",
          description: "Please connect to a thermal printer in Settings first.",
          className: "border-yellow-200 bg-yellow-50 text-yellow-900"
        });
        return false;
      }

      console.log('Connecting to printer:', device.name);

      // Ensure device is connected
      if (!device.gatt?.connected) {
        console.log('Reconnecting to printer...');
        await device.gatt?.connect();
        // Wait a bit for connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      if (!device.gatt?.connected) {
        throw new Error('Failed to connect to printer');
      }

      if (!device.gatt) {
        throw new Error('GATT server not available');
      }

      console.log('Getting printer service...');
      const service = await (device.gatt as any).getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      if (!service) {
        throw new Error('Printer service not found');
      }

      console.log('Getting printer characteristic...');
      const characteristic = await (service as any).getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
      if (!characteristic) {
        throw new Error('Printer characteristic not found');
      }

      console.log('Sending print data in chunks...');
      const chunkSize = 20;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        await characteristic.writeValue(chunk);
        await new Promise(resolve => setTimeout(resolve, 50)); // Small delay between chunks
      }

      console.log('Print data sent successfully!');

      // Keep the connection alive by storing it back to global state
      (window as any).globalPrinterDevice = device;

      return true;
    } catch (error) {
      console.error('Bluetooth print error:', error);

      // Try to reconnect the device to global state if it exists
      if (device) {
        try {
          (window as any).globalPrinterDevice = device;
        } catch (e) {
          console.warn('Failed to restore printer connection:', e);
        }
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      toast({
        title: "Print Failed",
        description: `Failed to print: ${errorMessage}`,
        className: "border-yellow-200 bg-yellow-50 text-yellow-900"
      });
      return false;
    }
  };

  const handlePrintConfirmation = async (shouldPrint: boolean) => {
    try {
      if (shouldPrint && invoiceDataForPrint) {
        console.log('Printing invoice:', invoiceDataForPrint);

        // Validate invoice data before printing
        if (!invoiceDataForPrint.invoiceId) {
          throw new Error('Invalid invoice data: missing invoice ID');
        }

        const escPosData = generateEscPosCommands(invoiceDataForPrint);
        const success = await sendToBluetooth(escPosData);

        if (success) {
          toast({
            title: "Print Successful",
            description: "Invoice printed successfully!",
            variant: "default"
          });
        }
      }
    } catch (error) {
      console.error('Print confirmation error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      toast({
        title: "Print Error",
        description: `Print failed: ${errorMessage}`,
        className: "border-yellow-200 bg-yellow-50 text-yellow-900"
      });
    } finally {
      // Always close dialog and navigate regardless of print success/failure
      const shouldNavigateToAppointments = invoiceDataForPrint?.navigateToAppointments;
      setShowPrintConfirmation(false);
      setInvoiceDataForPrint(null);

      // Navigate to appropriate page
      if (shouldNavigateToAppointments) {
        navigate('/appointments?billed=1');
      } else {
        navigate('/billing');
      }
    }
  };

  // Debug log current form state
  // Removed render state debug log

  return (
    <form autoComplete="off" className="min-h-screen bg-slate-50" onSubmit={handleSubmit}>
      <div className="w-full px-1 lg:px-2">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">

          {/* Left column: Invoice Details */}
          <div className="lg:col-span-3 space-y-4">

            {/* Customer & Date Section */}
            <Card className="border-0 bg-white rounded-none overflow-hidden">
              <CardHeader className="bg-transparent border-b border-slate-200 py-1.5 px-2">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="space-y-0.5">
                      <label className="block text-[9px] font-semibold text-slate-700">Date</label>
                      <Input
                        type="date"
                        value={newInvoice.date}
                        onChange={(e) => setNewInvoice({ ...newInvoice, date: e.target.value })}
                        className="h-7 text-[11px] w-36 sm:w-44 bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                        aria-label="Invoice date"
                      />
                    </div>

                    <div className="space-y-0.5">
                      <label className="block text-[9px] font-semibold text-slate-700">Assign Staff</label>
                      <Popover open={globalStaffOpen} onOpenChange={setGlobalStaffOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-[10px] border border-slate-300 focus:border-blue-500 rounded w-36 sm:w-44 justify-between px-2 font-normal"
                            aria-expanded={globalStaffOpen}
                          >
                            <span className="truncate">
                              {globalStaffId
                                ? (masterEmployees.find((e: any) => String(e.employee_id) === String(globalStaffId))
                                  ?.employee_name || "Assign staff")
                                : "No staff selected"}
                            </span>
                            <ChevronDown className="ml-2 h-4 w-4 opacity-60" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                          <Command>
                            <CommandInput placeholder="Search staff..." className="h-9" />
                            <CommandList>
                              <CommandEmpty>No staff found.</CommandEmpty>
                              <CommandGroup>
                                <CommandItem
                                  value="No staff selected"
                                  onSelect={() => {
                                    console.log('🔍 GLOBAL STAFF SELECTION:', { selectedStaffId: 'none' });
                                    setGlobalStaffOpen(false);
                                    setGlobalStaffId("");
                                    // Reset all services to base price and clear staff when no staff selected
                                    setNewInvoice((prev) => ({
                                      ...prev,
                                      services: prev.services.map((s) => {
                                        const base = s.basePrice ?? s.price ?? 0;
                                        return {
                                          ...s,
                                          staffId: '',
                                          staffName: '',
                                          price: Number((base).toFixed(2)),
                                        };
                                      }),
                                    }));
                                  }}
                                >
                                  No staff selected
                                </CommandItem>
                                {masterEmployees.map((employee: any) => (
                                  <CommandItem
                                    key={employee.id}
                                    value={`${employee.employee_name} ${employee.employee_id}`}
                                    onSelect={() => {
                                      const value = String(employee.employee_id);
                                      console.log('🔍 GLOBAL STAFF SELECTION:', { selectedStaffId: value });
                                      setGlobalStaffOpen(false);
                                      setGlobalStaffId(value);
                                      assignGlobalStaffToAllServices(value);
                                    }}
                                  >
                                    <span className="truncate">{employee.employee_name}</span>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    {/* Provider Credits Display */}
                    <div className="hidden sm:block space-y-0.5">
                      <label className="block text-[9px] font-semibold text-slate-700">WhatsApp Credits</label>
                      <div
                        className="h-7 w-36 sm:w-44 flex items-center justify-between bg-white px-2 rounded border border-slate-300"
                        title="Available WhatsApp Credits"
                      >
                        <div className="flex items-center gap-2">
                          <SiMeta className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                          <span className="text-[10px] sm:text-[11px] font-medium text-slate-700">WhatsApp:</span>
                        </div>
                        <span
                          className={`text-[10px] sm:text-[11px] font-bold ${(providerCredits || 0) <= 0 ? "text-red-500" : "text-emerald-600"
                            }`}
                        >
                          {providerCredits !== null ? providerCredits.toLocaleString() : "..."}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <label className="block text-[9px] font-semibold text-slate-700">Hold Bills</label>
                      <NotificationBell
                        triggerMode="button"
                        triggerLabel="View Hold Bills"
                        triggerClassName="h-7 w-36 sm:w-44 px-2 text-[10px] sm:text-[11px] border border-slate-300"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-2">
                {/* Multiple Customers Section */}
                <div className="space-y-2">
                  {/* Column Headers */}
                  <div className="grid gap-x-1.5 pb-1" style={{ gridTemplateColumns: '1.6fr 1.2fr 1fr 1fr 1.2fr auto' }}>
                    <div className="text-[10px] font-semibold text-slate-700">Customer Name <span className="text-red-500">*</span></div>
                    <div className="text-[10px] font-semibold text-slate-700">Phone Number <span className="text-red-500">*</span></div>
                    <div className="text-[10px] font-semibold text-slate-700">Gender <span className="text-red-500">*</span></div>
                    <div className="text-[10px] font-semibold text-slate-700">Visit Count</div>
                    <div className="text-[10px] font-semibold text-slate-700">Credit Pending</div>
                    <div className="text-[10px] font-semibold text-slate-700">Action</div>
                  </div>

                  {/* Customer Rows */}
                  {customers.map((customer, index) => (
                    <div
                      key={customer.id}
                      className={`grid gap-1.5 ${index === 0 ? 'border border-slate-300 rounded-md p-1' : ''}`}
                      style={{ gridTemplateColumns: '1.6fr 1.2fr 1fr 1fr 1.2fr auto' }}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1">
                          <div className="relative flex-1 min-w-0">
                            <Input
                              ref={(el) => {
                                if (index === 0) {
                                  customerNameRef.current = el;
                                }
                                if (el) {
                                  customerNameRefs.current[customer.id] = el;
                                  console.log('📝 Name ref set for customer:', customer.id, 'element:', !!el);
                                }
                              }}
                              value={customer.customerName}
                              onChange={(e) => {
                                handleCustomerInputChangeForRow(customer.id, e.target.value);
                              }}
                              onFocus={() => {
                                console.log('📝 Name input focused for customer:', customer.id, 'index:', index);
                                setActiveCustomerRowId(customer.id);
                                // Ensure ref is set before positioning
                                customerNameRefs.current[customer.id] = customerNameRefs.current[customer.id] ||
                                  (index === 0 ? customerNameRef.current : null);
                                // Use requestAnimationFrame to ensure DOM is updated
                                requestAnimationFrame(() => {
                                  updateDropdownPosition('name');
                                });
                              }}
                              onClick={() => {
                                console.log('🖱️ Name input clicked for customer:', customer.id, 'index:', index);
                                setActiveCustomerRowId(customer.id);
                                // Ensure ref is set before positioning
                                customerNameRefs.current[customer.id] = customerNameRefs.current[customer.id] ||
                                  (index === 0 ? customerNameRef.current : null);
                                requestAnimationFrame(() => {
                                  updateDropdownPosition('name');
                                });
                              }}
                              onKeyDown={(e) => {
                                if (index === 0) {
                                  handleCustomerKeyDown(e);
                                } else {
                                  // Handle keyboard navigation for non-first rows
                                  if (showCustomerSuggestions && customerSuggestions.length > 0) {
                                    if (e.key === 'ArrowDown') {
                                      e.preventDefault();
                                      setCustomerSelectedIndex(prev =>
                                        prev < customerSuggestions.length - 1 ? prev + 1 : prev
                                      );
                                    } else if (e.key === 'ArrowUp') {
                                      e.preventDefault();
                                      setCustomerSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
                                    } else if (e.key === 'Enter' && customerSelectedIndex >= 0) {
                                      e.preventDefault();
                                      selectCustomer(customerSuggestions[customerSelectedIndex]);
                                    } else if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setShowCustomerSuggestions(false);
                                      setCustomerSelectedIndex(-1);
                                    }
                                  }
                                }
                              }}
                              placeholder="Enter customer name..."
                              className={`h-7 py-0.5 rounded text-[10px] focus:ring-0 pr-2 ${invalid.customerName && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'}`}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            className="h-7 w-7 p-0 bg-blue-600 hover:bg-blue-700 text-white"
                            disabled={moreDetailsLoadingCustomerId === customer.id}
                            onClick={async () => {
                              const n = (customer.customerName || '').trim();
                              const p = (customer.customerPhone || '').trim();
                              // Block opening when row is empty
                              if (!n && !p) {
                                toast({
                                  title: "Add Customer First",
                                  description: "Please enter customer name and phone before adding additional details.",
                                  variant: "default",
                                });
                                return;
                              }
                              setMoreDetailsCustomerId(customer.id);

                              // Prefill from row state first (if already loaded)
                              const prefill = {
                                membership_id: resolveMembershipId((customer as any).customerMembershipId || ''),
                                birthday_date: toDateInputValue((customer as any).customerBirthday || ''),
                                anniversary_date: toDateInputValue((customer as any).customerAnniversary || ''),
                                membership_cardno: sTrim((customer as any).customerMembershipCardNo || ''),
                                address: sTrim((customer as any).customerAddress || ''),
                              };
                              setMoreDetails(prefill);

                              // Fetch from backend using phone/name and hydrate row + modal.
                              const isEmpty =
                                !sTrim(prefill.membership_id) &&
                                !sTrim(prefill.birthday_date) &&
                                !sTrim(prefill.anniversary_date) &&
                                !sTrim(prefill.membership_cardno) &&
                                !sTrim(prefill.address);

                              const needsCoreHydration =
                                !sTrim((customer as any).customerGender) ||
                                !sTrim((customer as any).visitCount) ||
                                !sTrim((customer as any).creditPending) ||
                                sTrim((customer as any).visitCount) === '0' ||
                                sTrim((customer as any).creditPending) === '0';

                              const shouldFetch = (isEmpty || needsCoreHydration) && !!user;

                              if (!shouldFetch) {
                                setShowMoreDetails(true);
                                return;
                              }

                              setMoreDetailsLoadingCustomerId(customer.id);

                              try {
                                const acc = (user as any)?.account_code;
                                const ret = (user as any)?.retail_code;
                                const q = sTrim(p) || sTrim(n);
                                if (!q) return;

                                const params = new URLSearchParams({ q, limit: '5' });
                                if (acc) params.append('account_code', acc);
                                if (ret) params.append('retail_code', ret);
                                params.append('include_membership', 'true');

                                const resp = await ApiService.get(`/search-master-customer?${params.toString()}`);
                                const results = (resp as any)?.data?.data || (resp as any)?.data || [];
                                if (!Array.isArray(results) || results.length === 0) return;

                                const best = results.find((r: any) => sTrim(r.phone || r.phone1 || r.mobile) === sTrim(p))
                                  || results.find((r: any) => sTrim(r.customer_name || r.full_name || r.name).toLowerCase() === sTrim(n).toLowerCase())
                                  || results[0];

                                // Hydrate core row fields (gender / visit count / credit pending / ids)
                                const bestId = (best as any).customer_id ?? (best as any).CUSTOMER_ID ?? (best as any).id ?? (best as any)._id ?? '';
                                const bestName = sTrim((best as any).customer_name || (best as any).full_name || (best as any).name || '');
                                const bestPhone = sTrim((best as any).phone || (best as any).phone1 || (best as any).mobile || (best as any).customer_phone || (best as any).mobile_number || '');
                                const bestGender = normalizeGender((best as any).gender ?? (best as any).customer_gender ?? '');
                                const vc = Number((best as any).customer_visitcnt ?? (best as any).total_visits ?? (best as any).totalVisits ?? (best as any).visit_count ?? 0) || 0;
                                const cred = Number((best as any).customer_credit ?? (best as any).credit_pending ?? (best as any).pending_credit ?? (best as any).wallet_balance ?? (best as any).total_balance ?? 0) || 0;

                                if (bestId) {
                                  updateCustomer(customer.id, 'customer', String(bestId));
                                  updateCustomer(customer.id, 'customerId', String(bestId));
                                }
                                if (bestName && !sTrim(n)) updateCustomer(customer.id, 'customerName', bestName);
                                if (bestPhone && !sTrim(p)) updateCustomer(customer.id, 'customerPhone', bestPhone);
                                if (bestGender) updateCustomer(customer.id, 'customerGender', bestGender);
                                updateCustomer(customer.id, 'visitCount', String(vc));
                                updateCustomer(customer.id, 'creditPending', String(cred));

                                const next = {
                                  membership_id: resolveMembershipId((best as any).membership_id || ''),
                                  birthday_date: toDateInputValue((best as any).birthday_date || (best as any).Birthday_date || (best as any).birthday || ''),
                                  anniversary_date: toDateInputValue((best as any).anniversary_date || (best as any).Anniversary_date || (best as any).anniversary || ''),
                                  membership_cardno: sTrim((best as any).membership_cardno || (best as any).membership_cardno || (best as any).card_no || ''),
                                  address: sTrim((best as any).address || (best as any).Address || (best as any).customer_address || ''),
                                };

                                setMoreDetails(prev => ({ ...prev, ...next }));

                                // Also persist into this customer row so reopening works without fetch
                                updateCustomer(customer.id, 'customerMembershipId', next.membership_id);
                                updateCustomer(customer.id, 'customerBirthday', next.birthday_date);
                                updateCustomer(customer.id, 'customerAnniversary', next.anniversary_date);
                                updateCustomer(customer.id, 'customerMembershipCardNo', next.membership_cardno);
                                updateCustomer(customer.id, 'customerAddress', next.address);
                              } catch (e) {
                                console.warn('Failed to prefill additional customer details', e);
                              } finally {
                                // Open the modal only after the fetch attempt completes
                                setMoreDetailsLoadingCustomerId(null);
                                setShowMoreDetails(true);
                              }
                            }}
                            title="Add more customer details"
                          >
                            {moreDetailsLoadingCustomerId === customer.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3 w-3" />
                            )}
                          </Button>
                        </div>
                        {invalid.customerName && index === 0 && (
                          <span className="text-red-500 text-[9px]">Customer name is required</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <Input
                          ref={(el) => {
                            if (index === 0) {
                              customerPhoneRef.current = el;
                            }
                            if (el) {
                              customerPhoneRefs.current[customer.id] = el;
                              console.log('📞 Phone ref set for customer:', customer.id, 'element:', !!el);
                            }
                          }}
                          value={customer.customerPhone}
                          onChange={(e) => {
                            // Allow only 10 digits in phone input
                            const digits10 = String(e.target.value || '').replace(/\D+/g, '').slice(0, 10);
                            handleCustomerPhoneChangeForRow(customer.id, digits10);
                          }}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={10}
                          onFocus={() => {
                            console.log('📞 Phone input focused for customer:', customer.id, 'index:', index);
                            setActiveCustomerRowId(customer.id);
                            // Ensure ref is set before positioning
                            customerPhoneRefs.current[customer.id] = customerPhoneRefs.current[customer.id] ||
                              (index === 0 ? customerPhoneRef.current : null);
                            // Use requestAnimationFrame to ensure DOM is updated
                            requestAnimationFrame(() => {
                              updateDropdownPosition('phone');
                            });
                          }}
                          onClick={() => {
                            console.log('🖱️ Phone input clicked for customer:', customer.id, 'index:', index);
                            setActiveCustomerRowId(customer.id);
                            // Ensure ref is set before positioning
                            customerPhoneRefs.current[customer.id] = customerPhoneRefs.current[customer.id] ||
                              (index === 0 ? customerPhoneRef.current : null);
                            requestAnimationFrame(() => {
                              updateDropdownPosition('phone');
                            });
                          }}
                          onKeyDown={(e) => {
                            if (index === 0) {
                              handleCustomerPhoneKeyDown(e);
                            } else {
                              // Handle keyboard navigation for non-first rows
                              if (showCustomerSuggestions && customerSuggestions.length > 0) {
                                if (e.key === 'ArrowDown') {
                                  e.preventDefault();
                                  setCustomerSelectedIndex(prev =>
                                    prev < customerSuggestions.length - 1 ? prev + 1 : prev
                                  );
                                } else if (e.key === 'ArrowUp') {
                                  e.preventDefault();
                                  setCustomerSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
                                } else if (e.key === 'Enter' && customerSelectedIndex >= 0) {
                                  e.preventDefault();
                                  selectCustomer(customerSuggestions[customerSelectedIndex]);
                                } else if (e.key === 'Escape') {
                                  e.preventDefault();
                                  setShowCustomerSuggestions(false);
                                  setCustomerSelectedIndex(-1);
                                }
                              }
                            }
                          }}
                          placeholder="Enter phone number..."
                          className={`h-7 py-0.5 rounded text-[10px] focus:ring-0 ${invalid.customerPhone && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500 focus:ring-blue-500'}`}
                        />
                        {invalid.customerPhone && index === 0 && (
                          <span className="text-red-500 text-[9px]">Phone number is required</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <Select
                          value={customer.customerGender}
                          onValueChange={(v) => {
                            updateCustomer(customer.id, 'customerGender', v);
                            if (index === 0) {
                              setNewInvoice(prev => ({ ...prev, customerGender: v }));
                              if (v) {
                                setInvalid(prev => (prev.customerGender ? { ...prev, customerGender: false } : prev));
                              }
                            }
                          }}
                        >
                          <SelectTrigger className={`h-7 rounded text-[10px] ${invalid.customerGender && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500'}`}>
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        {invalid.customerGender && index === 0 && (
                          <span className="text-red-500 text-[9px]">Gender is required</span>
                        )}
                      </div>
                      <div className="space-y-0.5">
                        <div className="relative">
                          <Input
                            value={customer.visitCount || '0'}
                            readOnly
                            className="h-7 py-0.5 pr-7 rounded text-[10px] bg-blue-50 border-blue-200 text-blue-800 font-semibold cursor-pointer"
                            onClick={() => {
                              if (customer.customerName && customer.customerPhone) {
                                // For now, use the legacy selectedCustomer for visit history
                                if (index === 0 && selectedCustomer?.id) {
                                  fetchVisitHistory(selectedCustomer.id);
                                  setShowVisitHistory(true);
                                } else {
                                  toast({
                                    title: "Feature Limited",
                                    description: "Visit history is available for the primary customer only",
                                    variant: "default"
                                  });
                                }
                              } else {
                                toast({
                                  title: "No Customer Selected",
                                  description: "Please select a customer to view visit history",
                                  variant: "default"
                                });
                              }
                            }}
                            title="Click to view visit history"
                          />
                          <Eye className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500/70" />
                        </div>
                      </div>
                      <div className="space-y-0.5">
                        <div className="relative">
                          <Input
                            value={`₹${parseFloat(customer.creditPending || '0').toFixed(2)}`}
                            readOnly
                            className={`h-7 py-0.5 pr-7 rounded text-[10px] font-semibold cursor-pointer ${parseFloat(customer.creditPending || '0') > 0
                              ? 'bg-red-50 border-red-200 text-red-800'
                              : 'bg-amber-50 border-amber-200 text-amber-800'
                              }`}
                            onClick={() => {
                              if (customer.customerName && customer.customerPhone) {
                                // For now, use the legacy selectedCustomer for wallet ledger
                                if (index === 0 && selectedCustomer?.id) {
                                  setShowWalletLedger(true);
                                  fetchWalletLedger(Number(selectedCustomer.id));
                                } else {
                                  toast({
                                    title: "Feature Limited",
                                    description: "Wallet ledger is available for the primary customer only",
                                    variant: "default",
                                  });
                                }
                              } else {
                                toast({
                                  title: "No Customer Selected",
                                  description: "Please select a customer to view wallet ledger",
                                  variant: "default",
                                });
                              }
                            }}
                            title="Click to view credit transaction history"
                          />
                          <Eye className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500/70" />
                        </div>
                      </div>
                      {index === 0 ? (
                        <div className="flex items-center justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={addCustomer}
                            disabled={customers.some(c => !String(c.customerName || '').trim() || !String(c.customerPhone || '').trim() || !String(c.customerGender || '').trim())}
                            className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-50 disabled:text-slate-400 disabled:hover:bg-transparent"
                            title={customers.some(c => !String(c.customerName || '').trim() || !String(c.customerPhone || '').trim() || !String(c.customerGender || '').trim()) ? "Fill current rows first" : "Add another customer"}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => removeCustomer(customer.id)}
                            className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            title="Remove customer"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )}

                      {/* Second row for Physical Stats - perfectly aligned under Name & Phone */}
                      <div className="col-span-full grid grid-cols-1 sm:grid-cols-3 gap-x-1.5 mt-2" style={{ gridColumn: '1 / 3' }}>
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-700 px-0.5">Age (years) <span className="text-red-500">*</span></label>
                          <Input
                            type="number"
                            value={customer.customerAge}
                            onChange={(e) => {
                              updateCustomer(customer.id, 'customerAge', e.target.value);
                              if (index === 0) setInvalid(prev => ({ ...prev, customerAge: false }));
                            }}
                            placeholder="Enter age"
                            className={`h-7 py-0.5 rounded text-[10px] focus:ring-0 ${invalid.customerAge && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500'}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-700 px-0.5">Height (cm) <span className="text-red-500">*</span></label>
                          <Input
                            type="number"
                            value={customer.customerHeight}
                            onChange={(e) => {
                              updateCustomer(customer.id, 'customerHeight', e.target.value);
                              if (index === 0) setInvalid(prev => ({ ...prev, customerHeight: false }));
                            }}
                            placeholder="Enter height (cm)"
                            className={`h-7 py-0.5 rounded text-[10px] focus:ring-0 ${invalid.customerHeight && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500'}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-semibold text-slate-700 px-0.5">Weight (kg) <span className="text-red-500">*</span></label>
                          <Input
                            type="number"
                            value={customer.customerWeight}
                            onChange={(e) => {
                              updateCustomer(customer.id, 'customerWeight', e.target.value);
                              if (index === 0) setInvalid(prev => ({ ...prev, customerWeight: false }));
                            }}
                            placeholder="Enter weight (kg)"
                            className={`h-7 py-0.5 rounded text-[10px] focus:ring-0 ${invalid.customerWeight && index === 0 ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-blue-500'}`}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Customer suggestions dropdown is rendered once via a single portal further below */}
              </CardContent>
            </Card>

            {/* TYPE Billing UI */}
            {isTypeBillingUI && (
              <Card className="border border-slate-200 bg-white rounded-lg overflow-hidden shadow-sm">
                <CardHeader className="bg-slate-50 border-b border-slate-200 py-2 px-3">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                      <FileText className="h-4 w-4 text-slate-700 mr-2" />
                      Billing
                    </CardTitle>
                    <div className="ml-auto flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setTaxExempted(!taxExempted)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 ${taxExempted ? 'bg-slate-700' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${taxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                        </button>
                        <Label className="text-xs font-medium text-gray-700">No Tax</Label>
                      </div>

                      {enablePackagesOnBilling && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={togglePackagesTaxExempt}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${packagesTaxExempted ? 'bg-teal-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${packagesTaxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                          <Label className="text-xs font-medium text-gray-700">No Tax (Pkg)</Label>
                        </div>
                      )}

                      {enableInventoryOnBilling && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={toggleProductsTaxExempt}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${productsTaxExempted ? 'bg-orange-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${productsTaxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                          <Label className="text-xs font-medium text-gray-700">No Tax (Inv)</Label>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3">
                  <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-[10px] text-slate-700 bg-slate-50 border-b border-slate-200">
                          <th className="text-left font-semibold px-2 py-2 w-12">Sl.No</th>
                          <th className="text-left font-semibold px-2 py-2">Item Name</th>
                          <th className="text-left font-semibold px-2 py-2 w-32">Type</th>
                          <th className="text-left font-semibold px-2 py-2 w-20">Qty</th>
                          <th className="text-left font-semibold px-2 py-2 w-24">Price</th>
                          <th className="text-left font-semibold px-2 py-2 w-28">Tax</th>
                          <th className="text-left font-semibold px-2 py-2 w-44">Staff</th>
                          <th className="text-left font-semibold px-2 py-2 w-12">&nbsp;</th>
                        </tr>
                      </thead>
                      <tbody>
                        {typeRows.map((row, idx) => {
                          const errors = typeRowErrors[row.id] || {};
                          const isLast = idx === typeRows.length - 1;
                          const isBlank = isTypeRowBlank(row);
                          const canRemove = typeRows.length > 1 && !(isLast && isBlank);
                          const suggestOpen = typeSuggestRowId === row.id;
                          const suggestions = suggestOpen ? activeTypeSuggestions : [];
                          const svcSuggestions = suggestions.filter(s => s.kind === 'service');
                          const pkgSuggestions = suggestions.filter(s => s.kind === 'package');
                          const invSuggestions = suggestions.filter(s => s.kind === 'inventory');
                          const hasSelectedItem = !!tTrim(row.name) && !!tTrim((row as any).service_id);
                          const sidStr = String((row as any).service_id || '');
                          const itemTypeLabel = sidStr
                            ? (sidStr.startsWith('pkg:') ? 'Package' : sidStr.startsWith('inv:') ? 'Inventory' : 'Service')
                            : '';
                          const rowTaxDisplay = computeTypeRowTaxDisplay(row);

                          return (
                            <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/50">
                              <td className="px-2 py-2 align-top">
                                <div className="h-8 flex items-center text-xs text-slate-700">{idx + 1}</div>
                              </td>
                              <td className="px-2 py-2 align-top">
                                <Popover
                                  open={suggestOpen}
                                  onOpenChange={(o) => {
                                    if (o) {
                                      setTypeSuggestRowId(row.id);
                                      setTypeSuggestIndex(-1);
                                    } else if (typeSuggestRowId === row.id) {
                                      setTypeSuggestRowId(null);
                                      setTypeSuggestIndex(-1);
                                    }
                                  }}
                                >
                                  <PopoverTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      role="combobox"
                                      aria-expanded={suggestOpen}
                                      ref={(el) => {
                                        typeItemTriggerRefs.current[row.id] = el;
                                      }}
                                      className={`h-8 w-full justify-between text-xs border-slate-300 focus:ring-0 ${errors.item ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                                      title={hasSelectedItem ? row.name : 'Select item'}
                                    >
                                      <span className={`truncate ${hasSelectedItem ? '' : 'text-slate-500'}`}>
                                        {hasSelectedItem ? row.name : 'Select item'}
                                      </span>
                                      <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                                    <Command shouldFilter={false}>
                                      <CommandInput
                                        placeholder="Search item..."
                                        value={row.itemText}
                                        onValueChange={(nextText) => {
                                          updateTypeRow(row.id, (r) => {
                                            const changedFromSelected = tTrim(r.service_id) && nextText !== r.name;
                                            if (changedFromSelected) {
                                              return {
                                                itemText: nextText,
                                                name: '',
                                                service_id: undefined,
                                                description: undefined,
                                                basePrice: undefined,
                                                taxId: undefined,
                                                taxRate: undefined,
                                                price: 0,
                                                quantity: 0,
                                                discount_percentage: 0,
                                                staffId: '',
                                                staffName: '',
                                                staffAssignments: undefined,
                                              };
                                            }
                                            return { itemText: nextText };
                                          });
                                        }}
                                        className="h-8"
                                      />
                                      <CommandList className="max-h-56 overflow-y-auto">
                                        <CommandEmpty>No items found.</CommandEmpty>
                                        {svcSuggestions.length > 0 && (
                                          <CommandGroup heading="Services">
                                            {svcSuggestions.map((s) => (
                                              <CommandItem
                                                key={s.key}
                                                value={`${s.label} ${s.kind}`}
                                                onSelect={() => applyTypeSuggestion(row.id, s)}
                                              >
                                                <div className="flex items-center justify-between w-full gap-2">
                                                  <div className="truncate">{s.label}</div>
                                                  <div className="text-[10px] text-slate-600 shrink-0">₹{Number(s.price || 0).toLocaleString()}</div>
                                                </div>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                        {pkgSuggestions.length > 0 && (
                                          <CommandGroup heading="Packages">
                                            {pkgSuggestions.map((s) => (
                                              <CommandItem
                                                key={s.key}
                                                value={`${s.label} ${s.kind}`}
                                                onSelect={() => applyTypeSuggestion(row.id, s)}
                                              >
                                                <div className="flex items-center justify-between w-full gap-2">
                                                  <div className="truncate">{s.label}</div>
                                                  <div className="text-[10px] text-slate-600 shrink-0">₹{Number(s.price || 0).toLocaleString()}</div>
                                                </div>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                        {invSuggestions.length > 0 && (
                                          <CommandGroup heading="Inventory">
                                            {invSuggestions.map((s) => (
                                              <CommandItem
                                                key={s.key}
                                                value={`${s.label} ${s.kind}`}
                                                onSelect={() => applyTypeSuggestion(row.id, s)}
                                              >
                                                <div className="flex items-center justify-between w-full gap-2">
                                                  <div className="truncate">{s.label}</div>
                                                  <div className="text-[10px] text-slate-600 shrink-0">₹{Number(s.price || 0).toLocaleString()}</div>
                                                </div>
                                              </CommandItem>
                                            ))}
                                          </CommandGroup>
                                        )}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                {errors.item && (
                                  <div className="text-[10px] text-red-600 mt-1">Please select an item</div>
                                )}
                              </td>

                              <td className="px-2 py-2 align-top">
                                <Input
                                  value={itemTypeLabel}
                                  readOnly
                                  tabIndex={-1}
                                  placeholder=""
                                  className="h-8 text-xs bg-slate-50 border-slate-200 text-slate-700 focus:ring-0"
                                />
                              </td>

                              <td className="px-2 py-2 align-top">
                                <Input
                                  type="number"
                                  value={row.quantity || ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const n = v === '' ? 0 : Math.max(0, Number(v));
                                    updateTypeRow(row.id, { quantity: n });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      typePriceRefs.current[row.id]?.focus();
                                      typePriceRefs.current[row.id]?.select?.();
                                    }
                                  }}
                                  ref={(el) => {
                                    typeQtyRefs.current[row.id] = el;
                                  }}
                                  className={`h-8 text-xs border-slate-300 focus:ring-0 ${errors.qty ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                                  min={0}
                                />
                                {errors.qty && (
                                  <div className="text-[10px] text-red-600 mt-1">Qty must be &gt; 0</div>
                                )}
                              </td>

                              <td className="px-2 py-2 align-top">
                                <Input
                                  type="number"
                                  value={row.price || ''}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    const n = v === '' ? 0 : Math.max(0, Number(v));
                                    updateTypeRow(row.id, { price: n, basePrice: undefined });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      // If staff already assigned (e.g., global staff), advance to next row.
                                      if (tTrim(row.staffId)) {
                                        let nextFocusRowId: string | null = null;
                                        setTypeRows(prev => {
                                          const rowIndex = prev.findIndex(r => r.id === row.id);
                                          if (rowIndex < 0) return prev;
                                          const updated = [...prev];
                                          const current = updated[rowIndex];
                                          const isLastRow = rowIndex === updated.length - 1;
                                          if (isLastRow && isTypeRowComplete(current)) {
                                            const newRow = createEmptyTypeRow();
                                            nextFocusRowId = newRow.id;
                                            updated.push(newRow);
                                          } else {
                                            nextFocusRowId = updated[rowIndex + 1]?.id ?? null;
                                          }
                                          return normalizeTypeRows(updated);
                                        });
                                        if (nextFocusRowId) setTypePendingFocusRowId(nextFocusRowId);
                                        return;
                                      }

                                      setTypeStaffOpenRowId(row.id);
                                      requestAnimationFrame(() => {
                                        typeStaffTriggerRefs.current[row.id]?.focus();
                                      });
                                    }
                                  }}
                                  ref={(el) => {
                                    typePriceRefs.current[row.id] = el;
                                  }}
                                  className={`h-8 text-xs border-slate-300 focus:ring-0 ${errors.price ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                                  min={0}
                                  step="0.01"
                                />
                                {errors.price && (
                                  <div className="text-[10px] text-red-600 mt-1">Price must be &gt; 0</div>
                                )}
                              </td>

                              <td className="px-2 py-2 align-top">
                                <Input
                                  value={rowTaxDisplay}
                                  readOnly
                                  tabIndex={-1}
                                  placeholder="0% (0.00)"
                                  className="h-8 text-xs bg-slate-50 border-slate-200 text-slate-700 focus:ring-0"
                                  title="Tax % and amount"
                                />
                              </td>

                              <td className="px-2 py-2 align-top">
                                <Select
                                  value={String(row.staffId || '')}
                                  open={typeStaffOpenRowId === row.id}
                                  onOpenChange={(o) => setTypeStaffOpenRowId(o ? row.id : null)}
                                  onValueChange={(value) => {
                                    let nextFocusRowId: string | null = null;
                                    setTypeRows(prev => {
                                      const rowIndex = prev.findIndex(r => r.id === row.id);
                                      if (rowIndex < 0) return prev;
                                      const current = prev[rowIndex];
                                      const patched = { ...current, ...applyStaffToTypeRow(current, value) } as TypeBillingRow;
                                      const updated = [...prev];
                                      updated[rowIndex] = patched;

                                      // Only add a new row after staff selection on the LAST row
                                      const isLastRow = rowIndex === updated.length - 1;
                                      if (isLastRow && isTypeRowComplete(patched)) {
                                        const newRow = createEmptyTypeRow();
                                        nextFocusRowId = newRow.id;
                                        updated.push(newRow);
                                      } else {
                                        nextFocusRowId = updated[rowIndex + 1]?.id ?? null;
                                      }
                                      return normalizeTypeRows(updated);
                                    });

                                    setTypeStaffOpenRowId(null);

                                    if (nextFocusRowId) setTypePendingFocusRowId(nextFocusRowId);
                                  }}
                                >
                                  <SelectTrigger
                                    ref={(el) => {
                                      // @ts-ignore - underlying trigger is a button element
                                      typeStaffTriggerRefs.current[row.id] = el;
                                    }}
                                    className={`h-8 text-xs border-slate-300 focus:ring-0 ${errors.staff ? 'border-red-500 ring-1 ring-red-500' : ''}`}
                                  >
                                    <SelectValue placeholder="Select staff" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {masterEmployees.map((employee) => (
                                      <SelectItem key={employee.id} value={String(employee.employee_id)}>
                                        {employee.employee_name}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {errors.staff && (
                                  <div className="text-[10px] text-red-600 mt-1">Staff is required</div>
                                )}
                              </td>

                              <td className="py-2 align-top">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeTypeRow(row.id)}
                                  disabled={!canRemove}
                                  className="h-9 w-9 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-40"
                                  title={canRemove ? 'Remove row' : 'Cannot remove'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Services Section */}
            {!isTypeBillingUI && enableServicesOnBilling && (
              <Card className="border-0 bg-white rounded-none overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-violet-50 border-b border-slate-200 py-1.5 px-2">
                  <CardTitle className="text-xs font-semibold text-slate-800">
                    {/* Removed highlighted informational box as requested */}
                    <div className="flex items-center w-full gap-2 flex-nowrap overflow-x-auto">
                      <div className="flex items-center shrink-0">
                        <Scissors className="h-3.5 w-3.5 text-purple-600 mr-1.5" />
                        Services
                      </div>

                      <div className="flex items-center gap-2 ml-auto shrink-0">
                        {/* Gender Filter */}
                        <div className="w-28 shrink-0">
                          <Select
                            value={genderFilter || "__all__"}
                            onValueChange={(value) => setGenderFilter(value === "__all__" ? "" : value)}
                          >
                            <SelectTrigger className="h-8 text-xs border-slate-300 focus:border-purple-400">
                              <SelectValue placeholder="Filter by Gender" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__all__">All Genders</SelectItem>
                              {availableGenders.filter(gender => gender && gender.trim()).map((gender) => (
                                <SelectItem key={gender} value={gender}>
                                  {gender}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="w-40 shrink-0">
                          <Popover open={categoryFilterOpen} onOpenChange={setCategoryFilterOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                role="combobox"
                                aria-expanded={categoryFilterOpen}
                                className="h-8 w-full justify-between text-xs border-slate-300 focus:border-purple-400"
                              >
                                <span className="truncate">
                                  {categoryFilter ? (categoryNameMap[categoryFilter] || categoryFilter) : "All Categories"}
                                </span>
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search category..." className="h-9" />
                                <CommandList>
                                  <CommandEmpty>No categories found.</CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem
                                      value="All Categories"
                                      onSelect={() => {
                                        setCategoryFilter("");
                                        setCategoryFilterOpen(false);
                                      }}
                                    >
                                      All Categories
                                    </CommandItem>
                                    {availableCategories
                                      .filter((category) => category && String(category).trim())
                                      .map((category) => {
                                        const label = categoryNameMap[category] || category;
                                        return (
                                          <CommandItem
                                            key={category}
                                            value={`${label} ${category}`}
                                            onSelect={() => {
                                              setCategoryFilter(String(category));
                                              setCategoryFilterOpen(false);
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
                        </div>

                        {/* Search Bar */}
                        <div className="relative w-48 sm:w-56 md:w-64 shrink-0">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                          <input
                            type="text"
                            value={serviceSearch}
                            onChange={(e) => setUnifiedSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setUnifiedSearch(''); }}
                            placeholder=""
                            className="w-full h-8 pl-7 pr-6 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-0 focus:border-purple-400"
                          />
                          {serviceSearch && (
                            <button
                              type="button"
                              aria-label="Clear search"
                              onClick={() => setUnifiedSearch("")}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-slate-100 text-slate-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowOnlySelected(v => !v)}
                          className={`h-8 px-2 ${showOnlySelected ? 'bg-purple-100 border-purple-300 text-purple-700' : ''}`}
                          title="Show only selected services"
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openMasterCreate('service')}
                          className="h-8 w-8 p-0"
                          title="Create new service"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>

                        {/* Divider and Tax toggle */}
                        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                          <button
                            type="button"
                            onClick={() => setTaxExempted(!taxExempted)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${taxExempted ? 'bg-blue-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${taxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                          <Label className="text-xs font-medium text-gray-700">No Tax</Label>
                          {/* Removed '(No Tax)' label per request */}
                        </div>
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2">
                  {/* Product Selection Grid */}
                  <div className="mb-3">
                    <div
                      className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-[24rem] overflow-y-auto ${invalid.services ? 'ring-2 ring-red-400 rounded p-1' : ''}`}
                      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                    >
                      {filteredServices.map((service) => {
                        const existingService = newInvoice.services.find(s => s.service_id === service.service_id);
                        return (
                          <div
                            key={service.id}
                            onClick={() => {
                              if (serviceGestureConsumedRef.current) return;
                              handleProductSelect(service);
                            }}
                            draggable
                            onDragStart={(e) => {
                              serviceGestureConsumedRef.current = true;
                              serviceDragIdRef.current = service.id;
                              try {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', String(service.id));
                              } catch {
                                // ignore
                              }
                            }}
                            onDragOver={(e) => {
                              // Allow drop
                              e.preventDefault();
                              try {
                                e.dataTransfer.dropEffect = 'move';
                              } catch {
                                // ignore
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const srcIdStr = (() => {
                                try {
                                  return e.dataTransfer.getData('text/plain');
                                } catch {
                                  return '';
                                }
                              })();
                              const srcId = Number(srcIdStr || serviceDragIdRef.current || 0);
                              if (!srcId || srcId === service.id) return;
                              moveServiceBefore(srcId, service.id);
                            }}
                            onDragEnd={() => {
                              serviceDragIdRef.current = null;
                              serviceGestureConsumedRef.current = false;
                            }}
                            onTouchStart={(e) => handleServiceTouchStart(e, service)}
                            onTouchEnd={(e) => handleServiceTouchEnd(e, service)}
                            onTouchCancel={() => { serviceTouchRef.current = null; }}
                            className={`p-1.5 border rounded transition-all cursor-pointer select-none ${existingService
                              ? 'border-purple-400 bg-purple-100 ring-1 ring-purple-200'
                              : 'border-gray-200 hover:border-purple-300'
                              }`}
                            style={{ minHeight: '70px' }}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div
                                className="text-xs font-medium text-gray-900 flex-1 pr-2 whitespace-normal break-words"
                                title={service.service_name}
                              >
                                {service.service_name}
                              </div>

                              {/* Gender Info - Top Right */}
                              <div className="flex-shrink-0">
                                {service.preferred_gender && (
                                  <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${service.preferred_gender === 'Male' ? 'bg-cyan-100 text-cyan-700' :
                                    service.preferred_gender === 'Female' ? 'bg-pink-100 text-pink-700' :
                                      'bg-gray-100 text-gray-700'
                                    }`}>
                                    {service.preferred_gender}
                                  </span>
                                )}
                              </div>
                            </div>

                            {existingService ? (
                              // Selected: show price, qty, and inline staff assignment
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); openPriceEditor(existingService.id, existingService.price ?? service.price); }}
                                    className="inline-flex items-center gap-1 text-sm font-semibold text-purple-600 hover:underline focus:outline-none"
                                    title="Edit price"
                                  >
                                    ₹{(existingService.price ?? service.price)?.toLocaleString?.() || '0'}
                                    <Pencil className="h-3 w-3 opacity-70" />
                                  </button>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const next = Math.max(0, (existingService.quantity || 0) - 1);
                                        if (next === 0) {
                                          removeService(existingService.id);
                                        } else {
                                          updateService(existingService.id, "quantity", next);
                                        }
                                      }}
                                      className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                      aria-label="Decrease"
                                    >
                                      −
                                    </button>
                                    <span className="text-xs font-medium min-w-[1.25rem] text-center">
                                      {existingService.quantity}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); updateService(existingService.id, "quantity", (existingService.quantity || 0) + 1); }}
                                      className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                      aria-label="Increase"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                                <div className="min-w-0">
                                  {(() => {
                                    const qty = Math.max(1, Number(existingService.quantity || 1));
                                    const baseAssignments = Array.isArray(existingService.staffAssignments) && existingService.staffAssignments.length > 0
                                      ? existingService.staffAssignments
                                      : (existingService.staffId ? [{ staffId: existingService.staffId, staffName: existingService.staffName }] : []);

                                    return (
                                      <div className="flex flex-col gap-1">
                                        {Array.from({ length: qty }).map((_, idx) => {
                                          const assignedStaffId = (baseAssignments[idx]?.staffId ?? (idx === 0 ? existingService.staffId : '')) as any;
                                          const isMissing = !assignedStaffId;

                                          return (
                                            <div key={idx} className="flex items-center gap-2 min-w-0">
                                              {qty > 1 && (
                                                <div className="text-[10px] text-slate-600 shrink-0 w-10">Staff {idx + 1}</div>
                                              )}
                                              <div className="min-w-0 flex-1">
                                                <Select
                                                  value={String(assignedStaffId || "")}
                                                  onValueChange={(value) => {
                                                    updateServiceStaff(existingService.id, value, idx);
                                                  }}
                                                >
                                                  <SelectTrigger
                                                    className={`h-7 text-[11px] w-full max-w-full min-w-0 whitespace-nowrap overflow-hidden ${isMissing && invalid.staff ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-purple-400'}`}
                                                  >
                                                    <SelectValue placeholder={qty > 1 ? `Select ${idx + 1}` : "Assign staff"} />
                                                  </SelectTrigger>
                                                  <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)]">
                                                    {masterEmployees.map((employee) => (
                                                      <SelectItem key={employee.id} value={String(employee.employee_id)} className="truncate">
                                                        <div className="truncate">{employee.employee_name}</div>
                                                      </SelectItem>
                                                    ))}
                                                  </SelectContent>
                                                </Select>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  })()}
                                </div>
                                {/* HSN selection removed per request */}
                              </div>
                            ) : (
                              // Not selected: replace "Click to add" with compact qty stepper (no expansion)
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-semibold text-purple-600">
                                  ₹{Number(service.price || 0).toLocaleString()}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    className="h-7 w-7 flex items-center justify-center bg-slate-50 rounded-md text-sm font-bold text-slate-300 cursor-default"
                                    aria-label="Decrease"
                                    tabIndex={-1}
                                  >
                                    −
                                  </button>
                                  <span className="text-xs font-medium min-w-[1.25rem] text-center">0</span>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleProductSelect(service); }}
                                    className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                    aria-label="Increase"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {filteredServices.length === 0 && (
                      <div className="text-xs text-slate-500 px-1 py-2 text-center">
                        {showOnlySelected
                          ? "No selected services to show"
                          : (categoryFilter || genderFilter || serviceSearch)
                            ? "No services match the selected filters"
                            : "No services found"
                        }
                      </div>
                    )}
                  </div>

                  {/* Selected Services section removed per request; inline staff assignment is now inside each selected card above */}

                </CardContent>
              </Card>
            )}

            {/* Packages Section */}
            {!isTypeBillingUI && enablePackagesOnBilling && (
              <Card className="border-0 bg-white rounded-none overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-teal-50 to-cyan-50 border-b border-slate-200 py-1.5 px-2 cursor-pointer" onClick={() => setPackagesOpen(v => !v)}>
                  <CardTitle className="text-xs font-semibold text-slate-800">
                    <div className="flex items-center w-full gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPackagesOpen(v => !v); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setPackagesOpen(v => !v); } }}
                        aria-expanded={packagesOpen}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-teal-100 text-teal-700"
                        title={packagesOpen ? 'Collapse' : 'Expand'}
                      >
                        {packagesOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="flex items-center">
                        <Package className="h-3.5 w-3.5 text-teal-600 mr-1.5" />
                        Packages
                      </div>
                      <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
                        {/* Right-aligned search matching Services style */}
                        <div className="relative w-48 sm:w-56 md:w-64">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                          <input
                            type="text"
                            value={packageSearch}
                            onChange={(e) => setUnifiedSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setUnifiedSearch(''); }}
                            placeholder=""
                            className="w-full h-8 pl-7 pr-6 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-0 focus:border-teal-500"
                          />
                          {packageSearch && (
                            <button
                              type="button"
                              aria-label="Clear search"
                              onClick={() => setUnifiedSearch("")}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-slate-100 text-slate-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {/* Package filter buttons */}
                        {/* Package filter buttons */}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowOnlySelectedPackages(v => !v)}
                          className={`h-8 px-2 ${showOnlySelectedPackages ? 'bg-teal-100 border-teal-300 text-teal-700' : ''}`}
                          title="Show only selected packages"
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openMasterCreate('package')}
                          className="h-8 w-8 p-0"
                          title="Create new package"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        {/* Divider and Packages Tax toggle */}
                        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                          <button
                            type="button"
                            onClick={togglePackagesTaxExempt}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 ${packagesTaxExempted ? 'bg-teal-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${packagesTaxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                          <Label className="text-xs font-medium text-gray-700">No Tax</Label>
                          {/* Removed '(No Tax)' label per request */}
                        </div>
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                {packagesOpen && (
                  <CardContent className="p-2">
                    {/* Package Selection Grid */}
                    <div className="mb-3">
                      <div
                        className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-[24rem] overflow-y-auto`}
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                      >
                        {filteredPackages.map((pkg) => {
                          const existingPackage = newInvoice.services.find(s => String(s.service_id) === `pkg:${String(pkg.package_id)}`);
                          return (
                            <div
                              key={pkg.id}
                              onClick={() => handlePackageSelect(pkg)}
                              className={`p-1.5 border rounded transition-all cursor-pointer select-none ${existingPackage
                                ? 'border-teal-400 bg-teal-100 ring-1 ring-teal-200'
                                : 'border-gray-200 hover:border-teal-300'
                                }`}
                              style={{ minHeight: '70px' }}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div
                                  className="text-xs font-medium text-gray-900 flex-1 pr-2 whitespace-normal break-words"
                                  title={pkg.package_name}
                                >
                                  {pkg.package_name}
                                </div>
                              </div>

                              {existingPackage ? (
                                // Selected: show price, qty, and inline staff assignment
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); openPriceEditor(existingPackage.id, existingPackage.price ?? pkg.package_price); }}
                                      className="inline-flex items-center gap-1 text-sm font-semibold text-teal-600 hover:underline focus:outline-none"
                                      title="Edit price"
                                    >
                                      ₹{(existingPackage.price ?? pkg.package_price)?.toLocaleString?.() || '0'}
                                      <Pencil className="h-3 w-3 opacity-70" />
                                    </button>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const next = Math.max(0, (existingPackage.quantity || 0) - 1);
                                          if (next === 0) {
                                            removeService(existingPackage.id);
                                          } else {
                                            updateService(existingPackage.id, "quantity", next);
                                          }
                                        }}
                                        className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                        aria-label="Decrease"
                                      >
                                        −
                                      </button>
                                      <span className="text-xs font-medium min-w-[1.25rem] text-center">
                                        {existingPackage.quantity}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); updateService(existingPackage.id, "quantity", (existingPackage.quantity || 0) + 1); }}
                                        className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                        aria-label="Increase"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    {(() => {
                                      const qty = Math.max(1, Number(existingPackage.quantity || 1));
                                      const baseAssignments = Array.isArray(existingPackage.staffAssignments) && existingPackage.staffAssignments.length > 0
                                        ? existingPackage.staffAssignments
                                        : (existingPackage.staffId ? [{ staffId: existingPackage.staffId, staffName: existingPackage.staffName }] : []);

                                      return (
                                        <div className="flex flex-col gap-1">
                                          {Array.from({ length: qty }).map((_, idx) => {
                                            const assignedStaffId = (baseAssignments[idx]?.staffId ?? (idx === 0 ? existingPackage.staffId : '')) as any;
                                            const isMissing = !assignedStaffId;

                                            return (
                                              <div key={idx} className="flex items-center gap-2 min-w-0">
                                                {qty > 1 && (
                                                  <div className="text-[10px] text-slate-600 shrink-0 w-10">Staff {idx + 1}</div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                  <Select
                                                    value={String(assignedStaffId || "")}
                                                    onValueChange={(value) => {
                                                      updateServiceStaff(existingPackage.id, value, idx);
                                                    }}
                                                  >
                                                    <SelectTrigger className={`h-7 text-[11px] w-full max-w-full min-w-0 whitespace-nowrap overflow-hidden ${isMissing && invalid.staff ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-teal-400'}`}>
                                                      <SelectValue placeholder={qty > 1 ? `Select ${idx + 1}` : "Assign staff"} />
                                                    </SelectTrigger>
                                                    <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)]">
                                                      {masterEmployees.map((employee) => (
                                                        <SelectItem key={employee.id} value={String(employee.employee_id)} className="truncate">
                                                          <div className="truncate">{employee.employee_name}</div>
                                                        </SelectItem>
                                                      ))}
                                                    </SelectContent>
                                                  </Select>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </div>
                              ) : (
                                // Not selected: replace "Click to add" with compact qty stepper (no expansion)
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-teal-600">
                                    ₹{pkg.package_price?.toLocaleString() || '0'}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="h-7 w-7 flex items-center justify-center bg-slate-50 rounded-md text-sm font-bold text-slate-300 cursor-default"
                                      aria-label="Decrease"
                                      tabIndex={-1}
                                    >
                                      −
                                    </button>
                                    <span className="text-xs font-medium min-w-[1.25rem] text-center">0</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handlePackageSelect(pkg); }}
                                      className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                      aria-label="Increase"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {filteredPackages.length === 0 && (
                        <div className="text-xs text-slate-500 px-1 py-2 text-center">
                          {showOnlySelectedPackages
                            ? "No selected packages to show"
                            : (packageSearch && packageSearch.trim().length > 0)
                              ? "No packages match the search"
                              : "No packages found"
                          }
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Inventory Section */}
            {!isTypeBillingUI && enableInventoryOnBilling && (
              <Card className="border-0 bg-white rounded-none overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 border-b border-slate-200 py-1.5 px-2 cursor-pointer" onClick={() => setProductsOpen(v => !v)}>
                  <CardTitle className="text-xs font-semibold text-slate-800">
                    <div className="flex items-center w-full gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setProductsOpen(v => !v); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setProductsOpen(v => !v); } }}
                        aria-expanded={productsOpen}
                        className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-amber-100 text-amber-700"
                        title={productsOpen ? 'Collapse' : 'Expand'}
                      >
                        {productsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <div className="flex items-center">
                        <ShoppingBag className="h-3.5 w-3.5 text-amber-600 mr-1.5" />
                        Inventory
                      </div>
                      <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="w-40 shrink-0">
                          <Popover open={productCategoryFilterOpen} onOpenChange={setProductCategoryFilterOpen}>
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                role="combobox"
                                aria-expanded={productCategoryFilterOpen}
                                className="h-8 w-full justify-between text-xs border-slate-300 focus:border-amber-400"
                                title="Filter by category"
                              >
                                <span className="truncate">
                                  {productCategoryFilter
                                    ? (categoryNameMap[String(productCategoryFilter)] || String(productCategoryFilter))
                                    : "All Categories"}
                                </span>
                                <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                              <Command>
                                <CommandInput placeholder="Search category..." className="h-9" />
                                <CommandList>
                                  <CommandEmpty>No categories found.</CommandEmpty>
                                  <CommandGroup>
                                    <CommandItem
                                      value="All Categories"
                                      onSelect={() => {
                                        setProductCategoryFilter("");
                                        setProductCategoryFilterOpen(false);
                                      }}
                                    >
                                      All Categories
                                    </CommandItem>
                                    {availableProductCategories.map((category) => {
                                      const label = categoryNameMap[category] || category;
                                      return (
                                        <CommandItem
                                          key={category}
                                          value={`${label} ${category}`}
                                          onSelect={() => {
                                            setProductCategoryFilter(String(category));
                                            setProductCategoryFilterOpen(false);
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
                        </div>

                        {/* Search (after category) */}
                        <div className="relative w-48 sm:w-56 md:w-64">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                          <input
                            type="text"
                            value={productSearch}
                            onChange={(e) => setUnifiedSearch(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setUnifiedSearch(''); }}
                            placeholder=""
                            className="w-full h-8 pl-7 pr-6 text-xs border border-slate-300 rounded-md focus:outline-none focus:ring-0 focus:border-amber-500"
                          />
                          {productSearch && (
                            <button
                              type="button"
                              aria-label="Clear search"
                              onClick={() => setUnifiedSearch("")}
                              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded hover:bg-slate-100 text-slate-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setShowOnlySelectedProducts(v => !v)}
                          className={`h-8 px-2 ${showOnlySelectedProducts ? 'bg-amber-100 border-amber-300 text-amber-700' : ''}`}
                          title="Show only selected inventory"
                        >
                          <ListChecks className="h-4 w-4" />
                        </Button>

                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openMasterCreate('inventory')}
                          className="h-8 w-8 p-0"
                          title="Create new inventory item"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                        <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                          <button
                            type="button"
                            onClick={toggleProductsTaxExempt}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 ${productsTaxExempted ? 'bg-orange-600' : 'bg-gray-300'}`}
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${productsTaxExempted ? 'translate-x-5' : 'translate-x-1'}`} />
                          </button>
                          <Label className="text-xs font-medium text-gray-700">No Tax</Label>
                          {/* Removed '(No Tax)' label per request */}
                        </div>
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                {productsOpen && (
                  <CardContent className="p-2">
                    <div className="mb-3">
                      <div
                        className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5 max-h-[24rem] overflow-y-auto`}
                        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                      >
                        {filteredProducts.map((prod) => {
                          const existing = newInvoice.services.find(s => String(s.service_id) === `inv:${String(prod.id)}`);
                          return (
                            <div
                              key={prod.id}
                              onClick={() => handleInventorySelect(prod)}
                              className={`p-1.5 border rounded transition-all cursor-pointer select-none ${existing ? 'border-amber-400 bg-amber-100 ring-1 ring-amber-200' : 'border-gray-200 hover:border-amber-300'
                                }`}
                              style={{ minHeight: '70px' }}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div className="text-xs font-medium text-gray-900 flex-1 pr-2 whitespace-normal break-words" title={prod.item_name}>
                                  {prod.item_name}
                                </div>
                              </div>

                              {existing ? (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); openPriceEditor(existing.id, existing.price ?? prod.selling_price); }}
                                      className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:underline focus:outline-none"
                                      title="Edit price"
                                    >
                                      ₹{(existing.price ?? prod.selling_price)?.toLocaleString?.() || '0'}
                                      <Pencil className="h-3 w-3 opacity-70" />
                                    </button>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const next = Math.max(0, (existing.quantity || 0) - 1);
                                          if (next === 0) {
                                            removeService(existing.id);
                                          } else {
                                            updateService(existing.id, "quantity", next);
                                          }
                                        }}
                                        className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                        aria-label="Decrease"
                                      >
                                        −
                                      </button>
                                      <span className="text-xs font-medium min-w-[1.25rem] text-center">{existing.quantity}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); updateService(existing.id, "quantity", (existing.quantity || 0) + 1); }}
                                        className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                        aria-label="Increase"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <Select
                                      value={String(existing.staffId || "")}
                                      onValueChange={(value) => { updateServiceStaff(existing.id, value); }}
                                    >
                                      <SelectTrigger className={`h-7 text-[11px] w-full max-w-full min-w-0 whitespace-nowrap overflow-hidden ${!existing.staffId && invalid.staff ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-300 focus:border-amber-400'}`}>
                                        <SelectValue placeholder="Assign staff" />
                                      </SelectTrigger>
                                      <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)]">
                                        {masterEmployees.map((employee) => (
                                          <SelectItem key={employee.id} value={String(employee.employee_id)} className="truncate">
                                            <div className="truncate">{employee.employee_name}</div>
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-semibold text-amber-700">₹{prod.selling_price?.toLocaleString() || '0'}</span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="h-7 w-7 flex items-center justify-center bg-slate-50 rounded-md text-sm font-bold text-slate-300 cursor-default"
                                      aria-label="Decrease"
                                      tabIndex={-1}
                                    >
                                      −
                                    </button>
                                    <span className="text-xs font-medium min-w-[1.25rem] text-center">0</span>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); handleInventorySelect(prod); }}
                                      className="h-7 w-7 flex items-center justify-center bg-slate-100 hover:bg-slate-200 rounded-md text-sm font-bold text-slate-700"
                                      aria-label="Increase"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {filteredProducts.length === 0 && (
                        <div className="text-xs text-slate-500 px-1 py-2 text-center">
                          {showOnlySelectedProducts
                            ? "No selected products to show"
                            : (productSearch && productSearch.trim().length > 0)
                              ? "No products match the search"
                              : "No products found"
                          }
                        </div>
                      )}
                    </div>
                  </CardContent>
                )}
              </Card>
            )}

            {/* Payment Section */}
            {/* <Card className="border-0 bg-white rounded-xl overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <CreditCard className="h-4 w-4 text-emerald-600 mr-2" />
                  Payment & Tax Information
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <div className="space-y-2">
                  <div className="text-sm text-gray-600">
                    <div className="flex justify-between items-center">
                      <span>Payment Method:</span>
                      <span className="font-medium">Select in Invoice Summary →</span>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <div className="flex justify-between items-center">
                      <span>Tax Rate:</span>
                      <span className="font-medium text-green-600">{newInvoice.tax}% (Auto-applied)</span>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 p-2 bg-gray-50 rounded">
                    Tax is automatically calculated based on your business settings. Payment method can be selected in the invoice summary section.
                  </div>
                </div>
              </CardContent>
            </Card> */}

            {/* Notes Section */}
            <Card className="border-0 bg-white rounded-none overflow-hidden">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 border-b border-slate-200 py-2 px-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                  <FileText className="h-4 w-4 text-orange-600 mr-2" />
                  Additional Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <Textarea
                  placeholder="Add notes..."
                  value={newInvoice.notes}
                  onChange={(e) => setNewInvoice({ ...newInvoice, notes: e.target.value })}
                  rows={3}
                  className="resize-none border-slate-300 focus:border-orange-500 focus:ring-orange-500 text-xs rounded-md"
                />
              </CardContent>
            </Card>
          </div>

          {/* Right column: Invoice Summary */}
          <div className="lg:col-span-1">
            <Card className="border-0 bg-white rounded-none overflow-hidden sticky top-6">
              <CardHeader className="bg-gradient-to-r from-emerald-50 to-green-50 border-b border-slate-200 py-2 px-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center">
                    <Calculator className="h-4 w-4 text-green-600 mr-2" />
                    Invoice Summary
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-slate-700 hover:text-slate-900 border border-input"
                    type="button"
                    onClick={() => navigate(-1)}
                    aria-label="Go back"
                  >
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-3">

                {/* Calculation Breakdown */}
                <div className="space-y-2 bg-gray-50/80 p-3 rounded-lg border border-gray-100">
                  {fromAppt && apptTaxSummary && (
                    <div className="flex items-center justify-between text-xs pb-1.5 border-b border-gray-200">
                      <div className="flex items-center gap-2 text-gray-600">
                        <span>Lock tax to appointment</span>
                      </div>
                      <Switch checked={lockToApptTax} onCheckedChange={(c) => setLockToApptTax(!!c)} />
                    </div>
                  )}


                  {/* Collapsible Breakdown Details */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowBreakdown(!showBreakdown)}
                      className="flex items-center justify-between w-full text-xs text-gray-600 hover:text-gray-800 py-1"
                    >
                      <span>View breakdown details</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${showBreakdown ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Membership Information moved below the breakdown header */}
                    {customerMembership && (
                      <div className="bg-purple-50/50 p-1 rounded border border-purple-200 mt-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <div className="h-1.5 w-1.5 bg-purple-600 rounded-full flex-shrink-0"></div>
                            <span className="text-[10px] font-medium text-purple-700">Membership Applied</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-[10px] text-purple-700 font-medium">Apply</span>
                            <Switch
                              checked={applyMembershipDiscountToggle}
                              onCheckedChange={(c) => {
                                const next = !!c;
                                setApplyMembershipDiscountToggle(next);
                              }}
                              className="scale-75"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {showBreakdown && (
                      <div className="space-y-1 mt-1">
                        {/* Subtotal (moved inside breakdown) */}
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">Subtotal:</span>
                          <span className="font-medium text-gray-800">₹{subtotal.toLocaleString()}</span>
                        </div>
                        {membershipDiscountAmountOverall > 0 && (
                          <div className="flex justify-between items-start text-xs">
                            <div className="text-gray-600 flex-1 pr-2">
                              <div>
                                Membership Discount {membershipPercent ? `(${membershipPercent}%)` : ''}
                                {typeof grossSumServices === 'number' && grossSumServices > 0 ? ` on ₹${grossSumServices.toLocaleString()}` : ''}
                              </div>
                              {customerMembership && (
                                <div className="text-purple-600 text-[10px] mt-0.5">• {customerMembership.membership_name}</div>
                              )}
                            </div>
                            <span className="font-medium text-purple-600 flex-shrink-0">
                              -₹{membershipDiscountAmountOverall.toLocaleString()}
                            </span>
                          </div>
                        )}

                        {additionalDiscountAmountOverall > 0 && (
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-600">
                              Additional Discount {newInvoice.discountType === 'percentage' ? `(${additionalPercent}%)` : ''}
                            </span>
                            <span className="font-medium text-red-600">
                              -₹{additionalDiscountAmountOverall.toLocaleString()}
                            </span>
                          </div>
                        )}

                        {/* Tax Section */}
                        <div className="space-y-1 pt-1 border-t border-gray-100">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-600">CGST:</span>
                            <span className="font-medium text-gray-800">₹{cgstTotal.toLocaleString()}</span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-gray-600">SGST:</span>
                            <span className="font-medium text-gray-800">₹{sgstTotal.toLocaleString()}</span>
                          </div>
                          {igstTotal > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-gray-600">IGST:</span>
                              <span className="font-medium text-gray-800">₹{igstTotal.toLocaleString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Round Off */}
                        {roundOff !== 0 && (
                          <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-100">
                            <span className="text-gray-600">Round Off:</span>
                            <span className="font-medium text-gray-700">{roundOff > 0 ? '+' : ''}₹{Math.abs(roundOff).toLocaleString()}</span>
                          </div>
                        )}

                        {/* Net Payable (after round off) */}
                        <div className="flex justify-between items-center text-xs pt-1 border-t border-gray-200">
                          <span className="text-gray-800 font-medium">Net Payable:</span>
                          <span className="font-semibold text-gray-900">₹{roundedTotal.toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Multiple Payment Methods */}
                  <div className="space-y-2">
                    <Label className="text-xs font-medium flex items-center gap-2">
                      <CreditCard className="h-4 w-4 text-green-600" />
                      Payment Methods <span className="text-red-500">*</span>
                    </Label>

                    {/* Add Payment Mode Dropdown */}
                    <Select
                      value=""
                      onValueChange={(value) => {
                        // Check if any services are selected first
                        const hasValidServices = newInvoice.services.some(service => service.name && service.price > 0);
                        if (!hasValidServices) {
                          toast({
                            title: "No Services Selected",
                            description: "Please select at least one service before adding payment methods",
                            variant: "default",
                            className: "border-yellow-200 bg-yellow-50 text-yellow-900"
                          });
                          return;
                        }

                        const selectedPayment = masterPaymentModes.find(p => p.id.toString() === value);
                        if (selectedPayment && !selectedPaymentModes.find(p => p.id === value)) {
                          const currentTotal = selectedPaymentModes.reduce((sum, p) => sum + p.amount, 0);
                          const remainingAmount = Math.max(0, roundedTotal - currentTotal);

                          setSelectedPaymentModes(prev => [...prev, {
                            id: value,
                            name: selectedPayment.payment_mode_name,
                            amount: remainingAmount // Auto-fill with remaining amount
                          }]);
                        }
                      }}
                      disabled={loading}
                    >
                      <SelectTrigger className={`h-8 text-xs border-dashed focus:outline-none focus:ring-0 ${invalid.payment && selectedPaymentModes.length === 0
                        ? 'border-red-500 ring-1 ring-red-500'
                        : newInvoice.services.some(service => service.name && service.price > 0)
                          ? 'border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50 focus:border-emerald-400'
                          : 'border-slate-300 bg-slate-50/50 cursor-not-allowed opacity-60'
                        }`}>
                        <SelectValue placeholder={newInvoice.services.some(service => service.name && service.price > 0) ? "+ Add payment method" : "Select services first"} />
                      </SelectTrigger>
                      <SelectContent>
                        {masterPaymentModes
                          .filter(payment => !selectedPaymentModes.find(p => p.id === payment.id.toString()))
                          .map((payment) => (
                            <SelectItem key={payment.id} value={payment.id.toString()}>
                              <div className="flex items-center gap-2">
                                <CreditCard className="h-3 w-3 text-emerald-600" />
                                {payment.payment_mode_name}
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>

                    {/* Selected Payment Methods */}
                    {selectedPaymentModes.length > 0 && (
                      <div className="space-y-1.5 bg-emerald-50/30 p-2 rounded border border-emerald-200/50">
                        {selectedPaymentModes.map((payMode, index) => {
                          const totalPaid = selectedPaymentModes.reduce((sum, p) => sum + p.amount, 0);
                          const remaining = Math.max(0, roundedTotal - totalPaid);

                          return (
                            <div key={payMode.id} className="flex items-center gap-1.5 bg-white p-1.5 rounded border border-emerald-200">
                              <div className="flex items-center gap-1.5 flex-1">
                                <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full"></div>
                                <span className="text-xs font-medium text-slate-700">{payMode.name}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-slate-500">₹</span>
                                <Input
                                  type="number"
                                  value={payMode.amount || ''}
                                  onChange={(e) => {
                                    const newAmount = parseFloat(e.target.value) || 0;
                                    const maxAllowed = roundedTotal;
                                    const adjustedAmount = Math.min(Math.max(0, newAmount), maxAllowed);

                                    setSelectedPaymentModes(prev => {
                                      // Update the current payment mode
                                      const updated = [...prev];
                                      updated[index] = { ...updated[index], amount: adjustedAmount };

                                      // Calculate remaining amount
                                      const totalPaid = updated.reduce((sum, p) => sum + p.amount, 0);
                                      const remaining = roundedTotal - totalPaid;

                                      // If there's a remaining amount and other payment modes exist,
                                      // adjust the first other payment mode
                                      if (remaining !== 0 && updated.length > 1) {
                                        const otherIndex = index === 0 ? 1 : 0; // Use the other payment mode
                                        if (otherIndex < updated.length) {
                                          const newOtherAmount = Math.max(0, updated[otherIndex].amount + remaining);
                                          updated[otherIndex] = { ...updated[otherIndex], amount: newOtherAmount };
                                        }
                                      }

                                      return updated;
                                    });

                                    // Don't auto-set credit when user is manually adjusting payments
                                    // Let the user control payment distribution
                                  }}
                                  className="no-number-spinner w-24 h-8 text-sm text-right border-slate-300 focus:border-emerald-400 focus:ring-0"
                                  placeholder="0"
                                  min="0"
                                  max={remaining + payMode.amount}
                                  step="0.01"
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 w-5 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                                  onClick={() => {
                                    setSelectedPaymentModes(prev => prev.filter((_, i) => i !== index));
                                    // Don't auto-set credit when user removes payment mode
                                    // Let the useEffect handle it properly
                                  }}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Credit Amount */}
                    <div className="bg-white p-1.5 rounded border border-slate-200">
                      <div className="flex items-center justify-between mb-0.5">
                        <div className="flex items-center gap-1 p-1">
                          <Label className="text-xs font-medium flex items-center gap-1 text-slate-700">
                            <CreditCard className="h-3 w-3 text-slate-500" />
                            Credit Amount
                          </Label>
                        </div>
                        {creditAmount > 0 && (
                          <span className="text-[10px] text-slate-600 bg-slate-100 px-1 py-0.5 rounded-full">Partial Payment</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">₹</span>
                        <Input
                          type="number"
                          value={creditAmount || ''}
                          onChange={(e) => {
                            const newCreditAmount = Number(e.target.value) || 0;
                            const maxCredit = roundedTotal;
                            const adjustedCredit = Math.min(Math.max(0, newCreditAmount), maxCredit);

                            setCreditAmount(adjustedCredit);

                            // Automatically adjust payment modes when credit is entered
                            if (selectedPaymentModes.length > 0) {
                              const remainingForPayments = roundedTotal - adjustedCredit;

                              setSelectedPaymentModes(prev => {
                                if (remainingForPayments <= 0) {
                                  // If credit covers full amount, clear all payment modes
                                  return prev.map(mode => ({ ...mode, amount: 0 }));
                                } else {
                                  // Distribute remaining amount proportionally among payment modes
                                  const currentTotal = prev.reduce((sum, p) => sum + p.amount, 0);
                                  if (currentTotal > 0) {
                                    const ratio = remainingForPayments / currentTotal;
                                    return prev.map(mode => ({
                                      ...mode,
                                      amount: Math.round(mode.amount * ratio * 100) / 100
                                    }));
                                  } else {
                                    // If no current payment amounts, set first payment mode to remaining amount
                                    return prev.map((mode, index) => ({
                                      ...mode,
                                      amount: index === 0 ? remainingForPayments : 0
                                    }));
                                  }
                                }
                              });
                            }
                          }}
                          className={`no-number-spinner flex-1 h-9 text-sm bg-white border-slate-300 focus:border-slate-400 focus:ring-0 ${creditAmount > 0 ? 'text-red-600 font-medium' : ''}`}
                          placeholder="0"
                          min="0"
                          max={roundedTotal}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Discount Controls */}
                  <div className="bg-white p-1.5 rounded border border-slate-200">
                    <div className="flex items-center justify-between mb-0.5">
                      <Label className="text-xs font-medium flex items-center gap-1 text-slate-700">
                        <Calculator className="h-3 w-3 text-slate-500" />
                        {customerMembership && applyMembershipDiscountToggle ? 'Discount' : 'Additional Discount'}
                      </Label>
                      {parseFloat(newInvoice.discount || '0') > 0 && (
                        <span className="text-[10px] text-slate-600 bg-slate-100 px-1 py-0.5 rounded-full">
                          {newInvoice.discountType === 'percentage' ? 'Percentage' : 'Fixed Amount'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={
                          (applyMembershipDiscountToggle && customerMembership)
                            ? (newInvoice.discountType === 'percentage' ? String(membershipPercent || 0) : String(membershipDiscountAmountOverall || 0))
                            : "0"
                        }
                        max={newInvoice.discountType === 'percentage' ? "100" : String(subtotal)}
                        step="0.01"
                        value={newInvoice.discount}
                        readOnly={!!(customerMembership && applyMembershipDiscountToggle)}
                        onChange={(e) => {
                          if (customerMembership && applyMembershipDiscountToggle) {
                            // Membership ON: discount is system-controlled
                            return;
                          }
                          const inputValue = e.target.value;
                          if (inputValue === "") {
                            // Don't allow clearing while membership is applied
                            if (applyMembershipDiscountToggle && customerMembership) {
                              if (newInvoice.discountType === 'percentage') {
                                setNewInvoice({ ...newInvoice, discount: String(membershipPercent || 0) });
                                membershipDiscountAutoFilledRef.current = true;
                                return;
                              }
                              setNewInvoice({ ...newInvoice, discount: String(membershipDiscountAmountOverall || 0) });
                              membershipDiscountAutoFilledRef.current = true;
                              return;
                            }

                            membershipDiscountAutoFilledRef.current = false;
                            setNewInvoice({ ...newInvoice, discount: "" });
                            return;
                          }
                          const value = parseFloat(inputValue) || 0;
                          // For percentage discounts, cap at 100%
                          // For fixed amount discounts, cap at subtotal to prevent negative totals
                          let adjustedValue = newInvoice.discountType === 'percentage'
                            ? Math.min(Math.max(value, 0), 100)
                            : Math.min(Math.max(value, 0), subtotal);

                          // Enforce minimum membership value when membership is applied
                          if (applyMembershipDiscountToggle && customerMembership) {
                            if (newInvoice.discountType === 'percentage') {
                              if (membershipPercent > 0) adjustedValue = Math.max(adjustedValue, membershipPercent);
                            } else {
                              if (membershipDiscountAmountOverall > 0) adjustedValue = Math.max(adjustedValue, membershipDiscountAmountOverall);
                            }
                          }
                          membershipDiscountAutoFilledRef.current = false;
                          setNewInvoice({
                            ...newInvoice,
                            discount: String(adjustedValue),
                          });
                        }}
                        className={`no-number-spinner flex-1 h-9 text-sm border-slate-300 focus:border-slate-400 focus:ring-0 ${(customerMembership && applyMembershipDiscountToggle)
                          ? 'bg-slate-50 text-slate-700 cursor-not-allowed'
                          : 'bg-white'
                          }`}
                        placeholder={newInvoice.discountType === 'percentage' ? "0" : "0.00"}
                      />
                      <Select
                        value={newInvoice.discountType}
                        onValueChange={(value: any) => {
                          const nextType = value as 'percentage' | 'fixed';
                          const currentRaw = String(newInvoice.discount ?? '').trim();
                          const currentVal = currentRaw === '' ? 0 : (Number(currentRaw) || 0);

                          // Convert the currently-entered/visible discount value into the new type
                          // Discount textbox represents TOTAL discount while membership is ON.
                          if (nextType === 'fixed') {
                            if (newInvoice.discountType === 'percentage') {
                              const enteredPercentTotal = Math.min(Math.max(currentVal, 0), 100);
                              const memP = membershipPercent || 0;
                              const addP = memP > 0 ? Math.max(0, enteredPercentTotal - memP) : enteredPercentTotal;
                              const memAmt = membershipDiscountAmountOverall || 0; // services-only
                              const addAmt = Number(((subtotal * addP) / 100).toFixed(2));
                              const totalAmt = Math.min(subtotal, Number((memAmt + addAmt).toFixed(2)));
                              membershipDiscountAutoFilledRef.current = false;
                              setNewInvoice({ ...newInvoice, discountType: 'fixed', discount: totalAmt > 0 ? String(totalAmt) : '' });
                              return;
                            }
                            // fixed -> fixed
                            setNewInvoice({ ...newInvoice, discountType: 'fixed' });
                            return;
                          }

                          // nextType === 'percentage'
                          if (newInvoice.discountType === 'fixed') {
                            const enteredAmtTotal = Math.min(Math.max(currentVal, 0), subtotal);
                            const memAmt = membershipDiscountAmountOverall || 0;
                            const addAmt = membershipPercent > 0 ? Math.max(0, enteredAmtTotal - memAmt) : enteredAmtTotal;
                            const addP = subtotal > 0 ? (addAmt / subtotal) * 100 : 0;
                            const totalP = membershipPercent > 0 ? (membershipPercent + addP) : addP;
                            const roundedP = Number((Math.min(100, Math.max(0, totalP))).toFixed(2));
                            membershipDiscountAutoFilledRef.current = false;
                            setNewInvoice({ ...newInvoice, discountType: 'percentage', discount: roundedP > 0 ? String(roundedP) : '' });
                            return;
                          }

                          // percentage -> percentage
                          setNewInvoice({ ...newInvoice, discountType: 'percentage' });
                        }}
                      >
                        <SelectTrigger className="w-16 h-9 border-slate-300 text-sm focus:outline-none focus:ring-0 focus:border-slate-400">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="min-w-[60px] z-50">
                          <SelectItem value="percentage">%</SelectItem>
                          <SelectItem value="fixed">₹</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Total Amount */}
                  <div className="pt-2 mt-2 border-t-2 border-gray-300">
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                      <div className="flex justify-center items-center">
                        <div className="text-center">
                          <div className="text-xs text-green-700 font-medium mb-1">Total Amount</div>
                          <div className="text-2xl font-bold text-green-600">
                            ₹{roundedTotal.toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="space-y-2 pt-2 border-t">
                  {/* If invoice is cancelled in header, hide Update/Hold/Cancel actions */}
                  {!(isEditMode && invoiceBillStatus === 'C') && (
                    <>
                      <Button
                        type="submit"
                        disabled={submitting || holdSubmitting}
                        className="w-full gap-2 bg-blue-600 h-12 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {submitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                        {submitting ? (isEditMode ? 'Updating...' : 'Creating...') : (isEditMode ? 'Update Invoice' : 'Create Invoice')}
                        {!submitting && <span className="ml-auto text-xs opacity-75">(F10)</span>}
                      </Button>
                      <Button
                        type="button"
                        onClick={handleHoldInvoice}
                        disabled={submitting || holdSubmitting}
                        variant="outline"
                        className="w-full gap-2 h-10 text-sm font-medium border-orange-300 text-orange-700 hover:bg-orange-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {holdSubmitting ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        {holdSubmitting ? 'Holding...' : 'Hold Invoice'}
                        {!holdSubmitting && <span className="ml-auto text-xs opacity-75">(Ctrl+H)</span>}
                      </Button>
                    </>
                  )}

                  {/* Show Cancel only for existing invoices (edit or visit) and only when not already cancelled */}
                  {(isEditMode || visitInvoiceId) && invoiceBillStatus !== 'C' && (
                    <Button
                      type="button"
                      onClick={handleCancelInvoice}
                      disabled={submitting || cancelSubmitting}
                      variant="outline"
                      className="w-full gap-2 h-10 text-sm font-medium border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cancelSubmitting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      {cancelSubmitting ? 'Cancelling...' : 'Cancel Invoice'}
                    </Button>
                  )}
                </div>
                {/* Add More details modal */}
                {showMoreDetails && (
                  <div
                    className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => {
                      if (e.target === e.currentTarget) {
                        setShowMoreDetails(false);
                      }
                    }}
                  >
                    <div
                      className="bg-white rounded-lg shadow-xl w-[96vw] max-w-3xl p-5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h2 className="text-sm font-semibold text-slate-800">Additional Customer Details</h2>
                        <button className="text-slate-500 hover:text-slate-700" onClick={() => setShowMoreDetails(false)} aria-label="Close">✕</button>
                      </div>

                      {/* Customer Name + Phone (styled like other fields) */}
                      {(() => {
                        const modalRow = moreDetailsCustomerId ? customers.find(c => c.id === moreDetailsCustomerId) : customers[0];
                        const modalName = modalRow?.customerName || newInvoice.customerName || '';
                        const modalPhone = modalRow?.customerPhone || newInvoice.customerPhone || '';
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                            <div className="space-y-0.5">
                              <label className="text-xs font-medium text-slate-700">Customer Name</label>
                              <Input
                                value={modalName}
                                readOnly
                                className="h-8 text-xs border border-slate-300 rounded-md px-2 w-full bg-slate-50 text-slate-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                                placeholder="Customer name"
                              />
                            </div>
                            <div className="space-y-0.5">
                              <label className="text-xs font-medium text-slate-700">Phone Number</label>
                              <Input
                                value={modalPhone}
                                readOnly
                                className="h-8 text-xs border border-slate-300 rounded-md px-2 w-full bg-slate-50 text-slate-800 focus-visible:ring-0 focus-visible:ring-offset-0"
                                placeholder="Phone number"
                              />
                            </div>
                          </div>
                        );
                      })()}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-0.5">
                          <label className="text-xs font-medium text-slate-700">Membership</label>
                          <Select
                            value={moreDetails.membership_id || ''}
                            onValueChange={(v) => setMoreDetails((s) => ({ ...s, membership_id: v }))}
                            disabled={false}
                          >
                            <SelectTrigger className="h-8 text-xs border-slate-300 rounded-md">
                              <SelectValue placeholder="Select membership" />
                            </SelectTrigger>
                            <SelectContent>
                              {(masterMemberships || []).map((m) => (
                                <SelectItem key={m.membership_id} value={String(m.membership_id)}>{m.membership_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-xs font-medium text-slate-700">Birthday Date</label>
                          <input
                            type="date"
                            className="h-8 text-xs border border-slate-300 rounded-md px-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={moreDetails.birthday_date || ''}
                            onChange={(e) => {
                              e.stopPropagation();
                              setMoreDetails((s) => ({ ...s, birthday_date: e.target.value }));
                            }}
                            onFocus={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-xs font-medium text-slate-700">Anniversary Date</label>
                          <input
                            type="date"
                            className="h-8 text-xs border border-slate-300 rounded-md px-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            value={moreDetails.anniversary_date || ''}
                            onChange={(e) => {
                              e.stopPropagation();
                              setMoreDetails((s) => ({ ...s, anniversary_date: e.target.value }));
                            }}
                            onFocus={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="space-y-0.5">
                          <label className="text-xs font-medium text-slate-700">
                            <span>Membership Card No</span>
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              className="h-8 text-xs border border-slate-300 rounded-md px-2 pr-8 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              value={moreDetails.membership_cardno || ''}
                              onChange={(e) => {
                                e.stopPropagation();
                                setMoreDetails((s) => ({ ...s, membership_cardno: e.target.value }));
                              }}
                              onFocus={(e) => e.stopPropagation()}
                              onKeyDown={(e) => e.stopPropagation()}
                              placeholder="Enter card number"
                            />
                          </div>
                        </div>
                        <div className="space-y-0.5 sm:col-span-2">
                          <label className="text-xs font-medium text-slate-700">Address</label>
                          <textarea
                            className="text-xs border border-slate-300 rounded-md px-2 py-1 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                            rows={3}
                            value={moreDetails.address || ''}
                            onChange={(e) => {
                              e.stopPropagation();
                              setMoreDetails((s) => ({ ...s, address: e.target.value }));
                            }}
                            onFocus={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Address"
                          />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" className="h-8 text-xs" onClick={() => { setShowMoreDetails(false); setMoreDetailsCustomerId(null); }}>Cancel</Button>
                        <Button type="button" className="h-8 text-xs" onClick={async () => {
                          if (!user) return;

                          const acc = (user as any)?.account_code;
                          const ret = (user as any)?.retail_code;
                          const modalRow = moreDetailsCustomerId ? customers.find(c => c.id === moreDetailsCustomerId) : customers[0];
                          const modalName = sTrim(modalRow?.customerName || newInvoice.customerName);
                          const modalPhone = sTrim(modalRow?.customerPhone || newInvoice.customerPhone);
                          if (!modalName || !modalPhone) {
                            toast({ title: "Missing Customer Info", description: "Please enter customer name and phone for this row before saving additional details.", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                            return;
                          }

                          try {
                            // If there is a known selected customer id, try to update that; otherwise find by phone/name
                            if (selectedCustomer) {
                              // Find the actual customer record to update
                              const readRes: any = await DataService.readData(["master_customer"], acc, ret);
                              const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data?.customers || readRes?.data || []) as any[];
                              const norm = (v: any) => String(v ?? '').trim().toLowerCase();
                              let rows = Array.isArray(rowsRaw)
                                ? rowsRaw.filter((r: any) => norm(r?.account_code) === norm(acc) && norm(r?.retail_code) === norm(ret))
                                : [];
                              if (!rows.length && Array.isArray(rowsRaw)) {
                                rows = rowsRaw;
                              }

                              // Find customer by multiple matching strategies
                              const customerId = selectedCustomer.id;
                              const customerPhone = modalPhone;
                              const customerName = modalName;

                              const onlyDigits = (s: string) => s.replace(/\D+/g, '');
                              const existing = rows.find((r: any) => {
                                // Strategy 1: Match by customer_id
                                if (String(r.customer_id || '') === String(customerId)) return true;
                                // Strategy 2: Match by primary key id
                                if (String(r.id || '') === String(customerId)) return true;
                                // Strategy 3: Match by phone number
                                if (customerPhone) {
                                  const p = String(r?.phone || r?.phone1 || r?.mobile || r?.customer_phone || r?.mobile_number || "");
                                  if (p && onlyDigits(p) === onlyDigits(customerPhone)) return true;
                                }
                                // Strategy 4: Match by name (fallback)
                                if (customerName && String(r?.customer_name || '').toLowerCase().trim() === customerName.toLowerCase()) return true;
                                return false;
                              });

                              if (existing) {
                                const updatePayload: any = {
                                  id: existing.id, // Use the primary key for update
                                  customer_id: existing.customer_id || existing.id,
                                  account_code: acc,
                                  retail_code: ret,
                                  updated_by: user?.username || 'system',
                                  // Update name and phone if they've changed
                                  customer_name: customerName || existing.customer_name,
                                  phone: customerPhone || existing.phone,
                                  phone1: customerPhone || existing.phone1 || existing.phone,
                                  // Add/update additional details
                                  ...(moreDetails.membership_id ? { membership_id: String(moreDetails.membership_id).trim() } : {}),
                                  ...(moreDetails.birthday_date ? { birthday_date: moreDetails.birthday_date } : {}),
                                  ...(moreDetails.anniversary_date ? { anniversary_date: moreDetails.anniversary_date } : {}),
                                  ...(moreDetails.membership_cardno ? { membership_cardno: String(moreDetails.membership_cardno).trim() } : {}),
                                  ...(moreDetails.address ? { address: String(moreDetails.address).trim() } : {}),
                                };

                                console.log('🔍 UPDATE PAYLOAD:', updatePayload);

                                const updateRes: any = await DataService.updateData("master_customer", updatePayload);
                                if (updateRes?.success) {
                                  toast({ title: "Customer Updated", description: "Customer details updated successfully" });
                                } else {
                                  console.error('Update failed:', updateRes);
                                  toast({ title: "Update Failed", description: updateRes?.message || "Failed to update customer details", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                                }
                              } else {
                                toast({ title: "Customer Not Found", description: "Could not find customer record to update", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                              }
                            } else {
                              // No customer selected, check if we need to create or find existing
                              if (modalName && modalPhone) {
                                const readRes: any = await DataService.readData(["master_customer"], acc, ret);
                                const rowsRaw: any[] = (readRes?.data?.master_customer || readRes?.data?.customers || readRes?.data || []) as any[];
                                const norm = (v: any) => String(v ?? '').trim().toLowerCase();
                                let rows = Array.isArray(rowsRaw)
                                  ? rowsRaw.filter((r: any) => norm(r?.account_code) === norm(acc) && norm(r?.retail_code) === norm(ret))
                                  : [];
                                if (!rows.length && Array.isArray(rowsRaw)) {
                                  rows = rowsRaw;
                                }

                                // Find existing customer by phone
                                const phone = modalPhone;
                                const onlyDigits = (s: string) => s.replace(/\D+/g, '');
                                const existing = rows.find((r: any) => {
                                  const p = String(r?.phone || r?.phone1 || r?.mobile || r?.customer_phone || r?.mobile_number || "");
                                  return p && onlyDigits(p) === onlyDigits(phone);
                                });

                                if (existing) {
                                  // Update existing customer
                                  const updatePayload: any = {
                                    id: existing.id,
                                    customer_id: existing.customer_id || existing.id,
                                    account_code: acc,
                                    retail_code: ret,
                                    updated_by: user?.username || 'system',
                                    ...(moreDetails.membership_id ? { membership_id: String(moreDetails.membership_id).trim() } : {}),
                                    ...(moreDetails.birthday_date ? { birthday_date: moreDetails.birthday_date } : {}),
                                    ...(moreDetails.anniversary_date ? { anniversary_date: moreDetails.anniversary_date } : {}),
                                    ...(moreDetails.membership_cardno ? { membership_cardno: String(moreDetails.membership_cardno).trim() } : {}),
                                    ...(moreDetails.address ? { address: String(moreDetails.address).trim() } : {}),
                                  };

                                  const updateRes: any = await DataService.updateData("master_customer", updatePayload);
                                  if (updateRes?.success) {
                                    toast({ title: "Customer Updated", description: "Customer details updated successfully" });
                                  } else {
                                    toast({ title: "Update Failed", description: "Failed to update customer details", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                                  }
                                } else {
                                  // Create new customer
                                  let nextCustomerId = 1;
                                  if (Array.isArray(rows) && rows.length > 0) {
                                    const numericCustomerIds = rows
                                      .map((c: any) => parseInt((c?.customer_id ?? c?.CUSTOMER_ID ?? c?.CustomerId ?? c?.customerID ?? "0") as any, 10))
                                      .filter((id: number) => Number.isFinite(id) && id > 0);
                                    const maxCustomerId = numericCustomerIds.length ? Math.max(...numericCustomerIds) : 0;
                                    nextCustomerId = maxCustomerId + 1;
                                  }

                                  const normalizedGender = (newInvoice.customerGender || '').trim().toLowerCase();
                                  const genderFull = (() => {
                                    if (normalizedGender === 'male' || normalizedGender === 'm') return 'Male';
                                    if (normalizedGender === 'female' || normalizedGender === 'f') return 'Female';
                                    if (normalizedGender === 'other' || normalizedGender === 'o') return 'Other';
                                    return undefined;
                                  })();

                                  const customerPayload: any = {
                                    customer_id: nextCustomerId,
                                    customer_name: modalName,
                                    phone: phone,
                                    phone1: phone,
                                    account_code: acc,
                                    retail_code: ret,
                                    ...(genderFull ? { gender: genderFull.slice(0, 18) } : {}),
                                    ...(moreDetails.membership_id ? { membership_id: String(moreDetails.membership_id).trim() } : {}),
                                    ...(moreDetails.birthday_date ? { birthday_date: moreDetails.birthday_date } : {}),
                                    ...(moreDetails.anniversary_date ? { anniversary_date: moreDetails.anniversary_date } : {}),
                                    ...(moreDetails.membership_cardno ? { membership_cardno: String(moreDetails.membership_cardno).trim() } : {}),
                                    ...(moreDetails.address ? { address: String(moreDetails.address).trim() } : {}),
                                    visitcnt: 0,
                                    outstandingamt: 0,
                                    status: 1,
                                    created_by: user?.username || 'system',
                                    updated_by: user?.username || 'system',
                                  };

                                  const createRes: any = await DataService.createData("master_customer", customerPayload, null, acc, ret);
                                  if (createRes?.success) {
                                    setSelectedCustomer({
                                      id: String(nextCustomerId),
                                      name: modalName,
                                      email: "",
                                      phone,
                                      totalVisits: 0,
                                      lastVisit: "",
                                      visitCount: 0,
                                      customerCredit: 0
                                    });
                                    toast({ title: "Customer Created", description: "Customer details saved successfully" });
                                  } else {
                                    toast({ title: "Creation Failed", description: "Failed to create customer", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                                  }
                                }
                              }
                            }

                            // Apply details to invoice state
                            setNewInvoice(prev => ({
                              ...prev,
                              customerMembershipId: moreDetails.membership_id || prev.customerMembershipId,
                              customerBirthday: moreDetails.birthday_date || prev.customerBirthday,
                              customerAnniversary: moreDetails.anniversary_date || prev.customerAnniversary,
                              customerMembershipCardNo: moreDetails.membership_cardno || prev.customerMembershipCardNo,
                              customerAddress: moreDetails.address || prev.customerAddress,
                            }));

                          } catch (error) {
                            console.error('Error saving customer details:', error);
                            toast({ title: "Save Failed", description: "Error saving customer details", className: "border-yellow-200 bg-yellow-50 text-yellow-900" });
                          }

                          setShowMoreDetails(false);
                        }}>{selectedCustomer ? 'Update' : 'Save'}</Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Portal-based Suggestions Dropdown */}
      {showCustomerSuggestions && customerSuggestions.length > 0 && customerDropdownPos.current && createPortal(
        <div
          data-customer-suggestions
          role="listbox"
          className="fixed bg-white rounded-none shadow-none ring-1 ring-slate-200 max-h-64 overflow-y-auto overflow-x-hidden"
          style={{
            top: customerDropdownPos.current.top,
            left: customerDropdownPos.current.left,
            // Fit exactly within the textbox width
            width: customerDropdownPos.current.width,
            maxWidth: `${window.innerWidth - 16}px`,
            zIndex: 10000,
            transform: 'translateZ(0)',
            willChange: 'top, left'
          }}
        >
          {customerSuggestions.map((c, idx) => {
            const name = c.customer_name || c.full_name || c.name || '';
            const phone = c.phone || c.mobile || c.customer_phone || '';

            return (
              <div
                key={idx}
                role="option"
                aria-selected={customerSelectedIndex === idx}
                className={`px-2 py-1.5 text-xs cursor-pointer hover:bg-slate-50 transition-colors ${customerSelectedIndex === idx ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
                onMouseDown={() => selectCustomer(c)}
                onMouseEnter={() => setCustomerSelectedIndex(idx)}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 h-4 w-4 rounded-full bg-slate-100 flex items-center justify-center text-slate-600">
                    <User className="h-3 w-3" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-800 font-medium leading-tight truncate" title={name}>{name}</div>
                    {phone && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <Phone className="h-3 w-3" /> {phone}
                      </div>
                    )}
                    {(c.email || (c as any).last_visit) && (
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
                        {c.email && (
                          <span className="inline-flex items-center gap-1 truncate max-w-[12rem]"><Mail className="h-3 w-3" />{c.email}</span>
                        )}
                        {(c as any).last_visit && (
                          <span className="truncate">Last: {(c as any).last_visit}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>,
        document.body
      )}

      {showSuggestions &&
        suggestions.length > 0 &&
        dropdownPosition &&
        createPortal(
          <div
            data-suggestions-dropdown
            className="fixed bg-white border border-gray-200 rounded-md shadow-xl max-h-48 overflow-y-auto"
            style={{
              top: dropdownPosition.top,
              left: dropdownPosition.left,
              width: Math.max(dropdownPosition.width, 250),
              minWidth: '250px',
              maxWidth: `${window.innerWidth - 16}px`,
              zIndex: 10000,
              transform: 'translateZ(0)', // Force hardware acceleration
              willChange: 'transform', // Optimize for frequent position changes
            }}
          >
            {suggestions.map((suggestion, idx) => (
              <div
                key={idx}
                className={`p-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer text-sm border-b border-gray-100 last:border-b-0 transition-colors touch-manipulation ${selectedSuggestionIndex === idx ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                onMouseDown={() => {
                  selectSuggestion(showSuggestions, suggestion);
                }}
                onTouchStart={() => {
                  selectSuggestion(showSuggestions, suggestion);
                }}
                onMouseEnter={() => setSelectedSuggestionIndex(idx)}
              >
                <div className="font-medium text-gray-900 mb-1 truncate">{suggestion.name}</div>
                <div className="text-gray-600 text-xs flex items-center gap-2">
                  <span className="font-medium text-green-600">₹{suggestion.price}</span>
                  <span className="text-gray-400">•</span>
                  <span className="truncate">{suggestion.duration}</span>
                </div>
              </div>
            ))}
          </div>,
          document.body,
        )}

      {(loading || loadingEditData) && (
        <div
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/20 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label="Loading"
        >
          {/* Icon-only scissors animation */}
          <style>{`
            @keyframes snipTop { 0%,100% { transform: rotate(16deg) } 50% { transform: rotate(-8deg) } }
            @keyframes snipBottom { 0%,100% { transform: rotate(-16deg) } 50% { transform: rotate(8deg) } }
            @keyframes floaty { 0% { transform: translateY(0) } 50% { transform: translateY(-4px) } 100% { transform: translateY(0) } }
          `}</style>
          <svg viewBox="0 0 64 64" width="56" height="56" className="animate-[floaty_2s_ease-in-out_infinite]">
            <circle cx="32" cy="32" r="3" fill="#64748b" />
            <circle cx="24" cy="24" r="7" fill="none" stroke="#64748b" strokeWidth="3" />
            <circle cx="24" cy="40" r="7" fill="none" stroke="#64748b" strokeWidth="3" />
            <g style={{ transformOrigin: '32px 32px' }} className="animate-[snipTop_.45s_ease-in-out_infinite]">
              <rect x="32" y="28.5" width="26" height="3" rx="1.5" fill="#0ea5e9" />
            </g>
            <g style={{ transformOrigin: '32px 32px' }} className="animate-[snipBottom_.45s_ease-in-out_infinite]">
              <rect x="32" y="32.5" width="26" height="3" rx="1.5" fill="#0ea5e9" />
            </g>
          </svg>
        </div>
      )}

      {/* Price Edit Dialog */}
      <Dialog open={priceEditOpen} onOpenChange={(o) => { if (!o) { setPriceEditOpen(false); setPriceEditId(null); } }}>
        <DialogContent className="max-w-sm p-4" overlayClassName="bg-black/60">
          <DialogHeader>
            <DialogTitle className="text-base">Enter unit price</DialogTitle>
            <DialogDescription className="text-xs">Set the unit price for this item. This will override any automatic markups.</DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Input
              type="number"
              value={priceEditValue}
              onChange={(e) => setPriceEditValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmPriceEditor(); } }}
              min="0"
              step="0.01"
              className="h-9"
              autoFocus
            />
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" type="button" onClick={() => { setPriceEditOpen(false); setPriceEditId(null); }} className="h-8 px-3 text-xs">Cancel</Button>
            <Button type="button" onClick={confirmPriceEditor} className="h-8 px-3 text-xs">OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Service/Package/Inventory (reuse existing Masters UI) */}
      <Dialog
        open={masterCreateOpen}
        onOpenChange={(o) => {
          setMasterCreateOpen(o);
          if (!o) {
            fetchMasterData();
          }
        }}
      >
        <DialogContent className="max-w-6xl h-[85vh] overflow-hidden p-0" overlayClassName="bg-black/60">
          <div className="p-4 border-b border-slate-200 bg-white">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-slate-900">
                {masterCreateKey === 'service'
                  ? 'Service Master'
                  : masterCreateKey === 'package'
                    ? 'Package Master'
                    : 'Inventory Master'}
              </DialogTitle>
            </DialogHeader>
          </div>
          <div className="h-[calc(85vh-86px)] bg-white">
            <iframe
              title="Master Create"
              src={`/masters/${masterCreateKey}?embed=1`}
              className="w-full h-full border-0"
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Print Confirmation Dialog */}
      <Dialog open={showPrintConfirmation} onOpenChange={() => { }}>
        <DialogContent className="max-w-md p-6" overlayClassName="bg-black/60">
          <DialogHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="h-6 w-6 text-green-600" />
            </div>
            <DialogTitle className="text-lg font-semibold text-gray-900">
              Invoice Created Successfully!
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600 mt-2">
              Would you like to print the receipt now?
            </DialogDescription>
          </DialogHeader>

          {invoiceDataForPrint && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <div className="text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-600">Invoice ID:</span>
                  <span className="font-medium">{invoiceDataForPrint.invoiceId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Customer:</span>
                  <span className="font-medium">{invoiceDataForPrint.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Amount:</span>
                  <span className="font-semibold text-green-600">₹{invoiceDataForPrint.total?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Payment:</span>
                  <span className="font-medium capitalize">{invoiceDataForPrint.paymentMethod}</span>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={() => handlePrintConfirmation(false)}
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Skip Print
            </Button>
            <Button
              onClick={() => handlePrintConfirmation(true)}
              className="flex-1 bg-blue-600 hover:bg-blue-700"
            >
              <Printer className="h-4 w-4 mr-2" />
              Print Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Customer Visit History Modal */}
      <Dialog open={showVisitHistory} onOpenChange={setShowVisitHistory}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto" overlayClassName="bg-black/60">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <User className="h-4 w-4 text-blue-600" />
              {selectedCustomer && selectedCustomer.name}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            {visitHistoryData ? (
              <div className="space-y-4">
                {/* Summary Cards */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-gradient-to-r from-blue-50 to-blue-100 p-3 rounded-lg border border-blue-200">
                    <div className="text-center">
                      <p className="text-xl font-bold text-blue-700">{visitHistoryData.summary?.total_visits || 0}</p>
                      <p className="text-xs font-medium text-blue-600">Total Visits</p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-green-50 to-green-100 p-3 rounded-lg border border-green-200">
                    <div className="text-center">
                      <p className="text-xl font-bold text-green-700">₹{visitHistoryData.summary?.total_spent || 0}</p>
                      <p className="text-xs font-medium text-green-600">Total Spent</p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-purple-50 to-purple-100 p-3 rounded-lg border border-purple-200">
                    <div className="text-center">
                      <p className="text-xl font-bold text-purple-700">₹{visitHistoryData.summary?.average_spend || 0}</p>
                      <p className="text-xs font-medium text-purple-600">Avg per Visit</p>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-orange-50 to-orange-100 p-3 rounded-lg border border-orange-200">
                    <div className="text-center">
                      <p className="text-base font-bold text-orange-700">
                        {visitHistoryData.summary?.last_visit
                          ? new Date(visitHistoryData.summary.last_visit).toLocaleDateString()
                          : 'N/A'
                        }
                      </p>
                      <p className="text-xs font-medium text-orange-600">Last Visit</p>
                    </div>
                  </div>
                </div>

                {/* Visit History Table */}
                <div className="space-y-2">
                  <h3 className="text-base font-semibold text-gray-900">Visit History</h3>
                  {visitHistoryData.visits && visitHistoryData.visits.length > 0 ? (
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="max-h-64 overflow-y-auto">
                        <table className="w-full">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Visit #
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Date & Time
                              </th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Invoice ID
                              </th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Bill Amount
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Status
                              </th>
                              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                                Action
                              </th>
                            </tr>
                          </thead>
                          <tbody className="bg-white divide-y divide-gray-100">
                            {visitHistoryData.visits.map((visit: any, index: number) => (
                              <tr key={visit.id} className="hover:bg-gray-50 transition-colors duration-150">
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <div className="flex items-center">
                                    <div className="w-6 h-6 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center text-xs font-semibold mr-2">
                                      {visitHistoryData.visits.length - index}
                                    </div>
                                    <span className="text-sm font-medium text-gray-900">
                                      Visit {visitHistoryData.visits.length - index}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <div>
                                    <div className="text-sm font-medium text-gray-900">
                                      {new Date(visit.visit_date).toLocaleDateString('en-US', {
                                        year: 'numeric',
                                        month: 'short',
                                        day: 'numeric',
                                        weekday: 'short'
                                      })}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {new Date(visit.created_at).toLocaleTimeString('en-US', {
                                        hour: '2-digit',
                                        minute: '2-digit'
                                      })}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <div className="text-sm font-semibold text-gray-900">
                                    {String(visit.invoice_id || '').trim() ? String(visit.invoice_id) : '—'}
                                  </div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-right">
                                  <div className="text-base font-bold text-green-600">
                                    ₹{Number(visit.total_spend).toLocaleString()}
                                  </div>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-center">
                                  <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">
                                    Completed
                                  </span>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-center">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!String(visit.invoice_id || '').trim()}
                                    onClick={async () => {
                                      const inv = String(visit.invoice_id || '').trim();
                                      if (!inv) return;
                                      setVisitInvoiceId(inv);
                                      setShowVisitInvoiceDetails(true);
                                      await fetchVisitInvoiceDetails(inv);
                                    }}
                                  >
                                    View
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="border border-gray-200 rounded-lg p-8 text-center">
                      <User className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                      <p className="text-base font-medium text-gray-500 mb-1">No visit history found</p>
                      <p className="text-sm text-gray-400">This customer hasn't made any visits yet</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3"></div>
                <p className="text-gray-500">Loading...</p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-4 pt-3 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={() => {
                setShowVisitHistory(false);
                setVisitHistoryData(null);
              }}
              className="w-full sm:w-auto px-4"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Visit Invoice Details Dialog */}
      <Dialog open={showVisitInvoiceDetails} onOpenChange={setShowVisitInvoiceDetails}>
        <DialogContent className="max-w-6xl max-h-[85vh] overflow-y-auto" overlayClassName="bg-black/60">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-gray-900">
              Invoice Details{visitInvoiceId ? ` - ${visitInvoiceId}` : ''}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-2">
            {loadingVisitInvoiceDetails ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full" />
                <span className="ml-2 text-gray-500">Loading invoice...</span>
              </div>
            ) : (() => {
              const inv: any = visitInvoiceDetails || {};
              const header: any = inv.header || {};
              const services: any[] = Array.isArray(inv.data) ? inv.data : [];
              const packages: any[] = Array.isArray(inv.packages) ? inv.packages : [];
              const inventory: any[] = Array.isArray(inv.inventory) ? inv.inventory : [];
              const payments: any[] = Array.isArray(inv.payments) ? inv.payments : [];

              const invoiceIdDisplay =
                header.invoice_id ||
                inv.invoice_id ||
                (services[0] && services[0].invoice_id) ||
                visitInvoiceId ||
                '';

              const staffName =
                header.employee_name ||
                header.staff ||
                (services[0] && (services[0].employee_name || services[0].staff)) ||
                '';

              const createdAt = header.created_at || header.updated_at || (services[0] && services[0].created_at) || '';
              const grandTotal = Number(header.grand_total ?? (services[0]?.grand_total ?? 0) ?? 0) || 0;

              const fmtDateTime = (val: any) => {
                if (!val) return '—';
                try {
                  return new Date(val).toLocaleString();
                } catch {
                  return String(val);
                }
              };

              const money = (val: any) => `₹${(Number(val || 0) || 0).toLocaleString()}`;

              return (
                <div className="space-y-4">
                  {/* Header summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                      <div className="text-xs text-gray-500">Staff</div>
                      <div className="text-sm font-semibold text-gray-900">{staffName || '—'}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                      <div className="text-xs text-gray-500">Date</div>
                      <div className="text-sm font-semibold text-gray-900">{fmtDateTime(createdAt)}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-gray-200 bg-gray-50">
                      <div className="text-xs text-gray-500">Grand Total</div>
                      <div className="text-sm font-semibold text-gray-900">{money(grandTotal)}</div>
                    </div>
                  </div>

                  {services.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">Services</h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="max-h-64 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Service</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Qty</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Rate</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Discount</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Tax</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                              {services.map((ln: any, idx: number) => (
                                <tr key={ln.id ?? idx}>
                                  <td className="px-3 py-2 text-sm text-gray-900">{ln.service_name || ln.serviceName || '—'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{Number(ln.qty ?? 0) || 0}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(ln.unit_price)}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(ln.discount_amount)}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(ln.tax_amount)}</td>
                                  <td className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">{money(ln.grand_total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {packages.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">Packages</h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Package</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Qty</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Rate</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Tax</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                              {packages.map((p: any, idx: number) => (
                                <tr key={p.id ?? idx}>
                                  <td className="px-3 py-2 text-sm text-gray-900">{p.package_name || p.packageName || '—'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{Number(p.qty ?? 0) || 0}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(p.unit_price)}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(p.tax_amount)}</td>
                                  <td className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">{money(p.grand_total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {payments.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">Payments</h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Method</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Amount</th>
                                <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Status</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Date</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                              {payments.map((pm: any, idx: number) => (
                                <tr key={pm.id ?? idx}>
                                  <td className="px-3 py-2 text-sm text-gray-900">{pm.payment_method || pm.payment_mode_name || pm.paymentModeName || '—'}</td>
                                  <td className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">{money(pm.amount)}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-center">{pm.status || '—'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-700">{fmtDateTime(pm.payment_date || pm.created_at)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {inventory.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold text-gray-900">Inventory</h3>
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <div className="max-h-56 overflow-y-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Item</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Qty</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Rate</th>
                                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">Total</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-100">
                              {inventory.map((it: any, idx: number) => (
                                <tr key={it.id ?? idx}>
                                  <td className="px-3 py-2 text-sm text-gray-900">{it.item_name || it.inventory_name || it.product_name || '—'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{Number(it.qty ?? it.quantity ?? 0) || 0}</td>
                                  <td className="px-3 py-2 text-sm text-gray-900 text-right">{money(it.unit_price ?? it.rate)}</td>
                                  <td className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">{money(it.grand_total ?? it.total_amount ?? it.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <DialogFooter className="mt-4 pt-3 border-t border-gray-200">
            <Button
              variant="outline"
              onClick={() => {
                setShowVisitInvoiceDetails(false);
                setVisitInvoiceId(null);
                setVisitInvoiceDetails(null);
              }}
              className="w-full sm:w-auto px-4"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Full Credit Confirmation Dialog */}
      <Dialog open={showCreditConfirmation} onOpenChange={setShowCreditConfirmation}>
        <DialogContent className="max-w-md" overlayClassName="bg-black/60">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-orange-600" />
              Confirm Full Credit Billing
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              Please confirm your billing decision
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center flex-shrink-0">
                <span className="text-orange-600 font-semibold text-sm">!</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-orange-800 mb-1">
                  Full Credit Billing
                </p>
                <p className="text-sm text-orange-700">
                  This invoice will be billed with full amount <span className="font-semibold">₹{roundedTotal.toLocaleString()}</span> as credit.
                  No payment will be collected now.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-6 flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowCreditConfirmation(false);
                setPendingSubmit(null);
                setSubmitting(false); // Reset loading state
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setShowCreditConfirmation(false);
                if (pendingSubmit) {
                  try {
                    await processSubmit(pendingSubmit);
                  } catch (error) {
                    console.error('Error during submission:', error);
                  } finally {
                    setSubmitting(false);
                  }
                }
                setPendingSubmit(null);
              }}
              className="flex-1 bg-orange-600 hover:bg-orange-700"
            >
              Proceed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <Dialog open={showCancelConfirmation} onOpenChange={setShowCancelConfirmation}>
        <DialogContent className="max-w-md" overlayClassName="bg-black/60">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <XCircle className="h-5 w-5 text-rose-600" />
              Confirm Cancel Invoice
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-600">
              Are you sure you want to cancel this invoice? This will mark the invoice as cancelled and cannot be billed.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="mt-6 flex gap-3">
            <Button variant="outline" onClick={() => setShowCancelConfirmation(false)} className="flex-1">Back</Button>
            <Button onClick={confirmCancelInvoice} className="flex-1 bg-rose-600 hover:bg-rose-700">
              {cancelSubmitting ? 'Cancelling…' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet Ledger Dialog */}
      <Dialog open={showWalletLedger} onOpenChange={setShowWalletLedger}>
        <DialogContent className="max-w-5xl">
          {/* Header removed per requirement */}

          <div className="space-y-4">
            {walletLedgerLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="ml-2 text-sm text-slate-600">Loading transaction history...</span>
              </div>
            ) : (
              <>
                {/* Summary Cards */}
                {walletLedgerData.length > 0 && (() => {
                  const totalCreditGiven = walletLedgerData
                    .filter(t => t.txn_type === 'CREDIT')
                    .reduce((s, t) => s + (t.amount || 0), 0);
                  const totalCreditsRepaid = walletLedgerData
                    .filter(t => t.txn_type === 'PAYMENT')
                    .reduce((s, t) => s + (t.amount || 0), 0);
                  const totalPending = Math.max(0, totalCreditGiven - totalCreditsRepaid);
                  return (
                    <div className="grid grid-cols-4 gap-4 mb-2">
                      <Card className="p-3">
                        <div className="text-sm font-medium text-slate-600">Total Transactions</div>
                        <div className="text-2xl font-bold text-blue-600">{walletLedgerData.length}</div>
                      </Card>
                      <Card className="p-3">
                        <div className="text-sm font-medium text-slate-600">Total Credit Given</div>
                        <div className="text-2xl font-bold text-blue-600">
                          ₹{totalCreditGiven.toLocaleString()}
                        </div>
                      </Card>
                      <Card className="p-3">
                        <div className="text-sm font-medium text-slate-600">Total Credits Repaid</div>
                        <div className="text-2xl font-bold text-green-600">
                          ₹{totalCreditsRepaid.toLocaleString()}
                        </div>
                      </Card>
                      <Card className="p-3">
                        <div className="text-sm font-medium text-slate-600">Total Credit Pending</div>
                        <div className="text-2xl font-bold text-red-600">
                          ₹{totalPending.toLocaleString()}
                        </div>
                      </Card>
                    </div>
                  );
                })()}

                {/* Pay Now CTA when pending exists */}
                {(() => {
                  const totalCreditGiven = walletLedgerData.filter(t => t.txn_type === 'CREDIT').reduce((s, t) => s + (t.amount || 0), 0);
                  const totalCreditsRepaid = walletLedgerData.filter(t => t.txn_type === 'PAYMENT').reduce((s, t) => s + (t.amount || 0), 0);
                  const pending = Math.max(0, totalCreditGiven - totalCreditsRepaid);
                  return pending > 0 ? (
                    <div className="flex items-center justify-end mb-2">
                      <div className="flex items-center gap-3">
                        <span className="text-sm text-slate-600">Pending: <span className="font-semibold text-red-600">₹{pending.toLocaleString()}</span></span>
                        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => { setWalletPayAmount(pending); setShowWalletPayModal(true); }}>
                          Pay Now
                        </Button>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Transaction Table */}
                <div className="border rounded-lg overflow-hidden">
                  <div className="max-h-96 overflow-y-auto">
                    {walletLedgerData.length === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <CreditCard className="h-12 w-12 mx-auto mb-2 text-slate-300" />
                        <p>No credit transactions found</p>
                      </div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 sticky top-0">
                          <tr>
                            <th className="text-left p-3 font-medium text-slate-700">Date</th>
                            <th className="text-left p-3 font-medium text-slate-700">Type</th>
                            <th className="text-right p-3 font-medium text-slate-700">Amount</th>
                            <th className="text-left p-3 font-medium text-slate-700">Status</th>
                            <th className="text-left p-3 font-medium text-slate-700">Invoice</th>
                            <th className="text-left p-3 font-medium text-slate-700">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {walletLedgerData.map((transaction, index) => (
                            <tr key={transaction.id} className={index % 2 === 0 ? "bg-white" : "bg-slate-25"}>
                              <td className="p-3">
                                {new Date(transaction.entry_date).toLocaleDateString()}
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${transaction.txn_type === 'ADD' || transaction.txn_type === 'PAYMENT'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-red-100 text-red-700'
                                  }`}>
                                  {transaction.txn_type === 'ADD' ? 'Wallet Top-up' :
                                    transaction.txn_type === 'PAYMENT' ? 'Credit Payment' :
                                      transaction.txn_type === 'USE' ? 'Wallet Used' :
                                        transaction.txn_type === 'CREDIT' ? 'Credit Sale' :
                                          transaction.txn_type}
                                </span>
                              </td>
                              <td className={`p-3 text-right font-medium ${transaction.txn_type === 'ADD' || transaction.txn_type === 'PAYMENT'
                                ? 'text-green-600'
                                : 'text-red-600'
                                }`}>
                                {transaction.txn_type === 'ADD' || transaction.txn_type === 'PAYMENT' ? '+' : '-'}
                                ₹{transaction.amount.toLocaleString()}
                              </td>
                              <td className="p-3">
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${(transaction.txn_type === 'PAYMENT' || transaction.status === 'SUCCESS') ? 'bg-green-100 text-green-700' :
                                  transaction.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                                    'bg-blue-100 text-blue-700'
                                  }`}>
                                  {transaction.txn_type === 'PAYMENT' ? 'PAID' : transaction.status}
                                </span>
                              </td>
                              <td className="p-3 text-slate-600">
                                {transaction.invoice_id || '-'}
                              </td>
                              <td className="p-3 text-slate-600 max-w-xs truncate">
                                {transaction.notes || '-'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setShowWalletLedger(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wallet Pay Modal */}
      <Dialog open={showWalletPayModal} onOpenChange={setShowWalletPayModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pay Outstanding Credit</DialogTitle>
            <DialogDescription>Select a payment mode and confirm.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input type="number" value={walletPayAmount} onChange={(e) => setWalletPayAmount(Number(e.target.value || 0))} min={0} />
              </div>
              <div>
                <Label className="text-xs">Payment Mode</Label>
                <Select value={walletPayMode} onValueChange={setWalletPayMode}>
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
            <Button variant="outline" onClick={() => setShowWalletPayModal(false)}>Cancel</Button>
            <Button onClick={submitWalletPayment} disabled={walletPaySubmitting}>
              {walletPaySubmitting ? 'Processing...' : 'Submit Payment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* QR Scanner Dialog for Customer Auto-Fill */}
      <QrScannerDialog
        open={scanOpen && !scanStopRef.current}
        onClose={() => {
          scanStopRef.current = false;
          setScanOpen(false);
        }}
        onDetected={handleScanDetected}
        title="Scan Customer QR"
      />
    </form>
  );

}

// Inventory (retail products)
interface MasterInventory {
  id: number;
  reference_code?: string;
  barcode?: string;
  item_name: string;
  brand?: string;
  inventory_type?: string;
  category?: string;
  hsn_code?: string;
  unit?: string;
  purchase_price?: number;
  selling_price: number;
  tax?: string; // may store tax id/code
  min_stock_level?: number;
  expiry_applicable?: number;
  expiry_date?: string;
  display_order?: number;
  status?: number;
  created_user?: string | null;
  updated_user?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface MasterInventory {
  id: number;
  product_id: string;
  product_name: string;
  product_description?: string;
  barcode?: string | null;
  price: number;
  seasonal_price?: number;
  cost_price?: number;
  quantity_in_stock?: number;
  low_stock_threshold?: number;
  unit_of_measure?: string;
  brand?: string | null;
  category?: string | null;
  sku?: string | null;
  hsn_id?: string | number;
  tax_id?: string | number;
  expiry_applicable?: number;
  expiry_date?: string;
  display_order?: number;
  status?: number;
  created_user?: string | null;
  updated_user?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

