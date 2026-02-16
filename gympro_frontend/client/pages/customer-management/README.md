# Customer Management System

## Overview

A comprehensive customer management system for GYM Pro that enables retail owners to manage their customer base, analyze customer behavior, send bulk SMS campaigns, and track customer analytics.

## Features

### 🏠 Dashboard Integration
- Quick access button on the main dashboard
- Customer analytics cards showing key metrics
- Real-time customer statistics

### 👥 Customer Management
- **Complete Customer View**: Display all customers with essential information
- **Customer Search**: Advanced search by name, phone, email
- **Customer Analytics**: Visit count, total spent, last visit, membership status
- **Customer Status**: Active/Inactive based on recent visits (90 days)
- **Pagination**: Handle large customer databases efficiently

### 📊 Analytics & Insights
- **Customer Statistics**:
  - Total customers
  - New customers this month
  - Active customers (visited in last 90 days)
  - Membership customers
  - Average visits per customer
  - Total revenue from customers

### 🔍 Advanced Filtering
- **Search Filters**:
  - Name, phone, email search
  - Gender filter
  - Membership status (members/non-members)
  - Visit count ranges (0, 1-5, 6-15, 16+)
  - Registration date range
  - City filter

- **Quick Filters**:
  - Members only
  - New customers (0 visits)
  - VIP customers (16+ visits)
  - Last 30 days registrations

### 📱 Bulk SMS Campaign
- **Template System**: Pre-built SMS templates for various scenarios
  - Appointment reminders
  - Birthday wishes
  - Anniversary offers
  - New service launches
  - Membership renewals
  - Follow-up messages
  - Special offers
  - Inactive customer re-engagement

- **Customer Targeting**:
  - Filter recipients by gender, membership, status
  - Real-time recipient count
  - Cost estimation (₹0.50 per SMS)

- **Message Personalization**:
  - Dynamic variables: `{name}`, `{salon_name}`, `{date}`, `{time}`
  - Message preview with personalization
  - Character count tracking (160 char limit)

- **SMS Scheduling**:
  - Schedule SMS for future delivery
  - Date and time picker
  - Immediate or scheduled sending

### 👤 Detailed Customer View
- **Personal Information**:
  - Contact details (phone, email, address)
  - Demographics (gender, city)
  - Important dates (birthday, anniversary)
  - Membership information

- **Visit Analytics**:
  - Total visits and spending
  - Average spend per visit
  - First and last visit dates
  - Visit history with details

- **Preferences**:
  - Favorite services (based on booking history)
  - Preferred staff members
  - Service patterns

- **Upcoming Events**:
  - Birthday alerts
  - Anniversary reminders
  - Days until next event

- **Communication History**:
  - SMS history
  - Email communications
  - Call logs

### 📈 Customer Insights
- **Behavioral Analytics**:
  - Service preferences
  - Staff preferences
  - Booking patterns
  - Spending trends

- **Lifecycle Management**:
  - Customer journey tracking
  - Retention analytics
  - Churn prediction

### 📤 Export Capabilities
- **Data Export**:
  - Excel format with comprehensive customer data
  - PDF reports for customer analytics
  - Filtered data export
  - Custom report generation

## Technical Implementation

### Frontend Structure
```
client/pages/customer-management/
├── index.tsx              # Main customer management page
├── CustomerDetails.tsx    # Detailed customer view modal
├── BulkSMSModal.tsx      # SMS campaign interface
└── CustomerFilters.tsx    # Advanced filtering component
```

### Key Components

#### 1. Customer Management Index (`index.tsx`)
- Main dashboard with customer list
- Statistics cards
- Search and filtering
- Bulk actions
- Pagination

#### 2. Customer Details Modal (`CustomerDetails.tsx`)
- Comprehensive customer profile
- Tabbed interface (Overview, History, Preferences, Communication)
- Analytics and insights
- Quick actions

#### 3. Bulk SMS Modal (`BulkSMSModal.tsx`)
- Template selection
- Message composition
- Customer targeting
- Cost calculation
- Scheduling options

#### 4. Customer Filters (`CustomerFilters.tsx`)
- Advanced filtering interface
- Quick filter buttons
- Filter summary
- Dynamic filter options

### Data Integration

#### Customer Data Sources
- `master_customer` table for customer information
- `booking` table for visit analytics
- `master_membership` table for membership data
- Real-time API integration with backend

