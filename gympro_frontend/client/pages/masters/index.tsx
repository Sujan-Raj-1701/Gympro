
import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MasterTemplate from '@/components/templates/MasterTemplate';
import MASTER_CONFIGS from './masterConfigs';

// Some deployments use plural/alias segments for masters routes.
// Map those route segments back to the MASTER_CONFIGS keys.
const SEGMENT_ALIASES: Record<string, string> = {
  customers: 'customer',
  customer: 'customer',
  facilities: 'service',
  services: 'service',
  categories: 'category',
  category: 'category',
  variants: 'variant',
  variant: 'variant',
  suppliers: 'vendor',
  vendor: 'vendor',
  employees: 'employee',
  employee: 'employee',
  memberships: 'membership',
  membership: 'membership',
  paymentmodes: 'paymode',
  paymentmode: 'paymode',
  paymode: 'paymode',
  uoms: 'uom',
  uom: 'uom',
  hsn: 'hsn',
  tax: 'tax',
  bank: 'bank',
  inventory: 'inventory',
  department: 'department',
  package: 'package',
};

// Helper: extract the last non-empty segment from a route string
const extractKeyFromRoute = (route?: string): string | null => {
  if (!route || typeof route !== 'string') return null;
  try {
    const parts = route.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  } catch {
    return null;
  }
};

