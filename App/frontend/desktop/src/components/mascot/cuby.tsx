/** Cuby module. */
import { useEffect, useState } from "react";
import cubyBlushUrl from "../../assets/mascot/cuby-blush.png";
import cubyBrainUrl from "../../assets/mascot/cuby-brain.png";
import cubyCelebrateUrl from "../../assets/mascot/cuby-celebrate.png";
import cubyChatUrl from "../../assets/mascot/cuby-chat.png";
import cubyConnectUrl from "../../assets/mascot/cuby-connect.png";
import cubyHumUrl from "../../assets/mascot/cuby-hum.png";
import cubyNeutralUrl from "../../assets/mascot/cuby-neutral.png";
import cubyPleadUrl from "../../assets/mascot/cuby-plead.png";
import cubyReadUrl from "../../assets/mascot/cuby-read.png";
import cubySadUrl from "../../assets/mascot/cuby-sad.png";
import cubyShieldUrl from "../../assets/mascot/cuby-shield.png";
import cubySleepUrl from "../../assets/mascot/cuby-sleep.png";
import cubyThinkUrl from "../../assets/mascot/cuby-think.png";
import cubyWaveUrl from "../../assets/mascot/cuby-wave.png";

export type CubyPose =
  | "wave"
  | "think"
  | "work"
  | "celebrate"
  | "shield"
  | "read"
  | "connect"
  | "sleep"
  | "neutral"
  | "point"
  | "box"
  | "brain"
  | "chat"
  | "wrench"
  | "blush"
  | "peek"
  | "hum"
  | "plead"
  | "sad";

export interface CubyProps {
  pose?: CubyPose;
  size?: number;
  className?: string;
}

export interface CubyAssetPreloadOptions {
  createImage?: () => HTMLImageElement;
}

export const poseToAsset: Record<CubyPose, string> = {
  neutral: cubyNeutralUrl,
  wave: cubyWaveUrl,
  think: cubyThinkUrl,
  work: cubyNeutralUrl,
  celebrate: cubyCelebrateUrl,
  shield: cubyShieldUrl,
  read: cubyReadUrl,
  connect: cubyConnectUrl,
  sleep: cubySleepUrl,
  point: cubyNeutralUrl,
  box: cubyNeutralUrl,
  brain: cubyBrainUrl,
  chat: cubyChatUrl,
  wrench: cubyNeutralUrl,
  blush: cubyBlushUrl,
  peek: cubyNeutralUrl,
  hum: cubyHumUrl,
  plead: cubyPleadUrl,
  sad: cubySadUrl
};

export function preloadCubyAsset(src: string, options: CubyAssetPreloadOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = options.createImage?.() ?? new Image();

    image.onload = () => resolve(src);
    image.onerror = () => reject(new Error(`Failed to preload Cuby asset: ${src}`));
    image.src = src;
  });
}

/**
 * Render the Cuby artwork and preload the target image before switching poses.
 *
 * @param props the Cuby display props.
 * @returns an img element.
 */
export function Cuby({ pose = "neutral", size = 100, className = "" }: CubyProps) {
  const target = poseToAsset[pose] ?? cubyNeutralUrl;
  const [src, setSrc] = useState(target);

  useEffect(() => {
    if (target === src) {
      return;
    }

    let disposed = false;
    void preloadCubyAsset(target)
      .then((loadedSrc) => {
        if (!disposed) {
          setSrc(loadedSrc);
        }
      })
      .catch((error) => {
        console.warn("preload Cuby asset failed", error);
      });

    return () => {
      disposed = true;
    };
  }, [target, src]);

  return (
    <img
      src={src}
      alt="Cuby"
      className={className}
      draggable={false}
      onError={() => {
        if (src !== cubyNeutralUrl) {
          setSrc(cubyNeutralUrl);
        }
      }}
      style={{
        width: size,
        height: "auto",
        userSelect: "none",
        display: "inline-block"
      }}
    />
  );
}
