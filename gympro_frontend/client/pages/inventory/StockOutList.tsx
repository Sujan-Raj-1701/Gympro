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
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
	AlertTriangle,
	ArrowLeft,
	ArrowUpDown,
	Building2,
	Calendar as CalendarIcon,
	CalendarDays,
	Eye,
	IndianRupee,
	PackageMinus,
	Pencil,
	Plus,
	Receipt,
	Search,
} from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { toast } from "@/hooks/use-toast";

type StockOutRow = {
	id: string;
	referenceNumber: string;
	entryDate: Date;
	reasonType: "damaged" | "expired" | "used" | "adjustment" | "lost" | "returned" | "transfer";
	itemsCount: number;
	totalQty: number;
	totalValue: number;
	status: "Y" | "N" | "C";
};

type StockOutView = {
	header: any;
	items: any[];
};

type StockOutRemarksPayload = {
	kind?: "stock_out";
	reasonType?: string;
	issuedTo?: string;
	notes?: string;
};

const REASON_TYPES = [
	{ value: "used", label: "Used in Service" },
	{ value: "damaged", label: "Damaged" },
	{ value: "expired", label: "Expired" },
	{ value: "adjustment", label: "Stock Adjustment" },
	{ value: "lost", label: "Lost/Missing" },
	{ value: "returned", label: "Return to Supplier" },
	{ value: "transfer", label: "Transfer" },
] as const;

