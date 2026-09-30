import Dashboard from './Dashboard';
import { ensureController } from './controller-boot.server';

// 每次请求动态渲染：页面被打开时顺带确保控制服务在线（失联自动拉起）
export const dynamic = 'force-dynamic';

export default async function Home() {
  await ensureController();
  return <Dashboard />;
}
