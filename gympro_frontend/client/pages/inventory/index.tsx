import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { getLucideIcon } from "@/components/LucideIcon";

type InventoryModule = {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
};

export default function InventoryManagement() {
  const [inventoryModules, setInventoryModules] = useState<InventoryModule[]>([]);
  const { pathname } = useLocation();

  // Colored icon accents by module title (match Staff landing page style)
  const pickColors = (title: string) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('stock in') || t.includes('purchase')) {
      return { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200/60' };
    }
    if (t.includes('stock out') || t.includes('consumption')) {
      return { bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200/60' };
    }
    if (t.includes('adjust')) {
      return { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' };
    }
    if (t.includes('reorder') || t.includes('expiry') || t.includes('wastage')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' };
    }
    return { bg: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-200/60' };
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) { setInventoryModules([]); return; }
      const modules = JSON.parse(raw);
      const parents: any[] = Array.isArray(modules) ? modules : [];

      // Determine base route from current path (e.g., "/inventory" from "/inventory/..."),
      // then find the matching parent module by route prefix.
      const basePath = "/" + String(pathname || "/").split("/")[1];
      const inventoryParent = parents.find((p: any) => {
        const route = String(p?.route || "");
        if (!route) return false;
        return route === basePath || (route.startsWith(basePath) && basePath !== "/");
      })
      // Fallback for legacy naming
      || parents.find((p: any) => {
        const nm = String(p?.name || '').toLowerCase();
        return nm === 'inventory management' || nm === 'inventory';
      });
      if (!inventoryParent || !Array.isArray(inventoryParent.children)) { setInventoryModules([]); return; }
      const children = inventoryParent.children as any[];
      const mapped: InventoryModule[] = children
        .filter(c => (c?.can_view ?? 0) === 1)
        .map(c => ({
          title: String(c?.name ?? ''),
          icon: getLucideIcon(String(c?.icon || 'FileText'), FileText),
          href: String(c?.route ?? '#'),
          description: undefined,
        }));
      setInventoryModules(mapped);
    } catch (e) {
      console.warn('Failed to parse user_modules for inventory:', e);
      setInventoryModules([]);
    }
  }, [pathname]);

  return (
    <div className="min-h-screen space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-3">
        {inventoryModules.map((module, index) => (
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