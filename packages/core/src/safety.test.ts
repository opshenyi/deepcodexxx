import { describe, expect, it } from "vitest";
import { assertShellCommandAllowed, canRunShell, canWriteFiles } from "./safety.js";

describe("safety policy", () => {
  it("disables writes and shell in suggest mode", () => {
    const policy = { mode: "suggest" as const, allowShell: false, allowFileWrite: false };
    expect(canWriteFiles(policy)).toBe(false);
    expect(canRunShell(policy)).toBe(false);
  });

  it("blocks dangerous shell commands outside full-access mode", () => {
    expect(() =>
      assertShellCommandAllowed("git reset --hard HEAD", {
        mode: "workspace-write",
        allowShell: true,
        allowFileWrite: true
      })
    ).toThrow(/full-access/);
  });

  it("allows ordinary shell commands when enabled", () => {
    expect(() =>
      assertShellCommandAllowed("npm test", {
        mode: "workspace-write",
        allowShell: true,
        allowFileWrite: true
      })
    ).not.toThrow();
  });
});

