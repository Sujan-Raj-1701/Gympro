import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Printer, X } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceService } from "@/services/invoiceService";
import { DataService } from "@/services/userService";

type CompanyProfile = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  logoUrl?: string;
};

type TallyItem = {
  sl: number;
  particulars: string;
  hsnSac?: string;
  qty: number;
  rate: number;
  baseAmount: number;
  taxRatePercent?: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  lineTotal: number;
};

type HsnTaxSummaryRow = {
  hsnSac: string;
  taxableValue: number;
  ratePercent: number;
  taxAmount: number;
  totalTaxAmount: number;
};

const clean = (v: any) => String(v ?? "").trim();
const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const pickAny = (obj: any, keys: string[]): string => {
  if (!obj || typeof obj !== "object") return "";
  const map = new Map<string, string>();
  for (const k of Object.keys(obj)) map.set(k.toLowerCase(), k);
  for (const k of keys) {
    const ak = map.get(k.toLowerCase());
    if (!ak) continue;
    const v = obj[ak];
    if (v != null && String(v).trim() !== "") return clean(v);
  }
  return "";
};

const firstRowFromRead = (data: any, table: string): any => {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  if (typeof data === "object") {
    const t = (data as any)[table] ?? (data as any)[table.toLowerCase()] ?? (data as any)[table.toUpperCase()];
    if (Array.isArray(t)) return t[0] || null;
    if (t && typeof t === "object") return t;
  }
  return null;
};

const pickFirst = (objList: any[], keys: string[]): string => {
  for (const src of objList) {
    if (!src) continue;
    for (const k of keys) {
      const v = clean(src?.[k]);
      if (v && v !== "null" && v !== "undefined") return v;
    }
  }
  return "";
};