export default function Masters() {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [allowedKeys, setAllowedKeys] = useState<Set<string>>(new Set());
  const [displayNamesByKey, setDisplayNamesByKey] = useState<Record<string, string>>({});
  const [orderByKey, setOrderByKey] = useState<Record<string, number>>({});
  const location = useLocation();
  const navigate = useNavigate();
  // Color accents per master module (matches app's blue-centric palette)
  const colorStyles: Record<string, { bg: string; text: string; ring: string }> = {
    customer: { bg: 'bg-blue-100', text: 'text-blue-700', ring: 'ring-blue-200/60' },
    tax: { bg: 'bg-violet-100', text: 'text-violet-700', ring: 'ring-violet-200/60' },
    paymode: { bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-200/60' },
    uom: { bg: 'bg-orange-100', text: 'text-orange-700', ring: 'ring-orange-200/60' },
    bank: { bg: 'bg-indigo-100', text: 'text-indigo-700', ring: 'ring-indigo-200/60' },
    category: { bg: 'bg-pink-100', text: 'text-pink-700', ring: 'ring-pink-200/60' },
    hsn: { bg: 'bg-fuchsia-100', text: 'text-fuchsia-700', ring: 'ring-fuchsia-200/60' },
    inventory: { bg: 'bg-rose-100', text: 'text-rose-700', ring: 'ring-rose-200/60' },
    variant: { bg: 'bg-lime-100', text: 'text-lime-700', ring: 'ring-lime-200/60' },
    vendor: { bg: 'bg-cyan-100', text: 'text-cyan-700', ring: 'ring-cyan-200/60' },
    department: { bg: 'bg-amber-100', text: 'text-amber-700', ring: 'ring-amber-200/60' },
    service: { bg: 'bg-sky-100', text: 'text-sky-700', ring: 'ring-sky-200/60' },
    employee: { bg: 'bg-teal-100', text: 'text-teal-700', ring: 'ring-teal-200/60' },
    membership: { bg: 'bg-purple-100', text: 'text-purple-700', ring: 'ring-purple-200/60' },
  };

  // When location changes, if path is /masters/<segment>, capture segment for deep link
  useEffect(() => {
    const path = location.pathname || '';
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2 && parts[0] === 'masters') {
      const seg = parts[1].toLowerCase();
      const normalized = SEGMENT_ALIASES[seg] || seg;
      setActiveKey((prev) => (prev === normalized ? prev : normalized));
    } else if (parts.length === 1 && parts[0] === 'masters') {
      setActiveKey(null);
    }
  }, [location.pathname]);

  // Load allowed master children from sessionStorage.user_modules under "Master Modules" parent
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('user_modules');
      if (!raw) {
        setAllowedKeys(new Set());
        setDisplayNamesByKey({});
        setOrderByKey({});
        return;
      }
      const modules = JSON.parse(raw);
      const parents: any[] = Array.isArray(modules) ? modules : [];

      // Build a flat list of all modules (parents + their children)
      const flat: any[] = [];
      parents.forEach((pm) => {
        flat.push(pm);
        if (Array.isArray(pm?.children)) flat.push(...pm.children);
      });

      const masterParent = parents.find((p) =>
        String(p?.name || '').toLowerCase() === 'master modules' || String(p?.route || '').toLowerCase() === '/masters'
      );

      // Build mapping from possible route segments => config key
      const segmentToKey = MASTER_CONFIGS.reduce<Record<string, string>>((acc, c: any) => {
        const key = String(c?.key || '').toLowerCase();
        const tableKey = String(c?.tableKey || '').toLowerCase();
        const hyphenKey = key.replace(/_/g, '-');
        const hyphenTableKey = tableKey.replace(/_/g, '-');
        if (key) acc[key] = c.key;
        if (tableKey) acc[tableKey] = c.key;
        if (hyphenKey) acc[hyphenKey] = c.key;
        if (hyphenTableKey) acc[hyphenTableKey] = c.key;
        return acc;
      }, {});

      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const titles = MASTER_CONFIGS.map((c: any) => ({ key: c.key, normTitle: normalize(String(c.title || '')) }));

      const keys = new Set<string>();
      const nameMap: Record<string, string> = {};
      const keyOrder: Record<string, number> = {};
      let orderCounter = 0;

      const addResolved = (resolvedKey: string, mod: any, preferOrder?: number) => {
        const k = String(resolvedKey || '').toLowerCase();
        if (!k) return;
        keys.add(resolvedKey);

        const displayName = String(mod?.name || '').trim();
        // Only take display names from Master Modules list ordering.
        // This prevents unrelated modules (e.g., Reports) from overriding master display titles.
        if (displayName && typeof preferOrder === 'number') nameMap[resolvedKey] = displayName;

        if (typeof preferOrder === 'number') {
          if (keyOrder[resolvedKey] === undefined) keyOrder[resolvedKey] = preferOrder;
        } else {
          if (keyOrder[resolvedKey] === undefined) keyOrder[resolvedKey] = orderCounter++;
        }
      };

      const addByRouteAndName = (mod: any, preferOrder?: number) => {
        const canView = (mod?.can_view ?? 0) === 1;
        if (!canView) return;

        const rawRoute = String(mod?.route || '');
        const route = rawRoute.split('?')[0].split('#')[0];

        // Prefer extracting segment after /masters/
        try {
          const parts = route.split('/').filter(Boolean).map((p) => String(p).toLowerCase());
          const idx = parts.indexOf('masters');
          if (idx >= 0 && parts[idx + 1]) {
            const seg = parts[idx + 1];
            const normalizedSeg = (SEGMENT_ALIASES[seg] || seg).toLowerCase();
            const mapped = segmentToKey[normalizedSeg] || segmentToKey[seg];
            if (mapped) { addResolved(mapped, mod, preferOrder); return; }
          }
        } catch {
          // ignore route parsing errors
        }

        // Fallback: last-segment route matching
        const fromRoute = extractKeyFromRoute(route);
        if (fromRoute) {
          const seg = String(fromRoute).toLowerCase();
          const normalizedSeg = (SEGMENT_ALIASES[seg] || seg).toLowerCase();
          const mapped = segmentToKey[normalizedSeg] || segmentToKey[seg];
          if (mapped) { addResolved(mapped, mod, preferOrder); return; }
        }

        // Fallback: name-based matching (exact and fuzzy)
        const modName = String(mod?.name || '');
        const modNorm = normalize(modName);
        if (!modNorm) return;

        const exact = titles.find((t) => t.normTitle === modNorm);
        if (exact) { addResolved(exact.key, mod, preferOrder); return; }

        const partial = titles.find((t) => t.normTitle.includes(modNorm) || modNorm.includes(t.normTitle));
        if (partial) { addResolved(partial.key, mod, preferOrder); return; }
      };

      // 1) Use Master Modules parent's children if present
      if (masterParent && Array.isArray(masterParent.children)) {
        masterParent.children.forEach((child: any, idx: number) => addByRouteAndName(child, idx));
      }

      // 2) Fallback only when Master Modules is missing entirely
      // (keeps display names consistent with session "Master Modules" list when present)
      if (!masterParent || !Array.isArray(masterParent.children)) {
        flat.forEach((m: any) => addByRouteAndName(m));
      }

      // Diagnostics: if we still have none, log a hint
      if (keys.size === 0) {
        console.warn('[Masters] No allowed masters resolved from user_modules. Check route/name and can_view flags.');
      }

      setAllowedKeys(keys);
      setDisplayNamesByKey(nameMap);
      setOrderByKey(keyOrder);
    } catch (e) {
      console.warn('Failed to parse user_modules for master filtering:', e);
      setAllowedKeys(new Set());
      setDisplayNamesByKey({});
      setOrderByKey({});
    }
  }, []);

  // Filter configs to only those allowed by permissions under Master Modules
  const filteredConfigs = MASTER_CONFIGS.filter((c: any) => allowedKeys.has(String(c.key)));

  // If deep-linked key is not allowed (e.g., permissions update), redirect back to /masters
  useEffect(() => {
    if (activeKey && !filteredConfigs.some((c: any) => c.key === activeKey)) {
      navigate('/masters', { replace: true });
      setActiveKey(null);
    }
  }, [activeKey, filteredConfigs, navigate]);

  // Derive simple card data from filtered configs
  const masterModules = filteredConfigs
    .slice()
    .sort((a: any, b: any) => {
      const ao = orderByKey[String(a?.key)] ?? Number.POSITIVE_INFINITY;
      const bo = orderByKey[String(b?.key)] ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    })
    .map((c: any) => ({
    title: displayNamesByKey[String(c.key)] || c.title,
    icon: c.icon,
    key: c.key,
    description: c.description,
  }));

  const activeConfig = filteredConfigs.find((c: any) => c.key === activeKey) || null;

  return (
    <div className="min-h-screen">
  {!activeConfig && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-3">
            {masterModules.map((module, index) => (
              <div
                key={index}
                onClick={() => {
                  setActiveKey(module.key);
                  navigate(`/masters/${module.key}`);
                }}
                role="button"
                tabIndex={0}
                className="group block p-3 bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all duration-200 hover:border-slate-300 hover:bg-slate-50 cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <div className="flex-shrink-0">
                    <div
                      className={[
                        'p-1.5 rounded-md transition-colors duration-200 ring-1 ring-inset',
                        colorStyles[module.key]?.bg || 'bg-slate-100',
                        colorStyles[module.key]?.ring || 'ring-slate-200/60',
                        'group-hover:brightness-110'
                      ].join(' ')}
                    >
                      <module.icon className={[
                        'h-4 w-4',
                        colorStyles[module.key]?.text || 'text-slate-700'
                      ].join(' ')} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-slate-900 transition-colors duration-200">
                      {module.title}
                    </h3>
                  </div>
                </div>
              </div>
            ))}
            {masterModules.length === 0 && (
              <div className="col-span-full text-center text-sm text-slate-500 py-10">
                No master modules assigned to your role.
              </div>
            )}
          </div>
        </div>
      )}
      {activeConfig && (
        <>
          {/* Description and Back button intentionally removed per request */}
          <MasterTemplate
            leftTitle={(displayNamesByKey[String(activeConfig.key)] || activeConfig.title || activeConfig.tableTitle) as string}
            tableTitle={activeConfig.tableTitle}
            pageSize={activeConfig.pageSize}
            columnDefs={activeConfig.columnDefs}
            formSchema={activeConfig.formSchema}
            mapPayload={activeConfig.mapPayload}
            mapFromDb={activeConfig.mapFromDb}
            tableKey={activeConfig.tableKey}
            autoGenerate={activeConfig.autoGenerate}
            onBack={() => { setActiveKey(null); navigate('/masters'); }}
            exportExcludeKeys={(() => {
              // Exclude fields from export per master when needed
              switch (activeConfig.key) {
                case 'service':
                  // Hide seasonal price and any internal audit/system keys (keep account_code/retail_code per request)
                  return ['seasonal_price', 'created_at', 'updated_at', 'created_by', 'updated_by', 'tax_id', 'hsn_id', 'category_id'];
                case 'inventory':
                  // Keep account_code/retail_code visible
                  return ['created_at', 'updated_at', 'created_by', 'updated_by', 'tax_id', 'hsn_id', 'category_id'];
                case 'customer':
                  return ['account_code', 'retail_code'];
                default:
                  return [];
              }
            })()}
          />
        </>
      )}
    </div>
  );
}
