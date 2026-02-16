import { ApiService } from './apiService';

// Type definitions for 3-table appointment structure
export interface MasterAppointment {
  apt_id: string;
  customer_name: string;
  customer_mobile?: string;
  employee_name: string;
  employee_id?: string;
  appointment_date: string;
  slot_from: string;
  slot_to: string;
  special_requirements?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  advance_paid: number;
  balance_due: number;
  payment_mode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AppointmentTransactionLine {
  id?: number;
  apt_id: string;
  seq: number;
  account_code: string;
  retail_code: string;
  customer_id?: string;
  customer_name?: string;
  customer_mobile?: number;
  employee_id?: string;
  employee_name?: string;
  employee_level?: string;
  employee_percent?: number;
  service_id?: string;
  service_name?: string;
  tax_id?: string;
  base_price?: number;
  markup_percent_applied?: number;
  markup_amount_per_unit?: number;
  unit_price?: number;
  quantity?: number;
  subtotal?: number;
  discount_amount?: number;
  taxable_amount?: number;
  tax_rate_percent?: number;
  membership_discount?: number;
  tax_amount?: number;
  total_cgst?: number;
  total_sgst?: number;
  total_igst?: number;
  total_vat?: number;
  // New appointment columns in transactions table
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  advance_paid?: number;
  balance_due?: number;
  payment_mode?: string;
  sequence_id?: number;
  created_at?: string;
}

export interface AppointmentSummary {
  apt_id: string;
  service_id: string;
  service_name: string;
  unit_price: number;
  qty: number;
  tax_amount: number;
  discount_amount: number;
  grand_total: number;
  // Scheduling columns in summary table
  appointment_date?: string;
  slot_from?: string;
  slot_to?: string;
  special_requirements?: string;
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  advance_paid?: number;
  balance_due?: number;
  payment_mode?: string;
  created_at?: string;
}

export interface CompleteAppointmentData {
  // Master appointment data
  appointment_id: string;
  customer_name: string;
  customer_mobile?: string;
  employee_name: string;
  employee_id?: string;
  appointment_date: string;
  slot_from: string;
  slot_to: string;
  special_requirements?: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';
  advance_paid: number;
  balance_due: number;
  payment_mode?: string;
  
  // Transaction and summary aggregates
  data?: AppointmentTransactionLine[]; // For API compatibility
  services?: AppointmentSummary[]; // Service breakdown
  count?: number;
  service_count: number;
  total_subtotal: number;
  total_tax: number;
  total_discount: number;
  grand_total: number;
  
  // Timestamps
  created_at?: string;
  updated_at?: string;
}

export interface CreateAppointmentTransactionPayload {
  lines: AppointmentTransactionLine[];
  appointment_metadata?: Record<string, any>;
}

export interface UpdateAppointmentTransactionPayload {
  update_fields: Record<string, any>;
}

export interface AppointmentTransactionResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface ListAppointmentTransactionsResponse {
  success: boolean;
  message: string;
  data?: any[];
}

/**
 * Service for handling appointment transaction operations.
 * Maps to the 4 backend endpoints:
 * - POST /appointment-transactions - Create appointment transaction lines
 * - GET /appointment-transactions/{appointment_id} - Get appointment transaction lines
 * - PUT /appointment-transactions/{appointment_id} - Update appointment transaction lines
 * - GET /appointment-transactions - List appointment transactions
 */
export class AppointmentTransactionService {
  /**
   * Create appointment transaction lines
   * Maps to: POST /appointment-transactions
   */
  static async create(payload: CreateAppointmentTransactionPayload): Promise<AppointmentTransactionResponse> {
    return ApiService.post('/appointment-transactions', payload);
  }

  /**
   * Get appointment transaction lines by appointment ID
   * Maps to: GET /appointment-transactions/{appointment_id}
   */
  static async get(
    appointmentId: string,
    accountCode?: string,
    retailCode?: string
  ): Promise<AppointmentTransactionResponse> {
    const params = new URLSearchParams();
    if (accountCode) params.append('account_code', accountCode);
    if (retailCode) params.append('retail_code', retailCode);
    
    const query = params.toString();
    const url = `/appointment-transactions/${appointmentId}${query ? `?${query}` : ''}`;
    
    return ApiService.get(url);
  }

