import { Users, Building2, Settings, Percent, CreditCard, Calendar, Clock, Package2, Ruler, Building, Hash, Tag } from 'lucide-react';
import { MASTER_TABLES } from '@/services/masterTables';
import { TIME_OPTIONS } from './timeOptions';

// Minimal master configs to drive MasterTemplate from index page.
// Expand each config with full formSchema/columnDefs as required.
export const MASTER_CONFIGS: any[] = [
  // Customer Master (from CustomerMaster.tsx)
  {
    key: 'customer',
    title: 'Customer Master',
    tableKey: MASTER_TABLES.customer,
    icon: Users,
    description: 'Maintain customer database and contact information',
    tableTitle: 'Customer List',
    pageSize: 15,
    columnDefs: [
      { field: 'customer_id', headerName: 'Customer ID', width: 120 },
      { field: 'customer_name', headerName: 'Customer Name', flex: 1 },
      { field: 'phone', headerName: 'Phone', width: 140 },
      { field: 'gender', headerName: 'Gender', width: 120 },
      {
        field: 'membership_name',
        headerName: 'Membership',
        width: 160,
        valueGetter: (params) => {
          const d = params?.data || {};
          const name = (
            d?.membership_name ||
            (d?.membership && (d.membership.membership_name || d.membership.name)) ||
            ''
          );
          if (name) return name;
          const id = d?.membership_id;
          return (id === null || id === undefined || id === '' || id === 0 || id === '0')
            ? 'None'
            : `ID ${id}`;
        },
        cellClass: (params: any) => {
          const val = String(params?.value ?? '').trim();
          const isNone = val.toLowerCase() === 'none' || val === '';
          return isNone ? 'font-medium' : '';
        },
        cellStyle: (params: any) => {
          const val = String(params?.value ?? '').trim();
          const isNone = val.toLowerCase() === 'none' || val === '';
          return isNone ? { color: '#dc2626', fontWeight: 600 } : undefined;
        }
      },
      { field: 'status', headerName: 'Status', width: 140 },
    ],
    formSchema: [
    { key: 'customer_name', label: 'Customer Name', type: 'text', placeholder: 'Customer Name', colSpan: 2, required: true },
    { key: 'phone', label: 'Primary Phone', type: 'text', placeholder: 'Primary Phone', required: true },
    { key: 'phone1', label: 'Alternate Phone', type: 'text', placeholder: 'Alternate Phone' },
   {
  key: 'gender',
  label: 'Gender',
  type: 'select',
  options: [
    { label: 'Male', value: 'Male' },
    { label: 'Female', value: 'Female' },
    { label: 'Other', value: 'Other' }
  ],
  placeholder: 'Select Gender',
  required: true
},
  { key: 'membership_id', label: 'Membership', type: 'select', options: [], placeholder: 'Select Membership', lookup: 'membership' },
  { key: 'membership_cardno', label: 'Membership Card No', type: 'text', placeholder: 'Enter card number', qrScan: true },
      { key: 'birthday_date', label: 'Birthday Date', type: 'date', placeholder: '' },
      { key: 'anniversary_date', label: 'Anniversary Date', type: 'date', placeholder: '' },
      { key: 'address', label: 'Address', type: 'text', placeholder: 'Address', colSpan: 2 },
      { key: 'status', label: 'Status', type: 'select', options: [{ label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' }], placeholder: 'Active', required: true },
    ],
   autoGenerate: { column: 'customer_id', strategy: 'max+1' },
  },

  // Package Master
  {
    key: 'package',
    title: 'Package Master',
    tableKey: MASTER_TABLES.package,
    icon: Package2,
    description: 'Create and manage service packages',
    tableTitle: 'Packages',
    pageSize: 20,
    columnDefs: [
      { field: 'package_id', headerName: 'Package ID', width: 130 },
      { field: 'package_name', headerName: 'Package Name', flex: 1 },
      {
        field: 'display_order',
        headerName: 'Display Order',
        width: 140,
        valueGetter: (params) => {
          const d = params?.data || {};
          return d?.display_order ?? d?.displayOrder ?? d?.displayorder ?? '';
        }
      },
      { field: 'package_price', headerName: 'Price', width: 120 },
      { field: 'package_duration', headerName: 'Duration (mins)', width: 160 },
      {
        field: 'tax_name',
        headerName: 'Tax',
        width: 140,
        valueGetter: (params) => {
          const d = params?.data || {};
          return d.tax_name || d.tax_id || d.taxid || '';
        }
      },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      { key: 'package_name', label: 'Package Name', type: 'text', placeholder: 'Package Name', required: true, colSpan: 2 },
      { key: 'package_description', label: 'Description', type: 'textarea', placeholder: 'Describe the package', colSpan: 2 },
      { key: 'display_order', label: 'Display Order', type: 'number', placeholder: '0' },
      { key: 'package_price', label: 'Price', type: 'number', placeholder: '0.00', required: true },
      { key: 'package_duration', label: 'Duration (mins)', type: 'number', placeholder: 'e.g. 60', required: true },
      { key: 'tax_id', label: 'Tax', type: 'select', options: [], placeholder: 'Select Tax', required: true, lookup: 'tax' },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true },
    ],
    // Map DB rows -> UI: align DB taxid -> UI tax_id for selects/editing
    mapFromDb: (row: any) => ({
      ...row,
      tax_id: row?.tax_id ?? row?.taxid ?? row?.taxId ?? '',
    }),
    // Map UI payload -> DB: convert tax_id -> taxid (column in master_package)
    mapPayload: (payload: Record<string, any>) => {
      const out: any = { ...payload };
      if (out.hasOwnProperty('tax_id')) {
        const v = out.tax_id;
        if (v !== '' && v !== null && v !== undefined) {
          const n = Number(v);
          out.taxid = !Number.isNaN(n) && n > 0 ? n : v; // keep as provided if non-numeric but present
        }
        delete out.tax_id;
      }
      return out;
    },
    autoGenerate: { column: 'package_id', strategy: 'max+1' },
  },


  // Tax Master
  {
    key: 'tax',
    title: 'Tax Master',
    tableKey: MASTER_TABLES.tax,
    icon: Percent,
    description: 'Configure tax rates and calculation settings',
    tableTitle: 'Tax Rates',
    pageSize: 12,
    columnDefs: [
      { field: 'tax_id', headerName: 'Tax ID', width: 120 },
      { field: 'description', headerName: 'Description', flex: 1 },
      { field: 'cgst', headerName: 'CGST (%)', width: 120 },
      { field: 'sgst', headerName: 'SGST (%)', width: 120 },
      { field: 'displayorder', headerName: 'Display Order', width: 120 },
      { field: 'status', headerName: 'Status', width: 100 },
    ],
    formSchema: [
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Description', required: true },
      { key: 'cgst', label: 'CGST (%)', type: 'number', placeholder: '0.000', required: true },
      { key: 'sgst', label: 'SGST (%)', type: 'number', placeholder: '0.000', required: true },
      { key: 'igst', label: 'IGST (%)', type: 'number', placeholder: '0.000' },
      { key: 'vat', label: 'VAT (%)', type: 'number', placeholder: '0.000' },
      { key: 'displayorder', label: 'Display Order', type: 'number', placeholder: 'Order' },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: '1' }, { label: 'Inactive', value: '0' } ], required: true },
    ],
    autoGenerate: { column: 'tax_id', strategy: 'max+1' },
  },

  // Paymode Master
  {
    key: 'paymode',
    title: 'Paymode Master',
    tableKey: MASTER_TABLES.paymode,
    icon: CreditCard,
    description: 'Set up payment methods and transaction modes',
    tableTitle: 'Paymode List',
    pageSize: 10,
    columnDefs: [
      { field: 'payment_id', headerName: 'Payment ID', width: 120 },
      { field: 'payment_mode_name', headerName: 'Paymode Name', flex: 1 },
      { field: 'displayorder', headerName: 'Display Order', width: 120 },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      // Exclude system/audit fields: id, account_code, retail_code, created_at, updated_at, created_by, updated_by
      { key: 'payment_mode_name', label: 'Paymode Name', type: 'text', placeholder: 'Paymode Name', required: true },
      { key: 'displayorder', label: 'Display Order', type: 'number', placeholder: '0' },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' } ], placeholder: 'Active', required: true },
    ],
    autoGenerate: { column: 'payment_id', strategy: 'max+1' },
  },

  // UOM Master
  {
    key: 'uom',
    title: 'UOM Master',
    tableKey: MASTER_TABLES.uom,
    icon: Ruler,
    description: 'Define units of measurement',
    tableTitle: 'UOM List',
    pageSize: 10,
    columnDefs: [
  { field: 'uom_id', headerName: 'UOM ID', width: 120 },
  { field: 'description', headerName: 'Description', flex: 1 },
  { field: 'displayorder', headerName: 'Display Order', width: 140 },
  { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
  { key: 'description', label: 'Description', type: 'text', placeholder: 'Description', colSpan: 2, required: true },
  { key: 'displayorder', label: 'Display Order', type: 'number', placeholder: '0' },
  { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' } ], placeholder: 'Active', required: true },
    ],
    autoGenerate: { column: 'uom_id', strategy: 'max+1' },
  },

  // Bank Master
  {
    key: 'bank',
    title: 'Bank Master',
    tableKey: MASTER_TABLES.bank,
    icon: Building,
    description: 'Manage bank accounts and financial institutions',
    tableTitle: 'Bank List',
    pageSize: 10,
    columnDefs: [
        { field: 'bank_id', headerName: 'Bank ID', width: 140 },
      { field: 'bank_name', headerName: 'Bank Name', flex: 1 },
      { field: 'account_holder_name', headerName: 'Account Holder Name', flex: 1 },
      { field: 'account_number', headerName: 'Account Number', width: 180 },
      { field: 'balance_amount', headerName: 'Balance', width: 140 },
      { field: 'status', headerName: 'Status', width: 100 },
    ],
    formSchema: [
  { key: 'bank_name', label: 'Bank Name', type: 'text', placeholder: 'Bank Name', colSpan: 2, required: true },
  { key: 'branch_name', label: 'Branch Name', type: 'text', placeholder: 'Branch Name', colSpan: 2 },
  { key: 'account_holder_name', label: 'Account Holder Name', type: 'text', placeholder: 'Account Holder Name', colSpan: 2, required: true },
  { key: 'account_number', label: 'Account Number', type: 'text', placeholder: 'Account Number', colSpan: 2, required: true },
  { key: 'ifsc_code', label: 'IFSC Code', type: 'text', placeholder: 'IFSC Code' },
  { key: 'account_type', label: 'Account Type', type: 'select', options: [ { label: 'Current', value: 'Current' }, { label: 'Savings', value: 'Savings' }, { label: 'Loan', value: 'Loan' }, { label: 'FD', value: 'FD' } ], placeholder: 'Current', required: true },
  { key: 'balance_amount', label: 'Balance Amount', type: 'number', placeholder: '0.00' },
  { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 'Active' }, { label: 'Inactive', value: 'Inactive' } ], placeholder: 'Active', required: true },
    ],
    autoGenerate: { column: 'bank_id', strategy: 'max+1' },
  },

  // Category Master
  {
    key: 'category',
    title: 'Category Master',
    tableKey: MASTER_TABLES.category,
    icon: Building,
    description: 'Manage product/service categories',
    tableTitle: 'Categories',
    pageSize: 25,
    columnDefs: [
      { field: 'category_id', headerName: 'Category ID', width: 160 },
      { field: 'category_name', headerName: 'Category Name', flex: 1 },
      { field: 'category_type', headerName: 'Category Type', flex: 1 },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      { key: 'category_type', label: 'Category Type', type: 'select', options: [ { label: 'Service', value: 'Service' }, { label: 'Inventory', value: 'Inventory' } ], placeholder: 'Select Category Type', required: true, defaultValue: 'Service' },
      { key: 'category_name', label: 'Category Name', type: 'text', placeholder: 'Category Name', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true },
    ],
    autoGenerate: { column: 'category_id', strategy: 'max+1' },
  },
  // HSN Master (from HSNMaster.tsx)
  {
    key: 'hsn',
    title: 'HSN Master',
    tableKey: MASTER_TABLES.hsn,
    icon: Hash,
    description: 'Manage HSN codes and mapping',
    tableTitle: 'HSN List',
    pageSize: 10,
    columnDefs: [
      { field: 'hsn_id', headerName: 'HSN ID', width: 120 },
      { field: 'description', headerName: 'Description', flex: 1 },
      { field: 'displayorder', headerName: 'Display Order', width: 140 },
      { 
        field: 'tax_name', 
        headerName: 'Tax', 
        width: 160,
        valueGetter: (params) => params.data?.tax_name || params.data?.tax_id || ''
      },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Description', colSpan: 2, required: true },
      { key: 'displayorder', label: 'Display Order', type: 'number', placeholder: '0' },
      { key: 'tax_id', label: 'Tax', type: 'select', options: [], placeholder: '', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true },
    ],
    autoGenerate: { column: 'hsn_id', strategy: 'max+1' },
  },

  // Inventory Master (from InventoryMaster.tsx)
  {
    key: 'inventory',
    title: 'Inventory Master',
    tableKey: MASTER_TABLES.inventory,
    icon: Package2,
    description: 'Manage inventory items and stock',
    tableTitle: 'Inventory Items',
    pageSize: 20,
    columnDefs: [
      { field: 'product_id', headerName: 'Product ID', width: 140 },
      { field: 'product_name', headerName: 'Product Name', flex: 1 },
      { field: 'reference_code', headerName: 'Reference Code', width: 140 },
      { field: 'barcode', headerName: 'Barcode', width: 140 },
      { field: 'inventory_type', headerName: 'Type', width: 140 },
      { field: 'gender', headerName: 'Gender', width: 140 },
      { field: 'category_name', headerName: 'Category', width: 140 },
      { field: 'hsn_name', headerName: 'HSN', width: 140 },
      { field: 'unit_name', headerName: 'Unit', width: 120 },
      { field: 'purchase_price', headerName: 'Purchase', width: 120 },
      { field: 'selling_price', headerName: 'Selling', width: 120 },
      { field: 'tax_name', headerName: 'Tax', width: 120 },
      { field: 'min_stock_level', headerName: 'Min Stock', width: 120 },
      { field: 'expiry_applicable', headerName: 'Expiry?', width: 100, valueFormatter: (p) => (String(p.value) === '1' ? 'Yes' : 'No') },
      { field: 'display_order', headerName: 'Display Order', width: 120 },
      { field: 'status', headerName: 'Status', width: 110 },
    ],
    formSchema: [
      { key: 'product_name', label: 'Product Name', type: 'text', placeholder: 'Product Name', required: true, colSpan: 2 },
      { key: 'reference_code', label: 'Reference Code', type: 'text', placeholder: 'Reference code / SKU', required: true },
      { key: 'barcode', label: 'Barcode', type: 'text', placeholder: 'Barcode', required: true },
      // Brand removed from Inventory Master UI per request (kept hidden for backward-compatible payload/storage)
      { key: 'brand', label: 'Brand', type: 'text', placeholder: 'Brand', required: false, hidden: true },
      { key: 'inventory_type', label: 'Inventory Type', type: 'select', options: [ { label: 'Consumable', value: 'Consumable' }, { label: 'Retail', value: 'Retail' }, { label: 'Purchase Item', value: 'Purchase Item' } ], placeholder: 'Select Type', required: true },

      { key: 'gender', label: 'Gender', type: 'select', options: [ { label: 'Men', value: 'Men' }, { label: 'Women', value: 'Women' }, { label: 'Kids', value: 'Kids' }, { label: 'Unisex', value: 'Unisex' } ], placeholder: 'Select Gender', required: true, defaultValue: 'Unisex' },

      // Pair HSN and Tax in the same row
      { key: 'hsn_id', label: 'HSN Code', type: 'select', options: [], placeholder: '', lookup: 'hsn', required: true },
      { key: 'tax_id', label: 'Tax', type: 'select', options: [], placeholder: '', required: true, lookup: 'tax' },
      // Then Category and Unit
      { key: 'category_id', label: 'Category', type: 'select', options: [], placeholder: '', required: true, lookup: 'category', lookupFilter: { category_type: 'Inventory' } },
      { key: 'unit_id', label: 'Unit', type: 'select', options: [], placeholder: '', required: true, lookup: 'uom' },
      { key: 'purchase_price', label: 'Purchase Price', type: 'number', placeholder: '0.00', required: true },
      { key: 'selling_price', label: 'Selling Price', type: 'number', placeholder: '0.00', required: true },
      { key: 'min_stock_level', label: 'Min Stock Level', type: 'number', placeholder: '0.00', required: true },

      { key: 'expiry_applicable', label: 'Expiry Applicable', type: 'select', options: [ { label: 'No', value: 0 }, { label: 'Yes', value: 1 } ], placeholder: 'Select', required: true, defaultValue: 0 },

      { key: 'display_order', label: 'Display Order', type: 'number', placeholder: '0', required: true },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true },
    ],
    // Auto-generate product_id = max+1 on create
    autoGenerate: { column: 'product_id', strategy: 'max+1' },
  },

  // Variant Master
  {
    key: 'variant',
    title: 'Variant Master',
    tableKey: MASTER_TABLES.variant,
    icon: Tag,
    description: 'Manage product variants (size/color/width)',
    tableTitle: 'Variants',
    pageSize: 20,
    columnDefs: [
      { field: 'variant_id', headerName: 'Variant ID', width: 160 },
      { field: 'variant_name', headerName: 'Variant Name / Brand Name', flex: 1 },
      { field: 'size', headerName: 'Size', width: 120 },
      { field: 'color', headerName: 'Color', width: 140 },
      { field: 'width', headerName: 'Width', width: 140 },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      { key: 'variant_name', label: 'Variant Name / Brand Name', type: 'text', placeholder: 'e.g. UK 8 - Black', required: true, colSpan: 2 },
      { key: 'size', label: 'Size', type: 'text', placeholder: 'UK 6 / 7 / 8', required: true },
      { key: 'color', label: 'Color', type: 'text', placeholder: 'Black / White', required: true },
      { key: 'width', label: 'Width', type: 'text', placeholder: 'Regular / Wide' },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true, defaultValue: 1 },
    ],
      autoGenerate: { column: 'variant_id', strategy: 'max+1' },
  },

  // Department Master
  {
    key: 'department',
    title: 'Department Master',
    tableKey: 'department',
    icon: Building2,
    description: 'Manage business departments',
    tableTitle: 'Departments',
    pageSize: 20,
    columnDefs: [
      // { field: 'departments_id', headerName: 'Department ID', width: 160 },
      { field: 'dept_name', headerName: 'Department Name', flex: 1 },
      { field: 'description', headerName: 'Description', flex: 1 },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      
      { key: 'dept_name', label: 'Department Name', type: 'text', placeholder: 'Department Name', required: true },
      { key: 'description', label: 'Description', type: 'text', placeholder: 'Description', colSpan: 2 },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true },
    ],

        autoGenerate: { column: 'departments_id', strategy: 'max+1' },
  },

  // Service Master
  {
    key: 'service',
    title: 'Service Master',
    tableKey: MASTER_TABLES.service,
    icon: Settings,
    description: 'Manage services and pricing',
    tableTitle: 'Service List',
    pageSize: 20,
    columnDefs: [
      { field: 'service_id', headerName: 'Service ID', width: 140 },
      { field: 'service_name', headerName: 'Service Name', flex: 1 },
      {
        field: 'display_order',
        headerName: 'Display Order',
        width: 140,
        valueGetter: (params) => {
          const d = params?.data || {};
          return d?.display_order ?? d?.displayOrder ?? d?.displayorder ?? '';
        }
      },
      { 
        field: 'category_name', 
        headerName: 'Category', 
        width: 140,
        // Robust getter: supports plain id, populated object, or name field
        valueGetter: (params) => {
          const d = params?.data || {};
          return (
            d?.category_name ||
            (d?.category && (d.category.category_name || d.category.name || d.category.title)) ||
            d?.category ||
            d?.category_id ||
            ''
          );
        }
      },
      { 
        // Tax column removed per request
        field: '___removed_tax_name', headerName: '', width: 0, hide: true,
      },
      { field: 'preferred_gender', headerName: 'Preferred Gender', width: 140 },
      { field: 'duration', headerName: 'Duration', width: 120 },
      { field: 'price', headerName: 'Price', width: 120 },
      { field: 'status', headerName: 'Status', width: 120 },
    ],
    formSchema: [
      // Excluding: id, account_code, retail_code, created_at, updated_at, created_by, updated_by
      { key: 'service_name', label: 'Service Name', type: 'text', placeholder: 'Service Name', required: true },
      { key: 'category_id', label: 'Category', type: 'select', options: [], placeholder: 'Select Category', required: true, lookup: 'category', lookupFilter: { category_type: 'Service' } },
      { key: 'preferred_gender', label: 'Preferred Gender', type: 'select', options: [ { label: 'Male', value: 'Male' }, { label: 'Female', value: 'Female' }, { label: 'Unisex', value: 'Unisex' } ], placeholder: 'Select Gender', required: true, defaultValue: 'Unisex' },
      { key: 'duration', label: 'Duration', type: 'text', placeholder: 'e.g. 60 min' },
      { key: 'display_order', label: 'Display Order', type: 'number', placeholder: '0' },
      { key: 'price', label: 'Price', type: 'number', placeholder: '0.00', required: true },
      { key: 'hsn_id', label: 'HSN Code', type: 'select', options: [], placeholder: 'Select HSN Code', required: true, lookup: 'hsn' },
      { key: 'tax_id', label: 'Tax', type: 'select', options: [], placeholder: 'Auto-filled from HSN', required: true, lookup: 'tax' },
      { key: 'status', label: 'Status', type: 'select', options: [ { label: 'Active', value: 1 }, { label: 'Inactive', value: 0 } ], placeholder: 'Active', required: true, defaultValue: 1 },
    ],
        autoGenerate: { column: 'service_id', strategy: 'max+1' },
  },

  // Vendor (Supplier) Master
  {
    key: 'vendor',
    title: 'Vendor Master',
    tableKey: MASTER_TABLES.vendor,
    icon: Building,
    description: 'Manage suppliers and their details',
    tableTitle: 'Vendors',
    pageSize: 20,
    columnDefs: [
        { field: 'supplier_id', headerName: 'Vendor ID', width: 130 },
      // { field: 'supplier_id', headerName: 'Supplier ID', width: 130 },
      { field: 'supplier_name', headerName: 'Supplier Name', flex: 1 },
      { field: 'phone_number', headerName: 'Phone', width: 140 },
      { field: 'email_address', headerName: 'Email', width: 200 },
      { field: 'gstin', headerName: 'GSTIN', width: 140 },
      { field: 'address', headerName: 'Address', flex: 1 },
    ],
    formSchema: [
      // Excluding: id, account_code, retail_code, created_at/created_date, updated_at/updated_date, created_by, updated_by
      
      { key: 'supplier_name', label: 'Supplier Name', type: 'text', placeholder: 'Supplier Name', required: true, colSpan: 2 },
      { key: 'phone_number', label: 'Phone Number', type: 'text', placeholder: 'Phone Number', required: true },
      { key: 'email_address', label: 'Email Address', type: 'text', placeholder: 'Email Address' },
      { key: 'gstin', label: 'GSTIN', type: 'text', placeholder: 'GSTIN' },
      { key: 'address', label: 'Address', type: 'text', placeholder: 'Street/Address', colSpan: 2 },
    ],
    autoGenerate: { column: 'supplier_id', strategy: 'max+1' },
  },

