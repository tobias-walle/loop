import * as fs from "node:fs";

export function isSandboxed(): boolean {
  try {
    // Docker / Podman: /.dockerenv exists
    if (fs.existsSync("/.dockerenv")) return true;
    // cgroups: look for docker/container references
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd") || cgroup.includes("lxc")) {
      return true;
    }
    // Kubernetes / generic container runtime
    if (process.env.KUBERNETES_SERVICE_HOST) return true;
    // Devcontainer
    if (process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true") return true;
    return false;
  } catch {
    return false;
  }
}
