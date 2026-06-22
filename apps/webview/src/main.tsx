import { createRoot } from 'react-dom/client';
import { App } from '@/App';
import './index.css';

const el = document.getElementById('root');
if (!el) throw new Error('#root 未找到');
createRoot(el).render(<App />);
