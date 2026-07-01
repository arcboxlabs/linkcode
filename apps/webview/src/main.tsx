import { router } from '@webview/router';
import { installTheme } from '@webview/settings/theme';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

// Apply the stored theme before first paint; the app keeps it in sync thereafter.
installTheme();

createRoot(el).render(<RouterProvider router={router} />);
