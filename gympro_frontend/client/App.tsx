import "./global.css";
import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Masters from "./pages/masters/index";
import Reports from "./pages/reports/index";
import SalesReports from "./pages/reports/SalesReports";
import MonthlySales from "./pages/reports/MonthlySales";
import PaymentMode from "./pages/reports/PaymentMode";
import OutstandingCredit from "./pages/reports/OutstandingCredit";
import StaffPerformance from "./pages/reports/StaffPerformance";
import StaffCommission from "./pages/reports/StaffCommission";
import ServiceSales from "./pages/reports/ServiceSales";
import CustomerVisit from "./pages/reports/CustomerVisit";
import TopCustomers from "./pages/reports/TopCustomers";
import AppointmentSummary from "./pages/reports/AppointmentSummary";
import StockSummary from "./pages/reports/StockSummary";
import ProductConsumption from "./pages/reports/ProductConsumption";
import DiscountReport from "./pages/reports/DiscountReport";
import GSTSummaryReport from "./pages/reports/GSTSummaryReport";
import DayClosing from "./pages/reports/DayClosing";
import AllocationTransfer from "./pages/assets/AllocationTransfer";
import AddTransferEntry from "./pages/assets/AddTransferEntry";
import AssetDisposal from "./pages/assets/Disposal";
import AddDisposalEntry from "./pages/assets/AddDisposalEntry";
import PurchaseOrder from "./pages/assets/PurchaseOrder";
import AddPurchaseOrder from "./pages/assets/AddPurchaseOrder";
import AssetReports from "./pages/assets/Reports";
import AssetIndex from "./pages/assets/index";
import CashFlow from "./pages/assets/CashFlow";
import AddCashFlowEntry from "./pages/assets/AddCashFlowEntry";
import CashFlowInvoice from "./pages/assets/CashFlowInvoice";
// Purchase and Stock Reports removed
import GSTReports from "./pages/reports/GSTReports";
import CustomerReports from "./pages/reports/CustomerReports";
// Legacy banquet appointments page retained for rollback: ./pages/Appointments.tsx
import SalonAppointments from "./pages/SalonAppointments";
import CreateAppointment from "./pages/CreateAppointment";
import { Navigate } from "react-router-dom";
import CreateBooking from "./pages/CreateBooking";
import OutdoorBooking from "./pages/OutdoorBooking";
import InvoicePrint from "./pages/InvoicePrint";
import UserManagement from "./pages/UserManagement";
import StaffManagement from "./pages/staff";
import StaffAttendance from "./pages/staff/attendance";
import PayrollIncentives from "./pages/staff/payroll-incentives";
import AppointmentAssignment from "./pages/staff/appointment-assignment";
import PerformanceTracking from "./pages/staff/performance-tracking";
import InventoryManagement from "./pages/inventory";
import StockIn from "./pages/inventory/StockIn";
import StockInList from "./pages/inventory/StockInList";
import StockInInvoice from "./pages/inventory/StockInInvoice";
import StockOut from "./pages/inventory/StockOut";
import StockOutList from "./pages/inventory/StockOutList";
import StockAdjustment from "./pages/inventory/StockAdjustment";
import StockAdjustmentNew from "./pages/inventory/StockAdjustmentNew";
import ReorderAlert from "./pages/inventory/ReorderAlert";
import ExpiryWastage from "./pages/inventory/ExpiryWastage";
import AddUser from "./pages/AddUser";
import Unauthorized from "./pages/Unauthorized";
import NotFound from "./pages/NotFound";
import AdminAccess from "./pages/AdminAccess";
import ProtectedLicenseManagement from "./pages/ProtectedLicenseManagement";
import Settings from "./pages/Settings";
import Billing from "./pages/billing/index";
import AddInvoice from "./pages/billing/AddInvoice";
import InvoiceDetail from "./pages/billing/InvoiceDetail";
import BillingTransitions from "./pages/billing/BillingTransitions";
import InvoiceTallyPrint from "./pages/billing/InvoiceTallyPrint";
import { MarketingPage, CampaignPage } from "./pages/marketing";
import CampaignHistory from "./pages/marketing/CampaignHistory";
import Enquiry from "./pages/Enquiry";
import EnquiryPrint from "./pages/Enquiry/EnquiryPrint";
import { Settlement } from "./pages/settlement";
import ClientPerformance from "./pages/client-performance";



