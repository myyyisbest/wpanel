import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WPanel — WSL2 与 Docker 的本机驾驶舱',
  description: '为 Windows 而生的 WSL2 与 Docker 轻量管理面板：零 agent 文件管理、Compose 编排、应用商店与 AI 助手，一切都在本机。',
};

const themeBootstrap = `(function(){try{var m=localStorage.getItem('wpanel-theme')||'auto';var d=m==='dark'||(m!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light';}catch(e){}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/>{children}</body></html>;
}
