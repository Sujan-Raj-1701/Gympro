import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Gift,
  TrendingUp,
  Clock,
  IndianRupee,
  Heart,
  Star,
  MessageCircle,
  Edit,
  Download,
  Share2
} from 'lucide-react';

interface Customer {
  id?: string;
  customer_id?: string;
  customer_name?: string;
  name?: string;
  full_name?: string;
  customer_number?: string;
  customer_phone?: string;
  phone?: string;
  mobile?: string;
  customer_email?: string;
  email?: string;
  customer_address?: string;
  address?: string;
  city?: string;
  gender?: string;
  date_of_birth?: string;
  anniversary_date?: string;
  membership_id?: string;
  membership_name?: string;
  created_at?: string;
  last_visit?: string;
  total_visits?: number;
  total_spent?: number;
  status?: string;
  notes?: string;
}

interface CustomerDetailsProps {
  customer: Customer;
  bookings: any[];
  onClose: () => void;
}

export default function CustomerDetails({ customer, bookings, onClose }: CustomerDetailsProps) {
  const [customerStats, setCustomerStats] = useState({
    totalVisits: 0,
    totalSpent: 0,
    averageSpent: 0,
    lastVisit: null as Date | null,
    firstVisit: null as Date | null,
    favoriteServices: [] as string[],
    preferredStaff: [] as string[]
  });

  useEffect(() => {
    calculateCustomerStats();
  }, [bookings]);

  const calculateCustomerStats = () => {
    if (!bookings || bookings.length === 0) return;

    const totalSpent = bookings.reduce((sum, booking) => {
      return sum + parseFloat(booking.total_amount || booking.amount || '0');
    }, 0);

    const dates = bookings
      .map(b => new Date(b.booking_date || b.created_at))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());

    const services = bookings
      .flatMap(b => [b.service_name, b.service_1, b.service_2, b.service_3])
      .filter(Boolean)
      .reduce((acc: Record<string, number>, service: string) => {
        acc[service] = (acc[service] || 0) + 1;
        return acc;
      }, {});

    const staff = bookings
      .flatMap(b => [b.staff_name, b.employee_name, b.staff_1, b.staff_2])
      .filter(Boolean)
      .reduce((acc: Record<string, number>, staffMember: string) => {
        acc[staffMember] = (acc[staffMember] || 0) + 1;
        return acc;
      }, {});

    const favoriteServices = Object.entries(services)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 5)
      .map(([service]) => service);

    const preferredStaff = Object.entries(staff)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([staffMember]) => staffMember);

    setCustomerStats({
      totalVisits: bookings.length,
      totalSpent,
      averageSpent: totalSpent / bookings.length,
      lastVisit: dates.length > 0 ? dates[dates.length - 1] : null,
      firstVisit: dates.length > 0 ? dates[0] : null,
      favoriteServices,
      preferredStaff
    });
  };

  const getCustomerName = () => {
    return customer.customer_name || customer.name || customer.full_name || 'Unknown';
  };

  const getCustomerPhone = () => {
    return customer.customer_phone || customer.phone || customer.mobile || '';
  };

  const getCustomerEmail = () => {
    return customer.customer_email || customer.email || '';
  };

  const getCustomerAddress = () => {
    return customer.customer_address || customer.address || '';
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'Not available';
    try {
      return new Date(dateString).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  const getUpcomingEvents = () => {
    const events = [];
    const now = new Date();
    const currentYear = now.getFullYear();

    if (customer.date_of_birth) {
      try {
        const birthDate = new Date(customer.date_of_birth);
        const thisYearBirthday = new Date(currentYear, birthDate.getMonth(), birthDate.getDate());
        const nextYearBirthday = new Date(currentYear + 1, birthDate.getMonth(), birthDate.getDate());

        const upcomingBirthday = thisYearBirthday >= now ? thisYearBirthday : nextYearBirthday;
        const daysUntilBirthday = Math.ceil((upcomingBirthday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        events.push({
          type: 'birthday',
          date: upcomingBirthday,
          daysUntil: daysUntilBirthday,
          label: 'Birthday'
        });
      } catch (e) {
        // Ignore invalid birth date
      }
    }

    if (customer.anniversary_date) {
      try {
        const anniversaryDate = new Date(customer.anniversary_date);
        const thisYearAnniversary = new Date(currentYear, anniversaryDate.getMonth(), anniversaryDate.getDate());
        const nextYearAnniversary = new Date(currentYear + 1, anniversaryDate.getMonth(), anniversaryDate.getDate());

        const upcomingAnniversary = thisYearAnniversary >= now ? thisYearAnniversary : nextYearAnniversary;
        const daysUntilAnniversary = Math.ceil((upcomingAnniversary.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        events.push({
          type: 'anniversary',
          date: upcomingAnniversary,
          daysUntil: daysUntilAnniversary,
          label: 'Anniversary'
        });
      } catch (e) {
        // Ignore invalid anniversary date
      }
    }

    return events.sort((a, b) => a.daysUntil - b.daysUntil);
  };

  const upcomingEvents = getUpcomingEvents();

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
              {getCustomerName().charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-2xl font-bold">{getCustomerName()}</h2>
              <p className="text-sm text-gray-500">Customer ID: {customer.customer_id || customer.id}</p>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="history">Visit History</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="communication">Communication</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Customer Info */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Customer Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {getCustomerPhone() && (
                      <div className="flex items-center gap-3">
                        <Phone className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Phone</p>
                          <p className="font-medium">{getCustomerPhone()}</p>
                        </div>
                      </div>
                    )}

                    {getCustomerEmail() && (
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Email</p>
                          <p className="font-medium">{getCustomerEmail()}</p>
                        </div>
                      </div>
                    )}

                    {customer.gender && (
                      <div className="flex items-center gap-3">
                        <User className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Gender</p>
                          <p className="font-medium">{customer.gender}</p>
                        </div>
                      </div>
                    )}

                    {customer.city && (
                      <div className="flex items-center gap-3">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">City</p>
                          <p className="font-medium">{customer.city}</p>
                        </div>
                      </div>
                    )}

                    {customer.date_of_birth && (
                      <div className="flex items-center gap-3">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Date of Birth</p>
                          <p className="font-medium">{formatDate(customer.date_of_birth)}</p>
                        </div>
                      </div>
                    )}

                    {customer.anniversary_date && (
                      <div className="flex items-center gap-3">
                        <Heart className="h-4 w-4 text-gray-400" />
                        <div>
                          <p className="text-sm text-gray-500">Anniversary</p>
                          <p className="font-medium">{formatDate(customer.anniversary_date)}</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {getCustomerAddress() && (
                    <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Address</p>
                      <p className="font-medium">{getCustomerAddress()}</p>
                    </div>
                  )}

                  {customer.membership_name && (
                    <div className="mt-4">
                      <Badge variant="secondary" className="bg-yellow-100 text-yellow-800">
                        <Gift className="h-3 w-3 mr-1" />
                        {customer.membership_name}
                      </Badge>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick Stats */}
              <div className="space-y-4">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-center">
                      <TrendingUp className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-blue-600">{customerStats.totalVisits}</p>
                      <p className="text-sm text-gray-500">Total Visits</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-center">
                      <IndianRupee className="h-8 w-8 text-green-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-green-600">₹{customerStats.totalSpent.toFixed(2)}</p>
                      <p className="text-sm text-gray-500">Total Spent</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-4">
                    <div className="text-center">
                      <Star className="h-8 w-8 text-purple-500 mx-auto mb-2" />
                      <p className="text-2xl font-bold text-purple-600">₹{customerStats.averageSpent.toFixed(2)}</p>
                      <p className="text-sm text-gray-500">Avg. per Visit</p>
                    </div>
                  </CardContent>
                </Card>

                {customerStats.lastVisit && (
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-center">
                        <Clock className="h-8 w-8 text-orange-500 mx-auto mb-2" />
                        <p className="text-lg font-bold text-orange-600">
                          {customerStats.lastVisit.toLocaleDateString()}
                        </p>
                        <p className="text-sm text-gray-500">Last Visit</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>

            {/* Upcoming Events */}
            {upcomingEvents.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    Upcoming Events
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {upcomingEvents.map((event, index) => (
                      <div key={index} className="flex items-center justify-between p-3 bg-gradient-to-r from-pink-50 to-purple-50 rounded-lg">
                        <div className="flex items-center gap-3">
                          {event.type === 'birthday' ? (
                            <Calendar className="h-5 w-5 text-pink-500" />
                          ) : (
                            <Heart className="h-5 w-5 text-purple-500" />
                          )}
                          <div>
                            <p className="font-medium">{event.label}</p>
                            <p className="text-sm text-gray-600">{event.date.toLocaleDateString()}</p>
                          </div>
                        </div>
                        <Badge variant={event.daysUntil <= 7 ? "destructive" : "secondary"}>
                          {event.daysUntil === 0 ? 'Today!' :
                            event.daysUntil === 1 ? 'Tomorrow' :
                              `${event.daysUntil} days`}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Visit History</CardTitle>
              </CardHeader>
              <CardContent>
                {bookings.length > 0 ? (
                  <div className="space-y-4">
                    {bookings
                      .sort((a, b) => new Date(b.booking_date || b.created_at).getTime() - new Date(a.booking_date || a.created_at).getTime())
                      .map((booking, index) => (
                        <div key={index} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="flex-1">
                            <div className="flex items-center gap-4">
                              <div>
                                <p className="font-medium">
                                  {formatDate(booking.booking_date || booking.created_at)}
                                </p>
                                <p className="text-sm text-gray-500">
                                  {booking.service_name || booking.service_1 || 'Service'}
                                </p>
                              </div>
                              {booking.staff_name && (
                                <div>
                                  <p className="text-sm text-gray-500">Staff</p>
                                  <p className="font-medium">{booking.staff_name}</p>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-green-600">
                              ₹{parseFloat(booking.total_amount || booking.amount || '0').toFixed(2)}
                            </p>
                            <Badge variant={
                              booking.booking_status === 'completed' ? 'default' :
                                booking.booking_status === 'cancelled' ? 'destructive' : 'secondary'
                            }>
                              {booking.booking_status || 'Unknown'}
                            </Badge>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Calendar className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No visit history available</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preferences" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Favorite Services</CardTitle>
                </CardHeader>
                <CardContent>
                  {customerStats.favoriteServices.length > 0 ? (
                    <div className="space-y-2">
                      {customerStats.favoriteServices.map((service, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span>{service}</span>
                          <Star className="h-4 w-4 text-yellow-500" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">No service preferences available</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Preferred Staff</CardTitle>
                </CardHeader>
                <CardContent>
                  {customerStats.preferredStaff.length > 0 ? (
                    <div className="space-y-2">
                      {customerStats.preferredStaff.map((staff, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                          <span>{staff}</span>
                          <User className="h-4 w-4 text-blue-500" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-center py-4">No staff preferences available</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {customer.notes && (
              <Card>
                <CardHeader>
                  <CardTitle>Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>{customer.notes}</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="communication" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageCircle className="h-5 w-5" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button className="w-full justify-start" variant="outline">
                    <Phone className="h-4 w-4 mr-2" />
                    Call Customer
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <MessageCircle className="h-4 w-4 mr-2" />
                    Send SMS
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Mail className="h-4 w-4 mr-2" />
                    Send Email
                  </Button>
                  <Button className="w-full justify-start" variant="outline">
                    <Calendar className="h-4 w-4 mr-2" />
                    Book Appointment
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Communication History</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8">
                    <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-gray-500">No communication history available</p>
                    <p className="text-sm text-gray-400 mt-2">Start communicating with this customer to see history here</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-between pt-4 border-t">
          <div className="flex gap-2">
            <Button variant="outline" className="flex items-center gap-2">
              <Edit className="h-4 w-4" />
              Edit Customer
            </Button>
            <Button variant="outline" className="flex items-center gap-2">
              <Download className="h-4 w-4" />
              Export Data
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Book Appointment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}