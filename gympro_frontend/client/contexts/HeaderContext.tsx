import React, { createContext, useContext } from 'react';

export type HeaderContextType = {
  headerTitle: string;
  setHeaderTitle: (title: string) => void;
};

export const HeaderContext = createContext<HeaderContextType | undefined>(undefined);

export function useHeader() {
  const ctx = useContext(HeaderContext);
  if (!ctx) throw new Error('useHeader must be used within a HeaderContext provider');
  return ctx;
}
