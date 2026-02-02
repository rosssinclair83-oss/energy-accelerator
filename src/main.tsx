import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';

import AppShell from '@/components/layout/AppShell';
import MapView from '@/components/features/map/MapView';
import './index.css';

import { Dashboard } from '@/components/features/dashboard/Dashboard';

const Placeholder = ({ title }: { title: string }) => (
  <div className="flex h-full w-full items-center justify-center bg-background text-2xl font-semibold text-muted-foreground">
    {title} view coming soon
  </div>
);

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      {
        index: true,
        element: <Navigate to="/dashboard" replace />,
      },
      {
        path: 'dashboard',
        element: <Dashboard className="h-full" />,
      },
      {
        path: 'map',
        element: <MapView className="h-full" />,
      },
      {
        path: 'analysis',
        element: <Placeholder title="Analysis" />,
      },

    ],
  },
]);

import { Analytics } from '@vercel/analytics/react';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
    <Analytics />
  </React.StrictMode>,
);