  /**
   * Update appointment transaction lines
   * Maps to: PUT /appointment-transactions/{appointment_id}
   */
  static async update(
    appointmentId: string,
    payload: UpdateAppointmentTransactionPayload,
    accountCode?: string,
    retailCode?: string
  ): Promise<AppointmentTransactionResponse> {
    const params = new URLSearchParams();
    if (accountCode) params.append('account_code', accountCode);
    if (retailCode) params.append('retail_code', retailCode);
    
    const query = params.toString();
    const url = `/appointment-transactions/${appointmentId}${query ? `?${query}` : ''}`;
    
    return ApiService.put(url, payload);
  }

  /**
   * List appointment transactions with optional date filtering
   * Maps to: GET /appointment-transactions
   */
  static async list(
    accountCode: string,
    retailCode: string,
    fromDate?: string,
    toDate?: string
  ): Promise<ListAppointmentTransactionsResponse> {
    const params = new URLSearchParams();
    params.append('account_code', accountCode);
    params.append('retail_code', retailCode);
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);
    
    return ApiService.get(`/appointment-transactions?${params.toString()}`);
  }

  /**
   * Get appointments for the appointments list view
   * This uses the 3-table structure: master_appointment + appointment_transactions + appointment_trans_summary
   */
  static async fetchAppointments(
    accountCode: string,
    retailCode: string,
    fromDate?: string,
    toDate?: string
  ): Promise<any[]> {
    try {
      const response = await this.list(accountCode, retailCode, fromDate, toDate);
      if (response.success && Array.isArray(response.data)) {
        // Transform 3-table appointment data to frontend format
        return response.data.map((item: any) => {
          // Prefer any available status field from backend before defaulting
          const backendStatus =
            item.status ??
            item.appointment_status ??
            item.booking_status ??
            item.appointmentState ??
            item.state ??
            '';
          return {
            // Core appointment identification (from master_appointment)
            appointment_id: item.appointment_id,
            
            // Customer information (from master_appointment)
            customer_name: item.customer_name,
            customer_phone: item.customer_mobile ? String(item.customer_mobile) : '',
            
            // Staff information (from master_appointment)
            staff_name: item.employee_name,
            employee_id: item.employee_id,
            
            // Scheduling information (from master_appointment)
            appointment_date: item.appointment_date || '',
            slot_from: item.slot_from || '',
            slot_to: item.slot_to || '',
            special_requirements: item.special_requirements || '',
            
            // Status and payment information (from master_appointment)
            status: backendStatus || 'pending',
            advance_paid: item.advance_paid || 0,
            balance_due: item.balance_due || 0,
            payment_mode: item.payment_mode || '',
            
            // Financial aggregates (from appointment_trans_summary)
            total_amount: item.grand_total || 0,
            services_total: item.total_subtotal || 0,
            discount: item.total_discount || 0,
            tax_amount: item.total_tax || 0,
            membership_discount: item.membership_discount || 0,
            
            // Derived payment status
            payment_status: this.calculatePaymentStatus(
              item.grand_total || 0,
              item.advance_paid || 0,
              item.balance_due || 0
            ),
            
            // Service counts and aggregates (from summary aggregation)
            line_count: item.line_count || 0,
            service_count: item.service_count || 0,
            
            // Service details (from appointment_trans_summary)
            services: item.services || [],
            
            // Timestamps
            latest_created: item.latest_created,
            created_at: item.created_at,
            updated_at: item.updated_at,
            
            // Legacy compatibility fields
            grand_total: item.grand_total || 0,
            transaction_subtotal: item.total_subtotal || 0,
            transaction_tax: item.total_tax || 0,
            transaction_discount: item.total_discount || 0
          };
        });
      }
      return [];
    } catch (error) {
      console.error('Failed to fetch appointments from 3-table structure:', error);
      return [];
    }
  }

  /**
   * Calculate payment status based on amounts
   */
  private static calculatePaymentStatus(total: number, advance: number, balance: number): 'pending' | 'advance' | 'settled' {
    if (advance === 0) return 'pending';
    if (balance <= 0 && advance >= total) return 'settled';
    if (advance > 0 && advance < total) return 'advance';
    return 'pending';
  }

  /**
   * Update appointment status (updates master_appointment table)
   */
  static async updateAppointmentStatus(
    appointmentId: string,
    status: 'pending' | 'confirmed' | 'cancelled' | 'completed',
    accountCode?: string,
    retailCode?: string
  ): Promise<AppointmentTransactionResponse> {
    return this.update(appointmentId, {
      update_fields: { status }
    }, accountCode, retailCode);
  }

