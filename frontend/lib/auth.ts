"use client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TOKEN_COOKIE = "pm_token";
const USER_COOKIE = "pm_user";

export type Role = "ADMIN" | "MANAGER" | "SUPERVISOR" | "TECHNICIAN" | "VIEWER";

export type AuthUser = {
  employee_id: string;
  name: string;
  role: Role;
};

function setCookie(name: string, value: string, days = 1) {
  const expires = new Date(Date.now() + days * 86400_000).toUTCString();
  // Not httpOnly (this is a client-set cookie) — acceptable for this internal
  // plant tool; for a public-internet deployment, move login to a server
  // route that sets a real httpOnly cookie instead.
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  return getCookie(TOKEN_COOKIE);
}

export function getUser(): AuthUser | null {
  if (typeof document === "undefined") return null;
  const raw = getCookie(USER_COOKIE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function logout() {
  clearCookie(TOKEN_COOKIE);
  clearCookie(USER_COOKIE);
  window.location.href = "/login";
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", password);

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail || "Invalid email or password");
  }

  const data = await res.json();
  const user: AuthUser = { employee_id: data.employee_id, name: data.name, role: data.role };
  setCookie(TOKEN_COOKIE, data.access_token);
  setCookie(USER_COOKIE, JSON.stringify(user));
  return user;
}

/** Which roles can see which nav sections / take which actions. */
export const ROLE_CAN = {
  viewImport: (role?: Role) => role === "ADMIN" || role === "MANAGER",
  viewAdmin: (role?: Role) => role === "ADMIN",
  viewAudit: (role?: Role) => role === "ADMIN" || role === "MANAGER",
  completePM: (role?: Role) =>
    role === "TECHNICIAN" || role === "SUPERVISOR" || role === "MANAGER" || role === "ADMIN",
};
