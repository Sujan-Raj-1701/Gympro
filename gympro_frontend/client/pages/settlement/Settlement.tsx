import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, subMonths, addDays } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import AppointmentTransactionService from '@/services/appointmentTransactionService';
import { DataService } from '@/services/userService';
import { InvoiceService } from '@/services/invoiceService';
import { SettlementService } from '@/services/settlementService';
import { exportData } from '@/lib/exportUtils';
import SettlementAnalytics from './SettlementAnalytics';
import SettlementReport from './SettlementReport';
import { FinancialSummaryGrid, PaymentBreakdown } from './FinancialWidgets';
import {
  CalendarIcon,
  Download,
  Printer,
  TrendingUp,
  TrendingDown,
  CreditCard,
  Receipt,
  Users,
  Clock,
  CheckCircle,
  Filter,
  RefreshCw,
  FileSpreadsheet,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  BarChart3,
  PieChart,
  IndianRupee,
  Wallet,
  Building,
  Search,
  ChevronDown,
  Calendar as CalendarDays
} from 'lucide-react';

interface SettlementData {
  id: string;
  type: 'appointment' | 'billing' | 'income' | 'expense' | 'inflow' | 'outflow';
  date: Date;
  customer_name?: string;
  customer_phone?: string;
  staff_name?: string;
  description: string;
  amount: number;
  payment_mode_id?: string;
  payment_mode?: string;
  status: 'pending' | 'advance' | 'settled' | 'completed';
  source: string;
  invoice_id?: string;
  appointment_id?: string;
}

type PaymentMode = {
  id: string;
  name: string;
  displayorder?: number;
};

interface DailySummary {
  date: string;
  opening_balance: number;
  sales_total: number;
  total_income: number;
  total_expenses: number;
  cash_expenses?: number;
  net_amount: number;
  withdrawal_amount?: number;
  next_day_opening_balance?: number;
  appointment_count: number;
  billing_count: number;
  settled_appointments: number;
  pending_appointments: number;
  cash_payments: number;
  card_payments: number;
  upi_payments: number;
  credit_payments: number;
  paymode_amounts?: Record<string, number>;
  payments?: Array<{
    payment_mode_id: number;
    payment_mode_name?: string;
    expected_amount: number;
    actual_amount: number;
    variance_amount: number;
  }>;
}

type DateRange = 'today' | 'yesterday' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'custom';
type ViewType = 'summary' | 'detailed' | 'analytics';

