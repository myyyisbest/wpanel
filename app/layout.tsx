import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WPanel · WSL2 与 Docker 管理',
  description: '仅在本机运行的轻量 WSL2 与 Docker 管理面板',
};

const themeBootstrap = `(function(){try{var m=localStorage.getItem('wpanel-theme')||'auto';var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/>{children}</body></html>;
}
