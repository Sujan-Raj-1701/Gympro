import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { FileText} from "lucide-react";
import { getLucideIcon } from "@/components/LucideIcon";

type ReportModule = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
};

export default function Reports() {
  const [reportModules, setReportModules] = useState<ReportModule[]>([]);

  // Colored icon accents by module title (match Staff landing page feel)
  const pickColors = (title: string) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('sales')) {
      return { bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200/60' };
    }
    if (t.includes('payment') || t.includes('collection') || t.includes('upi') || t.includes('wallet') || t.includes('card')) {
      return { bg: 'bg-violet-100', text: 'text-violet-700', ring: 'ring-violet-200/60' };
    }
    if (t.includes('credit') || t.includes('outstanding') || t.includes('due')) {
      return { bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-200/60' };
    }
    if (t.includes('staff') || t.includes('commission') || t.includes('performance')) {
      return { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200/60' };
    }
    if (t.includes('service')) {
      return { bg: 'bg-teal-100', text: 'text-teal-700', ring: 'ring-teal-200/60' };
    }
    if (t.includes('stock') || t.includes('inventory')) {
      return { bg: 'bg-cyan-100', text: 'text-cyan-700', ring: 'ring-cyan-200/60' };
    }
    if (t.includes('product') || t.includes('consumption')) {
      return { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-200/60' };
    }
    if (t.includes('discount')) {
      return { bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-200/60' };
    }
    if (t.includes('appointment') || t.includes('schedule') || t.includes('visit')) {
      return { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' };
    }
    if (t.includes('closing') || t.includes('settlement')) {
      return { bg: 'bg-lime-100', text: 'text-lime-700', ring: 'ring-lime-200/60' };
    }
    if (t.includes('booking')) {
      return { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' };
    }
    if (t.includes('gst') || t.includes('tax')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' };
    }
    if (t.includes('customer')) {
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200/60' };
    }
    return { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/60' };
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) { setReportModules([]); return; }
      const modules = JSON.parse(raw);
      const parents: any[] = Array.isArray(modules) ? modules : [];
      // Find the Reports parent by name or route
      const reportsParent = parents.find((p: any) =>
        String(p?.name || '').toLowerCase() === 'reports' || String(p?.route || '').startsWith('/reports')
      );
      if (!reportsParent || !Array.isArray(reportsParent.children)) { setReportModules([]); return; }
      const children = reportsParent.children as any[];
      const mapped: ReportModule[] = children
        .filter(c => (c?.can_view ?? 0) === 1)
        .map(c => ({
          title: String(c?.name ?? ''),
          icon: getLucideIcon(String(c?.icon || 'FileText'), FileText),
          href: String(c?.route ?? '#'),
          description: undefined,
        }));
      setReportModules(mapped);
    } catch (e) {
      console.warn('Failed to parse user_modules for reports:', e);
      setReportModules([]);
    }
  }, []);

  return (
    <div className="min-h-screen space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-3">
        {reportModules.map((module, index) => (
          <Link
            key={index}
            to={module.href}
            className="group block p-3 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 hover:border-slate-300 hover:bg-slate-50"
          >
            <div className="flex items-center space-x-3">
              <div className="flex-shrink-0">
                {(() => {
                  const c = pickColors(module.title);
                  return (
                    <div
                      className={[
                        'p-1.5 rounded-md transition-colors duration-200 ring-1 ring-inset',
                        c.bg,
                        c.ring,
                        'group-hover:brightness-110',
                      ].join(' ')}
                    >
                      <module.icon className={['h-4 w-4', c.text].join(' ')} />
                    </div>
                  );
                })()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-medium text-slate-900 group-hover:text-slate-900 transition-colors duration-200">
                  {module.title}
                </h3>
                {module.description ? (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{module.description}</p>
                ) : null}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