export default function StockOutList() {
	const navigate = useNavigate();
	const { user } = useAuth();

	useEffect(() => {
		document.title = "Stock Out";
	}, []);

	const [searchQuery, setSearchQuery] = useState("");
	const [reasonFilterOpen, setReasonFilterOpen] = useState(false);
	const [reasonFilter, setReasonFilter] = useState<string>("all");
	const [statusFilter, setStatusFilter] = useState<"all" | "Y" | "N" | "C">("all");
	const [quickDateOpen, setQuickDateOpen] = useState(false);
	const [quickDate, setQuickDate] = useState<"custom" | "today" | "week" | "month">("today");
	const [fromDate, setFromDate] = useState<Date>(new Date());
	const [toDate, setToDate] = useState<Date>(new Date());
	const [rowsPerPage, setRowsPerPage] = useState("10");
	const [page, setPage] = useState(1);
	const [rows, setRows] = useState<StockOutRow[]>([]);
	const [listLoading, setListLoading] = useState(false);

	const [viewOpen, setViewOpen] = useState(false);
	const [viewId, setViewId] = useState<string>("");
	const [viewData, setViewData] = useState<StockOutView | null>(null);
	const [viewError, setViewError] = useState<string | null>(null);

	const parseRemarks = (raw: unknown): StockOutRemarksPayload | null => {
		const s = String(raw ?? "").trim();
		if (!s) return null;
		if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
			try {
				const parsed = JSON.parse(s);
				if (parsed && typeof parsed === "object") {
					const obj: any = parsed;
					if (obj.kind === "stock_out" || obj.reasonType || obj.issuedTo || obj.notes) {
						return {
							kind: obj.kind === "stock_out" ? "stock_out" : undefined,
							reasonType: typeof obj.reasonType === "string" ? obj.reasonType : undefined,
							issuedTo: typeof obj.issuedTo === "string" ? obj.issuedTo : undefined,
							notes: typeof obj.notes === "string" ? obj.notes : undefined,
						};
					}
				}
			} catch {
				// ignore
			}
		}
		return null;
	};

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
					stock_type: "O",
				});
				const dataRoot: any[] = res?.data ?? [];
				const mapped: StockOutRow[] = (Array.isArray(dataRoot) ? dataRoot : [])
					.filter((r) => r && r.stockin_id)
					.map((r) => {
						const d = r.received_date ? new Date(r.received_date) : (r.created_at ? new Date(r.created_at) : new Date());
						const billstatusRaw = String(r.billstatus || "Y").toUpperCase();
						const billstatus = (billstatusRaw === "N" || billstatusRaw === "C" ? billstatusRaw : "Y") as "Y" | "N" | "C";
						const remarks = parseRemarks(r.remarks);
						const reason = String(remarks?.reasonType || "used").toLowerCase();
						return {
							id: String(r.stockin_id),
							referenceNumber: String(r.stockin_id),
							entryDate: d,
							reasonType: (REASON_TYPES.some((x) => x.value === (reason as any)) ? (reason as any) : "used"),
							itemsCount: Number(r.items_count || 0),
							totalQty: Number(r.total_qty || 0),
							totalValue: Number(r.grand_total || 0),
							status: billstatus,
						};
					});
				if (!cancelled) setRows(mapped);
			} catch (e: any) {
				console.error("Failed to load Stock Out list", e);
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

	const selectedReasonLabel = useMemo(() => {
		if (reasonFilter === "all") return "All Reasons";
		const found = REASON_TYPES.find((r) => r.value === reasonFilter);
		return found?.label ?? reasonFilter;
	}, [reasonFilter]);

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
		const rangeStart = start <= end ? start : end;
		const rangeEnd = start <= end ? end : start;
		const reasonSelected = reasonFilter !== "all" ? reasonFilter : null;
		const statusSelected = statusFilter !== "all" ? statusFilter : null;

		return rows.filter((r) => {
			const reasonLabel = REASON_TYPES.find((x) => x.value === r.reasonType)?.label ?? r.reasonType;
			const matchesQuery =
				!q ||
				r.referenceNumber.toLowerCase().includes(q) ||
				reasonLabel.toLowerCase().includes(q);
			const inReason = !reasonSelected || r.reasonType === reasonSelected;
			const inStatus = !statusSelected || r.status === statusSelected;
			const date = r.entryDate instanceof Date ? r.entryDate : new Date(r.entryDate);
			const inRange = !Number.isNaN(date.getTime()) && date >= rangeStart && date <= rangeEnd;
			return matchesQuery && inReason && inStatus && inRange;
		});
	}, [rows, searchQuery, reasonFilter, statusFilter, fromDate, toDate]);

	const kpis = useMemo(() => {
		let totalValue = 0;
		let totalQty = 0;
		let count = 0;
		for (const r of filtered) {
			count += 1;
			totalValue += Number(r.totalValue || 0);
			totalQty += Number(r.totalQty || 0);
		}
		return { count, totalValue, totalQty };
	}, [filtered]);

	const statusLabel = (bs: "Y" | "N" | "C") => (bs === "Y" ? "Success" : bs === "N" ? "Hold" : "Cancelled");
	const statusPillClass = (bs: "Y" | "N" | "C") =>
		bs === "Y"
			? "bg-emerald-100 text-emerald-800 ring-emerald-200"
			: bs === "N"
				? "bg-amber-100 text-amber-900 ring-amber-200"
				: "bg-rose-100 text-rose-800 ring-rose-200";
	const rowTintClass = (bs: "Y" | "N" | "C") =>
		bs === "Y" ? "bg-emerald-50/40" : bs === "N" ? "bg-amber-50/40" : "bg-rose-50/40";

	const formatINR = (value: number) => {
		const n = Number(value || 0);
		return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
	};

	const openView = async (referenceNumber: string) => {
		setViewOpen(true);
		setViewId(referenceNumber);
		setViewError(null);
		setViewData(null);
		try {
			if (!user) throw new Error("Not logged in");
			const acc = (user as any)?.account_code;
			const ret = (user as any)?.retail_code;
			if (!acc || !ret) throw new Error("Missing account_code / retail_code");
			const res: any = await ApiService.post("/stock-in/get", {
				account_code: acc,
				retail_code: ret,
				stockin_id: referenceNumber,
			});
			const payload = res?.data ?? res;
			const data = payload?.data ?? payload;
			setViewData({ header: data?.header ?? {}, items: Array.isArray(data?.items) ? data.items : [] });
		} catch (e: any) {
			setViewError(e?.message || "Failed to load record");
			setViewData(null);
		}
	};

	const totalCount = filtered.length;
	const perPage = Math.max(parseInt(rowsPerPage || "10", 10) || 10, 1);
	const totalPages = Math.max(Math.ceil(totalCount / perPage), 1);
	const currentPage = Math.min(Math.max(page, 1), totalPages);
	const pageRows = filtered.slice((currentPage - 1) * perPage, currentPage * perPage);

	const showingStart = totalCount === 0 ? 0 : (currentPage - 1) * perPage + 1;
	const showingEnd = totalCount === 0 ? 0 : Math.min(currentPage * perPage, totalCount);

	return (
		<div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-3">
			<h1 className="sr-only">Stock Out</h1>
			<Card className="min-h-[calc(100vh-2rem)] flex flex-col border-slate-200 shadow-sm">
				<CardHeader className="pb-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 flex-1">
							<CardTitle className="text-xl shrink-0">Stock Out</CardTitle>
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
										placeholder="Search by stock-out ID, reason..."
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
							<Button onClick={() => navigate("/inventory/stock-out/add")}
							>
								<Plus className="h-4 w-4 mr-2" />
								Add Stock Out
							</Button>
						</div>
					</div>
				</CardHeader>

				<CardContent className="flex flex-1 flex-col gap-4 bg-white">
					<div className="grid grid-cols-1 items-end gap-3 xl:grid-cols-12">
						<div className="xl:col-span-3">
							<Label>Reason</Label>
							<Popover open={reasonFilterOpen} onOpenChange={setReasonFilterOpen}>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										role="combobox"
										aria-expanded={reasonFilterOpen}
										className="h-10 w-full justify-between"
									>
										<span className="flex items-center gap-2 min-w-0">
											<AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="truncate">{selectedReasonLabel}</span>
										</span>
										<ArrowUpDown className="h-4 w-4 opacity-50" />
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
									<Command>
										<CommandInput placeholder="Search reason..." className="h-9" />
										<CommandList>
											<CommandEmpty>No reasons found.</CommandEmpty>
											<CommandGroup>
												<CommandItem
													value="All Reasons"
													onSelect={() => {
														setReasonFilter("all");
														setReasonFilterOpen(false);
													}}
												>
													All Reasons
												</CommandItem>
												{REASON_TYPES.map((reason) => (
													<CommandItem
														key={reason.value}
														value={reason.label}
														onSelect={() => {
															setReasonFilter(reason.value);
															setPage(1);
															setReasonFilterOpen(false);
														}}
													>
														<span className="truncate">{reason.label}</span>
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
															setPage(1);
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
													setPage(1);
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
													setPage(1);
												}}
												initialFocus
											/>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						</div>
					</div>

						{/* KPI cards (same style as Stock In) */}
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4">
						{[
							{
								label: "STOCK OUT TOTAL",
								qty: kpis.count,
								amount: kpis.totalValue,
								icon: <Receipt className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-purple-500/10 to-purple-500/5",
								iconTint: "bg-purple-100 text-purple-600 ring-purple-200/60",
							},
							{
								label: "TOTAL QTY",
								qty: kpis.totalQty,
								amount: 0,
								icon: <PackageMinus className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-blue-500/10 to-blue-500/5",
								iconTint: "bg-blue-100 text-blue-600 ring-blue-200/60",
									qtyLabel: "Qty",
									amountLabel: "",
							},
							{
								label: "TOTAL VALUE",
								qty: kpis.count,
								amount: kpis.totalValue,
								icon: <IndianRupee className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-emerald-500/10 to-emerald-500/5",
								iconTint: "bg-emerald-100 text-emerald-700 ring-emerald-200/60",
							},
							{
								label: "REASONS",
								qty: new Set(filtered.map((r) => r.reasonType)).size,
								amount: 0,
								icon: <AlertTriangle className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-orange-500/10 to-orange-500/5",
								iconTint: "bg-orange-100 text-orange-700 ring-orange-200/60",
								qtyLabel: "Types",
								amountLabel: "",
							},
							{
								label: "STATUS",
								qty: filtered.filter((r) => r.status === "N").length,
								amount: 0,
								icon: <Building2 className="h-3 w-3 sm:h-4 sm:w-4" />,
								tone: "from-rose-500/10 to-rose-500/5",
								iconTint: "bg-rose-100 text-rose-700 ring-rose-200/60",
								qtyLabel: "Pending",
								amountLabel: "",
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
													<div className="text-[9px] sm:text-[11px] text-gray-500">{(card as any).amountLabel || "Amount"}</div>
													<div className="text-lg sm:text-2xl leading-none font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
														{(card as any).amountLabel === "" ? "" : formatINR(card.amount)}
													</div>
											</div>
										</div>
									</div>
									<div className={`shrink-0 h-6 w-6 sm:h-8 sm:w-8 rounded-md ${(card as any).iconTint} flex items-center justify-center ring-1 ring-inset group-hover:scale-110 transition-transform mt-1`}>{card.icon}</div>
								</div>
									<div className="absolute -right-4 -bottom-4 sm:-right-6 sm:-bottom-6 h-16 w-16 sm:h-24 sm:w-24 rounded-full bg-white/30 dark:bg-white/5 blur-2xl opacity-40"></div>
							</div>
						))}
					</div>

					<div className="flex-1 min-h-[420px] overflow-x-auto rounded-md border">
						<Table className="w-full min-w-[860px]">
							<TableHeader>
								<TableRow>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">STOCK OUT ID</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">ENTRY DATE</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">REASON TYPE</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">QTY</TableHead>
									<TableHead className="whitespace-nowrap text-right font-semibold text-slate-800">TOTAL VALUE</TableHead>
									<TableHead className="whitespace-nowrap font-semibold text-slate-800">STATUS</TableHead>
									<TableHead className="whitespace-nowrap text-center font-semibold text-slate-800">ACTION</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{pageRows.map((r) => (
									<TableRow key={r.id} className={rowTintClass(r.status)}>
										<TableCell className="font-medium whitespace-nowrap">{r.referenceNumber}</TableCell>
										<TableCell>{format(r.entryDate, "dd-MM-yyyy")}</TableCell>
										<TableCell>{REASON_TYPES.find((x) => x.value === r.reasonType)?.label ?? r.reasonType}</TableCell>
										<TableCell className="text-right">{r.totalQty}</TableCell>
										<TableCell className="text-right">{formatINR(r.totalValue)}</TableCell>
										<TableCell className="text-center">
											<span className={`inline-flex items-center justify-center rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusPillClass(r.status)}`}>
												{statusLabel(r.status)}
											</span>
										</TableCell>
										<TableCell className="text-center">
											<div className="flex items-center justify-center gap-2">
												<Button
													variant="outline"
													size="icon"
													aria-label="View"
													onClick={() => openView(r.referenceNumber)}
												>
													<Eye className="h-4 w-4" />
												</Button>
												<Button
													variant="outline"
													size="icon"
													aria-label="Edit"
													onClick={() => navigate(`/inventory/stock-out/edit/${encodeURIComponent(r.referenceNumber)}`)}
												>
													<Pencil className="h-4 w-4" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
								{pageRows.length === 0 && (
									<TableRow>
										<TableCell colSpan={7} className="h-[40vh] text-center align-middle text-sm text-muted-foreground">
											{listLoading ? "Loading..." : "No stock out entries found for the selected criteria."}
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
							<Select
								value={rowsPerPage}
								onValueChange={(v) => {
									setRowsPerPage(v);
									setPage(1);
								}}
							>
								<SelectTrigger className="w-[86px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="10">10</SelectItem>
									<SelectItem value="25">25</SelectItem>
									<SelectItem value="50">50</SelectItem>
								</SelectContent>
							</Select>
							<Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
								Prev
							</Button>
							<div className="text-sm tabular-nums">
								{currentPage} / {totalPages}
							</div>
							<Button variant="outline" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
								Next
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<Dialog
				open={viewOpen}
				onOpenChange={(open) => {
					setViewOpen(open);
					if (!open) {
						setViewId("");
						setViewData(null);
						setViewError(null);
					}
				}}
			>
				<DialogContent className="max-w-5xl">
					<DialogHeader>
						<DialogTitle>Stock Out Details</DialogTitle>
						<DialogDescription>{viewId ? `Stock Out ID: ${viewId}` : ""}</DialogDescription>
					</DialogHeader>

					{viewError && <div className="py-8 text-center text-sm text-destructive">{viewError}</div>}
					{!viewError && !viewData && <div className="py-8 text-center text-sm text-muted-foreground">No data</div>}
					{!viewError && viewData && (
						<div className="space-y-4">
							{(() => {
								const header = viewData?.header ?? {};
								const items = Array.isArray(viewData?.items) ? viewData.items : [];
								const remarks = parseRemarks((header as any)?.remarks);
								const reasonKey = String(remarks?.reasonType || "used").toLowerCase();
								const reasonLabel = REASON_TYPES.find((x) => x.value === (reasonKey as any))?.label ?? reasonKey;
								const issuedTo = remarks?.issuedTo || "-";
								const notes = remarks?.notes || "";
								const entryDateRaw = (header as any)?.received_date ?? (header as any)?.created_at;
								const entryDate = entryDateRaw ? new Date(String(entryDateRaw)) : null;
								const totalQty = items.reduce((s, it) => s + Number((it as any)?.quantity || 0), 0);
								const totalValue = Number((header as any)?.grand_total ?? (header as any)?.total ?? 0) || 0;

								return (
									<>
										<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
											<div className="rounded-md border p-3">
												<div className="text-xs font-semibold text-muted-foreground">Header</div>
												<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
													<div>
														<div className="text-xs text-muted-foreground">Reason</div>
														<div className="font-medium">{reasonLabel}</div>
													</div>
													<div>
														<div className="text-xs text-muted-foreground">Entry Date</div>
														<div className="font-medium">
															{entryDate && !Number.isNaN(entryDate.getTime()) ? format(entryDate, "dd-MM-yyyy") : "-"}
														</div>
													</div>
													<div>
														<div className="text-xs text-muted-foreground">Issued To</div>
														<div className="font-medium">{String(issuedTo || "-")}</div>
													</div>
												</div>
											</div>

											<div className="rounded-md border p-3">
												<div className="text-xs font-semibold text-muted-foreground">Totals</div>
												<div className="mt-3 grid grid-cols-2 gap-3 text-sm">
													<div className="text-muted-foreground">Items</div>
													<div className="text-right font-medium">{items.length}</div>
													<div className="text-muted-foreground">Total Qty</div>
													<div className="text-right font-medium">{totalQty}</div>
													<div className="text-muted-foreground">Total Value</div>
													<div className="text-right font-semibold">{formatINR(totalValue)}</div>
												</div>
											</div>
										</div>

										{notes ? (
											<div className="rounded-md border p-3">
												<div className="text-xs font-semibold text-muted-foreground">Notes</div>
												<div className="mt-2 text-sm whitespace-pre-wrap">{String(notes)}</div>
											</div>
										) : null}

										<Separator />

											<div className="overflow-x-auto rounded-md border">
												<Table className="min-w-[980px]">
												<TableHeader>
													<TableRow>
															<TableHead className="font-semibold text-slate-800">Item</TableHead>
															<TableHead className="font-semibold text-slate-800">Variant</TableHead>
															<TableHead className="font-semibold text-slate-800">Brand</TableHead>
															<TableHead className="text-right font-semibold text-slate-800">Qty</TableHead>
															<TableHead className="text-right font-semibold text-slate-800">Unit Cost</TableHead>
															<TableHead className="text-right font-semibold text-slate-800">Amount</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{items.map((it: any, idx: number) => (
														<TableRow key={String(idx)}>
															<TableCell className="font-medium">{String(it?.item_name || "-")}</TableCell>
																<TableCell>{String(it?.variant_name ?? it?.variantName ?? it?.variant_id ?? it?.variantId ?? "-")}</TableCell>
															<TableCell>{String(it?.brand || "-")}</TableCell>
															<TableCell className="text-right">{Number(it?.quantity || 0)}</TableCell>
															<TableCell className="text-right">{formatINR(Number(it?.unit_price || 0))}</TableCell>
															<TableCell className="text-right font-medium">{formatINR(Number(it?.net_amount ?? it?.amount ?? 0))}</TableCell>
														</TableRow>
													))}
													{items.length === 0 && (
														<TableRow>
																	<TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-6">
																No items
															</TableCell>
														</TableRow>
													)}
												</TableBody>
											</Table>
										</div>
									</>
								);
							})()}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
