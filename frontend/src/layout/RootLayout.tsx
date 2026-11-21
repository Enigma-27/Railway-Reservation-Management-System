import React, { Suspense, useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ContactProvider } from '../ui/ContactDrawer';
import { CommandProvider } from '../ui/CommandPalette';
import { ToastHost } from '../ui/toast';
import { LiveTrainsView } from '../pages/LiveTrainsPage';

/**
 * Wraps every page: Contact drawer, Ctrl+K palette, toasts, a "skip to content" link and scroll-to-top on navigation.
 * Nothing here floats over the page: the drawer, palette and toasts only exist while they are used.
 */
export const RootLayout: React.FC = () => {
  const { pathname, hash } = useLocation();
  useEffect(() => { if (!hash) window.scrollTo({ top: 0 }); }, [pathname, hash]);
  return (
    <ContactProvider>
      <CommandProvider>
        <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById('main'); m?.setAttribute('tabindex', '-1'); m?.focus(); m?.scrollIntoView(); }}>Skip to content</a>
        <Suspense fallback={<div className="route-loading" role="status">Loading...</div>}><Outlet /></Suspense>
        <ToastHost />
      </CommandProvider>
    </ContactProvider>
  );
};

/** Live Trains inside the passenger, staff and admin portals (same view as the public page). */
export const PortalLiveTrains: React.FC<{ context: 'passenger' | 'staff' | 'admin' }> = ({ context }) => (
  <>
    <h1 className="t-display portal-h1">Live <em>Trains</em></h1>
    <LiveTrainsView context={context} />
  </>
);
