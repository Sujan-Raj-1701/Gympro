import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiService } from "@/services/apiService";

interface LedgerEntry {
  id: number;
  txn_type: string;
  amount: number;
  balance_after: number;
  currency: string;
  reference_type: string;
  reference_id: string;
  notes: string;
  created_by: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CreditHistory({ open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res: any = await ApiService.get("/api/credits/ledger?limit=50");
      if (res.success) {
        setLedger(res.data);
      }
    } catch (error) {
      console.error("Failed to load credit history", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Credit History</DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-auto">
          {loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ledger.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      No transaction history found.
                    </TableCell>
                  </TableRow>
                ) : (
                  ledger.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">
                        {entry.created_at ? format(new Date(entry.created_at), "MMM d, yyyy HH:mm") : "-"}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            entry.txn_type === "TOPUP"
                              ? "bg-green-100 text-green-700"
                              : entry.txn_type === "DEBIT"
                              ? "bg-rose-100 text-rose-700"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {entry.txn_type}
                        </span>
                      </TableCell>
                      <TableCell className={entry.amount > 0 ? "text-green-600" : "text-rose-600"}>
                        {entry.amount > 0 ? "+" : ""}
                        {entry.amount}
                      </TableCell>
                      <TableCell>{entry.balance_after}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={entry.notes}>
                        {entry.notes || "-"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
