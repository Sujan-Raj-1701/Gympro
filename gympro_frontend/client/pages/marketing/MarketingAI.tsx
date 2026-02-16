import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Users, 
  TrendingUp, 
  UserCheck,
  UserX,
  IndianRupee,
  TrendingDown,
  Crown,
  BarChart3,
  Brain,
  Send,
  X,
  Bot,
  MessageSquare,
  RotateCcw,
  Calculator
} from 'lucide-react';
import { ApiService, ApiResponse } from '@/services/apiService';
import { useAuth } from '@/contexts/AuthContext';
import { MASTER_TABLES } from '@/services/masterTables';

interface CampaignSuggestion {
  id: string;
  title: string;
  description: string;
  target: string;
  channel: string;
  budget: string;
  duration: string;
  expectedRoi: string;
}

interface CustomerStats {
  totalCustomers: number;
  totalMemberships: number;
  customersWithoutMembership: number;
  membershipRevenue: number;
  membershipCost: number;
  membershipProfit: number;
}

interface MembershipBreakdown {
  membershipType: string;
  count: number;
  revenue: number;
  discountGiven: number;
  billingDiscounts?: number;
  appointmentDiscounts?: number;
}

interface MembershipPlan {
  membership_id?: string | number;
  id?: string | number;
  membership_name: string;
  price: number;
  discount_percent?: number;
}

interface FeeSuggestionTarget {
  margin: number; // e.g., 0.5 for 50%
  requiredFee: number; // target membership fee to achieve margin
  delta: number; // difference vs current fee
}

interface FeeSuggestion {
  membershipType: string;
  currentPrice: number;
  avgDiscount: number;
  currentMargin: number;
  targets: FeeSuggestionTarget[];
}

