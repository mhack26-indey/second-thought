import { networkInterfaces } from "node:os";

export const PORT = Number(process.env.PORT ?? 3000);

// Default to the LAN address so links open on a phone on the same Wi-Fi.
// Set PUBLIC_URL to a tunnel or deployed URL to reach it from anywhere.
function lanAddress(): string | undefined {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
}

export const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://${lanAddress() ?? "localhost"}:${PORT}`).replace(/\/$/, "");
