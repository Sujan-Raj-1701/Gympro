import { History } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Props = {
  to?: string;
  className?: string;
};

export default function CampaignHistoryButton({
  to = "/campaign-history",
  className = "",
}: Props) {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate(to, { replace: false })}
      aria-label="View campaign history"
      className={
        "inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 " +
        className
      }
    >
      <History className="h-4 w-4 text-slate-700" aria-hidden="true" />
      <span>History</span>
    </button>
  );
}