  /**
   * Update payment information (updates master_appointment table)
   */
  static async updatePaymentInfo(
    appointmentId: string,
    paymentData: {
      advance_paid?: number;
      balance_due?: number;
      payment_mode?: string;
    },
    accountCode?: string,
    retailCode?: string
  ): Promise<AppointmentTransactionResponse> {
    return this.update(appointmentId, {
      update_fields: paymentData
    }, accountCode, retailCode);
  }

  /**
   * Update scheduling information (updates master_appointment table)
   */
  static async updateScheduling(
    appointmentId: string,
    schedulingData: {
      appointment_date?: string;
      slot_from?: string;
      slot_to?: string;
      special_requirements?: string;
    },
    accountCode?: string,
    retailCode?: string
  ): Promise<AppointmentTransactionResponse> {
    return this.update(appointmentId, {
      update_fields: schedulingData
    }, accountCode, retailCode);
  }

  /**
   * Get complete appointment details (from all 3 tables)
   */
  static async getCompleteAppointment(
    appointmentId: string,
    accountCode?: string,
    retailCode?: string
  ): Promise<CompleteAppointmentData | null> {
    try {
      const response = await this.get(appointmentId, accountCode, retailCode);
      if (response.success && response.data) {
        return response.data as CompleteAppointmentData;
      }
      return null;
    } catch (error) {
      console.error('Failed to get complete appointment data:', error);
      return null;
    }
  }

  /**
   * Helper function to create transaction lines from appointment data
   * This builds the payload for the create() method
   */
  static createTransactionLinesFromAppointment(appointmentData: {
    appointment_id: string;
    account_code: string;
    retail_code: string;
    customer_id?: string;
    customer_name?: string;
    customer_phone?: string;
    staff_id?: string;
    staff_name?: string;
    services?: any[];
    services_total?: number;
    discount?: number;
    tax_rate?: number;
    tax_amount?: number;
    cgst_amount?: number;
    sgst_amount?: number;
    membership_discount?: number;
    // Additional scheduling fields
    appointment_date?: string;
    slot_from?: string;
    slot_to?: string;
    special_requirements?: string;
    payment_mode?: string;
    advance_paid?: number;
    balance_due?: number;
    status?: string;
  }): AppointmentTransactionLine[] {
    const lines: AppointmentTransactionLine[] = [];
    
    const {
      appointment_id,
      account_code,
      retail_code,
      customer_id,
      customer_name,
      customer_phone,
      staff_id,
      staff_name,
      services = [],
      services_total = 0,
      discount = 0,
      membership_discount = 0,
      appointment_date = '',
      slot_from = '',
      slot_to = '',
      special_requirements = '',
      payment_mode = '',
      advance_paid = 0,
      balance_due = 0,
      status = ''
    } = appointmentData;

    // Convert customer phone to mobile number
    let customer_mobile: number | undefined;
    if (customer_phone) {
      const phoneStr = customer_phone.toString().replace(/[^\d]/g, '');
      customer_mobile = phoneStr ? parseInt(phoneStr, 10) : undefined;
    }

    if (services.length > 0) {
      // Create a transaction line for each service
      services.forEach((service, index) => {
        const servicePrice = Number(service.price || service.unit_price || 0);
        const basePrice = Number(service.base_price || servicePrice);
        const quantity = Number(service.quantity || 1);
        const markupPercent = Number(service.markup_percent || 0);
        const markupAmount = Number(service.markup_amount_per_unit || 0);
        const subtotal = servicePrice * quantity;
        
        // Allocate discounts proportionally
        const discountRatio = services_total > 0 ? subtotal / services_total : 0;
        const serviceDiscount = discount * discountRatio;
        const serviceMembershipDiscount = membership_discount * discountRatio;
        
        const taxableAmount = Math.max(subtotal - serviceDiscount, 0);
        const serviceTaxRate = Number(service.tax_rate || 0);
        const serviceTaxAmount = Number(service.tax_amount || 0);
        const serviceCgstAmount = Number(service.cgst_amount || 0);
        const serviceSgstAmount = Number(service.sgst_amount || 0);

        lines.push({
          account_code,
          retail_code,
          customer_id: customer_id?.toString(),
          customer_name,
          customer_mobile,
          apt_id: appointment_id, // Keep simple: APT-1, APT-2, etc.
          seq: index + 1,
          employee_id: staff_id?.toString(),
          employee_name: staff_name,
          // Add service information for proper summary table creation
          service_id: String(service.service_id || service.id || `SRV-${index + 1}`),
          service_name: service.service_name || service.name || 'Service',
          tax_id: String(service.tax_id || 'TAX-001'),
          base_price: basePrice,
          markup_percent_applied: markupPercent,
          markup_amount_per_unit: markupAmount,
          unit_price: servicePrice,
          quantity,
          subtotal,
          discount_amount: serviceDiscount,
          taxable_amount: taxableAmount,
          tax_rate_percent: serviceTaxRate,
          membership_discount: serviceMembershipDiscount,
          tax_amount: serviceTaxAmount,
          total_cgst: serviceCgstAmount,
          total_sgst: serviceSgstAmount,
          total_igst: 0,
          total_vat: 0,
          // New appointment status fields
          status: status as any || 'pending',
          advance_paid: advance_paid,
          balance_due: balance_due,
          payment_mode: payment_mode,
          sequence_id: index + 1
        });
      });
    } else {
      // Create a single line with total amounts and scheduling info
      lines.push({
        account_code,
        retail_code,
        customer_id: customer_id?.toString(),
        customer_name,
        customer_mobile,
        apt_id: appointment_id, // Keep simple: APT-1, APT-2, etc.
        seq: 1,
        employee_id: staff_id?.toString(),
        employee_name: staff_name,
        // Default service info when no specific services provided
        service_id: 'SRV-APPOINTMENT',
        service_name: 'Appointment Service',
        tax_id: 'TAX-001',
        base_price: services_total,
        markup_percent_applied: 0,
        markup_amount_per_unit: 0,
        unit_price: services_total,
        quantity: 1,
        subtotal: services_total,
        discount_amount: discount,
        taxable_amount: Math.max(services_total - discount, 0),
        tax_rate_percent: appointmentData.tax_rate || 0,
        membership_discount,
        tax_amount: appointmentData.tax_amount || 0,
        total_cgst: appointmentData.cgst_amount || 0,
        total_sgst: appointmentData.sgst_amount || 0,
        total_igst: 0,
        total_vat: 0,
        // New appointment status fields
        status: status as any || 'pending',
        advance_paid: advance_paid,
        balance_due: balance_due,
        payment_mode: payment_mode,
        sequence_id: 1
      });
    }

    return lines;
  }

