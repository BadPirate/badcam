import type { Mirror } from "./ffmpeg"
import { describe, expect, it } from "vitest"

import { buildSegmentArgs, timestampText } from "./ffmpeg"

const base = {
  inputs: {
    front: "/o/front.mp4",
    back: "/o/back.mp4",
    left_repeater: "/o/left.mp4",
    right_repeater: "/o/right.mp4",
  },
  epoch: 1_795_198_930,
  maxDuration: 60,
  fontFile: "/f/DejaVuSans.ttf",
  fps: 24,
  crf: 26,
  mirror: "none" as Mirror,
  output: "/t/seg.mp4",
}

const graph = (o: Partial<typeof base> = {}) => {
  const args = buildSegmentArgs({ ...base, ...o })
  return args[args.indexOf("-filter_complex") + 1] as string
}

describe("timestampText", () => {
  it("has exactly the backslashes ffmpeg needs", () => {
    expect(timestampText(1234)).toBe(
      "%{pts\\:gmtime\\:1234\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}",
    )
  })
})

describe("buildSegmentArgs", () => {
  it("builds the exact 2x2 graph", () => {
    const S =
      "fps=24,scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,setsar=1"
    const L =
      "fontfile=/f/DejaVuSans.ttf:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=4"
    expect(graph()).toBe(
      [
        `[0:v]${S},drawtext=${L}:x=8:y=8:text='FRONT'[f]`,
        `[1:v]${S},drawtext=${L}:x=8:y=8:text='BACK'[b]`,
        `[2:v]${S},drawtext=${L}:x=8:y=8:text='LEFT'[l]`,
        `[3:v]${S},drawtext=${L}:x=8:y=8:text='RIGHT'[r]`,
        "[f][b][l][r]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[g]",
        `[g]drawtext=${L}:x=(w-tw)/2:y=h-th-10:text='${timestampText(1_795_198_930)}'[v]`,
      ].join(";"),
    )
  })

  it("passes arguments as an array with the encoder settings", () => {
    const args = buildSegmentArgs({ ...base, fps: 30, crf: 28 })
    expect(args.slice(0, 5)).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-nostdin",
    ])
    expect(args.filter((a) => a === "-i")).toHaveLength(4)
    expect(args).toContain("libx264")
    expect(args[args.indexOf("-crf") + 1]).toBe("28")
    expect(args).toContain("+faststart")
    expect(args).toContain("-an")
    expect(args.at(-1)).toBe("/t/seg.mp4")
    expect(graph({ fps: 30 })).toContain("fps=30,")
  })

  it("substitutes a black tile and labels a missing camera", () => {
    const args = buildSegmentArgs({
      ...base,
      inputs: { ...base.inputs, right_repeater: null },
      maxDuration: 59.9,
    })
    expect(args.filter((a) => a === "-i")).toHaveLength(4)
    expect(args).toContain("color=c=black:s=640x480:r=24:d=59.9")
    expect(args[args.indexOf("-filter_complex") + 1]).toContain(
      "text='RIGHT (missing)'",
    )
    const all = buildSegmentArgs({ ...base, inputs: { front: "/o/front.mp4" } })
    const g = all[all.indexOf("-filter_complex") + 1] as string
    expect(g).toContain("text='BACK (missing)'")
    expect(g).toContain("text='LEFT (missing)'")
    expect(g).not.toContain("FRONT (missing)")
  })

  it("mirrors no cameras, the back one, or all rear-facing ones", () => {
    expect(graph()).not.toContain("hflip")
    const back = graph({ mirror: "back" })
    expect(back.match(/hflip/g)).toHaveLength(1)
    expect(back).toMatch(/\[1:v\][^;]*hflip,drawtext/)
    const rear = graph({ mirror: "rear_all" })
    expect(rear.match(/hflip/g)).toHaveLength(3)
    expect(rear).toMatch(/\[0:v\][^;]*drawtext=[^;]*text='FRONT'/)
    expect(rear).not.toMatch(/\[0:v\][^;]*hflip/)
  })
})
