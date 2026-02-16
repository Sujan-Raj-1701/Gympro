import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar as CalendarIcon, ArrowLeft, Plus, Search, ArrowUpDown, Building2, CalendarDays, Pencil, Receipt, IndianRupee, HandCoins, Eye, ReceiptText, X } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { DataService } from "@/services/userService";
import { MASTER_TABLES } from "@/services/masterTables";
import { toast } from "@/hooks/use-toast";

type PayModeOption = { value: string; label: string };

const FALLBACK_PAYMODE_OPTIONS: PayModeOption[] = [
	{ value: "cash", label: "Cash" },
	{ value: "card", label: "Card" },
	{ value: "upi", label: "UPI" },
	{ value: "bank", label: "Bank" },
];

const slugifyPayMode = (label: string) =>
	String(label || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, "_")
		.replace(/[^a-z0-9_]/g, "");

const normalizePayModeRows = (rows: any[]): PayModeOption[] => {
	const out: PayModeOption[] = [];
	const seen = new Set<string>();
	for (const r of rows || []) {
		const label = String(
			r?.payment_mode_name ??
			r?.mode_name ??
			r?.payment_mode ??
			r?.name ??
			r?.paymode ??
			r?.payment_name ??
			"",
		).trim();
		if (!label) continue;
		const value = slugifyPayMode(label);
		if (!value || seen.has(value)) continue;
		seen.add(value);
		out.push({ value, label });
	}
	return out;
};

type StockInRow = {
	id: string;
	purchaseId: string;
	purchaseDate: Date;
	supplier: string;
	supplierId?: string;
	supplierName?: string;
	billDate: Date;
	subtotal: number;
	tax: number;
	total: number;
	payment: number;
	balance: number;
	status: "paid" | "partial" | "unpaid";
	billstatus: "Y" | "N" | "C";
};

