import { describe, expect, it } from "vitest";
import { assertShellCommandAllowed, canRunShell, canUseNetwork, canWriteFiles } from "./safety.js";

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

  it("blocks common network shell commands unless network policy is enabled", () => {
    expect(() =>
      assertShellCommandAllowed("npm install", {
        mode: "workspace-write",
        allowShell: true,
        allowFileWrite: true,
        allowNetwork: false
      })
    ).toThrow(/network-enabled/);

    expect(() =>
      assertShellCommandAllowed("git pull", {
        mode: "full-access",
        allowShell: true,
        allowFileWrite: true,
        allowNetwork: false
      })
    ).toThrow(/network-enabled/);
  });

  it("allows network shell commands when network policy is enabled", () => {
    const policy = {
      mode: "workspace-write" as const,
      allowShell: true,
      allowFileWrite: true,
      allowNetwork: true
    };
    expect(canUseNetwork(policy)).toBe(true);
    expect(() => assertShellCommandAllowed("npm install", policy)).not.toThrow();
  });

  it("blocks workspace-denied shell commands", () => {
    expect(() =>
      assertShellCommandAllowed("terraform apply -auto-approve", {
        mode: "full-access",
        allowShell: true,
        allowFileWrite: true,
        allowNetwork: true,
        deniedShellCommands: ["\\bterraform\\s+apply\\b"]
      })
    ).toThrow(/denied by workspace shell policy/);
  });

  it("requires an allowlist match when workspace shell allowlist is configured", () => {
    const policy = {
      mode: "workspace-write" as const,
      allowShell: true,
      allowFileWrite: true,
      allowedShellCommands: ["^npm\\s+test$"]
    };

    expect(() => assertShellCommandAllowed("npm test", policy)).not.toThrow();
    expect(() => assertShellCommandAllowed("npm run build", policy)).toThrow(/allowlist/);
  });

  it("does not let shell allowlists bypass built-in dangerous or network gates", () => {
    expect(() =>
      assertShellCommandAllowed("git reset --hard HEAD", {
        mode: "workspace-write",
        allowShell: true,
        allowFileWrite: true,
        allowedShellCommands: [".*"]
      })
    ).toThrow(/full-access/);

    expect(() =>
      assertShellCommandAllowed("npm install", {
        mode: "workspace-write",
        allowShell: true,
        allowFileWrite: true,
        allowNetwork: false,
        allowedShellCommands: [".*"]
      })
    ).toThrow(/network-enabled/);
  });
});