  /**
   * Auto-create appointment transactions from appointment data
   * Enhanced to support 3-table creation: master_appointment + appointment_transactions + appointment_trans_summary
   */
  static async createFromAppointment(appointmentData: any): Promise<AppointmentTransactionResponse> {
    const lines = this.createTransactionLinesFromAppointment(appointmentData);
    
    // Create the payload with comprehensive metadata for all 3 tables
    const payload = {
      lines,
      appointment_metadata: {
        // Master appointment table data
        customer_name: appointmentData.customer_name,
        customer_mobile: appointmentData.customer_phone,
        employee_name: appointmentData.staff_name,
        employee_id: appointmentData.staff_id,
        appointment_date: appointmentData.appointment_date,
        slot_from: appointmentData.slot_from,
        slot_to: appointmentData.slot_to,
        special_requirements: appointmentData.special_requirements || '',
        status: appointmentData.status || 'pending',
        advance_paid: appointmentData.advance_paid || 0,
        balance_due: appointmentData.balance_due || appointmentData.services_total || 0,
        payment_mode: appointmentData.payment_mode || '',
        
        // Summary table scheduling data (duplicated for summary aggregation)
        summary_appointment_date: appointmentData.appointment_date,
        summary_slot_from: appointmentData.slot_from,
        summary_slot_to: appointmentData.slot_to,
        summary_special_requirements: appointmentData.special_requirements || '',
        summary_status: appointmentData.status || 'pending',
        summary_advance_paid: appointmentData.advance_paid || 0,
        summary_balance_due: appointmentData.balance_due || appointmentData.services_total || 0,
        summary_payment_mode: appointmentData.payment_mode || ''
      }
    };
    
    return this.create(payload);
  }
}

export default AppointmentTransactionService;