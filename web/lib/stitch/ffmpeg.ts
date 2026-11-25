import { execFile } from "node:child_process"

import type { Mirror } from "../env"
import type { KnownCamera } from "../tesla/paths"

export type { Mirror }

const CAMERA_ORDER: readonly KnownCamera[] = [
  "front",
  "back",
  "left_repeater",
  "right_repeater",
]
const LABELS: Record<KnownCamera, string> = {
  front: "FRONT",
  back: "BACK",
  left_repeater: "LEFT",
  right_repeater: "RIGHT",
}
const MIRRORED: Record<Mirror, readonly KnownCamera[]> = {
  none: [],
  back: ["back"],
  rear_all: ["back", "left_repeater", "right_repeater"],
}

export type SegmentOptions = {
  /** Absolute path per camera; null or absent means missing or invalid. */
  inputs: Partial<Record<KnownCamera, string | null>>
  /** The clip minute as UTC epoch seconds. */
  epoch: number
  /** Length for substituted black tiles. */
  maxDuration: number
  fontFile: string
  fps: number
  crf: number
  mirror: Mirror
  output: string
}

export function buildSegmentArgs(o: SegmentOptions): string[] {
  const tile = `fps=${o.fps},scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,setsar=1`
  const label = `fontfile=${o.fontFile}:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=4`

  const args = ["-hide_banner", "-loglevel", "error", "-y", "-nostdin"]
  const chains: string[] = []
  CAMERA_ORDER.forEach((camera, i) => {
    const file = o.inputs[camera]
    if (file) {
      args.push("-i", file)
    } else {
      args.push(
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=640x480:r=${o.fps}:d=${o.maxDuration}`,
      )
    }
    const flip = MIRRORED[o.mirror].includes(camera) ? "hflip," : ""
    const text = LABELS[camera] + (file ? "" : " (missing)")
    chains.push(
      `[${i}:v]${tile},${flip}drawtext=${label}:x=8:y=8:text='${text}'[${"fblr"[i]}]`,
    )
  })
  chains.push("[f][b][l][r]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[g]")
  chains.push(
    `[g]drawtext=${label}:x=(w-tw)/2:y=h-th-10:text='${timestampText(o.epoch)}'[v]`,
  )

  args.push(
    "-filter_complex",
    chains.join(";"),
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(o.crf),
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    o.output,
  )
  return args
}

/**
 * The drawtext expansion that prints the clip time. ffmpeg needs exactly these
 * backslashes: one before each colon separating the `pts` arguments, three
 * before each colon inside the time format.
 */
export function timestampText(epoch: number): string {
  return String.raw`%{pts\:gmtime\:${epoch}\:%Y-%m-%d %H\\\:%M\\\:%S}`
}

export const concatArgs = (list: string, output: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-nostdin",
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  list,
  "-c",
  "copy",
  "-movflags",
  "+faststart",
  output,
]

export const posterFromThumbArgs = (thumb: string, output: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-nostdin",
  "-i",
  thumb,
  "-vf",
  "scale=640:-2",
  "-frames:v",
  "1",
  output,
]

export const posterFromVideoArgs = (
  video: string,
  seconds: number,
  output: string,
) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-nostdin",
  "-ss",
  String(seconds),
  "-i",
  video,
  "-frames:v",
  "1",
  "-vf",
  "scale=640:-2",
  output,
]

export const highlightArgs = (video: string, output: string) => [
  "-hide_banner",
  "-loglevel",
  "error",
  "-y",
  "-nostdin",
  "-i",
  video,
  "-vf",
  "select='gt(scene,0.003)',setpts=N/(16*TB)",
  "-an",
  "-c:v",
  "libx264",
  "-preset",
  "veryfast",
  "-crf",
  "28",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  output,
]

const TIMEOUT_MS = 10 * 60_000

export type RunResult = { ok: true } | { ok: false; error: string }

/** Runs ffmpeg with an argument array, niced, one at a time (the queue serialises). */
export function runFfmpeg(args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      "nice",
      ["-n", "10", "ffmpeg", ...args],
      {
        env: { ...process.env, TZ: "UTC" },
        timeout: TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, _stdout, stderr) => {
        if (!error) return resolve({ ok: true })
        const tail = (stderr || error.message).slice(-2000)
        resolve({ ok: false, error: tail })
      },
    )
  })
}

export type Probe = {
  valid: boolean
  durationSec: number | null
  width: number | null
  height: number | null
  codec: string | null
}

const INVALID: Probe = {
  valid: false,
  durationSec: null,
  width: null,
  height: null,
  codec: null,
}

/** ffprobe verdict for a video file (10 s timeout). */
export function probeVideo(file: string): Promise<Probe> {
  return new Promise((resolve) => {
    execFile(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height:format=duration",
        "-of",
        "json",
        file,
      ],
      { timeout: 10_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(INVALID)
        try {
          const data = JSON.parse(stdout) as {
            streams?: { codec_name?: string; width?: number; height?: number }[]
            format?: { duration?: string }
          }
          const s = data.streams?.[0]
          const duration = Number(data.format?.duration)
          if (!s?.width || !s.height) return resolve(INVALID)
          const durationSec =
            Number.isFinite(duration) && duration > 0 ? duration : null
          resolve({
            valid: durationSec !== null,
            durationSec,
            width: s.width,
            height: s.height,
            codec: s.codec_name ?? null,
          })
        } catch {
          resolve(INVALID)
        }
      },
    )
  })
}
