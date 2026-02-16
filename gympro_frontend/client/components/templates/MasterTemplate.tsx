import React, { useEffect } from 'react';
import { Maximize2, Minimize2, Download } from 'lucide-react';
import { exportData } from '@/lib/exportUtils';
import * as XLSX from 'xlsx';
import { AgGridReact } from 'ag-grid-react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MASTER_TABLES } from '@/services/masterTables';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { DataService } from '@/services/userService';
import { API_BASE_URL, ApiService } from '@/services/apiService';
import { useAuth } from '@/contexts/AuthContext';
import { useHeader } from '@/contexts/HeaderContext';
import QrScannerDialog from '../QrScannerDialog';

export interface StatCard {
  title: string;
  value: string | number;
  color?: string; // tailwind color token or css color
}

export interface MasterTemplateProps {
  title?: string;
  description?: string;
  stats?: StatCard[];
  leftPanel?: React.ReactNode; // form or controls slot
  leftTitle?: string;
  tableTitle?: string;
  // declarative form description: order is the array order
  formSchema?: Array<{
    key: string;
    label?: string;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'date';
    placeholder?: string;
    options?: Array<{ label: string; value: any }>;
    required?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    // when true, the field is part of form state/payload but not rendered in the UI
    hidden?: boolean;
    // when true, render a small Scan button to capture QR/barcode and fill this field
    qrScan?: boolean;
    // optional lookup alias/table to auto-populate options (e.g., lookup: 'membership')
    lookup?: string;
    lookupTable?: string;
    // optional filter criteria for lookup data (e.g., { category_type: 'Service' })
    lookupFilter?: Record<string, any>;
    // span across both columns when true
    colSpan?: 1 | 2;
    // default value for the field
    defaultValue?: any;
  }>;
  // optional mapper to turn UI form payload into DB payload (called before create/update)
  mapPayload?: (payload: Record<string, any>) => Record<string, any>;
  // optional mapper to normalize DB rows into UI-friendly row objects for the grid
  mapFromDb?: (row: any) => any;
  // buttons rendered under the generated form
  buttons?: Array<{ id: string; label: string; variant?: string; type?: 'button' | 'submit'; icon?: React.ReactNode }>;
  // called when any button is clicked; receives (actionId, formData)
  onFormAction?: (actionId: string, formData: Record<string, any>) => void;
  // optional initial values to prefill generated form (keyed by field key)
  formInitialValues?: Record<string, any>;
  // render inputs/selects with dark background and light text when true
  inputDark?: boolean;
  columnDefs?: any[]; // ag-grid column defs
  rowData?: any[]; // ag-grid row data
  pageSize?: number;
  onRowDoubleClick?: (row: any) => void;
  // optional table key to let template perform default read/create/update
  tableKey?: string;
  // optional back handler (e.g., return to master modules list)
  onBack?: () => void;
  // optional upload handler to receive parsed rows from Excel/CSV
  onUploadExcel?: (rows: any[]) => void;
  // optional list of keys to exclude from export (exact field names)
  exportExcludeKeys?: string[];
}

