import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ApiService } from "@/services/apiService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Search, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";

type StockRow = {
  id: number;
  item_id: string;
  item_name: string;
  variant_id?: string;
  current_qty: number;
  stock_date?: string;
};

type MasterVariantLite = {
  id: number;
  variant_id: string;
  variant_name: string;
  status?: number;
};

const parseNumberOrEmpty = (raw: string): number | "" => {
  const s = raw.trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? n : "";
};

export default function StockAdjustmentNew() {
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    document.title = "New Stock Adjustment";
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [rows, setRows] = useState<StockRow[]>([]);
  const [masterVariants, setMasterVariants] = useState<MasterVariantLite[]>([]);

  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState("10");

  // Per-row adjustment qty (can be + or -)
  const [adjustments, setAdjustments] = useState<Record<number, number | "">>({});

  const variantNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of masterVariants) {
      const id = String(v.variant_id || "").trim();
      const name = String(v.variant_name || "").trim();
      if (id && name) m.set(id, name);
    }
    return m;
  }, [masterVariants]);

  useEffect(() => {
    const fetchRows = async () => {
      if (!user) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;
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
            const statusNum = v.status != null ? Number(v.status) : undefined;
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              variant_id: variantId,
              variant_name: variantName,
              status: Number.isFinite(statusNum as any) ? statusNum : undefined,
            };
          })
          .filter((v: MasterVariantLite) => v.id && v.variant_id && v.variant_name);
        const normalized: StockRow[] = (stockRows || [])
          .map((s: any) => {
            const idNum = Number(s?.id ?? 0);
            const itemId = String(s?.item_id ?? s?.itemId ?? "").trim();
            const itemName = String(s?.item_name ?? s?.itemName ?? "").trim();
            const variantId = String(s?.variant_id ?? s?.variantId ?? "").trim();
            const currentQty = Number(s?.current_qty ?? s?.currentQty ?? s?.current_stock ?? s?.currentStock ?? 0);
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              item_id: itemId,
              item_name: itemName,
              variant_id: variantId || undefined,
              current_qty: Number.isFinite(currentQty) ? currentQty : 0,
              stock_date: s?.stock_date ? String(s.stock_date) : undefined,
            };
          })
          .filter((r) => r.id && r.item_id && r.item_name);

        setRows(normalized);
        setMasterVariants(normalizedVariants);
      } catch (err: any) {
        setError(err?.message || "Failed to load current stock");
      } finally {
        setLoading(false);
      }
    };

    fetchRows();
  }, [user]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = String(r.item_name || "").toLowerCase();
      const variant = String(r.variant_id || "").toLowerCase();
      return name.includes(q) || variant.includes(q);
    });
  }, [rows, searchQuery]);

  const perPage = Math.max(parseInt(rowsPerPage || "10", 10) || 10, 1);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(filteredRows.length / perPage)), [filteredRows.length, perPage]);
  const safePage = Math.min(Math.max(page, 1), totalPages);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, rowsPerPage, rows.length]);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * perPage;
    return filteredRows.slice(start, start + perPage);
  }, [filteredRows, safePage, perPage]);

  const totalCount = filteredRows.length;
  const showingStart = totalCount === 0 ? 0 : (safePage - 1) * perPage + 1;
  const showingEnd = totalCount === 0 ? 0 : Math.min(safePage * perPage, totalCount);

  const totals = useMemo(() => {
    let changedCount = 0;
    let netChange = 0;
    for (const r of rows) {
      const adj = adjustments[r.id];
      if (typeof adj === "number" && adj !== 0) {
        changedCount += 1;
        netChange += adj;
      }
    }
    return { changedCount, netChange };
  }, [rows, adjustments]);

  const handleSave = () => {
    // Backend API for stock adjustment is not wired yet in this frontend.
    // For now, keep edits in UI and show a confirmation.
    if (totals.changedCount === 0) {
      toast({ title: "Nothing to save", description: "Enter an adjustment value for at least one item." });
      return;
    }

    toast({
      title: "Saved locally (UI)",
      description: `${totals.changedCount} item(s) updated. Hook this to backend when the endpoint is ready.`,
    });
  };

  return (
    <div className="min-h-screen w-full bg-slate-50/40 p-2 md:p-3">
      <h1 className="sr-only">New Stock Adjustment</h1>
      <Card className="min-h-[calc(100vh-2rem)] flex flex-col border-slate-200 shadow-sm">
        <CardHeader className="pb-3 border-b bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4 flex-1">
              <CardTitle className="text-xl shrink-0">New Stock Adjustment</CardTitle>
              <div className="w-full sm:max-w-[520px]">
                <Label className="sr-only">Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search item name..."
                    className="h-10 pl-10"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
              <Link to="/inventory/stock-adjustment">
                <Button variant="outline">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              </Link>
              <Button onClick={handleSave}>
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <span className="text-muted-foreground">Items:</span> <span className="font-semibold">{filteredRows.length}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <span className="text-muted-foreground">Adjusted:</span> <span className="font-semibold">{totals.changedCount}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5">
              <span className="text-muted-foreground">Net Change:</span>{" "}
              <span className={`font-semibold ${totals.netChange >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {totals.netChange}
              </span>
            </div>
            {loading && <span className="text-muted-foreground">Loading…</span>}
            {error && <span className="text-rose-600">{error}</span>}
          </div>
        </CardHeader>

        <CardContent className="flex flex-1 flex-col gap-4 bg-white">
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ITEM</TableHead>
                    <TableHead>VARIANT</TableHead>
                    <TableHead className="text-right">CURRENT QTY</TableHead>
                    <TableHead className="text-right">ADJUSTMENT</TableHead>
                    <TableHead className="text-right">NEW QTY</TableHead>
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

                  {!loading && filteredRows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No items found
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading &&
                    pageRows.map((r) => {
                      const adj = adjustments[r.id];
                      const adjNum = typeof adj === "number" ? adj : 0;
                      const newStock = Number(r.current_qty || 0) + adjNum;
                      return (
                        <TableRow key={r.id} className="hover:bg-slate-50/60">
                          <TableCell className="font-medium">{r.item_name}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {r.variant_id ? (variantNameById.get(r.variant_id) || r.variant_id) : "-"}
                          </TableCell>
                          <TableCell className="text-right font-semibold">{r.current_qty}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              inputMode="decimal"
                              className="h-9 w-[120px] text-right inline-flex"
                              value={adj === "" || adj == null ? "" : String(adj)}
                              onChange={(e) => {
                                const next = parseNumberOrEmpty(e.target.value);
                                setAdjustments((prev) => ({ ...prev, [r.id]: next }));
                              }}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${newStock < 0 ? "text-rose-700" : "text-slate-900"}`}
                          >
                            {newStock}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={2} className="font-semibold">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {filteredRows.reduce((sum, r) => sum + Number(r.current_qty || 0), 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {filteredRows.reduce((sum, r) => {
                        const adj = adjustments[r.id];
                        return sum + (typeof adj === "number" ? adj : 0);
                      }, 0)}
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      {filteredRows.reduce((sum, r) => {
                        const adj = adjustments[r.id];
                        const adjNum = typeof adj === "number" ? adj : 0;
                        return sum + (Number(r.current_qty || 0) + adjNum);
                      }, 0)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
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

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => navigate("/inventory/stock-adjustment")}>
              Cancel
            </Button>
            <Button onClick={handleSave}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
