// Shared types passed between Apify -> GLM -> Remotion

// One connected social channel inside a single Buffer account.
export interface BufferChannel {
  id: string;
  service: string; // e.g. "instagram", "tiktok", "youtube_shorts", "x"
  displayName: string;
}

export interface TranscriptWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
}

export interface VideoIntel {
  sourceUrl: string;
  title: string;
  durationSec: number;
  videoFilePath: string; // local path or remote URL Remotion can read
  transcript: TranscriptWord[];
  // Coarse scene cut timestamps if the Apify actor / ffmpeg pass provides them
  sceneCuts?: number[];
}

// Optional "editing style" extracted from a sample video the user provides.
// This is what stands in for "let the AI copy this video's editing technique" —
// we describe the sample's rhythm/captions/zoom pattern as data, since a
// text-only GLM endpoint can't watch raw video frames.
export interface StyleProfile {
  avgCutLengthSec: number;
  captionStyle: {
    position: "bottom" | "center" | "top";
    wordsPerCaption: number;
    highlightActiveWord: boolean;
    fontHint: string;
  };
  zoomRhythm: {
    zoomEverySec: number;
    zoomIntensity: number; // 0-1
  };
  notes: string;
}

export interface EditRules {
  // Free text the user can change between runs, e.g.
  // "prioritize punchy one-liners", "keep clips under 40s", "no zoom on faces"
  instructions: string;
  targetClipCount: number;
  minClipSec: number;
  maxClipSec: number;
  aspect: "9:16";
}

export interface CaptionCue {
  text: string;
  startSec: number;
  endSec: number;
  emphasizeWordIndex?: number;
}

export interface ZoomKeyframe {
  atSec: number;
  scale: number; // 1 = no zoom
  focusX: number; // 0-1 normalized
  focusY: number; // 0-1 normalized
}

export interface ClipPlan {
  clipId: string;
  sourceStartSec: number;
  sourceEndSec: number;
  hookTitle: string;
  captions: CaptionCue[];
  zoomKeyframes: ZoomKeyframe[];
}

export interface EditPlan {
  sourceVideoPath: string;
  clips: ClipPlan[];
}

export interface FrameNote {
  atSec: number;
  /** Short vision-model summary of what's visible in this frame */
  events: string;
  /** On-screen text / scoreboard / captions visible (or "" if none) */
  onScreenText: string;
  /** 0-100 visual interest score from the vision model */
  interest: number;
}

/** Visual context extracted from the actual source video file. */
export interface VisualContext {
  /** Exact scene-cut timestamps detected frame-by-frame by ffmpeg. */
  sceneCuts: number[];
  /** Vision-model notes for sampled frames. */
  frameNotes: FrameNote[];
  /** Which source video these came from (videoFilePath at extraction time). */
  sourceFile: string;
}