export default function MasterTemplate({
  title,
  description,
  stats,
  leftPanel,
  leftTitle,
  tableTitle,
  formSchema,
  buttons,
  onFormAction,
  formInitialValues,
  inputDark,
  columnDefs,
  rowData,
  pageSize,
  onRowDoubleClick,
  tableKey,
  mapPayload,
  mapFromDb,
  autoGenerate,
  onBack,
  onUploadExcel,
  exportExcludeKeys,
}: MasterTemplateProps & { autoGenerate?: any }) {
  // set the global header title when this template is used
  try {
    const { setHeaderTitle } = useHeader();
    useEffect(() => {
      const header = title || leftTitle || tableTitle || '';
      setHeaderTitle(header);
      return () => setHeaderTitle('');
    }, [title, leftTitle, tableTitle, setHeaderTitle]);
  } catch (e) {
    // If HeaderContext is not provided, silently ignore (layout may not be mounted)
  }
  // keep template neutral: do not apply textual defaults here
  const statsArray = stats || [];
  // Add valueFormatter for status columns globally
  const gridColumnDefs = (columnDefs || []).map((col) => {
    if (col.field === 'status' && !col.valueFormatter) {
      return {
        ...col,
        valueFormatter: (params) => {
          const v = params.value;
          if (v === 1 || v === '1' || v === 'Active') return 'Active';
          if (v === 0 || v === '0' || v === 'Inactive') return 'Inactive';
          return v;
        },
        // default modern badge renderer when not provided
        cellRenderer: col.cellRenderer || ((params: any) => {
          const raw = params?.value;
          const isActive = (String(raw).toLowerCase() === 'active' || String(raw) === '1');
          const label = isActive ? 'Active' : 'Inactive';
          const cls = isActive
            ? 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200'
            : 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200';
          return (
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${cls}`}>{label}</span>
          );
        })
      };
    }
    return col;
  });
  const [fetchedRows, setFetchedRows] = React.useState<any[] | null>(null);
  const gridRowData = rowData || fetchedRows || [];
  const isLoading = fetchedRows === null && !rowData;
  const agGridExtra = pageSize ? { paginationPageSize: pageSize } : {};
  // quick filter state for modern table toolbar
  const [quickFilter, setQuickFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState(false);
  const [scannerOpen, setScannerOpen] = React.useState(false);
  const [scannerTargetKey, setScannerTargetKey] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // Upload confirmation modal state
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pendingUploadRows, setPendingUploadRows] = React.useState<any[]>([]);
  const [pendingFileName, setPendingFileName] = React.useState<string>('');
  const [selectedFiles, setSelectedFiles] = React.useState<{[key: string]: File}>({});
  const [uploadUrls, setUploadUrls] = React.useState<{[key: string]: string}>({});
  // Tooltip beside Upload to show Excel steps
  const [showUploadHelp, setShowUploadHelp] = React.useState(false);
  // Selected customer for details card
  const [selectedCustomer, setSelectedCustomer] = React.useState<any | null>(null);
  const [selectedEmployee, setSelectedEmployee] = React.useState<any | null>(null);
  const [previewModal, setPreviewModal] = React.useState<{
    isOpen: boolean;
    type: 'image' | 'document' | null;
    url: string;
    title: string;
  }>({ isOpen: false, type: null, url: '', title: '' });

  const buildAuthorizedFileUrl = (rawUrl: string) => {
    if (!rawUrl) return rawUrl;
    let fullUrl = rawUrl.startsWith('/files/') ? `${API_BASE_URL}${rawUrl}` : rawUrl;
    const token = sessionStorage.getItem('access_token');
    if (token && fullUrl.includes('/files/')) {
      const separator = fullUrl.includes('?') ? '&' : '?';
      fullUrl = `${fullUrl}${separator}token=${token}`;
    }
    return fullUrl;
  };

  // Preview modal handlers
  const handleImagePreview = (imageUrl: string, customerName: string) => {
    // Construct full URL if it's a relative path
    let fullImageUrl = imageUrl.startsWith('/files/') ? `${API_BASE_URL}${imageUrl}` : imageUrl;
    
    // Add authentication token as query parameter for browser access
    const token = sessionStorage.getItem('access_token');
    if (token && fullImageUrl.includes('/files/')) {
      const separator = fullImageUrl.includes('?') ? '&' : '?';
      fullImageUrl = `${fullImageUrl}${separator}token=${token}`;
    }
    
    setPreviewModal({
      isOpen: true,
      type: 'image',
      url: fullImageUrl,
      title: `${customerName} - Profile Photo`
    });
  };

  const handleDocumentPreview = (documentUrl: string, customerName: string) => {
    // Construct full URL if it's a relative path
    let fullDocumentUrl = documentUrl.startsWith('/files/') ? `${API_BASE_URL}${documentUrl}` : documentUrl;
    
    // Add authentication token as query parameter for browser access
    const token = sessionStorage.getItem('access_token');
    if (token && fullDocumentUrl.includes('/files/')) {
      const separator = fullDocumentUrl.includes('?') ? '&' : '?';
      fullDocumentUrl = `${fullDocumentUrl}${separator}token=${token}`;
    }
    
    setPreviewModal({
      isOpen: true,
      type: 'document', 
      url: fullDocumentUrl,
      title: `${customerName} - Document`
    });
  };

  const closePreviewModal = () => {
    setPreviewModal({ isOpen: false, type: null, url: '', title: '' });
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      const data = await file.arrayBuffer();
      let rows: any[] = [];
      if (isCSV) {
        const text = new TextDecoder().decode(new Uint8Array(data));
        // Use XLSX to parse CSV for consistency
        const wb = XLSX.read(text, { type: 'string' });
        const firstSheet = wb.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet] || {}, { defval: '' });
      } else {
        const wb = XLSX.read(data, { type: 'array' });
        const firstSheet = wb.SheetNames[0];
        rows = XLSX.utils.sheet_to_json(wb.Sheets[firstSheet] || {}, { defval: '' });
      }
      const count = Array.isArray(rows) ? rows.length : 0;
      // Store rows and open confirmation modal; actual processing happens on Confirm button
      setPendingUploadRows(rows);
      setPendingFileName(file.name);
      setConfirmOpen(true);
      return; // defer processing until user confirms
    } catch (err) {
      console.warn('Failed to parse upload', err);
      toast({ title: 'Upload Failed', description: 'Could not read the selected file' });
    }
  };

  // Handle individual file uploads for form fields
  const handleFormFileUpload = async (fieldKey: string, file: File) => {
    try {
      // Store the file temporarily
      setSelectedFiles(prev => ({ ...prev, [fieldKey]: file }));
      
      // Create a temporary URL for preview (if it's an image)
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        setUploadUrls(prev => ({ ...prev, [fieldKey]: url }));
      }
      
      toast({ title: 'Uploading...', description: `Uploading ${file.name}` });

      // Determine upload identity for custom naming: retailcode+id+name
      const isEmployeeUpload = isEmployeeMaster && !isCustomerMaster;

      const idCandidates = isEmployeeUpload
        ? [
            formState.employee_id,
            formState.employeeId,
            formState.emp_id,
            formState.id,
            formState.ID,
            editing?.employee_id,
            editing?.employeeId,
            editing?.emp_id,
            editing?.id,
            editing?.ID,
          ]
        : [
            formState.customer_id,
            formState.id,
            formState.ID,
            formState.CUSTOMER_ID,
            editing?.customer_id,
            editing?.id,
            editing?.ID,
            editing?.CUSTOMER_ID,
          ];

      let entityId = idCandidates.find((v: any) => v !== undefined && v !== null && String(v).trim() !== '');

      // If no ID found and we're creating a new record, try to predict next ID
      if (!entityId || entityId === 'unknown') {
        const canPredict = (isCustomerMaster || isEmployeeMaster) && gridRowData && Array.isArray(gridRowData);
        if (canPredict) {
          try {
            let maxId = 0;
            gridRowData.forEach((row: any) => {
              const rowId = isEmployeeUpload
                ? (row.employee_id ?? row.emp_id ?? row.id ?? row.ID)
                : (row.customer_id ?? row.id ?? row.ID ?? row.CUSTOMER_ID);
              if (rowId && !isNaN(Number(rowId))) {
                maxId = Math.max(maxId, Number(rowId));
              }
            });
            if (maxId > 0) entityId = maxId + 1;
          } catch (e) {
            console.warn('[FileUpload] Failed to predict next id:', e);
          }
        }

        if (!entityId) {
          const timestamp = Date.now().toString().slice(-6);
          entityId = `temp${timestamp}`;
        }
      }

      entityId = entityId && entityId !== 'unknown' ? String(entityId) : `temp${Date.now().toString().slice(-6)}`;

      const nameCandidates = isEmployeeUpload
        ? [
            formState.employee_name,
            formState.employeeName,
            formState.name,
            editing?.employee_name,
            editing?.employeeName,
            editing?.name,
          ]
        : [
            formState.customer_name,
            formState.name,
            formState.customerName,
            formState.client_name,
            editing?.customer_name,
            editing?.name,
            editing?.customerName,
            editing?.client_name,
          ];

      const entityName = String(nameCandidates.find((v: any) => v !== undefined && v !== null && String(v).trim() !== '') || (isEmployeeUpload ? 'employee' : 'customer'));
      
      // Determine upload endpoint based on field key
      const endpoint = fieldKey === 'photo_url' ? '/upload/image' : '/upload/document';
      
      // Prepare form data for upload
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);
      
      // Build upload URL with parameters for custom naming: retailcode+id+name
      const params = new URLSearchParams({
        account_code: accountCode || 'DEFAULT',
        retail_code: retailCode || 'DEFAULT_R1',
        // Backend currently expects these parameter names; we reuse them for employees.
        customer_id: String(entityId),
        customer_name: String(entityName)
      });
      
      const qs = params.toString();

      // Upload file to backend (production-safe): try primary API base, then common reverse-proxy routes.
      const candidates: string[] = [];
      candidates.push(`${API_BASE_URL}${endpoint}?${qs}`);
      try {
        const origin = window.location.origin.replace(/\/$/, '');
        candidates.push(`${origin}/api${endpoint}?${qs}`);
        candidates.push(`${origin}${endpoint}?${qs}`);
      } catch {
        // ignore
      }
      try {
        const backendOrigin = ((import.meta as any)?.env?.VITE_BACKEND_ORIGIN || ((): string => {
          try { return window.location.origin.replace(':8080', ':8000'); } catch { return ''; }
        })()).replace(/\/$/, '');
        if (backendOrigin) {
          candidates.push(`${backendOrigin}${endpoint}?${qs}`);
          candidates.push(`${backendOrigin}/api${endpoint}?${qs}`);
        }
      } catch {
        // ignore
      }

      const tried = new Set<string>();
      let lastFailure: string | undefined;
      let result: any | undefined;

      for (const url of candidates) {
        if (!url || tried.has(url)) continue;
        tried.add(url);
        try {
          const response = await ApiService.fetchWithAuth(url, {
            method: 'POST',
            body: uploadFormData,
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => response.statusText);
            lastFailure = `HTTP ${response.status}: ${errText}`;
            continue;
          }

          const ct = response.headers.get('content-type') || '';
          if (!/application\/json/i.test(ct)) {
            const txt = await response.text().catch(() => 'Non-JSON response');
            lastFailure = `Unexpected response: ${txt}`;
            continue;
          }

          result = await response.json();
          break;
        } catch (e) {
          lastFailure = e instanceof Error ? e.message : String(e);
          continue;
        }
      }

      if (!result) {
        throw new Error(lastFailure || 'Upload failed');
      }
      
      if (result.success) {
        // Update form state with the returned file URL
        handleFieldChange(fieldKey, result.file_url);
        toast({ 
          title: 'Upload Successful', 
          description: `${file.name} uploaded successfully` 
        });
      } else {
        throw new Error(result.message || 'Upload failed');
      }
      
    } catch (error) {
      console.error('File upload error:', error);
      toast({ 
        title: 'Upload Failed', 
        description: error instanceof Error ? error.message : 'Could not upload the file' 
      });
    }
  };

  // Proceed with upload after user confirmation
  const processConfirmedUpload = async () => {
    try {
      const rows = pendingUploadRows || [];
      const fileName = pendingFileName || 'file';
      const count = Array.isArray(rows) ? rows.length : 0;
      // If consumer provided a handler, delegate; otherwise perform default upsert when tableKey exists
      if (typeof onUploadExcel === 'function') {
        onUploadExcel(rows);
      } else if (tableKey) {
        // Default upsert: update by master-specific key if exists; else insert
        const normalizeKey = (k: string) => String(k)
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\./g, '')
          .replace(/\s/g, '_')
          .toLowerCase();

        // Build normalized rows keyed by snake_case
        const normRows: any[] = (rows || []).map((r) => {
          const out: Record<string, any> = {};
          Object.keys(r || {}).forEach((k) => {
            const nk = normalizeKey(k);
            out[nk] = (r as any)[k];
          });
          return out;
        });

        const tableKeyLower = String(tableKey || '').toLowerCase();
        const businessIdColumn = String(autoGenerate?.column || '').trim();
        const getBusinessId = (obj: any) => {
          if (!obj) return undefined;
          const tryCols: string[] = [];
          if (businessIdColumn) tryCols.push(businessIdColumn);
          // common variants (normalized rows already snake_case; keep a few fallbacks)
          if (businessIdColumn) {
            tryCols.push(businessIdColumn.replace(/_/g, ''));
            tryCols.push(`${businessIdColumn}_`);
          }
          // final generic fallbacks
          tryCols.push('id');
          for (const c of tryCols) {
            if (obj[c] !== undefined && obj[c] !== null && String(obj[c]).trim() !== '') return obj[c];
          }
          return undefined;
        };

        const getNaturalKeyField = (): string | null => {
          const schema = Array.isArray(formSchema) ? formSchema : [];
          const candidatesFromSchema: string[] = schema
            .filter((f: any) => !!f?.key)
            .map((f: any) => String(f.key))
            .filter((k: string) => !['status', 'account_code', 'retail_code', 'created_at', 'updated_at', 'created_by', 'updated_by'].includes(k));

          const required = schema
            .filter((f: any) => !!f?.required && !!f?.key)
            .map((f: any) => String(f.key))
            .filter((k: string) => !k.endsWith('_id'));

          const nameLike = candidatesFromSchema.filter((k) => k.endsWith('_name') || k.toLowerCase().includes('name'));
          const descLike = candidatesFromSchema.filter((k) => k === 'description' || k.toLowerCase().includes('description'));

          // Prefer required name-like, then required description-like, then any name-like, then any description-like
          const pick = (arr: string[]) => arr.find((k) => k && k.trim());
          return (
            pick(required.filter((k) => nameLike.includes(k))) ||
            pick(required.filter((k) => descLike.includes(k))) ||
            pick(nameLike) ||
            pick(descLike) ||
            pick(required) ||
            null
          );
        };

        const naturalKeyField = getNaturalKeyField();
        const normalizeNaturalKeyValue = (v: any) => String(v ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .toLowerCase();

        // Fetch existing rows to determine updates vs inserts
        let existing: any[] = [];
        try {
          const res = await DataService.readData([tableKey], accountCode, retailCode);
          const d = (res as any)?.data;
          if (Array.isArray(d)) existing = d; else if (d && Array.isArray(d[tableKey])) existing = d[tableKey];
        } catch (err) {
          console.warn('[Upload] Failed to read existing rows; proceeding with insert-only where applicable', err);
        }

        // Build indexes by business id (autoGenerate.column) and by natural key (e.g., name/description)
        const existingByBusinessId = new Map<string, any>();
        const existingByNaturalKey = new Map<string, any>();
        let maxBusinessId = 0;
        existing.forEach((row: any) => {
          const bid = getBusinessId(row);
          if (bid !== undefined && bid !== null && String(bid).trim() !== '') {
            const key = String(bid).trim();
            existingByBusinessId.set(key, row);
            const n = Number(key);
            if (!Number.isNaN(n) && n > maxBusinessId) maxBusinessId = n;
          }
          if (naturalKeyField) {
            const nv = normalizeNaturalKeyValue(row?.[naturalKeyField]);
            if (nv) existingByNaturalKey.set(nv, row);
          }
        });

        // Small helpers
        const normalizeStatusForMaster = (v: any) => {
          // If no status field is present on the sheet, do nothing.
          if (v === undefined || v === null || String(v).trim() === '') return v;

          const schema = Array.isArray(formSchema) ? formSchema : [];
          const statusField = schema.find((f: any) => String(f?.key || '') === 'status');
          const opts = (statusField?.options || []) as any[];
          const optionValues = opts.map((o) => o?.value);
          const wantsNumeric = optionValues.some((x) => x === 1 || x === 0 || x === '1' || x === '0');
          const wantsString = optionValues.some((x) => String(x).toLowerCase() === 'active' || String(x).toLowerCase() === 'inactive');

          const s = String(v).trim().toLowerCase();
          const isActive = (s === 'active' || s === '1' || s === 'true');
          const isInactive = (s === 'inactive' || s === '0' || s === 'false');

          if (wantsString && !wantsNumeric) {
            if (isActive) return 'Active';
            if (isInactive) return 'Inactive';
            return v;
          }
          // Default to numeric if schema supports it (most masters)
          if (wantsNumeric) {
            if (isActive) return 1;
            if (isInactive) return 0;
            // If already numeric-like, keep; else coerce best-effort
            const n = Number(v);
            return Number.isNaN(n) ? v : n;
          }
          // Unknown schema: preserve input
          return v;
        };

        const sanitizeIds = (obj: any) => {
          Object.keys(obj).forEach((k) => {
            if (k.endsWith('_id')) {
              const val = obj[k];
              if (val === '' || val === null || val === undefined) {
                delete obj[k];
              } else {
                const n = Number(val);
                if (!Number.isNaN(n) && n > 0) obj[k] = n; else delete obj[k];
              }
            }
          });
          return obj;
        };

        const sanitizeEmptyStringsToNull = (obj: any, keys: string[]) => {
          if (!obj || typeof obj !== 'object') return obj;
          for (const k of keys) {
            if (!(k in obj)) continue;
            const v = obj[k];
            if (v === undefined || v === null) continue;
            if (typeof v === 'string' && v.trim() === '') obj[k] = null;
          }
          return obj;
        };
        // Resolve category_id from category_name or string value using cached lookups or live fetch
        const resolveCategoryId = async (payload: any): Promise<void> => {
          try {
            const val = payload.category_id;
            const name = payload.category_name;
            const isNumeric = val !== undefined && val !== null && /^\d+$/.test(String(val));
            // If already valid positive number, keep
            if (isNumeric && Number(val) > 0) { payload.category_id = Number(val); return; }
            // Determine lookup rows
            let rows: any[] = [];
            const cached = cachedLookupData?.['master_category'];
            if (Array.isArray(cached) && cached.length) {
              rows = cached;
            } else {
              try {
                const res = await DataService.readData(['master_category'], accountCode, retailCode);
                const d = (res as any)?.data;
                rows = Array.isArray(d) ? d : (d?.['master_category'] || []);
              } catch {}
            }
            if (!Array.isArray(rows) || rows.length === 0) { delete payload.category_id; return; }
            // Match by provided name or by category_id string
            const matchByName = (n: string) => rows.find((r:any) => String(r.category_name || r.name || r.title || '').trim().toLowerCase() === String(n || '').trim().toLowerCase());
            const matchById = (s: any) => rows.find((r:any) => String(r.category_id ?? r.id ?? '').trim() === String(s || '').trim());
            let found: any = null;
            if (name) found = matchByName(name);
            if (!found && val && !isNumeric) found = matchByName(val);
            if (!found && val) found = matchById(val);
            const idVal = found ? (found.category_id ?? found.id) : undefined;
            if (idVal && Number(idVal) > 0) {
              payload.category_id = Number(idVal);
              // Also ensure category_name is set for display consistency
              payload.category_name = found.category_name ?? found.name ?? String(idVal);
            } else {
              // Drop invalid/zero category_id so backend ignores it
              delete payload.category_id;
            }
          } catch (err) {
            console.warn('[Upload] resolveCategoryId failed', err);
            delete payload.category_id;
          }
        };
        // Resolve hsn_id from hsn_name/hsn_code and map tax_id via master_hsn → master_tax
        const resolveHsnAndTax = async (payload: any): Promise<void> => {
          try {
            const hsnIdVal = payload.hsn_id;
            const hsnName = payload.hsn_name ?? payload.hsn ?? payload.hsn_code;
            let hsnRows: any[] = [];
            const cachedHsn = cachedLookupData?.['master_hsn'];
            if (Array.isArray(cachedHsn) && cachedHsn.length) {
              hsnRows = cachedHsn;
            } else {
              try {
                const res = await DataService.readData(['master_hsn'], accountCode, retailCode);
                const d = (res as any)?.data;
                hsnRows = Array.isArray(d) ? d : (d?.['master_hsn'] || []);
              } catch {}
            }
            // If we have hsn rows, attempt resolution
            if (Array.isArray(hsnRows) && hsnRows.length) {
              const matchByNameOrCode = (n: string) => hsnRows.find((r:any) => {
                const label = (
                  (r.hsn_description && String(r.hsn_description).trim()) ||
                  (r.hsn_name && String(r.hsn_name).trim()) ||
                  (r.description && String(r.description).trim()) ||
                  (r.hsn_code && String(r.hsn_code).trim()) ||
                  ''
                );
                return String(label).toLowerCase() === String(n || '').trim().toLowerCase();
              }) || hsnRows.find((r:any) => String(r.hsn_code || '').trim() === String(n || '').trim());

              const matchById = (s: any) => hsnRows.find((r:any) => String(r.hsn_id ?? r.id ?? '').trim() === String(s || '').trim());
              let found: any = null;
              const isNumericId = hsnIdVal !== undefined && /^\d+$/.test(String(hsnIdVal));
              if (isNumericId) found = matchById(hsnIdVal);
              if (!found && hsnName) found = matchByNameOrCode(hsnName);
              if (!found && hsnIdVal) found = matchById(hsnIdVal);

              const resolvedHsnId = found ? (found.hsn_id ?? found.id) : undefined;
              if (resolvedHsnId && Number(resolvedHsnId) > 0) {
                payload.hsn_id = Number(resolvedHsnId);
                // Also set hsn_name display if available
                payload.hsn_name = (
                  found.hsn_description ?? found.hsn_name ?? found.description ?? found.hsn_code ?? String(resolvedHsnId)
                );
                // Map tax_id from HSN.tax_id using master_tax lookup for correctness
                const taxIdFromHsn = found.tax_id ?? found.tax ?? found.taxId;
                if (taxIdFromHsn) {
                  let taxRows: any[] = [];
                  const cachedTax = cachedLookupData?.['master_tax'];
                  if (Array.isArray(cachedTax) && cachedTax.length) {
                    taxRows = cachedTax;
                  } else {
                    try {
                      const resT = await DataService.readData(['master_tax'], accountCode, retailCode);
                      const dT = (resT as any)?.data;
                      taxRows = Array.isArray(dT) ? dT : (dT?.['master_tax'] || []);
                    } catch {}
                  }
                  const taxMatch = Array.isArray(taxRows) ? taxRows.find((t:any) => String(t.tax_id ?? t.id ?? '').trim() === String(taxIdFromHsn).trim()) : null;
                  const resolvedTaxId = taxMatch ? (taxMatch.tax_id ?? taxMatch.id) : taxIdFromHsn;
                  if (resolvedTaxId && Number(resolvedTaxId) > 0) {
                    payload.tax_id = Number(resolvedTaxId);
                    payload.tax_name = (taxMatch?.description ?? taxMatch?.name ?? String(resolvedTaxId));
                  } else {
                    // drop invalid tax_id
                    delete payload.tax_id;
                  }
                }
              } else {
                // HSN resolution failed: drop invalid ids and leave for manual correction
                if (!isNumericId || Number(hsnIdVal) <= 0) delete payload.hsn_id;
              }
            } else {
              // No HSN data: avoid sending invalid ids
              if (!hsnIdVal || Number(hsnIdVal) <= 0) delete payload.hsn_id;
            }

            // If tax_name provided but tax_id missing, resolve tax_id by name
            if (!payload.tax_id && payload.tax_name) {
              let taxRows: any[] = [];
              const cachedTax = cachedLookupData?.['master_tax'];
              if (Array.isArray(cachedTax) && cachedTax.length) taxRows = cachedTax; else {
                try {
                  const resT = await DataService.readData(['master_tax'], accountCode, retailCode);
                  const dT = (resT as any)?.data;
                  taxRows = Array.isArray(dT) ? dT : (dT?.['master_tax'] || []);
                } catch {}
              }
              const tFound = Array.isArray(taxRows) ? taxRows.find((t:any) => String(t.description || t.name || '').trim().toLowerCase() === String(payload.tax_name || '').trim().toLowerCase()) : null;
              const tId = tFound ? (tFound.tax_id ?? tFound.id) : undefined;
              if (tId && Number(tId) > 0) {
                payload.tax_id = Number(tId);
                payload.tax_name = tFound.description ?? tFound.name ?? String(tId);
              }
            }
          } catch (err) {
            console.warn('[Upload] resolveHsnAndTax failed', err);
          }
        };

        let updates = 0, inserts = 0, skipped = 0;
        for (const r of normRows) {
          const rowBusinessId = getBusinessId(r);
          const rowNaturalKey = naturalKeyField ? normalizeNaturalKeyValue(r?.[naturalKeyField]) : '';

          // minimal validation: require at least a natural key value when available
          if (naturalKeyField && !rowNaturalKey) { skipped++; continue; }

          // When no schema-derived natural key exists, don't skip; allow insert/update by id only.
          if (!naturalKeyField && (rowBusinessId === undefined || rowBusinessId === null || String(rowBusinessId).trim() === '')) {
            // Without an id and without a natural key to match, we can't safely upsert.
            skipped++;
            continue;
          }

          // Normalize payload keys expected by backend
          const payload: any = { ...r };
          // Normalize status to match master schema
          if (payload.status !== undefined && payload.status !== null) payload.status = normalizeStatusForMaster(payload.status);
          // Ensure account/retail codes
          payload.account_code = accountCode;
          payload.retail_code = retailCode;
          sanitizeIds(payload);

          // Customer master: blank date cells should be sent as null (not empty string)
          if (tableKeyLower === 'master_customer' || tableKeyLower === 'customer') {
            sanitizeEmptyStringsToNull(payload, ['birthday_date', 'anniversary_date']);
          }

          // Only resolve these lookups for masters that actually use them (service/inventory)
          if (tableKeyLower === 'master_service' || tableKeyLower === 'service' || tableKeyLower === 'master_inventory' || tableKeyLower === 'inventory') {
            // Resolve category_id before sending (handles name or string values)
            await resolveCategoryId(payload);
            // Resolve HSN and Tax before sending (handles names/codes and mapping)
            await resolveHsnAndTax(payload);
          }

          // Apply master-specific payload mapping if provided (e.g., package tax_id -> taxid)
          const finalPayload = (mapPayload && typeof mapPayload === 'function') ? mapPayload(payload) : payload;

          // Ensure mapping didn't re-introduce empty strings for optional date fields
          if (tableKeyLower === 'master_customer' || tableKeyLower === 'customer') {
            sanitizeEmptyStringsToNull(finalPayload, ['birthday_date', 'anniversary_date']);
          }

          try {
            const lookupKey = (rowBusinessId !== undefined && rowBusinessId !== null) ? String(rowBusinessId).trim() : '';
            const existingRow = (
              (lookupKey && existingByBusinessId.get(lookupKey)) ||
              (rowNaturalKey && existingByNaturalKey.get(rowNaturalKey)) ||
              null
            );

            if (existingRow) {
              // Attach primary key candidates so backend /update can succeed regardless of PK naming
              if (existingRow?.id !== undefined && existingRow?.id !== null) {
                finalPayload.id = existingRow.id;
              }
              if (businessIdColumn) {
                const exBid = existingRow?.[businessIdColumn];
                if (exBid !== undefined && exBid !== null && String(exBid).trim() !== '') {
                  finalPayload[businessIdColumn] = exBid;
                } else if (lookupKey) {
                  finalPayload[businessIdColumn] = lookupKey;
                }
              }
              finalPayload.updated_by = username;
              await DataService.updateData(tableKey, finalPayload);
              updates++;
            } else {
              // Insert: prefer backend auto-generate when configured.
              if (businessIdColumn) {
                const hasProvided = finalPayload[businessIdColumn] !== undefined && finalPayload[businessIdColumn] !== null && String(finalPayload[businessIdColumn]).trim() !== '';
                if (!hasProvided && !autoGenerate) {
                  // Fallback only when autoGenerate is not provided
                  finalPayload[businessIdColumn] = maxBusinessId + 1;
                  maxBusinessId = Number(finalPayload[businessIdColumn]) || maxBusinessId;
                }
              }
              await DataService.createData(tableKey, finalPayload, autoGenerate, accountCode, retailCode);
              inserts++;
            }
          } catch (err) {
            console.warn('[Upload] Row failed', { r, err });
            skipped++;
          }
        }

        // Refresh grid data after upsert
        try {
          const res2 = await DataService.readData([tableKey], accountCode, retailCode);
          const d2 = (res2 as any)?.data;
          let raw2: any[] = [];
          if (Array.isArray(d2)) raw2 = d2;
          else if (d2 && Array.isArray(d2[tableKey])) raw2 = d2[tableKey];
          if (raw2.length > 0) {
            const enriched = await enrichForeignKeyData(raw2, accountCode, retailCode);
            raw2 = enriched;
          }
          const out2 = (mapFromDb && typeof mapFromDb === 'function') ? raw2.map(mapFromDb) : raw2.map((r: any) => {
            let norm = 'Active';
            const rawStatus = r.status ?? r.STATUS ?? r.is_active ?? null;
            if (rawStatus === 0 || rawStatus === '0' || String(rawStatus).toLowerCase() === 'inactive') norm = 'Inactive';
            else if (rawStatus === 1 || rawStatus === '1' || String(rawStatus).toLowerCase() === 'active') norm = 'Active';
            return { ...r, status: norm, STATUS: norm, _statusNumber: rawStatus };
          });
          setFetchedRows(out2 || []);
        } catch (err) {
          console.warn('[Upload] Refresh failed', err);
        }

        toast({ title: 'Upload Complete', description: `Processed ${count} rows: ${updates} updated, ${inserts} inserted, ${skipped} skipped.` });
      } else {
        toast({ title: 'Upload Parsed', description: `Loaded ${count} rows from ${fileName}` });
      }
    } finally {
      // Reset modal and input
      setConfirmOpen(false);
      setPendingUploadRows([]);
      setPendingFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleExport = React.useCallback(() => {
    try {
      // Build columns from ALL fields present in the data, not just visible grid columns
      const q = String(quickFilter || '').trim().toLowerCase();
      const sourceRows: any[] = Array.isArray(gridRowData) ? gridRowData : [];
      const filteredRows = q
        ? sourceRows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
        : sourceRows;

      const sample = filteredRows[0] || sourceRows[0] || {};
      const rawKeys = Object.keys(sample || {});

      // Normalize headers: Title Case from keys, preserve common display names
      const toHeader = (k: string) => String(k)
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());

      // Exclude internal/react/ag-grid helper fields
      const excluded = new Set([
        '_statusNumber',
        // Always exclude generic Id fields from export
        'id', 'ID',
        // Exclude legacy/duplicate status representations
        'STATUS', 'Status', 'is_active', 'IS_ACTIVE', 'Is_Active',
        // Exclude audit/system fields globally across masters
        'created_at', 'Created_at', 'Created_At', 'createdAt', 'CreatedAt',
        'updated_at', 'Updated_at', 'Updated_At', 'updatedAt', 'UpdatedAt',
        'created_by', 'Created_by', 'Created_By', 'createdBy', 'CreatedBy',
        'updated_by', 'Updated_by', 'Updated_By', 'updatedBy', 'UpdatedBy',
        ...(Array.isArray(exportExcludeKeys) ? exportExcludeKeys : []),
      ].map((k) => String(k)));
      // Prefer canonical 'status' when present; drop any other case variants
      let keys = rawKeys.filter((k) => !excluded.has(String(k)));
      const hasCanonicalStatus = keys.includes('status');
      if (hasCanonicalStatus) {
        keys = keys.filter((k) => String(k).toLowerCase() !== 'status' || k === 'status');
      }

      // Professional ordering: prioritize common fields for Service/Inventory
      const preferredOrder: string[] = [
        // Bring account/retail codes to the very front
        'account_code', 'retail_code',
        // Place Tax Id beside Retail Code when present
        'tax_id',
        // id intentionally excluded from export
        'service_id', 'inventory_id',
        'service_name', 'item_name',
        'preferred_gender',
        'description', 'service_description',
        'price',
        // Ensure HSN Name is immediately followed by Tax Name
        'hsn_name', 'tax_name',
        'hsn_code', 'hsn_id',
        'category_name', 'category_id',
        // Move status to the end
        'status',
      ];
      const orderIndex = (k: string) => {
        const i = preferredOrder.indexOf(k);
        return i >= 0 ? i : preferredOrder.length + keys.indexOf(k);
      };
      const sortedKeys = [...keys].sort((a, b) => orderIndex(a) - orderIndex(b));
      const columns = sortedKeys.map((k) => ({ header: toHeader(k), dataKey: k }));

      const data = filteredRows.map((row) => {
        const out: Record<string, any> = {};
        sortedKeys.forEach((k) => {
          let v = (row as any)[k];
          // Normalize status numeric to human strings if a separate status is absent
          if (k === 'status') {
            const raw = row[k];
            if (raw === 1 || raw === '1') v = 'Active';
            else if (raw === 0 || raw === '0') v = 'Inactive';
          }
          out[k] = v ?? '';
        });
        return out;
      });

      // Prepare optional lookup lists for Excel companion sheet
      let lookups: Record<string, string[]> | undefined;
      let hsnTaxMap: Array<{ hsn: string; tax: string }> | undefined;
      try {
        // Build lookup lists for dropdowns in Excel
        const tableKeyLower = String(tableKey || '').toLowerCase();
        const cats = (cachedLookupData?.['master_category'] || []) as any[];
        const taxes = (cachedLookupData?.['master_tax'] || []) as any[];
        const hsns = (cachedLookupData?.['master_hsn'] || []) as any[];

        const categoryNames = Array.from(new Set(
          cats
            .filter((c: any) => String(c?.category_name || c?.name || '').trim())
            .map((c: any) => String(c?.category_name || c?.name).trim())
        )).sort((a, b) => a.localeCompare(b));

        const taxNames = Array.from(new Set(
          taxes
            .map((t: any) => String(t?.description || t?.name || '').trim())
            .filter((s: string) => !!s)
        )).sort((a, b) => a.localeCompare(b));

        const hsnLabel = (h: any) => String(h?.hsn_description || h?.description || h?.hsn_name || h?.hsn_code || '').trim();
        const hsnNames = Array.from(new Set(
          hsns.map(hsnLabel).filter((s: string) => !!s)
        )).sort((a, b) => a.localeCompare(b));

        const statusList = ['Active', 'Inactive'];
        const genderList = ['Male', 'Female', 'Unisex', 'Other'];

        lookups = {};
        if (categoryNames.length && (tableKeyLower === 'master_service' || tableKeyLower === 'service' || tableKeyLower === 'master_inventory' || tableKeyLower === 'inventory')) {
          lookups['category_name'] = categoryNames;
        }
        if (taxNames.length) {
          lookups['tax_name'] = taxNames;
        }
        if (hsnNames.length) {
          lookups['hsn_name'] = hsnNames;
        }
        lookups['status'] = statusList;
        // Preferred Gender dropdown for Service master exports
        if (tableKeyLower === 'master_service' || tableKeyLower === 'service') {
          lookups['preferred_gender'] = genderList;
        }
        // Build HSN→Tax mapping when both datasets are available
        try {
          const taxMapById = new Map<string, string>();
          taxes.forEach((t: any) => {
            const id = String(t?.tax_id ?? t?.id ?? '').trim();
            const name = String(t?.description || t?.name || '').trim();
            if (id && name) taxMapById.set(id, name);
          });
          const pairs: Array<{ hsn: string; tax: string }> = [];
          hsns.forEach((h: any) => {
            const label = hsnLabel(h);
            const tid = String(h?.tax_id ?? '').trim();
            const taxName = tid ? (taxMapById.get(tid) || '') : '';
            if (label) {
              pairs.push({ hsn: label, tax: taxName });
            }
          });
          if (pairs.length) hsnTaxMap = pairs;
        } catch {}
      } catch {}

      exportData('excel', {
        filename: `${(tableTitle || title || 'export').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${new Date().toISOString().slice(0,10)}`,
        title: tableTitle || title || 'Export',
        columns,
        data,
        lookups,
        hsnTaxMap,
      });
    } catch (e) {
      console.warn('Export failed:', e);
    }
  }, [gridRowData, quickFilter, tableTitle, title, JSON.stringify(exportExcludeKeys||[])]);

  const { user } = useAuth();
  const accountCode = user?.account_code || '';
  const retailCode = user?.retail_code || '';
  const username = (user as any)?.username || (user as any)?.user_name || '';
  // Scope behaviors to Customer Master only
  const isCustomerMaster = !!(tableKey && (tableKey === (MASTER_TABLES as any).customer || tableKey === 'master_customer'));
  const isEmployeeMaster = !!(tableKey && (tableKey === (MASTER_TABLES as any).employee || tableKey === 'master_employee'));

  // Helper to resolve the Select value so the Select control shows the right option
  const resolveSelectValue = (f: any, val: any) => {
    const opts = f?.options || [];
    if (!opts || opts.length === 0) {
      // Debug logging for empty options
      if (f?.key === 'preferred_gender' || f?.key === 'category_id') {
        console.log(`[resolveSelectValue] No options available for ${f.key}`);
      }
      return val;
    }
    
    // Handle null/undefined values
    if (val === null || val === undefined || val === '') {
      return '';
    }
    
    // find exact value match (coerce to string for robust matching)
    let matched = opts.find((o: any) => String(o.value) === String(val));
    if (matched) return matched.value;
    
    // Try numeric matching (val as number matches option value as number)
    if (!isNaN(Number(val))) {
      matched = opts.find((o: any) => Number(o.value) === Number(val));
      if (matched) return matched.value;
    }
    
    // find by label match (case-insensitive)
    // For *_id selects, prefer value match only — avoid mapping names into payload
    if (!String(f?.key || '').endsWith('_id')) {
      matched = opts.find((o: any) => String(o.label).toLowerCase() === String(val).toLowerCase());
    }
    if (matched) return matched.value;
    
    // map 'Active'/'Inactive' logical values to numeric option values if present
    if (String(val).toLowerCase() === 'active') {
      const v1 = opts.find((o: any) => String(o.value) === '1' || o.value === 1);
      if (v1) return v1.value;
      const lab = opts.find((o: any) => String(o.label).toLowerCase() === 'active');
      if (lab) return lab.value;
    }
    if (String(val).toLowerCase() === 'inactive') {
      const v0 = opts.find((o: any) => String(o.value) === '0' || o.value === 0);
      if (v0) return v0.value;
      const lab = opts.find((o: any) => String(o.label).toLowerCase() === 'inactive');
      if (lab) return lab.value;
    }
    
    // Debug logging for unmatched values
    if (f?.key === 'preferred_gender' || f?.key === 'category_id') {
      console.log(`[resolveSelectValue] No match found for ${f.key}: "${val}" (type: ${typeof val}) in options:`, opts.map(o => ({ label: o.label, value: o.value, type: typeof o.value })));
    }
    
    // Return the original value if no match found
    return val;
  };

  // resolvedFormSchema holds formSchema with lookup options injected for selects
  const [resolvedFormSchema, setResolvedFormSchema] = React.useState<any[]>(formSchema || []);
  const [optionsLoading, setOptionsLoading] = React.useState(false);
  // Keep raw lookup rows for *_id selects so we can auto-map related fields (e.g., hsn_id -> tax_id)
  const [lookupRowsByBase, setLookupRowsByBase] = React.useState<Record<string, any[]>>({});
  // Keep raw rows per table for lookup-based selects (e.g., membership)
  const [lookupRowsByTable, setLookupRowsByTable] = React.useState<Record<string, any[]>>({});
  // Cache lookup data to avoid duplicate API calls
  const [cachedLookupData, setCachedLookupData] = React.useState<Record<string, any[]>>({});

  // Initialize resolved schema when formSchema prop changes
  React.useEffect(() => {
    setResolvedFormSchema(formSchema || []);
  }, [JSON.stringify(formSchema || [])]);

  // Populate options for select fields that are foreign-key like '<name>_id' when options are empty.
  // Do a grouped fetch per table (parallel) and then map results to fields — reduces sequential network calls.
  React.useEffect(() => {
    let mounted = true;
    const toLoadId = (formSchema || []).filter((f: any) => f.type === 'select' && (!f.options || f.options.length === 0) && f.key && f.key.endsWith('_id'));
    const toLoadLookup = (formSchema || []).filter((f: any) => f.type === 'select' && (!f.options || f.options.length === 0) && (f.lookup || f.lookupTable));
    if (!toLoadId.length && !toLoadLookup.length) return;

    // map base -> list of fields that reference it
    const baseToFields: Record<string, string[]> = {};
    toLoadId.forEach((f: any) => {
      const base = f.key.replace(/_id$/, '');
      baseToFields[base] = baseToFields[base] || [];
      baseToFields[base].push(f.key);
    });

    // lookup-based fields (e.g., membership)
    const lookupToFields: Record<string, string[]> = {};
    toLoadLookup.forEach((f: any) => {
      // prefer explicit lookupTable, otherwise map lookup alias via MASTER_TABLES
      const alias = String(f.lookup || f.lookupTable || '').trim();
      if (!alias) return;
      const tn = (MASTER_TABLES as any)[alias] || alias;
      if (!tn) return;
      lookupToFields[tn] = lookupToFields[tn] || [];
      lookupToFields[tn].push(f.key);
    });

    const tableNamesId = Object.keys(baseToFields).map((b) => (MASTER_TABLES as any)[b]).filter(Boolean);
    const tableNamesLookup = Object.keys(lookupToFields);
    const tableNames = Array.from(new Set([...tableNamesId, ...tableNamesLookup]));
    if (!tableNames.length) return;

  // Single read: request all tableNames in one call; backend returns mapping tableName->rows
  setOptionsLoading(true);
  DataService.readData(tableNames, accountCode, retailCode).then(async (res) => {
      if (!mounted) return;
      let dataMap = (res as any)?.data || {};
      // backend returns an array when a single table is requested; normalize to mapping
      if (Array.isArray(dataMap) && tableNames.length === 1) {
        const tname = tableNames[0];
        const m: Record<string, any[]> = {};
        m[tname] = dataMap;
        dataMap = m;
      }

      // Fallback logic removed - use authenticated DataService.readData for all data access

  // build options map for specific field keys
  const fieldOptionsMap: Record<string, any[]> = {};
  const rowsByBase: Record<string, any[]> = {};
  const rowsByTable: Record<string, any[]> = {};
      Object.keys(baseToFields).forEach((base) => {
        const tableName = (MASTER_TABLES as any)[base];
        const rows = dataMap[tableName] || [];
        rowsByBase[base] = rows;
        baseToFields[base].forEach((fieldKey) => {
          const options = rows.map((r: any, idx: number) => {
            const idField = fieldKey; // e.g., tax_id
            // determine value: prefer the explicit fk field; for tax_id enforce strict use of tax_id without falling back to generic id
            let rawValue: any;
            if (r[idField] !== undefined && r[idField] !== null) {
              rawValue = r[idField];
            } else if (idField === 'tax_id') {
              // do not fallback to generic id for tax selects
              rawValue = undefined;
            } else if (idField === 'hsn_id') {
              // for HSN, prefer hsn_id, fallback to id
              rawValue = r.hsn_id ?? r.id;
            } else {
              rawValue = (r.id !== undefined ? r.id : Object.values(r)[0]);
            }
            // choose a human label: prefer description, then name/hsn_code/payment_mode_name/category_name/etc, then fallback to the rawValue
            const label = (r.membership_name && String(r.membership_name).trim())
              || (r.variant_name && String(r.variant_name).trim())
              || (r.description && String(r.description).trim())
              || (r.name && String(r.name).trim())
              || (r.hsn_code && String(r.hsn_code).trim())
              || (r.hsn_name && String(r.hsn_name).trim())
              || (r.payment_mode_name && String(r.payment_mode_name).trim())
              || (r.category_name && String(r.category_name).trim())
              || (r.event_type_name && String(r.event_type_name).trim())
              || (rawValue !== undefined && rawValue !== null ? String(rawValue) : '');
            if (rawValue === undefined || rawValue === null || label === '') return null;
            return { label, value: String(rawValue), key: `${fieldKey}-${idx}-${String(rawValue)}` };
          });
          // filter out any nulls caused by strict tax_id enforcement
          fieldOptionsMap[fieldKey] = options.filter(Boolean);
        });
      });

      // Build options for lookup-based selects. If the target field key ends with '_id',
      // we will use the corresponding row's id as value; otherwise use the human label as value.
      Object.keys(lookupToFields).forEach((tableName) => {
        const rows = dataMap[tableName] || [];
        rowsByTable[tableName] = rows;
        lookupToFields[tableName].forEach((fieldKey) => {
          // Find the form field that uses this lookup to get any filter criteria
          const formField = (formSchema || []).find(f => f.key === fieldKey && (f.lookup || f.lookupTable));
          const lookupFilter = formField?.lookupFilter;
          
          // Apply lookup filter if specified
          const filteredRows = lookupFilter ? rows.filter((r: any) => {
            try {
              const matches = Object.keys(lookupFilter).every(filterKey => {
                const filterValue = lookupFilter[filterKey];
                const rowValue = r[filterKey];
                // Handle null/undefined values properly
                if (filterValue === null || filterValue === undefined) {
                  return rowValue === null || rowValue === undefined;
                }
                return String(rowValue).trim() === String(filterValue).trim();
              });
              return matches;
            } catch (error) {
              console.warn(`[MasterTemplate] Error filtering lookup row:`, error, r);
              return false;
            }
          }) : rows;
          
          // Debug logging for category filtering
          if (lookupFilter && tableName === 'master_category') {
            console.log(`[MasterTemplate] Filtered ${tableName} for field ${fieldKey}:`, {
              original: rows.length,
              filtered: filteredRows.length,
              filter: lookupFilter,
              sample: filteredRows.slice(0, 3).map(r => ({ id: r.category_id, name: r.category_name, type: r.category_type }))
            });
          }
          
          const options = filteredRows.map((r: any, idx: number) => {
            // Generic label resolution with membership-first preference
            const label = (
              (r.membership_name && String(r.membership_name).trim()) ||
              (r.variant_name && String(r.variant_name).trim()) ||
              (r.category_name && String(r.category_name).trim()) ||
              (r.name && String(r.name).trim()) ||
              (r.description && String(r.description).trim()) ||
              (r.title && String(r.title).trim()) ||
              (r.code && String(r.code).trim()) ||
              ''
            );
            if (!label) return null;
            // if the bound field is *_id (e.g., membership_id), use the row's id column as value
            if (/_id$/.test(fieldKey)) {
              // prefer the exact fk column on the row when present
              const idVal = r[fieldKey] ?? r.id ?? r[Object.keys(r).find(k => /_id$/.test(k)) || 'id'];
              if (idVal === undefined || idVal === null) return null;
              return { label, value: String(idVal), key: `${fieldKey}-${idx}-${String(idVal)}` };
            }
            // otherwise, store the label directly as value (useful for string-backed fields)
            return { label, value: label, key: `${fieldKey}-${idx}-${label}` };
          }).filter(Boolean);
          
          // Debug logging for category_id options
          if (fieldKey === 'category_id') {
            console.log(`[MasterTemplate] Generated options for ${fieldKey}:`, options);
          }
          
          fieldOptionsMap[fieldKey] = options as any[];
        });
      });
  setLookupRowsByBase(rowsByBase);
      setLookupRowsByTable(rowsByTable);
      // Cache lookup data to avoid duplicate API calls in enrichForeignKeyData
      setCachedLookupData(dataMap);
      if (Object.keys(fieldOptionsMap).length) {
        setResolvedFormSchema((prev) => (prev || []).map((f: any) => (fieldOptionsMap[f.key] ? { ...f, options: fieldOptionsMap[f.key] } : f)));
      }
      setOptionsLoading(false);
    }).catch(() => {
      // ignore lookup failures silently — leave selects empty
      setOptionsLoading(false);
    });

    return () => { mounted = false; };
  }, [JSON.stringify(formSchema || []), accountCode, retailCode]);

  // fetch when tableKey is provided and no explicit rowData passed
  React.useEffect(() => {
    if (!tableKey) return;
    let mounted = true;
    const fetchRows = async () => {
      try {
        const res = await DataService.readData([tableKey], accountCode, retailCode);
        if (!mounted) return;
        let raw = (res as any)?.data || [];
        
        // Auto-enrich foreign key fields with actual names for better display
        if (raw.length > 0) {
          // Prefer cached lookups; if cache not ready, fall back to live enrichment
          const hasCache = cachedLookupData && Object.keys(cachedLookupData).length > 0;
          const enrichedData = hasCache ? enrichForeignKeyDataCached(raw) : await enrichForeignKeyData(raw, accountCode, retailCode);
          raw = enrichedData;
        }
        
        // allow per-config normalize function
        const out = (mapFromDb && typeof mapFromDb === 'function') ? raw.map(mapFromDb) : raw;
        setFetchedRows(out || []);
      } catch (err) {
        console.error(`fetch ${tableKey}`, err);
        setFetchedRows([]);
      }
    };
    fetchRows();
    return () => { mounted = false; };
  }, [tableKey, accountCode, retailCode, mapFromDb]);

  // Function to enrich foreign key data using cached lookup data (avoids duplicate API calls)
  const enrichForeignKeyDataCached = (rows: any[]) => {
    if (!rows || rows.length === 0) return rows;
    
    try {
      // Use cached lookup data instead of making API calls
      const lookupMap = cachedLookupData;
      if (!lookupMap || Object.keys(lookupMap).length === 0) return rows;
      
      // Map foreign keys to their table names
      const tableMap: Record<string, string> = {
        'category_id': 'master_category',
        'hsn_id': 'master_hsn',
        'uom_id': 'master_uom',
        'tax_id': 'master_tax',
        'payment_id': 'master_paymode',
        'membership_id': 'master_membership',
        'variant_id': 'master_variants'
      };
      
      // Create lookup maps for each foreign key
      const lookups: Record<string, Map<string, string>> = {};
      
      Object.keys(tableMap).forEach(fk => {
        const tableName = tableMap[fk];
        if (tableName && lookupMap[tableName]) {
          const map = new Map<string, string>();
          lookupMap[tableName].forEach((item: any) => {
            const id = (fk === 'tax_id') ? item['tax_id'] : (item[fk] || item.id || Object.values(item)[0]);
            const name = (
              (item.hsn_description && String(item.hsn_description).trim()) ||
              (item.variant_name && String(item.variant_name).trim()) ||
              (item.description && String(item.description).trim()) ||
              (item.name && String(item.name).trim()) ||
              (item.hsn_code && String(item.hsn_code).trim()) ||
              (item.hsn_name && String(item.hsn_name).trim()) ||
              (item.payment_mode_name && String(item.payment_mode_name).trim()) ||
              (item.category_name && String(item.category_name).trim()) ||
              (item.membership_name && String(item.membership_name).trim()) ||
              String(id || '')
            );
            if (id && name && String(id).trim() && String(name).trim()) {
              map.set(String(id).trim(), String(name).trim());
            }
          });
          lookups[fk] = map;
        }
      });
      
      // Enrich rows with human-readable names
      return rows.map(row => {
        const enriched = { ...row };
        Object.keys(lookups).forEach(fk => {
          const map = lookups[fk];
          // Support common alias fields where schema uses a different FK column name.
          // Example: master_package stores tax FK as `taxid` instead of `tax_id`.
          const id = (fk === 'tax_id' && (row[fk] == null || row[fk] === '') && row.taxid != null)
            ? row.taxid
            : row[fk];
          if (id != null && id !== '' && map.has(String(id))) {
            const nameField = fk.replace('_id', '_name');
            enriched[nameField] = map.get(String(id));
          }
        });
        return enriched;
      });
    } catch (error) {
      console.warn('Failed to enrich foreign key data from cache:', error);
      return rows;
    }
  };

  // Function to enrich foreign key data with actual names
  const enrichForeignKeyData = async (rows: any[], accountCode: string, retailCode: string) => {
    if (!rows || rows.length === 0) return rows;
    
    try {
      // Identify foreign key fields from the data (fields ending with '_id')
      const sampleRow = rows[0];

      // Map foreign keys to their table names
      const tableMap: Record<string, string> = {
        'category_id': 'master_category',
        'hsn_id': 'master_hsn',
        'uom_id': 'master_uom',
        'tax_id': 'master_tax',
        'payment_id': 'master_paymode',
        'membership_id': 'master_membership',
        'variant_id': 'master_variants'
      };

      const foreignKeysSet = new Set<string>(Object.keys(sampleRow).filter(key => key.endsWith('_id')));

      // Support master tables that use legacy FK names without the *_id suffix.
      // Example: master_package uses `taxid` as the tax FK.
      if ((sampleRow as any)?.taxid != null && !foreignKeysSet.has('tax_id')) {
        foreignKeysSet.add('tax_id');
      }

      // also include known FK fields that sometimes appear without '_id' (e.g., 'hsn')
      const possibleFks = Object.keys(tableMap || {});
      possibleFks.forEach((fk) => {
        const base = fk.replace(/_id$/, '');
        if (!foreignKeysSet.has(fk) && sampleRow.hasOwnProperty(base)) {
          // treat base-name presence as if fk exists
          foreignKeysSet.add(fk);
        }
      });

      const foreignKeys = Array.from(foreignKeysSet);
      if (foreignKeys.length === 0) return rows;
      
      // Get unique table names to fetch
      const tablesToFetch = [...new Set(foreignKeys.map(fk => tableMap[fk]).filter(Boolean))];
      
      if (tablesToFetch.length === 0) return rows;
      
  // Fetch all related data
  const lookupData = await DataService.readData(tablesToFetch, accountCode, retailCode);
  let lookupMap = (lookupData as any)?.data || {};
      
      // Handle single table response
      if (Array.isArray(lookupMap) && tablesToFetch.length === 1) {
        const tempMap: Record<string, any[]> = {};
        tempMap[tablesToFetch[0]] = lookupMap;
        lookupMap = tempMap;
      }
      
      // Fallback logic removed - use authenticated DataService.readData for all data access

      // Create lookup maps for each foreign key
      const lookups: Record<string, Map<string, string>> = {};
      
      foreignKeys.forEach(fk => {
        const tableName = tableMap[fk];
        if (tableName && lookupMap[tableName]) {
          const map = new Map<string, string>();
          lookupMap[tableName].forEach((item: any) => {
            // Prefer strict fk for tax_id to avoid mismatches; otherwise fall back to generic id when needed
            const id = (fk === 'tax_id')
              ? item['tax_id']
              : (item[fk] || item.id || Object.values(item)[0]);
            // include common fields used for HSN and other masters (hsn_code/hsn_name)
            const name = (
              // Prefer human-readable description for HSN
              (item.hsn_description && String(item.hsn_description).trim()) ||
              (item.description && String(item.description).trim()) ||
              (item.membership_name && String(item.membership_name).trim()) ||
              (item.variant_name && String(item.variant_name).trim()) ||
              (item.hsn_name && String(item.hsn_name).trim()) ||
              (item.hsn_code && String(item.hsn_code).trim()) ||
              (item.category_name && String(item.category_name).trim()) ||
              (item.payment_mode_name && String(item.payment_mode_name).trim()) ||
              (item.name && String(item.name).trim()) ||
              (id !== undefined && id !== null ? String(id) : '')
            );
            if (id !== undefined && id !== null) {
              map.set(String(id), name);
            }
          });
          lookups[fk] = map;
        }
      });
      
      // Enrich the rows with lookup names
      return rows.map(row => {
        const enriched = { ...row };
        foreignKeys.forEach(fk => {
          // Support alias FK fields (e.g., taxid -> tax_id)
          const rawId = (fk === 'tax_id' && (row[fk] == null || row[fk] === '') && (row as any)?.taxid != null)
            ? (row as any).taxid
            : row[fk];
          if (lookups[fk] && rawId != null && rawId !== '') {
            const displayName = lookups[fk].get(String(rawId));
            if (displayName) {
              // Add the display name with a suffix to avoid conflicts
              enriched[fk.replace('_id', '_name')] = displayName;
            }
          }
        });
        return enriched;
      });
      
    } catch (error) {
      console.warn('Failed to enrich foreign key data:', error);
      return rows;
    }
  };

  // use light borders for the master template
  const borderClass = 'border-slate-200';

  // built-in form state for generated form (only used if leftPanel is not provided)
  const [formState, setFormState] = React.useState<Record<string, any>>(() => {
    const initial: Record<string, any> = {};
    (formSchema || []).forEach((f) => {
      let val;
      if (formInitialValues && formInitialValues[f.key] !== undefined) {
        val = formInitialValues[f.key];
      } else if (f.defaultValue !== undefined) {
        // Use defaultValue from field schema if provided
        val = f.defaultValue;
        } else if (f.key === 'status' || f.key === 'STATUS') {
          // Prefer an option value that represents Active if the select provides options
          if (f.options && Array.isArray(f.options) && f.options.length > 0) {
            const optActive = f.options.find((o: any) => {
              try {
                return String(o.label).toLowerCase() === 'active' || String(o.value) === '1' || o.value === 1;
              } catch (e) {
                return false;
              }
            });
            val = optActive ? optActive.value : f.options[0].value;
          } else {
            val = 'Active';
          }
        } else {
        val = '';
      }
      // normalize numeric status -> Active/Inactive for UI selects only when the select expects string labels
      if ((f.key === 'status' || f.key === 'STATUS') && (val === 1 || val === 0 || val === '1' || val === '0')) {
        if (f.options && Array.isArray(f.options) && f.options.some((o: any) => String(o.value).toLowerCase() === 'active' || String(o.label).toLowerCase() === 'active')) {
          val = (String(val) === '1') ? 'Active' : 'Inactive';
        }
      }
      initial[f.key] = val;
    });
    return initial;
  });

  // editing state: if set, form is in edit mode
  const [editing, setEditing] = React.useState<any | null>(null);
  // flag to prevent re-initialization effects from overriding reset
  const [isResetting, setIsResetting] = React.useState(false);

  // (validation removed per request)

  React.useEffect(() => {
    // Skip re-initialization if we're in the middle of a reset
    if (isResetting) return;
    
    // re-init if schema or initial values change, or when editing changes
    const initial: Record<string, any> = {};
    const source = editing || formInitialValues || {};
    const currentSchema = resolvedFormSchema.length > 0 ? resolvedFormSchema : (formSchema || []);
    
    currentSchema.forEach((f) => {
      let val;
      if (source[f.key] !== undefined) {
        val = source[f.key];
        // For select fields, resolve the value properly using available options
        if (f.type === 'select' && f.options && Array.isArray(f.options) && f.options.length > 0) {
          const originalVal = val;
          val = resolveSelectValue(f, val);
          // Debug logging for problematic fields
          if (f.key === 'preferred_gender' || f.key === 'category_id') {
            console.log(`[MasterTemplate] Resolving ${f.key}: ${originalVal} -> ${val}`, {
              options: f.options,
              hasEditing: !!editing
            });
          }
        }
        } else if (f.key === 'status' || f.key === 'STATUS') {
          // Prefer an option value that represents Active if the select provides options
          if (f.options && Array.isArray(f.options) && f.options.length > 0) {
            const optActive = f.options.find((o: any) => {
              try {
                return String(o.label).toLowerCase() === 'active' || String(o.value) === '1' || o.value === 1;
              } catch (e) {
                return false;
              }
            });
            val = optActive ? optActive.value : f.options[0].value;
          } else {
            val = 'Active';
          }
        } else {
        val = '';
      }
      // Special display normalization: show empty instead of 0 for membership card number
      if (f.key === 'membership_cardno' && (val === 0 || val === '0')) {
        val = '';
      }
      // normalize numeric status -> Active/Inactive for UI selects only when the select expects string labels
      if ((f.key === 'status' || f.key === 'STATUS') && (val === 1 || val === 0 || val === '1' || val === '0')) {
        if (f.options && Array.isArray(f.options) && f.options.some((o: any) => String(o.value).toLowerCase() === 'active' || String(o.label).toLowerCase() === 'active')) {
          val = (String(val) === '1') ? 'Active' : 'Inactive';
        }
      }
      initial[f.key] = val;
    });
    setFormState(initial);
  }, [JSON.stringify(formSchema || []), JSON.stringify(formInitialValues || {}), JSON.stringify(editing), JSON.stringify(resolvedFormSchema)]);

  // Re-initialize form state when resolved schema changes (options become available) and we're editing
  React.useEffect(() => {
    if (!editing || !resolvedFormSchema.length || optionsLoading) return;
    
    // Update form state for select fields that now have options
    setFormState(current => {
      const updated = { ...current };
      let hasChanges = false;
      
      resolvedFormSchema.forEach((f) => {
        if (f.type === 'select' && f.options && Array.isArray(f.options) && f.options.length > 0) {
          const rawValue = editing[f.key];
          if (rawValue !== undefined && rawValue !== null) {
            const resolvedValue = resolveSelectValue(f, rawValue);
            // Force update if current value is empty/blank but we have a valid resolved value
            const shouldUpdate = String(resolvedValue) !== String(current[f.key]) || 
                                ((!current[f.key] || current[f.key] === '') && resolvedValue);
            
            if (shouldUpdate) {
              // Debug logging for problematic fields
              if (f.key === 'preferred_gender' || f.key === 'category_id') {
                console.log(`[MasterTemplate] Re-resolving ${f.key}: ${rawValue} -> ${resolvedValue} (was: ${current[f.key]})`);
              }
              updated[f.key] = resolvedValue;
              hasChanges = true;
            }
          }
        }
      });
      
      return hasChanges ? updated : current;
    });
  }, [editing, resolvedFormSchema, optionsLoading]);

  // Additional effect to force form re-evaluation when options are loaded after editing is set
  React.useEffect(() => {
    if (!editing || optionsLoading) return;
    
    // Small delay to ensure all options are fully loaded
    const timer = setTimeout(() => {
      setFormState(current => {
        const updated = { ...current };
        let hasChanges = false;
        
        resolvedFormSchema.forEach((f) => {
          if (f.type === 'select' && f.options && Array.isArray(f.options) && f.options.length > 0) {
            const rawValue = editing[f.key];
            if (rawValue !== undefined && rawValue !== null) {
              const resolvedValue = resolveSelectValue(f, rawValue);
              // Update if current value doesn't match or is empty
              if (!current[f.key] || String(current[f.key]) !== String(resolvedValue)) {
                if (f.key === 'category_id') {
                  console.log(`[MasterTemplate] Force-resolving ${f.key}: ${rawValue} -> ${resolvedValue} (was: ${current[f.key]})`);
                }
                updated[f.key] = resolvedValue;
                hasChanges = true;
              }
            }
          }
        });
        
        return hasChanges ? updated : current;
      });
    }, 100);
    
    return () => clearTimeout(timer);
  }, [editing, resolvedFormSchema.length, optionsLoading]);

  // sensible default buttons for index-driven masters
  const defaultButtons = [
    { id: 'cancel', label: 'Reset', type: 'button' as const, variant: 'outline' },
    { id: 'submit', label: editing ? 'Update' : 'Submit', type: 'submit' as const, variant: 'default' },
  ];
  const effectiveButtons = (buttons && Array.isArray(buttons) && buttons.length > 0)
    ? buttons.map(b => b.id === 'submit' ? { ...b, label: editing ? 'Update' : b.label } : b)
    : defaultButtons;

  const handleFieldChange = (key: string, value: any) => {
    // Prevent membership_cardno updates during reset
    if (isResetting && key === 'membership_cardno') {
      return;
    }
    
    // Debug logging for category_id changes
    if (key === 'category_id') {
      console.log(`[MasterTemplate] Category field changed:`, { key, value, typeof: typeof value });
    }
    
    setFormState((s) => {
      const next = { ...s, [key]: value } as any;
      // Normalize membership_cardno: treat '0' as empty
      if (key === 'membership_cardno' && (value === '0' || value === 0)) {
        next[key] = '';
      }
      // Auto-map Tax when HSN changes (supports hsn_id→tax_id and hsn_code→tax)
      try {
        const hasHsnId = (resolvedFormSchema || []).some(f => f.key === 'hsn_id');
        const hasHsnCode = (resolvedFormSchema || []).some(f => f.key === 'hsn_code');
        const hasTaxId = (resolvedFormSchema || []).some(f => f.key === 'tax_id');
        const hasTaxStr = (resolvedFormSchema || []).some(f => f.key === 'tax');
        if ((hasHsnId || hasHsnCode) && (hasTaxId || hasTaxStr) && (key === 'hsn_id' || key === 'hsn_code')) {
          const hsnRows = lookupRowsByBase['hsn'] || lookupRowsByTable[(MASTER_TABLES as any)['hsn'] || 'master_hsn'] || [];
          const sel = hsnRows.find((r:any) => {
            const idMatch = String(r.hsn_id ?? r.id ?? '') === String(value);
            const codeMatch = String(r.hsn_code ?? r.code ?? r.name ?? r.hsn_name ?? r.description ?? '')
              .toLowerCase() === String(value ?? '').toLowerCase();
            return idMatch || codeMatch;
          });
          const mappedTaxId = sel ? (sel.tax_id ?? sel.taxId ?? sel.tax) : undefined;
          if (hasTaxId) {
            next['tax_id'] = (mappedTaxId != null && mappedTaxId !== '' && mappedTaxId !== '0') ? String(mappedTaxId) : '';
          }
          if (hasTaxStr) {
            // Map to tax label via master_tax lookup
            const taxRows = lookupRowsByBase['tax'] || lookupRowsByTable[(MASTER_TABLES as any)['tax'] || 'master_tax'] || [];
            let label = '';
            if (mappedTaxId != null && mappedTaxId !== '' && mappedTaxId !== '0') {
              const t = taxRows.find((tr:any) => String(tr.tax_id ?? tr.id ?? '') === String(mappedTaxId));
              label = t ? (t.description || t.name || t.title || '') : '';
            }
            next['tax'] = label;
          }
        }
        // Auto-fill membership price/discount when membership changes (support both membership and membership_id)
        const hasMembershipField = (resolvedFormSchema || []).some(f => f.key === 'membership' || f.key === 'membership_id');
        const hasPriceField = (resolvedFormSchema || []).some(f => f.key === 'membership_price');
        const hasDiscField = (resolvedFormSchema || []).some(f => f.key === 'membership_discount');
        if (hasMembershipField && (hasPriceField || hasDiscField) && (key === 'membership' || key === 'membership_id')) {
          const memTable = (MASTER_TABLES as any)['membership'] || 'master_membership';
          // Try rows by base (have ids) first; fallback to rows by table
          const rowsByBaseMem = lookupRowsByBase['membership'] || [];
          const rowsByTableMem = lookupRowsByTable[memTable] || [];
          let sel: any = null;
          if (key === 'membership_id') {
            const rows = rowsByBaseMem.length ? rowsByBaseMem : rowsByTableMem;
            sel = rows.find((r:any) => String(r.membership_id ?? r.id ?? r[Object.keys(r).find((k) => /_id$/.test(k)) || 'id']) === String(value));
          } else {
            const rows = rowsByTableMem.length ? rowsByTableMem : rowsByBaseMem;
            sel = rows.find((r:any) => String(r.membership_name || r.name || '').toLowerCase() === String(value || '').toLowerCase());
          }
          if (sel) {
            if (hasPriceField) next['membership_price'] = sel.price ?? '';
            if (hasDiscField) next['membership_discount'] = sel.discount_percent ?? '';
          } else {
            if (hasPriceField) next['membership_price'] = '';
            if (hasDiscField) next['membership_discount'] = '';
          }
        }
      } catch {}
      return next;
    });
    // validation removed
  };

  // When membership already has a value (e.g., editing), backfill price/discount once lookups are loaded
  React.useEffect(() => {
    const memIdVal = (formState as any)['membership_id'];
    const memNameVal = (formState as any)['membership'];
    if (!memIdVal && !memNameVal) return;
    const hasPriceField = (resolvedFormSchema || []).some(f => f.key === 'membership_price');
    const hasDiscField = (resolvedFormSchema || []).some(f => f.key === 'membership_discount');
    if (!hasPriceField && !hasDiscField) return;
    const memTable = (MASTER_TABLES as any)['membership'] || 'master_membership';
    const rowsByBaseMem = lookupRowsByBase['membership'] || [];
    const rowsByTableMem = lookupRowsByTable[memTable] || [];
    let sel: any = null;
    if (memIdVal) {
      const rows = rowsByBaseMem.length ? rowsByBaseMem : rowsByTableMem;
      sel = rows.find((r:any) => String(r.membership_id ?? r.id ?? r[Object.keys(r).find((k) => /_id$/.test(k)) || 'id']) === String(memIdVal));
    } else if (memNameVal) {
      const rows = rowsByTableMem.length ? rowsByTableMem : rowsByBaseMem;
      sel = rows.find((r:any) => String(r.membership_name || r.name || '').toLowerCase() === String(memNameVal || '').toLowerCase());
    }
    if (sel) {
      setFormState((s) => ({
        ...s,
        ...(hasPriceField ? { membership_price: sel.price ?? '' } : {}),
        ...(hasDiscField ? { membership_discount: sel.discount_percent ?? '' } : {}),
      }));
    }
  }, [
    JSON.stringify(lookupRowsByTable),
    JSON.stringify(lookupRowsByBase),
    JSON.stringify(resolvedFormSchema),
    JSON.stringify(formState && (formState as any)['membership_id']),
    JSON.stringify(formState && (formState as any)['membership'])
  ]);

  // Migration helper: if editing a row that has membership name but not membership_id, derive and set membership_id
  React.useEffect(() => {
    const memIdVal = (formState as any)['membership_id'];
    const memNameVal = (formState as any)['membership'];
    if (memIdVal || !memNameVal) return;
    const memTable = (MASTER_TABLES as any)['membership'] || 'master_membership';
    const rowsByBaseMem = lookupRowsByBase['membership'] || [];
    const rowsByTableMem = lookupRowsByTable[memTable] || [];
    const rows = rowsByBaseMem.length ? rowsByBaseMem : rowsByTableMem;
    if (!rows || rows.length === 0) return;
    const sel = rows.find((r:any) => String(r.membership_name || r.name || '').toLowerCase() === String(memNameVal || '').toLowerCase());
    if (sel) {
      const idVal = sel.membership_id ?? sel.id ?? sel[Object.keys(sel).find((k:string) => /_id$/.test(k)) || 'id'];
      if (idVal !== undefined && idVal !== null) {
        setFormState((s) => ({ ...s, membership_id: String(idVal) }));
      }
    }
  }, [
    JSON.stringify(lookupRowsByTable),
    JSON.stringify(lookupRowsByBase),
    JSON.stringify(formState && (formState as any)['membership'])
  ]);

  // default CRUD behavior when consumer doesn't provide onFormAction
  const performDefaultAction = async (actionId: string, payload: Record<string, any>) => {
    if (!tableKey) {
      console.warn('No tableKey provided to MasterTemplate for default actions');
      return;
    }

    if (actionId === 'cancel') {
      // Set reset flag to prevent other effects from interfering
      setIsResetting(true);
      
      // reset to blanks / initial values and exit edit mode
      setEditing(null);
      
      // Also ensure QR scanner UI state is closed immediately
      setScannerOpen(false);
      setScannerTargetKey(null);
      
      // First clear everything to avoid lingering controlled values
      const blankAll: Record<string, any> = {};
      (formSchema || []).forEach((f) => { blankAll[f.key] = ''; });
      setFormState(blankAll);

      // Then set canonical defaults after a small delay
      setTimeout(() => {
        const initial: Record<string, any> = {};
        (formSchema || []).forEach((f) => {
          if (f.key === 'status' || f.key === 'STATUS') {
            initial[f.key] = 'Active';
          } else if (f.defaultValue !== undefined) {
            initial[f.key] = f.defaultValue;
          } else {
            initial[f.key] = '';
          }
        });
        // Ensure Membership Card No is cleared on reset regardless of initial values
        initial['membership_cardno'] = '';
        setFormState(initial);
        
        // Clear reset flag after reset is complete
        setTimeout(() => {
          setIsResetting(false);
        }, 50);
      }, 10);
      
      return;
    }    if (actionId === 'submit') {
      // Defensive normalization: ensure status has a default value before validation
      const workingPayload: Record<string, any> = { ...payload };
      try {
        const statusField = (formSchema || []).find((f) => String(f.key).toLowerCase() === 'status');
        const currentStatus = workingPayload.status ?? workingPayload.STATUS;
        if (statusField && (currentStatus === undefined || currentStatus === null || String(currentStatus).trim() === '')) {
          if (statusField.options && Array.isArray(statusField.options) && statusField.options.length > 0) {
            const optActive = statusField.options.find((o: any) => {
              try { return String(o.label).toLowerCase() === 'active' || String(o.value).toLowerCase() === 'active' || String(o.value) === '1' || o.value === 1; } catch { return false; }
            });
            workingPayload.status = optActive ? optActive.value : statusField.options[0].value;
          } else {
            workingPayload.status = 'Active';
          }
        }
      } catch {}

      // Validate required fields
      const requiredFieldErrors: string[] = [];
      (formSchema || []).forEach((field) => {
        const v = (workingPayload as any)[field.key];
        const isEmpty = v === undefined || v === null || (typeof v === 'string' && String(v).trim() === '');
        if (field.required && isEmpty) {
          requiredFieldErrors.push(field.label || field.key);
        }
      });
      
      if (requiredFieldErrors.length > 0) {
        const errorMessage = `Please fill in the following required fields: ${requiredFieldErrors.join(', ')}`;
        toast({ 
          title: 'Validation', 
          description: errorMessage, 
          className: 'bg-yellow-50 border-yellow-200 text-yellow-800',
        });
        return;
      }

      // Phone-specific validation: enforce exactly 10 digits (Customer & Employee Master)
      if (isCustomerMaster || isEmployeeMaster) {
        const onlyDigits = (v: any) => String(v ?? '').replace(/\D/g, '');
        // Primary phone (support multiple key names)
        const primRaw = (workingPayload as any).phone ?? (workingPayload as any).primary_phone;
        const empPrimRaw = (workingPayload as any).Phoneno;
        const prim = onlyDigits(isEmployeeMaster ? empPrimRaw : primRaw);
        if (prim.length !== 10) {
          toast({
            title: 'Invalid Phone',
            description: 'Primary Phone must be exactly 10 digits',
            className: 'bg-red-50 border-red-200 text-red-700',
          });
          return;
        }
        // Alternate phone: if provided, must also be 10 digits
        const altRaw = (workingPayload as any).phone1 ?? (workingPayload as any).alternate_phone;
        const empAltRaw = (workingPayload as any).Alternative_phoneno;
        const alt = onlyDigits(isEmployeeMaster ? empAltRaw : altRaw);
        if (alt && alt.length > 0 && alt.length !== 10) {
          toast({
            title: 'Invalid Phone',
            description: 'Alternate Phone must be exactly 10 digits',
            className: 'bg-red-50 border-red-200 text-red-700',
          });
          return;
        }
      }

      try {
        // Debug logging for form state before processing
        console.log(`[MasterTemplate] Form state before submit:`, workingPayload);
        
        // Prevent duplicate customer primary phone on create (Customer Master only)
        if (!editing && tableKey && (tableKey === (MASTER_TABLES as any).customer || tableKey === 'master_customer')) {
          const rawPhone = (workingPayload as any).phone ?? (workingPayload as any).primary_phone;
          const phoneStr = rawPhone != null ? String(rawPhone).replace(/\D/g, '') : '';
          if (phoneStr) {
            try {
              const res = await DataService.readData([tableKey], accountCode, retailCode);
              let rows: any[] = [];
              const d = (res as any)?.data;
              if (Array.isArray(d)) rows = d; else if (d && Array.isArray(d[tableKey])) rows = d[tableKey];
              const exists = (rows || []).some((r: any) => {
                const rp = (r?.phone ?? r?.primary_phone ?? '').toString().replace(/\D/g, '');
                return rp && rp === phoneStr;
              });
              if (exists) {
                toast({
                  title: 'Duplicate',
                  description: 'Phone number already exists',
                  className: 'bg-red-50 border-red-200 text-red-700',
                });
                return;
              }
            } catch (e) {
              // On fetch failure, do not block, but log
              console.warn('[MasterTemplate] Duplicate phone check skipped due to read error', e);
            }
          }
        }

        // Prevent duplicate Membership Card No on create/update (Customer Master only)
        if (tableKey && (tableKey === (MASTER_TABLES as any).customer || tableKey === 'master_customer')) {
          const cardRaw = (workingPayload as any).membership_cardno;
          const cardVal = cardRaw != null ? String(cardRaw).trim() : '';
          // treat '0' or empty as non-value
          if (cardVal && cardVal !== '0') {
            try {
              const res = await DataService.readData([tableKey], accountCode, retailCode);
              let rows: any[] = [];
              const d = (res as any)?.data;
              if (Array.isArray(d)) rows = d; else if (d && Array.isArray(d[tableKey])) rows = d[tableKey];
              const existsOther = (rows || []).some((r: any) => {
                const rv = String(r?.membership_cardno ?? '').trim();
                // If editing, allow same record to keep its own card number
                if (editing) {
                  const rowId = r?.id ?? r?.customer_id ?? r?.ID ?? r?.CUSTOMER_ID;
                  const editingId = editing?.id ?? editing?.customer_id ?? editing?.ID ?? editing?.CUSTOMER_ID;
                  if (String(rowId || '') === String(editingId || '')) return false;
                }
                return rv && rv !== '0' && rv.toLowerCase() === cardVal.toLowerCase();
              });
              if (existsOther) {
                toast({
                  title: 'Duplicate',
                  description: 'Membership Card No already exists',
                  className: 'bg-red-50 border-red-200 text-red-700',
                });
                return;
              }
            } catch (e) {
              console.warn('[MasterTemplate] Duplicate membership card check skipped due to read error', e);
            }
          }
        }

        // build payload from form fields only, skipping readOnly/disabled fields
        let dbPayload: any = {};
        (formSchema || []).forEach((field) => {
          if (field.readOnly || field.disabled) return;
          if (workingPayload[field.key] !== undefined) dbPayload[field.key] = workingPayload[field.key];
        });

        // Sanitize phone fields in payload to 10-digit strings (Customer & Employee Master)
        if (isCustomerMaster || isEmployeeMaster) {
          const setDigits10 = (obj: any, keys: string[]) => {
            keys.forEach((k) => {
              if (obj.hasOwnProperty(k)) {
                const d = String(obj[k] ?? '').replace(/\D/g, '').slice(0, 10);
                obj[k] = d;
              }
            });
          };
          setDigits10(dbPayload, ['phone', 'primary_phone', 'phone1', 'alternate_phone', 'Phoneno', 'Alternative_phoneno']);
        }

        // Normalize date fields: ensure null (JSON null -> Python None) when empty
        const normalizeToNull = (v: any) =>
          v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null : v;

        const bday = normalizeToNull(dbPayload['birthday_date'] ?? (workingPayload as any)['birthday_date']);
        const annv = normalizeToNull(dbPayload['anniversary_date'] ?? (workingPayload as any)['anniversary_date']);

        // Apply to both lowercase and TitleCase keys for backend compatibility
        if ('birthday_date' in (dbPayload as any) || (workingPayload as any)['birthday_date'] !== undefined) {
          dbPayload['birthday_date'] = bday;
          dbPayload['Birthday_date'] = bday;
        }
        if ('anniversary_date' in (dbPayload as any) || (workingPayload as any)['anniversary_date'] !== undefined) {
          dbPayload['anniversary_date'] = annv;
          dbPayload['Anniversary_date'] = annv;
        }
        // Normalize membership_cardno before send: if '0' or empty, drop it
        if (dbPayload.hasOwnProperty('membership_cardno')) {
          const v = dbPayload['membership_cardno'];
          if (v === 0 || v === '0' || String(v).trim() === '') {
            delete dbPayload['membership_cardno'];
          }
        }

        // Map date fields to potential DB column variants to ensure updates apply
        // Some databases use 'Birthday_date'/'Anniversary_date' while UI uses lowercase keys.
        if (Object.prototype.hasOwnProperty.call(dbPayload, 'birthday_date')) {
          dbPayload['Birthday_date'] = dbPayload['birthday_date'];
        }
        if (Object.prototype.hasOwnProperty.call(dbPayload, 'anniversary_date')) {
          dbPayload['Anniversary_date'] = dbPayload['anniversary_date'];
        }
        
        // Resolve non-numeric category_id by mapping name -> id using cached lookup rows
        if (dbPayload.category_id !== undefined) {
          console.log(`[MasterTemplate] dbPayload category_id:`, { 
            original: payload.category_id, 
            processed: dbPayload.category_id, 
            type: typeof dbPayload.category_id 
          });
          const val = dbPayload.category_id;
          const isNumeric = typeof val === 'number' || (/^\d+$/.test(String(val)));
          if (!isNumeric && String(val).trim() !== '') {
            try {
              // Prefer base rows (have explicit *_id) then fallback to table rows
              const rowsByBaseCat = lookupRowsByBase['category'] || [];
              const rowsByTableCat = lookupRowsByTable[(MASTER_TABLES as any)['category'] || 'master_category'] || [];
              const rows = rowsByBaseCat.length ? rowsByBaseCat : rowsByTableCat;
              const match = rows.find((r:any) => {
                const name = r.category_name || r.name || r.title;
                return String(name || '').trim().toLowerCase() === String(val).trim().toLowerCase();
              });
              const idVal = match ? (match.category_id ?? match.id ?? match[Object.keys(match).find((k:string) => /_id$/.test(k)) || 'id']) : undefined;
              if (idVal !== undefined && idVal !== null) {
                dbPayload.category_id = String(idVal);
                console.log(`[MasterTemplate] Resolved category name -> id`, { name: val, id: idVal });
              } else {
                console.warn(`[MasterTemplate] Could not resolve category_id from name`, { name: val });
              }
            } catch (e) {
              console.warn(`[MasterTemplate] Error resolving category_id from name`, e);
            }
          }
        }

        const statusVal = dbPayload.status ?? dbPayload.STATUS ?? workingPayload.status ?? workingPayload.STATUS;
        if (statusVal !== undefined && statusVal !== null) {
          const num = (String(statusVal).toLowerCase() === 'active' || String(statusVal) === '1') ? 1 : 0;
          // Set both cases so tables using STATUS (uppercase) also get updated
          dbPayload.status = num;
          dbPayload.STATUS = num;
        }

        // Coerce boolean-like fields to numeric where backend expects 0/1
        // Expiry Applicable should be 0 or 1, not ''
        if (dbPayload.hasOwnProperty('expiry_applicable')) {
          const v = dbPayload.expiry_applicable;
          if (v === '' || v === null || v === undefined) {
            dbPayload.expiry_applicable = 0;
          } else {
            const s = String(v).trim().toLowerCase();
            dbPayload.expiry_applicable = (s === '1' || s === 'yes' || s === 'true') ? 1 : 0;
          }
        }

        Object.keys(dbPayload).forEach((k) => {
          if (k.endsWith('_id') && dbPayload[k] !== undefined && dbPayload[k] !== null) {
            const original = dbPayload[k];
            
            // Skip empty string values for ID fields - don't convert them to 0
            if (original === '' || original === 'Select Category' || original === 'Select') {
              delete dbPayload[k]; // Remove the field entirely if it's empty
              if (k === 'category_id') {
                console.log(`[MasterTemplate] Removed empty ${k}:`, { original });
              }
              return;
            }
            
            const n = Number(original);
            if (!Number.isNaN(n) && n > 0) { // Only accept positive numbers for IDs
              dbPayload[k] = n;
              // Debug logging for category_id conversion
              if (k === 'category_id') {
                console.log(`[MasterTemplate] Converted ${k}:`, { original, converted: n, isValid: !Number.isNaN(n) });
              }
            } else {
              // Invalid number or zero - remove the field
              delete dbPayload[k];
              if (k === 'category_id') {
                console.log(`[MasterTemplate] Removed invalid ${k}:`, { original, convertedNumber: n });
              }
            }
          }
        });

        // Remove non-ID label fields for FK columns when sending payload.
        // IMPORTANT: do not delete fields that are explicitly part of the form schema
        // (e.g., Category Master uses `category_name` as a real column).
        const schemaKeys = new Set((formSchema || []).map((f) => f.key));
        ['tax_name','category_name','unit_name','hsn_name','hsn_code','tax','category','unit'].forEach((labelKey) => {
          if (schemaKeys.has(labelKey)) return;
          if (Object.prototype.hasOwnProperty.call(dbPayload, labelKey)) {
            delete dbPayload[labelKey];
          }
        });

        // Allow consumer to remap payload keys/values just before submit
        try {
          if (typeof mapPayload === 'function') {
            dbPayload = mapPayload(dbPayload);
          }
        } catch (e) {
          console.warn('[MasterTemplate] mapPayload failed, proceeding with original payload', e);
        }

        const auto_generate = typeof autoGenerate !== 'undefined' ? autoGenerate : undefined;

        const resetForm = () => {
          setEditing(null);
          // First clear everything to avoid lingering controlled values
          const blankAll: Record<string, any> = {};
          (formSchema || []).forEach((f) => { blankAll[f.key] = ''; });
          setFormState(blankAll);

          // Then set canonical defaults
          const initial: Record<string, any> = {};
          (formSchema || []).forEach((f) => {
            if (f.key === 'status' || f.key === 'STATUS') {
              initial[f.key] = 'Active';
            } else if (f.defaultValue !== undefined) {
              initial[f.key] = f.defaultValue;
            } else {
              initial[f.key] = '';
            }
          });
          setFormState(initial);
          // Also ensure QR scanner UI state is closed
          setScannerOpen(false);
          setScannerTargetKey(null);
        };

        if (editing) {
          dbPayload.updated_by = username;
          if (editing.id !== undefined) dbPayload.id = editing.id;
          dbPayload.account_code = accountCode;
          dbPayload.retail_code = retailCode;
          await DataService.updateData(tableKey, dbPayload);
          const tUpd = toast({ title: 'Updated', description: `${tableTitle || leftTitle || 'Record'} saved.` });
          setTimeout(() => tUpd.dismiss(), 2000);
        } else {
          dbPayload = { ...dbPayload, account_code: accountCode, retail_code: retailCode };
          await DataService.createData(tableKey, dbPayload, auto_generate);
          const tNew = toast({ title: 'Created', description: `${tableTitle || leftTitle || 'Record'} added.` });
          setTimeout(() => tNew.dismiss(), 2000);
        }

        const res = await DataService.readData([tableKey], accountCode, retailCode);
        let raw = (res as any)?.data || [];
        if (raw.length > 0) {
          const enrichedData = await enrichForeignKeyData(raw, accountCode, retailCode);
          raw = enrichedData;
        }
        const out = (mapFromDb && typeof mapFromDb === 'function') ? raw.map(mapFromDb) : raw.map((r: any) => {
          let norm = 'Active';
          const rawStatus = r.status ?? r.STATUS ?? r.is_active ?? null;
          if (rawStatus === 0 || rawStatus === '0' || String(rawStatus).toLowerCase() === 'inactive') norm = 'Inactive';
          else if (rawStatus === 1 || rawStatus === '1' || String(rawStatus).toLowerCase() === 'active') norm = 'Active';
          return { ...r, status: norm, STATUS: norm, _statusNumber: rawStatus };
        });
        setFetchedRows(out || []);

        // If a details panel is open, refresh its selected row from the latest dataset
        // so newly saved fields (e.g., photo_url/document_url) show immediately.
        try {
          if (tableKey === 'master_employee' && selectedEmployee) {
            const selectedId = (editing && (editing as any).id) ?? (selectedEmployee as any).id;
            const nextSelected = (out || []).find((r: any) => r?.id === selectedId) || null;
            if (nextSelected) setSelectedEmployee(nextSelected);
          }
          if (tableKey === 'master_customer' && selectedCustomer) {
            const selectedId = (editing && (editing as any).id) ?? (selectedCustomer as any).id;
            const nextSelected = (out || []).find((r: any) => r?.id === selectedId) || null;
            if (nextSelected) setSelectedCustomer(nextSelected);
          }
        } catch (e) {
          // non-fatal
        }

        // Robustly reset form so fields like customer name, phones, and card no clear
        resetForm();
      } catch (err) {
        console.error(`save ${tableKey}`, err);
        // error toast removed per request
      }
    }
  };

  const handleAction = (id: string) => {
  if (id === 'cancel') setEditing(null);
    if (onFormAction) onFormAction(id, formState);
    else performDefaultAction(id, formState);
  };

  return (
    <div className="min-h-screen space-y-2 sm:space-y-3 p-2 sm:p-2">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-1 items-stretch">
        <div className="xl:col-span-4 xl:pr-2 xl:border-r xl:border-slate-100">

          <Card className={`h-full flex flex-col bg-white shadow-sm rounded-xl p-3 sm:p-4 ${borderClass} w-full overflow-visible`}>
            <CardHeader className={`px-3 py-1.5 border-b ${borderClass} bg-gradient-to-r from-indigo-50 to-blue-50` }>
              {leftTitle ? (
                <CardTitle className="text-sm sm:text-base font-semibold text-slate-800">{leftTitle}</CardTitle>
              ) : null}
            </CardHeader>
            <CardContent className="flex-1 p-2">
              {leftPanel ? leftPanel : (
                <form className="space-y-1.5 sm:space-y-2" onSubmit={(e) => { e.preventDefault(); handleAction('submit'); }}>
                  {/* Responsive two-column form grid; honors optional colSpan on fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 sm:gap-2">
                    {(resolvedFormSchema || []).map((f) => {
                      if (f.hidden) return null;
                      const idAttr = `field-${f.key}`;
                      const isPhoneField = f.key === 'phone' || f.key === 'phone1' || f.key === 'primary_phone' || f.key === 'alternate_phone' || f.key === 'Phoneno' || f.key === 'Alternative_phoneno';
                      return (
                        <div key={f.key} className={`space-y-1 ${f.colSpan === 2 ? 'md:col-span-2' : ''}`}>
                          {f.label ? (
                            <Label htmlFor={idAttr} className="text-sm font-medium text-slate-700">
                              {f.label}
                              {f.required && <span className="text-red-500 ml-1">*</span>}
                            </Label>
                          ) : null}
                          {f.type === 'select' ? (
                            <Select value={String(resolveSelectValue(f, formState[f.key]) ?? '')} onValueChange={(v) => handleFieldChange(f.key, v)} disabled={!!(f.disabled || f.readOnly)}>
                              <SelectTrigger id={idAttr} name={f.key} className={`h-8 text-sm w-full ${borderClass} rounded-lg bg-white border px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-200 overflow-visible`} disabled={!!(f.disabled || f.readOnly)} > 
                                <SelectValue placeholder={f.placeholder ?? 'Select'} />
                              </SelectTrigger>
                              <SelectContent>
                                {optionsLoading ? (
                                  <div className="p-3 text-sm text-slate-500">Loading options…</div>
                                ) : (
                                  (f.options || []).map((opt) => (
                                    <SelectItem key={opt.key || opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          ) : f.type === 'file' ? (
                            <div className="space-y-3">
                              <div className="flex items-center gap-2">
                                <input
                                  type="file"
                                  accept={f.accept || '*'}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                      handleFormFileUpload(f.key, file);
                                    }
                                  }}
                                  className="hidden"
                                  id={idAttr}
                                  disabled={!!(f.disabled || f.readOnly)}
                                />
                                <Button
                                  type="button"
                                  variant="outline"
                                  className="h-8 text-sm flex items-center gap-2 border border-gray-300 hover:border-gray-400"
                                  onClick={() => document.getElementById(idAttr)?.click()}
                                  disabled={!!(f.disabled || f.readOnly)}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                  </svg>
                                  Choose File
                                </Button>
                                {formState[f.key] && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 text-sm text-red-600 hover:text-red-700 hover:border-red-300"
                                    onClick={() => {
                                      handleFieldChange(f.key, '');
                                      setUploadUrls(prev => {
                                        const updated = { ...prev };
                                        delete updated[f.key];
                                        return updated;
                                      });
                                      setSelectedFiles(prev => {
                                        const updated = { ...prev };
                                        delete updated[f.key];
                                        return updated;
                                      });
                                    }}
                                    disabled={!!(f.disabled || f.readOnly)}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </Button>
                                )}
                              </div>
                              
                              {/* Show preview for images */}
                              {uploadUrls[f.key] && f.accept?.includes('image') && (
                                <div className="mt-2">
                                  <div className="relative inline-block">
                                    <img 
                                      src={uploadUrls[f.key]} 
                                      alt="Preview" 
                                      className="w-24 h-24 object-cover rounded-lg border-2 border-gray-200 shadow-sm cursor-pointer" 
                                      onClick={() => {
                                        const displayName = String(
                                          formState.employee_name ||
                                            formState.customer_name ||
                                            formState.name ||
                                            'Record'
                                        );
                                        setPreviewModal({
                                          isOpen: true,
                                          type: 'image',
                                          url: uploadUrls[f.key],
                                          title: `${displayName} - Profile Photo`,
                                        });
                                      }}
                                      title="Click to preview"
                                    />
                                    <div className="absolute -top-2 -right-2 bg-green-100 text-green-600 rounded-full p-1">
                                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                  </div>
                                  <p className="text-xs text-gray-500 mt-1">
                                    {selectedFiles[f.key]?.name}
                                  </p>
                                </div>
                              )}

                              {/* Show current uploaded image (from DB) */}
                              {!uploadUrls[f.key] && f.key === 'photo_url' && typeof formState[f.key] === 'string' && String(formState[f.key]).trim() !== '' && (
                                <div className="mt-2">
                                  <div
                                    className="relative inline-block cursor-pointer"
                                    onClick={() => {
                                      const displayName = String(
                                        formState.employee_name ||
                                          formState.customer_name ||
                                          formState.name ||
                                          'Record'
                                      );
                                      handleImagePreview(String(formState[f.key]), displayName);
                                    }}
                                    title="Click to preview"
                                  >
                                    <img
                                      src={buildAuthorizedFileUrl(String(formState[f.key]))}
                                      alt="Current"
                                      className="w-24 h-24 object-cover rounded-lg border-2 border-gray-200 shadow-sm"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                                      }}
                                    />
                                  </div>
                                  <p className="text-xs text-gray-500 mt-1">Current uploaded photo</p>
                                </div>
                              )}
                              
                              {/* Show file icon for documents */}
                              {formState[f.key] && !f.accept?.includes('image') && selectedFiles[f.key] && (
                                <div className="mt-2">
                                  <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border">
                                    <div className="flex-shrink-0">
                                      <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                                      </svg>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-gray-900 truncate">
                                        {selectedFiles[f.key].name}
                                      </p>
                                      <p className="text-xs text-gray-500">
                                        {(selectedFiles[f.key].size / 1024).toFixed(1)} KB
                                      </p>
                                    </div>
                                    <div className="flex-shrink-0">
                                      <div className="bg-green-100 text-green-600 rounded-full p-1">
                                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                        </svg>
                                      </div>
                                    </div>
                                    {typeof formState[f.key] === 'string' && String(formState[f.key]).trim() !== '' && (
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-8"
                                        onClick={() => {
                                          const displayName = String(
                                            formState.employee_name ||
                                              formState.customer_name ||
                                              formState.name ||
                                              'Record'
                                          );
                                          handleDocumentPreview(String(formState[f.key]), displayName);
                                        }}
                                      >
                                        Preview
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Show current uploaded document (from DB) */}
                              {f.key === 'document_url' && !selectedFiles[f.key] && typeof formState[f.key] === 'string' && String(formState[f.key]).trim() !== '' && (
                                <div className="mt-2">
                                  <div className="flex items-center justify-between gap-2 bg-blue-50 p-3 rounded-lg border border-blue-200">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-slate-900 truncate">
                                        {String(formState[f.key]).split('/').pop()}
                                      </p>
                                      <p className="text-xs text-slate-600">Uploaded document</p>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => {
                                        const displayName = String(
                                          formState.employee_name ||
                                            formState.customer_name ||
                                            formState.name ||
                                            'Record'
                                        );
                                        handleDocumentPreview(String(formState[f.key]), displayName);
                                      }}
                                    >
                                      Preview
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : f.type === 'textarea' ? (
                            <Textarea
                              id={idAttr}
                              name={f.key}
                              className={`text-sm w-full ${borderClass} rounded-lg bg-white border placeholder:text-slate-400 px-3 py-2 leading-normal focus:outline-none focus:ring-2 focus:ring-blue-200`}
                              placeholder={f.placeholder}
                              value={formState[f.key] ?? ''}
                              onChange={(e: any) => handleFieldChange(f.key, e.target.value)}
                              disabled={!!(f.disabled || f.readOnly)}
                              rows={3}
                            />
                          ) : (
                            <div className="relative w-full">
                              <Input
                                id={idAttr}
                                name={f.key}
                                className={`h-8 text-sm w-full ${borderClass} rounded-lg bg-white border placeholder:text-slate-400 px-2 py-1.5 leading-normal focus:outline-none focus:ring-2 focus:ring-blue-200 ${f.qrScan && !f.readOnly && !f.disabled ? 'pr-10' : ''}`}
                                type={isPhoneField ? 'tel' : (f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text'))}
                                placeholder={f.placeholder}
                                value={(f.key === 'membership_cardno' && (formState[f.key] === 0 || formState[f.key] === '0')) ? '' : (formState[f.key] ?? '')}
                                onChange={(e: any) => {
                                  const key = f.key;
                                  if (isPhoneField) {
                                    if (isCustomerMaster || isEmployeeMaster) {
                                      const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 10);
                                      handleFieldChange(key, digits);
                                    } else {
                                      // Allow any input outside Customer Master; do not force 10 digits
                                      handleFieldChange(key, e.target.value);
                                    }
                                  } else {
                                    handleFieldChange(key, e.target.value);
                                  }
                                }}
                                inputMode={isPhoneField && (isCustomerMaster || isEmployeeMaster) ? 'numeric' as any : undefined}
                                pattern={isPhoneField && (isCustomerMaster || isEmployeeMaster) ? "\\d*" : undefined}
                                maxLength={isPhoneField && (isCustomerMaster || isEmployeeMaster) ? 10 : undefined}
                                disabled={!!(f.disabled || f.readOnly)}
                              />
                              {f.qrScan && !f.readOnly && !f.disabled && (
                                <Button
                                  type="button"
                                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center"
                                  onClick={() => { setScannerTargetKey(f.key); setScannerOpen(true); }}
                                  title="Scan QR"
                                  aria-label="Scan QR"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
                                    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                                    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                                    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                                    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                                    <rect x="8" y="8" width="8" height="8" rx="1" />
                                  </svg>
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end justify-start space-y-2 sm:space-y-0 sm:space-x-2 mt-3 w-full min-h-[40px]">
                    {effectiveButtons.map((b) => {
                      const defaultVariant = b.id === 'cancel' ? 'outline' : (b.id === 'submit' ? 'default' : undefined);
                      const variant = (b.variant as any) || defaultVariant;
                      const colorClass = b.id === 'cancel'
                        ? 'border border-slate-200 text-slate-700 bg-white hover:bg-slate-50'
                        : b.id === 'submit'
                          ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700'
                          : b.id === 'delete'
                            ? 'bg-red-600 hover:bg-red-700 text-white'
                            : 'bg-white text-slate-700 hover:bg-slate-50';

                      const baseBtnClass = 'px-3 sm:px-4 py-1.5 w-full sm:min-w-[120px] sm:w-auto flex items-center justify-center gap-1.5 text-sm';

                      const defaultIcon = b.icon ? b.icon : (b.id === 'cancel' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : b.id === 'submit' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <path d="M5 12l4 4L19 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : null);

                      return (
                        <Button
                          key={b.id}
                          type={b.type || 'button'}
                          variant={variant}
                          size="lg"
                          className={`${baseBtnClass} ${colorClass} rounded-lg shadow-sm`} 
                          onClick={(e: any) => { e.preventDefault(); handleAction(b.id); }}
                        >
                          {defaultIcon ? <span className="inline-flex items-center">{defaultIcon}</span> : null}
                          <span>{b.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>

  <div className="xl:col-span-8 xl:pl-0">
          <div className={`space-y-4 h-full ${expanded ? 'fixed inset-4 sm:inset-6 z-[100] w-auto' : ''}`}>
            <Card className={`p-1 h-full flex flex-col bg-white shadow-sm rounded-xl ${borderClass} overflow-hidden`}>
              <CardHeader className={`px-3 sm:px-4 py-3 bg-gradient-to-r from-indigo-50 to-blue-50` }>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  {tableTitle ? (
                    <div className="text-sm sm:text-base font-semibold text-slate-800">{tableTitle}</div>
                  ) : null}
                  <div className="flex items-center gap-2 sm:ml-auto">
                    <div className="relative flex-1 sm:flex-none">
                      <input
                        value={quickFilter}
                        onChange={(e) => setQuickFilter(e.target.value)}
                        placeholder="Search..."
                        className="h-9 w-full sm:w-[200px] lg:w-[240px] rounded-lg border border-slate-200 bg-white px-3 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                      <svg className="w-4 h-4 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <circle cx="11" cy="11" r="8"></circle>
                        <path d="M21 21l-4.3-4.3"></path>
                      </svg>
                    </div>
                    <Button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="h-9 px-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg shadow-sm flex items-center"
                      title={expanded ? 'Minimize' : 'Expand'}
                    >
                      {expanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </Button>
                    <Button
                      type="button"
                      onClick={handleExport}
                      className="h-9 px-3 sm:px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-2"
                      title="Export to Excel"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Export</span>
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={handleFileSelected}
                    />
                    <Button
                      type="button"
                      onClick={handleUploadClick}
                      className="h-9 px-3 sm:px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-2"
                      title="Upload Excel/CSV"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4" aria-hidden>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <path d="M7 10l5-5 5 5" />
                        <path d="M12 15V5" />
                      </svg>
                      <span className="hidden sm:inline">Upload</span>
                    </Button>
                    {/* Inline tooltip with Excel upload steps */}
                    <div className="relative inline-block"
                         onMouseEnter={() => setShowUploadHelp(true)}
                         onMouseLeave={() => setShowUploadHelp(false)}>
                      <button
                        type="button"
                        className="h-9 w-9 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 shadow-sm flex items-center justify-center"
                        title="Excel upload steps"
                        aria-label="Excel upload guide"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 16v-4" />
                          <path d="M12 8h.01" />
                        </svg>
                      </button>
                      {showUploadHelp && (
                        <div className="absolute right-0 z-50 mt-2 w-[320px] sm:w-[360px] rounded-lg border border-slate-200 bg-white p-3 text-xs sm:text-sm shadow-lg">
                          <div className="font-semibold text-slate-900 mb-1">Excel Upload Guide</div>
                          <ul className="space-y-1 text-slate-700 list-disc pl-4">
                            <li>Export first to get the latest template.</li>
                            <li>Fill required columns; leave audit fields blank.</li>
                            <li>Use dropdown values for Category/HSN/Tax/Status.</li>
                            <li>HSN will auto-map Tax during upload.</li>
                            <li>For updates, include the respective master ID.</li>
                            <li>For new rows, leave ID empty; it auto-increments.</li>
                            <li>Save as .xlsx or .csv and click Upload.</li>
                            <li>Confirm in the popup to apply changes.</li>
                          </ul>
                        </div>
                      )}
                    </div>
                    {typeof onBack === 'function' && (
                      <Button
                        type="button"
                        onClick={onBack}
                        className="h-9 px-3 sm:px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm flex items-center gap-1"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-4 h-4"
                          aria-hidden
                        >
                          <path d="M15 6l-6 6 6 6" />
                        </svg>
                        <span className="hidden sm:inline">Back</span>
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-0 pt-3 pb-0 flex-1 overflow-hidden">
                <>
                <style>{`
                  .tmpl-ag .ag-root-wrapper { background: white; border-radius: 8px; }
                  .tmpl-ag .ag-header { background: transparent; border-bottom: 0; }
                  /* Match header and cell horizontal paddings so headers align with data */
                  .tmpl-ag .ag-header-cell { border-right: 0 !important; padding: 0 8px; }
                  @media (min-width: 640px) {
                    .tmpl-ag .ag-header-cell { padding: 0 14px; }
                  }
                  .tmpl-ag .ag-header-cell-label { font-weight: 600; color: #0f172a; display: flex; align-items: center; gap: 0; padding-right: 0; border-right: 0 !important; }
                  /* Remove extra spacing added for header icons/sort indicators to keep text flush */
                  .tmpl-ag .ag-header-cell-label .ag-header-icon { display: none !important; }
                  .tmpl-ag .ag-header-cell-text { margin: 0 !important; padding: 0 !important; font-size: 0.75rem; }
                  @media (min-width: 640px) {
                    .tmpl-ag .ag-header-cell-text { font-size: 0.875rem; }
                  }
                  /* Hide header column separator so it doesn't appear misaligned with body */
                  .tmpl-ag .ag-header-cell::after, .tmpl-ag .ag-header-cell-resize { display: none !important; }
                  .tmpl-ag .ag-header-cell::before, .tmpl-ag .ag-header-cell-label::before { display: none !important; }
                  .tmpl-ag .ag-row { border-bottom: 1px solid rgba(15,23,42,0.06); }
                  .tmpl-ag .ag-row-odd { background: rgba(15,23,42,0.012); }
                  .tmpl-ag .ag-row:hover { background: rgba(37,99,235,0.06); }
                  .tmpl-ag .ag-cell { padding: 5px 8px; color: #475569; font-size: 0.75rem; }
                  @media (min-width: 640px) {
                    .tmpl-ag .ag-cell { padding: 5px 14px; font-size: 0.875rem; }
                  }
                  /* Thin, modern scrollbars scoped to the grid only */
                  /* Ultra-thin custom scrollbars for table */
                  .tmpl-ag { scrollbar-width: none; scrollbar-color: rgba(15,23,42,0.22) transparent; }
                  .tmpl-ag::-webkit-scrollbar { width: 0.1px; height: 0.1px; }
                  .tmpl-ag::-webkit-scrollbar-thumb { background-color: rgba(15,23,42,0.22); border-radius: 0.5px; }
                  .tmpl-ag::-webkit-scrollbar-thumb:hover { background-color: rgba(15,23,42,0.36); }
                  .tmpl-ag::-webkit-scrollbar-track { background: transparent; }

                  /* Reduce AG Grid native scroll track sizes */
                  .tmpl-ag .ag-body-horizontal-scroll { height: 0.5px !important; }
                  .tmpl-ag .ag-body-vertical-scroll { width: 0.5px !important; }
                  .tmpl-ag .ag-center-cols-viewport { scrollbar-gutter: stable both-edges; }
                  .tmpl-ag .ag-body-horizontal-scroll .ag-horizontal-scroll-viewport { height: 0.5px !important; }
                  .tmpl-ag .ag-body-vertical-scroll .ag-vertical-scroll-viewport { width: 0.5px !important; }

                  /* Ensure inner AG Grid viewports also use thin scrollbars */
                  .tmpl-ag .ag-body-viewport,
                  .tmpl-ag .ag-center-cols-viewport,
                  .tmpl-ag .ag-body-horizontal-scroll,
                  .tmpl-ag .ag-body-vertical-scroll,
                  .tmpl-ag .ag-center-cols-clipper {
                    scrollbar-width: none;
                    scrollbar-color: rgba(15,23,42,0.22) transparent;
                  }
                  .tmpl-ag .ag-body-viewport::-webkit-scrollbar,
                  .tmpl-ag .ag-center-cols-viewport::-webkit-scrollbar,
                  .tmpl-ag .ag-body-horizontal-scroll::-webkit-scrollbar,
                  .tmpl-ag .ag-body-vertical-scroll::-webkit-scrollbar,
                  .tmpl-ag .ag-center-cols-clipper::-webkit-scrollbar { width: 0.1px; height: 0.1px; }
                  .tmpl-ag .ag-body-viewport::-webkit-scrollbar-thumb,
                  .tmpl-ag .ag-center-cols-viewport::-webkit-scrollbar-thumb,
                  .tmpl-ag .ag-body-horizontal-scroll::-webkit-scrollbar-thumb,
                  .tmpl-ag .ag-body-vertical-scroll::-webkit-scrollbar-thumb,
                  .tmpl-ag .ag-center-cols-clipper::-webkit-scrollbar-thumb { background: rgba(15,23,42,0.22); border-radius: 0.5px; }
                  .tmpl-ag .ag-body-viewport::-webkit-scrollbar-thumb:hover,
                  .tmpl-ag .ag-center-cols-viewport::-webkit-scrollbar-thumb:hover,
                  .tmpl-ag .ag-body-horizontal-scroll::-webkit-scrollbar-thumb:hover,
                  .tmpl-ag .ag-body-vertical-scroll::-webkit-scrollbar-thumb:hover,
                  .tmpl-ag .ag-center-cols-clipper::-webkit-scrollbar-thumb:hover { background: rgba(15,23,42,0.36); }
                `}</style>

                {isLoading ? (
                  <div className="tmpl-ag rounded-md h-80 p-6 bg-white border border-gray-100">
                    <div className="space-y-3">
                      {[0,1,2,3].map((i) => (
                        <div key={i} className="h-6 bg-gray-100 rounded animate-pulse w-full" />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="ag-theme-alpine tmpl-ag rounded-md h-full overflow-x-auto" style={{ width: '100%', minHeight: expanded ? '70vh' : 320 }}>
                    <AgGridReact
                      rowData={gridRowData}
                      columnDefs={gridColumnDefs}
                      pagination={true}
                      {...agGridExtra}
                      headerHeight={expanded ? 48 : 40}
                      rowHeight={expanded ? 52 : 44}
                      animateRows={true}
                      rowClassRules={{ 'ag-row-odd': (p: any) => p.node.rowIndex % 2 === 1 }}
                      suppressMovableColumns={true}
                      onRowClicked={(e: any) => {
                        // Set selected customer for details card (only for customer master)
                        if (isCustomerMaster) {
                          setSelectedCustomer(e.data);
                        }
                        if (isEmployeeMaster) {
                          setSelectedEmployee(e.data);
                        }
                      }}
                      onRowDoubleClicked={(e: any) => {
                        if (onRowDoubleClick) onRowDoubleClick(e.data);
                        
                        // Extract the original row data without enriched fields for editing
                        const rowData = { ...e.data };
                        
                        // Remove enriched name fields except those used directly in forms
                        // Keep common display fields like service_name, customer_name, employee_name, item_name, payment_mode_name, bank_name, account_holder_name, supplier_name, membership_name, and category_name
                        Object.keys(rowData).forEach(key => {
                          const isNameField = key.endsWith('_name');
                          const keepFields = new Set([
                            'service_name',
                            'customer_name',
                            'employee_name',
                            'item_name',
                            'product_name',
                            'payment_mode_name',
                            'bank_name',
                            'account_holder_name',
                            'supplier_name',
                            'membership_name',
                            'category_name',
                            // Keep package_name so it appears in edit form for Package Master
                            'package_name',
                          ]);
                          if (isNameField && !keepFields.has(key)) {
                            delete rowData[key];
                          }
                        });
                        
                        console.log('[MasterTemplate] Setting editing data:', rowData);
                        setEditing(rowData);
                      }}
                      defaultColDef={{ sortable: true, filter: true, resizable: true, minWidth: 100 }}
                      quickFilterText={quickFilter}
                    />
                  </div>
                )}
                </>
              </CardContent>
            </Card>
          </div>
        </div>
        
        {/* Customer Details Card */}
        {isCustomerMaster && selectedCustomer && (
          <div className="xl:col-span-12 mt-4">
            <Card className="p-4 bg-white shadow-sm rounded-xl border border-slate-200">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Customer Details</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      // Create PDF with customer details, image and document
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        const customerData = selectedCustomer;
                        const imageUrl = customerData.photo_url ? 
                          (customerData.photo_url.startsWith('/files/') ? `${API_BASE_URL}${customerData.photo_url}` : customerData.photo_url) : '';
                        const token = sessionStorage.getItem('access_token');
                        const authImageUrl = imageUrl && token ? `${imageUrl}${imageUrl.includes('?') ? '&' : '?'}token=${token}` : imageUrl;
                        
                        printWindow.document.write(`
                          <!DOCTYPE html>
                          <html>
                          <head>
                            <title>Customer Details - ${customerData.customer_name || 'N/A'}</title>
                            <style>
                              body { font-family: Arial, sans-serif; margin: 20px; }
                              .header { text-align: center; margin-bottom: 20px; }
                              .profile-img { width: 150px; height: 150px; object-fit: cover; border-radius: 50%; }
                              .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
                              .field { margin-bottom: 10px; }
                              .label { font-weight: bold; color: #666; }
                              .value { margin-top: 5px; }
                              @media print { body { margin: 0; } }
                            </style>
                          </head>
                          <body>
                            <div class="header">
                              ${authImageUrl ? `<img src="${authImageUrl}" class="profile-img" onerror="this.style.display='none'">` : ''}
                              <h1>${customerData.customer_name || 'N/A'}</h1>
                            </div>
                            <div class="details">
                              <div>
                                <h3>Contact Information</h3>
                                <div class="field"><div class="label">Primary Phone:</div><div class="value">${customerData.phone || 'N/A'}</div></div>
                                <div class="field"><div class="label">Alternate Phone:</div><div class="value">${customerData.phone1 || 'N/A'}</div></div>
                                <div class="field"><div class="label">Address:</div><div class="value">${customerData.address || 'N/A'}</div></div>
                                <div class="field"><div class="label">Email:</div><div class="value">${customerData.email || 'N/A'}</div></div>
                              </div>
                              <div>
                                <h3>Personal Information</h3>
                                <div class="field"><div class="label">Gender:</div><div class="value">${customerData.gender || 'N/A'}</div></div>
                                <div class="field"><div class="label">Birthday:</div><div class="value">${customerData.birthday_date || 'N/A'}</div></div>
                                <div class="field"><div class="label">Anniversary:</div><div class="value">${customerData.anniversary_date || 'N/A'}</div></div>
                                <div class="field"><div class="label">Membership:</div><div class="value">${customerData.membership_name || 'N/A'}</div></div>
                                <div class="field"><div class="label">Card Number:</div><div class="value">${customerData.membership_cardno || 'N/A'}</div></div>
                                <div class="field"><div class="label">GST Number:</div><div class="value">${customerData.gst_number || 'N/A'}</div></div>
                                <div class="field"><div class="label">Status:</div><div class="value">${customerData.status || 'N/A'}</div></div>
                              </div>
                            </div>
                            <script>
                              window.onload = function() {
                                setTimeout(function() {
                                  window.print();
                                  window.close();
                                }, 500);
                              };
                            </script>
                          </body>
                          </html>
                        `);
                        printWindow.document.close();
                      }
                    }}
                    className="flex items-center gap-1 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedCustomer(null)}
                    className="h-8 w-8 p-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>
              </div>
              
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Profile Section */}
                <div className="lg:col-span-1">
                  <div className="text-center">
                    {selectedCustomer.photo_url ? (
                      <img
                        src={(() => {
                          let imageUrl = selectedCustomer.photo_url.startsWith('/files/') ? `${API_BASE_URL}${selectedCustomer.photo_url}` : selectedCustomer.photo_url;
                          const token = sessionStorage.getItem('access_token');
                          if (token && imageUrl.includes('/files/')) {
                            const separator = imageUrl.includes('?') ? '&' : '?';
                            imageUrl = `${imageUrl}${separator}token=${token}`;
                          }
                          return imageUrl;
                        })()}
                        alt={selectedCustomer.customer_name || 'Customer'}
                        className="w-32 h-32 mx-auto rounded-full object-cover border-4 border-gray-200 shadow-lg cursor-pointer hover:shadow-xl transition-shadow duration-200"
                        onClick={() => handleImagePreview(selectedCustomer.photo_url, selectedCustomer.customer_name || 'Customer')}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik04NCA1NkM4NCA2Ny4wNDU3IDc1LjA0NTcgNzYgNjQgNzZDNTIuOTU0MyA3NiA0NCA2Ny4wNDU3IDQ0IDU2QzQ0IDQ0Ljk1NDMgNTIuOTU0MyAzNiA2NCAzNkM3NS4wNDU3IDM2IDg0IDQ0Ljk1NDMgODQgNTZaIiBmaWxsPSIjOUM5Q0E0Ii8+CjxwYXRoIGQ9Ik0yMCA5NkMyMCA4NC45NTQzIDI4Ljk1NDMgNzYgNDAgNzZIODhDOTkuMDQ1NyA3NiAxMDggODQuOTU0MyAxMDggOTZWMTEySDE2VjEwNEgyMFY5NloiIGZpbGw9IiM5QzlDQTQiLz4KPC9zdmc+';
                        }}
                      />
                    ) : (
                      <div className="w-32 h-32 mx-auto rounded-full bg-gray-200 flex items-center justify-center border-4 border-gray-300">
                        <svg className="w-16 h-16 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                    )}
                    <h4 className="mt-4 text-xl font-bold text-gray-900">
                      {selectedCustomer.customer_name || 'N/A'}
                    </h4>
                    
                    {/* Document */}
                    {selectedCustomer.document_url && (
                      <div className="mt-4">
                        <div 
                          className="bg-blue-50 p-3 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                          onClick={() => handleDocumentPreview(selectedCustomer.document_url, selectedCustomer.customer_name || 'Customer')}
                        >
                          <div className="flex items-center gap-2 justify-center">
                            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-blue-800">Document Available</span>
                          </div>
                          <p className="text-xs text-blue-600 mt-1 text-center">
                            Click to preview
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Details Section */}
                <div className="lg:col-span-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Contact Information */}
                    <div className="space-y-4">
                      <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-200 pb-2">
                        Contact Information
                      </h5>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Primary Phone</p>
                            <p className="font-medium">{selectedCustomer.phone || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Alternate Phone</p>
                            <p className="font-medium">{selectedCustomer.phone1 || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.207" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Email</p>
                            <p className="font-medium">{selectedCustomer.email || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Address</p>
                            <p className="font-medium">{selectedCustomer.address || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Personal Information */}
                    <div className="space-y-4">
                      <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-200 pb-2">
                        Personal Information
                      </h5>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Gender</p>
                            <p className="font-medium">{selectedCustomer.gender || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Membership</p>
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {selectedCustomer.membership_name || 'N/A'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Card Number</p>
                            <p className="font-medium font-mono">{selectedCustomer.membership_cardno || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Birthday</p>
                            <p className="font-medium">{selectedCustomer.birthday_date || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Anniversary</p>
                            <p className="font-medium">{selectedCustomer.anniversary_date || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">GST Number</p>
                            <p className="font-medium font-mono">{selectedCustomer.gst_number || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Status</p>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              selectedCustomer.status === 'Active' || selectedCustomer.status === 1 || selectedCustomer.status === '1'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {selectedCustomer.status === 1 || selectedCustomer.status === '1' ? 'Active' : 
                               selectedCustomer.status === 0 || selectedCustomer.status === '0' ? 'Inactive' :
                               selectedCustomer.status || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* Employee Details Card */}
        {isEmployeeMaster && selectedEmployee && (
          <div className="xl:col-span-12 mt-4">
            <Card className="p-4 bg-white shadow-sm rounded-xl border border-slate-200">
              <div className="flex items-start justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Employee Details</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const printWindow = window.open('', '_blank');
                      if (printWindow) {
                        const employeeData = selectedEmployee;
                        const imageUrl = employeeData.photo_url ? buildAuthorizedFileUrl(String(employeeData.photo_url)) : '';
                        printWindow.document.write(`
                          <!DOCTYPE html>
                          <html>
                          <head>
                            <title>Employee Details - ${employeeData.employee_name || employeeData.name || 'N/A'}</title>
                            <style>
                              body { font-family: Arial, sans-serif; margin: 20px; }
                              .header { text-align: center; margin-bottom: 20px; }
                              .profile-img { width: 150px; height: 150px; object-fit: cover; border-radius: 50%; }
                              .details { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
                              .field { margin-bottom: 10px; }
                              .label { font-weight: bold; color: #666; }
                              .value { margin-top: 5px; }
                              @media print { body { margin: 0; } }
                            </style>
                          </head>
                          <body>
                            <div class="header">
                              ${imageUrl ? `<img src="${imageUrl}" class="profile-img" onerror="this.style.display='none'">` : ''}
                              <h1>${employeeData.employee_name || employeeData.name || 'N/A'}</h1>
                              <div style="color:#666; margin-top:4px;">Employee ID: ${employeeData.employee_id || employeeData.id || 'N/A'}</div>
                            </div>
                            <div class="details">
                              <div>
                                <h3>Contact Information</h3>
                                <div class="field"><div class="label">Phone:</div><div class="value">${employeeData.Phoneno || employeeData.phone || 'N/A'}</div></div>
                                <div class="field"><div class="label">Alternative Phone:</div><div class="value">${employeeData.Alternative_phoneno || employeeData.phone1 || 'N/A'}</div></div>
                                <div class="field"><div class="label">Address:</div><div class="value">${employeeData.address || 'N/A'}</div></div>
                              </div>
                              <div>
                                <h3>Employment Information</h3>
                                <div class="field"><div class="label">Gender:</div><div class="value">${employeeData.gender || 'N/A'}</div></div>
                                <div class="field"><div class="label">Designation:</div><div class="value">${employeeData.designation || 'N/A'}</div></div>
                                <div class="field"><div class="label">Skill Level:</div><div class="value">${employeeData.skill_level || 'N/A'}</div></div>
                                <div class="field"><div class="label">Extra Charges (%):</div><div class="value">${employeeData.price_markup_percent ?? 'N/A'}</div></div>
                                <div class="field"><div class="label">Joining Date:</div><div class="value">${employeeData.Joining_Date || 'N/A'}</div></div>
                                <div class="field"><div class="label">Status:</div><div class="value">${employeeData.status ?? 'N/A'}</div></div>
                              </div>
                            </div>
                            <script>
                              window.onload = function() {
                                setTimeout(function() {
                                  window.print();
                                  window.close();
                                }, 500);
                              };
                            </script>
                          </body>
                          </html>
                        `);
                        printWindow.document.close();
                      }
                    }}
                    className="flex items-center gap-1 text-sm"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    Download
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedEmployee(null)}
                    className="h-8 w-8 p-0"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Profile Section */}
                <div className="lg:col-span-1">
                  <div className="text-center">
                    {selectedEmployee.photo_url ? (
                      <img
                        src={buildAuthorizedFileUrl(String(selectedEmployee.photo_url))}
                        alt={selectedEmployee.employee_name || selectedEmployee.name || 'Employee'}
                        className="w-32 h-32 mx-auto rounded-full object-cover border-4 border-gray-200 shadow-lg cursor-pointer hover:shadow-xl transition-shadow duration-200"
                        onClick={() => handleImagePreview(String(selectedEmployee.photo_url), String(selectedEmployee.employee_name || selectedEmployee.name || 'Employee'))}
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik04NCA1NkM4NCA2Ny4wNDU3IDc1LjA0NTcgNzYgNjQgNzZDNTIuOTU0MyA3NiA0NCA2Ny4wNDU3IDQ0IDU2QzQ0IDQ0Ljk1NDMgNTIuOTU0MyAzNiA2NCAzNkM3NS4wNDU3IDM2IDg0IDQ0Ljk1NDMgODQgNTZaIiBmaWxsPSIjOUM5Q0E0Ii8+CjxwYXRoIGQ9Ik0yMCA5NkMyMCA4NC45NTQzIDI4Ljk1NDMgNzYgNDAgNzZIODhDOTkuMDQ1NyA3NiAxMDggODQuOTU0MyAxMDggOTZWMTEySDE2VjEwNEgyMFY5NloiIGZpbGw9IiM5QzlDQTQiLz4KPC9zdmc+';
                        }}
                      />
                    ) : (
                      <div className="w-32 h-32 mx-auto rounded-full bg-gray-200 flex items-center justify-center border-4 border-gray-300">
                        <svg className="w-16 h-16 text-gray-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                    )}
                    <h4 className="mt-4 text-xl font-bold text-gray-900">
                      {selectedEmployee.employee_name || selectedEmployee.name || 'N/A'}
                    </h4>
                    <p className="text-sm text-gray-500">ID: {selectedEmployee.employee_id || selectedEmployee.id || 'N/A'}</p>

                    {/* Document */}
                    {selectedEmployee.document_url && (
                      <div className="mt-4">
                        <div
                          className="bg-blue-50 p-3 rounded-lg border border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors duration-200"
                          onClick={() => handleDocumentPreview(String(selectedEmployee.document_url), String(selectedEmployee.employee_name || selectedEmployee.name || 'Employee'))}
                        >
                          <div className="flex items-center gap-2 justify-center">
                            <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                            </svg>
                            <span className="text-sm font-medium text-blue-800">Document Available</span>
                          </div>
                          <p className="text-xs text-blue-600 mt-1 text-center">Click to preview</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Details Section */}
                <div className="lg:col-span-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Contact Information */}
                    <div className="space-y-4">
                      <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-200 pb-2">
                        Contact Information
                      </h5>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Phone</p>
                            <p className="font-medium">{selectedEmployee.Phoneno || selectedEmployee.phone || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Alternative Phone</p>
                            <p className="font-medium">{selectedEmployee.Alternative_phoneno || selectedEmployee.phone1 || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Address</p>
                            <p className="font-medium">{selectedEmployee.address || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Employment Information */}
                    <div className="space-y-4">
                      <h5 className="text-sm font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-200 pb-2">
                        Employment Information
                      </h5>
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Gender</p>
                            <p className="font-medium">{selectedEmployee.gender || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Designation</p>
                            <p className="font-medium">{selectedEmployee.designation || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Skill Level</p>
                            <p className="font-medium">{selectedEmployee.skill_level || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-10V6m0 12v-2m0 0c-1.657 0-3-.895-3-2m3 2c1.657 0 3-.895 3-2m-3-10c1.657 0 3 .895 3 2m-6 0c0-1.105 1.343-2 3-2" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Extra Charges (%)</p>
                            <p className="font-medium">{selectedEmployee.price_markup_percent ?? 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Joining Date</p>
                            <p className="font-medium">{selectedEmployee.Joining_Date || 'N/A'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div>
                            <p className="text-sm text-gray-500">Status</p>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              selectedEmployee.status === 'Active' || selectedEmployee.status === 1 || selectedEmployee.status === '1'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}>
                              {selectedEmployee.status === 1 || selectedEmployee.status === '1' ? 'Active' :
                               selectedEmployee.status === 0 || selectedEmployee.status === '0' ? 'Inactive' :
                               selectedEmployee.status || 'Unknown'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
        {expanded && (
          <div className="fixed inset-0 z-[90] bg-black/30" onClick={() => setExpanded(false)} />
        )}
      {/* Upload confirmation modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setConfirmOpen(false); setPendingUploadRows([]); setPendingFileName(''); if (fileInputRef.current) fileInputRef.current.value=''; }} />
          <div className="relative bg-white rounded-xl shadow-xl w-[92vw] sm:w-[480px] p-4 border border-slate-200">
            <div className="text-base font-semibold text-slate-900 mb-2">Confirm Upload</div>
            <div className="text-sm text-slate-700 mb-4">
              Found <span className="font-semibold">{Array.isArray(pendingUploadRows) ? pendingUploadRows.length : 0}</span> rows in <span className="font-semibold">{pendingFileName}</span>.<br/>
              Do you want to proceed with upload and apply changes?
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                onClick={() => { setConfirmOpen(false); setPendingUploadRows([]); setPendingFileName(''); if (fileInputRef.current) fileInputRef.current.value=''; toast({ title: 'Upload Cancelled', description: 'No changes were applied.' }); }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="h-9 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={processConfirmedUpload}
              >
                Proceed
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Preview Modal */}
      {previewModal.isOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/80" onClick={closePreviewModal} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden border border-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-white">
              <h3 className="text-lg font-semibold text-gray-900">{previewModal.title}</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={closePreviewModal}
                className="h-8 w-8 p-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>
            
            {/* Modal Content */}
            <div className="p-4 bg-gray-50 max-h-[80vh] overflow-auto">
              {previewModal.type === 'image' ? (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <img
                      src={previewModal.url}
                      alt={previewModal.title}
                      className="max-w-full max-h-[70vh] object-contain rounded-lg shadow-lg"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAwIiBoZWlnaHQ9IjUwMCIgdmlld0JveD0iMCAwIDUwMCA1MDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSI1MDAiIGhlaWdodD0iNTAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0yNTAgMjAwQzI5MS40MjEgMjAwIDMyNSAyMzMuNTc5IDMyNSAyNzVDMzI1IDMxNi40MjEgMjkxLjQyMSAzNTAgMjUwIDM1MEMyMDguNTc5IDM1MCAxNzUgMzE2LjQyMSAxNzUgMjc1QzE3NSAyMzMuNTc5IDIwOC41NzkgMjAwIDI1MCAyMDBaIiBmaWxsPSIjOUM5Q0E0Ii8+CjxwYXRoIGQ9Ik0xMDAgNDAwQzEwMCAzNjcuOTA5IDEyNy45MDkgMzQwIDE2MCAzNDBIMzQwQzM3Mi4wOTEgMzQwIDQwMCAzNjcuOTA5IDQwMCA0MDBWNDCMTY1MCBNMTAwIDQ1MEgxMDBWNDAwWiIgZmlsbD0iIzlDOUNBNCIvPgo8L3N2Zz4K';
                      }}
                    />
                  </div>
                  
                  {/* Download button for images */}
                  <div className="flex justify-center">
                    <Button
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = previewModal.url;
                        link.download = previewModal.title.replace(/[^a-zA-Z0-9]/g, '_') || 'image';
                        link.target = '_blank';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      Download
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="text-center">
                    <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-800 px-3 py-2 rounded-lg">
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                      </svg>
                      <span className="font-medium">Document Preview</span>
                    </div>
                  </div>
                  
                  {/* Document Iframe or Download Link */}
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    {previewModal.url.toLowerCase().includes('.pdf') ? (
                      <iframe
                        src={`${previewModal.url}#view=FitH&toolbar=0&navpanes=0`}
                        className="w-full h-96 border-0"
                        title="Document Preview"
                        sandbox="allow-same-origin allow-scripts"
                        onLoad={() => {
                          console.log('PDF loaded successfully');
                        }}
                        onError={() => {
                          console.log('PDF iframe failed to load');
                        }}
                      />
                    ) : (
                      <div className="p-8 text-center space-y-4">
                        <svg className="w-16 h-16 mx-auto text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                        </svg>
                        <div>
                          <p className="text-sm text-gray-600 mb-4">
                            This document type cannot be previewed directly.
                          </p>
                          <Button
                            onClick={() => window.open(previewModal.url, '_blank')}
                            className="bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            Open in New Tab
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-center">
                    <Button
                      onClick={() => {
                        // Create a download link with authentication
                        const link = document.createElement('a');
                        link.href = previewModal.url;
                        // Extract filename from URL or use title
                        const urlParts = previewModal.url.split('/');
                        const filename = urlParts[urlParts.length - 1].split('?')[0] || previewModal.title.replace(/[^a-zA-Z0-9]/g, '_');
                        link.download = filename;
                        link.target = '_blank';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      Download
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      
      {/* QR Scanner Dialog */}
      <QrScannerDialog
        open={scannerOpen}
        onClose={() => { setScannerOpen(false); setScannerTargetKey(null); }}
        onDetected={(code: string) => {
          if (scannerTargetKey) {
            handleFieldChange(scannerTargetKey, code);
          }
          setScannerOpen(false);
          setScannerTargetKey(null);
        }}
      />
    </div>
  );
}

// intentionally do not export any domain-specific defaults from the neutral template
