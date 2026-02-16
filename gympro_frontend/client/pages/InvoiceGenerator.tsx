import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Printer, Save, Trash2 } from "lucide-react";
import { format } from "date-fns";
import techiesLogo from "../assets/logos/techies_magnifier_logo.png";

interface InvoiceItem {
    id: string;
    description: string;
    quantity: number;
    price: number;
    taxRate: number;
}

interface CustomerDetails {
    name: string;
    phone: string;
    email: string;
    address: string;
}

interface CompanyDetails {
    name: string;
    address: string;
    phone: string;
    email: string;
}

const formatInr = (n: number) =>
    `₹${(Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function numberToIndianWords(amount: number): string {
    const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    const twoDigits = (n: number) => n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`.trim();
    const threeDigits = (n: number) => {
        const h = Math.floor(n / 100);
        const r = n % 100;
        return `${h ? `${ones[h]} Hundred${r ? " " : ""}` : ""}${r ? twoDigits(r) : ""}`.trim();
    };

    if (!Number.isFinite(amount) || amount <= 0) return "Rupees Zero Only";

    const r = Math.round((amount + Number.EPSILON) * 100) / 100;
    const rupees = Math.floor(r);
    const paise = Math.round((r - rupees) * 100);

    const parts: string[] = [];
    const units = [
        { mod: 10000000, name: "Crore" },
        { mod: 100000, name: "Lakh" },
        { mod: 1000, name: "Thousand" },
        { mod: 100, name: "" },
    ];

    let n = rupees;
    for (const u of units) {
        if (n >= u.mod) {
            const q = Math.floor(n / u.mod);
            n = n % u.mod;
            const chunk = u.mod === 100 ? threeDigits(q) : twoDigits(q);
            parts.push(`${chunk}${u.name ? ` ${u.name}` : ""}`.trim());
        }
    }

    if (n > 0) parts.push(twoDigits(n));
    const words = parts.join(" ") || "Zero";
    if (paise) return `Rupees ${words} and ${twoDigits(paise)} Paise Only`.replace(/\s+/g, " ").trim();
    return `Rupees ${words} Only`.replace(/\s+/g, " ").trim();
}