// Employee Master
{
  key: 'employee',
  title: 'Employee Master',
  tableKey: MASTER_TABLES.employee,
  icon: Users,
  description: 'Manage employees, designations, and skill levels',
  tableTitle: 'Employees',
  pageSize: 20,
  columnDefs: [
    { field: 'employee_id', headerName: 'Employee ID', width: 130 },
    { field: 'employee_name', headerName: 'Employee Name', flex: 1 },
    { field: 'designation', headerName: 'Designation', width: 180 },
    { field: 'skill_level', headerName: 'Skill Level', width: 150 },
    { field: 'price_markup_percent', headerName: 'Extra Charges (%)', width: 160 },
    { field: 'Phoneno', headerName: 'Phone', width: 160 },
    { field: 'Alternative_phoneno', headerName: 'Alt. Phone', width: 160 },
    { field: 'Joining_Date', headerName: 'Joining Date', width: 160 },
    { field: 'address', headerName: 'Address', flex: 1 },
    { field: 'status', headerName: 'Status', width: 120 },
  ],
  formSchema: [
    // Excluding: id, account_code, retail_code, created_at, updated_at, created_by, updated_by
    { key: 'employee_name', label: 'Employee Name', type: 'text', placeholder: 'Employee Name', required: true },
    { 
      key: 'gender', 
      label: 'Gender', 
      type: 'select', 
      options: [
        { label: 'Male', value: 'Male' },
        { label: 'Female', value: 'Female' },
      ], 
      placeholder: 'Select Gender', 
      required: true 
    },
    { key: 'designation', label: 'Designation', type: 'text', placeholder: 'Designation' },
    { 
      key: 'skill_level', 
      label: 'Skill Level', 
      type: 'select', 
      options: [
        { label: 'Beginner', value: 'Beginner' },
        { label: 'Intermediate', value: 'Intermediate' },
        { label: 'Pro', value: 'Pro' },
        { label: 'Expert', value: 'Expert' }
      ], 
      placeholder: 'Select Skill Level', 
      required: true 
    },
    { key: 'price_markup_percent', label: 'Extra Charges (%)', type: 'number', placeholder: '0.00', required: true },
    { key: 'Phoneno', label: 'Phone Number', type: 'text', placeholder: 'Phone Number', required: true },
    { key: 'Alternative_phoneno', label: 'Alternative Phone', type: 'text', placeholder: 'Alternative Phone' , required: true},
    { key: 'Joining_Date', label: 'Joining Date', type: 'date', placeholder: 'YYYY-MM-DD', required: true },
    { key: 'address', label: 'Address', type: 'text', placeholder: 'Street/Address', colSpan: 2 },
    { key: 'photo_url', label: 'Photo Upload', type: 'file', accept: 'image/*', placeholder: 'Upload employee photo' },
    { key: 'document_url', label: 'Document Upload', type: 'file', accept: '.pdf,.doc,.docx,.jpg,.jpeg,.png', placeholder: 'Upload document' },
    { 
      key: 'status', 
      label: 'Status', 
      type: 'select', 
      options: [ 
        { label: 'Active', value: 1 }, 
        { label: 'Inactive', value: 0 } 
      ], 
      placeholder: 'Active', 
      required: true 
    },
  ],  
  autoGenerate: { column: 'employee_id', strategy: 'max+1', width: 4 },
},

