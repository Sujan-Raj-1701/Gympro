import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useToast } from '@/hooks/use-toast';

interface PrinterContextType {
  printerConnected: boolean;
  printerName: string;
  printerDevice: BluetoothDevice | null;
  connectPrinter: (device: BluetoothDevice, name: string) => Promise<void>;
  disconnectPrinter: () => void;
  checkPrinterConnection: () => Promise<void>;
  updateConnectionState: (connected: boolean, device?: BluetoothDevice) => void;
}

const PrinterContext = createContext<PrinterContextType | undefined>(undefined);

export const usePrinter = () => {
  const context = useContext(PrinterContext);
  if (!context) {
    throw new Error('usePrinter must be used within a PrinterProvider');
  }
  return context;
};

interface PrinterProviderProps {
  children: ReactNode;
}

export const PrinterProvider: React.FC<PrinterProviderProps> = ({ children }) => {
  const [printerConnected, setPrinterConnected] = useState(false);
  const [printerName, setPrinterName] = useState<string>('');
  const [printerDevice, setPrinterDevice] = useState<BluetoothDevice | null>(null);
  const { toast } = useToast();

  const updateConnectionState = (connected: boolean, device?: BluetoothDevice) => {
    setPrinterConnected(connected);
    localStorage.setItem('printerConnectionState', connected ? 'connected' : 'disconnected');
    
    if (connected && device) {
      setPrinterDevice(device);
      // Update the stored printer with connection info (without device object)
      const savedPrinter = localStorage.getItem('connectedPrinter');
      if (savedPrinter) {
        try {
          const printer = JSON.parse(savedPrinter);
          const updatedPrinter = {
            ...printer,
            deviceId: device.id,
            lastConnected: new Date().toISOString()
          };
          localStorage.setItem('connectedPrinter', JSON.stringify(updatedPrinter));
        } catch (e) {
          console.error('Error updating printer info:', e);
        }
      }
    } else {
      setPrinterDevice(null);
    }
  };

  const connectPrinter = async (device: BluetoothDevice, name: string) => {
    try {
      if (!device.gatt) {
        throw new Error('Device does not support GATT');
      }

      // Connect to the device
      await device.gatt.connect();
      
      // Store printer information (without device object for serialization)
      const printerInfo = {
        name: name,
        deviceId: device.id,
        connectedAt: new Date().toISOString(),
        lastConnected: new Date().toISOString()
      };
      
      localStorage.setItem('connectedPrinter', JSON.stringify(printerInfo));
      
      // Update state
      setPrinterName(name);
      updateConnectionState(true, device);
      
      // Listen for disconnection
      device.addEventListener('gattserverdisconnected', () => {
        updateConnectionState(false);
        toast({
          title: "Printer Disconnected",
          description: `${name} has been disconnected.`,
          variant: "destructive"
        });
      });
      
      toast({
        title: "Printer Connected",
        description: `Successfully connected to ${name}`,
        variant: "default"
      });
      
    } catch (error: any) {
      console.error('Failed to connect printer:', error);
      toast({
        title: "Connection Failed",
        description: `Failed to connect to ${name}: ${error.message}`,
        variant: "destructive"
      });
      throw error;
    }
  };

  const disconnectPrinter = () => {
    if (printerDevice && printerDevice.gatt?.connected) {
      printerDevice.gatt.disconnect();
    }
    updateConnectionState(false);
    setPrinterName('');
    localStorage.removeItem('connectedPrinter');
    localStorage.removeItem('printerConnectionState');
    
    toast({
      title: "Printer Disconnected",
      description: "Bluetooth printer has been disconnected.",
      variant: "default"
    });
  };

  const checkPrinterConnection = async () => {
    try {
      const savedPrinter = localStorage.getItem('connectedPrinter');
      const connectionState = localStorage.getItem('printerConnectionState');
      
      if (savedPrinter) {
        const printer = JSON.parse(savedPrinter);
        let isActuallyConnected = false;
        
        // Check if we have a stored connection state
        if (connectionState === 'connected' && printer.deviceId) {
          try {
            // Try to reconnect to the stored device if available
            if (navigator.bluetooth && 'getDevices' in navigator.bluetooth) {
              const devices = await (navigator.bluetooth as any).getDevices();
              const storedDevice = devices.find((d: BluetoothDevice) => d.id === printer.deviceId);
              
              if (storedDevice) {
                // Check if device is still connected
                if (storedDevice.gatt?.connected) {
                  isActuallyConnected = true;
                  setPrinterDevice(storedDevice);
                } else {
                  // Try to reconnect
                  try {
                    await storedDevice.gatt?.connect();
                    isActuallyConnected = true;
                    setPrinterDevice(storedDevice);
                    
                    // Listen for disconnection
                    storedDevice.addEventListener('gattserverdisconnected', () => {
                      updateConnectionState(false);
                    });
                    
                    // Update the stored printer with current connection state
                    const updatedPrinter = {
                      ...printer,
                      lastConnected: new Date().toISOString()
                    };
                    localStorage.setItem('connectedPrinter', JSON.stringify(updatedPrinter));
                  } catch (reconnectError) {
                    console.log('Failed to reconnect to printer:', reconnectError);
                    // Mark as disconnected
                    localStorage.setItem('printerConnectionState', 'disconnected');
                  }
                }
              }
            }
          } catch (error) {
            console.log('Error checking printer connection:', error);
          }
        }
        
        // If we have printer info, show as connected for UI purposes
        // Actual device connection will be checked when printing
        setPrinterConnected(true);
        setPrinterName(printer.name || 'Unknown Printer');
        
        // Update connection state in localStorage
        localStorage.setItem('printerConnectionState', 'connected');
      } else {
        setPrinterConnected(false);
        setPrinterName('');
        setPrinterDevice(null);
        localStorage.removeItem('printerConnectionState');
      }
    } catch (e) {
      console.error('Error checking printer status:', e);
      setPrinterConnected(false);
      setPrinterName('');
      setPrinterDevice(null);
      localStorage.setItem('printerConnectionState', 'disconnected');
    }
  };

  // Initialize printer state immediately from localStorage
  useEffect(() => {
    const initializePrinter = () => {
      const savedPrinter = localStorage.getItem('connectedPrinter');
      
      if (savedPrinter) {
        try {
          const printer = JSON.parse(savedPrinter);
          setPrinterConnected(true);
          setPrinterName(printer.name || 'Unknown Printer');
          localStorage.setItem('printerConnectionState', 'connected');
        } catch (e) {
          console.error('Error parsing saved printer:', e);
        }
      } else {
        setPrinterConnected(false);
        setPrinterName('');
      }
    };

    // Immediate initialization
    initializePrinter();
    
    // Then run full check
    setTimeout(checkPrinterConnection, 100);

    // Listen for storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'connectedPrinter' || e.key === 'printerConnectionState') {
        initializePrinter();
        checkPrinterConnection();
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const value: PrinterContextType = {
    printerConnected,
    printerName,
    printerDevice,
    connectPrinter,
    disconnectPrinter,
    checkPrinterConnection,
    updateConnectionState
  };

  return (
    <PrinterContext.Provider value={value}>
      {children}
    </PrinterContext.Provider>
  );
};