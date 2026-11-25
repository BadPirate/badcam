import { deviceOr401 } from "@/lib/api"
import { receiveChunk } from "@/lib/upload/receive"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const auth = await deviceOr401(request)
  if ("response" in auth) return auth.response
  const { path } = await params
  return receiveChunk(request, auth.device, path)
}