export default function StockInList() {
	const navigate = useNavigate();
	const { user } = useAuth();

	useEffect(() => {
		document.title = "Stock In";
	}, []);

	const [searchQuery, setSearchQuery] = useState("");
	const [supplierFilterOpen, setSupplierFilterOpen] = useState(false);
	const [supplierFilter, setSupplierFilter] = useState<string>("all");
	const [statusFilter, setStatusFilter] = useState<"all" | "Y" | "N" | "C">("all");
	const [quickDateOpen, setQuickDateOpen] = useState(false);
	const [quickDate, setQuickDate] = useState<"custom" | "today" | "week" | "month">("today");
	const [fromDate, setFromDate] = useState<Date>(new Date());
	const [toDate, setToDate] = useState<Date>(new Date());
	const [rowsPerPage, setRowsPerPage] = useState("10");
	const [page, setPage] = useState(1);
	const [rows, setRows] = useState<StockInRow[]>([]);
	const [listLoading, setListLoading] = useState(false);
	const [viewOpen, setViewOpen] = useState(false);
	const [viewStockInId, setViewStockInId] = useState<string>("");
	const [viewLoading, setViewLoading] = useState(false);
	const [viewError, setViewError] = useState<string | null>(null);
	const [viewData, setViewData] = useState<any | null>(null);
	const [viewCache, setViewCache] = useState<Record<string, any>>({});

	// Close Pending Modal States - Step-based workflow
	const [closePendingOpen, setClosePendingOpen] = useState(false);
	const [closePendingStep, setClosePendingStep] = useState<"suppliers" | "invoices" | "payment">("suppliers");
	
	// Suppliers list
	const [suppliersLoading, setSuppliersLoading] = useState(false);
	const [suppliersList, setSuppliersList] = useState<Array<{
		supplier_id: string | null;
		supplier_name: string | null;
		total_pending: number;
		invoice_count: number;
	}>>([]);
	
	// Selected supplier
	const [selectedSupplier, setSelectedSupplier] = useState<{
		supplier_id: string | null;
		supplier_name: string | null;
		total_pending: number;
		invoice_count: number;
	} | null>(null);
	
	// Invoices for selected supplier
	const [invoicesLoading, setInvoicesLoading] = useState(false);
	const [invoicesList, setInvoicesList] = useState<Array<{
		stockin_id: string;
		invoice_no: string;
		invoice_date: string;
		received_date: string;
		subtotal: number;
		total_tax: number;
		grand_total: number;
		paid_total: number;
		balance_due: number;
		status: string;
	}>>([]);
	
	// Payment modes
	const [closeVendorOpen, setCloseVendorOpen] = useState(false);
	const [closeVendorKey, setCloseVendorKey] = useState<string>("");
	const [closeSelectedVendor, setCloseSelectedVendor] = useState<{ key: string; label: string; supplierId?: string; supplierName?: string; pending: number } | null>(null);
	const [payModeOptions, setPayModeOptions] = useState<PayModeOption[]>(FALLBACK_PAYMODE_OPTIONS);
	const [payModeLoading, setPayModeLoading] = useState(false);
	const [closePayModeToAdd, setClosePayModeToAdd] = useState<string>("");
	const [closePayModes, setClosePayModes] = useState<string[]>([]);
	const [closePayAmounts, setClosePayAmounts] = useState<Record<string, string>>({});
	const [closeSaving, setCloseSaving] = useState(false);

	useEffect(() => {
		if (!closePendingOpen) return;
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		let cancelled = false;
		setPayModeLoading(true);
		(async () => {
			try {
				const res: any = await DataService.readData([MASTER_TABLES.paymode], acc, ret);
				const root = res?.data;
				const rows: any[] = Array.isArray(root)
					? root
					: (root?.[MASTER_TABLES.paymode] || root?.master_paymentmodes || root?.master_paymode || root?.master_payment_mode || []);
				const opts = normalizePayModeRows(rows);
				const next = opts.length ? opts : FALLBACK_PAYMODE_OPTIONS;
				if (!cancelled) {
					setPayModeOptions(next);
				}
			} catch (e: any) {
				console.error("Failed to load paymodes", e);
				if (!cancelled) {
					setPayModeOptions(FALLBACK_PAYMODE_OPTIONS);
				}
			} finally {
				if (!cancelled) setPayModeLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [closePendingOpen, user]);

	// Fetch suppliers with pending balances when modal opens
	useEffect(() => {
		if (!closePendingOpen) return;
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		let cancelled = false;
		setSuppliersLoading(true);
		(async () => {
			try {
				const res: any = await ApiService.post("/stock-in/suppliers-pending", {
					account_code: acc,
					retail_code: ret,
					from_date: format(fromDate, "yyyy-MM-dd"),
					to_date: format(toDate, "yyyy-MM-dd"),
					stock_type: "I",
				});
				if (!cancelled) {
					setSuppliersList(res?.data || []);
				}
			} catch (e: any) {
				console.error("Failed to load suppliers", e);
				if (!cancelled) {
					setSuppliersList([]);
					toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
				}
			} finally {
				if (!cancelled) setSuppliersLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [closePendingOpen, user, fromDate, toDate]);

	// Fetch invoices when a supplier is selected
	useEffect(() => {
		if (!selectedSupplier) return;
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		let cancelled = false;
		setInvoicesLoading(true);
		(async () => {
			try {
				const res: any = await ApiService.post("/stock-in/supplier-invoices", {
					account_code: acc,
					retail_code: ret,
					supplier_id: selectedSupplier.supplier_id,
					supplier_name: selectedSupplier.supplier_name,
					from_date: format(fromDate, "yyyy-MM-dd"),
					to_date: format(toDate, "yyyy-MM-dd"),
					stock_type: "I",
				});
				if (!cancelled) {
					setInvoicesList(res?.data || []);
				}
			} catch (e: any) {
				console.error("Failed to load invoices", e);
				if (!cancelled) {
					setInvoicesList([]);
					toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
				}
			} finally {
				if (!cancelled) setInvoicesLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [selectedSupplier, user, fromDate, toDate]);

	useEffect(() => {
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		let cancelled = false;
		setListLoading(true);
		(async () => {
			try {
				const res: any = await ApiService.post("/stock-in/list", {
					account_code: acc,
					retail_code: ret,
					from_date: format(fromDate, "yyyy-MM-dd"),
					to_date: format(toDate, "yyyy-MM-dd"),
					stock_type: "I",
				});
				const dataRoot: any[] = res?.data ?? [];
				const mapped: StockInRow[] = (Array.isArray(dataRoot) ? dataRoot : [])
					.filter((r) => r && r.stockin_id)
					.map((r) => {
						const purchaseDate = r.received_date ? new Date(r.received_date) : (r.created_at ? new Date(r.created_at) : new Date());
						const billDate = r.invoice_date ? new Date(r.invoice_date) : purchaseDate;
						const status = String(r.status || "unpaid").toLowerCase();
						const billstatusRaw = String(r.billstatus || "Y").toUpperCase();
						const billstatus = (billstatusRaw === "N" || billstatusRaw === "C" ? billstatusRaw : "Y") as "Y" | "N" | "C";
						const supplierId = String(r.supplier_id || "").trim() || undefined;
						const supplierName = String(r.supplier_name || "").trim() || undefined;
						const supplierLabel = String(supplierName || supplierId || "").trim();
						return {
							id: String(r.stockin_id),
							purchaseId: String(r.stockin_id),
							purchaseDate,
							supplier: supplierLabel,
							supplierId,
							supplierName,
							billDate,
							subtotal: Number(r.subtotal || 0),
							tax: Number(r.total_tax || 0),
							total: Number(r.grand_total || 0),
							payment: Number(r.paid_total || 0),
							balance: Number(r.balance_due || 0),
							status: (status === "paid" || status === "partial" ? (status as any) : "unpaid"),
							billstatus,
						};
					});
				if (!cancelled) setRows(mapped);
			} catch (e: any) {
				console.error("Failed to load Stock In list", e);
				if (!cancelled) {
					setRows([]);
					toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
				}
			} finally {
				if (!cancelled) setListLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [user, fromDate, toDate]);

	const supplierOptions = useMemo(() => {
		const unique = new Map<string, string>();
		for (const r of rows) {
			const name = String(r.supplier || "").trim();
			if (name) unique.set(name.toLowerCase(), name);
		}
		return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
	}, [rows]);

	const selectedSupplierLabel = supplierFilter === "all" ? "All Suppliers" : supplierFilter;

	const selectedQuickDateLabel =
		quickDate === "today"
			? "Today"
			: quickDate === "week"
				? "This Week"
				: quickDate === "month"
					? "This Month"
					: "Custom";

	const applyQuickDate = (preset: "today" | "week" | "month") => {
		const now = new Date();
		if (preset === "today") {
			setFromDate(now);
			setToDate(now);
			return;
		}
		if (preset === "week") {
			const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
			setFromDate(start);
			setToDate(now);
			return;
		}
		const start = new Date(now.getFullYear(), now.getMonth(), 1);
		setFromDate(start);
		setToDate(now);
	};

	const filtered = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		const start = new Date(fromDate);
		const end = new Date(toDate);
		start.setHours(0, 0, 0, 0);
		end.setHours(23, 59, 59, 999);
		// If user picked dates in reverse, normalize.
		const rangeStart = start <= end ? start : end;
		const rangeEnd = start <= end ? end : start;
		const supplierSelected = supplierFilter !== "all" ? supplierFilter : null;
		const statusSelected = statusFilter !== "all" ? statusFilter : null;

		return rows.filter((r) => {
			const matchesQuery =
				!q ||
				r.purchaseId.toLowerCase().includes(q) ||
				r.supplier.toLowerCase().includes(q);
			const inSupplier = !supplierSelected || r.supplier === supplierSelected;
			const inStatus = !statusSelected || r.billstatus === statusSelected;
			const date = r.purchaseDate instanceof Date ? r.purchaseDate : new Date(r.purchaseDate);
			const inRange = !Number.isNaN(date.getTime()) && date >= rangeStart && date <= rangeEnd;
			return matchesQuery && inSupplier && inStatus && inRange;
		});
	}, [rows, searchQuery, supplierFilter, statusFilter, fromDate, toDate]);

	const statusLabel = (bs: "Y" | "N" | "C") => (bs === "Y" ? "Success" : bs === "N" ? "Hold" : "Cancelled");
	const statusPillClass = (bs: "Y" | "N" | "C") =>
		bs === "Y"
			? "bg-emerald-100 text-emerald-800 ring-emerald-200"
			: bs === "N"
				? "bg-amber-100 text-amber-900 ring-amber-200"
				: "bg-rose-100 text-rose-800 ring-rose-200";
	const rowTintClass = (bs: "Y" | "N" | "C") =>
		bs === "Y" ? "bg-emerald-50/40" : bs === "N" ? "bg-amber-50/40" : "bg-rose-50/40";

	const kpis = useMemo(() => {
		const supplierSet = new Set<string>();
		let subtotal = 0;
		let tax = 0;
		let total = 0;
		let paid = 0;
		let paidCount = 0;
		let balance = 0;
		for (const r of filtered) {
			supplierSet.add(String(r.supplier || "").trim());
			subtotal += Number(r.subtotal || 0);
			tax += Number(r.tax || 0);
			total += Number(r.total || 0);
			const p = Number(r.payment || 0);
			paid += p;
			if (p > 0.0001) paidCount += 1;
			balance += Number(r.balance || 0);
		}
		return {
			count: filtered.length,
			suppliers: Array.from(supplierSet).filter(Boolean).length,
			subtotal,
			tax,
			total,
			paid,
			paidCount,
			balance,
		};
	}, [filtered]);

	const closePaidTotal = useMemo(() => {
		let sum = 0;
		for (const m of closePayModes) {
			const amt = Number(closePayAmounts[m] || 0);
			if (!Number.isFinite(amt) || amt <= 0) continue;
			sum += amt;
		}
		return sum;
	}, [closePayModes, closePayAmounts]);

	const addClosePayMode = (modeRaw?: string) => {
		const mode = String(modeRaw ?? closePayModeToAdd ?? "").trim();
		if (!mode) {
			setClosePayModeToAdd("");
			return;
		}
		if (closePayModes.includes(mode)) {
			setClosePayModeToAdd("");
			return;
		}
		setClosePayModes((prev) => [...prev, mode]);
		setClosePayAmounts((prev) => ({ ...prev, [mode]: prev[mode] ?? "" }));
		setClosePayModeToAdd("");
	};

	const removeClosePayMode = (mode: string) => {
		setClosePayModes((prev) => prev.filter((m) => m !== mode));
		setClosePayAmounts((prev) => {
			const next = { ...prev };
			delete next[mode];
			return next;
		});
	};

	const selectCloseSupplier = (v: { key: string; label: string; supplierId?: string; supplierName?: string; pending: number }) => {
		setCloseVendorKey(v.key);
		setCloseSelectedVendor(v);
		setCloseVendorOpen(false);
		setClosePayModes([]);
		setClosePayAmounts({});
	};

	const handleSupplierSelect = (supplier: {
		supplier_id: string | null;
		supplier_name: string | null;
		total_pending: number;
		invoice_count: number;
	}) => {
		setSelectedSupplier(supplier);
		setClosePendingStep("invoices");
		setClosePayModes([]);
		setClosePayAmounts({});
	};

	const handleBackToSuppliers = () => {
		setClosePendingStep("suppliers");
		setSelectedSupplier(null);
		setInvoicesList([]);
		setClosePayModes([]);
		setClosePayAmounts({});
	};

	const handleProceedToPayment = () => {
		setClosePendingStep("payment");
	};

	const handleBackToInvoices = () => {
		setClosePendingStep("invoices");
		setClosePayModes([]);
		setClosePayAmounts({});
	};

	const canSubmitClosePending = useMemo(() => {
		if (!selectedSupplier) return false;
		if (closeSaving) return false;
		if (closePayModes.length === 0) return false;
		if (!(closePaidTotal > 0.0001)) return false;
		const totalPending = selectedSupplier.total_pending || 0;
		if (closePaidTotal - totalPending > 0.0001) return false;
		return true;
	}, [selectedSupplier, closeSaving, closePayModes.length, closePaidTotal]);

	const submitClosePending = async () => {
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;
		if (!selectedSupplier) {
			toast({ title: "Select supplier", description: "Please select a supplier to close pending.", variant: "destructive" });
			return;
		}
		if (closePayModes.length === 0) {
			toast({ title: "Add payment mode", description: "Please add at least one payment mode.", variant: "destructive" });
			return;
		}
		const payments = closePayModes
			.map((m) => ({ pay_mode: m, amount: Number(closePayAmounts[m] || 0) }))
			.filter((p) => Number.isFinite(p.amount) && p.amount > 0);
		if (payments.length === 0) {
			toast({ title: "Enter amount", description: "Please enter payment amount.", variant: "destructive" });
			return;
		}
		const pending = selectedSupplier.total_pending || 0;
		if (pending <= 0.0001) {
			toast({ title: "No pending", description: "Selected supplier has no pending balance.", variant: "destructive" });
			return;
		}
		if (closePaidTotal - pending > 0.0001) {
			toast({ title: "Invalid amount", description: "Payment cannot exceed pending amount.", variant: "destructive" });
			return;
		}

		setCloseSaving(true);
		try {
			await ApiService.post("/stock-in/close-pending", {
				account_code: acc,
				retail_code: ret,
				supplier_id: selectedSupplier.supplier_id,
				supplier_name: selectedSupplier.supplier_name,
				from_date: format(fromDate, "yyyy-MM-dd"),
				to_date: format(toDate, "yyyy-MM-dd"),
				stock_type: "I",
				payments,
			});

			// Reload list to reflect new balances
			const res: any = await ApiService.post("/stock-in/list", {
				account_code: acc,
				retail_code: ret,
				from_date: format(fromDate, "yyyy-MM-dd"),
				to_date: format(toDate, "yyyy-MM-dd"),
				stock_type: "I",
			});
			const dataRoot: any[] = res?.data ?? [];
			const mapped: StockInRow[] = (Array.isArray(dataRoot) ? dataRoot : [])
				.filter((r) => r && r.stockin_id)
				.map((r) => {
					const purchaseDate = r.received_date ? new Date(r.received_date) : (r.created_at ? new Date(r.created_at) : new Date());
					const billDate = r.invoice_date ? new Date(r.invoice_date) : purchaseDate;
					const status = String(r.status || "unpaid").toLowerCase();
					const billstatusRaw = String(r.billstatus || "Y").toUpperCase();
					const billstatus = (billstatusRaw === "N" || billstatusRaw === "C" ? billstatusRaw : "Y") as "Y" | "N" | "C";
					const supplierId = String(r.supplier_id || "").trim() || undefined;
					const supplierName = String(r.supplier_name || "").trim() || undefined;
					const supplierLabel = String(supplierName || supplierId || "").trim();
					return {
						id: String(r.stockin_id),
						purchaseId: String(r.stockin_id),
						purchaseDate,
						supplier: supplierLabel,
						supplierId,
						supplierName,
						billDate,
						subtotal: Number(r.subtotal || 0),
						tax: Number(r.total_tax || 0),
						total: Number(r.grand_total || 0),
						payment: Number(r.paid_total || 0),
						balance: Number(r.balance_due || 0),
						status: (status === "paid" || status === "partial" ? (status as any) : "unpaid"),
						billstatus,
					};
				});
			setRows(mapped);

			toast({ title: "Payment successful", description: "Payment saved and balances updated." });
			setClosePendingOpen(false);
			setClosePendingStep("suppliers");
			setSelectedSupplier(null);
			setInvoicesList([]);
			setCloseVendorKey("");
			setCloseSelectedVendor(null);
			setClosePayModes([]);
			setClosePayAmounts({});
			setClosePayModeToAdd("");
		} catch (e: any) {
			console.error("Close pending failed", e);
			toast({ title: "Payment failed", description: e?.message || String(e), variant: "destructive" });
		} finally {
			setCloseSaving(false);
		}
	};

	const openClosePendingModal = () => {
		setClosePendingOpen(true);
		setClosePendingStep("suppliers");
		setSelectedSupplier(null);
		setInvoicesList([]);
		setCloseVendorKey("");
		setCloseSelectedVendor(null);
		setClosePayModes([]);
		setClosePayAmounts({});
		setClosePayModeToAdd("");
	};

	const formatINR = (value: number) => {
		const n = Number(value || 0);
		return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
	};

	const formatDateSafe = (value: any) => {
		if (!value) return "-";
		try {
			// Backend may send YYYY-MM-DD, datetime, or Date-ish
			const d = value instanceof Date ? value : new Date(String(value));
			if (Number.isNaN(d.getTime())) return String(value);
			return format(d, "dd-MM-yyyy");
		} catch {
			return String(value);
		}
	};

	useEffect(() => {
		if (!viewOpen) return;
		if (!user) return;
		if (!viewStockInId) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		const cached = viewCache[viewStockInId];
		if (cached) {
			setViewData(cached);
			setViewError(null);
			return;
		}

		let cancelled = false;
		setViewLoading(true);
		setViewError(null);
		setViewData(null);
		(async () => {
			try {
				const res: any = await ApiService.post("/stock-in/get", {
					account_code: acc,
					retail_code: ret,
					stockin_id: viewStockInId,
				});
				const payload = res?.data ?? res;
				const data = payload?.data ?? payload;
				if (!cancelled) {
					setViewData(data);
					setViewCache((prev) => ({ ...prev, [viewStockInId]: data }));
				}
			} catch (e: any) {
				console.error("Failed to load Stock In details", e);
				if (!cancelled) {
					setViewError(e?.message || "Failed to load details");
					toast({ title: "Load failed", description: e?.message || String(e), variant: "destructive" });
				}
			} finally {
				if (!cancelled) setViewLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [viewOpen, viewStockInId, user, viewCache]);

	const totalCount = filtered.length;
	const perPage = Math.max(parseInt(rowsPerPage || "10", 10) || 10, 1);
	const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
	const currentPage = Math.min(Math.max(page, 1), totalPages);
	const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

	const showingStart = totalCount === 0 ? 0 : (currentPage - 1) * perPage + 1;
	const showingEnd = totalCount === 0 ? 0 : Math.min(currentPage * perPage, totalCount);

	return (
		<div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-3">
			<h1 className="sr-only">Stock In</h1>
			<Card className="min-h-[calc(100vh-2rem)] flex flex-col border-slate-200 shadow-sm">
				<CardHeader className="pb-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 flex-1">
							<CardTitle className="text-xl shrink-0">Stock In</CardTitle>
							<div className="w-full sm:max-w-[520px]">
								<Label className="sr-only">Search</Label>
								<div className="relative">
									<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
									<Input
										value={searchQuery}
										onChange={(e) => {
											setSearchQuery(e.target.value);
											setPage(1);
										}}
										placeholder="Search by stock-in ID, supplier..."
										className="h-10 pl-10"
									/>
								</div>
							</div>
						</div>
						<div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
							<Link to="/inventory">
								<Button variant="outline">
									<ArrowLeft className="h-4 w-4 mr-2" />
									Back
								</Button>
							</Link>
							<Button
								variant="destructive"
								onClick={openClosePendingModal}
							>
								<HandCoins className="h-4 w-4 mr-2" />
								Close Pending
							</Button>
							<Button onClick={() => navigate("/inventory/stock-in/add")}>
								<Plus className="h-4 w-4 mr-2" />
								Add Stock In
							</Button>
						</div>
					</div>
				</CardHeader>

				<CardContent className="flex flex-1 flex-col gap-4 bg-white">
					<div className="grid grid-cols-1 items-end gap-3 xl:grid-cols-12">
						<div className="xl:col-span-3">
							<Label>Supplier</Label>
							<Popover open={supplierFilterOpen} onOpenChange={setSupplierFilterOpen}>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										role="combobox"
										aria-expanded={supplierFilterOpen}
										className="h-10 w-full justify-between"
									>
										<span className="flex items-center gap-2 min-w-0">
											<Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="truncate">{selectedSupplierLabel}</span>
										</span>
										<ArrowUpDown className="h-4 w-4 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
									<Command>
										<CommandInput placeholder="Search supplier..." className="h-9" />
										<CommandList>
											<CommandEmpty>No suppliers found.</CommandEmpty>
											<CommandGroup>
												<CommandItem
													value="All Suppliers"
													onSelect={() => {
														setSupplierFilter("all");
														setSupplierFilterOpen(false);
													}}
												>
													All Suppliers
												</CommandItem>
												{supplierOptions.map((name) => (
													<CommandItem
														key={name}
														value={name}
														onSelect={() => {
															setSupplierFilter(name);
															setSupplierFilterOpen(false);
													}}
												>
													<span className="truncate">{name}</span>
												</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
						</div>

						<div className="xl:col-span-2">
							<Label>Status</Label>
							<Select
								value={statusFilter}
								onValueChange={(v) => {
									setStatusFilter(v as any);
									setPage(1);
								}}
							>
								<SelectTrigger className="h-10 w-full">
									<SelectValue placeholder="All" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All</SelectItem>
									<SelectItem value="Y">Success</SelectItem>
									<SelectItem value="N">Hold</SelectItem>
									<SelectItem value="C">Cancelled</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="xl:col-span-2">
							<Label>Quick Date</Label>
							<Popover open={quickDateOpen} onOpenChange={setQuickDateOpen}>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										role="combobox"
										aria-expanded={quickDateOpen}
										className="h-10 w-full justify-between"
									>
										<span className="flex items-center gap-2 min-w-0">
											<CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="truncate">{selectedQuickDateLabel}</span>
										</span>
										<ArrowUpDown className="h-4 w-4 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
									<Command>
										<CommandInput placeholder="Search quick date..." className="h-9" />
										<CommandList>
											<CommandEmpty>No quick filters found.</CommandEmpty>
											<CommandGroup>
												{(
													[
														{ value: "today", label: "Today" },
														{ value: "week", label: "This Week" },
														{ value: "month", label: "This Month" },
														{ value: "custom", label: "Custom" },
													] as const
												).map((opt) => (
													<CommandItem
														key={opt.value}
														value={opt.label}
														onSelect={() => {
															setQuickDate(opt.value);
															if (opt.value === "today" || opt.value === "week" || opt.value === "month") {
																applyQuickDate(opt.value);
															}
															setQuickDateOpen(false);
														}}
													>
														{opt.label}
													</CommandItem>
												))}
											</CommandGroup>
										</CommandList>
									</Command>
								</PopoverContent>
							</Popover>
						</div>

						<div className="xl:col-span-5">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<div className="min-w-0">
									<Label>From</Label>
									<Popover>
										<PopoverTrigger asChild>
											<Button variant="outline" className="h-10 w-full justify-start text-left font-normal">
												<CalendarIcon className="mr-2 h-4 w-4" />
												{fromDate ? format(fromDate, "dd-MM-yyyy") : "Pick"}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto p-0">
											<Calendar
												mode="single"
												selected={fromDate}
												onSelect={(d) => {
													if (!d) return;
													setFromDate(d);
													setQuickDate("custom");
												}}
												initialFocus
											/>
										</PopoverContent>
									</Popover>
								</div>

								<div className="min-w-0">
									<Label>To</Label>
									<Popover>
										<PopoverTrigger asChild>
											<Button variant="outline" className="h-10 w-full justify-start text-left font-normal">
												<CalendarIcon className="mr-2 h-4 w-4" />
												{toDate ? format(toDate, "dd-MM-yyyy") : "Pick"}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto p-0">
											<Calendar
												mode="single"
												selected={toDate}
												onSelect={(d) => {
													if (!d) return;
													setToDate(d);
													setQuickDate("custom");
												}}
												initialFocus
											/>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						</div>
					</div>

					{/* KPI cards (same style as Billing page) */}
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4">
						{[
							{
								label: "STOCK IN TOTAL",
								qty: kpis.count,
								amount: kpis.total,
								icon: <Receipt className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-purple-500/10 to-purple-500/5",
								iconTint: "bg-purple-100 text-purple-600 ring-purple-200/60",
							},
							{
								label: "SUBTOTAL",
								qty: kpis.count,
								amount: kpis.subtotal,
								icon: <IndianRupee className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-blue-500/10 to-blue-500/5",
								iconTint: "bg-blue-100 text-blue-600 ring-blue-200/60",
							},
							{
								label: "TAX",
								qty: kpis.count,
								amount: kpis.tax,
								icon: <IndianRupee className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-emerald-500/10 to-emerald-500/5",
								iconTint: "bg-emerald-100 text-emerald-700 ring-emerald-200/60",
							},
							{
								label: "PAYMENT",
								qty: kpis.paidCount,
								amount: kpis.paid,
								icon: <HandCoins className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-orange-500/10 to-orange-500/5",
								iconTint: "bg-orange-100 text-orange-700 ring-orange-200/60",
							},
							{
								label: "BALANCE",
								qty: kpis.suppliers,
								amount: kpis.balance,
								icon: <Building2 className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-rose-500/10 to-rose-500/5",
								iconTint: "bg-rose-100 text-rose-700 ring-rose-200/60",
								qtyLabel: "Suppliers",
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
											<p className="text-[10px] sm:text-[12px] font-semibold tracking-wide text-gray-600 dark:text-gray-400 uppercase leading-none whitespace-nowrap">
												{card.label}
											</p>
										</div>
										<div className="mt-1 sm:mt-2 grid grid-cols-2 gap-1 sm:gap-2">
											<div>
												<div className="text-[9px] sm:text-[11px] text-gray-500">{(card as any).qtyLabel || "Qty"}</div>
												<div className="text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{card.qty}</div>
											</div>
											<div className="text-right">
												<div className="text-[9px] sm:text-[11px] text-gray-500">Amount</div>
												<div className="text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">{formatINR(card.amount)}</div>
											</div>
										</div>
									</div>
									<div className={`shrink-0 h-6 w-6 sm:h-8 sm:w-8 rounded-md ${card.iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>{card.icon}</div>
								</div>
								<div className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
							</div>
						))}
					</div>

					<div className="flex-1 min-h-[420px] overflow-x-auto rounded-md border">
						<Table className="w-full min-w-[1060px]">
							<TableHeader>
								<TableRow>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">STOCK IN ID</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">ENTRY DATE</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">SUPPLIER</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">BILL DATE</TableHead>
									<TableHead className="whitespace-nowrap text-center font-semibold text-slate-800">STATUS</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">SUBTOTAL</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">TAX</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">TOTAL</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">PAYMENT</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">BALANCE</TableHead>
									<TableHead className="whitespace-nowrap text-center font-semibold text-slate-800">ACTION</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pageRows.map((r) => (
									<TableRow key={r.id} className={rowTintClass(r.billstatus)}>
										<TableCell className="font-medium whitespace-nowrap">{r.purchaseId}</TableCell>
										<TableCell>{format(r.purchaseDate, "dd-MM-yyyy")}</TableCell>
										<TableCell>{r.supplier}</TableCell>
										<TableCell>{format(r.billDate, "dd-MM-yyyy")}</TableCell>
										<TableCell className="text-center">
											<span className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusPillClass(r.billstatus)}`}>
												{statusLabel(r.billstatus)}
											</span>
										</TableCell>
										<TableCell className="text-right">₹{r.subtotal.toLocaleString()}</TableCell>
										<TableCell className="text-right">₹{r.tax.toLocaleString()}</TableCell>
										<TableCell className="text-right">₹{r.total.toLocaleString()}</TableCell>
										<TableCell className="text-right font-semibold text-emerald-600">₹{r.payment.toLocaleString()}</TableCell>
										<TableCell className="text-right font-semibold text-red-600">₹{r.balance.toLocaleString()}</TableCell>
											<TableCell className="text-center">
												<div className="flex items-center justify-center gap-2">
													<Button
														variant="outline"
														size="icon"
														aria-label="View"
														onClick={() => {
															setViewStockInId(r.purchaseId);
															setViewOpen(true);
														}}
													>
														<Eye className="h-4 w-4" />
													</Button>
													<Button
														variant="outline"
														size="icon"
														aria-label="Edit"
														onClick={() => navigate(`/inventory/stock-in/edit/${encodeURIComponent(r.purchaseId)}`)}
													>
														<Pencil className="h-4 w-4" />
													</Button>
													<Button
														variant="outline"
														size="icon"
														aria-label="Invoice"
														onClick={() => window.open(`/inventory/stock-in/invoice/${encodeURIComponent(r.purchaseId)}`, "_blank")}
													>
														<ReceiptText className="h-4 w-4" />
													</Button>
												</div>
											</TableCell>
									</TableRow>
								))}
								{pageRows.length === 0 && (
									<TableRow>
										<TableCell colSpan={11} className="h-[40vh] text-center align-middle text-sm text-muted-foreground">
											{listLoading ? "Loading..." : "No stock in entries found for the selected criteria."}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>

					<div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
						<div className="text-sm text-muted-foreground">
							Showing {showingStart}–{showingEnd} of {totalCount}
						</div>

						<div className="flex items-center gap-2">
							<span className="text-sm text-muted-foreground">Rows:</span>
							<Select value={rowsPerPage} onValueChange={(v) => { setRowsPerPage(v); setPage(1); }}>
								<SelectTrigger className="w-[86px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="10">10</SelectItem>
									<SelectItem value="25">25</SelectItem>
									<SelectItem value="50">50</SelectItem>
								</SelectContent>
							</Select>
							<Button
								variant="outline"
								disabled={currentPage <= 1}
								onClick={() => setPage((p) => Math.max(1, p - 1))}
							>
								Prev
							</Button>
							<div className="text-sm tabular-nums">{currentPage} / {totalPages}</div>
							<Button
								variant="outline"
								disabled={currentPage >= totalPages}
								onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
							>
								Next
							</Button>
						</div>
					</div>

					<Dialog open={viewOpen} onOpenChange={(open) => {
						setViewOpen(open);
						if (!open) {
							setViewStockInId("");
							setViewError(null);
							setViewData(null);
						}
					}}>
						<DialogContent className="max-w-5xl">
							<DialogHeader>
								<DialogTitle>Stock In Details</DialogTitle>
								<DialogDescription>
									{viewStockInId ? `Stock In ID: ${viewStockInId}` : ""}
								</DialogDescription>
							</DialogHeader>

							{viewLoading && (
								<div className="py-8 text-center text-sm text-muted-foreground">Loading...</div>
							)}
							{!viewLoading && viewError && (
								<div className="py-8 text-center text-sm text-destructive">{viewError}</div>
							)}
							{!viewLoading && !viewError && viewData && (
								<div className="space-y-4">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div className="rounded-md border p-3">
											<div className="text-xs font-semibold text-muted-foreground">Supplier</div>
											<div className="text-sm font-medium">
												{String(viewData?.header?.supplier_name || viewData?.header?.supplier_id || "-")}
											</div>
											<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
												<div>
													<div className="text-xs text-muted-foreground">Entry Date</div>
													<div className="font-medium">{formatDateSafe(viewData?.header?.received_date || viewData?.header?.created_at)}</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground">Bill Date</div>
													<div className="font-medium">{formatDateSafe(viewData?.header?.invoice_date || viewData?.header?.received_date)}</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground">Invoice No</div>
													<div className="font-medium">{String(viewData?.header?.invoice_no || "-")}</div>
												</div>
												<div>
													<div className="text-xs text-muted-foreground">Status</div>
													<div className="font-medium capitalize">{String(viewData?.header?.status || "unpaid")}</div>
												</div>
											</div>
										</div>

										<div className="rounded-md border p-3">
											<div className="text-xs font-semibold text-muted-foreground">Totals</div>
											<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
												<div className="text-muted-foreground">Subtotal</div>
												<div className="text-right font-medium">{formatINR(Number(viewData?.header?.subtotal || 0))}</div>
												<div className="text-muted-foreground">Tax</div>
												<div className="text-right font-medium">{formatINR(Number(viewData?.header?.total_tax || 0))}</div>
												<div className="text-muted-foreground">Grand Total</div>
												<div className="text-right font-semibold">{formatINR(Number(viewData?.header?.grand_total || 0))}</div>
												<div className="text-muted-foreground">Paid</div>
												<div className="text-right font-medium">{formatINR(Number(viewData?.header?.paid_total || 0))}</div>
												<div className="text-muted-foreground">Balance</div>
												<div className="text-right font-medium">{formatINR(Number(viewData?.header?.balance_due || 0))}</div>
											</div>
										</div>
									</div>

									<Separator />

									<div className="overflow-x-auto rounded-md border">
										<Table className="min-w-[900px]">
											<TableHeader>
												<TableRow>
													<TableHead className="font-semibold">Item</TableHead>
													<TableHead className="font-semibold">Brand</TableHead>
													<TableHead className="text-right font-semibold">Qty</TableHead>
													<TableHead className="text-right font-semibold">Rate</TableHead>
													<TableHead className="text-right font-semibold">Discount</TableHead>
													<TableHead className="text-right font-semibold">Tax %</TableHead>
													<TableHead className="text-right font-semibold">Tax Amt</TableHead>
													<TableHead className="text-right font-semibold">Total</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{(viewData?.items || []).map((it: any, idx: number) => {
													const qty = Number(it?.quantity || 0);
													const rate = Number(it?.unit_price || 0);
													const disc = Number(it?.discount || 0);
													const taxPct = Number(it?.tax_percent || 0);
													const net = it?.net_amount != null ? Number(it.net_amount) : Math.max(0, qty * rate - disc);
													const taxAmt = it?.tax_amount != null ? Number(it.tax_amount) : net * (taxPct / 100);
													const gross = it?.gross_amount != null ? Number(it.gross_amount) : net + taxAmt;
													return (
														<TableRow key={String(it?.id ?? idx)}>
															<TableCell className="font-medium">{String(it?.item_name || "-")}</TableCell>
															<TableCell>{String(it?.brand || "-")}</TableCell>
															<TableCell className="text-right">{qty || 0}</TableCell>
															<TableCell className="text-right">{formatINR(rate)}</TableCell>
															<TableCell className="text-right">{formatINR(disc)}</TableCell>
															<TableCell className="text-right">{taxPct ? `${taxPct}%` : "0%"}</TableCell>
															<TableCell className="text-right">{formatINR(taxAmt)}</TableCell>
															<TableCell className="text-right font-medium">{formatINR(gross)}</TableCell>
														</TableRow>
													);
												})}
												{(viewData?.items || []).length === 0 && (
													<TableRow>
														<TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-6">
															No items
														</TableCell>
													</TableRow>
												)}
											</TableBody>
										</Table>
									</div>

									<Separator />

									<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
										<div className="text-sm">
											<div className="text-xs font-semibold text-muted-foreground">Payments</div>
											<div className="mt-1 flex flex-wrap gap-2">
												{(viewData?.payments || []).length ? (
													(viewData?.payments || []).map((p: any, idx: number) => (
														<span key={String(p?.id ?? idx)} className="inline-flex items-center gap-2 rounded border px-2 py-1 text-xs">
															<span className="capitalize">{String(p?.pay_mode || "-")}</span>
															<span className="font-semibold">{formatINR(Number(p?.amount || 0))}</span>
														</span>
													))
												) : (
													<span className="text-xs text-muted-foreground">No payments</span>
												)}
											</div>
										</div>

										<div className="flex items-center justify-end gap-2">
											<Button variant="outline" onClick={() => navigate(`/inventory/stock-in/edit/${encodeURIComponent(viewStockInId)}`)}>
												<Pencil className="h-4 w-4 mr-2" /> Edit
											</Button>
											<Button onClick={() => window.open(`/inventory/stock-in/invoice/${encodeURIComponent(viewStockInId)}`, "_blank")}>
												<ReceiptText className="h-4 w-4 mr-2" /> Invoice
											</Button>
										</div>
									</div>
								</div>
							)}
						</DialogContent>
					</Dialog>

					<Dialog open={closePendingOpen} onOpenChange={(open) => {
						setClosePendingOpen(open);
						if (!open) {
							setClosePendingStep("suppliers");
							setSelectedSupplier(null);
							setInvoicesList([]);
							setCloseVendorKey("");
							setCloseSelectedVendor(null);
							setClosePayModes([]);
							setClosePayAmounts({});
							setClosePayModeToAdd("");
						}
					}}>
						<DialogContent className="max-w-5xl max-h-[85vh] p-0 overflow-hidden flex flex-col">
							<div className="border-b bg-gradient-to-r from-slate-50 to-white px-6 py-4 shrink-0">
								<DialogTitle className="text-lg font-semibold">
									{closePendingStep === "suppliers" && "Select Supplier"}
									{closePendingStep === "invoices" && "Pending Invoices"}
									{closePendingStep === "payment" && "Payment Details"}
								</DialogTitle>
								{selectedSupplier && (
									<div className="mt-1 text-sm text-muted-foreground">
										{selectedSupplier.supplier_name || selectedSupplier.supplier_id}
									</div>
								)}
							</div>

							<div className="flex-1 overflow-y-auto p-6">
								{/* STEP 1: Suppliers List */}
								{closePendingStep === "suppliers" && (
									<div className="space-y-4">
										{suppliersLoading && (
											<div className="py-12 text-center text-sm text-muted-foreground">Loading suppliers...</div>
										)}

										{!suppliersLoading && suppliersList.length === 0 && (
											<div className="py-12 text-center text-sm text-muted-foreground">
												No suppliers with pending balance found for the selected date range.
											</div>
										)}

										{!suppliersLoading && suppliersList.length > 0 && (
											<div className="rounded-lg border overflow-hidden">
												<Table>
													<TableHeader>
														<TableRow className="bg-slate-50">
															<TableHead className="font-semibold">SUPPLIER</TableHead>
															<TableHead className="text-center font-semibold">INVOICES</TableHead>
															<TableHead className="text-right font-semibold">PENDING AMOUNT</TableHead>
															<TableHead className="text-center font-semibold w-[100px]">ACTION</TableHead>
														</TableRow>
													</TableHeader>
													<TableBody>
														{suppliersList.map((supplier, idx) => (
															<TableRow key={idx} className="hover:bg-slate-50/50">
																<TableCell className="font-medium">
																	{supplier.supplier_name || supplier.supplier_id || "-"}
																</TableCell>
																<TableCell className="text-center">
																	<span className="inline-flex items-center justify-center rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
																		{supplier.invoice_count}
																	</span>
																</TableCell>
																<TableCell className="text-right">
																	<span className="font-semibold text-red-600">
																		₹{Math.round(supplier.total_pending).toLocaleString("en-IN")}
																	</span>
																</TableCell>
																<TableCell className="text-center">
																	<Button
																		size="sm"
																		onClick={() => handleSupplierSelect(supplier)}
																	>
																		<Eye className="h-4 w-4 mr-1" />
																		View
																	</Button>
																</TableCell>
															</TableRow>
														))}
													</TableBody>
												</Table>
											</div>
										)}
									</div>
								)}

								{/* STEP 2: Invoices List */}
								{closePendingStep === "invoices" && selectedSupplier && (
									<div className="space-y-4">
										<div className="flex items-center justify-between">
											<div>
												<div className="text-lg font-semibold">
													{selectedSupplier.supplier_name || selectedSupplier.supplier_id}
												</div>
												<div className="text-sm text-muted-foreground">
													Total Pending: <span className="font-semibold text-red-600">₹{Math.round(selectedSupplier.total_pending).toLocaleString("en-IN")}</span>
												</div>
											</div>
											<Button variant="outline" size="sm" onClick={handleBackToSuppliers}>
												<ArrowLeft className="h-4 w-4 mr-1" />
												Back
											</Button>
										</div>

										{invoicesLoading && (
											<div className="py-12 text-center text-sm text-muted-foreground">Loading invoices...</div>
										)}

										{!invoicesLoading && invoicesList.length === 0 && (
											<div className="py-12 text-center text-sm text-muted-foreground">
												No pending invoices found.
											</div>
										)}

										{!invoicesLoading && invoicesList.length > 0 && (
											<>
												<div className="rounded-lg border overflow-hidden">
													<Table>
														<TableHeader>
															<TableRow className="bg-slate-50">
																<TableHead className="font-semibold">STOCK IN ID</TableHead>
																<TableHead className="font-semibold">INVOICE NO</TableHead>
																<TableHead className="font-semibold">INVOICE DATE</TableHead>
																<TableHead className="text-right font-semibold">TOTAL</TableHead>
																<TableHead className="text-right font-semibold">PAID</TableHead>
																<TableHead className="text-right font-semibold">BALANCE</TableHead>
															</TableRow>
														</TableHeader>
														<TableBody>
															{invoicesList.map((invoice, idx) => (
																<TableRow key={idx} className="hover:bg-slate-50/50">
																	<TableCell className="font-medium">{invoice.stockin_id}</TableCell>
																	<TableCell>{invoice.invoice_no || "-"}</TableCell>
																	<TableCell>{formatDateSafe(invoice.invoice_date)}</TableCell>
																	<TableCell className="text-right">₹{Math.round(invoice.grand_total).toLocaleString("en-IN")}</TableCell>
																	<TableCell className="text-right text-emerald-600">₹{Math.round(invoice.paid_total).toLocaleString("en-IN")}</TableCell>
																	<TableCell className="text-right font-semibold text-red-600">₹{Math.round(invoice.balance_due).toLocaleString("en-IN")}</TableCell>
																</TableRow>
															))}
														</TableBody>
													</Table>
												</div>

												<div className="flex justify-end">
													<Button onClick={handleProceedToPayment}>
														Proceed to Payment
													</Button>
												</div>
											</>
										)}
									</div>
								)}

								{/* STEP 3: Payment Form */}
								{closePendingStep === "payment" && selectedSupplier && (
									<div className="space-y-6">
										<div className="flex items-center justify-between">
											<div>
												<div className="text-lg font-semibold">Make Payment</div>
												<div className="text-sm text-muted-foreground mt-1">
													{selectedSupplier.supplier_name || selectedSupplier.supplier_id}
												</div>
											</div>
											<Button variant="outline" size="sm" onClick={handleBackToInvoices}>
												<ArrowLeft className="h-4 w-4 mr-1" />
												Back
											</Button>
										</div>

										<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
											{/* Payment Modes */}
											<div className="space-y-4">
												<div className="rounded-lg border bg-slate-50/50 p-4">
													<div className="text-sm font-semibold mb-4">Add Payment Modes</div>
													<div>
														<Label>Select Payment Mode</Label>
														<Select value={closePayModeToAdd} onValueChange={(v) => addClosePayMode(v)}>
															<SelectTrigger className="h-10">
																<SelectValue placeholder={payModeLoading ? "Loading..." : "Select..."} />
															</SelectTrigger>
															<SelectContent>
																{payModeOptions.map((opt) => (
																	<SelectItem key={opt.value} value={opt.value}>
																		{opt.label}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</div>
												</div>

												{closePayModes.length > 0 && (
													<div className="space-y-3">
														{closePayModes.map((m) => {
															const label = payModeOptions.find((x) => x.value === m)?.label || m;
															return (
																<div key={m} className="rounded-lg border bg-white p-4">
																	<div className="flex items-center justify-between gap-3 mb-3">
																		<div className="font-semibold text-sm">{label}</div>
																		<Button type="button" variant="ghost" size="sm" onClick={() => removeClosePayMode(m)}>
																			<X className="h-4 w-4 mr-1" />
																			Remove
																		</Button>
																	</div>
																	<div>
																		<Label>Amount</Label>
																		<Input
																			inputMode="decimal"
																			placeholder="0.00"
																			value={closePayAmounts[m] ?? ""}
																			onChange={(e) => setClosePayAmounts((prev) => ({ ...prev, [m]: e.target.value }))}
																			className="h-10 text-right font-semibold"
																		/>
																	</div>
																</div>
															);
														})}
													</div>
												)}

												{closePayModes.length === 0 && (
													<div className="py-6 text-center text-sm text-muted-foreground">
														No payment modes added yet
													</div>
												)}
											</div>

											{/* Summary */}
											<div className="space-y-4">
												<div className="rounded-lg border bg-gradient-to-br from-slate-50 to-white p-5 sticky top-0">
													<div className="text-sm font-semibold mb-4">Payment Summary</div>
													<div className="space-y-3">
														<div className="flex justify-between">
															<span className="text-sm text-muted-foreground">Supplier</span>
															<span className="text-sm font-medium truncate max-w-[200px]">
																{selectedSupplier.supplier_name || selectedSupplier.supplier_id}
															</span>
														</div>
														<div className="flex justify-between">
															<span className="text-sm text-muted-foreground">Invoices</span>
															<span className="text-sm font-semibold">{selectedSupplier.invoice_count}</span>
														</div>
														<Separator />
														<div className="flex justify-between">
															<span className="text-sm text-muted-foreground">Total Pending</span>
															<span className="text-sm font-semibold text-red-600">
																₹{Math.round(selectedSupplier.total_pending).toLocaleString("en-IN")}
															</span>
														</div>
														<div className="flex justify-between">
															<span className="text-sm text-muted-foreground">Paying Now</span>
															<span className="text-sm font-semibold text-emerald-600">
																₹{Math.round(closePaidTotal).toLocaleString("en-IN")}
															</span>
														</div>
														<div className="flex justify-between">
															<span className="text-sm text-muted-foreground">Remaining</span>
															<span className="text-sm font-semibold">
																₹{Math.round(Math.max(0, selectedSupplier.total_pending - closePaidTotal)).toLocaleString("en-IN")}
															</span>
														</div>
														<Separator />
														<div className="pt-2">
															<Button 
																className="w-full" 
																onClick={submitClosePending} 
																disabled={!canSubmitClosePending}
															>
																{closeSaving ? "Processing..." : "Submit Payment"}
															</Button>
														</div>
													</div>
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						</DialogContent>
					</Dialog>
				</CardContent>
			</Card>
		</div>
	);
}
