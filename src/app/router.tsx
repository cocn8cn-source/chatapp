import { createBrowserRouter, Navigate } from 'react-router-dom';
import { WelcomePage } from '@/features/welcome/WelcomePage';
import { AppShell } from '@/features/shell/AppShell';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { CallsPage } from '@/features/calls/CallsPage';
import { ChatsPage } from '@/features/chat/ChatsPage';
import { SavedPage } from '@/features/chat/SavedPage';
import { ContactsPage } from '@/features/contacts/ContactsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';

export const router = createBrowserRouter([
  { path: '/', element: <WelcomePage /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '/forgot-password', element: <ForgotPasswordPage /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  {
    element: <RequireAuth />,
    children: [{
      path: '/app',
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="chats" replace /> },
        { path: 'chats', element: <ChatsPage /> },
        { path: 'chats/:conversationId', element: <ChatsPage /> },
        { path: 'saved', element: <SavedPage /> },
        { path: 'people', element: <ContactsPage /> },
        { path: 'people/:userId', element: <ProfilePage /> },
        { path: 'contacts', element: <Navigate to="/app/people" replace /> },
        { path: 'calls', element: <CallsPage /> },
        { path: 'notifications', element: <NotificationsPage /> },
        { path: 'settings', element: <SettingsPage /> },
        { path: '*', element: <Navigate to="/app/chats" replace /> },
      ],
    }],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