export default function InvoiceGenerator() {
    const [invoiceNumber, setInvoiceNumber] = useState(`#${Date.now().toString().slice(-8)}`);
    const [invoiceDate, setInvoiceDate] = useState(format(new Date(), "yyyy-MM-dd"));

    const [company, setCompany] = useState<CompanyDetails>({
        name: "Techies Magnifier Technologies",
        address: "No 7, CTH Road , Modern city , Pattabiram-600072",
        phone: "7397288500",
        email: "support@techiesmagnifier.com"
    });

    const [customer, setCustomer] = useState<CustomerDetails>({
        name: "",
        phone: "",
        email: "",
        address: ""
    });

    const [items, setItems] = useState<InvoiceItem[]>([
        { id: "1", description: "", quantity: 1, price: 0, taxRate: 0 }
    ]);

    const [notes, setNotes] = useState("Thank You For Your Business");

    const updateItem = (id: string, field: keyof InvoiceItem, value: any) => {
        setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const addItem = () => {
        setItems([...items, {
            id: Date.now().toString(),
            description: "",
            quantity: 1,
            price: 0,
            taxRate: 0
        }]);
    };

    const removeItem = (id: string) => {
        if (items.length > 1) setItems(items.filter(item => item.id !== id));
    };

    const computed = useMemo(() => {
        const lines = items.map((item) => {
            const qty = Number(item.quantity) || 0;
            const rate = Number(item.price) || 0;
            const base = qty * rate;
            const taxRate = Number(item.taxRate) || 0;
            const tax = (base * taxRate) / 100;
            return {
                ...item,
                qty,
                rate,
                base,
                taxRate,
                tax,
                total: base + tax,
            };
        });
        const subtotal = lines.reduce((sum, l) => sum + l.base, 0);
        const totalTax = lines.reduce((sum, l) => sum + l.tax, 0);
        const grandTotal = subtotal + totalTax;
        return { lines, subtotal, totalTax, grandTotal };
    }, [items]);

    const handlePrint = () => window.print();
    const handleSave = () => alert("Invoice saved successfully!");

    return (
        <>
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                    @media print {
                        body * { visibility: hidden; }
                        #invoice-content, #invoice-content * { visibility: visible; }
                        #invoice-content {
                            position: absolute;
                            left: 0;
                            top: 0;
                            width: 210mm;
                            min-height: 297mm;
                            margin: 0 auto;
                            padding: 12mm;
                            box-sizing: border-box;
                        }
                        .no-print { display: none !important; }
                        @page { size: A4; margin: 0; }
                        * {
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                            color-adjust: exact;
                            forced-color-adjust: none;
                        }
                        html, body { background: #fff !important; }
                    }

                    .invoice-input {
                        border: none;
                        background: transparent;
                        padding: 2px 6px;
                        width: 100%;
                        transition: all 0.15s;
                    }
                    .invoice-input:hover { background: #f8fafc; }
                    .invoice-input:focus {
                        outline: none;
                        background: #f1f5f9;
                        border-radius: 6px;
                    }
                    .invoice-textarea {
                        border: none;
                        background: transparent;
                        padding: 2px 6px;
                        width: 100%;
                        resize: none;
                        transition: all 0.15s;
                    }
                    .invoice-textarea:hover { background: #f8fafc; }
                    .invoice-textarea:focus {
                        outline: none;
                        background: #f1f5f9;
                        border-radius: 6px;
                    }

                    #invoice-content {
                        font-family: Inter, Roboto, ui-sans-serif, system-ui, -apple-system, Segoe UI, Arial, sans-serif;
                        font-size: 13px;
                        line-height: 1.4;
                        color: #0f172a;
                        -webkit-font-smoothing: antialiased;
                        -moz-osx-font-smoothing: grayscale;
                    }
                    #invoice-content input,
                    #invoice-content textarea {
                        font: inherit;
                        color: inherit;
                        letter-spacing: inherit;
                    }
                    #invoice-content ::placeholder { color: #94a3b8; }
                `,
                }}
            />

            <div className="min-h-screen bg-slate-50/40 p-4 print:bg-white print:p-0">
                <div className="mx-auto w-full max-w-[210mm] space-y-4">
                    <div className="no-print flex items-center justify-end gap-2">
                        <Button onClick={handleSave} size="sm" className="h-9 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                            <Save className="h-4 w-4" />
                            Save
                        </Button>
                        <Button onClick={handlePrint} size="sm" className="h-9 gap-2 bg-blue-600 text-white hover:bg-blue-700">
                            <Printer className="h-4 w-4" />
                            Print
                        </Button>
                    </div>

                    <Card id="invoice-content" className="rounded-none border-slate-300 bg-white shadow-sm print:shadow-none">
                        <div className="p-[12mm] print:p-0">
                            <div className="border border-slate-300">
                                {/* Top header */}
                                <div className="flex items-start justify-between gap-6 border-b border-slate-300 px-4 py-4">
                                    <div className="flex min-w-0 items-start gap-4">
                                        <img
                                            src={techiesLogo}
                                            alt="Techies Magnifier Technologies"
                                                className="h-[60mm] w-auto max-w-[145mm] object-contain"
                                        />
                                    </div>

                                    <div className="w-[78mm] shrink-0">
                                        <div className="text-right">
                                            <div className="text-lg font-extrabold tracking-tight text-slate-900">TAX INVOICE</div>
                                        </div>

                                        <div className="mt-2 border border-slate-300">
                                            <div className="grid grid-cols-2 text-[12px]">
                                                <div className="border-b border-r border-slate-300 px-2 py-1 text-slate-600">Invoice No.</div>
                                                <div className="border-b border-slate-300 px-2 py-1 text-right font-mono font-semibold text-slate-900">
                                                    <input
                                                        type="text"
                                                        value={invoiceNumber}
                                                        onChange={(e) => setInvoiceNumber(e.target.value)}
                                                        className="invoice-input p-0 text-right font-mono"
                                                    />
                                                </div>
                                                <div className="border-r border-slate-300 px-2 py-1 text-slate-600">Date</div>
                                                <div className="px-2 py-1 text-right font-semibold text-slate-900">
                                                    <input
                                                        type="date"
                                                        value={invoiceDate}
                                                        onChange={(e) => setInvoiceDate(e.target.value)}
                                                        className="invoice-input p-0 text-right"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Buyer + Company blocks */}
                                <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2">
                                    <div className="border-b border-slate-300 px-4 py-3 md:border-b-0 md:border-r print:border-b-0 print:border-r">
                                        <div className="text-[12px] font-bold text-slate-900">Buyer (Bill To)</div>
                                        <div className="mt-1 space-y-1">
                                            <input
                                                type="text"
                                                value={customer.name}
                                                onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                                                className="invoice-input text-[13px] font-semibold text-slate-900"
                                                placeholder="Customer name"
                                            />
                                            <textarea
                                                value={customer.address}
                                                onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                                                className="invoice-textarea text-[12px] leading-5 text-slate-700"
                                                rows={2}
                                                placeholder="Address"
                                            />
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-500">Phone:</span>
                                                    <input
                                                        type="text"
                                                        value={customer.phone}
                                                        onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                                                        className="invoice-input p-0 text-[12px]"
                                                        placeholder="Phone"
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-500">Email:</span>
                                                    <input
                                                        type="text"
                                                        value={customer.email}
                                                        onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
                                                        className="invoice-input p-0 text-[12px]"
                                                        placeholder="Email"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="px-4 py-3">
                                        <div className="text-[12px] font-bold text-slate-900">Company Details (Seller)</div>
                                        <div className="mt-1 space-y-1">
                                            <input
                                                type="text"
                                                value={company.name}
                                                onChange={(e) => setCompany({ ...company, name: e.target.value })}
                                                className="invoice-input p-0 text-[13px] font-semibold text-slate-900"
                                                placeholder="Company name"
                                            />
                                            <textarea
                                                value={company.address}
                                                onChange={(e) => setCompany({ ...company, address: e.target.value })}
                                                className="invoice-textarea p-0 text-[12px] leading-5 text-slate-700"
                                                rows={2}
                                                placeholder="Company address"
                                            />
                                            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-slate-500">Phone:</span>
                                                    <input
                                                        type="text"
                                                        value={company.phone}
                                                        onChange={(e) => setCompany({ ...company, phone: e.target.value })}
                                                        className="invoice-input p-0 text-[12px]"
                                                        placeholder="Phone"
                                                    />
                                                </div>
                                                <div className="col-span-2 flex items-center gap-2">
                                                    <span className="text-slate-500">Email:</span>
                                                    <input
                                                        type="text"
                                                        value={company.email}
                                                        onChange={(e) => setCompany({ ...company, email: e.target.value })}
                                                        className="invoice-input p-0 text-[12px]"
                                                        placeholder="Email"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Items table */}
                                <div className="border-t border-slate-300">
                                    <div className="border-b border-slate-300 bg-slate-50 px-4 py-2">
                                        <div className="text-[12px] font-bold text-slate-900">Particulars</div>
                                    </div>

                                    <div className="px-2 py-2">
                                        <Table>
                                            <TableHeader>
                                                <TableRow className="bg-slate-100 hover:bg-slate-100">
                                                    <TableHead className="w-[34px] border border-slate-300 px-2 py-1 text-[12px] font-bold text-slate-900">#</TableHead>
                                                    <TableHead className="border border-slate-300 px-2 py-1 text-[12px] font-bold text-slate-900">Description</TableHead>
                                                    <TableHead className="w-[70px] border border-slate-300 px-2 py-1 text-right text-[12px] font-bold text-slate-900">Qty</TableHead>
                                                    <TableHead className="w-[90px] border border-slate-300 px-2 py-1 text-right text-[12px] font-bold text-slate-900">Rate</TableHead>
                                                    <TableHead className="w-[70px] border border-slate-300 px-2 py-1 text-right text-[12px] font-bold text-slate-900">Tax %</TableHead>
                                                    <TableHead className="w-[110px] border border-slate-300 px-2 py-1 text-right text-[12px] font-bold text-slate-900">Amount</TableHead>
                                                    <TableHead className="no-print w-[40px] border border-slate-300 px-2 py-1" />
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {computed.lines.map((line, index) => (
                                                    <TableRow key={line.id} className="align-middle">
                                                        <TableCell className="border border-slate-300 px-2 py-1 text-[12px] text-slate-700">{index + 1}</TableCell>
                                                        <TableCell className="border border-slate-300 px-2 py-1">
                                                            <input
                                                                type="text"
                                                                value={line.description}
                                                                onChange={(e) => updateItem(line.id, "description", e.target.value)}
                                                                className="invoice-input p-0 text-[13px] text-slate-900"
                                                                placeholder="Product / Service"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="border border-slate-300 px-2 py-1 text-right">
                                                            <input
                                                                type="number"
                                                                value={line.quantity}
                                                                onChange={(e) => updateItem(line.id, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                                                                className="invoice-input p-0 text-right text-[12px] font-semibold text-slate-900 [font-variant-numeric:tabular-nums]"
                                                                min="1"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="border border-slate-300 px-2 py-1 text-right">
                                                            <input
                                                                type="number"
                                                                value={line.price}
                                                                onChange={(e) => updateItem(line.id, "price", Math.max(0, parseFloat(e.target.value) || 0))}
                                                                className="invoice-input p-0 text-right text-[12px] font-semibold text-slate-900 [font-variant-numeric:tabular-nums]"
                                                                min="0"
                                                                step="0.01"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="border border-slate-300 px-2 py-1 text-right">
                                                            <input
                                                                type="number"
                                                                value={line.taxRate}
                                                                onChange={(e) => updateItem(line.id, "taxRate", Math.max(0, parseFloat(e.target.value) || 0))}
                                                                className="invoice-input p-0 text-right text-[12px] font-semibold text-slate-900 [font-variant-numeric:tabular-nums]"
                                                                min="0"
                                                                step="0.01"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="border border-slate-300 px-2 py-1 text-right text-[12px] font-semibold text-slate-900 [font-variant-numeric:tabular-nums]">
                                                            {formatInr(line.total)}
                                                        </TableCell>
                                                        <TableCell className="no-print border border-slate-300 px-2 py-1 text-right">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => removeItem(line.id)}
                                                                className="h-7 w-7 text-rose-600 hover:bg-rose-50"
                                                                title="Remove item"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>

                                        <div className="no-print mt-2 px-1">
                                            <Button
                                                onClick={addItem}
                                                variant="outline"
                                                size="sm"
                                                className="w-full border-dashed border-slate-300 text-slate-700 hover:bg-slate-50"
                                            >
                                                <Plus className="mr-2 h-4 w-4" />
                                                Add item
                                            </Button>
                                        </div>
                                    </div>
                                </div>

                                {/* Totals + Notes */}
                                <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 border-t border-slate-300">
                                    <div className="border-b border-slate-300 px-4 py-3 md:border-b-0 md:border-r print:border-b-0 print:border-r">
                                        <div className="text-[12px] font-bold text-slate-900">Amount in words</div>
                                        <div className="mt-1 text-[12px] text-slate-700">
                                            {numberToIndianWords(computed.grandTotal)}
                                        </div>

                                        <div className="mt-3 text-[12px] font-bold text-slate-900">Notes</div>
                                        <textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            className="invoice-textarea mt-1 text-[12px] leading-5 text-slate-700"
                                            placeholder="Thank you for your business"
                                            rows={2}
                                        />
                                    </div>

                                    <div className="px-4 py-3">
                                        <div className="grid grid-cols-2 gap-y-1 text-[12px]">
                                            <div className="text-slate-600">Subtotal</div>
                                            <div className="text-right font-semibold text-slate-900 [font-variant-numeric:tabular-nums]">{formatInr(computed.subtotal)}</div>
                                            <div className="text-slate-600">Tax</div>
                                            <div className="text-right font-semibold text-slate-900 [font-variant-numeric:tabular-nums]">{formatInr(computed.totalTax)}</div>
                                        </div>

                                        <div className="mt-2 border-t border-slate-300 pt-2">
                                            <div className="flex items-center justify-between text-[12px] font-extrabold text-slate-900">
                                                <span>Grand Total</span>
                                                <span className="[font-variant-numeric:tabular-nums]">{formatInr(computed.grandTotal)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="flex items-end justify-between gap-4 border-t border-slate-300 px-4 py-3">
                                    <div className="text-[11px] text-slate-500">This is a computer generated invoice.</div>
                                    <div className="text-right">
                                        <div className="text-[12px] text-slate-600">For {company.name || "Company"}</div>
                                        <div className="mt-10 text-[12px] font-semibold text-slate-900">Authorised Signatory</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>
        </>
    );
}
