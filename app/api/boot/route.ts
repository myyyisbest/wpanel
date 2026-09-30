import { ensureController } from '../../controller-boot.server';

export async function GET() {
  const ok = await ensureController();
  return Response.json({ ok }, { status: ok ? 200 : 503 });
}