{
  key: 'membership',
  title: 'Membership Master',
  tableKey: MASTER_TABLES.membership,
  icon: CreditCard,
  description: 'Manage membership plans',
  tableTitle: 'Memberships',
  pageSize: 20,
  columnDefs: [
    { field: 'membership_id', headerName: 'Membership ID', width: 140 },
    { field: 'membership_name', headerName: 'Membership Name', flex: 1 },
    { field: 'duration_months', headerName: 'Duration (Months)', width: 180 },
    { field: 'price', headerName: 'Price', width: 150 },
    { field: 'discount_percent', headerName: 'Discount (%)', width: 150 },
    { field: 'status', headerName: 'Status', width: 120 },
  ],
  formSchema: [
    { key: 'membership_name', label: 'Membership Name', type: 'text', placeholder: 'Membership Name', required: true },
    { key: 'duration_months', label: 'Duration (Months)', type: 'number', placeholder: 'e.g. 12', required: true },
    { key: 'price', label: 'Price', type: 'number', placeholder: '0.00', required: true },
    { key: 'discount_percent', label: 'Discount (%)', type: 'number', placeholder: '0.00' },
    { 
      key: 'status', 
      label: 'Status', 
      type: 'select', 
      options: [ 
        { label: 'Active', value: 1 }, 
        { label: 'Inactive', value: 0 } 
      ], 
      placeholder: 'Active', 
      required: true 
    },
  ],
  autoGenerate: { column: 'membership_id', strategy: 'max+1' },
}


];

export default MASTER_CONFIGS;
