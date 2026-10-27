import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
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
import { PublicOnly } from '@/features/auth/PublicOnly';
import { HomeRoute, UnknownRoute } from '@/features/auth/RootRedirects';
import { RouteError } from '@/features/auth/RouteError';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      // Start URL of the installed app: inbox if signed in, welcome page if not.
      { path: '/', element: <HomeRoute><WelcomePage /></HomeRoute> },

      // Signed-in users are bounced to the app (or to the page they were trying to reach).
      {
        element: <PublicOnly />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
        ],
      },
      // Not wrapped in PublicOnly: the recovery link signs the user in before they pick a password.
      { path: '/reset-password', element: <ResetPasswordPage /> },

      // Private area: signed-out visitors are sent to /login and returned here afterwards.
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

      // Anything else.
      { path: '*', element: <UnknownRoute /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
