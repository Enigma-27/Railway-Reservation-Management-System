import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
// Fonts are bundled npm packages (no CDN): they work offline.
import '@fontsource-variable/fraunces/wght.css';
import '@fontsource-variable/fraunces/wght-italic.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { StaffProvider } from './context/StaffContext';
import { AuthProvider } from './admin/auth/AuthContext';
import { ThemeProvider } from './theme/ThemeProvider';
import { router } from './router';
import './index.css';
import './admin/admin-components.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <StaffProvider>
          <RouterProvider router={router} />
        </StaffProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
