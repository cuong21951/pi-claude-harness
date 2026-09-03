import { execSync } from "node:child_process";
import path from "node:path";

// The installed pi package (extensions import it, jiti aliases resolve against it).
// Set PI_DIR when pi is not the global npm install.
export const PI_DIR =
	process.env.PI_DIR ??
	path.join(execSync("npm root -g", { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