export default function Settlement() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Date and Filter States
  const [dateRange, setDateRange] = useState<DateRange>('today');
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>();
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>();
  const [viewType, setViewType] = useState<ViewType>('summary');
  
  // Data States
  const [settlementData, setSettlementData] = useState<SettlementData[]>([]);
  const [dailySummaries, setDailySummaries] = useState<DailySummary[]>([]);
  const [historySummaries, setHistorySummaries] = useState<DailySummary[]>([]);
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPrintView, setShowPrintView] = useState(false);
  
  // Filter States
  const [paymentModeFilter, setPaymentModeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Opening Balance Edit States
  const [editableOpeningBalances, setEditableOpeningBalances] = useState<{ [key: string]: string }>({});
  const openingAutofillKeyRef = useRef<string>('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  // Manual verification states (dynamic per paymode)
  const [manualReceipts, setManualReceipts] = useState<Record<string, string>>({});
  const [withdraw, setWithdraw] = useState('0.00');
  const [nextDayOpeningBal, setNextDayOpeningBal] = useState('');
  const [withdrawTouched, setWithdrawTouched] = useState(false);
  const [submittingManualVerification, setSubmittingManualVerification] = useState(false);
  const [closeDayConfirmOpen, setCloseDayConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Day closure status (for current day)
  const [dayClosed, setDayClosed] = useState(false);

  // History filters (scoped to History section only)
  const historyMaxDate = useMemo(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'), []);
  const [historyFrom, setHistoryFrom] = useState(() => format(subDays(new Date(), 8), 'yyyy-MM-dd'));
  const [historyTo, setHistoryTo] = useState(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [historySearch, setHistorySearch] = useState('');

  const dailyTotals = useMemo(() => {
    const expectedByModeId: Record<string, number> = {};
    dailySummaries.forEach((s) => {
      const byMode = s.paymode_amounts || {};
      Object.entries(byMode).forEach(([modeId, amt]) => {
        expectedByModeId[modeId] = (expectedByModeId[modeId] || 0) + (Number(amt) || 0);
      });
    });

    const expectedTotal = Object.values(expectedByModeId).reduce((sum, v) => sum + (Number(v) || 0), 0);

    // Keep these for backward-compatible calculations/labels where needed
    const expectedCash = dailySummaries.reduce((sum, s) => sum + (Number(s.cash_payments) || 0), 0);
    const expectedCard = dailySummaries.reduce((sum, s) => sum + (Number(s.card_payments) || 0), 0);
    const expectedUPI = dailySummaries.reduce((sum, s) => sum + (Number(s.upi_payments) || 0), 0);
    const cashExpenses = dailySummaries.reduce((sum, s) => sum + (Number(s.cash_expenses) || 0), 0);
    const totalIncome = dailySummaries.reduce((sum, s) => sum + (Number(s.total_income) || 0), 0);
    const totalExpenses = dailySummaries.reduce((sum, s) => sum + (Number(s.total_expenses) || 0), 0);
    const netAmount = dailySummaries.reduce((sum, s) => sum + (Number(s.net_amount) || 0), 0);

    const openingBalance = dailySummaries.length === 1
      ? (() => {
          const only = dailySummaries[0];
          const editable = editableOpeningBalances[only.date];
          return Number(editable ?? only.opening_balance ?? 0) || 0;
        })()
      : dailySummaries.reduce((sum, s) => {
          const editable = editableOpeningBalances[s.date];
          return sum + (Number(editable ?? s.opening_balance ?? 0) || 0);
        }, 0);

    const cashAvailable = Math.max(0, openingBalance + expectedCash - cashExpenses);

    return {
      openingBalance,
      totalIncome,
      totalExpenses,
      netAmount,
      expectedByModeId,
      expectedCash,
      expectedCard,
      expectedUPI,
      cashExpenses,
      cashAvailable,
      expectedTotal,
    };
  }, [dailySummaries, editableOpeningBalances]);

  const visiblePaymentModes = useMemo(() => {
    return paymentModes.filter((pm) => (dailyTotals.expectedByModeId[pm.id] || 0) > 0);
  }, [paymentModes, dailyTotals.expectedByModeId]);

  // Close-day is driven by CASH only.
  const requiresReceiptEntry = false;

  // Total cash available in drawer at end of day.
  const maxWithdraw = dailyTotals.cashAvailable;

  const clamp0ToMax = (n: number, max: number) => Math.min(Math.max(n, 0), max);

  const handleWithdrawChange = (value: string) => {
    setWithdrawTouched(true);
    setWithdraw(value);

    const raw = String(value ?? '').trim();
    if (raw === '') {
      // Do not pre-fill Next Day Opening when Withdraw is empty
      setNextDayOpeningBal('');
      return;
    }

    const parsed = Number(raw);
    const withdrawNum = Number.isFinite(parsed) ? parsed : 0;
    const clampedWithdraw = clamp0ToMax(withdrawNum, maxWithdraw);
    const remaining = Math.max(0, maxWithdraw - clampedWithdraw);
    setNextDayOpeningBal(remaining.toFixed(2));

    if (raw !== '' && Math.abs(clampedWithdraw - withdrawNum) > 0.0005) {
      setWithdraw(clampedWithdraw.toFixed(2));
    }
  };

  const handleNextDayOpeningChange = (value: string) => {
    setNextDayOpeningBal(value);

    const raw = String(value ?? '').trim();
    const parsed = raw === '' ? 0 : Number(raw);
    const openingNum = Number.isFinite(parsed) ? parsed : 0;
    const clampedOpening = Math.max(openingNum, 0);

    if (raw !== '' && Math.abs(clampedOpening - openingNum) > 0.0005) {
      setNextDayOpeningBal(clampedOpening.toFixed(2));
    }
  };

  // Keep Next Day Opening always consistent with Cash Available and Withdraw.
  useEffect(() => {
    const raw = String(withdraw ?? '').trim();
    if (raw === '') {
      setNextDayOpeningBal('');
      return;
    }

    const parsedWithdraw = Number(raw);
    const withdrawNum = Number.isFinite(parsedWithdraw) ? parsedWithdraw : 0;
    const clampedWithdraw = clamp0ToMax(withdrawNum, maxWithdraw);
    const remaining = Math.max(0, maxWithdraw - clampedWithdraw);

    const nextStr = remaining.toFixed(2);
    if (nextDayOpeningBal !== nextStr) {
      setNextDayOpeningBal(nextStr);
    }

    // If user entered > max, clamp the withdraw field.
    if (Math.abs(clampedWithdraw - withdrawNum) > 0.0005) {
      const wStr = clampedWithdraw.toFixed(2);
      if (raw !== wStr) setWithdraw(wStr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withdraw, maxWithdraw]);

  useEffect(() => {
    if (dailySummaries.length === 0) return;
    // Pre-fill only when the user hasn't entered anything yet.
    setManualReceipts((prev) => {
      const next = { ...prev };
      visiblePaymentModes.forEach((pm) => {
        const curr = String(next[pm.id] ?? '').trim();
        if (curr === '') {
          next[pm.id] = (dailyTotals.expectedByModeId[pm.id] || 0).toFixed(2);
        }
      });
      return next;
    });
  }, [
    dailySummaries.length,
    dailyTotals.expectedByModeId,
    visiblePaymentModes,
  ]);

  const manualInput = useMemo(() => {
    const toNumberOrNull = (val: string) => {
      const trimmed = String(val ?? '').trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      return Number.isFinite(num) ? num : null;
    };

    // Digital payments are system-recorded reference only.
    // For day-close, we treat entered amounts as equal to expected amounts.
    const actualByModeId: Record<string, number> = {};
    paymentModes.forEach((pm) => {
      actualByModeId[pm.id] = dailyTotals.expectedByModeId[pm.id] || 0;
    });
    const withdrawAmount = toNumberOrNull(withdraw);
    const withdrawMissing = String(withdraw ?? '').trim() === '';

    const isNonNegative = (n: number | null) => n == null || n >= 0;
    const withinMaxWithdraw = (n: number | null) => n == null || n <= maxWithdraw + 0.0005;

    const withdraw0 = withdrawAmount ?? 0;
    const withdrawClamped = clamp0ToMax(withdraw0, maxWithdraw);
    const nextDayOpening = withdrawMissing ? null : Math.max(0, maxWithdraw - withdrawClamped);

    const receiptErrors: Record<string, boolean> = {};
    paymentModes.forEach((pm) => {
      receiptErrors[pm.id] = false;
    });

    const errors = {
      receipts: receiptErrors,
      withdraw: withdrawMissing || !isNonNegative(withdrawAmount) || !withinMaxWithdraw(withdrawAmount),
      nextDayOpening: false,
    };

    const actualTotal = Object.values(actualByModeId).reduce((sum, v) => sum + (Number(v) || 0), 0);

    const varianceByModeId: Record<string, number> = {};
    paymentModes.forEach((pm) => {
      const expected = dailyTotals.expectedByModeId[pm.id] || 0;
      const actual = actualByModeId[pm.id] || 0;
      varianceByModeId[pm.id] = actual - expected;
    });

    // Total variance is cash reconciliation variance only.
    // cashAvailable should equal withdraw + nextDayOpening.
    const varianceTotal = withdrawMissing
      ? maxWithdraw
      : (withdrawClamped + Math.max(0, nextDayOpening ?? 0)) - maxWithdraw;

    const variance = {
      byModeId: varianceByModeId,
      total: varianceTotal,
    };

    const hasAnyReceipt = true;
    const hasErrors = Boolean(errors.withdraw || errors.nextDayOpening) || Object.values(errors.receipts).some(Boolean);

    return {
      withdrawAmount,
      nextDayOpening,
      actualByModeId,
      actualTotal,
      variance,
      hasAnyReceipt,
      withdrawMissing,
      errors,
      hasErrors,
    };
  }, [manualReceipts, withdraw, nextDayOpeningBal, dailyTotals, maxWithdraw, paymentModes]);

  const filteredHistorySummaries = useMemo(() => {
    const q = historySearch.trim().toLowerCase();

    return historySummaries.filter((s) => {
      if (!q) return true;

      const opening = editableOpeningBalances[s.date] ?? String(s.opening_balance ?? 0);
      const dynamicModes = paymentModes.flatMap((pm) => {
        const modeId = pm.id;
        const modeIdNum = Number(modeId);
        const p = s.payments?.find(
          (x) => String(x.payment_mode_id) === String(modeId) || (Number.isFinite(modeIdNum) && x.payment_mode_id === modeIdNum)
        );
        const sysAmt = p ? Number(p.expected_amount ?? 0) || 0 : Number(s.paymode_amounts?.[modeId] ?? 0) || 0;
        const enteredAmt = p ? Number(p.actual_amount ?? 0) || 0 : sysAmt;
        return [pm.name, String(sysAmt), String(enteredAmt)];
      });

      const haystack = [
        s.date,
        opening,
        String(s.total_income ?? 0),
        String(s.total_expenses ?? 0),
        String(s.net_amount ?? 0),
        String(s.cash_payments ?? 0),
        String(s.card_payments ?? 0),
        String(s.upi_payments ?? 0),
        String(s.appointment_count ?? 0),
        String(s.billing_count ?? 0),
        ...dynamicModes,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(q);
    });
  }, [historySummaries, historySearch, editableOpeningBalances, paymentModes]);

  const historyPaymentModes = useMemo(() => {
    const fallback: PaymentMode[] = [
      { id: '1', name: 'Cash', displayorder: 0 },
      { id: '2', name: 'Card', displayorder: 1 },
      { id: '3', name: 'UPI', displayorder: 2 },
    ];

    const base = paymentModes.length > 0 ? paymentModes : fallback;

    // Keep History table readable: show only modes that appear in the history payload.
    const hasModeInHistory = (pm: PaymentMode) => {
      const modeId = pm.id;
      const modeIdNum = Number(modeId);
      return historySummaries.some((s) => {
        if ((Number(s.paymode_amounts?.[modeId] ?? 0) || 0) !== 0) return true;
        const p = s.payments?.find(
          (x) => String(x.payment_mode_id) === String(modeId) || (Number.isFinite(modeIdNum) && x.payment_mode_id === modeIdNum)
        );
        if (!p) return false;
        const a = Number(p.expected_amount ?? 0) || 0;
        const e = Number(p.actual_amount ?? 0) || 0;
        const v = Number(p.variance_amount ?? 0) || 0;
        return Math.abs(a) > 0.0005 || Math.abs(e) > 0.0005 || Math.abs(v) > 0.0005;
      });
    };

    const filtered = base.filter(hasModeInHistory);
    return filtered.length > 0 ? filtered : base;
  }, [paymentModes, historySummaries]);

  const getPaymentDetail = useCallback((summary: DailySummary, modeId: string) => {
    const modeIdNum = Number(modeId);
    const p = summary.payments?.find(
      (x) => String(x.payment_mode_id) === String(modeId) || (Number.isFinite(modeIdNum) && x.payment_mode_id === modeIdNum)
    );
    if (p) {
      // In our schema: expected_amount = system calculated ("actual"), actual_amount = user entered.
      const actual = Number(p.expected_amount ?? 0) || 0;
      const entered = Number(p.actual_amount ?? 0) || 0;
      const variance = Number(p.variance_amount ?? 0) || 0;
      return { actual, entered, variance };
    }

    // Fallback for payloads that only had per-mode totals.
    const byMode = Number(summary.paymode_amounts?.[modeId] ?? 0);
    if (Number.isFinite(byMode)) {
      const total = byMode || 0;
      return { actual: total, entered: total, variance: 0 };
    }

    // Fallback for older payloads that only had cash/card/upi.
    const total =
      modeIdNum === 1
        ? Number(summary.cash_payments ?? 0) || 0
        : modeIdNum === 2
          ? Number(summary.card_payments ?? 0) || 0
          : modeIdNum === 3
            ? Number(summary.upi_payments ?? 0) || 0
            : 0;
    return { actual: total, entered: total, variance: 0 };
  }, []);

  useEffect(() => {
    const accountCode = (user as any)?.account_code;
    const retailCode = (user as any)?.retail_code;
    if (!historyOpen) return;
    if (!accountCode || !retailCode) return;
    if (!historyFrom || !historyTo) return;

    let cancelled = false;
    setHistoryLoading(true);

    (async () => {
      try {
        const rows = await SettlementService.getSettlementHistory({
          accountCode,
          retailCode,
          fromDate: historyFrom,
          toDate: historyTo,
        });
        if (!cancelled) {
          const normalizedRows: DailySummary[] = (rows as any[]).map((r: any) => ({
            ...r,
            sales_total: Number(r?.sales_total ?? 0) || 0,
            credit_payments: Number(r?.credit_payments ?? 0) || 0,
          }));

          setHistorySummaries(normalizedRows);

          // If history includes today, infer that the day is already closed.
          const todayStr = format(new Date(), 'yyyy-MM-dd');
          const todayRow = normalizedRows.find((r: any) => r?.date === todayStr);
          if (todayRow) {
            setDayClosed(true);
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setHistorySummaries([]);
          toast({ title: 'History Load Failed', description: e?.message || 'Could not load history', variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [historyOpen, historyFrom, historyTo, user, toast]);

  const canCloseDay =
    dailySummaries.length > 0 &&
    (!requiresReceiptEntry || manualInput.hasAnyReceipt) &&
    !manualInput.withdrawMissing &&
    !manualInput.hasErrors &&
    Math.abs(manualInput.variance.total) < 0.005 &&
    !submittingManualVerification &&
    !dayClosed;

  const accountCode = (user as any)?.account_code;
  const retailCode = (user as any)?.retail_code;

  // Calculate actual date range
  const actualDateRange = useMemo(() => {
    const today = new Date();

    switch (dateRange) {
      case 'today':
        return { start: startOfDay(today), end: endOfDay(today) };
      case 'yesterday':
        const yesterday = subDays(today, 1);
        return { start: startOfDay(yesterday), end: endOfDay(yesterday) };
      case 'thisWeek':
        const startOfWeek = subDays(today, today.getDay());
        return { start: startOfDay(startOfWeek), end: endOfDay(today) };
      case 'lastWeek':
        const lastWeekStart = subDays(today, today.getDay() + 7);
        const lastWeekEnd = subDays(lastWeekStart, -6);
        return { start: startOfDay(lastWeekStart), end: endOfDay(lastWeekEnd) };
      case 'thisMonth':
        return { start: startOfMonth(today), end: endOfMonth(today) };
      case 'lastMonth':
        const lastMonth = subMonths(today, 1);
        return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
      case 'custom':
        return {
          start: customStartDate ? startOfDay(customStartDate) : startOfDay(today),
          end: customEndDate ? endOfDay(customEndDate) : endOfDay(today)
        };
      default:
        return { start: startOfDay(today), end: endOfDay(today) };
    }
  }, [dateRange, customStartDate, customEndDate]);

  // Fetch settlement data
  const fetchSettlementData = async () => {
    if (!accountCode || !retailCode) return;

    setLoading(true);
    setError(null);

    try {
      const fromDate = format(actualDateRange.start, 'yyyy-MM-dd');
      const toDate = format(actualDateRange.end, 'yyyy-MM-dd');

      // Fetch appointment transactions
      const appointmentTxns = await AppointmentTransactionService.list(
        accountCode,
        retailCode,
        fromDate,
        toDate
      );

      // Fetch billing data
      const billingData = await InvoiceService.list(accountCode, retailCode, {
        fromDate,
        toDate,
        // Keep headroom for busy days; backend still filters by date.
        limit: 5000,
      });
      
      // Fetch billing payment modes
      const billingPayments = await InvoiceService.getBillingPayments(accountCode, retailCode, { fromDate, toDate });
      
      // Fetch master payment modes to get payment mode names
      const masterPaymentModes = await DataService.readData(['master_paymentmodes'], accountCode, retailCode);

      // Fetch income/expense data
      console.log('[SETTLEMENT DEBUG] Fetching income/expense data with params:', {
        fromDate,
        toDate,
        accountCode,
        retailCode
      });
      
      const incomeExpenseData = await DataService.getIncomeExpenses(
        fromDate,
        toDate,
        accountCode,
        retailCode
      );
      
      console.log('[SETTLEMENT DEBUG] Income/expense response:', incomeExpenseData);

      // Process and combine all data
      const allData: SettlementData[] = [];
      
      // Create payment mode + amount lookup from billing_paymode data (one invoice can have multiple paymodes)
      const paymentsByBillingId = new Map<
        string,
        Array<{ paymentModeId?: string; amount: number; paymentMethod?: string; paymentDate?: Date }>
      >();
      if (billingPayments && (billingPayments as any).data) {
        (billingPayments as any).data.forEach((payment: any) => {
          const billingId = payment.billing_id ?? payment.invoice_id ?? payment.id;
          const paymentModeId = payment.payment_mode_id ?? payment.payment_id ?? payment.paymode_id ?? payment.mode_id;
          if (!billingId) return;

          const amt = Number(payment.amount ?? payment.paid_amount ?? payment.total_amount ?? 0) || 0;
          const rawDt = payment.payment_date ?? payment.created_at ?? payment.updated_at;
          const parsedDt = rawDt ? new Date(rawDt) : undefined;

          const key = billingId.toString();
          const list = paymentsByBillingId.get(key) || [];
          list.push({
            paymentModeId: paymentModeId ? paymentModeId.toString() : undefined,
            amount: amt,
            paymentMethod: payment.payment_method,
            paymentDate: parsedDt,
          });
          paymentsByBillingId.set(key, list);
        });
      }
      
      // Create payment mode names lookup from master_paymentmodes
      const paymentModeNames = new Map<string, string>();
      const parsedPaymentModes: PaymentMode[] = [];
      if (masterPaymentModes && (masterPaymentModes as any).data) {
        (masterPaymentModes as any).data.forEach((mode: any) => {
          // Try different possible field names for payment mode
          const modeId = mode.id || mode.paymode_id || mode.payment_mode_id || mode.payment_id || mode.mode_id;
          const modeName = mode.paymode_name || mode.payment_mode_name || mode.mode_name || mode.name;
          const status = mode.status;
          const displayorder = Number(mode.displayorder ?? mode.display_order ?? mode.order ?? 0);
          
          if (modeId && modeName) {
            paymentModeNames.set(modeId.toString(), modeName);

            // Keep a sorted list for dynamic UI
            if (status === undefined || status === 1 || status === '1' || status === true) {
              parsedPaymentModes.push({
                id: modeId.toString(),
                name: String(modeName),
                displayorder: Number.isFinite(displayorder) ? displayorder : 0,
              });
            }
          }
        });
      }

      parsedPaymentModes.sort((a, b) => {
        const ao = a.displayorder ?? 0;
        const bo = b.displayorder ?? 0;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });
      setPaymentModes(parsedPaymentModes);

      const paymentModeIdByName = new Map<string, string>();
      parsedPaymentModes.forEach((pm) => {
        paymentModeIdByName.set(pm.name.toLowerCase().trim(), pm.id);
      });

      // Process appointment transactions
      if (appointmentTxns && (appointmentTxns as any).data) {
        (appointmentTxns as any).data.forEach((txn: any) => {
          const txnDate = new Date(txn.latest_created || txn.created_at);
          if (txnDate >= actualDateRange.start && txnDate <= actualDateRange.end) {
            // Check if we have individual payment mode data
            const paymentMode = txn.payment_mode || txn.payment_method || 'Cash';
            const paymentModeId = paymentModeIdByName.get(String(paymentMode).toLowerCase().trim());
            
            allData.push({
              id: `apt-${txn.appointment_id}`,
              type: 'appointment',
              date: txnDate,
              customer_name: txn.customer_name,
              customer_phone: txn.customer_mobile?.toString(),
              staff_name: txn.employee_name,
              description: `Appointment Service - ${txn.customer_name}`,
              amount: Number(txn.grand_total || 0),
              payment_mode_id: paymentModeId,
              payment_mode: paymentMode,
              status: 'settled',
              source: 'Appointment Transaction',
              appointment_id: txn.appointment_id
            });
          }
        });
      }

      // Process billing data
      if (billingData && (billingData as any).data) {
        (billingData as any).data.forEach((bill: any) => {
          const billDate = new Date(bill.last_created_at || bill.created_at || bill.invoice_date);
          if (billDate >= actualDateRange.start && billDate <= actualDateRange.end) {
            const billingId = (bill.invoice_id || bill.id).toString();

            const payments = paymentsByBillingId.get(billingId) || [];
            if (payments.length > 0) {
              // Aggregate by paymode so one invoice doesn't duplicate rows unnecessarily
              const byMode = new Map<string, { amount: number; paymentMethod?: string; paymentDate?: Date }>();
              payments.forEach((p) => {
                const modeKey = p.paymentModeId ? String(p.paymentModeId) : '__unknown__';
                const existing = byMode.get(modeKey) || { amount: 0 };
                existing.amount += Number(p.amount) || 0;
                existing.paymentMethod = existing.paymentMethod || p.paymentMethod;
                // prefer a valid paymentDate if present
                existing.paymentDate = existing.paymentDate || p.paymentDate;
                byMode.set(modeKey, existing);
              });

              byMode.forEach((agg, modeKey) => {
                const paymentModeId = modeKey === '__unknown__' ? undefined : modeKey;
                const paymentMode = (paymentModeId && paymentModeNames.has(paymentModeId))
                  ? (paymentModeNames.get(paymentModeId) || 'Cash')
                  : (agg.paymentMethod || 'Cash');

                allData.push({
                  id: `bill-${billingId}-${paymentModeId || 'unknown'}`,
                  type: 'billing',
                  date: agg.paymentDate || billDate,
                  customer_name: bill.customer_name || 'Walk-in',
                  customer_phone: bill.customer_phone,
                  description: `Invoice ${billingId}`,
                  amount: Number(agg.amount || 0),
                  payment_mode_id: paymentModeId,
                  payment_mode: paymentMode,
                  status: 'completed',
                  source: 'Billing System',
                  invoice_id: billingId,
                });
              });
            } else {
              // Fallback: no payment rows available for this invoice
              allData.push({
                id: `bill-${billingId}`,
                type: 'billing',
                date: billDate,
                customer_name: bill.customer_name || 'Walk-in',
                customer_phone: bill.customer_phone,
                description: `Invoice ${billingId}`,
                amount: Number(bill.grand_total || bill.total_amount || 0),
                payment_mode_id: undefined,
                payment_mode: 'Cash',
                status: 'completed',
                source: 'Billing System',
                invoice_id: billingId,
              });
            }
          }
        });
      }

      // Process income/expense data
      if (incomeExpenseData && (incomeExpenseData as any).data) {
        (incomeExpenseData as any).data.forEach((entry: any) => {
          // Normalize date: API returns 'YYYY-MM-DD', ensure local midnight to avoid TZ shifts
          const rawDate: string = entry.entry_date || entry.date;
          const entryDate = rawDate ? new Date(`${rawDate}T00:00:00`) : undefined;
          if (!entryDate) return;
          if (entryDate >= actualDateRange.start && entryDate <= actualDateRange.end) {
            // Normalize type from API: 'inflow'|'outflow' to 'income'|'expense'
            const normalizedType = (String(entry.type || '').toLowerCase() === 'inflow')
              ? 'income'
              : (String(entry.type || '').toLowerCase() === 'outflow')
              ? 'expense'
              : String(entry.type || 'expense').toLowerCase();

            // Ensure amount is numeric
            const amt = Number(entry.amount ?? entry.total_amount ?? 0);

            const modeName = entry.payment_method || 'Cash';
            const modeId = paymentModeIdByName.get(String(modeName).toLowerCase().trim());

            allData.push({
              id: `ie-${entry.id ?? `${rawDate}-${normalizedType}-${entry.description || ''}`}`,
              type: normalizedType as any,
              date: entryDate,
              description: entry.description || 'Income/Expense Entry',
              amount: amt,
              payment_mode_id: modeId,
              payment_mode: modeName,
              status: 'completed',
              source: 'Income/Expense'
            });
          }
        });
      }

      // Sort by date (most recent first)
      allData.sort((a, b) => b.date.getTime() - a.date.getTime());

      setSettlementData(allData);

      // Generate daily summaries
      generateDailySummaries(allData, parsedPaymentModes);

    } catch (error: any) {
      console.error('Error fetching settlement data:', error);
      setError(error.message || 'Failed to fetch settlement data');
      toast({
        title: 'Error',
        description: 'Failed to load settlement data',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  // Generate daily summaries
  const generateDailySummaries = (data: SettlementData[], modes: PaymentMode[]) => {
    const summariesMap = new Map<string, DailySummary>();
    let runningBalance = 0;

    const idByName = new Map<string, string>();
    modes.forEach((pm) => {
      idByName.set(pm.name.toLowerCase().trim(), pm.id);
    });
    const cashModeId = modes.find((pm) => pm.name.toLowerCase().includes('cash'))?.id;

    // Initialize summaries for all dates in range
    const current = new Date(actualDateRange.start);
    while (current <= actualDateRange.end) {
      const dateKey = format(current, 'yyyy-MM-dd');
      const paymode_amounts: Record<string, number> = {};
      modes.forEach((pm) => {
        paymode_amounts[pm.id] = 0;
      });
      summariesMap.set(dateKey, {
        date: dateKey,
        opening_balance: runningBalance,
        sales_total: 0,
        total_income: 0,
        total_expenses: 0,
        cash_expenses: 0,
        net_amount: 0,
        appointment_count: 0,
        billing_count: 0,
        settled_appointments: 0,
        pending_appointments: 0,
        cash_payments: 0,
        card_payments: 0,
        upi_payments: 0,
        credit_payments: 0,
        paymode_amounts,
      });
      current.setDate(current.getDate() + 1);
    }

    // Populate summaries with data and update running balance
    const sortedSummaries = Array.from(summariesMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedSummaries.forEach(([dateKey, summary]) => {
      const dayData = data.filter(item => format(item.date, 'yyyy-MM-dd') === dateKey);
      const seenAppointments = new Set<string>();
      const seenBillings = new Set<string>();
      
      dayData.forEach(item => {
        // Income column should reflect only income/inflow entries (exclude billing/appointments)
        if (item.type === 'income' || item.type === 'inflow') {
          summary.total_income += item.amount;
        }
        // Sales are tracked separately so Net stays correct
        else if (item.type === 'appointment' || item.type === 'billing') {
          summary.sales_total += item.amount;
        }
        // Handle expense/outflow types  
        else if (item.type === 'expense' || item.type === 'outflow') {
          summary.total_expenses += item.amount;

          const resolvedModeId =
            item.payment_mode_id ||
            (item.payment_mode ? idByName.get(item.payment_mode.toLowerCase().trim()) : undefined) ||
            cashModeId;
          const modeName = (item.payment_mode || '').toLowerCase();
          const isCashExpense = Boolean(
            (cashModeId && resolvedModeId && String(resolvedModeId) === String(cashModeId)) ||
              modeName.includes('cash') ||
              (!resolvedModeId && !modeName)
          );
          if (isCashExpense) {
            summary.cash_expenses = (summary.cash_expenses || 0) + item.amount;
          }
        }

        if (item.type === 'appointment') {
          const apptKey = String(item.appointment_id ?? item.id);
          if (!seenAppointments.has(apptKey)) {
            seenAppointments.add(apptKey);
            summary.appointment_count++;
            if (item.status === 'settled') {
              summary.settled_appointments++;
            } else {
              summary.pending_appointments++;
            }
          }
        }

        if (item.type === 'billing') {
          const billKey = String(item.invoice_id ?? item.id);
          if (!seenBillings.has(billKey)) {
            seenBillings.add(billKey);
            summary.billing_count++;
          }
        }

        // Categorize payments only for income-like transactions; exclude expenses from payment buckets
        const isIncomeLike = (
          item.type === 'income' || item.type === 'inflow' || item.type === 'appointment' || item.type === 'billing'
        );

        if (isIncomeLike) {
          const resolvedModeId =
            item.payment_mode_id ||
            (item.payment_mode ? idByName.get(item.payment_mode.toLowerCase().trim()) : undefined) ||
            cashModeId;

          if (resolvedModeId) {
            if (!summary.paymode_amounts) summary.paymode_amounts = {};
            summary.paymode_amounts[resolvedModeId] = (summary.paymode_amounts[resolvedModeId] || 0) + item.amount;
          }
        }
      });

      // Backward-compatible totals (Cash/Card/UPI) derived from per-paymode amounts.
      summary.cash_payments = 0;
      summary.card_payments = 0;
      summary.upi_payments = 0;
      modes.forEach((pm) => {
        const amt = summary.paymode_amounts?.[pm.id] || 0;
        const n = pm.name.toLowerCase();
        if (n.includes('cash')) summary.cash_payments += amt;
        else if (n.includes('card')) summary.card_payments += amt;
        else if (n.includes('upi')) summary.upi_payments += amt;
      });

      summary.net_amount = (summary.sales_total + summary.total_income) - summary.total_expenses;
      // Update running balance for next day
      runningBalance += summary.net_amount;
    });

    setDailySummaries(sortedSummaries.map(([_, summary]) => summary).reverse());
  };

  // Filter and search settlement data
  const filteredSettlementData = useMemo(() => {
    return settlementData.filter(item => {
      // Payment mode filter
      if (paymentModeFilter !== 'all' && !item.payment_mode?.toLowerCase().includes(paymentModeFilter.toLowerCase())) {
        return false;
      }

      // Status filter
      if (statusFilter !== 'all' && item.status !== statusFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== 'all' && item.type !== typeFilter) {
        return false;
      }

      // Search term
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          item.customer_name?.toLowerCase().includes(search) ||
          item.description.toLowerCase().includes(search) ||
          item.staff_name?.toLowerCase().includes(search) ||
          item.customer_phone?.includes(search)
        );
      }

      return true;
    });
  }, [settlementData, paymentModeFilter, statusFilter, typeFilter, searchTerm]);

  // Pagination
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredSettlementData.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredSettlementData, currentPage, itemsPerPage]);

  const totalPages = Math.ceil(filteredSettlementData.length / itemsPerPage);

  // Manual verification handler
  const handleManualVerification = async () => {
    if (!accountCode || !retailCode) return;

    setSubmittingManualVerification(true);

    try {
      const expectedByModeId = dailyTotals.expectedByModeId;
      const expectedTotal = dailyTotals.expectedTotal;
      const actualByModeId = manualInput.actualByModeId || {};
      const actualTotal = manualInput.actualTotal || 0;

      const sumByCategory = (cat: 'cash' | 'card' | 'upi', map: Record<string, number>) => {
        return paymentModes.reduce((sum, pm) => {
          const n = pm.name.toLowerCase();
          if (cat === 'cash' && n.includes('cash')) return sum + (map[pm.id] || 0);
          if (cat === 'card' && n.includes('card')) return sum + (map[pm.id] || 0);
          if (cat === 'upi' && n.includes('upi')) return sum + (map[pm.id] || 0);
          return sum;
        }, 0);
      };

      const expectedCash = sumByCategory('cash', expectedByModeId);
      const expectedCard = sumByCategory('card', expectedByModeId);
      const expectedUPI = sumByCategory('upi', expectedByModeId);

      // System recorded: treat entered amounts as expected amounts (reference only).
      const actualCash = expectedCash;
      const actualCard = expectedCard;
      const actualUPI = expectedUPI;

      const parsedWithdraw = Number(withdraw);
      const withdrawAmount = Number.isFinite(parsedWithdraw) ? Math.min(Math.max(parsedWithdraw, 0), maxWithdraw) : 0;
      const nextDayOpening = Math.max(0, maxWithdraw - withdrawAmount);

      const variance = {
        cash: 0,
        card: 0,
        upi: 0,
        total: (withdrawAmount + nextDayOpening) - maxWithdraw
      };

      const payments = paymentModes.map((pm) => {
        const expected = expectedByModeId[pm.id] || 0;
        const actual = expected;
        return {
          payment_mode_id: Number(pm.id),
          payment_mode_name: pm.name,
          expected_amount: expected,
          actual_amount: actual,
          variance_amount: actual - expected,
        };
      });

      // Here you can save the day closure data to your backend
      const dayClosureData = {
        account_code: accountCode,
        retail_code: retailCode,
        date: dailySummaries?.[0]?.date || format(new Date(), 'yyyy-MM-dd'),
        expected_amounts: {
          cash: expectedCash,
          card: expectedCard,
          upi: expectedUPI,
          total: expectedTotal
        },
        actual_amounts: {
          cash: actualCash,
          card: actualCard,
          upi: actualUPI,
          total: expectedTotal
        },
        variance: variance,
        payments,
        withdraw_amount: withdrawAmount,
        next_day_opening_balance: nextDayOpening,
        closed_by: (user as any)?.username || 'Unknown',
        closed_at: new Date().toISOString()
      };

      // Persist day closure to backend
      try {
        const json: any = await SettlementService.upsertSettlement({
          account_code: dayClosureData.account_code,
          retail_code: dayClosureData.retail_code,
          settlement_date: dayClosureData.date,
          opening_balance: dailyTotals.openingBalance || 0,
          total_income: dailySummaries.reduce((sum, s) => sum + s.total_income, 0),
          total_expenses: dailySummaries.reduce((sum, s) => sum + s.total_expenses, 0),
          net_amount: dailySummaries.reduce((sum, s) => sum + s.net_amount, 0),
          appointment_count: dailySummaries.reduce((sum, s) => sum + s.appointment_count, 0),
          billing_count: dailySummaries.reduce((sum, s) => sum + s.billing_count, 0),
          settled_appointments: dailySummaries.reduce((sum, s) => sum + s.settled_appointments, 0),
          pending_appointments: dailySummaries.reduce((sum, s) => sum + s.pending_appointments, 0),
          cash_payments: dailySummaries.reduce((sum, s) => sum + s.cash_payments, 0),
          card_payments: dailySummaries.reduce((sum, s) => sum + (s.card_payments || 0), 0),
          upi_payments: dailySummaries.reduce((sum, s) => sum + (s.upi_payments || 0), 0),

          expected_cash: dayClosureData.expected_amounts.cash,
          expected_card: dayClosureData.expected_amounts.card,
          expected_upi: dayClosureData.expected_amounts.upi,
          expected_total: dayClosureData.expected_amounts.total,

          actual_cash: dayClosureData.actual_amounts.cash,
          actual_card: dayClosureData.actual_amounts.card,
          actual_upi: dayClosureData.actual_amounts.upi,
          actual_total: dayClosureData.actual_amounts.total,

          variance_cash: dayClosureData.variance.cash,
          variance_card: dayClosureData.variance.card,
          variance_upi: dayClosureData.variance.upi,
          variance_total: dayClosureData.variance.total,

          payments: dayClosureData.payments,

          withdrawal_amount: dayClosureData.withdraw_amount,
          next_day_opening_balance: dayClosureData.next_day_opening_balance,

          closed_by: dayClosureData.closed_by,
          closed_at: dayClosureData.closed_at,
        });
        if (json?.success !== true) throw new Error(json?.detail || 'Failed to save settlement');

        // Mark closed on success
        setDayClosed(true);

        toast({
          title: 'Day Closed Successfully',
          description: `Day closed with total variance of ₹${variance.total.toFixed(2)}`,
          variant: variance.total === 0 ? 'default' : 'destructive',
        });
      } catch (e) {
        console.error('Failed to save settlement:', e);
        toast({ title: 'Save Failed', description: 'Could not save day closure', variant: 'destructive' });
        return;
      }

      // Keep values visible (read-only) after closure
      // (we no longer clear Withdraw/Next Day Opening once the day is closed)

    } catch (error) {
      console.error('Error during manual verification:', error);
      toast({
        title: "Error",
        description: "Failed to close the day. Please try again.",
        variant: "destructive"
      });
    } finally {
      setSubmittingManualVerification(false);
    }
  };

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    // Include normalized inflow/outflow types to match upstream data normalization
    const totalIncome = settlementData
      .filter(item => ['income', 'inflow', 'appointment', 'billing'].includes(item.type))
      .reduce((sum, item) => sum + item.amount, 0);

    const totalExpenses = settlementData
      .filter(item => item.type === 'expense' || item.type === 'outflow')
      .reduce((sum, item) => sum + item.amount, 0);

    const netAmount = totalIncome - totalExpenses;

    const appointmentRevenue = settlementData
      .filter(item => item.type === 'appointment')
      .reduce((sum, item) => sum + item.amount, 0);

    const billingRevenue = settlementData
      .filter(item => item.type === 'billing')
      .reduce((sum, item) => sum + item.amount, 0);

    const cashPayments = settlementData
      .filter(item => (item.payment_mode || 'cash').toLowerCase().includes('cash'))
      .reduce((sum, item) => sum + item.amount, 0);

    const digitalPayments = settlementData
      .filter(item => {
        const mode = (item.payment_mode || '').toLowerCase();
        return mode.includes('card') || mode.includes('upi') || mode.includes('digital');
      })
      .reduce((sum, item) => sum + item.amount, 0);

    return {
      totalIncome,
      totalExpenses,
      netAmount,
      appointmentRevenue,
      billingRevenue,
      cashPayments,
      digitalPayments,
      totalTransactions: settlementData.length
    };
  }, [settlementData]);

  const handlePrint = () => {
    setShowPrintView(true);
    setTimeout(() => {
      window.print();
      setShowPrintView(false);
    }, 500);
  };

  // Export functions
  const handleExportExcel = () => {
    const dataToExport = filteredSettlementData.map(item => ({
      Date: format(item.date, 'dd/MM/yyyy'),
      Time: format(item.date, 'HH:mm'),
      Type: item.type.toUpperCase(),
      'Customer Name': item.customer_name || '-',
      'Customer Phone': item.customer_phone || '-',
      'Staff Name': item.staff_name || '-',
      Description: item.description,
      Amount: item.amount,
      'Payment Mode': item.payment_mode || '-',
      Status: item.status.toUpperCase(),
      Source: item.source
    }));

    exportData('excel', {
      filename: `daily-settlement-${format(actualDateRange.start, 'yyyyMMdd')}-${format(actualDateRange.end, 'yyyyMMdd')}`,
      title: 'Daily Settlement Report',
      columns: [
        { header: 'Date', dataKey: 'Date', width: 12 },
        { header: 'Time', dataKey: 'Time', width: 10 },
        { header: 'Type', dataKey: 'Type', width: 12 },
        { header: 'Customer Name', dataKey: 'Customer Name', width: 20 },
        { header: 'Customer Phone', dataKey: 'Customer Phone', width: 15 },
        { header: 'Staff Name', dataKey: 'Staff Name', width: 18 },
        { header: 'Description', dataKey: 'Description', width: 30 },
        { header: 'Amount', dataKey: 'Amount', width: 12 },
        { header: 'Payment Mode', dataKey: 'Payment Mode', width: 15 },
        { header: 'Status', dataKey: 'Status', width: 12 },
        { header: 'Source', dataKey: 'Source', width: 15 }
      ],
      data: dataToExport
    });
  };

  // Multiple excel report variants (used by Reports dropdown near History search)
  const exportHistorySummaryExcel = () => {
    const rows = filteredHistorySummaries.map((s) => ({
      Date: format(new Date(s.date), 'dd/MM/yyyy'),
      'Opening Balance': Number(editableOpeningBalances[s.date] ?? s.opening_balance ?? 0) || 0,
      Income: Number(s.total_income ?? 0) || 0,
      Expenses: Number(s.total_expenses ?? 0) || 0,
      'Net Amount': Number(s.net_amount ?? 0) || 0,
      'Withdraw (only cash)': Number(s.withdrawal_amount ?? 0) || 0,
      'Next Day Opening': Number(s.next_day_opening_balance ?? 0) || 0,
    }));

    exportData('excel', {
      filename: `settlement-history-summary-${historyFrom}-${historyTo}`,
      title: 'Settlement History Summary',
      columns: [
        { header: 'Date', dataKey: 'Date', width: 12 },
        { header: 'Opening Balance', dataKey: 'Opening Balance', width: 16 },
        { header: 'Income', dataKey: 'Income', width: 12 },
        { header: 'Expenses', dataKey: 'Expenses', width: 12 },
        { header: 'Net Amount', dataKey: 'Net Amount', width: 14 },
        { header: 'Withdraw (only cash)', dataKey: 'Withdraw (only cash)', width: 18 },
        { header: 'Next Day Opening', dataKey: 'Next Day Opening', width: 16 },
      ],
      data: rows,
    });
  };

  const exportHistoryPaymodeExcel = () => {
    const modeNames = historyPaymentModes.map((pm) => pm.name);

    const rows = filteredHistorySummaries.map((s) => {
      const base: Record<string, any> = {
        Date: format(new Date(s.date), 'dd/MM/yyyy'),
      };

      historyPaymentModes.forEach((pm) => {
        const d = getPaymentDetail(s, pm.id);
        base[`${pm.name} (Actual)`] = d.actual;
        base[`${pm.name} (Entered)`] = d.entered;
        base[`${pm.name} (Variance)`] = d.variance;
      });

      return base;
    });

    const columns = [
      { header: 'Date', dataKey: 'Date', width: 12 },
      ...modeNames.flatMap((name) => [
        { header: `${name} (Actual)`, dataKey: `${name} (Actual)`, width: 14 },
        { header: `${name} (Entered)`, dataKey: `${name} (Entered)`, width: 14 },
        { header: `${name} (Variance)`, dataKey: `${name} (Variance)`, width: 14 },
      ]),
    ];

    exportData('excel', {
      filename: `settlement-history-paymodes-${historyFrom}-${historyTo}`,
      title: 'Settlement History - Paymode Variance',
      columns,
      data: rows,
    });
  };

  const exportTransactionsExcel = () => {
    // Reuse current settlement export, but name it as a transactions report
    handleExportExcel();
  };

  const exportDayCloseReconciliationExcel = () => {
    const cashAvailable = dailyTotals.cashAvailable;

    const rows = [
      {
        Metric: 'Cash Available',
        Amount: cashAvailable,
      },
      {
        Metric: 'Withdraw (only cash)',
        Amount: Number(withdraw ?? 0) || 0,
      },
      {
        Metric: 'Next Day Opening',
        Amount: Number(nextDayOpeningBal ?? 0) || 0,
      },
      {
        Metric: 'Variance (Total)',
        Amount: Number(manualInput.variance.total ?? 0) || 0,
      },
    ];

    exportData('excel', {
      filename: `day-close-reconciliation-${format(new Date(), 'yyyyMMdd')}`,
      title: 'Day Close Reconciliation',
      columns: [
        { header: 'Metric', dataKey: 'Metric', width: 26 },
        { header: 'Amount', dataKey: 'Amount', width: 14 },
      ],
      data: rows,
    });
  };

  const handleExportPDF = () => {
    const pdfData = filteredSettlementData.map(item => ({
      date: format(item.date, 'dd/MM/yyyy HH:mm'),
      type: item.type.toUpperCase(),
      customer: item.customer_name || '-',
      description: item.description,
      amount: `₹${item.amount.toLocaleString('en-IN')}`,
      payment: item.payment_mode || '-',
      status: item.status.toUpperCase()
    }));
    
    exportData('pdf', {
      filename: `daily-settlement-${format(actualDateRange.start, 'yyyyMMdd')}-${format(actualDateRange.end, 'yyyyMMdd')}`,
      title: 'Daily Settlement Report',
      columns: [
        { header: 'Date & Time', dataKey: 'date', width: 18 },
        { header: 'Type', dataKey: 'type', width: 12 },
        { header: 'Customer', dataKey: 'customer', width: 20 },
        { header: 'Description', dataKey: 'description', width: 30 },
        { header: 'Amount', dataKey: 'amount', width: 15 },
        { header: 'Payment', dataKey: 'payment', width: 15 },
        { header: 'Status', dataKey: 'status', width: 12 }
      ],
      data: pdfData
    });
  };

  // Effects
  useEffect(() => {
    fetchSettlementData();
  }, [actualDateRange, accountCode, retailCode]);

  // Determine if the current day is already closed by checking daily_settlement_summary (today row)
  useEffect(() => {
    if (!accountCode || !retailCode) return;

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let cancelled = false;

    (async () => {
      try {
        const rows = await SettlementService.getSettlementHistory({
          accountCode,
          retailCode,
          fromDate: todayStr,
          toDate: todayStr,
        });
        const hasToday = rows.some((r: any) => r?.date === todayStr);
        if (!cancelled) setDayClosed(hasToday);
      } catch {
        // best-effort; keep current state
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accountCode, retailCode]);

  // Initialize editable opening balances when daily summaries change
  useEffect(() => {
    const newEditableBalances: { [key: string]: string } = {};
    dailySummaries.forEach(summary => {
      if (!editableOpeningBalances[summary.date]) {
        newEditableBalances[summary.date] = (summary.opening_balance || 0).toString();
      }
    });
    
    if (Object.keys(newEditableBalances).length > 0) {
      setEditableOpeningBalances(prev => ({ ...prev, ...newEditableBalances }));
    }
  }, [dailySummaries]);

  // Prefill today's opening balance from yesterday's saved next_day_opening_balance
  useEffect(() => {
    if (!accountCode || !retailCode) return;
    if (dailySummaries.length === 0) return;

    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const hasToday = dailySummaries.some((s) => s.date === todayStr);
    if (!hasToday) return;

    const current = String(editableOpeningBalances[todayStr] ?? '').trim();
    // Don't override user-entered values; allow replacing empty/0.
    if (current !== '' && current !== '0' && current !== '0.0' && current !== '0.00') return;

    const key = `${accountCode}|${retailCode}|${todayStr}`;
    if (openingAutofillKeyRef.current === key) return;
    openingAutofillKeyRef.current = key;

    (async () => {
      try {
        const prevDateStr = format(subDays(new Date(todayStr), 1), 'yyyy-MM-dd');
        const rows = await SettlementService.getSettlementHistory({
          accountCode,
          retailCode,
          fromDate: prevDateStr,
          toDate: prevDateStr,
        });
        const prevRow = rows.find((r: any) => r?.date === prevDateStr) ?? rows[0];
        const ndRaw = prevRow?.next_day_opening_balance;
        const nd = typeof ndRaw === 'number' ? ndRaw : Number(ndRaw);
        if (!Number.isFinite(nd)) return;

        setEditableOpeningBalances((prev) => ({
          ...prev,
          [todayStr]: nd.toFixed(2),
        }));

        setDailySummaries((prev) =>
          prev.map((s) => (s.date === todayStr ? { ...s, opening_balance: nd } : s))
        );
      } catch {
        // silent: opening prefill is best-effort
      }
    })();
  }, [accountCode, retailCode, dailySummaries, editableOpeningBalances]);

  return (
    <div className="space-y-4 pt-3 sm:pt-4">
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <p className="text-red-700">{error}</p>
          </CardContent>
        </Card>
      )}


      {/* Main Content Area */}
      {viewType === 'summary' && (
        <>
          {/* Financial hierarchy: Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            {[
              {
                label: 'OPENING BALANCE',
                amount: dailyTotals.openingBalance,
                icon: <Wallet className="h-3 w-3 sm:h-4 sm:w-4" />,
                tone: 'from-blue-500/10 to-blue-500/5',
                iconTint: 'bg-blue-100 text-blue-600 ring-blue-200/60',
                amountClass: 'text-gray-900 dark:text-gray-100',
              },
              {
                label: 'INCOME',
                amount: dailyTotals.totalIncome,
                icon: <TrendingUp className="h-3 w-3 sm:h-4 sm:w-4" />,
                tone: 'from-emerald-500/10 to-emerald-500/5',
                iconTint: 'bg-emerald-100 text-emerald-600 ring-emerald-200/60',
                amountClass: 'text-gray-900 dark:text-gray-100',
              },
              {
                label: 'EXPENSES',
                amount: dailyTotals.totalExpenses,
                icon: <TrendingDown className="h-3 w-3 sm:h-4 sm:w-4" />,
                tone: 'from-rose-500/10 to-rose-500/5',
                iconTint: 'bg-rose-100 text-rose-600 ring-rose-200/60',
                amountClass: 'text-gray-900 dark:text-gray-100',
              },
              {
                label: 'NET AMOUNT',
                amount: dailyTotals.netAmount,
                icon: <IndianRupee className="h-3 w-3 sm:h-4 sm:w-4" />,
                tone: dailyTotals.netAmount >= 0 ? 'from-emerald-500/10 to-emerald-500/5' : 'from-orange-500/10 to-orange-500/5',
                iconTint: dailyTotals.netAmount >= 0 ? 'bg-emerald-100 text-emerald-600 ring-emerald-200/60' : 'bg-orange-100 text-orange-600 ring-orange-200/60',
                amountClass: dailyTotals.netAmount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-orange-700 dark:text-orange-400',
              },
            ].map((card) => (
              <div
                key={card.label}
                className="relative overflow-hidden rounded-xl border border-gray-200/70 dark:border-gray-800/60 bg-white dark:bg-gray-900 px-3 sm:px-5 py-3 sm:py-4 shadow-sm hover:shadow-md transition-shadow group min-h-[80px] sm:min-h-[112px]"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.tone} opacity-80 pointer-events-none`}></div>
                <div className="relative flex items-start justify-between gap-2 sm:gap-4 min-h-[56px] sm:min-h-[72px]">
                  <div className="w-full">
                    <div className="h-4 sm:h-5 flex items-end">
                      <p className="text-[10px] sm:text-[12px] font-semibold tracking-wide text-gray-600 dark:text-gray-400 uppercase leading-none whitespace-nowrap">{card.label}</p>
                    </div>
                    <div className="mt-1 sm:mt-2">
                      <div className="text-[9px] sm:text-[11px] text-gray-500">Amount</div>
                      <div className={`text-lg sm:text-2xl leading-none font-semibold tabular-nums ${card.amountClass}`}>₹{Number(card.amount || 0).toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                  <div className={`shrink-0 h-6 w-6 sm:h-8 sm:w-8 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>{card.icon}</div>
                </div>
                <div className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
              </div>
            ))}
          </div>

          {/* Daily Summary (audit-friendly) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CalendarDays className="h-4 w-4" />
                Daily Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  Loading summary data...
                </div>
              ) : dailySummaries.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  No data available for the selected period
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="text-sm">
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="h-8 px-2 text-xs">Date</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Opening</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Income</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Expenses</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Appointments(Qty)</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Billing(Qty)</TableHead>
                        <TableHead className="h-8 px-2 text-right text-xs">Gross Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailySummaries.map((summary) => (
                        <TableRow key={summary.date}>
                          <TableCell className="p-2 font-medium">
                            {format(new Date(summary.date), 'dd MMM yyyy')}
                          </TableCell>
                          <TableCell className="p-2 text-right text-blue-600">
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                value={editableOpeningBalances[summary.date] || '0'}
                                readOnly
                                aria-readonly="true"
                                className="w-28 h-9 text-sm text-right tabular-nums bg-muted/40"
                                step="0.01"
                                min="0"
                              />
                            </div>
                          </TableCell>
                          <TableCell className="p-2 text-right tabular-nums font-medium text-green-600">₹{summary.total_income.toLocaleString('en-IN')}</TableCell>
                          <TableCell className="p-2 text-right tabular-nums font-medium text-red-600">₹{summary.total_expenses.toLocaleString('en-IN')}</TableCell>
                          <TableCell className="p-2 text-right tabular-nums font-medium">{summary.appointment_count}</TableCell>
                          <TableCell className="p-2 text-right tabular-nums font-medium">{summary.billing_count}</TableCell>
                          <TableCell className={`p-2 text-right tabular-nums font-semibold ${summary.net_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>₹{summary.net_amount.toLocaleString('en-IN')}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {viewType === 'summary' && !loading && dailySummaries.length > 0 && (
                <div className="border-t pt-3">
                  <div className="mt-2 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-2">
                      {visiblePaymentModes.map((pm) => (
                        <div key={pm.id} className="space-y-1">
                          <Label className="text-xs" htmlFor={`manual-${pm.id}`}>{pm.name} Received</Label>
                          <Input
                            id={`manual-${pm.id}`}
                            type="number"
                            min="0"
                            placeholder="0.00"
                            value={(dailyTotals.expectedByModeId[pm.id] || 0).toFixed(2)}
                            readOnly
                            aria-readonly="true"
                            className="h-9 text-sm text-right bg-muted/40"
                          />
                        </div>
                      ))}

                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor="withdraw">Withdraw (only cash)</Label>
                        <Input
                          id="withdraw"
                          type="number"
                          min="0"
                          max={maxWithdraw}
                          placeholder="0.00"
                          value={withdraw}
                          disabled={dayClosed}
                          onChange={(e) => handleWithdrawChange(e.target.value)}
                          className={`h-9 text-sm text-right ${
                            dayClosed
                              ? 'bg-muted/40'
                              : manualInput.withdrawMissing || manualInput.errors.withdraw
                                ? 'border-red-500 focus-visible:ring-red-500'
                                : String(withdraw ?? '').trim() !== ''
                                  ? 'border-green-600 focus-visible:ring-green-600'
                                  : ''
                          }`}
                        />
                        {(manualInput.withdrawMissing || manualInput.errors.withdraw) && (
                          <div className="text-[11px] text-red-600">
                            {manualInput.withdrawMissing
                              ? 'Withdraw (only cash) is required.'
                              : `Values must be non-negative, and Withdraw (only cash) cannot exceed Cash Available (₹${maxWithdraw.toFixed(2)}).`}
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs" htmlFor="next-day-opening">Next Day Opening</Label>
                        <Input
                          id="next-day-opening"
                          type="number"
                          min="0"
                          placeholder="0.00"
                          value={nextDayOpeningBal}
                          readOnly
                          aria-readonly="true"
                          className="h-9 text-sm text-right bg-muted/40"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <div className="inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                        <div className="text-muted-foreground">Total variance</div>
                        <div className={`font-semibold tabular-nums ${Math.abs(manualInput.variance.total) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>
                          {manualInput.variance.total >= 0 ? '+' : ''}₹{manualInput.variance.total.toFixed(2)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      {dayClosed ? (
                        <div className="inline-flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
                          <CheckCircle className="h-4 w-4" />
                          Day Closed Successfully
                        </div>
                      ) : (
                        <div />
                      )}

                      <AlertDialog open={closeDayConfirmOpen} onOpenChange={setCloseDayConfirmOpen}>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" className="text-xs px-8" disabled={!canCloseDay}>
                            <CheckCircle className="h-4 w-4" />
                            Close Day
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Confirm Close Day</AlertDialogTitle>
                          </AlertDialogHeader>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="rounded-md border p-3">
                              <div className="text-xs text-muted-foreground">Withdraw(only cash)</div>
                              <div className="mt-1 font-semibold tabular-nums">₹{(manualInput.withdrawAmount ?? 0).toFixed(2)}</div>
                            </div>
                            <div className="rounded-md border p-3">
                              <div className="text-xs text-muted-foreground">Variance (Total)</div>
                              <div className={`mt-1 font-semibold tabular-nums ${Math.abs(manualInput.variance.total) < 0.005 ? 'text-green-600' : 'text-red-600'}`}>
                                {manualInput.variance.total >= 0 ? '+' : ''}₹{manualInput.variance.total.toFixed(2)}
                              </div>
                            </div>
                          </div>

                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={submittingManualVerification}>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              disabled={submittingManualVerification || !canCloseDay}
                              className="text-xs"
                              onClick={() => {
                                setCloseDayConfirmOpen(false);
                                handleManualVerification();
                              }}
                            >
                              Confirm
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

            {/* History Section */}
      {viewType === 'summary' && dailySummaries.length > 0 && (
        <Card>
          <CardHeader
            className="py-3 cursor-pointer select-none"
            role="button"
            tabIndex={0}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setHistoryOpen((v) => !v);
              }
            }}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4" />
                History
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setHistoryOpen((v) => !v);
                }}
              >
                {historyOpen ? 'Hide' : 'Show'}
                <ChevronDown className={`ml-1 h-4 w-4 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
              </Button>
            </div>
          </CardHeader>
          {historyOpen && (
            <CardContent>
              <div className="mb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 text-[11px] text-muted-foreground">From</div>
                  <Input
                    type="date"
                    value={historyFrom}
                    max={historyMaxDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHistoryFrom(v && v > historyMaxDate ? historyMaxDate : v);
                    }}
                    className="h-8 w-40 text-xs"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-10 text-[11px] text-muted-foreground">To</div>
                  <Input
                    type="date"
                    value={historyTo}
                    max={historyMaxDate}
                    onChange={(e) => {
                      const v = e.target.value;
                      setHistoryTo(v && v > historyMaxDate ? historyMaxDate : v);
                    }}
                    className="h-8 w-40 text-xs"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileText className="mr-1 h-4 w-4" />
                        Reports
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64">
                      <DropdownMenuLabel>Excel Reports</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          exportHistorySummaryExcel();
                        }}
                      >
                        History Summary (Excel)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          exportHistoryPaymodeExcel();
                        }}
                      >
                        History Paymode Variance (Excel)
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          exportDayCloseReconciliationExcel();
                        }}
                      >
                        Day Close Reconciliation (Excel)
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          exportTransactionsExcel();
                        }}
                      >
                        Transactions (Excel)
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="relative flex-1">
                    <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search"
                      className="h-8 text-xs pl-8"
                    />
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table className="text-xs">
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="h-8 px-2">Date</TableHead>
                      <TableHead className="h-8 px-2 text-right">Opening Bal</TableHead>
                      <TableHead className="h-8 px-2 text-right">Income</TableHead>
                      <TableHead className="h-8 px-2 text-right">Expenses</TableHead>
                      <TableHead className="h-8 px-2 text-right">Net Amount</TableHead>
                      <TableHead className="h-8 px-2 text-right">Withdraw(only cash)</TableHead>
                      <TableHead className="h-8 px-2 text-right">Next Day Opening</TableHead>
                      {historyPaymentModes.map((pm) => (
                        <TableHead key={pm.id} className="h-8 px-2 text-right">
                          {pm.name}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyLoading ? (
                      <TableRow>
                        <TableCell className="p-3 text-center text-muted-foreground" colSpan={7 + historyPaymentModes.length}>
                          Loading...
                        </TableCell>
                      </TableRow>
                    ) : filteredHistorySummaries.length === 0 ? (
                      <TableRow>
                        <TableCell className="p-3 text-center text-muted-foreground" colSpan={7 + historyPaymentModes.length}>
                          No records
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredHistorySummaries.map((summary) => (
                        <TableRow key={`hist-${summary.date}`}>
                        <TableCell className="p-2 font-medium">
                          {format(new Date(summary.date), 'dd MMM yyyy')}
                        </TableCell>
                        <TableCell className="p-2 text-right text-blue-600">
                          <div className="flex items-center justify-end space-x-1">
                            <span className="text-xs">₹</span>
                            <Input
                              type="number"
                              value={editableOpeningBalances[summary.date] || '0'}
                              readOnly
                              aria-readonly="true"
                              className="w-16 h-5 text-right text-blue-600 border-0 shadow-none p-0 text-xs focus:ring-1 focus:ring-blue-400"
                              step="0.01"
                              min="0"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="p-2 text-right text-green-600">
                          ₹{summary.total_income.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="p-2 text-right text-red-600">
                          ₹{summary.total_expenses.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className={`p-2 text-right font-medium ${summary.net_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          ₹{summary.net_amount.toLocaleString('en-IN')}
                        </TableCell>
                        <TableCell className="p-2 text-right">
                          <span className="text-sm font-semibold tabular-nums">
                            ₹{(summary.withdrawal_amount ?? 0).toLocaleString('en-IN')}
                          </span>
                        </TableCell>
                        <TableCell className="p-2 text-right">
                          ₹{(summary.next_day_opening_balance ?? 0).toLocaleString('en-IN')}
                        </TableCell>
                        {historyPaymentModes.map((pm) => {
                          const d = getPaymentDetail(summary, pm.id);
                          return (
                            <TableCell key={`${summary.date}-${pm.id}`} className="p-2 text-right">
                              <div className="leading-tight">
                                <div className="tabular-nums">₹{d.actual.toLocaleString('en-IN')}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  Entered: ₹{d.entered.toLocaleString('en-IN')}{' '}
                                  <span
                                    className={
                                      Math.abs(d.variance) < 0.005
                                        ? ''
                                        : d.variance >= 0
                                          ? 'text-green-600'
                                          : 'text-red-600'
                                    }
                                  >
                                    V: {d.variance >= 0 ? '+' : ''}₹{d.variance.toLocaleString('en-IN')}
                                  </span>
                                </div>
                              </div>
                            </TableCell>
                          );
                        })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      )}


      {viewType === 'detailed' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center">
                <BarChart3 className="h-5 w-5 mr-2" />
                Detailed Transactions
                {filteredSettlementData.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {filteredSettlementData.length} transactions
                  </Badge>
                )}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="h-6 w-6 animate-spin mr-2" />
                Loading transaction details...
              </div>
            ) : paginatedData.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No transactions found for the selected criteria
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date & Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Staff</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Source</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedData.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div>
                              <div>{format(item.date, 'dd MMM yyyy')}</div>
                              <div className="text-sm text-gray-500">
                                {format(item.date, 'HH:mm')}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.type === 'expense' ? 'destructive' :
                                item.type === 'appointment' ? 'default' :
                                item.type === 'billing' ? 'secondary' : 'outline'
                              }
                            >
                              {item.type.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div>
                              <div className="font-medium">{item.customer_name || '-'}</div>
                              {item.customer_phone && (
                                <div className="text-sm text-gray-500">{item.customer_phone}</div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{item.staff_name || '-'}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {item.description}
                          </TableCell>
                          <TableCell className={`text-right font-medium ${
                            item.type === 'expense' ? 'text-red-600' : 'text-green-600'
                          }`}>
                            ₹{item.amount.toLocaleString('en-IN')}
                          </TableCell>
                          <TableCell>{item.payment_mode || '-'}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                item.status === 'settled' || item.status === 'completed' ? 'default' :
                                item.status === 'advance' ? 'secondary' : 'outline'
                              }
                            >
                              {item.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {item.source}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-gray-600">
                      Showing {((currentPage - 1) * itemsPerPage) + 1} to {Math.min(currentPage * itemsPerPage, filteredSettlementData.length)} of {filteredSettlementData.length} transactions
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {viewType === 'analytics' && (
        <SettlementAnalytics 
          data={settlementData.map(item => ({
            ...item,
            type: item.type === 'inflow' ? 'income' as const : 
                  item.type === 'outflow' ? 'expense' as const : 
                  item.type
          }))} 
          dateRange={actualDateRange} 
        />
      )}

      {/* Print View */}
      {showPrintView && (
        <div className="fixed inset-0 bg-white z-50 overflow-auto print:relative print:inset-auto print:z-auto">
          <SettlementReport 
            data={filteredSettlementData.map(item => ({
              ...item,
              type: item.type === 'inflow' ? 'income' as const : 
                    item.type === 'outflow' ? 'expense' as const : 
                    item.type
            }))} 
            dateRange={actualDateRange}
            companyInfo={{
              name: "Retail Management System",
              address: "Business Address",
              phone: "Contact Number",
              email: "Contact Email"
            }}
          />
        </div>
      )}
    </div>
  );
}