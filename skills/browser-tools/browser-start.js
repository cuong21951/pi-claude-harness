#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = {
	darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
	win32: [
		`${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
		`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
		`${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
	],
	linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

const USER_PROFILE_DIRS = {
	darwin: path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
	win32: `${process.env.LOCALAPPDATA}\\Google\\Chrome\\User Data`,
	linux: path.join(os.homedir(), ".config/google-chrome"),
};

const chromePath = (CHROME_CANDIDATES[process.platform] ?? []).find((p) => fs.existsSync(p));
if (!chromePath) {
	console.error(`✗ Chrome not found on ${process.platform}`);
	process.exit(1);
}

const useProfile = process.argv[2] === "--profile";

if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const SCRAPING_DIR = path.join(os.homedir(), ".cache", "browser-tools");

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Chrome already running on :9222");
	process.exit(0);
} catch {}

const SKIP_ENTRIES = new Set([
	"SingletonLock",
	"SingletonSocket",
	"SingletonCookie",
	"Sessions",
	"Current Session",
	"Current Tabs",
	"Last Session",
	"Last Tabs",
]);

// Setup profile directory
fs.mkdirSync(SCRAPING_DIR, { recursive: true });

// Remove SingletonLock to allow new instance
for (const entry of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
	fs.rmSync(path.join(SCRAPING_DIR, entry), { force: true });
}

if (useProfile) {
	console.log("Syncing profile...");
	fs.cpSync(USER_PROFILE_DIRS[process.platform], SCRAPING_DIR, {
		recursive: true,
		force: true,
		filter: (src) => !SKIP_ENTRIES.has(path.basename(src)),
	});
}

// Start Chrome with flags to force new instance
spawn(
	chromePath,
	[
		"--remote-debugging-port=9222",
		`--user-data-dir=${SCRAPING_DIR}`,
		"--no-first-run",
		"--no-default-browser-check",
	],
	{ detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error("✗ Failed to connect to Chrome");
	process.exit(1);
}

console.log(`✓ Chrome started on :9222${useProfile ? " with your profile" : ""}`);
