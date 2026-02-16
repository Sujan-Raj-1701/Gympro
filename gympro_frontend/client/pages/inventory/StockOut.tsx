import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ApiService } from "@/services/apiService";
import { toast } from "@/hooks/use-toast";

const parsePercent = (value: unknown): number | undefined => {
  if (value == null || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return undefined;
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return undefined;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const getTaxName = (tax: any): string => {
  if (!tax) return "";
  if (typeof tax === "string") return tax;
  if (typeof tax === "number") return String(tax);
  if (Array.isArray(tax)) {
    const parts = tax
      .map((t) => getTaxName(t))
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(parts)).join(", ");
  }
  if (typeof tax === "object") {
    const candidate =
      (tax as any).tax_name ??
      (tax as any).taxName ??
      (tax as any).name ??
      (tax as any).label ??
      (tax as any).tax;
    return candidate ? String(candidate) : "";
  }
  return "";
};

type MasterTaxLite = {
  id: number;
  tax_id?: number;
  name?: string;
  description?: string;
  percentage?: number;
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

const REASON_TYPES = [
  { value: "used", label: "Used in Service" },
  { value: "damaged", label: "Damaged" },
  { value: "expired", label: "Expired" },
  { value: "adjustment", label: "Stock Adjustment" },
  { value: "lost", label: "Lost/Missing" },
  { value: "returned", label: "Return to Supplier" },
  { value: "transfer", label: "Transfer" },
] as const;

type ReasonType = (typeof REASON_TYPES)[number]["value"];

type MasterInventoryLite = {
  id: number;
  product_id?: string;
  item_name: string;
  brand?: string;
  purchase_price?: number;
  selling_price?: number;
  hsn_code?: string;
  tax?: any;
};

type LineItem = {
  id: string;
  inventoryId?: number;
  productId?: string;
  itemName: string;
  variantId: string;
  variantName: string;
  brand: string;
  taxPercent: number;
  discount: number;
  quantity: number;
  currentQty?: number;
  unitCost: number;
  total: number;
};

type StockOutRemarksPayload = {
  kind?: "stock_out";
  reasonType?: string;
  issuedTo?: string;
  notes?: string;
};

export default function StockOut() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { stockOutId } = useParams();
  const isEditing = !!stockOutId;

  useEffect(() => {
    document.title = "Stock Out";
  }, []);

  const [masterInventory, setMasterInventory] = useState<MasterInventoryLite[]>([]);
  const [masterTax, setMasterTax] = useState<MasterTaxLite[]>([]);
  const [masterVariants, setMasterVariants] = useState<MasterVariantLite[]>([]);
  const [currentStockByItemId, setCurrentStockByItemId] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const masterTaxById = useMemo(() => {
    const m = new Map<number, MasterTaxLite>();
    for (const t of masterTax) {
      const id = Number((t as any).id ?? 0);
      if (Number.isFinite(id) && id) m.set(id, t);
    }
    return m;
  }, [masterTax]);

  const masterTaxByTaxId = useMemo(() => {
    const m = new Map<number, MasterTaxLite>();
    for (const t of masterTax) {
      const tid = Number((t as any).tax_id ?? (t as any).taxId ?? 0);
      if (Number.isFinite(tid) && tid) m.set(tid, t);
    }
    return m;
  }, [masterTax]);

  const masterVariantById = useMemo(() => {
    const m = new Map<string, MasterVariantLite>();
    for (const v of masterVariants) m.set(String(v.variant_id), v);
    return m;
  }, [masterVariants]);

  const resolveTaxPercent = useCallback((taxRef: unknown): number => {
    if (taxRef == null) return 0;
    if (Array.isArray(taxRef)) {
      const pcts = taxRef.map((x) => resolveTaxPercent(x)).filter((n) => Number.isFinite(n));
      return pcts.length ? Math.max(...pcts) : 0;
    }
    if (typeof taxRef === "number") {
      const row = masterTaxByTaxId.get(taxRef) ?? masterTaxById.get(taxRef);
      return row?.percentage != null ? Number(row.percentage) : 0;
    }
    if (typeof taxRef === "object") {
      const obj: any = taxRef as any;

      // Some schemas store CGST/SGST separately instead of a total percentage.
      const cgst = Number(obj.cgst ?? 0) || 0;
      const sgst = Number(obj.sgst ?? 0) || 0;
      const igst = Number(obj.igst ?? 0) || 0;
      const vat = Number(obj.vat ?? 0) || 0;
      const computed = cgst + sgst + igst + vat;
      if (computed > 0) return computed;

      const pct = obj.tax_percentage ?? obj.tax_percent ?? obj.percentage ?? obj.tax_rate ?? obj.rate ?? obj.taxPercent;
      const direct = parsePercent(pct);
      if (direct != null) return direct;

      // Sometimes the object carries an id/tax_id instead of percentage.
      const maybeId = obj.tax_id ?? obj.taxId ?? obj.id;
      const idNum = Number(maybeId);
      if (Number.isFinite(idNum)) {
        const row = masterTaxByTaxId.get(idNum) ?? masterTaxById.get(idNum);
        if (row?.percentage != null) return Number(row.percentage);
      }
      return 0;
    }

    const refStr = String(taxRef).trim();
    if (!refStr) return 0;
    if ((refStr.startsWith("{") && refStr.endsWith("}")) || (refStr.startsWith("[") && refStr.endsWith("]"))) {
      try {
        const parsed = JSON.parse(refStr);
        return resolveTaxPercent(parsed);
      } catch {
        // fall through
      }
    }

    const refNum = Number(refStr);
    if (Number.isFinite(refNum)) {
      const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
      if (row?.percentage != null) return Number(row.percentage);
      return 0;
    }

    if (refStr.includes("%")) {
      const pctFromLabel = parsePercent(refStr);
      if (pctFromLabel != null && !Number.isNaN(pctFromLabel)) return pctFromLabel;
    }
    return 0;
  }, [masterTaxById, masterTaxByTaxId]);

  const resolveTaxLabel = useCallback(
    (taxRef: unknown): string => {
      if (taxRef == null) return "";

      if (Array.isArray(taxRef)) {
        const parts = taxRef
          .map((t) => resolveTaxLabel(t))
          .map((s) => s.trim())
          .filter(Boolean);
        return Array.from(new Set(parts)).join(", ");
      }

      if (typeof taxRef === "number") {
        const row = masterTaxByTaxId.get(taxRef) ?? masterTaxById.get(taxRef);
        return String(row?.name ?? row?.description ?? "").trim();
      }

      if (typeof taxRef === "object") {
        const obj: any = taxRef as any;
        const raw = obj.tax_id ?? obj.taxId ?? obj.taxID ?? obj.id ?? obj.tax_code ?? obj.code;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
          const row = masterTaxByTaxId.get(n) ?? masterTaxById.get(n);
          const label = String(row?.name ?? row?.description ?? "").trim();
          if (label) return label;
        }
        return String(getTaxName(obj) || "").trim();
      }

      const refStr = String(taxRef).trim();
      if (!refStr) return "";

      if ((refStr.startsWith("{") && refStr.endsWith("}")) || (refStr.startsWith("[") && refStr.endsWith("]"))) {
        try {
          const parsed = JSON.parse(refStr);
          return resolveTaxLabel(parsed);
        } catch {
          // fall through
        }
      }

      const refNum = Number(refStr);
      if (Number.isFinite(refNum) && refNum > 0) {
        const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
        return String(row?.name ?? row?.description ?? "").trim();
      }

      return refStr;
    },
    [masterTaxById, masterTaxByTaxId]
  );

  const resolveTaxId = useCallback(
    (taxRef: unknown): number | undefined => {
      if (taxRef == null) return undefined;

      if (Array.isArray(taxRef)) {
        for (const t of taxRef) {
          const v = resolveTaxId(t);
          if (v != null && Number.isFinite(v) && v > 0) return v;
        }
        return undefined;
      }

      if (typeof taxRef === "object") {
        const obj: any = taxRef as any;
        const raw = obj.tax_id ?? obj.taxId ?? obj.taxID ?? obj.id ?? obj.tax_code ?? obj.code;
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) {
          const row = masterTaxByTaxId.get(n) ?? masterTaxById.get(n);
          return (row?.tax_id ?? row?.id ?? n) as number;
        }

        const label = getTaxName(obj);
        const pct = parsePercent(obj.tax_percentage ?? obj.percentage ?? obj.tax_rate ?? obj.rate ?? label);
        if (pct != null) {
          const hit = masterTax.find((t) => t.percentage != null && Number(t.percentage) === Number(pct));
          if (hit) return (hit.tax_id ?? hit.id) as number;
        }
        if (label) {
          const norm = label.toLowerCase().replace(/[^a-z0-9]/g, "");
          const hit = masterTax.find((t) => {
            const nm = String(t.name || t.description || "").toLowerCase();
            return nm && nm.replace(/[^a-z0-9]/g, "") === norm;
          });
          if (hit) return (hit.tax_id ?? hit.id) as number;
        }
        return undefined;
      }

      const refStr = String(taxRef).trim();
      if (!refStr) return undefined;

      if ((refStr.startsWith("{") && refStr.endsWith("}")) || (refStr.startsWith("[") && refStr.endsWith("]"))) {
        try {
          const parsed = JSON.parse(refStr);
          return resolveTaxId(parsed);
        } catch {
          // fall through
        }
      }

      const refNum = Number(refStr);
      if (Number.isFinite(refNum) && refNum > 0) {
        const row = masterTaxByTaxId.get(refNum) ?? masterTaxById.get(refNum);
        return (row?.tax_id ?? row?.id ?? refNum) as number;
      }

      const pct = parsePercent(refStr);
      if (pct != null) {
        const hit = masterTax.find((t) => t.percentage != null && Number(t.percentage) === Number(pct));
        if (hit) return (hit.tax_id ?? hit.id) as number;
      }

      const norm = refStr.toLowerCase().replace(/[^a-z0-9]/g, "");
      const hit = masterTax.find((t) => {
        const nm = String(t.name || t.description || "").toLowerCase();
        return nm && nm.replace(/[^a-z0-9]/g, "") === norm;
      });
      return (hit?.tax_id ?? hit?.id) as number | undefined;
    },
    [masterTax, masterTaxById, masterTaxByTaxId]
  );

  // If user selects items before master_tax loads, recompute tax % after it arrives.
  useEffect(() => {
    if (masterInventory.length === 0) return;

    setItems((prev) =>
      prev.map((it) => {
        if (!it.inventoryId) return it;
        const prod = masterInventory.find((p) => p.id === it.inventoryId);
        if (!prod) return it;
        const pct = resolveTaxPercent((prod as any).tax);
        if (Number(pct || 0) === Number(it.taxPercent || 0)) return it;
        return { ...it, taxPercent: pct };
      })
    );
  }, [masterInventory, masterTax, resolveTaxPercent]);

  const [referenceNumber, setReferenceNumber] = useState<string>(() => String(stockOutId || "").trim());
  const [entryDate, setEntryDate] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [reasonType, setReasonType] = useState<ReasonType | "">("used");
  const [issuedTo, setIssuedTo] = useState("");
  const [notes, setNotes] = useState("");
  const [taxExempt, setTaxExempt] = useState(false);
  const [discount, setDiscount] = useState<number>(0);

  const [summaryOpen, setSummaryOpen] = useState(false);

  const [itemPickerRowId, setItemPickerRowId] = useState<string | null>(null);
  const [itemPickerQuery, setItemPickerQuery] = useState<string>("");
  const [variantPickerRowId, setVariantPickerRowId] = useState<string | null>(null);
  const [variantPickerQuery, setVariantPickerQuery] = useState<string>("");
  const itemInputRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const variantTriggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const variantSearchInputRef = useRef<HTMLInputElement | null>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const nextRowIdRef = useRef<number>(2);
  const createRowId = () => String(nextRowIdRef.current++);

  const [pendingFocus, setPendingFocus] = useState<null | { rowId: string; field: "item" | "variant" | "qty" }>(null);

  const createBlankItem = (id: string): LineItem => ({
    id,
    inventoryId: undefined,
    productId: "",
    itemName: "",
    variantId: "",
    variantName: "",
    brand: "",
    taxPercent: 0,
    discount: 0,
    quantity: 0,
    currentQty: undefined,
    unitCost: 0,
    total: 0,
  });

  const [items, setItems] = useState<LineItem[]>([createBlankItem("1")]);

  // Backfill currentQty when master/current_stock arrives (useful for edit mode).
  useEffect(() => {
    if (masterInventory.length === 0) return;
    setItems((prev) =>
      prev.map((it) => {
        if (it.currentQty != null) return it;
        const prod = it.inventoryId ? masterInventory.find((p) => p.id === it.inventoryId) : undefined;
        const productId = String(prod?.product_id ?? it.productId ?? "").trim();
        if (!productId) return it;
        const cq = currentStockByItemId[productId];
        return { ...it, productId, currentQty: cq != null ? Number(cq) : 0 };
      })
    );
  }, [masterInventory, currentStockByItemId]);

  useEffect(() => {
    if (!pendingFocus) return;
    const { rowId, field } = pendingFocus;
    const el =
      field === "item"
        ? itemInputRefs.current[rowId]
        : field === "variant"
          ? variantTriggerRefs.current[rowId]
          : qtyInputRefs.current[rowId];
    const raf = window.requestAnimationFrame(() => {
      el?.focus();
      if (field !== "item") {
        try {
          (el as HTMLInputElement | null)?.select?.();
        } catch {
          // ignore
        }
      }
    });
    setPendingFocus(null);
    return () => window.cancelAnimationFrame(raf);
  }, [pendingFocus]);

  // When the variant picker opens, focus its search input.
  useEffect(() => {
    if (!variantPickerRowId) return;
    const raf = window.requestAnimationFrame(() => {
      variantSearchInputRef.current?.focus();
      try {
        variantSearchInputRef.current?.select?.();
      } catch {
        // ignore
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [variantPickerRowId]);

  // Load master inventory for suggestions (same approach as Stock In)
  useEffect(() => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    (async () => {
      try {
        const res: any = await ApiService.post("/read", {
          tables: ["master_inventory", "master_variants", "current_stock"],
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

        const rows = extract("master_inventory", ["inventory", "product_master", "products"]);
        const normalized: MasterInventoryLite[] = rows
          .filter((p: any) => p && (p.status == null || p.status === 1))
          .map((p: any) => {
            const idNum = Number(p.id ?? p.inventory_id ?? p.product_id ?? 0);
            const productId = p.product_id ?? p.productId ?? p.prod_id ?? p.product_code;
            const itemName = String(p.item_name ?? p.product_name ?? p.reference_code ?? "").trim();
            const brandName = String(p.brand_name ?? p.brandName ?? p.brand ?? p.brand_title ?? p.brandTitle ?? "").trim();
            const purchase = p.purchase_price != null ? Number(p.purchase_price) : (p.buying_price != null ? Number(p.buying_price) : undefined);
            const selling = p.selling_price != null ? Number(p.selling_price) : (p.price != null ? Number(p.price) : undefined);
            const hsnCode = p.hsn_code != null ? String(p.hsn_code) : (p.hsn_id != null ? String(p.hsn_id) : undefined);

            const taxRef =
              // Prefer the same primary field StockIn uses.
              p.tax ??
              // Common alternative schemas.
              p.tax_json ??
              p.tax_details ??
              // Sometimes stored as a label string.
              p.tax_name ??
              p.taxName ??
              // Sometimes stored as ids or numeric refs.
              p.tax_id ??
              p.taxId ??
              // Sometimes stored as a direct percentage.
              p.tax_percent ??
              p.tax_percentage ??
              // Sometimes stored as CGST/SGST/etc.
              (p.cgst != null || p.sgst != null || p.igst != null || p.vat != null ? { cgst: p.cgst, sgst: p.sgst, igst: p.igst, vat: p.vat } : undefined);
            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              product_id: productId != null ? String(productId) : undefined,
              item_name: itemName,
              brand: brandName || undefined,
              purchase_price: purchase,
              selling_price: selling,
              hsn_code: hsnCode,
              tax: taxRef,
            };
          })
          .filter((p: any) => p.id && p.item_name);

        const variantRows = extract("master_variants", ["variant", "variants", "master_variants", "master_variant"]);
        const normalizedVariants: MasterVariantLite[] = variantRows
          .filter((v: any) => v && (v.status == null || v.status === 1))
          .map((v: any) => {
            const idNum = Number(v.id ?? 0);
            const variantId = String(v.variant_id ?? v.variantId ?? v.code ?? "").trim();
            const variantName = String(v.variant_name ?? v.variantName ?? v.name ?? v.label ?? "").trim();
            const size = String(v.size ?? "").trim();
            const color = String(v.color ?? "").trim();
            const width = String(v.width ?? "").trim();
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
          .filter((v) => v.id && v.variant_id && v.variant_name);

        const stockRows = extract("current_stock", ["current_stock", "stock", "stocks", "inventory_stock"]);
        const stockMap: Record<string, number> = {};
        for (const s of stockRows || []) {
          const itemId = String(s?.item_id ?? s?.itemId ?? s?.product_id ?? s?.productId ?? "").trim();
          if (!itemId) continue;
          const qty = Number(s?.current_qty ?? s?.currentQty ?? s?.current_stock ?? s?.currentStock ?? s?.qty ?? 0);
          stockMap[itemId] = Number.isFinite(qty) ? qty : 0;
        }

        if (!cancelled) {
          setMasterInventory(normalized);
          setMasterVariants(normalizedVariants);
          setCurrentStockByItemId(stockMap);
        }
      } catch (e) {
        console.error("Failed to load master_inventory", e);
        if (!cancelled) {
          setMasterInventory([]);
          setMasterVariants([]);
          setCurrentStockByItemId({});
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // Load master tax (for resolving tax_id -> percentage)
  useEffect(() => {
    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    (async () => {
      try {
        const res: any = await ApiService.post("/read", { tables: ["master_tax"], account_code: acc, retail_code: ret });
        const dataRoot: any = res?.data ?? res ?? {};

        const extract = (primary: string, aliases: string[]): any[] => {
          if (Array.isArray(dataRoot)) return dataRoot;
          if (Array.isArray(dataRoot[primary])) return dataRoot[primary];
          for (const k of aliases) {
            if (Array.isArray(dataRoot[k])) return dataRoot[k];
          }
          const lower = primary.toLowerCase();
          for (const k of Object.keys(dataRoot)) {
            if (k.toLowerCase().includes(lower) && Array.isArray((dataRoot as any)[k])) return (dataRoot as any)[k];
          }
          return [];
        };

        const taxRows = extract("master_tax", ["tax", "mastertax", "tax_master"]);
        const normalizedTax: MasterTaxLite[] = taxRows
          .map((t: any) => {
            const idNum = Number(t.id ?? 0);
            const taxIdNumRaw = t.tax_id ?? t.taxId ?? t.taxID ?? t.tax_code;
            const taxIdNum = Number(taxIdNumRaw);
            const name = String(t.tax_name ?? t.name ?? t.label ?? t.tax ?? "").trim();
            const desc = String(t.tax_description ?? t.description ?? t.tax_desc ?? "").trim();
            const pctRaw = t.tax_percentage ?? t.percentage ?? t.tax_rate ?? t.rate ?? t.tax;
            const pctNum = parsePercent(pctRaw);

            // Some schemas store CGST/SGST separately instead of a total percentage.
            const cgst = Number(t.cgst ?? 0) || 0;
            const sgst = Number(t.sgst ?? 0) || 0;
            const igst = Number(t.igst ?? 0) || 0;
            const vat = Number(t.vat ?? 0) || 0;
            const computed = cgst + sgst + igst + vat;

            return {
              id: Number.isFinite(idNum) ? idNum : 0,
              tax_id: Number.isFinite(taxIdNum) ? taxIdNum : undefined,
              name: name || undefined,
              description: desc || undefined,
              percentage: pctNum != null ? pctNum : (Number.isFinite(computed) ? computed : undefined),
            };
          })
          .filter((t) => (t.tax_id != null || t.id) && (t.name || t.description || t.percentage != null));

        if (!cancelled) setMasterTax(normalizedTax);
      } catch (e) {
        console.error("Failed to load master_tax", e);
        if (!cancelled) setMasterTax([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const parseRemarks = (raw: unknown): StockOutRemarksPayload | null => {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
      try {
        const parsed = JSON.parse(s);
        if (parsed && typeof parsed === "object") {
          const obj: any = parsed;
          if (obj.kind === "stock_out" || obj.reasonType || obj.notes || obj.issuedTo) {
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

  // Load record when editing (from backend)
  useEffect(() => {
    if (!isEditing) {
      setReferenceNumber("");
      setEntryDate(format(new Date(), "yyyy-MM-dd"));
      setReasonType("used");
      setIssuedTo("");
      setNotes("");
      setTaxExempt(false);
      setDiscount(0);
      setItems([createBlankItem("1")]);
      nextRowIdRef.current = 2;
      return;
    }

    const ref = String(stockOutId || "");
    if (!ref) return;

    if (!user) return;
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res: any = await ApiService.post("/stock-in/get", {
          account_code: acc,
          retail_code: ret,
          stockin_id: ref,
        });
        const payload = res?.data ?? res;
        const data = payload?.data ?? payload;
        const header = data?.header ?? {};
        const lines = Array.isArray(data?.items) ? data.items : [];

        if (cancelled) return;

        setReferenceNumber(ref);
        setEntryDate(String(header?.received_date ?? "").slice(0, 10) || format(new Date(), "yyyy-MM-dd"));
        setTaxExempt(Boolean(header?.tax_exempt) || header?.tax_exempt === 1);
        setDiscount(Number(header?.discount ?? 0) || 0);

        const remarksParsed = parseRemarks(header?.remarks);
        if (remarksParsed) {
          const reason = String(remarksParsed.reasonType || "") as ReasonType;
          setReasonType((REASON_TYPES.some((x) => x.value === reason) ? reason : "used") as any);
          setIssuedTo(String(remarksParsed.issuedTo || ""));
          setNotes(String(remarksParsed.notes || ""));
        } else {
          setReasonType("used");
          setIssuedTo("");
          setNotes(String(header?.remarks ?? ""));
        }

        const mapped: LineItem[] = (lines as any[]).map((l, idx) => {
          const qty = Number(l?.quantity ?? 0) || 0;
          const unit = Number(l?.unit_price ?? 0) || 0;
          const disc = Number(l?.discount ?? 0) || 0;
          const total = Math.max(qty * unit - disc, 0);
          return {
            id: String(idx + 1),
            inventoryId: (l?.inventory_id != null ? Number(l.inventory_id) : undefined) as any,
            itemName: String(l?.item_name ?? "").trim(),
            variantId: String(l?.variant_id ?? l?.variantId ?? "").trim(),
            variantName: String(l?.variant_name ?? l?.variantName ?? "").trim(),
            brand: String(l?.brand ?? "").trim(),
            taxPercent: Number(l?.tax_percent ?? 0) || 0,
            discount: disc,
            quantity: qty,
            unitCost: unit,
            total,
          };
        });

        setItems(mapped.length ? mapped : [createBlankItem("1")]);
        nextRowIdRef.current = (mapped.length ? mapped.length : 1) + 1;
      } catch (e: any) {
        console.error("Failed to load Stock Out", e);
        if (!cancelled) toast({ title: "Load failed", description: e?.message || String(e), variant: "warning" });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isEditing, stockOutId, user]);

  const updateItem = (id: string, patch: Partial<LineItem>) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        const qty = Number(next.quantity || 0);
        const unit = Number(next.unitCost || 0);
        const base = qty * unit;
        const disc = Math.max(Number(next.discount || 0), 0);
        next.total = Math.max(base - disc, 0);
        return next;
      })
    );
  };

  const addItem = () => {
    const id = createRowId();
    setItems((prev) => [...prev, createBlankItem(id)]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((x) => x.id !== id);
      return next.length ? next : [createBlankItem("1")];
    });
  };

  const selectInventoryItem = (rowId: string, prod: MasterInventoryLite) => {
    const unitCost = Number(prod.purchase_price ?? prod.selling_price ?? 0) || 0;
    const taxPercent = resolveTaxPercent((prod as any).tax);
    const productId = String(prod.product_id ?? "").trim();
    const currentQty = productId ? Number(currentStockByItemId[productId] ?? 0) : 0;
    updateItem(rowId, {
      inventoryId: prod.id,
      productId,
      itemName: prod.item_name,
      variantId: "",
      variantName: "",
      brand: prod.brand ?? "",
      taxPercent,
      currentQty,
      unitCost,
    });
    setItemPickerRowId(null);
    setItemPickerQuery("");

    // After selecting an item, move to Variant.
    setVariantPickerRowId(rowId);
    setVariantPickerQuery("");
    setPendingFocus({ rowId, field: "variant" });
  };

  const totals = useMemo(() => {
    let totalQty = 0;
    let totalValue = 0;
    for (const it of items) {
      totalQty += Number(it.quantity || 0);
      totalValue += Number(it.total || 0);
    }
    return { totalQty, totalValue };
  }, [items]);

  const subtotal = useMemo(() => items.reduce((s, it) => s + (Number(it.total) || 0), 0), [items]);
  const discountSafe = Math.max(Number(discount || 0), 0);
  const discountApplied = Math.min(discountSafe, subtotal);
  const taxableBase = Math.max(subtotal - discountApplied, 0);

  const totalTax = useMemo(
    () => (taxExempt ? 0 : items.reduce((s, it) => s + (Number(it.total || 0) * (Number(it.taxPercent || 0) / 100)), 0)),
    [items, taxExempt]
  );
  const cgst = totalTax / 2;
  const sgst = totalTax / 2;
  const grandTotalExact = taxableBase + cgst + sgst;
  const grandTotalRounded = Math.round(grandTotalExact);
  const roundOff = Number((grandTotalRounded - grandTotalExact).toFixed(2));

  const submitStockOut = async (endpoint: string, payload: any, toastTitleOverride?: string) => {
    setLoading(true);
    try {
      const res: any = await ApiService.post(endpoint, payload);
      const raw = res?.data ?? res;
      const data = raw?.data ?? raw;
      const id = String(data?.stockin_id ?? stockOutId ?? "").trim();

      toast({
        title: toastTitleOverride ?? (isEditing ? "Stock Out updated" : "Stock Out saved"),
        description: id ? `Saved as ${id}` : "Saved successfully.",
      });
      navigate("/inventory/stock-out");
    } catch (e: any) {
      console.error("Stock Out save failed", e);
      toast({ title: "Save failed", description: e?.message || String(e), variant: "warning" });
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (billstatus: "Y" | "N" | "C" = "Y") => {
    if (!user) {
      toast({ title: "Not logged in", description: "Please login again.", variant: "warning" });
      return;
    }
    const acc = (user as any)?.account_code;
    const ret = (user as any)?.retail_code;
    if (!acc || !ret) {
      toast({ title: "Missing scope", description: "account_code / retail_code missing.", variant: "warning" });
      return;
    }

    if (!reasonType) {
      toast({ title: "Select reason", description: "Reason Type is required.", variant: "warning" });
      return;
    }

    // Variant is mandatory for any item line with Qty > 0 (when variants are configured).
    if (masterVariants.length > 0) {
      const missingVariant = items.find(
        (x) => String(x.itemName || "").trim() && Number(x.quantity || 0) > 0 && !String(x.variantId || "").trim()
      );
      if (missingVariant) {
        toast({
          title: "Select variant",
          description: `Variant is required for ${missingVariant.itemName || "this item"}.`,
          variant: "warning",
        });
        setVariantPickerRowId(missingVariant.id);
        setVariantPickerQuery("");
        setPendingFocus({ rowId: missingVariant.id, field: "variant" });
        return;
      }
    }

    const cleanedItems = items
      .map((x) => {
        const inv = x.inventoryId ?? masterInventory.find((m) => m.item_name === x.itemName)?.id;
        const invRow = masterInventory.find((m) => m.id === inv) ?? masterInventory.find((m) => m.item_name === x.itemName);
        const prod = invRow?.product_id;
        const hsnCode = String(invRow?.hsn_code ?? "").trim();
        const taxRef = (invRow as any)?.tax;
        return {
          inventory_id: (inv ?? undefined) as any,
          product_id: prod,
          item_name: String(x.itemName || "").trim(),
          variant_id: x.variantId || undefined,
          variant_name: x.variantId
            ? ((masterVariantById.get(String(x.variantId))?.variant_name ?? x.variantName) || undefined)
            : undefined,
          brand: String(x.brand || "").trim() || undefined,
          hsn_code: hsnCode,
          tax_name: resolveTaxLabel(taxRef),
          tax_id: resolveTaxId(taxRef) ?? undefined,
          tax_percent: Number(x.taxPercent || 0),
          discount: Number(x.discount || 0),
          quantity: Number(x.quantity || 0),
          unit_price: Number(x.unitCost || 0),
        };
      })
      .filter((x) => String(x.item_name || "").trim() && Number(x.quantity || 0) > 0);

    if (cleanedItems.length === 0) {
      toast({ title: "Add items", description: "Add at least one item with Qty > 0.", variant: "warning" });
      return;
    }

    // Validate issued Qty does not exceed current stock (sum per product_id).
    const qtyByProduct: Record<string, number> = {};
    const nameByProduct: Record<string, string> = {};
    for (const li of cleanedItems) {
      const pid = String(li.product_id ?? "").trim();
      if (!pid) continue;
      qtyByProduct[pid] = (qtyByProduct[pid] ?? 0) + Number(li.quantity || 0);
      nameByProduct[pid] = nameByProduct[pid] || String(li.item_name || "").trim();
    }

    for (const pid of Object.keys(qtyByProduct)) {
      const available = Number(currentStockByItemId[pid] ?? 0);
      const entered = Number(qtyByProduct[pid] ?? 0);
      if (entered - available > 0.0001) {
        toast({
          title: "Qty exceeds current stock",
          description: `${nameByProduct[pid] || pid}: available ${available}, entered ${entered}`,
          variant: "warning",
        });
        return;
      }
    }

    const remarksPayload: StockOutRemarksPayload = {
      kind: "stock_out",
      reasonType: String(reasonType || ""),
      issuedTo: issuedTo.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    const payload = {
      account_code: acc,
      retail_code: ret,
      stock_type: "O",
      ...(isEditing ? { stockin_id: stockOutId } : {}),
      received_date: entryDate || undefined,
      tax_exempt: !!taxExempt,
      remarks: JSON.stringify(remarksPayload),
      discount: Number(discountApplied || 0),
      items: cleanedItems,
      payments: [],
      billstatus,
    };

    const endpoint = isEditing ? "/stock-in/update" : "/stock-in/create";
    const toastTitle = billstatus === "N" ? "Stock Out held" : billstatus === "C" ? "Stock Out cancelled" : undefined;
    await submitStockOut(endpoint, payload, toastTitle);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await handleCreate("Y");
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <h1 className="sr-only">Stock Out</h1>

      <div className="w-full px-1 lg:px-2">
        <div className="grid grid-cols-1 gap-3">
          <div className="space-y-3">
            {/* Stock Out Details */}
            <Card className="border-0 bg-white rounded-xl overflow-visible">
              <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-1 rounded-full bg-blue-600/80" aria-hidden="true" />
                    <CardTitle className="text-base font-semibold tracking-tight text-slate-900">Stock Out Details</CardTitle>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => navigate("/inventory/stock-out")}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    Back (Esc)
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Issued Date *</Label>
                    <Input
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Reason Type *</Label>
                    <Select value={String(reasonType)} onValueChange={(v) => setReasonType(v as any)}>
                      <SelectTrigger className="h-9 w-full bg-white border-slate-300 focus:ring-0">
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {REASON_TYPES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1 lg:col-span-2">
                    <Label className="text-xs font-semibold text-slate-700">Notes</Label>
                    <Input
                      placeholder="Add notes..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs font-semibold text-slate-700">Issued To</Label>
                    <Input
                      value={issuedTo}
                      onChange={(e) => setIssuedTo(e.target.value)}
                      placeholder="Issued to"
                      className="h-9 text-sm bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Stock Out Items */}
            <Card className="border-0 bg-white rounded-xl overflow-visible">
              <CardContent className="p-2">
                <div className="rounded-lg border border-slate-200 overflow-x-auto overflow-y-visible">
                  <table className="w-full">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[48px]">#</th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[320px] min-w-[320px]">
                          <div className="flex items-center justify-between gap-2">
                            <span>Item</span>
                            <Button type="button" variant="outline" size="sm" onClick={addItem} className="h-7 px-2 text-[10px]">
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add Row
                            </Button>
                          </div>
                        </th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[220px]">Variant</th>
                        <th className="h-8 px-2 text-left text-xs font-semibold text-slate-600 w-[160px]">Brand</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[120px]">Disc</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[120px]">Tax Amt</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[130px]">Current Qty</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[110px]">Qty</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[140px]">Unit Cost</th>
                        <th className="h-8 px-2 text-right text-xs font-semibold text-slate-600 w-[140px]">Amount</th>
                        <th className="h-8 px-2 text-center text-xs font-semibold text-slate-600 w-[56px]">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={it.id} className="border-t border-slate-200">
                          <td className="px-2 py-1.5 text-xs text-slate-700">{idx + 1}</td>
                          <td className="px-2 py-1.5 w-[320px] min-w-[320px]">
                            <Popover
                              open={itemPickerRowId === it.id}
                              onOpenChange={(open) => {
                                if (open) {
                                  setItemPickerRowId(it.id);
                                  setItemPickerQuery("");
                                } else {
                                  setItemPickerRowId(null);
                                  setItemPickerQuery("");
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  ref={(el) => {
                                    itemInputRefs.current[it.id] = el;
                                  }}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  role="combobox"
                                  className="h-8 w-full justify-between text-xs bg-white border-slate-300"
                                >
                                  <span className={it.itemName ? "truncate text-slate-900" : "truncate text-muted-foreground"}>
                                    {it.itemName || "Select item"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                              </PopoverTrigger>

                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" side="bottom" collisionPadding={8}>
                                <Command>
                                  <CommandInput
                                    placeholder="Search item..."
                                    className="h-9"
                                    value={itemPickerQuery}
                                    onValueChange={setItemPickerQuery}
                                  />
                                  <CommandList>
                                    <CommandEmpty>No items found.</CommandEmpty>
                                    <CommandGroup>
                                      {masterInventory
                                        .filter((p) => {
                                          const q = itemPickerQuery.trim().toLowerCase();
                                          if (!q) return true;
                                          return p.item_name.toLowerCase().includes(q);
                                        })
                                        .slice(0, 50)
                                        .map((p) => (
                                          <CommandItem key={p.id} value={p.item_name} onSelect={() => selectInventoryItem(it.id, p)}>
                                            <div className="flex w-full items-center justify-between gap-2">
                                              <span className="truncate">{p.item_name}</span>
                                              {p.brand ? (
                                                <span className="text-[10px] text-slate-500 truncate max-w-[45%]">{p.brand}</span>
                                              ) : null}
                                            </div>
                                          </CommandItem>
                                        ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </td>

                          <td className="px-2 py-1.5">
                            <Popover
                              open={variantPickerRowId === it.id}
                              onOpenChange={(open) => {
                                if (!it.itemName.trim()) return;
                                if (open) {
                                  setVariantPickerRowId(it.id);
                                  setVariantPickerQuery("");
                                } else {
                                  setVariantPickerRowId(null);
                                  setVariantPickerQuery("");
                                }
                              }}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  ref={(el) => {
                                    variantTriggerRefs.current[it.id] = el;
                                  }}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  role="combobox"
                                  disabled={!it.itemName.trim()}
                                  className="h-8 w-full justify-between text-xs bg-white border-slate-300"
                                >
                                  <span className={it.variantId ? "truncate text-slate-900" : "truncate text-muted-foreground"}>
                                    {it.variantId
                                      ? (() => {
                                          const v = masterVariantById.get(String(it.variantId));
                                          const meta = [v?.size, v?.color].filter(Boolean).join(" / ");
                                          return meta ? `${v?.variant_name ?? it.variantName} (${meta})` : (v?.variant_name ?? it.variantName);
                                        })()
                                      : "Select variant"}
                                  </span>
                                  <ChevronDown className="h-4 w-4 opacity-50" />
                                </Button>
                              </PopoverTrigger>

                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start" side="bottom" collisionPadding={8}>
                                <Command>
                                  <CommandInput
                                    placeholder="Search variant..."
                                    className="h-9"
                                    ref={variantPickerRowId === it.id ? variantSearchInputRef : undefined}
                                    value={variantPickerQuery}
                                    onValueChange={setVariantPickerQuery}
                                  />
                                  <CommandList>
                                    <CommandEmpty>No variants found.</CommandEmpty>
                                    <CommandGroup>
                                      <CommandItem
                                        value="__none__"
                                        onSelect={() => {
                                          updateItem(it.id, { variantId: "", variantName: "" });
                                          setVariantPickerRowId(null);
                                          setVariantPickerQuery("");
                                          setPendingFocus({ rowId: it.id, field: "qty" });
                                        }}
                                      >
                                        Select variant
                                      </CommandItem>
                                      {masterVariants
                                        .filter((v) => {
                                          const q = variantPickerQuery.trim().toLowerCase();
                                          if (!q) return true;
                                          const hay = [v.variant_name, v.variant_id, v.size, v.color, v.width]
                                            .filter(Boolean)
                                            .join(" ")
                                            .toLowerCase();
                                          return hay.includes(q);
                                        })
                                        .slice(0, 50)
                                        .map((v) => (
                                          <CommandItem
                                            key={String(v.id)}
                                            value={String(v.variant_id)}
                                            onSelect={() => {
                                              updateItem(it.id, { variantId: String(v.variant_id), variantName: v.variant_name });
                                              setVariantPickerRowId(null);
                                              setVariantPickerQuery("");
                                              setPendingFocus({ rowId: it.id, field: "qty" });
                                            }}
                                          >
                                            <div className="flex w-full items-center justify-between gap-2">
                                              <span className="truncate">{v.variant_name}</span>
                                              <span className="text-[10px] text-slate-500 truncate max-w-[55%]">{[v.size, v.color].filter(Boolean).join(" / ")}</span>
                                            </div>
                                          </CommandItem>
                                        ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </td>

                          <td className="px-2 py-1.5">
                            <Input
                              value={it.brand}
                              readOnly
                              placeholder="Brand"
                              className="h-8 text-xs bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>

                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              value={it.discount}
                              onChange={(e) => updateItem(it.id, { discount: Number(e.target.value || 0) })}
                              placeholder="0"
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>

                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-800">
                            ₹{(taxExempt ? 0 : (Number(it.total || 0) * (Number(it.taxPercent || 0) / 100))).toFixed(2)}
                          </td>

                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-700">
                            {it.itemName.trim() ? (it.currentQty != null ? Number(it.currentQty || 0) : 0) : "-"}
                          </td>

                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={it.currentQty != null ? Math.max(Number(it.currentQty || 0), 0) : undefined}
                              inputMode="numeric"
                              value={it.quantity}
                              ref={(el) => {
                                qtyInputRefs.current[it.id] = el;
                              }}
                              onChange={(e) => {
                                const raw = Number(e.target.value || 0);
                                const available = it.currentQty != null ? Math.max(Number(it.currentQty || 0), 0) : undefined;
                                const nextQty = available != null ? Math.min(raw, available) : raw;
                                updateItem(it.id, { quantity: nextQty });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();

                                const qtyValRaw = Number((e.currentTarget as HTMLInputElement).value || 0);
                                const available = it.currentQty != null ? Math.max(Number(it.currentQty || 0), 0) : undefined;
                                const qtyVal = available != null ? Math.min(qtyValRaw, available) : qtyValRaw;
                                if (!(qtyVal > 0)) {
                                  setPendingFocus({ rowId: it.id, field: "qty" });
                                  return;
                                }

                                if (masterVariants.length > 0 && it.itemName.trim() && !String(it.variantId || "").trim()) {
                                  setVariantPickerRowId(it.id);
                                  setVariantPickerQuery("");
                                  setPendingFocus({ rowId: it.id, field: "variant" });
                                  return;
                                }

                                const rowIndex = items.findIndex((x) => x.id === it.id);
                                const nextRow = rowIndex >= 0 ? items[rowIndex + 1] : undefined;
                                if (nextRow) {
                                  setPendingFocus({ rowId: nextRow.id, field: "item" });
                                  return;
                                }

                                // If it's the last row, auto-add a new row when current row has an item.
                                if (!it.itemName.trim()) {
                                  setPendingFocus({ rowId: it.id, field: "item" });
                                  return;
                                }

                                addItem();
                                const nextId = String(nextRowIdRef.current - 1);
                                setPendingFocus({ rowId: nextId, field: "item" });
                              }}
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>

                          <td className="px-2 py-1.5">
                            <Input
                              type="number"
                              min={0}
                              inputMode="decimal"
                              value={it.unitCost}
                              onChange={(e) => updateItem(it.id, { unitCost: Number(e.target.value || 0) })}
                              placeholder="0"
                              className="h-8 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                            />
                          </td>

                          <td className="px-2 py-1.5 text-right text-xs tabular-nums text-slate-800">₹{(it.total || 0).toFixed(2)}</td>

                          <td className="px-2 py-1.5 text-center">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => removeItem(it.id)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              title="Remove"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Stock Out Summary */}
            <Collapsible open={summaryOpen} onOpenChange={setSummaryOpen}>
              <Card className="border-0 bg-white rounded-xl overflow-hidden">
                <CardHeader className="bg-white border-b border-slate-200 py-3 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-1 rounded-full bg-blue-600/80" aria-hidden="true" />
                      <CardTitle className="text-base font-semibold tracking-tight text-slate-900">Stock Out Summary</CardTitle>
                    </div>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className={[
                          "inline-flex items-center gap-1 px-4 h-8 rounded-full border border-blue-500 bg-white text-blue-700 font-semibold text-xs shadow-sm transition-all",
                          summaryOpen ? "bg-blue-50" : "bg-white",
                        ].join(" ")}
                        style={{ minWidth: 80 }}
                      >
                        <span>{summaryOpen ? "Close" : "Open"}</span>
                        <ChevronDown className={["ml-1 h-4 w-4 transition-transform", summaryOpen ? "rotate-180" : ""].join(" ")} />
                      </button>
                    </CollapsibleTrigger>
                  </div>
                </CardHeader>

                <CardContent className="space-y-2 p-2">
                  <CollapsibleContent className="space-y-2">
                    <div className="space-y-2 bg-gray-50/80 p-2 rounded-lg border border-gray-100">
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-gray-600">Subtotal</span>
                        <span className="font-medium text-gray-800 tabular-nums">₹{subtotal.toFixed(2)}</span>
                      </div>

                      <div className="pt-1 border-t border-gray-200 space-y-1">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">CGST</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{cgst.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">SGST</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{sgst.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-gray-600">Round Off</span>
                          <span className="font-medium text-gray-800 tabular-nums">₹{roundOff.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </CollapsibleContent>

                  <div className="grid grid-cols-1 gap-2 md:grid-cols-12 md:items-stretch">
                    <div className="md:col-span-4 space-y-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-2">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-[10px] font-semibold text-slate-700">Discount</Label>
                          <Input
                            type="number"
                            value={discount}
                            onChange={(e) => {
                              const next = Number(e.target.value || 0);
                              const safe = Number.isFinite(next) ? Math.max(next, 0) : 0;
                              const clamped = Math.min(safe, subtotal);
                              if (safe > subtotal) {
                                toast({
                                  title: "Invalid discount",
                                  description: "Discount cannot be more than subtotal.",
                                  variant: "warning",
                                });
                              }
                              setDiscount(clamped);
                            }}
                            className="h-8 w-24 text-xs text-right bg-white border-slate-300 focus-visible:ring-0 focus-visible:ring-offset-0"
                          />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          <Label className="text-[10px] font-semibold text-slate-700">Tax Exempt</Label>
                          <Switch checked={taxExempt} onCheckedChange={setTaxExempt} className="scale-90" />
                        </div>
                      </div>

                      <div className="bg-green-50 p-4 min-h-[120px] rounded-lg border-2 border-green-600 flex flex-col justify-center shadow-sm">
                        <div className="text-center text-sm text-green-800 font-semibold tracking-tight">Total Amount</div>
                        <div className="text-center text-2xl font-bold text-green-800 tabular-nums">₹{grandTotalRounded.toFixed(0)}</div>
                      </div>
                    </div>

                    <div className="md:col-span-8 rounded-lg border border-slate-200 bg-white p-2">
                      <div className="mt-1 flex flex-col gap-2 items-stretch sm:items-end">
                        <Button type="submit" className="w-full sm:w-[260px] h-10" disabled={loading}>
                          {isEditing ? "Update Stock Out (F10)" : "Create Stock Out (F10)"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-[260px] h-10 border-amber-300 text-amber-800 hover:bg-amber-50"
                          disabled={loading}
                          onClick={() => void handleCreate("N")}
                        >
                          Hold (F8)
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full sm:w-[260px] h-10 border-red-300 text-red-700 hover:bg-red-50"
                          disabled={loading}
                          onClick={() => void handleCreate("C")}
                        >
                          Cancel (F9)
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Collapsible>
          </div>
        </div>
      </div>
    </form>
  );
}
