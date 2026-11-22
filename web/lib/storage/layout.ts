import path from "node:path"

import { getEnv } from "../env"

const dataDir = () => getEnv().dataDir

export const incomingDir = (deviceId: string) =>
  path.join(dataDir(), "incoming", deviceId)
export const originalsRoot = () => path.join(dataDir(), "originals")
export const stitchedRoot = () => path.join(dataDir(), "stitched")
export const tmpDir = () => path.join(dataDir(), "tmp")

export const originalPath = (deviceId: string, contractPath: string) =>
  path.join(originalsRoot(), deviceId, ...contractPath.split("/"))

export const stitchedDir = (eventId: string) =>
  path.join(stitchedRoot(), eventId)

export const SUBDIRS = ["incoming", "originals", "stitched", "tmp"] as const

export const EVENT_FILES = ["event.mp4", "poster.jpg", "highlight.mp4"] as const
