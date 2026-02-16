// Centralized master table names for services/masters
export const MASTER_TABLES = {
  service: 'master_service',
  category: 'master_category',
  event_type: 'master_event_type',
  inventory: 'master_inventory',
  variant: 'master_variants',
  hall: 'master_hall',
  bank: 'master_bank',
  shiftslot: 'master_slot',
  paymode: 'master_paymentmodes',
  uom: 'master_uom',
  hsn: 'master_hsn',
  customer: 'master_customer',
  tax: 'master_tax',
  // Vendor Master actually backed by master_supplier table
  vendor: 'master_supplier',
  employee: 'master_employee',
  membership: 'master_membership',
  package: 'master_package',
};

export default MASTER_TABLES;
