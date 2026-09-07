import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Sequence,
} from "remotion";
import type { ClipPlan } from "../lib/types";

export type ShortClipProps = {
  sourceVideoPath: string;
  clip: ClipPlan;
};

// 9:16, standard short-form dimensions
export const SHORT_WIDTH = 1080;
export const SHORT_HEIGHT = 1920;
export const SHORT_FPS = 30;

function useZoomTransform(clip: ClipPlan, localSec: number) {
  const kfs = clip.zoomKeyframes.length
    ? clip.zoomKeyframes
    : [{ atSec: 0, scale: 1, focusX: 0.5, focusY: 0.5 }];

  let prev = kfs[0];
  let next = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (localSec >= kfs[i].atSec && localSec <= kfs[i + 1].atSec) {
      prev = kfs[i];
      next = kfs[i + 1];
      break;
    }
  }

  const span = Math.max(next.atSec - prev.atSec, 0.001);
  const t = Math.min(Math.max((localSec - prev.atSec) / span, 0), 1);
  const scale = interpolate(t, [0, 1], [prev.scale, next.scale]);
  const focusX = interpolate(t, [0, 1], [prev.focusX, next.focusX]);
  const focusY = interpolate(t, [0, 1], [prev.focusY, next.focusY]);
  return { scale, focusX, focusY };
}

const Captions: React.FC<{ clip: ClipPlan; localSec: number }> = ({ clip, localSec }) => {
  const active = clip.captions.find((c) => localSec >= c.startSec && localSec <= c.endSec);
  if (!active) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 220,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0 60px",
      }}
    >
      <span
        style={{
          fontFamily: "Inter, Arial, sans-serif",
          fontWeight: 800,
          fontSize: 64,
          lineHeight: 1.15,
          color: "white",
          textAlign: "center",
          textShadow: "0 4px 18px rgba(0,0,0,0.65)",
          WebkitTextStroke: "2px rgba(0,0,0,0.35)",
        }}
      >
        {active.text}
      </span>
    </div>
  );
};

export const ShortClipComposition: React.FC<ShortClipProps> = ({ sourceVideoPath, clip }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localSec = frame / fps + clip.sourceStartSec;
  const relativeSec = frame / fps;

  const { scale, focusX, focusY } = useZoomTransform(clip, relativeSec);

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <AbsoluteFill
        style={{
          transform: `scale(${scale})`,
          transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
        }}
      >
        <OffthreadVideo
          src={sourceVideoPath}
          startFrom={Math.round(clip.sourceStartSec * fps)}
          endAt={Math.round(clip.sourceEndSec * fps)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      </AbsoluteFill>

      <Captions clip={clip} localSec={relativeSec} />

      <Sequence from={0} durationInFrames={Math.round(30 * fps)}>
        <div
          style={{
            position: "absolute",
            top: 90,
            left: 40,
            right: 40,
            fontFamily: "Inter, Arial, sans-serif",
            fontWeight: 900,
            fontSize: 52,
            color: "white",
            textShadow: "0 4px 18px rgba(0,0,0,0.6)",
          }}
        >
          {clip.hookTitle}
        </div>
      </Sequence>
    </AbsoluteFill>
  );
};