export default function MarketingAI() {
  const { user } = useAuth();
  const [stats, setStats] = useState<CustomerStats>({
    totalCustomers: 0,
    totalMemberships: 0,
    customersWithoutMembership: 0,
    membershipRevenue: 0,
    membershipCost: 0,
    membershipProfit: 0
  });

  const [membershipBreakdown, setMembershipBreakdown] = useState<MembershipBreakdown[]>([]);
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([]);
  const [discountSourceBreakdown, setDiscountSourceBreakdown] = useState<{
    totalBillingDiscounts: number;
    totalAppointmentDiscounts: number;
    byMembership: Array<{
      membershipType: string;
      billingDiscounts: number;
      appointmentDiscounts: number;
      totalCustomers: number;
    }>;
  }>({
    totalBillingDiscounts: 0,
    totalAppointmentDiscounts: 0,
    byMembership: []
  });
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{id: string, type: 'user' | 'ai', message: string, timestamp: Date}>>([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [aiTyping, setAiTyping] = useState(false);
  
  // Calculator states
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    customerCount: 0,
    membershipDiscount: 0,
    perUserVisitCount: 0,
    avgUserSpentAmount: 0,
    membershipPrice: 0
  });
  const [calculatorResults, setCalculatorResults] = useState({
    monthlyEmi: 0,
    principalAmount: 0,
    totalInterest: 0,
    totalRevenue: 0,
    totalProfit: 0
  });
  const [isCalculating, setIsCalculating] = useState(false);

  // Fetch customer and membership data
  useEffect(() => {
    const fetchAnalyticsData = async () => {
      if (!user?.account_code || !user?.retail_code) {
        setError('User authentication required. Please login again.');
        setLoading(false);
        return;
      }
      
      // Check if user is properly authenticated
      const token = sessionStorage.getItem('access_token');
      if (!token) {
        setError('Authentication token missing. Please login again.');
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);

      try {


        // Fetch data from multiple sources
        const promises = [];

        // Approach 1: Use /read endpoint for customers
        promises.push(
          ApiService.post<ApiResponse<any>>('/read', {
            tables: [MASTER_TABLES.customer],
            account_code: user.account_code,
            retail_code: user.retail_code
          }).catch(err => ({ error: 'customers_read_failed', details: err }))
        );

        // Approach 2: Use /read endpoint for memberships  
        promises.push(
          ApiService.post<ApiResponse<any>>('/read', {
            tables: [MASTER_TABLES.membership],
            account_code: user.account_code,
            retail_code: user.retail_code
          }).catch(err => ({ error: 'memberships_read_failed', details: err }))
        );

        // Approach 3: Use searchMasterCustomer to get customer data with membership info
        promises.push(
          ApiService.searchMasterCustomer('', 1000, user.account_code, user.retail_code, true)
            .catch(err => ({ error: 'customer_search_failed', details: err }))
        );

        // Approach 4: Fetch billing transitions to get discount information
        // Use sendalldata=N to avoid heavy payloads when not needed.
        promises.push(
          ApiService.get(`/billing-transitions?${new URLSearchParams({
            account_code: String(user.account_code),
            retail_code: String(user.retail_code),
            limit: '1000',
            sendalldata: 'N'
          }).toString()}`)
            .catch(err => ({ error: 'billing_transitions_failed', details: err }))
        );

        // Approach 5: Fetch appointment transactions to get membership discount data
        promises.push(
          ApiService.get(`/appointment-transactions?account_code=${user.account_code}&retail_code=${user.retail_code}`)
            .catch(err => ({ error: 'appointment_transactions_failed', details: err }))
        );

        const [customersRes, membershipsRes, customerSearchRes, billingRes, appointmentTransRes] = await Promise.all(promises);

        // Try to get customer data from multiple sources
        let customers = [];
        let memberships = [];
        let billingData = [];
        let appointmentTransData = [];

        // From /read endpoint for customers
        if (customersRes && !customersRes.error) {
          customers = customersRes?.data?.[MASTER_TABLES.customer] || 
                     customersRes?.data || 
                     (Array.isArray(customersRes) ? customersRes : []);
        }

        // From search endpoint if /read failed
        if (customers.length === 0 && customerSearchRes && !customerSearchRes.error) {
          customers = Array.isArray(customerSearchRes) ? customerSearchRes : [];
        }

        // From /read endpoint for memberships
        if (membershipsRes && !membershipsRes.error) {
          memberships = membershipsRes?.data?.[MASTER_TABLES.membership] || 
                       membershipsRes?.data || 
                       (Array.isArray(membershipsRes) ? membershipsRes : []);
        }

        // From billing-transitions endpoint for discount information
        if (billingRes && !billingRes.error) {
          billingData = Array.isArray(billingRes) ? billingRes : 
                       billingRes?.data ? (Array.isArray(billingRes.data) ? billingRes.data : [billingRes.data]) : [];
        }

        // From appointment-transactions endpoint for membership discount information
        if (appointmentTransRes && !appointmentTransRes.error) {
          appointmentTransData = Array.isArray(appointmentTransRes) ? appointmentTransRes : 
                                appointmentTransRes?.data ? (Array.isArray(appointmentTransRes.data) ? appointmentTransRes.data : [appointmentTransRes.data]) : [];
        }

        // Initialize discount tracking by source
        let totalBillingDiscounts = 0;
        let totalAppointmentDiscounts = 0;
        const discountBreakdownBySource = new Map<string, {
          billingDiscounts: number;
          appointmentDiscounts: number;
          totalCustomers: number;
        }>();

        // Calculate customer statistics
        const totalCustomers = customers.length;
        
        // Count customers with memberships (assuming membership_id field exists)
        const customersWithMembership = customers.filter(customer => 
          customer.membership_id && customer.membership_id !== null && customer.membership_id !== ''
        ).length;
        
        const customersWithoutMembership = totalCustomers - customersWithMembership;

        // Calculate ACTUAL membership revenue based on customers with memberships and membership plans
        let membershipRevenue = 0;
        let totalDiscountsGiven = 0;
        const membershipBreakdownMap = new Map<string, {
          count: number;
          revenue: number;
          discountGiven: number;
        }>();

        // Get customers with memberships and their membership details
        const customersWithMemberships = customers.filter(customer => 
          customer.membership_id && customer.membership_id !== null && customer.membership_id !== ''
        );



        // Calculate revenue based on actual membership purchases by customers
        customersWithMemberships.forEach((customer: any) => {
          // Find the membership plan this customer has
          const membershipPlan = memberships.find((plan: any) => 
            plan.membership_id === customer.membership_id || 
            plan.id === customer.membership_id
          );

          if (membershipPlan) {
            const price = Number(membershipPlan.price || 0);
            
            // Find all billing transactions for this customer and sum membership_discount
            let discountAmount = 0;
            const customerBillings = billingData.filter(billing => {
              // Handle both direct properties and header nested data
              const billingData_actual = billing.header || billing; // Use header if exists, otherwise direct
              
              // Try multiple ways to match customer
              const matchesId = String(billingData_actual.customer_id) === String(customer.id);
              const matchesName = 
                billingData_actual.customerr_name === customer.customer_name || 
                billingData_actual.customer_name === customer.customer_name ||
                billingData_actual.txn_customer_name === customer.customer_name;
              const matchesMobile = 
                billingData_actual.customer_mobile === customer.customer_mobile || 
                billingData_actual.customer_number === customer.customer_number ||
                billingData_actual.txn_customer_number === customer.customer_number;
              
              return matchesId || matchesName || matchesMobile;
            });
            
            if (customerBillings.length > 0) {
              // Sum all membership_discount amounts for this customer
              discountAmount = customerBillings.reduce((sum, billing) => {
                // Try multiple locations for membership_discount
                const membershipDiscount = Number(
                  billing.membership_discount ||           // Direct property
                  billing.header?.membership_discount ||   // Nested in header
                  billing.txn_membership_discount ||       // From backend header mapping
                  billing.discount_amount ||               // Alternative field name
                  0
                );
                

                
                return sum + membershipDiscount;
              }, 0);
            } else {
              // Fallback: try customer table fields
              discountAmount = Number(
                customer.membership_discount || 
                customer.membershipDiscount || 
                customer.discount_amount || 
                customer.discountAmount || 
                0
              );
            }

            // Also check appointment transactions for additional membership discount data
            const customerAppointmentTrans = appointmentTransData.filter(trans => {
              // Match by name or mobile number (appointment transactions don't have customer_id)
              const matchesName = trans.customer_name === customer.customer_name;
              const matchesMobile = 
                trans.customer_mobile === customer.customer_mobile || 
                trans.customer_mobile === customer.customer_number ||
                String(trans.customer_mobile) === String(customer.customer_mobile) ||
                String(trans.customer_mobile) === String(customer.customer_number);
              
              return matchesName || matchesMobile;
            });



            // Track billing discounts separately
            const billingDiscountAmount = discountAmount;
            
            if (customerAppointmentTrans.length > 0) {
              // Add membership discounts from appointment transactions
              const appointmentDiscounts = customerAppointmentTrans.reduce((sum, trans) => {
                const transDiscount = Number(trans.membership_discount || 0);
                return sum + transDiscount;
              }, 0);
              

              
              // Track appointment discounts separately
              totalAppointmentDiscounts += appointmentDiscounts;
              
              // Add to existing discount amount
              discountAmount += appointmentDiscounts;
            }
            
            // Track billing discounts
            totalBillingDiscounts += billingDiscountAmount;
            
            // If still no discount found, fallback to plan's discount_percent
            if (discountAmount === 0 && membershipPlan.discount_percent) {
              const discountPercent = Number(membershipPlan.discount_percent || 0);
              discountAmount = (price * discountPercent) / 100;
            }
            

            
            // Revenue = Total amount of membership (full plan price)
            membershipRevenue += price;
            // Track total custom membership discounts given to customers
            totalDiscountsGiven += discountAmount;

            // Group by membership plan for breakdown
            const membershipName = membershipPlan.membership_name || 'Unknown Membership';
            const existing = membershipBreakdownMap.get(membershipName) || {
              count: 0,
              revenue: 0,
              discountGiven: 0,
              billingDiscounts: 0,
              appointmentDiscounts: 0
            };

            existing.count += 1;
            existing.revenue += price; // Use full plan price for revenue
            existing.discountGiven += discountAmount;
            (existing as any).billingDiscounts = ((existing as any).billingDiscounts || 0) + billingDiscountAmount;
            (existing as any).appointmentDiscounts = ((existing as any).appointmentDiscounts || 0) + (discountAmount - billingDiscountAmount);
            
            membershipBreakdownMap.set(membershipName, existing);
            
            // Track by membership type for source breakdown
            const sourceBreakdown = discountBreakdownBySource.get(membershipName) || {
              billingDiscounts: 0,
              appointmentDiscounts: 0,
              totalCustomers: 0
            };
            sourceBreakdown.billingDiscounts += billingDiscountAmount;
            sourceBreakdown.appointmentDiscounts += (discountAmount - billingDiscountAmount);
            sourceBreakdown.totalCustomers += 1;
            discountBreakdownBySource.set(membershipName, sourceBreakdown);
          } else {
            // Customer has membership_id but no matching plan found
            
            // Try different matching strategies
            let foundPlan = null;
            
            // Try string comparison
            foundPlan = memberships.find(plan => 
              String(plan.membership_id) === String(customer.membership_id) || 
              String(plan.id) === String(customer.membership_id)
            );
            
            if (!foundPlan) {
              // Try numeric comparison
              foundPlan = memberships.find(plan => 
                Number(plan.membership_id) === Number(customer.membership_id) || 
                Number(plan.id) === Number(customer.membership_id)
              );
            }
            
            let planPrice;
            if (foundPlan) {
              planPrice = Number(foundPlan.price || 0);
            } else {
              // Use average price as last resort
              planPrice = memberships.length > 0 
                ? memberships.reduce((sum: number, plan: any) => sum + Number(plan.price || 0), 0) / memberships.length
                : 375; // fallback average between 500 and 250
            }
            
            // Still use customer's membership_discount even if plan not found
            let discountAmount = Number(
              customer.membership_discount || 
              customer.membershipDiscount || 
              customer.discount_amount || 
              customer.discountAmount || 
              0
            );

            // Also check appointment transactions for this customer
            const customerAppointmentTrans = appointmentTransData.filter(trans => {
              // Match by name or mobile number (appointment transactions don't have customer_id)
              const matchesName = trans.customer_name === customer.customer_name;
              const matchesMobile = 
                trans.customer_mobile === customer.customer_mobile || 
                trans.customer_mobile === customer.customer_number ||
                String(trans.customer_mobile) === String(customer.customer_mobile) ||
                String(trans.customer_mobile) === String(customer.customer_number);
              
              return matchesName || matchesMobile;
            });

            // Track billing discount for this customer (no plan match)
            const billingDiscountAmount = discountAmount;
            totalBillingDiscounts += billingDiscountAmount;
            
            if (customerAppointmentTrans.length > 0) {
              const appointmentDiscounts = customerAppointmentTrans.reduce((sum, trans) => {
                return sum + Number(trans.membership_discount || 0);
              }, 0);
              

              
              totalAppointmentDiscounts += appointmentDiscounts;
              discountAmount += appointmentDiscounts;
            }



            // Revenue = Total amount of membership (full price)
            membershipRevenue += planPrice;
            totalDiscountsGiven += discountAmount;
            
            const planName = foundPlan ? foundPlan.membership_name : 'Unknown Plan';
            const existing = membershipBreakdownMap.get(planName) || {
              count: 0,
              revenue: 0,
              discountGiven: 0
            };

            existing.count += 1;
            existing.revenue += planPrice;
            existing.discountGiven += discountAmount;
            
            membershipBreakdownMap.set(planName, existing);
          }
        });

        // If no customers have memberships but we have membership plans, 
        // show potential revenue from plans (for demo purposes)
        if (customersWithMemberships.length === 0 && memberships.length > 0) {
          
          memberships.forEach((plan: any) => {
            const price = Number(plan.price || 0);
            // For available plans, show plan's default discount_percent as potential discount
            const discountPercent = Number(plan.discount_percent || 0);
            const discountAmount = (price * discountPercent) / 100;
            
            const membershipName = `${plan.membership_name} (Available)`;
            const existing = membershipBreakdownMap.get(membershipName) || {
              count: 0,
              revenue: 0,
              discountGiven: 0
            };

            existing.count = 1; // Show as available plan
            existing.revenue = price - discountAmount;
            existing.discountGiven = discountAmount;
            
            membershipBreakdownMap.set(membershipName, existing);
          });
        }

  // Optimized mapping using existing billing data instead of individual API calls
        // This eliminates the N+1 query problem by using data we already have
        try {
          // Use the billing data we already have instead of fetching each invoice individually
          const exactPlanDiscounts = new Map<string, number>();
          let exactTotalDiscount = 0;

          const normalize = (s: any) => (String(s || '').trim().toLowerCase());

          const membershipNameIndex = (memberships || []).map((m: any) => ({
            name: String(m.membership_name || '').trim(),
            norm: normalize(m.membership_name),
            price: Number(m.price || 0)
          }));

          // Process billing data we already have instead of making individual API calls
          (billingData || []).forEach((billing: any) => {
            const headerDiscount = Number(
              billing.membership_discount || 
              billing.txn_membership_discount || 
              billing.discount_first_line || 
              0
            );
            
            if (!headerDiscount || isNaN(headerDiscount) || headerDiscount <= 0) return;

            // 1) Prefer customer-based mapping using existing billing data
            const headerCustomerId = billing.customer_id ?? billing.txn_customer_id;
            const headerCustomerName = billing.customer_name || billing.txn_customer_name;
            const headerCustomerNumber = billing.customer_mobile || billing.customer_number || billing.txn_customer_number;

            const matchedCustomer = (customers as any[]).find((c: any) => {
              const idMatch = (headerCustomerId != null) && (String(c.id) === String(headerCustomerId));
              const nameMatch = headerCustomerName && String(c.customer_name || '').trim().toLowerCase() === String(headerCustomerName || '').trim().toLowerCase();
              const numMatch = headerCustomerNumber && (String(c.customer_mobile || c.customer_number || '') === String(headerCustomerNumber));
              return idMatch || nameMatch || numMatch;
            });

            let mappedByCustomer = false;
            if (matchedCustomer && (matchedCustomer.membership_id != null && matchedCustomer.membership_id !== '')) {
              const plan = (memberships as any[]).find((m: any) => 
                String(m.membership_id) === String(matchedCustomer.membership_id) || String(m.id) === String(matchedCustomer.membership_id)
              );
              if (plan && plan.membership_name) {
                const planName = String(plan.membership_name);
                exactPlanDiscounts.set(planName, (exactPlanDiscounts.get(planName) || 0) + headerDiscount);
                exactTotalDiscount += headerDiscount;
                mappedByCustomer = true;
              }
            }

            // 2) Fallback: service name-based mapping using billing data
            if (!mappedByCustomer) {
              const serviceName = billing.service_name || billing.txn_service_name || '';
              if (serviceName) {
                const serviceNorm = normalize(serviceName);
                const matchedByName = membershipNameIndex.find((m) => m.norm === serviceNorm);
                if (matchedByName) {
                  exactPlanDiscounts.set(matchedByName.name, (exactPlanDiscounts.get(matchedByName.name) || 0) + headerDiscount);
                  exactTotalDiscount += headerDiscount;
                  mappedByCustomer = true;
                }
              }
            }

            // 3) Price-based mapping as final fallback
            if (!mappedByCustomer) {
              const totalAmount = Number(billing.grand_total || billing.total_amount || 0);
              if (totalAmount > 0) {
                const matchedByPrice = membershipNameIndex.find((m) => Math.abs(m.price - totalAmount) < 0.01);
                if (matchedByPrice) {
                  exactPlanDiscounts.set(matchedByPrice.name, (exactPlanDiscounts.get(matchedByPrice.name) || 0) + headerDiscount);
                  exactTotalDiscount += headerDiscount;
                }
              }
            }
          }); // Close the forEach loop for billing data
          
          // Update breakdown map with exact plan discounts
          if (exactPlanDiscounts.size > 0) {
            // Override total discounts and per-plan discountGiven with exact mapping
            totalDiscountsGiven = Array.from(exactPlanDiscounts.values()).reduce((a, b) => a + Number(b || 0), 0);
            // Zero out prior per-plan discounts, then set from exact map
            Array.from(membershipBreakdownMap.keys()).forEach(k => {
              const d = membershipBreakdownMap.get(k)!;
              d.discountGiven = 0;
              membershipBreakdownMap.set(k, d);
            });
            exactPlanDiscounts.forEach((val, planName) => {
              const d = membershipBreakdownMap.get(planName) || { count: 0, revenue: 0, discountGiven: 0 };
              d.discountGiven = Number((d.discountGiven || 0) + Number(val || 0));
              membershipBreakdownMap.set(planName, d);
            });
          }
        } catch (error) {
          // Non-fatal: if exact mapping fails, we keep prior values/fallbacks
        }


        // Fallback: If no discounts found via per-customer matching, sum directly from all data sources
        if (totalDiscountsGiven === 0 && (billingData.length > 0 || appointmentTransData.length > 0)) {
          // Sum from billing data
          const billingFallbackTotal = billingData.reduce((sum: number, billing: any) => {
            const rec = billing.header || billing;
            const v = Number(
              billing.txn_membership_discount ??
              rec?.membership_discount ??
              0
            );
            return sum + (isNaN(v) ? 0 : v);
          }, 0);

          // Sum from appointment transactions data
          const appointmentFallbackTotal = appointmentTransData.reduce((sum: number, trans: any) => {
            const v = Number(trans.membership_discount ?? 0);
            return sum + (isNaN(v) ? 0 : v);
          }, 0);

          totalDiscountsGiven = billingFallbackTotal + appointmentFallbackTotal;
          


          // Also distribute this fallback total across membership plans for the breakdown
          const entries = Array.from(membershipBreakdownMap.entries());
          const totalRevForDistribution = entries.reduce((acc, [, d]) => acc + (Number(d.revenue) || 0), 0);
          const totalCountForDistribution = entries.reduce((acc, [, d]) => acc + (Number(d.count) || 0), 0);
          if (entries.length > 0) {
            if (totalRevForDistribution > 0) {
              // Distribute proportionally by revenue share
              entries.forEach(([key, d], idx) => {
                const share = (Number(d.revenue) || 0) / totalRevForDistribution;
                const allocated = idx === entries.length - 1
                  ? Math.max(0, totalDiscountsGiven - entries.slice(0, idx).reduce((s, [, dd]) => s + (Number((dd as any)._allocatedDiscount) || 0), 0))
                  : Number((totalDiscountsGiven * share).toFixed(2));
                (d as any)._allocatedDiscount = allocated;
              });
              entries.forEach(([key, d]) => {
                d.discountGiven = Number((d as any)._allocatedDiscount || 0);
                delete (d as any)._allocatedDiscount;
                membershipBreakdownMap.set(key, d);
              });
            } else if (totalCountForDistribution > 0) {
              // Distribute equally per member count
              const perMember = totalDiscountsGiven / totalCountForDistribution;
              entries.forEach(([key, d], idx) => {
                const raw = perMember * (Number(d.count) || 0);
                const allocated = idx === entries.length - 1
                  ? Math.max(0, totalDiscountsGiven - entries.slice(0, idx).reduce((s, [, dd]) => s + (Number((dd as any)._allocatedDiscount) || 0), 0))
                  : Number(raw.toFixed(2));
                (d as any)._allocatedDiscount = allocated;
              });
              entries.forEach(([key, d]) => {
                d.discountGiven = Number((d as any)._allocatedDiscount || 0);
                delete (d as any)._allocatedDiscount;
                membershipBreakdownMap.set(key, d);
              });
            }
          }
        }

        // Ensure all known plans appear in breakdown (even with zero stats)
        const normalizedPlans = (memberships || []).map((p: any) => ({
          membership_id: p?.membership_id ?? p?.id,
          id: p?.id,
          membership_name: String(p?.membership_name || 'Unnamed'),
          price: Number(p?.price || 0),
          discount_percent: Number(p?.discount_percent || 0) || 0,
        }));
        try { setMembershipPlans(normalizedPlans); } catch {}

        normalizedPlans.forEach((plan: MembershipPlan) => {
          const name = plan.membership_name;
          if (name && !membershipBreakdownMap.has(name)) {
            membershipBreakdownMap.set(name, { 
              count: 0, 
              revenue: 0, 
              discountGiven: 0
            } as any);
            // Initialize the additional fields
            const entry = membershipBreakdownMap.get(name) as any;
            entry.billingDiscounts = 0;
            entry.appointmentDiscounts = 0;
          }
        });

        // Ensure total discounts include both billing and appointment sources
        const combinedTotalDiscounts = totalBillingDiscounts + totalAppointmentDiscounts;
        
        // If our combined total is different from totalDiscountsGiven, use the higher value
        // This handles cases where exact invoice mapping might have found additional discounts
        const finalTotalDiscounts = Math.max(totalDiscountsGiven, combinedTotalDiscounts);
        

        
        // Force the total to be the sum of all sources for testing
        const forcedTotal = totalBillingDiscounts + totalAppointmentDiscounts + Array.from(membershipBreakdownMap.values()).reduce((sum, data) => sum + (data.discountGiven || 0), 0);


        const membershipProfit = membershipRevenue - finalTotalDiscounts;
        // Set membershipCost for display purposes (not used in calculation)
        const membershipCost = finalTotalDiscounts;



        // Convert breakdown map to array
        const breakdownArray = Array.from(membershipBreakdownMap.entries()).map(([membershipType, data]) => ({
          membershipType,
          count: data.count,
          revenue: data.revenue,
          discountGiven: data.discountGiven,
          billingDiscounts: (data as any).billingDiscounts || 0,
          appointmentDiscounts: (data as any).appointmentDiscounts || 0
        }));

        // Update states
        setStats({
          totalCustomers,
          totalMemberships: customersWithMembership,
          customersWithoutMembership,
          membershipRevenue,
          membershipCost: finalTotalDiscounts, // Use the dynamically calculated total
          membershipProfit: membershipRevenue - finalTotalDiscounts // Recalculate profit with dynamic total
        });
        


        setMembershipBreakdown(breakdownArray);

        // Set discount source breakdown
        setDiscountSourceBreakdown({
          totalBillingDiscounts,
          totalAppointmentDiscounts,
          byMembership: Array.from(discountBreakdownBySource.entries()).map(([membershipType, data]) => ({
            membershipType,
            ...data
          }))
        });



      } catch (err: any) {
        console.error('Error fetching analytics data:', err);
        
        // Handle authentication errors specifically
        if (err.message?.includes('Authentication failed') || err.message?.includes('401')) {
          setError('Authentication expired. Please login again to access Marketing AI.');
        } else if (err.message?.includes('Unauthorized')) {
          setError('Access denied. Please check your permissions or login again.');
        } else {
          setError(err.message || 'Failed to fetch analytics data');
        }
      } finally {
        setLoading(false);
        setLastUpdated(Date.now());
      }
    };

    fetchAnalyticsData();
  }, [user?.account_code, user?.retail_code, refreshTick]);

  const formatCurrency = (amount: number) => {
    return `₹${amount.toLocaleString()}`;
  };

  // Update calculator data when stats change
  useEffect(() => {
    // Keep all calculator values at 0 by default - don't auto-populate from stats
    // This ensures users start with a clean slate for their calculations
  }, [stats.totalCustomers, calculatorData]);

  // Calculate membership metrics automatically
  useEffect(() => {
    const { customerCount, membershipDiscount, perUserVisitCount, avgUserSpentAmount, membershipPrice } = calculatorData;
    
    // Per-user visit count is MONTHLY ⇒ annualize service revenue
    const serviceRevenueAnnual = customerCount * perUserVisitCount * 12 * avgUserSpentAmount;
    
    // Calculate discount amount given to members (applied on service revenue)
    const discountAmount = (serviceRevenueAnnual * membershipDiscount) / 100;
    
    // Calculate net service revenue (after member discounts)
    const netServiceRevenue = serviceRevenueAnnual - discountAmount;
    
    // Calculate membership revenue (membership fees collected)
    const membershipRevenue = customerCount * (membershipPrice || 0); // Dynamic membership fee per member
    
    // Calculate membership profit (fees collected - discount given)
    const membershipProfit = membershipRevenue - discountAmount;
    
    // Calculate total business revenue (services + memberships - discounts)
    const totalBusinessRevenue = netServiceRevenue + membershipRevenue;
    
    // Assume 40% profit margin on net operations
    const totalProfit = totalBusinessRevenue * 0.4;
    
    // Calculate monthly breakdown
    const monthlyRevenue = totalBusinessRevenue / 12;
    const monthlyProfit = totalProfit / 12;
    
    setCalculatorResults({
      monthlyEmi: Math.round(monthlyRevenue), // Reusing field for monthly revenue
      principalAmount: Math.round(membershipProfit), // Changed to membership profit
      totalInterest: Math.round(discountAmount), // Discounts given to members
      totalRevenue: Math.round(totalBusinessRevenue),
      totalProfit: Math.round(totalProfit)
    });
  }, [calculatorData]);

  // AI Chat Functions
  const generateAIResponse = (userMessage: string): string => {
    const message = userMessage.toLowerCase();
    const timestamp = new Date().getTime();
    
    // Calculate dynamic insights
    const avgRevenuePerMember = stats.totalMemberships > 0 ? stats.membershipRevenue / stats.totalMemberships : 0;
    const profitMargin = stats.membershipRevenue > 0 ? ((stats.membershipProfit / stats.membershipRevenue) * 100) : 0;
    const penetrationRate = stats.totalCustomers > 0 ? ((stats.totalMemberships / stats.totalCustomers) * 100) : 0;
    
    // Revenue and improvement queries (most common)
    if (message.includes('revenue') || message.includes('improve') || message.includes('increase')) {
      if (message.includes('membership')) {
        const responses = [
          `📈 **Membership Revenue Optimization:**\n\nCurrent Performance:\n• Total Revenue: ${formatCurrency(stats.membershipRevenue)}\n• Profit Margin: ${profitMargin.toFixed(1)}%\n• Penetration Rate: ${penetrationRate.toFixed(1)}%\n\n🚀 **Quick Wins:**\n• Launch premium tiers (₹2000-3000)\n• Offer family packages (20% extra for 2nd member)\n• Create corporate bulk plans\n• Add exclusive perks for high-value members`,
          
          `💰 **Revenue Growth Strategy:**\n\n📊 **Current Stats:**\n• Average per member: ${formatCurrency(avgRevenuePerMember)}\n• Non-members: ${stats.customersWithoutMembership} (untapped potential)\n• Profit per member: ${formatCurrency(stats.totalMemberships > 0 ? stats.membershipProfit / stats.totalMemberships : 0)}\n\n💡 **Action Plan:**\n• Convert 30% non-members = +${formatCurrency(stats.customersWithoutMembership * 500 * 0.3)}\n• Upsell existing members to premium plans\n• Implement loyalty bonus system\n• Create limited-time upgrades`,
          
          `🎯 **Revenue Enhancement Blueprint:**\n\n${membershipBreakdown.length > 0 ? membershipBreakdown.map(plan => `**${plan.membershipType}**: ${plan.count} members @ ${formatCurrency(plan.revenue/plan.count)}/member`).join('\n') : 'No plan data available'}\n\n🔥 **Revenue Boosters:**\n• Weekend premium pricing (+25%)\n• Seasonal promotional packages\n• Add-on service bundles\n• Referral incentive programs\n• Birthday/anniversary special rates`
        ];
        
        return responses[timestamp % responses.length];
      } else {
        const responses = [
          `💼 **Overall Business Growth Strategy:**\n\n🎯 **Priority Actions:**\n1. Boost membership conversion: ${penetrationRate.toFixed(1)}% → 50% target\n2. Increase average transaction value\n3. Implement dynamic pricing strategies\n4. Launch customer retention programs\n\n📈 **Growth Levers:**\n• Service bundling and upselling\n• Premium time slot pricing\n• Loyalty rewards system\n• Strategic partnerships with local businesses`,
          
          `🚀 **Revenue Acceleration Plan:**\n\n💡 **Immediate Opportunities:**\n• Peak hour premium rates (₹+200/service)\n• Express service charges for quick bookings\n• Group booking discounts to increase volume\n• Seasonal package deals\n\n📊 **Performance Metrics:**\n• Current members: ${stats.totalMemberships}\n• Revenue per customer: ${formatCurrency(stats.totalCustomers > 0 ? stats.membershipRevenue / stats.totalCustomers : 0)}\n• Growth potential: ${formatCurrency(stats.customersWithoutMembership * 600)}`
        ];
        
        return responses[timestamp % responses.length];
      }
    }

    // Plan-specific queries with variety
    if (message.includes('plan') || (message.includes('membership') && !message.includes('revenue'))) {
      if (membershipBreakdown.length > 0) {
        const bestPlan = membershipBreakdown.reduce((prev, current) => 
          (prev.revenue > current.revenue) ? prev : current
        );
        
        const responses = [
          `📋 **Membership Plan Analysis:**\n\n${membershipBreakdown.map(plan => 
            `**${plan.membershipType}**: ${plan.count} members, ${formatCurrency(plan.revenue)} revenue${plan === bestPlan ? ' 👑 TOP PERFORMER' : ''}`
          ).join('\n')}\n\n💎 **New Plan Ideas:**\n• VIP Platinum (₹3500/year): Unlimited + home service\n• Student/Senior (₹800/year): 50% off peak hours\n• Corporate (₹15000/10 employees): Bulk rate\n• Weekend Warrior (₹1200/6mo): Weekend access only`,
          
          `🎯 **Plan Performance Dashboard:**\n\n📈 **Revenue Leaders:**\n${membershipBreakdown.sort((a,b) => b.revenue - a.revenue).slice(0,3).map((plan, idx) => 
            `${idx+1}. ${plan.membershipType}: ${formatCurrency(plan.revenue)} (${plan.count} members)`
          ).join('\n')}\n\n🚀 **Optimization Tips:**\n• Promote top performer: "${bestPlan.membershipType}"\n• Bundle slow movers with popular services\n• Create upgrade paths between tiers\n• Add seasonal limited editions`,
          
          `💰 **Plan Strategy Insights:**\n\n⭐ **Performance Summary:**\nTotal Plans: ${membershipBreakdown.length}\nBest ROI: ${bestPlan.membershipType} (${formatCurrency(bestPlan.revenue)})\nAverage Plan Value: ${formatCurrency(avgRevenuePerMember)}\n\n🎪 **Promotional Ideas:**\n• "Upgrade Month" - 20% off higher tiers\n• "Bring a Friend" - both get 1 month free\n• "Loyalty Ladder" - unlock perks with tenure\n• "Flash Sales" - limited time 48hr offers`
        ];
        
        return responses[timestamp % responses.length];
      } else {
        return "🆕 **Starting Fresh?** Perfect timing to create compelling membership plans!\n\n💡 **Starter Plan Suggestions:**\n• **Basic** (₹999/year): Monthly styling + 20% off products\n• **Premium** (₹1999/year): Unlimited basic + quarterly deep treatment\n• **VIP** (₹2999/year): Everything + home service + exclusive events\n\nStart with 2-3 tiers and expand based on customer feedback!";
      }
    }
    
    // Marketing and promotion queries
    if (message.includes('marketing') || message.includes('promote') || message.includes('advertise')) {
      const responses = [
        `� **Digital Marketing Strategy:**\n\n📱 **Social Media Blitz:**\n• Instagram: Before/after transformation reels\n• Facebook: Customer testimonial campaigns\n• WhatsApp: Personalized birthday offers\n• Google My Business: Regular photo updates\n\n🎯 **Campaign Ideas:**\n• #SalonTransformation challenge\n• "Member Monday" exclusive content\n• Live styling tutorials\n• Behind-the-scenes content`,
        
        `🎨 **Creative Marketing Tactics:**\n\n💡 **Community Engagement:**\n• Partner with wedding planners\n• Host beauty workshops (₹500/person)\n• Collaborate with fashion boutiques\n• Sponsor local events\n\n📧 **Retention Marketing:**\n• Personalized email newsletters\n• Birthday month special campaigns\n• Service reminder notifications\n• Seasonal beauty tips series`,
        
        `🚀 **Growth Marketing Playbook:**\n\n🔥 **Viral Strategies:**\n• Referral contests with prizes\n• "Makeover Monday" social series\n• Customer spotlight features\n• Trending hashtag participation\n\n💰 **ROI-Focused Campaigns:**\n• Google Ads for "salon near me"\n• Facebook targeting competitor followers\n• Instagram shopping for products\n• Local newspaper beauty column`
      ];
      
      return responses[timestamp % responses.length];
    }

    // Customer and retention queries
    if (message.includes('customer') || message.includes('client') || message.includes('retention')) {
      const responses = [
        `👥 **Customer Intelligence Report:**\n\nTotal Customers: ${stats.totalCustomers}\nMembers: ${stats.totalMemberships} (${penetrationRate.toFixed(1)}%)\nNon-members: ${stats.customersWithoutMembership}\n\n🎯 **Conversion Opportunities:**\n• Target non-members with trial offers\n• Survey why customers haven't joined\n• Create entry-level affordable plans\n• Offer "first month free" trials`,
        
        `💪 **Customer Retention Mastery:**\n\n📊 **Current Metrics:**\n• Member loyalty rate: ${penetrationRate.toFixed(1)}%\n• Average member value: ${formatCurrency(avgRevenuePerMember)}\n\n🏆 **Retention Strategies:**\n• Loyalty points system (1 point = ₹1)\n• Birthday month 50% off everything\n• Milestone rewards (6mo, 1yr, 2yr)\n• Exclusive member-only events\n• Personalized service recommendations`,
        
        `🎪 **Customer Experience Excellence:**\n\n✨ **Service Enhancement:**\n• Welcome drinks and comfort amenities\n• Complimentary consultation updates\n• Follow-up care messages\n• Styling maintenance tutorials\n\n💝 **Surprise & Delight:**\n• Random upgrade surprises\n• Seasonal gift packages\n• Partner business discounts\n• Priority booking privileges`
      ];
      
      return responses[timestamp % responses.length];
    }

    // Financial and pricing analysis
    if (message.includes('profit') || message.includes('money') || message.includes('price') || message.includes('cost')) {
      const responses = [
        `💰 **Financial Performance Analysis:**\n\nRevenue: ${formatCurrency(stats.membershipRevenue)}\nCosts: ${formatCurrency(stats.membershipCost)}\nProfit: ${formatCurrency(stats.membershipProfit)}\nMargin: ${profitMargin.toFixed(1)}%\n\n📈 **Optimization Areas:**\n• Target margin: 40-60%\n• Reduce discount dependency\n• Introduce premium services\n• Optimize operational costs`,
        
        `💳 **Pricing Strategy Intelligence:**\n\nCurrent avg/member: ${formatCurrency(avgRevenuePerMember)}\nIndustry benchmark: ₹1500-2500\nYour position: ${avgRevenuePerMember > 2000 ? 'Premium' : avgRevenuePerMember > 1000 ? 'Competitive' : 'Budget'}\n\n🎯 **Pricing Actions:**\n• A/B test 15% price increase\n• Bundle services for higher value\n• Create premium tier at ₹2500+\n• Implement dynamic seasonal pricing`,
        
        `📊 **Revenue Optimization Dashboard:**\n\nPer-member profit: ${formatCurrency(stats.totalMemberships > 0 ? stats.membershipProfit / stats.totalMemberships : 0)}\nDiscount rate: ${stats.membershipRevenue > 0 ? ((stats.membershipCost / stats.membershipRevenue) * 100).toFixed(1) : 0}%\nRevenue efficiency: ${penetrationRate > 30 ? '🟢 Strong' : penetrationRate > 15 ? '🟡 Moderate' : '🔴 Needs focus'}\n\n💡 **Quick Wins:**\n• Reduce discounts by 5-10%\n• Add premium add-ons\n• Implement peak pricing\n• Create annual payment incentives`
      ];
      
      return responses[timestamp % responses.length];
    }

    // System usage and functionality queries
    if (message.includes('how to') || message.includes('how do') || message.includes('create') || message.includes('make') || message.includes('add') || message.includes('use')) {
      // Appointment creation
      if (message.includes('appointment') || message.includes('booking')) {
        return `📅 **How to Create Appointments:**\n\n🎯 **Step-by-Step Guide:**\n1. **Navigate:** Go to "Appointments" from the sidebar\n2. **New Appointment:** Click the "+" or "Create New" button\n3. **Date & Time:** Select appointment date and time slots\n4. **Staff Selection:** Choose available staff member\n5. **Customer Details:** Enter or search customer name and phone\n6. **Services:** Select services to be performed\n7. **Pricing:** Set prices, discounts, and payment details\n\n💡 **Pro Tips:**\n• Use the calendar view to see availability\n• Auto-suggestions help find existing customers\n• Time slots show conflicts automatically\n• Apply membership discounts for members\n• Set payment status (Pending/Advance/Settled)\n\n⚡ **Quick Actions:**\n• Duplicate previous appointments\n• Bulk time slot selection\n• Staff-specific availability filtering\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Appointments Page → /appointments`;
      }

      // Billing and invoice creation
      if (message.includes('bill') || message.includes('invoice') || message.includes('payment')) {
        return `💰 **How to Create Bills & Invoices:**\n\n📋 **Billing Process:**\n1. **From Appointments:** Convert appointments to bills directly\n2. **New Bill:** Go to "Billing" → "Create New Invoice"\n3. **Customer Info:** Select customer (auto-fills from appointments)\n4. **Services:** Add services with quantities and prices\n5. **Calculations:** System auto-calculates taxes (CGST/SGST)\n6. **Discounts:** Apply membership or promotional discounts\n7. **Payment:** Record payment method and amount\n\n🧮 **Tax & Calculations:**\n• Automatic GST calculation (18% split as 9% CGST + 9% SGST)\n• Service-wise tax rates supported\n• Membership discount auto-applied\n• Multiple payment modes (Cash, Card, UPI, etc.)\n\n📄 **Invoice Features:**\n• Print professional invoices\n• Email to customers\n• Track payment status\n• Generate reports\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Create Booking → /create-booking\n👆 Click here to go to: Reports (Bills) → /reports`;
      }

      // Customer management
      if (message.includes('customer') || message.includes('client') && (message.includes('add') || message.includes('create'))) {
        return `👥 **How to Manage Customers:**\n\n📝 **Add New Customer:**\n1. **Navigate:** Go to "Master Modules" → "Customers"\n2. **Create:** Click "Add New Customer"\n3. **Details:** Fill basic info (Name, Phone, Email, Address)\n4. **Membership:** Assign membership plan if applicable\n5. **Preferences:** Add service preferences and notes\n\n🔍 **Customer Features:**\n• Smart search by name or phone\n• View appointment history\n• Track total visits and spending\n• Manage membership status\n• Birthday and anniversary tracking\n\n📊 **Customer Insights:**\n• Total visits and revenue per customer\n• Preferred services and staff\n• Payment history and outstanding dues\n• Membership utilization reports\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Customer Management → /master/customers`;
      }

      // Staff management
      if (message.includes('staff') || message.includes('employee')) {
        return `👨‍💼 **How to Manage Staff:**\n\n🏢 **Staff Setup:**\n1. **Navigate:** Go to "Master Modules" → "Staff"\n2. **Add Staff:** Click "Create New Staff"\n3. **Details:** Enter name, contact, specialization\n4. **Pricing:** Set service markups and commission rates\n5. **Permissions:** Assign access levels and modules\n6. **Schedule:** Set working hours and availability\n\n💼 **Staff Features:**\n• Individual performance tracking\n• Commission calculation\n• Service specialization tags\n• Availability calendar management\n• Target setting and monitoring\n\n📈 **Performance Metrics:**\n• Revenue generated per staff\n• Customer satisfaction ratings\n• Service completion rates\n• Attendance and punctuality tracking\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Staff Management → /master/staff`;
      }

      // Service management
      if (message.includes('service') && (message.includes('add') || message.includes('create'))) {
        return `✂️ **How to Manage Services:**\n\n🎨 **Service Setup:**\n1. **Navigate:** Go to "Master Modules" → "Services"\n2. **Create:** Click "Add New Service"\n3. **Details:** Enter service name, description, category\n4. **Pricing:** Set base price and duration\n5. **Tax Config:** Assign tax rates and HSN codes\n6. **Staff:** Link compatible staff members\n\n🏷️ **Service Categories:**\n• Hair Services (Cut, Color, Treatment)\n• Skin Care (Facial, Cleanup, Massage)\n• Nail Care (Manicure, Pedicure, Art)\n• Spa Services (Body Massage, Therapy)\n• Bridal Packages (Complete wedding prep)\n\n⚙️ **Advanced Settings:**\n• Variable pricing by staff level\n• Seasonal pricing adjustments\n• Package deals and combos\n• Membership-specific discounts\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Service Management → /master/services`;
      }

      // Reports and analytics
      if (message.includes('report') || message.includes('analytics') || message.includes('data')) {
        return `📊 **How to Access Reports & Analytics:**\n\n📈 **Report Types:**\n1. **Sales Reports:** Daily/Monthly revenue analysis\n2. **Staff Performance:** Individual staff metrics\n3. **Customer Reports:** Visit frequency and spending\n4. **Service Analysis:** Popular services and profitability\n5. **Membership Reports:** Plan performance and renewals\n\n🎯 **Accessing Reports:**\n1. **Navigate:** Go to "Reports" from sidebar\n2. **Select Type:** Choose report category\n3. **Date Range:** Set from/to dates\n4. **Filters:** Apply staff, service, or customer filters\n5. **Generate:** Click to create report\n6. **Export:** Download as Excel/PDF\n\n💡 **Report Features:**\n• Real-time data updates\n• Customizable date ranges\n• Multiple export formats\n• Graphical visualizations\n• Automated email scheduling\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Reports & Analytics → /reports`;
      }

      // General system usage
      return `🖥️ **General System Usage Guide:**\n\n🚀 **Getting Started:**\n1. **Dashboard:** Overview of daily activities\n2. **Sidebar Navigation:** Access all modules\n3. **Search:** Use global search for quick access\n4. **Quick Actions:** Common tasks via shortcuts\n\n📱 **Key Modules:**\n• **Appointments:** Booking and scheduling\n• **Billing:** Invoice creation and payments\n• **Marketing AI:** Business insights and strategies\n• **Master Modules:** Customer, Staff, Services setup\n• **Reports:** Performance analytics and tracking\n• **Settings:** System configuration\n\n💡 **Pro Tips:**\n• Use keyboard shortcuts for faster navigation\n• Set up user permissions for team access\n• Regular data backup and system updates\n• Customize settings for your business needs\n\n🔗 **Quick Navigation:**\n👆 Click here to go to: Dashboard → /dashboard\n👆 Click here to go to: All Appointments → /appointments\n👆 Click here to go to: Settings → /settings\n\n❓ **Need Specific Help?** Ask me about:\n"How to create appointments", "How to make bills", "How to add customers", "How to generate reports"`;
    }

    // Trends and innovation queries
    if (message.includes('trend') || message.includes('new') || message.includes('innovation') || message.includes('future')) {
      const responses = [
        `🌟 **2025 Beauty & Salon Trends:**\n\n💅 **Hot Services:**\n• K-beauty glass skin facials\n• Scalp health treatments\n• Sustainable/eco beauty\n• Men's grooming expansion\n• Brow lamination & microblading\n\n📱 **Tech Integration:**\n• AR try-on filters\n• AI skin analysis\n• Online consultation booking\n• Virtual beauty tutorials`,
        
        `🔮 **Future-Proofing Your Salon:**\n\n🚀 **Innovation Opportunities:**\n• Subscription beauty boxes\n• Mobile salon services\n• Wellness integration (yoga/meditation)\n• Personalized product lines\n• Community beauty workshops\n\n💡 **Technology Adoption:**\n• Smart mirrors with tutorials\n• Automated appointment reminders\n• Customer mood/preference tracking\n• Social media integration tools`,
        
        `✨ **Trending Business Models:**\n\n🎪 **Experience Economy:**\n• Themed styling sessions\n• Instagram-worthy selfie stations\n• Group event packages\n• Beauty masterclass workshops\n• Seasonal transformation challenges\n\n🌱 **Sustainability Focus:**\n• Eco-friendly product lines\n• Waste reduction programs\n• Carbon-neutral services\n• Community green initiatives`
      ];
      
      return responses[timestamp % responses.length];
    }

    // Default responses with variety
    const defaultResponses = [
      `🤖 **Your AI Marketing Assistant is Ready!**\n\nBased on your current ${stats.totalMemberships} members generating ${formatCurrency(stats.membershipRevenue)} revenue:\n\n� **Discount Analysis:**\n• Total Discounts: ${formatCurrency(discountSourceBreakdown.totalBillingDiscounts + discountSourceBreakdown.totalAppointmentDiscounts)}\n• From Billing: ${formatCurrency(discountSourceBreakdown.totalBillingDiscounts)}\n• From Appointments: ${formatCurrency(discountSourceBreakdown.totalAppointmentDiscounts)}\n\n�💬 **Ask me about:**\n• "How can I improve membership revenue?"\n• "What marketing strategies work best?"\n• "How to create appointments?"\n• "How to make bills and invoices?"\n• "How to add new customers?"\n\n🎯 **Today's Insight:** ${penetrationRate < 25 ? 'Focus on membership conversion - huge untapped potential!' : 'Great membership base! Time to optimize pricing and retention.'}`,
      
      `🎯 **Strategic Business & System Assistant at Your Service!**\n\nQuick snapshot: ${penetrationRate.toFixed(1)}% membership rate, ${profitMargin.toFixed(1)}% profit margin\n\n🔍 **I can help with:**\n• Revenue optimization strategies\n• System functionality guidance\n• Customer management tips\n• Appointment booking process\n• Billing and payment workflows\n\n💡 **Pro Tip:** Ask specific questions like "How to create a bill?" or "How to add staff members?"`,
      
      `📈 **Complete Retail Management Advisor Ready!**\n\nYour store metrics: ${stats.totalCustomers} customers, ${stats.totalMemberships} members, ${formatCurrency(avgRevenuePerMember)}/member avg\n\n🎪 **I can guide you through:**\n• Business strategy and growth\n• System features and workflows\n• Customer management processes\n• Staff and access setup\n• Reports and analytics usage\n\n🚀 **Try asking:** "How do I create invoices?" or "How to generate reports?"`
    ];
    
    return defaultResponses[timestamp % defaultResponses.length];
  };

  const handleSendMessage = () => {
    if (!currentMessage.trim()) return;
    
    const userMsg = {
      id: Date.now() + '-user',
      type: 'user' as const,
      message: currentMessage,
      timestamp: new Date()
    };
    
    setChatMessages(prev => [...prev, userMsg]);
    setCurrentMessage('');
    setAiTyping(true);
    
    // Simulate AI thinking time
    setTimeout(() => {
      const aiResponse = generateAIResponse(currentMessage);
      const aiMsg = {
        id: Date.now() + '-ai',
        type: 'ai' as const,
        message: aiResponse,
        timestamp: new Date()
      };
      
      setChatMessages(prev => [...prev, aiMsg]);
      setAiTyping(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewChat = () => {
    setChatMessages([]);
    setCurrentMessage('');
    setAiTyping(false);
  };

  const formatPercentOrDash = (value: number | null | undefined, digits: number = 1) => {
    if (value === null || value === undefined) return '-';
    if (!Number.isFinite(value)) return '-';
    return `${value.toFixed(digits)}%`;
  };

  const profitMarginValue = stats.membershipRevenue > 0
    ? ((stats.membershipProfit / stats.membershipRevenue) * 100)
    : null;
  const membershipPenetrationValue = stats.totalCustomers > 0
    ? ((stats.totalMemberships / stats.totalCustomers) * 100)
    : null;

  const profitMarginDisplay = formatPercentOrDash(profitMarginValue, 1);
  const membershipPenetrationDisplay = formatPercentOrDash(membershipPenetrationValue, 1);
  // Additional KPIs for Financial Overview
  const avgRevenuePerMember = stats.totalMemberships > 0 ? (stats.membershipRevenue / stats.totalMemberships) : 0;
  const avgDiscountPerMember = stats.totalMemberships > 0 ? (stats.membershipCost / stats.totalMemberships) : 0;
  const discountRatePct = stats.membershipRevenue > 0 ? ((stats.membershipCost / stats.membershipRevenue) * 100).toFixed(1) : '0.0';


  // Removed loading screen to display the page immediately with default values while data loads

  if (error) {
    const isAuthError = error.includes('Authentication') || error.includes('login') || error.includes('Access denied');
    
    return (
      <div className="min-h-screen">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-red-500 mb-4">
              <BarChart3 className="w-6 h-6 mx-auto" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Failed to Load Analytics</h3>
            <p className="text-gray-600 mb-4">{error}</p>
            <div className="space-x-2">
              {isAuthError ? (
                <button
                  onClick={() => window.location.href = '/login'}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                >
                  Go to Login
                </button>
              ) : (
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => setError(null)}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
              >
                Clear Error
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 py-1.5 space-y-2 bg-gray-50 min-h-screen text-[13px]">
      {/* Header */}


      {/* Debug Info - Remove after testing
      <Card className="shadow-lg border-2 border-yellow-200 bg-yellow-50/80 backdrop-blur mb-4">
        <CardHeader>
          <CardTitle className="text-yellow-800">Debug Information</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <p><strong>User:</strong> {user?.username || 'Not logged in'}</p>
              <p><strong>Account Code:</strong> {user?.account_code || 'Missing'}</p>
              <p><strong>Retail Code:</strong> {user?.retail_code || 'Missing'}</p>
            </div>
            <div>
              <p><strong>Total Customers:</strong> {stats.totalCustomers}</p>
              <p><strong>With Memberships:</strong> {stats.totalMemberships}</p>
              <p><strong>Without Memberships:</strong> {stats.customersWithoutMembership}</p>
            </div>
            <div>
              <p><strong>Available Plans:</strong> {membershipBreakdown.length}</p>
              <p><strong>Total Revenue:</strong> ₹{stats.membershipRevenue.toLocaleString()}</p>
              <p><strong>Membership Discount:</strong> ₹{stats.membershipCost.toLocaleString()}</p>
            </div>
            <div>
              <p><strong>Data Source:</strong> Membership Plans + Billing + Appointment Transactions</p>
              <p><strong>Calculation:</strong> Revenue = Sum(plan price per member); Membership Discount = Sum(billing + appointment transactions membership_discount)</p>
              <p><strong>Error:</strong> {error || 'None'}</p>
            </div>
          </div>
        </CardContent>
      </Card> */}

      {/* Page toolbar */}
      <div className="mb-2 rounded-lg border border-slate-200 bg-white/80 backdrop-blur px-3 py-2 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-semibold text-slate-900 leading-tight">Marketing AI</h1>
              <Badge variant="secondary" className="text-[10px]">Insights</Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCalculator(true)}
              className="h-8 rounded-full border-purple-200 text-purple-700 bg-white hover:bg-purple-50 hover:text-purple-800"
              title="Membership Calculator"
            >
              <Calculator className="w-4 h-4" />
              Calculate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAIChat(true)}
              className="h-8 rounded-full border-blue-200 text-blue-700 bg-white hover:bg-blue-50 hover:text-blue-800"
              title="Open AI Assistant"
            >
              <Bot className="w-4 h-4" />
              Open AI Assistant
            </Button>
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600 font-medium">Total Customers</p>
                <p className="text-2xl font-bold text-blue-600">{stats.totalCustomers.toLocaleString()}</p>
                <p className="text-xs text-gray-500 mt-1">All registered customers</p>
              </div>
              <Users className="w-6 h-6 text-blue-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600 font-medium">Total Memberships</p>
                <p className="text-2xl font-bold text-purple-600">{stats.totalMemberships}</p>
                <p className="text-xs text-green-600 mt-1">{membershipPenetrationDisplay} penetration</p>
              </div>
              <Crown className="w-6 h-6 text-purple-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600 font-medium">Without Membership</p>
                <p className="text-2xl font-bold text-orange-600">{stats.customersWithoutMembership}</p>
                <p className="text-xs text-gray-500 mt-1">Potential members</p>
              </div>
              <UserX className="w-6 h-6 text-orange-600 opacity-80" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-600 font-medium">Membership Profit</p>
                <p className="text-2xl font-bold text-green-600">{formatCurrency(stats.membershipProfit)}</p>
                <p className="text-xs text-green-600 mt-1">{profitMarginDisplay} margin</p>
              </div>
              <TrendingUp className="w-6 h-6 text-green-600 opacity-80" />
            </div>
          </CardContent>
        </Card>
      </div>


      {/* Membership overview section (combined layout) */}
      <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x">
            {/* Membership Financial Summary */}
            <div className="p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <IndianRupee className="w-4 h-4 text-green-600" />
                  <h2 className="text-base font-semibold text-slate-900">Membership Financial Overview</h2>
                </div>
              </div>

              <div className="space-y-3">
            <div className="space-y-2.5">
              <div className="flex justify-between items-center p-2.5 bg-green-50 rounded-md border border-green-100">
                <span className="font-medium text-gray-700">Total Revenue</span>
                <span className="font-bold text-green-600 text-base">{formatCurrency(stats.membershipRevenue)}</span>
              </div>
              
              <div className="flex justify-between items-center p-2.5 bg-red-50 rounded-md border border-red-100">
                <span className="font-medium text-gray-700">Membership Discount</span>
                <span className="font-bold text-red-600 text-base">{formatCurrency(stats.membershipCost)}</span>
              </div>
              
              <div className="flex justify-between items-center p-2.5 bg-blue-50 rounded-md border border-blue-100">
                <span className="font-medium text-gray-700">Net Profit</span>
                <span className="font-bold text-blue-600 text-base">{formatCurrency(stats.membershipProfit)}</span>
              </div>
            </div>

            {/* Additional KPIs */}
            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="rounded-md border border-slate-200 p-2 bg-white">
                <div className="text-[11px] text-gray-500">Avg Revenue / Member</div>
                <div className="text-sm font-semibold text-slate-800">{formatCurrency(avgRevenuePerMember)}</div>
              </div>
              <div className="rounded-md border border-slate-200 p-2 bg-white">
                <div className="text-[11px] text-gray-500">Avg Discount / Member</div>
                <div className="text-sm font-semibold text-red-600">{formatCurrency(avgDiscountPerMember)}</div>
              </div>
              <div className="rounded-md border border-slate-200 p-2 bg-white">
                <div className="text-[11px] text-gray-500">Discount Rate</div>
                <div className="text-sm font-semibold text-emerald-700">{discountRatePct}%</div>
              </div>
            </div>

            {/* Discount sources split */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-gray-500">Sources:</span>
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-[11px] border border-emerald-200">
                Billing: {formatCurrency(discountSourceBreakdown.totalBillingDiscounts || 0)}
              </span>
              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[11px] border border-indigo-200">
                Appointments: {formatCurrency(discountSourceBreakdown.totalAppointmentDiscounts || 0)}
              </span>
            </div>

            <div className="pt-3 border-t">
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <div className="text-xl font-bold text-purple-600">{membershipPenetrationDisplay}</div>
                  <div className="text-xs text-gray-600">Membership Rate</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-green-600">{profitMarginDisplay}</div>
                  <div className="text-xs text-gray-600">Profit Margin</div>
                </div>
              </div>
            </div>
              </div>
            </div>

            {/* Membership Breakdown */}
            <div className="p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  <h2 className="text-base font-semibold text-slate-900">Membership Breakdown</h2>
                </div>
              </div>

              <div className="space-y-4">
              {membershipBreakdown.length > 0 ? (
                membershipBreakdown.map((membership, index) => (
                  <div key={index} className="rounded-md p-3 bg-white border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-gray-900">{membership.membershipType}</h3>
                      <Badge variant="secondary">{membership.count} members</Badge>
                    </div>
                    
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="font-medium text-gray-500">Revenue:</span>
                        <p className="text-green-600 font-semibold">{formatCurrency(membership.revenue)}</p>
                      </div>
                      <div>
                        <span className="font-medium text-gray-500">Total Discounts:</span>
                        <p className="text-orange-600 font-semibold">{formatCurrency(membership.discountGiven)}</p>
                      </div>
                    </div>
                    
                    <div className="mt-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Revenue per Member</span>
                        <span>{membership.count > 0 ? formatCurrency(membership.revenue / membership.count) : '₹0'}</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-1.5 rounded-full" 
                          style={{ 
                            width: membershipBreakdown.length > 0 
                              ? `${(membership.revenue / Math.max(...membershipBreakdown.map(m => m.revenue))) * 100}%` 
                              : '0%'
                          }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <UserX className="w-8 h-8 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No Membership Data</h3>
                  <p className="text-gray-500">No membership types found in the system.</p>
                </div>
              )}
            </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Fee Suggestions */}
      <div>
        <Card className="bg-white rounded-lg border border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span>AI Suggestions: Target Profit Pricing</span>
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRefreshTick((t) => t + 1)}
                className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                Recalculate
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowAIChat(true)}
                className="h-8 border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Brain className="w-4 h-4" />
                Ask AI
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {(() => {
              // Compute per-plan suggestions using current data
              const targets = [0.5, 0.4, 0.3, 0.2, 0.1];
              const roundTo = (value: number, step = 10) => {
                if (!isFinite(value)) return 0;
                return Math.max(0, Math.round(value / step) * step);
              };

              // Build a map of observed metrics by plan name
              const observedIndex = new Map<string, MembershipBreakdown>();
              (membershipBreakdown || []).forEach((m) => observedIndex.set(m.membershipType, m));

              // Iterate over all known plans (dynamic)
              const planSource = (membershipPlans && membershipPlans.length > 0) ? membershipPlans : [];

              const suggestions: FeeSuggestion[] = planSource.map((plan) => {
                const obs = observedIndex.get(plan.membership_name);
                const count = Number(obs?.count || 0);
                const observedPrice = count > 0 ? Number(obs?.revenue || 0) / count : 0;
                const planPrice = Number(plan.price || 0);
                const currentPrice = observedPrice > 0 ? observedPrice : planPrice;
                // Cost per member -> use observed avg discount if available, otherwise fallback to plan's discount_percent
                const observedAvgDiscount = count > 0 ? Number(obs?.discountGiven || 0) / count : 0;
                const fallbackAvgDiscount = currentPrice * ((Number(plan.discount_percent || 0) || 0) / 100);
                const avgDiscount = observedAvgDiscount > 0 ? observedAvgDiscount : fallbackAvgDiscount;
                const currentMargin = currentPrice > 0 ? ((currentPrice - avgDiscount) / currentPrice) : 0;

                const t: FeeSuggestionTarget[] = targets.map((margin) => {
                  // price = cost / (1 - margin)
                  const rawFee = (1 - margin) > 0 ? (avgDiscount / (1 - margin)) : currentPrice;
                  const requiredFee = roundTo(rawFee, 10);
                  const delta = requiredFee - currentPrice;
                  return { margin, requiredFee, delta };
                });

                return {
                  membershipType: plan.membership_name,
                  currentPrice: Math.round(currentPrice),
                  avgDiscount: Math.round(avgDiscount),
                  currentMargin,
                  targets: t
                };
              });

              if (!suggestions.length) {
                return (
                  <div className="text-center py-6 text-gray-500">No membership data available for suggestions.</div>
                );
              }

              const fmt = (v: number) => `₹${v.toLocaleString()}`;
              const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

              return (
                <div className="space-y-3">
                  {suggestions.map((s, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <h3 className="font-semibold text-slate-900">{s.membershipType}</h3>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary" className="text-[11px]">
                            Current Fee: <span className="font-semibold">{fmt(s.currentPrice)}</span>
                          </Badge>
                          <Badge variant="secondary" className="text-[11px]">
                            Avg Discount: <span className="font-semibold text-red-600">{fmt(s.avgDiscount)}</span>
                          </Badge>
                          <Badge variant="secondary" className="text-[11px]">
                            Current Margin: <span className="font-semibold text-blue-600">{pct(s.currentMargin)}</span>
                          </Badge>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-2.5">
                        {s.targets.map((t, i) => (
                          <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between mb-1">
                              <div className="text-xs text-slate-500">Target Margin</div>
                              <div className="text-xs font-semibold text-slate-900">{pct(t.margin)}</div>
                            </div>
                            <div className="text-xs text-slate-500">Proposed Fee</div>
                            <div className="text-base font-semibold text-emerald-700">{fmt(t.requiredFee)}</div>
                            <div className={`text-xs mt-1 ${t.delta > 0 ? 'text-emerald-700' : t.delta < 0 ? 'text-orange-700' : 'text-slate-500'}`}>
                              {t.delta === 0 ? 'No change' : t.delta > 0 ? `Increase by ${fmt(Math.abs(t.delta))}` : `Decrease by ${fmt(Math.abs(t.delta))}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  <p className="text-[11px] text-slate-500">
                    Note: Calculations use observed average discount per member as cost. Prices rounded to nearest ₹10 for practical pricing.
                  </p>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Calculator Modal */}
      {showCalculator && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-2">
          <div className="bg-white rounded-lg h-40rem w-full max-w-2xl overflow-hidden text-[13px] leading-tight">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-2 py-1.5 rounded-t-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 bg-purple-100 rounded-md">
                    <Calculator className="w-3.5 h-3.5 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900">Membership Revenue Calculator</h2>
         
                  </div>
                </div>
                <button
                  onClick={() => setShowCalculator(false)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-gray-500" />
                </button>
              </div>
            </div>

            <div className="p-3">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {/* Left Side - Input Parameters */}
                <div className="space-y-3">
                  <div>
                   
                    
                    {/* Customer Count */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-700">Customer Count</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={calculatorData.customerCount === 0 ? '' : calculatorData.customerCount}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, isNaN(raw) ? 0 : raw);
                            setCalculatorData(prev => ({ ...prev, customerCount: v }));
                          }}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded-md text-right"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="10000"
                          step="1"
                          value={Math.min(calculatorData.customerCount, 10000)}
                          onChange={(e) => setCalculatorData(prev => ({...prev, customerCount: Number(e.target.value)}))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                        />
                        <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                          <span>0</span>
                          <span>10000+</span>
                        </div>
                      </div>
                    </div>

                    {/* Membership Discount */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-700">Membership Discount (%)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={calculatorData.membershipDiscount === 0 ? '' : calculatorData.membershipDiscount}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, isNaN(raw) ? 0 : raw);
                            setCalculatorData(prev => ({ ...prev, membershipDiscount: v }));
                          }}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded-md text-right"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.min(calculatorData.membershipDiscount, 100)}
                          onChange={(e) => setCalculatorData(prev => ({...prev, membershipDiscount: Number(e.target.value)}))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                        />
                        <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                          <span>0%</span>
                          <span>100%+</span>
                        </div>
                      </div>
                    </div>

                    {/* Per User Visit Count */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-700">Per User Visit Count (Monthly)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={calculatorData.perUserVisitCount === 0 ? '' : calculatorData.perUserVisitCount}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, isNaN(raw) ? 0 : raw);
                            setCalculatorData(prev => ({ ...prev, perUserVisitCount: v }));
                          }}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded-md text-right"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.min(calculatorData.perUserVisitCount, 100)}
                          onChange={(e) => setCalculatorData(prev => ({...prev, perUserVisitCount: Number(e.target.value)}))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                        />
                        <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                          <span>0</span>
                          <span>100+</span>
                        </div>
                      </div>
                    </div>

                    {/* Average User Spent Amount */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-700">Average User Spent Amount (₹)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={calculatorData.avgUserSpentAmount === 0 ? '' : calculatorData.avgUserSpentAmount}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, isNaN(raw) ? 0 : raw);
                            setCalculatorData(prev => ({ ...prev, avgUserSpentAmount: v }));
                          }}
                          className="w-20 px-2 py-1 text-xs border border-gray-300 rounded-md text-right"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="50000"
                          step="100"
                          value={Math.min(calculatorData.avgUserSpentAmount, 50000)}
                          onChange={(e) => setCalculatorData(prev => ({...prev, avgUserSpentAmount: Number(e.target.value)}))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                        />
                        <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                          <span>₹0</span>
                          <span>₹50000+</span>
                        </div>
                      </div>
                    </div>

                    {/* Membership Price per Member */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-gray-700">Membership Price (₹/member)</label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={calculatorData.membershipPrice === 0 ? '' : calculatorData.membershipPrice}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const v = Math.max(0, isNaN(raw) ? 0 : raw);
                            setCalculatorData(prev => ({ ...prev, membershipPrice: v }));
                          }}
                          className="w-24 px-2 py-1 text-xs border border-gray-300 rounded-md text-right"
                        />
                      </div>
                      <div className="relative">
                        <input
                          type="range"
                          min="0"
                          max="50000"
                          step="50"
                          value={Math.min(calculatorData.membershipPrice, 50000)}
                          onChange={(e) => setCalculatorData(prev => ({...prev, membershipPrice: Number(e.target.value)}))}
                          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-teal-600"
                        />
                        <div className="flex justify-between text-[11px] text-gray-500 mt-0.5">
                          <span>₹0</span>
                          <span>₹50000+</span>
                        </div>
                      </div>
                    </div>


                  </div>
                </div>

                {/* Right Side - Results */}
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-semibold text-gray-900 mb-2">Results</h3>
                    
                    {/* Membership Profit Display */}
                    <div className="bg-gradient-to-r from-teal-50 to-cyan-50 rounded-lg p-3 mb-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-gray-600">Membership Profit</span>
                      </div>
                      <div className={`text-xl font-bold mb-2 ${
                        calculatorResults.principalAmount >= 0 
                          ? 'text-teal-600' 
                          : 'text-red-600'
                      }`}>
                        {calculatorResults.principalAmount >= 0 ? '₹' : '-₹'} {Math.abs(calculatorResults.principalAmount).toLocaleString()}
                      </div>
                    </div>

                    {/* Metrics Cards */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
                        <span className="text-xs font-medium text-gray-600">Total Membership Amount Collected</span>
                        <span className="text-sm font-semibold text-blue-600">
                          ₹{(calculatorData.customerCount * calculatorData.membershipPrice).toLocaleString()}
                        </span>
                      </div>

                      {calculatorResults.totalInterest > 0 && (
                        <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
                          <span className="text-xs font-medium text-gray-600">Total Member Discounts</span>
                          <span className="text-sm font-semibold text-red-600">
                            ₹{calculatorResults.totalInterest.toLocaleString()}
                          </span>
                        </div>
                      )}

                      
                      <div className="flex justify-between items-center py-1.5 border-b border-gray-200">
                        <span className="text-xs font-medium text-gray-600">Membership Profit</span>
                        <span className={`text-sm font-semibold ${
                          calculatorResults.principalAmount >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {calculatorResults.principalAmount >= 0 ? '₹' : '-₹'}{Math.abs(calculatorResults.principalAmount).toLocaleString()}
                        </span>
                      </div>
                      


                      {/* Membership ROI */}
                      <div className={`rounded-lg p-2 mt-2 ${
                        calculatorResults.principalAmount >= 0 ? 'bg-green-50' : 'bg-red-50'
                      }`}>
                        <div className={`text-xs font-medium mb-1 ${
                          calculatorResults.principalAmount >= 0 ? 'text-green-900' : 'text-red-900'
                        }`}>Membership ROI</div>
                        <div className={`text-base font-bold ${
                          calculatorResults.principalAmount >= 0 ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {calculatorData.membershipPrice > 0 && calculatorData.customerCount > 0 ? 
                            (((calculatorResults.principalAmount / (calculatorData.membershipPrice * calculatorData.customerCount)) * 100).toFixed(1)) : '0'}%
                        </div>
                        <div className={`text-[11px] mt-1 ${
                          calculatorResults.principalAmount >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>Return on membership program investment</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Chat Modal */}
      {showAIChat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl h-[600px] flex flex-col">
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-t-lg">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">AI Marketing Assistant</h3>
                  <p className="text-xs text-blue-100">Ask me about your membership plans and marketing strategy</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleNewChat}
                  className="p-2 hover:bg-white/20 rounded-md transition-colors group"
                  title="Start New Chat"
                >
                  <RotateCcw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-300" />
                </button>
                <button
                  onClick={() => setShowAIChat(false)}
                  className="p-2 hover:bg-white/20 rounded-md transition-colors"
                  title="Close Chat"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <Bot className="w-12 h-12 text-blue-500 mx-auto mb-4" />
                  <h4 className="font-semibold text-gray-900 mb-2">Welcome to AI Assistant!</h4>
                  <p className="text-gray-600 text-sm mb-4">I can help you with membership insights, pricing strategies, and marketing recommendations.</p>
                  <div className="grid grid-cols-1 gap-2 max-w-md mx-auto">
                    {[
                      "How to create appointments?",
                      "How to create bills and invoices?",
                      "How can I improve my revenue?",
                      "How to add new customers?",
                      "What are my best performing plans?",
                      "How to generate reports?"
                    ].map((suggestion, idx) => (
                      <button
                        key={idx}
                        onClick={() => {
                          setCurrentMessage(suggestion);
                          setTimeout(() => handleSendMessage(), 100);
                        }}
                        className="p-2 text-xs bg-blue-50 text-blue-700 rounded-md hover:bg-blue-100 transition-colors text-left"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg p-3 ${
                    msg.type === 'user' 
                      ? 'bg-blue-500 text-white' 
                      : 'bg-gray-100 text-gray-900'
                  }`}>
                    {msg.type === 'ai' && (
                      <div className="flex items-center gap-2 mb-2">
                        <Bot className="w-4 h-4 text-blue-600" />
                        <span className="font-semibold text-blue-600 text-sm">AI Assistant</span>
                      </div>
                    )}
                    <div className="whitespace-pre-line text-sm">
                      {msg.message.split('**').map((part, idx) => {
                        if (idx % 2 === 1) return <strong key={idx}>{part}</strong>;
                        
                        // Check for navigation links
                        if (part.includes('👆 Click here to go to:')) {
                          return part.split('\n').map((line, lineIdx) => {
                            if (line.includes('👆 Click here to go to:')) {
                              const match = line.match(/👆 Click here to go to: (.+?) → (.+)$/);
                              if (match) {
                                const [, linkText, path] = match;
                                return (
                                  <div key={lineIdx} className="mt-2">
                                    <button
                                      onClick={() => window.location.href = path}
                                      className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-md transition-colors"
                                    >
                                      👆 Go to {linkText}
                                    </button>
                                  </div>
                                );
                              }
                            }
                            return <div key={lineIdx}>{line}</div>;
                          });
                        }
                        
                        return part;
                      })}
                    </div>
                    <div className={`text-xs mt-2 ${
                      msg.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {msg.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}

              {aiTyping && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-lg p-3 max-w-[80%]">
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="w-4 h-4 text-blue-600" />
                      <span className="font-semibold text-blue-600 text-sm">AI Assistant</span>
                    </div>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="border-t p-4">
              <div className="flex gap-2">
                <textarea
                  value={currentMessage}
                  onChange={(e) => setCurrentMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Ask about your membership plans, pricing strategy, or marketing tips..."
                  className="flex-1 resize-none border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={2}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!currentMessage.trim() || aiTyping}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}