const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/admin-access" element={<AdminAccess />} />
            <Route path="/loginasadmin" element={<AdminAccess />} />
            <Route path="/license-management" element={<ProtectedLicenseManagement />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Standalone printable routes (no Layout wrapper) */}
            <Route
              path="/billing/print/:id"
              element={
                <ProtectedRoute>
                  <InvoiceTallyPrint />
                </ProtectedRoute>
              }
            />

            {/* Protected Routes */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              <Route index element={<Dashboard />} />
              {/* Settings */}
              <Route
                path="settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />

              {/* Masters (wildcard for deep links) */}
              <Route
                path="masters/*"
                element={
                  <ProtectedRoute>
                    <Masters />
                  </ProtectedRoute>
                }
              />

              {/* Master Modules - Require manager or admin role */}

              {/* Appointments (salon) */}
              <Route
                path="appointments"
                element={
                  <ProtectedRoute>
                    <SalonAppointments />
                  </ProtectedRoute>
                }
              />
              <Route
                path="appointments/create"
                element={
                  <ProtectedRoute>
                    <CreateAppointment />
                  </ProtectedRoute>
                }
              />
              {/* Legacy path redirect */}
              <Route path="hall-booking" element={<Navigate to="/appointments" replace />} />
              {/* Outdoor Booking */}
              <Route
                path="outdoor-booking"
                element={
                  <ProtectedRoute>
                    <OutdoorBooking />
                  </ProtectedRoute>
                }
              />
              <Route
                path="create-booking"
                element={
                  <ProtectedRoute>
                    <CreateBooking />
                  </ProtectedRoute>
                }
              />
              <Route
                path="invoice/:bookingId"
                element={
                  <ProtectedRoute>
                    <InvoicePrint />
                  </ProtectedRoute>
                }
              />

              {/* User Management */}
              <Route
                path="user-management"
                element={
                  <ProtectedRoute>
                    <UserManagement />
                  </ProtectedRoute>
                }
              />
              {/* Staff Management */}
              <Route
                path="staff"
                element={
                  <ProtectedRoute>
                    <StaffManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff-management/attendance"
                element={
                  <ProtectedRoute>
                    <StaffAttendance />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff-management/payroll-incentives"
                element={
                  <ProtectedRoute>
                    <PayrollIncentives />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff-management/payroll-incentives/mapping/:mappingId"
                element={
                  <ProtectedRoute>
                    <PayrollIncentives />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff-management/appointment-assignment"
                element={
                  <ProtectedRoute>
                    <AppointmentAssignment />
                  </ProtectedRoute>
                }
              />
              <Route
                path="staff-management/performance-tracking"
                element={
                  <ProtectedRoute>
                    <PerformanceTracking />
                  </ProtectedRoute>
                }
              />
              {/* Inventory Management */}
              <Route
                path="inventory"
                element={
                  <ProtectedRoute>
                    <InventoryManagement />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-in"
                element={
                  <ProtectedRoute>
                    <StockInList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-in/add"
                element={
                  <ProtectedRoute>
                    <StockIn />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-in/edit/:stockinId"
                element={
                  <ProtectedRoute>
                    <StockIn />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-in/invoice/:stockinId"
                element={
                  <ProtectedRoute>
                    <StockInInvoice />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-out"
                element={
                  <ProtectedRoute>
                    <StockOutList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-out/add"
                element={
                  <ProtectedRoute>
                    <StockOut />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-out/edit/:stockOutId"
                element={
                  <ProtectedRoute>
                    <StockOut />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-adjustment"
                element={
                  <ProtectedRoute>
                    <StockAdjustment />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/stock-adjustment/new"
                element={
                  <ProtectedRoute>
                    <StockAdjustmentNew />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/reorder-alert"
                element={
                  <ProtectedRoute>
                    <ReorderAlert />
                  </ProtectedRoute>
                }
              />
              <Route
                path="inventory/expiry-wastage"
                element={
                  <ProtectedRoute>
                    <ExpiryWastage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="add-user"
                element={
                  <ProtectedRoute>
                    <AddUser />
                  </ProtectedRoute>
                }
              />
              <Route
                path="edit-user/:userId"
                element={
                  <ProtectedRoute>
                    <AddUser />
                  </ProtectedRoute>
                }
              />



              {/* Reports - Main reports page and individual reports */}
              <Route
                path="reports"
                element={
                  <ProtectedRoute>
                    <Reports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/sales"
                element={
                  <ProtectedRoute>
                    <SalesReports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/monthly-sales"
                element={
                  <ProtectedRoute>
                    <MonthlySales />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/payment-mode"
                element={
                  <ProtectedRoute>
                    <PaymentMode />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/credit-outstanding"
                element={
                  <ProtectedRoute>
                    <OutstandingCredit />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/staff-performance"
                element={
                  <ProtectedRoute>
                    <StaffPerformance />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/staff-commission"
                element={
                  <ProtectedRoute>
                    <StaffCommission />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/service-sales"
                element={
                  <ProtectedRoute>
                    <ServiceSales />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/customer-visits"
                element={
                  <ProtectedRoute>
                    <CustomerVisit />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/top-customers"
                element={
                  <ProtectedRoute>
                    <TopCustomers />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/appointment-summary"
                element={
                  <ProtectedRoute>
                    <AppointmentSummary />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/stock-summary"
                element={
                  <ProtectedRoute>
                    <StockSummary />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/product-consumption"
                element={
                  <ProtectedRoute>
                    <ProductConsumption />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/discounts"
                element={
                  <ProtectedRoute>
                    <DiscountReport />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/gst-summary"
                element={
                  <ProtectedRoute>
                    <GSTSummaryReport />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/day-closing"
                element={
                  <ProtectedRoute>
                    <DayClosing />
                  </ProtectedRoute>
                }
              />
              {/* Purchase and Stock Reports routes removed */}
              <Route
                path="reports/gst"
                element={
                  <ProtectedRoute>
                    <GSTReports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="reports/customer"
                element={
                  <ProtectedRoute>
                    <CustomerReports />
                  </ProtectedRoute>
                }
              />
              {/* Asset Management */}
              <Route
                path="assets/purchase-order/add"
                element={
                  <ProtectedRoute>
                    <AddPurchaseOrder />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/purchase-order"
                element={
                  <ProtectedRoute>
                    <PurchaseOrder />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/allocation-transfer/add"
                element={
                  <ProtectedRoute>
                    <AddTransferEntry />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/allocation-transfer"
                element={
                  <ProtectedRoute>
                    <AllocationTransfer />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/disposal/add"
                element={
                  <ProtectedRoute>
                    <AddDisposalEntry />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/disposal"
                element={
                  <ProtectedRoute>
                    <AssetDisposal />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/reports"
                element={
                  <ProtectedRoute>
                    <AssetReports />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets/cashflow"
                element={
                  <ProtectedRoute>
                    <CashFlow />
                  </ProtectedRoute>
                }
              />
              <Route
                path="financetracker/cashflow/invoice/:id"
                element={
                  <ProtectedRoute>
                    <CashFlowInvoice />
                  </ProtectedRoute>
                }
              />
              <Route
                path="financetracker/cashflow/add"
                element={
                  <ProtectedRoute>
                    <AddCashFlowEntry />
                  </ProtectedRoute>
                }
              />
              <Route
                path="assets"
                element={
                  <ProtectedRoute>
                    <AssetIndex />
                  </ProtectedRoute>
                }
              />

              {/* Billing */}
              <Route
                path="billing"
                element={
                  <ProtectedRoute>
                    <Billing />
                  </ProtectedRoute>
                }
              />
              <Route
                path="billing/add"
                element={
                  <ProtectedRoute>
                    <AddInvoice />
                  </ProtectedRoute>
                }
              />
              <Route
                path="billing/transitions"
                element={
                  <ProtectedRoute>
                    <BillingTransitions />
                  </ProtectedRoute>
                }
              />
              <Route
                path="billing/invoice/:id"
                element={
                  <ProtectedRoute>
                    <InvoiceDetail />
                  </ProtectedRoute>
                }
              />

              {/* Marketing */}
              <Route
                path="marketing"
                element={
                  <ProtectedRoute>
                    <MarketingPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="campaign"
                element={
                  <ProtectedRoute>
                    <CampaignPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="campaign-history"
                element={
                  <ProtectedRoute>
                    <CampaignHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="marketing/campaign-history"
                element={
                  <ProtectedRoute>
                    <CampaignHistory />
                  </ProtectedRoute>
                }
              />

              {/* Enquiry */}
              <Route
                path="enquiry"
                element={
                  <ProtectedRoute>
                    <Enquiry />
                  </ProtectedRoute>
                }
              />
              <Route
                path="enquiry/print"
                element={
                  <ProtectedRoute>
                    <EnquiryPrint />
                  </ProtectedRoute>
                }
              />

              {/* Settlement */}
              <Route
                path="settlement"
                element={
                  <ProtectedRoute>
                    <Settlement />
                  </ProtectedRoute>
                }
              />

              {/* Client Performance */}
              <Route
                path="client-performance/*"
                element={
                  <ProtectedRoute>
                    <ClientPerformance />
                  </ProtectedRoute>
                }
              />

            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
