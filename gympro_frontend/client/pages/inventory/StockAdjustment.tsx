import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Search, ArrowUpDown, ChevronDown, ChevronUp } from "lucide-react";
import { ApiService } from "@/services/apiService";
import { useToast } from "@/hooks/use-toast";

type CurrentStockRow = {
	id: number;
	account_code?: string;
	retail_code?: string;
	item_id: string;
	item_name: string;
	variant_id?: string;
	opening_qty?: number;
	purchase_qty?: number;
	out_qty?: number;
	damage_qty?: number;
	audit_qty?: number;
	current_qty: number;
	stock_date?: string;
};

type MasterVariantLite = {
	id: number;
	variant_id: string;
	variant_name: string;
	size?: string;
	color?: string;
	width?: string;
	status?: number;
};

const parseNumberOrEmpty = (raw: string): number | "" => {
	const s = raw.trim();
	if (!s) return "";
	const n = Number(s);
	return Number.isFinite(n) ? n : "";
};

const formatLocalYYYYMMDD = (d: Date): string => {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
};

const extractDateKey = (raw?: string): string => {
	if (!raw) return "";
	const s = String(raw).trim();
	const iso = s.match(/\d{4}-\d{2}-\d{2}/);
	if (iso) return iso[0];
	return "";
};

export default function StockAdjustment() {
	const { user } = useAuth();
	const { toast } = useToast();

	useEffect(() => {
		document.title = "Stock Adjustment";
	}, []);

	const [searchQuery, setSearchQuery] = useState("");
	const [rows, setRows] = useState<CurrentStockRow[]>([]);
	const [masterVariants, setMasterVariants] = useState<MasterVariantLite[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [adjustments, setAdjustments] = useState<Record<number, number | "">>({});
	const [remarks, setRemarks] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [page, setPage] = useState(1);
	const [rowsPerPage, setRowsPerPage] = useState("10");
	type SortKey = "item" | "currentQty" | "adjustment";
	const [sortKey, setSortKey] = useState<SortKey>("item");
	const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

	const variantNameById = useMemo(() => {
		const m = new Map<string, MasterVariantLite>();
		for (const v of masterVariants) {
			const id = String(v.variant_id || "").trim();
			const name = String(v.variant_name || "").trim();
			if (id && name) m.set(id, v);
		}
		return m;
	}, [masterVariants]);

	const submitLines = useMemo(() => {
		const lines: Array<{
			item_id: string;
			item_name: string;
			variant_id?: string;
			variant_name?: string;
			current_qty: number;
			adjustment_qty: number;
		}> = [];

		for (const r of rows) {
			const rawAdj = adjustments[r.id];
			if (typeof rawAdj !== "number" || !Number.isFinite(rawAdj) || rawAdj === 0) continue;
			const v = r.variant_id ? variantNameById.get(r.variant_id) : undefined;
			const metaParts = [v?.size, v?.color, v?.width].filter(Boolean) as string[];
			const variantDisplay = v?.variant_name
				? `${v.variant_name}${metaParts.length ? ` (${metaParts.join(" • ")})` : ""}`
				: undefined;
			lines.push({
				item_id: r.item_id,
				item_name: r.item_name,
				variant_id: r.variant_id,
				variant_name: variantDisplay?.slice(0, 150),
				current_qty: Number(r.current_qty || 0),
				adjustment_qty: rawAdj,
			});
		}

		return lines;
	}, [rows, adjustments, variantNameById]);

	const confirmAndSubmit = async () => {
		if (submitting || loading) return;
		// Let handleSubmit show validation toasts for missing user / empty lines
		if (!user || submitLines.length === 0) {
			await handleSubmit();
			return;
		}
		const msg = `Submit ${submitLines.length} adjustment line(s)?`;
		const ok = window.confirm(msg);
		if (!ok) return;
		await handleSubmit();
	};

	const handleSubmit = async () => {
		if (submitting) return;
		if (!user) {
			toast({ title: "Not logged in", description: "Please login and try again.", variant: "destructive" });
			return;
		}
		if (submitLines.length === 0) {
			toast({ title: "Nothing to submit", description: "Enter a non-zero adjustment for at least one item." });
			return;
		}

		setSubmitting(true);
		try {
			const res: any = await ApiService.post("/stock-adjustment/create", {
				remarks: remarks || undefined,
				lines: submitLines,
			});
			const data = res?.data?.data ?? res?.data ?? res;
			toast({
				title: "Stock adjustment saved",
				description: data?.adjustment_id ? `Adjustment ID: ${data.adjustment_id}` : `Saved ${submitLines.length} line(s)`,
			});
			setAdjustments({});
			setRemarks("");
		} catch (e: any) {
			const msg = e?.response?.data?.detail || e?.message || "Failed to submit stock adjustment";
			toast({ title: "Submit failed", description: String(msg), variant: "destructive" });
		} finally {
			setSubmitting(false);
		}
	};

	useEffect(() => {
		if (!user) return;
		const acc = (user as any)?.account_code;
		const ret = (user as any)?.retail_code;
		if (!acc || !ret) return;

		let cancelled = false;
		(async () => {
			setLoading(true);
			setError(null);
			try {
				const res: any = await ApiService.post("/read", {
					tables: ["current_stock", "master_variants"],
					account_code: acc,
					retail_code: ret,
				});
				const dataRoot: any = res?.data ?? res ?? {};

				const extract = (primary: string, aliases: string[]): any[] => {
					if (Array.isArray(dataRoot)) return dataRoot;
					if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
					for (const k of aliases) {
						if (Array.isArray(dataRoot[k])) return dataRoot[k];
					}
					const lower = primary.toLowerCase();
					for (const k of Object.keys(dataRoot)) {
						if (k.toLowerCase().includes(lower) && Array.isArray(dataRoot[k])) return dataRoot[k];
					}
					return [];
				};

				const stockRows = extract("current_stock", ["current_stock", "stock", "stocks", "inventory_stock"]);
				const variantRows = extract("master_variants", ["variant", "variants", "master_variants", "master_variant"]);
				const normalizedVariants: MasterVariantLite[] = (variantRows || [])
					.filter((v: any) => v && (v.status == null || v.status === 1))
					.map((v: any) => {
						const idNum = Number(v.id ?? 0);
						const variantId = String(v.variant_id ?? v.variantId ?? v.code ?? "").trim();
						const variantName = String(v.variant_name ?? v.variantName ?? v.name ?? v.label ?? "").trim();
						const size = String(v.size ?? v.variant_size ?? v.size_name ?? v.sizeName ?? "").trim();
						const color = String(v.color ?? v.variant_color ?? v.color_name ?? v.colorName ?? "").trim();
						const width = String(v.width ?? v.variant_width ?? v.width_name ?? v.widthName ?? "").trim();
						const statusNum = v.status != null ? Number(v.status) : undefined;
						return {
							id: Number.isFinite(idNum) ? idNum : 0,
							variant_id: variantId,
							variant_name: variantName,
							size: size || undefined,
							color: color || undefined,
							width: width || undefined,
							status: Number.isFinite(statusNum as any) ? statusNum : undefined,
						};
					})
					.filter((v: MasterVariantLite) => v.id && v.variant_id && v.variant_name);

				let normalized: CurrentStockRow[] = (stockRows || [])
					.map((s: any) => {
						const idNum = Number(s?.id ?? 0);
						const itemId = String(s?.item_id ?? s?.itemId ?? "").trim();
						const itemName = String(s?.item_name ?? s?.itemName ?? "").trim();
						const variantId = String(s?.variant_id ?? s?.variantId ?? "").trim();
						const currentQty = Number(s?.current_qty ?? s?.currentQty ?? s?.current_stock ?? s?.currentStock ?? 0);
						return {
							id: Number.isFinite(idNum) ? idNum : 0,
							account_code: s?.account_code,
							retail_code: s?.retail_code,
							item_id: itemId,
							item_name: itemName,
							variant_id: variantId || undefined,
							opening_qty: s?.opening_qty != null ? Number(s.opening_qty) : undefined,
							purchase_qty: s?.purchase_qty != null ? Number(s.purchase_qty) : undefined,
							out_qty: s?.out_qty != null ? Number(s.out_qty) : undefined,
							damage_qty: s?.damage_qty != null ? Number(s.damage_qty) : undefined,
							audit_qty: s?.audit_qty != null ? Number(s.audit_qty) : undefined,
							current_qty: Number.isFinite(currentQty) ? currentQty : 0,
							stock_date: s?.stock_date ? String(s.stock_date) : undefined,
						};
					})
					.filter((r) => r.id && r.item_id && r.item_name);

				// Load only today's stock rows when stock_date is available
				const hasAnyStockDate = normalized.some((r) => !!extractDateKey(r.stock_date));
				if (hasAnyStockDate) {
					const todayKey = formatLocalYYYYMMDD(new Date());
					normalized = normalized.filter((r) => extractDateKey(r.stock_date) === todayKey);
				}

				if (!cancelled) {
					setRows(normalized);
					setMasterVariants(normalizedVariants);
				}
			} catch (e: any) {
				console.error("Failed to load current_stock", e);
				if (!cancelled) {
					setRows([]);
					setMasterVariants([]);
					setError(e?.message || "Failed to load current stock");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [user]);

	const filtered = useMemo(() => {
		const q = searchQuery.trim().toLowerCase();
		return rows.filter((r) => {
			const matchesQuery =
				!q ||
				r.item_name.toLowerCase().includes(q) ||
				String(r.variant_id || "").toLowerCase().includes(q);
			return matchesQuery;
		});
	}, [rows, searchQuery]);

	const toggleSort = (key: SortKey) => {
		if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
		else {
			setSortKey(key);
			setSortDir("asc");
		}
		setPage(1);
	};

	const SortIcon = ({ keyName }: { keyName: SortKey }) => {
		if (sortKey !== keyName) return <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground" />;
		return sortDir === "asc" ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />;
	};

	const sorted = useMemo(() => {
		const arr = [...filtered];
		const dir = sortDir === "asc" ? 1 : -1;
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

		arr.sort((a, b) => {
			switch (sortKey) {
				case "item":
					return dir * collator.compare(a.item_name || "", b.item_name || "");
				case "currentQty":
					return dir * (Number(a.current_qty || 0) - Number(b.current_qty || 0));
				case "adjustment": {
					const adjA = adjustments[a.id];
					const adjB = adjustments[b.id];
					const numA = typeof adjA === "number" && Number.isFinite(adjA) ? adjA : 0;
					const numB = typeof adjB === "number" && Number.isFinite(adjB) ? adjB : 0;
					return dir * (numA - numB);
				}
				default:
					return 0;
			}
		});
		return arr;
	}, [filtered, sortKey, sortDir, adjustments]);

	const perPage = Math.max(parseInt(rowsPerPage || "10", 10) || 10, 1);
	const totalPages = useMemo(() => Math.max(1, Math.ceil(sorted.length / perPage)), [sorted.length, perPage]);
	const safePage = Math.min(Math.max(page, 1), totalPages);

	useEffect(() => {
		setPage(1);
	}, [searchQuery, rowsPerPage, rows.length]);

	const pageRows = useMemo(() => {
		const start = (safePage - 1) * perPage;
		return sorted.slice(start, start + perPage);
	}, [sorted, safePage, perPage]);

	const totalCount = sorted.length;
	const showingStart = totalCount === 0 ? 0 : (safePage - 1) * perPage + 1;
	const showingEnd = totalCount === 0 ? 0 : Math.min(safePage * perPage, totalCount);

	const totals = useMemo(() => {
		let totalCurrent = 0;
		let totalAdjustment = 0;
		for (const r of filtered) {
			const adj = adjustments[r.id];
			const adjNum = typeof adj === "number" ? adj : 0;
			const current = Number(r.current_qty || 0);
			totalCurrent += current;
			totalAdjustment += adjNum;
		}
		return { totalCurrent, totalAdjustment };
	}, [filtered, adjustments]);

	return (
		<div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-3">
			<h1 className="sr-only">Stock Adjustment</h1>
			<Card className="min-h-[calc(100vh-2rem)] flex flex-col border-slate-200 shadow-sm">
				<CardHeader className="pb-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<CardTitle className="text-xl shrink-0">Stock Adjustment</CardTitle>
						<div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
							<Link to="/inventory">
								<Button variant="outline">
									<ArrowLeft className="h-4 w-4 mr-2" />
									Back
								</Button>
							</Link>
						</div>
					</div>
				</CardHeader>

				<CardContent className="flex flex-1 flex-col gap-4 bg-white pt-6">
					<div className="rounded-xl border border-slate-200 overflow-hidden">
						<div className="bg-slate-50/60 px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 flex-1">
								<div className="w-full sm:max-w-[520px]">
									<div className="relative">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
										<Input
											value={searchQuery}
											onChange={(e) => setSearchQuery(e.target.value)}
											placeholder="Search by item name..."
											className="h-9 pl-10 border border-slate-300 focus-visible:ring-slate-400"
										/>
									</div>
								</div>
							</div>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
								<Input
									value={remarks}
									onChange={(e) => setRemarks(e.target.value)}
									placeholder="Remarks (optional)"
									className="h-9 w-full sm:w-[280px] border border-slate-300 focus-visible:ring-slate-400"
								/>
								<Button
									disabled={submitting || loading || submitLines.length === 0}
									onClick={confirmAndSubmit}
									className="h-9"
								>
									{submitting ? "Submitting..." : "Submit"}
								</Button>
							</div>
						</div>
						<div className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="cursor-pointer select-none" onClick={() => toggleSort("item")}
										>
											<span className="inline-flex items-center">ITEM<SortIcon keyName="item" /></span>
										</TableHead>
										<TableHead>
											<span className="inline-flex items-center">VARIANT</span>
										</TableHead>
										<TableHead>
											<span className="inline-flex items-center">STOCK DATE</span>
										</TableHead>
										<TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("currentQty")}
										>
											<span className="inline-flex items-center justify-end w-full">CURRENT QTY<SortIcon keyName="currentQty" /></span>
										</TableHead>
										<TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("adjustment")}
										>
											<span className="inline-flex items-center justify-end w-full">ADJUSTMENT<SortIcon keyName="adjustment" /></span>
										</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{loading && (
										<TableRow>
											<TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
												Loading...
											</TableCell>
										</TableRow>
									)}
									{!loading && error && (
										<TableRow>
											<TableCell colSpan={5} className="py-10 text-center text-sm text-rose-600">
												{error}
											</TableCell>
										</TableRow>
									)}
									{!loading && sorted.length === 0 && (
										<TableRow>
											<TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
												No items found
											</TableCell>
										</TableRow>
									)}
									{!loading &&
										pageRows.map((r) => {
											const adj = adjustments[r.id];
											return (
												<TableRow key={r.id} className="hover:bg-slate-50/60">
													<TableCell className="font-medium">{r.item_name}</TableCell>
													<TableCell className="text-muted-foreground">
														{(() => {
															if (!r.variant_id) return "-";
															const v = variantNameById.get(r.variant_id);
															const name = v?.variant_name || r.variant_id;
															const metaParts = [v?.size, v?.color, v?.width].filter(Boolean);
															return (
																<div className="flex flex-col">
																	<span>{name}</span>
																	{metaParts.length > 0 && (
																		<span className="text-xs text-muted-foreground">
																			{metaParts.join(" • ")}
																		</span>
																	)}
																</div>
															);
														})()}
													</TableCell>
													<TableCell className="text-muted-foreground">
														{extractDateKey(r.stock_date) || "-"}
													</TableCell>
													<TableCell className="text-right font-semibold">{r.current_qty}</TableCell>
													<TableCell className="text-right">
														<Input
															inputMode="decimal"
															className="h-9 w-[120px] text-right inline-flex border border-slate-300 focus-visible:ring-slate-400"
															value={adj === "" || adj == null ? "" : String(adj)}
															onChange={(e) => {
																const next = parseNumberOrEmpty(e.target.value);
																setAdjustments((prev) => ({ ...prev, [r.id]: next }));
															}}
															placeholder="0"
														/>
													</TableCell>
												</TableRow>
											);
										})}
								</TableBody>
								<TableFooter>
									<TableRow>
										<TableCell colSpan={3} className="font-semibold">
											Total
										</TableCell>
										<TableCell className="text-right font-semibold">{totals.totalCurrent}</TableCell>
										<TableCell className="text-right font-semibold">{totals.totalAdjustment}</TableCell>
									</TableRow>
								</TableFooter>
							</Table>
						</div>

						<div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t bg-white">
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
									disabled={safePage <= 1}
									onClick={() => setPage((p) => Math.max(1, p - 1))}
								>
									Prev
								</Button>
								<div className="text-sm tabular-nums">{safePage} / {totalPages}</div>
								<Button
									variant="outline"
									disabled={safePage >= totalPages}
									onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
								>
									Next
								</Button>
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}