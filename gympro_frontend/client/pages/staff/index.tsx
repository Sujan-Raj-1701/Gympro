import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { FileText} from "lucide-react";
import { getLucideIcon } from "@/components/LucideIcon";

type ReportModule = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
};

// Dynamic icon resolver – supports any lucide icon name from backend

export default function StaffManagement() {
  const [reportModules, setReportModules] = useState<ReportModule[]>([]);
  const { pathname } = useLocation();

  // Colored icon accents by module title
  const pickColors = (title: string) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('attendance')) {
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200/60' };
    }
    if (t.includes('payroll') || t.includes('incentive')) {
      return { bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200/60' };
    }
    if (t.includes('assignment') || t.includes('appointment')) {
      return { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' };
    }
    if (t.includes('performance')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' };
    }
    return { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/60' };
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) { setReportModules([]); return; }
      const modules = JSON.parse(raw);
      const parents: any[] = Array.isArray(modules) ? modules : [];
      // Determine base route from current path (e.g., "/assets" from "/assets/..."),
      // then find the matching parent module by route prefix.
      const basePath = "/" + String(pathname || "/").split("/")[1];
      const reportsParent = parents.find((p: any) => {
        const route = String(p?.route || "");
        if (!route) return false;
        // Exact base match or prefix match so this component can be reused across sections
        return route === basePath || (route.startsWith(basePath) && basePath !== "/");
      })
      // Fallback for legacy usage where name was hardcoded
      || parents.find((p: any) => String(p?.name || '').toLowerCase() === 'staffmanagement');
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
  }, [pathname]);

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
                {(() => { const c = pickColors(module.title); return (
                  <div className={[
                      'p-1.5 rounded-md transition-colors duration-200 ring-1 ring-inset',
                      c.bg, c.ring, 'group-hover:brightness-110'
                    ].join(' ')}>
                    <module.icon className={[ 'h-4 w-4', c.text ].join(' ')} />
                  </div>
                ); })()}
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
