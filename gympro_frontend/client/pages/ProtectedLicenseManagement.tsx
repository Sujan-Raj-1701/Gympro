import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LicenseManagement from './LicenseManagement';

const ProtectedLicenseManagement = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const checkAdminAccess = () => {
      const adminAccess = sessionStorage.getItem('adminAccess');
      const adminAccessTime = sessionStorage.getItem('adminAccessTime');
      
      // Check if admin access exists and is not expired (24 hours)
      if (!adminAccess || adminAccess !== 'true') {
        navigate('/admin-access');
        return;
      }
      
      // Check if access has expired (24 hours = 24 * 60 * 60 * 1000 ms)
      if (adminAccessTime) {
        const accessTime = parseInt(adminAccessTime);
        const currentTime = Date.now();
        const hoursPassed = (currentTime - accessTime) / (1000 * 60 * 60);
        
        if (hoursPassed > 24) {
          // Access expired, clear session and redirect
          sessionStorage.removeItem('adminAccess');
          sessionStorage.removeItem('adminAccessTime');
          navigate('/admin-access');
          return;
        }
      }
    };

    checkAdminAccess();
  }, [navigate]);

  // If we reach here, admin access is valid
  return <LicenseManagement />;
};

export default ProtectedLicenseManagement;