const formatINR = (n: number) => {
  try {
    return `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch {
    return `₹${Number(n || 0).toFixed(2)}`;
  }
};

const normalizeTaxPctDisplay = (n: number) => {
  const v = Number(n || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  // Many GST rates are in 0.5% steps (e.g., 2.5, 5, 12, 18).
  // Snap tiny rounding artifacts (like 5.01%) to the nearest 0.5%.
  const snapped = Math.round(v * 2) / 2;
  return Math.abs(v - snapped) <= 0.05 ? Number(snapped.toFixed(2)) : Number(v.toFixed(2));
};

const formatPct = (n: number) => {
  const v = normalizeTaxPctDisplay(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  return `${v % 1 === 0 ? String(v.toFixed(0)) : String(v.toFixed(2))}%`;
};

const formatPctNoTrim = (n: number) => {
  const v = normalizeTaxPctDisplay(n);
  if (!Number.isFinite(v) || v <= 0) return "0";
  return `${v % 1 === 0 ? String(v.toFixed(0)) : String(v.toFixed(2))}%`;
};

const deriveRatePercent = (taxAmount: number, taxableValue: number): number => {
  const t = Number(taxAmount || 0);
  const base = Number(taxableValue || 0);
  if (!Number.isFinite(t) || !Number.isFinite(base) || base <= 0) return 0;
  const r = (t / base) * 100;
  return Number.isFinite(r) ? Number(r.toFixed(2)) : 0;
};

const toWordsBelow100 = (n: number): string => {
  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (n < 20) return ones[n] || "";
  const t = Math.floor(n / 10);
  const o = n % 10;
  return [tens[t], ones[o]].filter(Boolean).join(" ");
};

const toWordsIndian = (nInput: number): string => {
  let n = Math.floor(Math.abs(Number(nInput) || 0));
  if (n === 0) return "Zero";

  const parts: string[] = [];

  const pushPart = (count: number, label: string) => {
    if (count <= 0) return;
    parts.push(`${toWordsIndian(count)} ${label}`.trim());
  };

  const crore = Math.floor(n / 10000000);
  n = n % 10000000;
  pushPart(crore, "Crore");

  const lakh = Math.floor(n / 100000);
  n = n % 100000;
  pushPart(lakh, "Lakh");

  const thousand = Math.floor(n / 1000);
  n = n % 1000;
  pushPart(thousand, "Thousand");

  const hundred = Math.floor(n / 100);
  n = n % 100;
  if (hundred > 0) {
    parts.push(`${toWordsBelow100(hundred)} Hundred`.trim());
  }

  if (n > 0) {
    const last = toWordsBelow100(n);
    if (last) parts.push(last);
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
};

const amountToWordsINR = (amountInput: number): string => {
  const safe = Number(amountInput || 0);
  let rupees = Math.floor(Math.abs(safe));
  let paise = Math.round((Math.abs(safe) - rupees) * 100);
  if (paise >= 100) {
    rupees += 1;
    paise = 0;
  }
  const rupeesWords = toWordsIndian(rupees);
  const paiseWords = paise > 0 ? toWordsIndian(paise) : "";
  const sign = safe < 0 ? "Minus " : "";
  return `${sign}Rupees ${rupeesWords}${paise > 0 ? ` and Paise ${paiseWords}` : ""} Only`;
};

const formatMoneyPdf = (n: number) => {
  const numberFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `Rs. ${numberFmt.format(Number(n || 0))}`;
};

const formatDateTime = (v: any): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export default function InvoiceTallyPrint() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const invoiceDocTitle = useMemo(() => {
    const qs = new URLSearchParams(location.search || "");
    const rawType = (qs.get("doc") || qs.get("type") || "").toLowerCase();
    return rawType === "proforma" ? "Proforma Invoice" : "Tax Invoice";
  }, [location.search]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanyProfile>({});
  const [masterHsn, setMasterHsn] = useState<any[]>([]);
  const [masterService, setMasterService] = useState<any[]>([]);
  const [masterInventory, setMasterInventory] = useState<any[]>([]);
  const [raw, setRaw] = useState<any | null>(null);

  useEffect(() => {
    const run = async () => {
      if (!user || !id) return;
      const acc = (user as any)?.account_code;
      const ret = (user as any)?.retail_code;
      if (!acc || !ret) return;

      setLoading(true);
      setError(null);

      try {
        const [invoiceRespRaw, masterRespRaw] = await Promise.all([
          InvoiceService.get(id, acc, ret),
          DataService.readData(["retail_master", "master_hsn", "master_service", "master_inventory"], acc, ret).catch(() => null),
        ]);

        const invoiceResp: any = invoiceRespRaw as any;
        const masterResp: any = masterRespRaw as any;

        if (!invoiceResp?.success) throw new Error("Failed to load invoice");
        setRaw(invoiceResp);

        const retailRoot: any = masterResp?.data || {};

        // Master tables (for HSN/SAC resolution)
        const hsnRows = (retailRoot?.master_hsn && Array.isArray(retailRoot.master_hsn))
          ? retailRoot.master_hsn
          : [];
        const svcRows = (retailRoot?.master_service && Array.isArray(retailRoot.master_service))
          ? retailRoot.master_service
          : [];
        const invRows = (retailRoot?.master_inventory && Array.isArray(retailRoot.master_inventory))
          ? retailRoot.master_inventory
          : (retailRoot?.inventory && Array.isArray(retailRoot.inventory))
            ? retailRoot.inventory
            : (retailRoot?.product_master && Array.isArray(retailRoot.product_master))
              ? retailRoot.product_master
              : (retailRoot?.products && Array.isArray(retailRoot.products))
                ? retailRoot.products
                : [];
        setMasterHsn(hsnRows);
        setMasterService(svcRows);
        setMasterInventory(invRows);

        const rm: any =
          firstRowFromRead(retailRoot, "retail_master") ||
          retailRoot?.retailMaster ||
          retailRoot?.retail ||
          null;

        const name = pickAny(rm, ["shop_name", "retail_name", "retailname", "company_name", "org_name", "name"]);
        const a1 = pickAny(rm, ["address", "address1", "address_line1", "shop_address", "retail_address", "company_address", "addr1", "line1"]);
        const a2 = pickAny(rm, ["address2", "address_line2", "addr2", "line2"]);
        const city = pickAny(rm, ["city", "city_name"]);
        const state = pickAny(rm, ["state", "state_name"]);
        const pin = pickAny(rm, ["pincode", "pin", "zip", "zipcode"]);
        const address = [a1, a2, [city, state, pin].filter(Boolean).join(", ")].filter(Boolean).join(", ");
        const phone = pickAny(rm, [
          "phone",
          "phone_no",
          "mobile",
          "mobile_no",
          "contact",
          "contact_no",
          "contact_number",
          "org_phone",
          "shop_phone",
          "retail_phone",
          "phone1",
          "phone2",
          "landline",
          "tel",
          "telephone",
          "whatsapp",
        ]);
        const email = pickAny(rm, ["email", "mail", "contact_email"]);
        const gstin = pickAny(rm, ["gstin", "gst_no", "gst", "gst_number", "org_gstin"]);
        const logoUrl = pickAny(rm, ["logo", "Logo"]);

        const profile: CompanyProfile = { name, address, phone, email, gstin, logoUrl };
        setCompany(profile);
      } catch (e: any) {
        setError(e?.message || "Failed to load invoice");
      } finally {
        setLoading(false);
      }
    };

    run();
  }, [user, id]);

  const view = useMemo(() => {
    const resp: any = raw || {};
    const header: any = resp?.header || {};
    const lines: any[] = Array.isArray(resp?.data) ? resp.data : [];
    const packages: any[] = Array.isArray(resp?.packages) ? resp.packages : [];
    const inventory: any[] = Array.isArray(resp?.inventory) ? resp.inventory : [];
    const payments: any[] = Array.isArray(resp?.payments) ? resp.payments : [];
    const customerLines: any[] = Array.isArray((resp as any)?.customer_lines) ? (resp as any).customer_lines : [];

    const norm = (v: any) => String(v ?? "").trim();
    const hsnLookup = (() => {
      const map = new Map<string, any>();
      for (const r of (masterHsn || [])) {
        const keys = [r?.hsn_id, r?.id, r?.code, r?.hsn_code, r?.hsnSac, r?.hsn, r?.description, r?.name]
          .map(norm)
          .filter(Boolean);
        for (const k of keys) if (!map.has(k)) map.set(k, r);
      }
      return map;
    })();
    const serviceLookup = (() => {
      const map = new Map<string, any>();
      for (const r of (masterService || [])) {
        const keys = [r?.service_id, r?.id, r?.code, r?.service_code]
          .map(norm)
          .filter(Boolean);
        for (const k of keys) if (!map.has(k)) map.set(k, r);
      }
      return map;
    })();

    const inventoryLookup = (() => {
      const map = new Map<string, any>();
      for (const r of (masterInventory || [])) {
        const keys = [r?.product_id, r?.id, r?.item_id, r?.itemId, r?.barcode, r?.sku]
          .map(norm)
          .filter(Boolean);
        for (const k of keys) if (!map.has(k)) map.set(k, r);
      }
      return map;
    })();

    const resolveHsnDisplay = (hsnKey: any): string => {
      const k = norm(hsnKey);
      if (!k) return "";
      const rec = hsnLookup.get(k);
      if (!rec) return k;
      // In this DB, master_hsn.description often stores the numeric HSN/SAC code
      const display = norm(rec?.description || rec?.hsn_code || rec?.code || rec?.hsnSac || rec?.name || "");
      return display || k;
    };

    const possibleSources = [header, ...(customerLines || []), ...(lines || []), ...(packages || []), ...(inventory || [])];

    const customerName =
      pickFirst(possibleSources, [
        "customer_name",
        "customerr_name",
        "txn_customer_name",
        "customer",
        "customer_full_name",
        "customerName",
        "customername",
        "name",
        "full_name",
      ]) || "Customer";

    const customerPhone = pickFirst(possibleSources, [
      "customer_number",
      "customer_phone",
      "customer_mobile",
      "phone",
      "mobile",
    ]);

    const customerEmail = pickFirst(possibleSources, ["customer_email", "email"]);

    let customerAddress = pickFirst(possibleSources, [
      "customer_address",
      "address",
      "customerAddress",
    ]);

    if (!customerAddress) {
      const addressParts: string[] = [];
      const addPart = (keys: string[]) => {
        const val = pickFirst(possibleSources, keys);
        if (val != null && String(val).trim() !== "") {
          addressParts.push(String(val).trim());
        }
      };

      addPart(["address1", "customer_address1", "customerAddress1", "street", "street1"]);
      addPart(["address2", "customer_address2", "customerAddress2", "street2"]);
      addPart(["area", "locality"]);
      addPart(["city", "town", "district"]);
      addPart(["state", "state_name"]);
      addPart(["pincode", "pin", "zip", "postal_code"]);

      if (addressParts.length) {
        customerAddress = addressParts.join(", ");
      }
    }

    const createdAt = header?.created_at || header?.last_created_at || lines?.[0]?.created_at || null;
    const invoiceDate = formatDateTime(createdAt) || new Date();

    const normalizeLine = (
      row: any,
      fallbackName: string
    ): Omit<TallyItem, "sl" | "taxable" | "cgst" | "sgst" | "igst" | "totalTax" | "lineTotal"> => {
      const particulars =
        clean(
          row?.service_name ||
            row?.package_name ||
            row?.product_name ||
            row?.item_name ||
            row?.name ||
            fallbackName
        ) || fallbackName;

      let hsnSac = clean(
        row?.hsn_sac ||
          row?.hsnSac ||
          row?.hsn_id ||
          row?.hsnId ||
          row?.hsn_sac_id ||
          row?.hsnSacId ||
          row?.hsn ||
          row?.sac ||
          row?.hsn_sac_code ||
          row?.hsn_code ||
          row?.sac_code
      );

      // Fallback: resolve from master_service -> master_hsn when line doesn't carry HSN
      if (!hsnSac) {
        const svcId = norm(row?.service_id ?? row?.serviceId ?? row?.service_code ?? row?.serviceCode ?? "");
        if (svcId) {
          const svc = serviceLookup.get(svcId);
          const hsnKey = svc?.hsn_id ?? svc?.hsnId ?? svc?.hsn_code ?? svc?.hsnCode ?? svc?.hsn ?? "";
          hsnSac = resolveHsnDisplay(hsnKey);
        }
      }

      // Fallback for inventory: resolve HSN from master_inventory -> master_hsn
      if (!hsnSac) {
        const pid = norm(row?.product_id ?? row?.productId ?? row?.id ?? "");
        if (pid) {
          const invRec = inventoryLookup.get(pid);
          const hsnKey = invRec?.hsn_id ?? invRec?.hsnId ?? invRec?.hsn_code ?? invRec?.hsnCode ?? invRec?.hsn ?? "";
          hsnSac = resolveHsnDisplay(hsnKey);
        }
      } else {
        // If we got an id-like key, try to map it to display value
        hsnSac = resolveHsnDisplay(hsnSac);
      }

      const qty = Math.max(1, num(row?.qty ?? row?.quantity ?? 1));
      const rate = num(row?.unit_price ?? row?.price ?? row?.rate ?? row?.amount ?? row?.package_price ?? 0);

      const explicitAmount = num(
        row?.item_total ??
          row?.grand_total ??
          row?.total ??
          row?.amount_total ??
          row?.line_total ??
          row?.lineamount
      );

      const baseAmount = explicitAmount > 0 ? explicitAmount : rate * qty;

      const taxRatePercent = num(
        row?.tax_rate_percent ??
          row?.taxRatePercent ??
          row?.tax_percent ??
          row?.taxPercent ??
          row?.gst_rate_percent ??
          row?.gstRatePercent ??
          row?.gst_percent ??
          row?.gstPercent ??
          row?.gst_percentage ??
          row?.tax_percentage ??
          0,
      );

      return {
        particulars,
        hsnSac: hsnSac || "",
        qty,
        rate,
        baseAmount,
        taxRatePercent: taxRatePercent > 0 ? Number(taxRatePercent.toFixed(2)) : undefined,
      };
    };

    const rawItems: Array<Omit<TallyItem, "taxable" | "cgst" | "sgst" | "igst" | "totalTax" | "lineTotal">> = [];
    for (const ln of lines) rawItems.push({ sl: rawItems.length + 1, ...normalizeLine(ln, "Service") });
    for (const p of packages) rawItems.push({ sl: rawItems.length + 1, ...normalizeLine(p, "Package") });
    for (const it of inventory) rawItems.push({ sl: rawItems.length + 1, ...normalizeLine(it, "Product") });

    const subtotalComputed = rawItems.reduce((s, r) => s + num(r.baseAmount), 0);
    const subtotal = num(header?.subtotal ?? subtotalComputed);
    const discount = num(header?.discount_amount ?? lines?.[0]?.discount_amount ?? 0);

    const taxRatePercent = num(header?.tax_rate_percent ?? lines?.[0]?.tax_rate_percent ?? 0);

    const cgst = num(header?.total_cgst ?? lines.reduce((s, r) => s + num(r?.cgst_amount ?? r?.total_cgst), 0));
    const sgst = num(header?.total_sgst ?? lines.reduce((s, r) => s + num(r?.sgst_amount ?? r?.total_sgst), 0));
    const igst = num(header?.total_igst ?? lines.reduce((s, r) => s + num(r?.igst_amount ?? r?.total_igst), 0));
    const taxDirect = num(header?.tax_amount ?? lines.reduce((s, r) => s + num(r?.tax_amount ?? r?.total_tax), 0));
    const taxAmount = Math.max(0, Number((cgst + sgst + igst).toFixed(2)) || 0) || Number(taxDirect.toFixed(2));

    const roundoff = num(header?.roundoff ?? 0);
    const grandTotal = num(header?.grand_total ?? (subtotal - discount + taxAmount + roundoff));

    const taxableValue = Math.max(0, subtotal - discount);

    // Allocate discount + tax across items for an e-invoice-like line table.
    const subtotalBeforeDiscount = subtotalComputed > 0 ? subtotalComputed : rawItems.reduce((s, r) => s + num(r.qty) * num(r.rate), 0);
    const discountFactor = subtotalBeforeDiscount > 0 ? taxableValue / subtotalBeforeDiscount : 1;
    const denom = taxableValue > 0 ? taxableValue : 0;

    const items: TallyItem[] = rawItems.map((r) => {
      const taxable = Number((num(r.baseAmount) * discountFactor).toFixed(2));
      const share = denom > 0 ? taxable / denom : 0;
      const lineCgst = Number((cgst * share).toFixed(2));
      const lineSgst = Number((sgst * share).toFixed(2));
      const lineIgst = Number((igst * share).toFixed(2));

      const effectiveTaxRatePercent =
        (r as any)?.taxRatePercent != null
          ? num((r as any).taxRatePercent)
          : taxRatePercent > 0
            ? Number(taxRatePercent.toFixed(2))
            : undefined;

      // If only a single tax total exists (no split), split to CGST/SGST for display when IGST is zero.
      if (cgst === 0 && sgst === 0 && igst === 0 && taxAmount > 0) {
        const lineTax = Number((taxAmount * share).toFixed(2));
        const half = Number((lineTax / 2).toFixed(2));
        const lineTotalTax = lineTax;
        const lineTotal = Number((taxable + lineTotalTax).toFixed(2));
        return {
          ...r,
          taxRatePercent: effectiveTaxRatePercent,
          taxable,
          cgst: igst > 0 ? 0 : half,
          sgst: igst > 0 ? 0 : Number((lineTax - half).toFixed(2)),
          igst: igst > 0 ? lineTax : 0,
          totalTax: lineTotalTax,
          lineTotal,
        };
      }

      const lineTotalTax = Number((lineCgst + lineSgst + lineIgst).toFixed(2));
      const lineTotal = Number((taxable + lineTotalTax).toFixed(2));
      return {
        ...r,
        taxRatePercent: effectiveTaxRatePercent,
        taxable,
        cgst: lineCgst,
        sgst: lineSgst,
        igst: lineIgst,
        totalTax: lineTotalTax,
        lineTotal,
      };
    });

    const hsnSummaryMap = new Map<string, HsnTaxSummaryRow>();
    for (const it of items) {
      const hsn = clean(it.hsnSac) || "-";
      const ratePercent =
        it.taxRatePercent != null && num(it.taxRatePercent) > 0
          ? Number(num(it.taxRatePercent).toFixed(2))
          : deriveRatePercent(it.totalTax, it.taxable);
      const rateKey = String(Number(ratePercent || 0).toFixed(2));
      const key = `${hsn}__${rateKey}`;
      const existing = hsnSummaryMap.get(key);
      if (!existing) {
        hsnSummaryMap.set(key, {
          hsnSac: hsn,
          taxableValue: num(it.taxable),
          ratePercent,
          taxAmount: num(it.totalTax),
          totalTaxAmount: num(it.totalTax),
        });
      } else {
        existing.taxableValue = Number((existing.taxableValue + num(it.taxable)).toFixed(2));
        existing.taxAmount = Number((existing.taxAmount + num(it.totalTax)).toFixed(2));
        existing.totalTaxAmount = Number((existing.totalTaxAmount + num(it.totalTax)).toFixed(2));
      }
    }
    const hsnSummary: HsnTaxSummaryRow[] = Array.from(hsnSummaryMap.values()).sort((a, b) => {
      const ah = a.hsnSac === "-" ? "" : a.hsnSac;
      const bh = b.hsnSac === "-" ? "" : b.hsnSac;
      if (ah !== bh) return ah.localeCompare(bh);
      return (a.ratePercent || 0) - (b.ratePercent || 0);
    });

    // Derive per-tax rates (Tally-like display)
    const cgstRate =
      cgst > 0
        ? (taxRatePercent > 0 && sgst > 0 && igst === 0
            ? Number((taxRatePercent / 2).toFixed(2))
            : deriveRatePercent(cgst, taxableValue))
        : 0;
    const sgstRate =
      sgst > 0
        ? (taxRatePercent > 0 && cgst > 0 && igst === 0
            ? Number((taxRatePercent / 2).toFixed(2))
            : deriveRatePercent(sgst, taxableValue))
        : 0;
    const igstRate = igst > 0 ? (taxRatePercent > 0 ? Number(taxRatePercent.toFixed(2)) : deriveRatePercent(igst, taxableValue)) : 0;
    const totalGst = Number((cgst + sgst + igst).toFixed(2));

    const totalPaid = payments.reduce((s, p) => s + num(p?.amount ?? p?.payment_amount), 0);
    const creditAmount = num(resp?.credit_amount ?? 0);
    const balance = Math.max(0, grandTotal - creditAmount - totalPaid);

    const paymentSummary = payments
      .map((p) => {
        const mode = clean(p?.payment_mode_name || p?.payment_method || p?.mode) || "Payment";
        const amt = num(p?.amount ?? p?.payment_amount);
        return `${mode} ${formatINR(amt)}`;
      })
      .filter(Boolean)
      .join(", ");

    return {
      header,
      items,
      invoiceDate,
      customer: { name: customerName, phone: customerPhone, email: customerEmail, address: customerAddress },
      totals: { subtotal, discount, cgst, sgst, igst, taxAmount, roundoff, grandTotal, creditAmount, totalPaid, balance },
      amountInWords: amountToWordsINR(grandTotal),
      taxSummary: {
        taxableValue,
        taxRatePercent,
        cgstRate,
        sgstRate,
        igstRate,
        totalGst,
      },
      hsnSummary,
      paymentSummary,
    };
  }, [raw, masterHsn, masterService, masterInventory]);

  useEffect(() => {
    if (loading || error || !id || !raw) return;
    const d = view.invoiceDate;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return;

    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    const prefix = invoiceDocTitle === 'Proforma Invoice' ? 'Proforma' : 'Invoice';
    const nextTitle = `${prefix}-${String(id)}-${dd}-${mm}-${yyyy}`;

    const prev = document.title;
    document.title = nextTitle;
    return () => {
      document.title = prev;
    };
  }, [loading, error, id, raw, view.invoiceDate?.getTime?.(), invoiceDocTitle]);

  const downloadPdf = () => {
    if (loading || error || !id) return;

    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 10;
    const contentW = pageWidth - margin * 2;
    let y = margin;

    const title = (company.name || "TAX INVOICE").toString().trim() || "TAX INVOICE";

    // Header (E-Invoice style)
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text(invoiceDocTitle.toUpperCase(), pageWidth / 2, y + 2, { align: "center" });
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const addressLine = (company.address || "").toString().trim();
    const contactLine = [
      company.phone ? `Ph: ${String(company.phone)}` : "",
      company.email ? `Email: ${String(company.email)}` : "",
    ].filter(Boolean).join("  |  ");
    const gstLine = company.gstin ? `GSTIN: ${String(company.gstin)}` : "";

    const headerLines = [addressLine, contactLine, gstLine].filter(Boolean);
    if (headerLines.length) {
      doc.setFontSize(8);
      for (const ln of headerLines) { 
        doc.text(String(ln), pageWidth / 2, y, { align: "center" });
        y += 4;
      }
      y += 1;
    }

    // Outer border
    const topBorderY = y;
    doc.setDrawColor(90);
    doc.rect(margin, topBorderY, contentW, pageHeight - topBorderY - margin);

    // Parties + invoice details (3-column box)
    const boxY = topBorderY;
    const boxH = 54;
    const colW = contentW / 3;
    const col1W = colW; 
    const col2W = colW;
    const col3W = contentW - col1W - col2W;

    const col1X = margin + 2;
    const col2X = margin + col1W + 2;
    const col3X = margin + col1W + col2W + 2;

    doc.line(margin + col1W, boxY, margin + col1W, boxY + boxH);
    doc.line(margin + col1W + col2W, boxY, margin + col1W + col2W, boxY + boxH);
    doc.line(margin, boxY + boxH, margin + contentW, boxY + boxH);

    const lineH = 4;
    const maxYInBox = boxY + boxH - 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("SUPPLIER (FROM)", col1X, boxY + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.text(String(company.name || "-"), col1X, boxY + 11);
    let ySup = boxY + 15;
    if (company.address) {
      const addrLines = doc.splitTextToSize(String(company.address), col1W - 4);
      doc.text(addrLines, col1X, ySup);
      ySup += addrLines.length * lineH;
    }
    if (company.gstin && ySup <= maxYInBox) {
      doc.text(`GSTIN: ${String(company.gstin)}`, col1X, ySup);
      ySup += lineH + 1;
    }
    if (company.phone && ySup <= maxYInBox) {
      doc.text(`Ph: ${String(company.phone)}`, col1X, ySup);
      ySup += lineH + 1;
    }

    doc.setFont("helvetica", "bold");
    doc.text("BUYER (BILL TO)", col2X, boxY + 6);
    doc.setFont("helvetica", "normal");
    doc.text(String(view.customer.name || "Customer"), col2X, boxY + 11);
    let yBuy = boxY + 15;
    if (view.customer.address) {
      const addrLines = doc.splitTextToSize(String(view.customer.address), col2W - 4);
      doc.text(addrLines, col2X, yBuy);
      yBuy += addrLines.length * lineH;
    }
    if (view.customer.phone && yBuy <= maxYInBox) {
      doc.text(`Ph: ${String(view.customer.phone)}`, col2X, yBuy);
      yBuy += lineH + 1;
    }
    if (view.customer.email && yBuy <= maxYInBox) {
      doc.text(`Email: ${String(view.customer.email)}`, col2X, yBuy);
      yBuy += lineH + 1;
    }

    // Invoice details (third segment)
    doc.setFont("helvetica", "bold");
    doc.text("INVOICE DETAILS", col3X, boxY + 6);
    doc.setFont("helvetica", "normal");
    doc.text(`Invoice No: ${String(id)}`, col3X, boxY + 12);
    doc.text(`Date: ${view.invoiceDate.toLocaleDateString("en-GB")}`, col3X, boxY + 17);
    doc.text(
      `Time: ${view.invoiceDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
      col3X,
      boxY + 22,
    );
    const payLabel = "Payment: ";
    const payText = String(view.paymentSummary || "-");
    doc.text(payLabel, col3X, boxY + 27);
    doc.text(doc.splitTextToSize(payText, col3W - 4), col3X + doc.getTextWidth(payLabel), boxY + 27);

    // Items table (columns like the sample)
    const tableStartY = boxY + boxH + 8;
    const discountFactor = view.totals.subtotal > 0 ? (view.taxSummary?.taxableValue || 0) / view.totals.subtotal : 1;
    const discountPct = Math.max(0, Math.min(99.99, (1 - discountFactor) * 100));
    const bodyRows = (view.items || []).map((it) => {
      const rateEffective = it.qty > 0 ? it.taxable / it.qty : it.rate;
      const taxPct = it.taxRatePercent != null && it.taxRatePercent > 0 ? it.taxRatePercent : deriveRatePercent(it.totalTax, it.taxable);
      const rateText = discountPct > 0
        ? `${formatMoneyPdf(rateEffective)}\n${formatMoneyPdf(it.rate)} (${discountPct.toFixed(2)}% Disc)`
        : formatMoneyPdf(rateEffective);
      return [
        String(it.sl),
        String(it.particulars || ""),
        String(it.hsnSac || "-"),
        formatPctNoTrim(taxPct),
        String(it.qty || ""),
        rateText,
        "Nos",
        formatMoneyPdf(it.taxable),
      ];
    });

    autoTable(doc, {
      head: [["#", "Item", "HSN/SAC", "Tax", "Qty", "Rate/Item", "Per", "Amount"]],
      body: bodyRows.length ? bodyRows : [["", "No items", "", "", "", "", "", ""]],
      startY: tableStartY,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 2,
        textColor: [0, 0, 0],
        lineColor: [90, 90, 90],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        lineColor: [90, 90, 90],
      },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: contentW - (8 + 18 + 12 + 12 + 28 + 12 + 24) },
        2: { cellWidth: 18 },
        3: { cellWidth: 12, halign: "right" },
        4: { cellWidth: 12, halign: "right" },
        5: { cellWidth: 28, halign: "right" },
        6: { cellWidth: 12, halign: "right" },
        7: { cellWidth: 24, halign: "right" },
      },
    });

    const lastY = (doc as any).lastAutoTable?.finalY ? Number((doc as any).lastAutoTable.finalY) : tableStartY + 30;

    // HSN/SAC Tax Summary (separate, like e-invoice formats)
    const hsnStartY = lastY + 4;
    const hsnRows = (view.hsnSummary || []).map((r) => [
      String(r.hsnSac || "-"),
      formatMoneyPdf(r.taxableValue),
      formatPct(r.ratePercent),
      formatMoneyPdf(r.taxAmount),
      formatMoneyPdf(r.totalTaxAmount),
    ]);

    autoTable(doc, {
      head: [["HSN/SAC", "Taxable Value", "Rate", "Integrated Tax Amount", "Total Tax Amount"]],
      body: hsnRows.length ? hsnRows : [["-", formatMoneyPdf(view.taxSummary?.taxableValue || 0), formatPct(view.taxSummary?.taxRatePercent || 0), formatMoneyPdf(view.taxSummary?.totalGst || view.totals.taxAmount || 0), formatMoneyPdf(view.taxSummary?.totalGst || view.totals.taxAmount || 0)]],
      startY: hsnStartY,
      margin: { left: margin, right: margin },
      tableWidth: contentW,
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 2,
        lineColor: [90, 90, 90],
        textColor: [0, 0, 0],
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        lineColor: [90, 90, 90],
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 28, halign: "right" },
        2: { cellWidth: 18, halign: "right" },
        3: { cellWidth: 34, halign: "right" },
        4: { cellWidth: 30, halign: "right" },
      },
    });

    const afterHsnY = (doc as any).lastAutoTable?.finalY
      ? Number((doc as any).lastAutoTable.finalY)
      : hsnStartY + 18;

    // Totals box (two columns)
    const leftW = contentW / 2;
    const totalsH = 84;
    const footerBlockH = 30; // footer line + authorised signatory
    const minStartY = afterHsnY + 3;
    const bottomY = pageHeight - margin - totalsH - footerBlockH;
    let y2 = Math.max(minStartY, bottomY);

    if (y2 + totalsH + footerBlockH > pageHeight - margin) {
      doc.addPage();
      // Full border on the new page
      doc.setDrawColor(90);
      doc.rect(margin, margin, contentW, pageHeight - margin - margin);
      y2 = Math.max(margin, bottomY);
    }
    // Top line for totals box
    doc.line(margin, y2, margin + contentW, y2);
    doc.line(margin + leftW, y2, margin + leftW, y2 + totalsH);
    doc.line(margin, y2 + totalsH, margin + contentW, y2 + totalsH);

    // Amount in words
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Amount in words", margin + 2, y2 + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const words = String(view.amountInWords || "").trim();
    const splitWords = doc.splitTextToSize(words, leftW - 4);
    doc.text(splitWords, margin + 2, y2 + 12);
    doc.setFont("helvetica", "bold");
    doc.text("Terms", margin + 2, y2 + totalsH - 14);
    doc.setFont("helvetica", "normal");
    doc.text("E. & O.E.", margin + 2, y2 + totalsH - 8);

    // Totals on right
    const tx1 = margin + contentW / 2 + 2;
    const tx2 = margin + contentW - 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let ty = y2 + 10;

    const totalsLines: [string, string][] = [];
    totalsLines.push(["Taxable Value", formatMoneyPdf(view.taxSummary?.taxableValue || 0)]);
    totalsLines.push(["Total GST", formatMoneyPdf(view.taxSummary?.totalGst || view.totals.taxAmount || 0)]);
    if (Math.abs(view.totals.roundoff) > 0.0001) totalsLines.push(["Round Off", formatMoneyPdf(view.totals.roundoff)]); 
    totalsLines.push(["Invoice Value", formatMoneyPdf(view.totals.grandTotal)]);

    for (const [k, v] of totalsLines) {
      const isGrand = k === "Invoice Value";
      if (isGrand) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
      } else {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
      }
      doc.text(k, tx1, ty);
      doc.text(v, tx2, ty, { align: "right" });
      ty += 6;
    }

    // Footer
    const fy = y2 + totalsH + 10;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("This is a computer generated invoice.", margin + 2, Math.min(pageHeight - margin, fy));
    doc.setFont("helvetica", "bold");
    doc.text(`For ${title}`, margin + contentW - 2, Math.min(pageHeight - margin, fy), { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.text("Authorised Signatory", margin + contentW - 2, Math.min(pageHeight - margin, fy + 18), { align: "right" });

    doc.save(`Invoice-${String(id)}.pdf`);
  };

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`
        /* Use a small page margin to avoid border clipping on most printers */
        @page { size: A4; margin: 6mm; }
        @media print {
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:p-0 { padding: 0 !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

          /* Make the invoice fill the page area with a full border */
          .invoice-sheet { max-width: none !important; width: 100% !important; }
          .invoice-frame {
            width: 100% !important;
            box-sizing: border-box !important;
            height: calc(297mm - 12mm) !important;
            min-height: unset !important;
            display: flex !important;
            flex-direction: column !important;
            break-inside: avoid-page !important;
            page-break-inside: avoid !important;
            break-after: avoid-page !important;
            border: 1px solid rgba(0,0,0,0.6) !important;
          }
        }
      `}</style>

      <div className="print:hidden sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto max-w-4xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // Browsers allow closing only tabs/windows opened by script.
                // Attempt to close; if blocked, fall back to history navigation.
                window.close();
                window.setTimeout(() => {
                  navigate(-1);
                }, 150);
              }}
              title="Close"
              aria-label="Close"
            >
              <X className="h-4 w-4 mr-2" /> Close
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => window.print()} title="Print" aria-label="Print">
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
          </div>
        </div>
      </div>

      <div className="invoice-sheet mx-auto max-w-4xl p-4 print:p-0">
        {loading ? (
          <div className="text-sm text-slate-600">Loading…</div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : (
          <div className="invoice-frame border border-black/60 print:shadow-none">
            {/* Header (E-Invoice style) */}
            <div className="px-4 py-3">
              <div className="relative flex items-center justify-center">
                {/* Left: Logo */}
                <div className="absolute left-0 flex items-center justify-start">
                  {company.logoUrl ? (
                    <div className="flex h-[80px] w-[120px] items-center justify-center rounded bg-white">
                      <img
                        src={company.logoUrl}
                        alt="Company logo"
                        className="max-h-[72px] max-w-[112px] object-contain"
                      />
                    </div>
                  ) : null}
                </div>

                {/* Center: Company details */}
                <div className="mx-auto max-w-[72%] text-center">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em]">{invoiceDocTitle}</div>
                  <div className="mt-1 text-lg font-bold tracking-wide break-words">{company.name || "-"}</div>
                  {company.address && <div className="text-xs break-words">{company.address}</div>}
                  <div className="text-xs">
                    {company.phone ? `Ph: ${company.phone}` : ""}
                    {company.phone && company.email ? "  |  " : ""}
                    {company.email ? `Email: ${company.email}` : ""}
                  </div>
                  {company.gstin && <div className="text-xs">GSTIN: {company.gstin}</div>}
                </div>
              </div>
            </div>

            <Separator className="bg-black/60" />

            {/* Parties + Invoice Details (3 segments) */}
            <div className="grid grid-cols-3">
              <div className="border-r border-black/60 p-3">
                <div className="text-xs font-bold uppercase">Supplier (From)</div>
                <div className="mt-1 text-sm font-semibold">{company.name || "-"}</div>
                {company.address && <div className="text-xs">{company.address}</div>}
                {company.gstin && <div className="text-xs">GSTIN: {company.gstin}</div>}
                {company.phone && <div className="text-xs">Ph: {company.phone}</div>}
              </div>
              <div className="border-r border-black/60 p-3">
                <div className="text-xs font-bold uppercase">Buyer (Bill To)</div>
                <div className="mt-1 text-sm font-semibold">{view.customer.name}</div>
                {view.customer.address && <div className="text-xs">{view.customer.address}</div>}
                {view.customer.phone && <div className="text-xs">Ph: {view.customer.phone}</div>}
                {view.customer.email && <div className="text-xs">Email: {view.customer.email}</div>}
              </div>
              <div className="p-3">
                <div className="text-xs font-bold uppercase">Invoice Details</div>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <div className="font-bold">Invoice No.</div>
                  <div className="text-right font-semibold">{id}</div>
                  <div className="font-bold">Date</div>
                  <div className="text-right">{view.invoiceDate.toLocaleDateString("en-GB")}</div>
                  <div className="font-bold">Time</div>
                  <div className="text-right">{view.invoiceDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="font-bold">Payment</div>
                  <div className="text-right">{view.paymentSummary || "-"}</div>
                </div>
              </div>
            </div>

            {/* Items (columns like the sample) */}
            <div className="p-0">
              <table className="w-full border-collapse border border-black/60 border-l-0 border-r-0">
                <thead>
                  <tr className="border-b border-black/60">
                    <th className="p-2 text-left text-[11px] font-bold w-[36px] border-r border-black/60">#</th>
                    <th className="p-2 text-left text-[11px] font-bold border-r border-black/60">Item</th>
                    <th className="p-2 text-left text-[11px] font-bold w-[90px] border-r border-black/60">HSN/SAC</th>
                    <th className="p-2 text-right text-[11px] font-bold w-[70px] border-r border-black/60">Tax</th>
                    <th className="p-2 text-right text-[11px] font-bold w-[60px] border-r border-black/60">Qty</th>
                    <th className="p-2 text-right text-[11px] font-bold w-[120px] border-r border-black/60">Rate/Item</th>
                    <th className="p-2 text-right text-[11px] font-bold w-[70px] border-r border-black/60">Per</th>
                    <th className="p-2 text-right text-[11px] font-bold w-[120px]">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {view.items.length === 0 ? (
                    <tr>
                      <td className="p-3 text-xs" colSpan={8}>
                        No items
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const discountFactor = view.totals.subtotal > 0 ? (view.taxSummary?.taxableValue || 0) / view.totals.subtotal : 1;
                      const discountPct = Math.max(0, Math.min(99.99, (1 - discountFactor) * 100));
                      return view.items.map((it) => {
                        const taxPct = it.taxRatePercent != null && it.taxRatePercent > 0 ? it.taxRatePercent : deriveRatePercent(it.totalTax, it.taxable);
                        const rateEffective = it.qty > 0 ? it.taxable / it.qty : it.rate;
                        return (
                          <tr key={it.sl}>
                            <td className="p-2 text-[11px] align-top border-r border-black/60">{it.sl}</td>
                            <td className="p-2 text-[11px] align-top border-r border-black/60">{it.particulars}</td>
                            <td className="p-2 text-[11px] align-top border-r border-black/60">{it.hsnSac || "-"}</td>
                            <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">{formatPctNoTrim(taxPct)}</td>
                            <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">{it.qty}</td>
                            <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">
                              <div>{formatINR(rateEffective)}</div>
                              {discountPct > 0 && (
                                <div className="text-[10px] text-slate-700">
                                  {formatINR(it.rate)} ({discountPct.toFixed(2)}% Disc)
                                </div>
                              )}
                            </td>
                            <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">Nos</td>
                            <td className="p-2 text-[11px] text-right align-top tabular-nums">{formatINR(it.taxable)}</td>
                          </tr>
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
            </div>

            {/* Tax Summary (separate) */}
            <div>
              <div className="px-3 py-2">
                <div className="text-[11px] font-bold">Tax Summary (HSN/SAC)</div>
              </div>
              <div className="p-0">
                <table className="w-full border-collapse border border-black/60 border-l-0 border-r-0">
                  <thead>
                    <tr className="border-b border-black/60">
                      <th className="p-2 text-left text-[11px] font-bold border-r border-black/60">HSN/SAC</th>
                      <th className="p-2 text-right text-[11px] font-bold border-r border-black/60">Taxable Value</th>
                      <th className="p-2 text-right text-[11px] font-bold border-r border-black/60">Rate</th>
                      <th className="p-2 text-right text-[11px] font-bold border-r border-black/60">Integrated Tax Amount</th>
                      <th className="p-2 text-right text-[11px] font-bold">Total Tax Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(view.hsnSummary?.length ? view.hsnSummary : [{ hsnSac: "-", taxableValue: view.taxSummary?.taxableValue || 0, ratePercent: view.taxSummary?.taxRatePercent || 0, taxAmount: view.taxSummary?.totalGst || view.totals.taxAmount || 0, totalTaxAmount: view.taxSummary?.totalGst || view.totals.taxAmount || 0 }]).map((r, idx) => (
                      <tr key={`${r.hsnSac}-${r.ratePercent}-${idx}`}>
                        <td className="p-2 text-[11px] align-top border-r border-black/60">{r.hsnSac || "-"}</td>
                        <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">{formatINR(r.taxableValue || 0)}</td>
                        <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">{formatPct(r.ratePercent || 0)}</td>
                        <td className="p-2 text-[11px] text-right align-top tabular-nums border-r border-black/60">{formatINR(r.taxAmount || 0)}</td>
                        <td className="p-2 text-[11px] text-right align-top tabular-nums">{formatINR(r.totalTaxAmount || 0)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-black/60">
                      <td className="p-2 text-[11px] font-bold border-r border-black/60">TOTAL</td>
                      <td className="p-2 text-[11px] text-right font-bold tabular-nums border-r border-black/60">{formatINR(view.taxSummary?.taxableValue || 0)}</td>
                      <td className="p-2 border-r border-black/60" />
                      <td className="p-2 text-[11px] text-right font-bold tabular-nums border-r border-black/60">{formatINR(view.taxSummary?.totalGst || view.totals.taxAmount || 0)}</td>
                      <td className="p-2 text-[11px] text-right font-bold tabular-nums">{formatINR(view.taxSummary?.totalGst || view.totals.taxAmount || 0)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Push summary + footer to bottom on print */}
            <div className="hidden print:block flex-1" aria-hidden="true" />

            {/* Top border for the bottom summary block */}
            <Separator className="bg-black/60" />

            {/* Summary */}
            <div className="grid grid-cols-2">
              <div className="border-r border-black/60 p-3">
                <div className="text-[11px] font-bold">Amount in words (optional)</div>
                <div className="mt-1 text-[11px] font-semibold">
                  {view.amountInWords}
                </div>
                <div className="mt-3 text-[11px]">
                  <div className="font-bold">Terms</div>
                  <div className="text-slate-700">E. & O.E.</div>
                </div>
              </div>
              <div className="border-l border-black/60 p-3">
                <div className="space-y-1 text-xs">
                  <div className="mt-2">
                    <table className="w-full border-collapse border border-black/60">
                      <tbody>
                        <tr>
                          <td className="p-1 text-[11px] font-bold">Taxable Value</td>
                          <td className="p-1 text-[11px] text-right tabular-nums">{formatINR(view.taxSummary?.taxableValue || 0)}</td>
                        </tr>
                        <tr className="border-t border-black/60">
                          <td className="p-1 text-[11px] font-bold">Total GST</td>
                          <td className="p-1 text-[11px] text-right tabular-nums">{formatINR(view.taxSummary?.totalGst || view.totals.taxAmount || 0)}</td>
                        </tr>
                        {Math.abs(view.totals.roundoff) > 0.0001 && (
                          <tr className="border-t border-black/60">
                            <td className="p-1 text-[11px] font-bold">Round Off</td>
                            <td className="p-1 text-[11px] text-right tabular-nums">{formatINR(view.totals.roundoff)}</td>
                          </tr>
                        )}
                        <tr className="border-t border-black/60 bg-slate-100">
                          <td className="p-1 text-[13px] font-extrabold">Invoice Value</td>
                          <td className="p-1 text-[13px] text-right font-extrabold tabular-nums">{formatINR(view.totals.grandTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="h-2" />
                  {view.totals.creditAmount > 0 && (
                    <div className="flex justify-between gap-3">
                      <span>Members Credit</span>
                      <span className="tabular-nums">-{formatINR(view.totals.creditAmount)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <Separator className="bg-black/60" />

            {/* Footer */}
            <div className="p-3">
              <div className="flex items-end justify-between">
                <div className="text-[11px] text-slate-700">This is a computer generated invoice.</div>
                <div className="text-right">
                  <div className="text-[11px] font-bold">For {company.name || ""}</div>
                  <div className="mt-10 text-[11px]">Authorised Signatory</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
