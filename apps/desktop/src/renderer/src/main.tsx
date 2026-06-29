import { createRoot } from 'react-dom/client';
import { App } from '@/app';
import { installAdaptiveTheme } from '@/theme';
import 'allotment/dist/style.css';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root 未找到');

const uninstallAdaptiveTheme = installAdaptiveTheme();
if (import.meta.hot) import.meta.hot.dispose(uninstallAdaptiveTheme);

createRoot(el).render(<App />);
