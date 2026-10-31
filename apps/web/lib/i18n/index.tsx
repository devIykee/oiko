"use client";
// English-only string table. Every user-facing string in product screens goes through t().
import { useCallback } from "react";
import { en, type MessageKey } from "./en";

export type { MessageKey };
export type TFn = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translate(key: MessageKey, vars?: Record<string, string | number>): string {
  const s: string = en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`)) : s;
}

export function useT(): TFn {
  return useCallback<TFn>((key, vars) => translate(key, vars), []);
}
