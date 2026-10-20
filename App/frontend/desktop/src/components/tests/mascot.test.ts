/** Mascot tests. */
import { describe, expect, it } from "vitest";
import { preloadCubyAsset } from "../mascot/cuby.js";

describe("preloadCubyAsset", () => {
  it("等目标立绘加载完成后才返回可切换的 src", async () => {
    let assignedSrc = "";
    const fakeImage = {
      onload: null,
      onerror: null,
      get src() {
        return assignedSrc;
      },
      set src(value: string) {
        assignedSrc = value;
      }
    } as HTMLImageElement;
    const pending = preloadCubyAsset("/assets/cuby-neutral.png", {
      createImage: () => fakeImage
    });
    let resolved = false;

    void pending.then(() => {
      resolved = true;
    });
    await Promise.resolve();

    expect(assignedSrc).toBe("/assets/cuby-neutral.png");
    expect(resolved).toBe(false);

    fakeImage.onload?.call(fakeImage, new Event("load"));

    await expect(pending).resolves.toBe("/assets/cuby-neutral.png");
    expect(resolved).toBe(true);
  });
});