#### API Endpoints Used
- `/read` - Customer, booking, and membership data
- `/search-master-customer` - Customer search functionality
- `/billing-transitions` - Payment and invoice data

### Customer Analytics Calculations

#### Visit Analytics
- **Total Visits**: Count of bookings per customer
- **Total Spent**: Sum of all booking amounts
- **Average Spend**: Total spent ÷ Total visits
- **Last Visit**: Most recent booking date
- **Customer Status**: Active if visited within 90 days

#### Service Preferences
- **Favorite Services**: Most frequently booked services
- **Preferred Staff**: Most frequently requested staff members
- **Booking Patterns**: Time and date preferences

### SMS Campaign Features

#### Template Categories
1. **Appointments** - Reminders and confirmations
2. **Promotions** - Special offers and discounts
3. **Announcements** - New services and updates
4. **Membership** - Renewal and upgrade notifications
5. **Follow-up** - Post-service satisfaction
6. **Retention** - Re-engagement campaigns

#### Personalization Variables
- `{name}` - Customer name
- `{salon_name}` - Salon business name
- `{date}` - Current or appointment date
- `{time}` - Current or appointment time
- `{expiry_date}` - Offer expiry date

## Usage Guide

### Accessing Customer Management
1. Navigate to the dashboard
2. Click on "Customer Management" in the Quick Actions section
3. Or use the direct URL: `/customer-management`

### Managing Customers
1. **View All Customers**: Browse paginated customer list
2. **Search Customers**: Use the search bar for name/phone/email
3. **Filter Customers**: Apply advanced filters for targeted views
4. **View Details**: Click the eye icon to see detailed customer profile
5. **Export Data**: Use Excel/PDF export buttons

### Sending Bulk SMS
1. **Select Customers**: Check boxes next to desired customers
2. **Click SMS Button**: "Send SMS" button shows selected count
3. **Choose Template**: Select from pre-built templates or write custom
4. **Apply Filters**: Target specific customer segments
5. **Preview & Send**: Review message and recipient list
6. **Schedule (Optional)**: Set future delivery date/time

### Advanced Filtering
1. **Open Filters**: Click "Filters" button to expand filter panel
2. **Set Criteria**: Choose gender, membership, visits, date range, city
3. **Quick Filters**: Use preset buttons for common filters
4. **View Results**: Customer list updates automatically
5. **Clear Filters**: Reset all filters with "Clear All" button

## Future Enhancements

### Planned Features
- **Customer Segmentation**: Advanced customer grouping
- **Email Campaigns**: Email marketing alongside SMS
- **Loyalty Programs**: Point-based reward systems
- **Customer Feedback**: Integrated review and rating system
- **Automated Campaigns**: Trigger-based communication
- **Customer App Integration**: Mobile app for customers
- **Social Media Integration**: WhatsApp Business API
- **Advanced Analytics**: Predictive analytics and ML insights

### Technical Improvements
- **Real-time Updates**: WebSocket integration for live data
- **Performance Optimization**: Virtual scrolling for large datasets
- **Mobile Responsiveness**: Enhanced mobile experience
- **Offline Support**: PWA capabilities for offline access
- **API Rate Limiting**: SMS sending rate controls
- **Data Backup**: Automated customer data backups

## Data Privacy & Security

### Compliance
- **GDPR Compliance**: Data protection and privacy rights
- **Data Encryption**: Sensitive data encryption at rest and transit
- **Access Controls**: Role-based access to customer data
- **Audit Trails**: Log all customer data access and modifications

### Best Practices
- **Data Minimization**: Collect only necessary customer information
- **Consent Management**: Customer consent for marketing communications
- **Data Retention**: Automated data cleanup policies
- **Security Monitoring**: Real-time security threat detection

## Support & Maintenance

### Regular Maintenance
- **Data Backup**: Daily automated backups
- **Performance Monitoring**: System performance tracking
- **Security Updates**: Regular security patches
- **Feature Updates**: Continuous feature improvements

### Support Channels
- **Documentation**: Comprehensive user guides
- **Video Tutorials**: Step-by-step video instructions
- **Technical Support**: 24/7 technical assistance
- **User Training**: On-site and remote training sessions

---

*This Customer Management System is designed to help salon businesses build stronger relationships with their customers through data-driven insights and targeted communication strategies.*