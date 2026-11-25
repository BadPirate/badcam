import { statfs, mkdir, writeFile, rm, readdir } from "node:fs/promises"
import path from "node:path"

import { getEnv } from "../env"
import { SUBDIRS, tmpDir } from "./layout"

export type DiskUsage = {
  freeBytes: number
  totalBytes: number
  usedBytes: number
}

export async function diskUsage(
  dir: string = getEnv().dataDir,
): Promise<DiskUsage> {
  const s = await statfs(dir)
  const totalBytes = Number(s.blocks) * Number(s.bsize)
  const freeBytes = Number(s.bavail) * Number(s.bsize)
  return { freeBytes, totalBytes, usedBytes: totalBytes - freeBytes }
}

export const GIB = 1024 ** 3

export async function ensureDataDirs(): Promise<void> {
  const root = getEnv().dataDir
  for (const sub of SUBDIRS)
    await mkdir(path.join(root, sub), { recursive: true })
}

/** Null when the data directory is usable, else the problem. */
export async function dataDirProblem(): Promise<string | null> {
  try {
    await ensureDataDirs()
    const probe = path.join(tmpDir(), `.probe-${process.pid}`)
    await writeFile(probe, "ok")
    await rm(probe)
    return null
  } catch (error) {
    return `DATA_DIR is not writable: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function emptyTmp(): Promise<void> {
  await mkdir(tmpDir(), { recursive: true })
  for (const name of await readdir(tmpDir())) {
    await rm(path.join(tmpDir(), name), { recursive: true, force: true })
  }
}

export function formatBytes(n: number): string {
  if (n >= GIB) return `${(n / GIB).toFixed(n >= 10 * GIB ? 0 : 1)} GB`
  if (n >= 1024 ** 2)
    return `${(n / 1024 ** 2).toFixed(n >= 10 * 1024 ** 2 ? 0 : 1)} MB`
  return `${Math.max(0, Math.round(n / 1024))} kB`
}
